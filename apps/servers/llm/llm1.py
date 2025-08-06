from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from transformers import pipeline
import torch
import logging
import re

app = FastAPI()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 모델 로딩
try:
    model_id = "MLP-KTLim/llama-3-Korean-Bllossom-8B"
    pipe = pipeline(
        "text-generation",
        model=model_id,
        model_kwargs={"torch_dtype": torch.bfloat16},
        device_map="auto"
    )
    pipe.model.eval()
    eos_token_id = pipe.tokenizer.eos_token_id
    logger.info("[o] LLM 모델 로딩 완료")
except Exception as e:
    logger.error(f"[x] 모델 로딩 실패: {e}")
    raise RuntimeError("모델 로딩 실패")

# 프롬프트
PROMPT_TRIAGE_STEP1 = """당신은 병원 키오스크 접수 어시스턴트입니다.
- 사용자가 말한 증상에 따라 가장 적절한 진료과 1개만 추천하세요.
- 예: "그런 증상은 [진료과]가 적절합니다." 또는 "신경과를 추천드립니다."
- **접수, 위치 안내, 대기시간 안내는 하지 마세요.**
"""

PROMPT_TRIAGE_STEP2 = """당신은 병원 키오스크 접수 어시스턴트입니다.
- 이전에 추천한 진료과로 접수를 진행합니다.
- 접수 완료 후 해당 진료과의 **위치**와 **예상 대기시간**을 안내하세요.
- 이후에는 사용자의 질문에 친절하게 답변하세요.
"""

PROMPT_LOOKUP = """당신은 병원 키오스크 접수 내역 안내 도우미입니다.
- 사용자가 이름과 전화번호를 말하면, 접수된 내역을 알려주세요.
- 접수된 정보에는 진료과, 예약 날짜, 예약 시간이 포함되어야 합니다.
- 접수된 정보가 없을 경우, '접수된 내역이 없습니다.'라고 안내해주세요.
- 오늘은 2025년 7월 29일입니다.
"""

PROMPT_DIRECTION = """당신은 병원 길안내 키오스크 도우미입니다.
- 사용자가 말한 진료과와 기타장소의 위치를 친절하고 간결하게 안내하세요.
- 건물명, 층수, 방향, 엘레베이터 위치, 계단 위치 등을 포함해 실제 병원에서 길을 알려주는 것처럼 설명하세요.
- 예: "정형외과는 본관 3층입니다. 오른쪽으로 가세요.", "피부과는 별관 2층 오른쪽으로 앞에 보이는 엘리베이터를 이용하세요."
"""

# 상태 및 사용자 정보
messages_triage_step1 = [{"role": "system", "content": PROMPT_TRIAGE_STEP1}]
messages_triage_step2 = [{"role": "system", "content": PROMPT_TRIAGE_STEP2}]
reception_db = {}
state = "IDLE"
sub_state = None
retry_count = 0
triage_state = "WAIT_SYMPTOM"

user_name = ""
user_phone = ""
user_address = ""
user_symptom = ""
lookup_name = ""
lookup_phone = ""
predicted_dept = ""

# 예/아니오 분류기
def classify_yes_or_no(text):
    prompt = f"""다음 사용자의 대답이 긍정인지 부정인지 판단해 주세요.
- 가능한 응답은 반드시 '긍정', '부정', '모르겠음' 중 하나여야 합니다.
- 다양한 표현도 고려하세요.

예시:
Q: 네 → A: 긍정
Q: 아니오 → A: 부정
Q: 해줘 → A: 긍정
Q: 응 → A: 긍정
Q: 싫어 → A: 부정
Q: 잘 모르겠어요 → A: 모르겠음
Q: {text}
A:"""
    result = pipe(prompt, max_new_tokens=10, do_sample=False, temperature=0.0, return_full_text=False)
    return result[0]["generated_text"].strip()

# 헬스 체크
@app.get("/health")
def health():
    try:
        _ = pipe("사용자: 테스트\n키오스크:", max_new_tokens=1, do_sample=False)
        return JSONResponse({"status": "ok"})
    except Exception as e:
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=503)

# 메인 LLM API
@app.post("/llm")
async def generate(request: Request):
    data = await request.json()
    user_input = data.get("text", "").strip()

    global state, sub_state, retry_count
    global user_name, user_phone, user_address, user_symptom
    global lookup_name, lookup_phone, predicted_dept

    response = ""

    if user_input.lower() in ["종료", "고마워"]:
        state = "IDLE"
        return JSONResponse({"text": "이용해주셔서 감사합니다. 건강하세요!"})

    if state == "IDLE":
        if any(kw in user_input for kw in ["접수내역", "예약 확인", "내역 확인"]):
            response = "접수 내역을 확인하겠습니다. 이름을 말씀해주세요."
            state = "CHECK_RECEIPT"
            sub_state = "ASK_NAME"
        elif "접수" in user_input:
            response = "접수를 시작하겠습니다. 이름을 말씀해주세요."
            state = "ASK_NAME"
        elif any(kw in user_input for kw in ["길찾기", "위치", "어디야"]):
            response = "어느 곳으로 가시나요?"
            state = "FIND_DIRECTION"
        else:
            response = "죄송합니다. '접수', '접수내역확인', '길찾기' 중 하나로 말씀해주세요."

    elif state == "ASK_NAME":
        user_name = user_input
        response = f"{user_name}님, 맞습니까?"
        state = "CONFIRM_NAME"

    elif state == "CONFIRM_NAME":
        judgment = classify_yes_or_no(user_input)
        if "긍정" in judgment:
            retry_count = 0
            response = "전화번호를 말씀해주세요."
            state = "ASK_PHONE"
        elif "부정" in judgment:
            retry_count += 1
            response = "다시 이름을 말씀해주세요." if retry_count < 3 else "입력 오류가 반복되었습니다. 직원을 호출하겠습니다."
            state = "ASK_NAME" if retry_count < 3 else "IDLE"
        else:
            response = "잘 이해하지 못했습니다. 맞으면 '네', 아니면 '아니오'라고 말씀해주세요."

    elif state == "ASK_PHONE":
        user_phone = user_input
        response = f"{user_phone} 번호가 맞습니까?"
        state = "CONFIRM_PHONE"

    elif state == "CONFIRM_PHONE":
        judgment = classify_yes_or_no(user_input)
        if "긍정" in judgment:
            retry_count = 0
            response = "주소를 말씀해주세요."
            state = "ASK_ADDRESS"
        elif "부정" in judgment:
            retry_count += 1
            response = "다시 전화번호를 말씀해주세요." if retry_count < 3 else "입력 오류가 반복되었습니다. 직원을 호출하겠습니다."
            state = "ASK_PHONE" if retry_count < 3 else "IDLE"
        else:
            response = "잘 이해하지 못했습니다. 맞으면 '네', 아니면 '아니오'라고 말씀해주세요."

    elif state == "ASK_ADDRESS":
        user_address = user_input
        response = f"{user_address} 주소가 맞습니까?"
        state = "CONFIRM_ADDRESS"

    elif state == "CONFIRM_ADDRESS":
        judgment = classify_yes_or_no(user_input)
        if "긍정" in judgment:
            retry_count = 0
            response = "불편하신 증상을 말씀해주세요."
            state = "ASK_SYMPTOM"
        elif "부정" in judgment:
            retry_count += 1
            response = "다시 주소를 말씀해주세요." if retry_count < 3 else "입력 오류가 반복되었습니다. 직원을 호출하겠습니다."
            state = "ASK_ADDRESS" if retry_count < 3 else "IDLE"
        else:
            response = "잘 이해하지 못했습니다. 맞으면 '네', 아니면 '아니오'라고 말씀해주세요."

    elif state == "ASK_SYMPTOM":
        user_symptom = user_input
        messages_triage_step1.append({"role": "user", "content": user_symptom})
        prompt = pipe.tokenizer.apply_chat_template(messages_triage_step1, tokenize=False, add_generation_prompt=True)
        outputs = pipe(prompt, max_new_tokens=128, do_sample=True, temperature=0.5, top_p=0.9, repetition_penalty=1.2, eos_token_id=eos_token_id, return_full_text=False)
        triage_response = outputs[0]["generated_text"].strip()
        response = triage_response + "\n\n이 진료과로 접수해 드릴까요?"
        match = re.search(r"([가-힣]+과)", triage_response)
        predicted_dept = match.group(1) if match else "해당 진료과"
        state = "WAIT_TRIAGE_CONFIRM"

    elif state == "WAIT_TRIAGE_CONFIRM":
        judgment = classify_yes_or_no(user_input)
        if "긍정" in judgment:
            messages_triage_step2.append({"role": "user", "content": f"{user_name}님 {predicted_dept}로 접수해 주세요"})
            prompt = pipe.tokenizer.apply_chat_template(messages_triage_step2, tokenize=False, add_generation_prompt=True)
            outputs = pipe(prompt, max_new_tokens=128, do_sample=True, temperature=0.5, top_p=0.9, repetition_penalty=1.2, eos_token_id=eos_token_id, return_full_text=False)
            response = outputs[0]["generated_text"].strip()
            reception_db[(user_name, user_phone)] = {
                "dept": predicted_dept,
                "date": "2025년 7월 29일",
                "time": "오전 10시"
            }
            state = "IDLE"
        elif "부정" in judgment:
            response = "접수를 원하지 않으시면 처음부터 다시 진행해 주세요."
            state = "IDLE"
        else:
            response = "잘 이해하지 못했습니다. 접수 원하시면 '네'라고 말씀해주세요."

    elif state == "FINISH":
        messages_triage_step2.append({"role": "user", "content": user_input})
        prompt = pipe.tokenizer.apply_chat_template(messages_triage_step2, tokenize=False, add_generation_prompt=True)
        outputs = pipe(prompt, max_new_tokens=128, do_sample=True, temperature=0.5, top_p=0.9, repetition_penalty=1.2, eos_token_id=eos_token_id, return_full_text=False)
        response = outputs[0]["generated_text"].strip()
        state = "IDLE"

    elif state == "CHECK_RECEIPT":
        if sub_state == "ASK_NAME":
            lookup_name = user_input
            response = f"{lookup_name}님, 전화번호를 말씀해주세요."
            sub_state = "ASK_PHONE"
        elif sub_state == "ASK_PHONE":
            lookup_phone = user_input
            key = (lookup_name, lookup_phone)
            if key in reception_db:
                info = reception_db[key]
                response = f"{lookup_name}님은 {info['date']} {info['time']}에 {info['dept']}로 접수되어 있습니다."
            else:
                response = "접수된 내역이 없습니다."
            state = "IDLE"
            sub_state = None
            lookup_name = ""
            lookup_phone = ""

    elif state == "FIND_DIRECTION":
        direction_target = user_input.strip()
        messages_direction = [{"role": "system", "content": PROMPT_DIRECTION}]
        messages_direction.append({"role": "user", "content": f"{direction_target} 어디에 있나요?"})
        prompt = pipe.tokenizer.apply_chat_template(messages_direction, tokenize=False, add_generation_prompt=True)
        outputs = pipe(prompt, max_new_tokens=128, do_sample=True, temperature=0.5, top_p=0.9, repetition_penalty=1.2, eos_token_id=eos_token_id, return_full_text=False)
        response = outputs[0]["generated_text"].strip()
        state = "IDLE"

    logger.info(f"[LLM] 입력: {user_input}")
    logger.info(f"[LLM] 응답: {response}")
    return JSONResponse({"text": response})
