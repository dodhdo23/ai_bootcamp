import os
import uuid
import logging
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.concurrency import run_in_threadpool
from melo.api import TTS

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI()

# main.py와 공유되는 출력 디렉토리 경로
OUTPUT_DIR = "/tmp/melotts_output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 모델 로드
model = TTS(language='KR', device='cuda:0')
speaker_ids = model.hps.data.spk2id

# 헬스 체크
@app.get("/health")
def health():
    try:
        test_path = os.path.join(OUTPUT_DIR, "test.wav")
        model.tts_to_file("테스트", speaker_ids["KR"], test_path, speed=1.0)
        if os.path.exists(test_path):
            os.remove(test_path)
        return JSONResponse({"status": "ok"})
    except Exception as e:
        logger.exception("[x] TTS health check failed")
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=503)

# 텍스트 → 음성 변환
from fastapi.responses import FileResponse

@app.post("/tts")
async def generate(request: Request):
    try:
        data = await request.json()
        text = data.get("text", "").strip()
        speed = float(data.get("speed", 1.0))
        speed = max(0.5, min(speed, 2.0))

        if not text:
            return JSONResponse({"error": "text is missing or empty"}, status_code=400)

        uid = str(uuid.uuid4())
        output_path = os.path.join(OUTPUT_DIR, f"{uid}.wav")

        logger.info(f"TTS 생성 요청 - 텍스트: '{text}' → 파일: {output_path}")
        await run_in_threadpool(model.tts_to_file, text, speaker_ids["KR"], output_path, speed)

        # 여기서 바로 음성파일 반환
        return FileResponse(
            output_path,
            media_type="audio/wav",
            filename=f"{uid}.wav"
        )

    except Exception as e:
        logger.exception("[x] TTS 생성 중 오류")
        return JSONResponse({"error": "TTS generation failed", "detail": str(e)}, status_code=500)

# 음성 파일 제공
@app.get("/audio/{filename}")
async def get_audio(filename: str):
    path = os.path.join(OUTPUT_DIR, filename)

    if not os.path.exists(path):
        logger.warning(f"파일 없음: {filename}")
        return JSONResponse({"error": "file not found"}, status_code=404)

    logger.info(f"WAV 파일 전송: {filename}")
    return FileResponse(path, media_type="audio/wav")
