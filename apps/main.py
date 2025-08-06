from fastapi import FastAPI, WebSocket, UploadFile, File, Request
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.concurrency import run_in_threadpool

import uuid
import shutil
import os
import requests
import asyncio

app = FastAPI()

# =======================
# CORS 설정
# =======================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# =======================
# 경로 설정
# =======================
UPLOAD_DIR = "/tmp/audio_kiosk"
TTS_SERVER_URL = "http://localhost:9200"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# =======================
# Health Check
# =======================
@app.get("/health")
def health_check():
    results = {}
    try:
        r = requests.get("http://localhost:9005/health")
        results["stt"] = r.status_code == 200
    except:
        results["stt"] = False

    try:
        r = requests.get("http://localhost:9101/health")
        results["llm"] = r.status_code == 200
    except:
        results["llm"] = False

    try:
        r = requests.get("http://localhost:9200/health")
        results["tts"] = r.status_code == 200
    except:
        results["tts"] = False

    return JSONResponse(content=results)

# =======================
# TTS 안내멘트 전용 (시작 버튼용)
# =======================
@app.post("/speak")
async def speak(request: Request):
    data = await request.json()
    text = data.get("text", "")
    if not text:
        return {"error": "No text provided"}

    try:
        tts_filename = run_tts(text)
        return {"audio_path": tts_filename}
    except Exception as e:
        return {"error": str(e)}

# =======================
# 내부 처리 함수들
# =======================
def run_stt(audio_path: str):
    with open(audio_path, "rb") as f:
        response = requests.post("http://localhost:9005/stt", files={"file": f})
    return response.json()["text"]

def run_bllossom_llm(user_text: str):
    response = requests.post("http://localhost:9101/llm", json={"text": user_text})
    return response.json()["text"]

def run_tts(text: str) -> str:
    response = requests.post(f"{TTS_SERVER_URL}/tts", json={"text": text, "speed": 1.0})
    if response.status_code != 200:
        raise RuntimeError("TTS 서버 오류")
    return response.json()["audio_path"]

# =======================
# 오디오 업로드
# =======================
@app.post("/upload-audio/")
async def upload_audio(file: UploadFile = File(...)):
    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_DIR, f"{file_id}.wav")
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {"file_id": file_id}

# =======================
# 생성된 TTS 음성 반환
# =======================
@app.get("/ttsaudio/{filename}")
def run_tts_audio(filename: str):
    response = requests.get(f"{TTS_SERVER_URL}/audio/{filename}")
    return Response(content=response.content, media_type="audio/wav")

# =======================
# WebSocket 상호작용
# =======================
@app.websocket("/ws/kiosk")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    # 초기화 메시지
    for stage in ["status", "stt", "llm", "tts"]:
        await websocket.send_json({"stage": stage, "text": ""} if stage != "tts" else {"stage": stage, "audio_url": ""})

    try:
        while True:
            data = await websocket.receive_json()
            file_id = data.get("file_id")
            audio_path = os.path.join(UPLOAD_DIR, f"{file_id}.wav")

            await websocket.send_json({"stage": "status", "text": "음성 인식 중..."})
            stt_text = await run_in_threadpool(run_stt, audio_path)
            await websocket.send_json({"stage": "stt", "text": stt_text})

            await websocket.send_json({"stage": "status", "text": "응답 생성 중..."})
            llm_response = await run_in_threadpool(run_bllossom_llm, stt_text)
            await websocket.send_json({"stage": "llm", "text": llm_response})

            await websocket.send_json({"stage": "status", "text": "음성 생성 중..."})
            tts_filename = await run_in_threadpool(run_tts, llm_response)
            audio_url = f"/ttsaudio/{tts_filename}"
            await websocket.send_json({"stage": "tts", "audio_url": audio_url})

            await websocket.send_json({"stage": "status", "text": "처리 완료"})

    except Exception as e:
        print(f"WebSocket error: {e}")
        await websocket.send_json({"stage": "error", "text": str(e)})
        await websocket.close()

# =======================
# 정적 파일 제공 (index.html 포함)
# =======================
app.mount("/", StaticFiles(directory="static", html=True), name="static")
