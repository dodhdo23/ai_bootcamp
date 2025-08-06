from fastapi import FastAPI, WebSocket, UploadFile, File, Request
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.concurrency import run_in_threadpool
import uuid
import shutil
import os
import requests
import json

app = FastAPI()

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "/tmp/audio_kiosk"
TTS_SERVER_URL = "http://localhost:9200"
STT_SERVER_URL = "http://localhost:9000"
LLM_SERVER_URL = "http://localhost:9100"

os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.get("/health")
def health_check():
    results = {}
    try:
        r = requests.get(f"{STT_SERVER_URL}/health", timeout=2)
        results["stt"] = r.status_code == 200
    except:
        results["stt"] = False
    
    try:
        r = requests.get(f"{LLM_SERVER_URL}/health", timeout=2)
        results["llm"] = r.status_code == 200
    except:
        results["llm"] = False
    
    try:
        r = requests.get(f"{TTS_SERVER_URL}/health", timeout=2)
        results["tts"] = r.status_code == 200
    except:
        results["tts"] = False
    
    return JSONResponse(content=results)

# STT 호출
def run_stt(audio_path: str):
    try:
        with open(audio_path, "rb") as f:
            response = requests.post(f"{STT_SERVER_URL}/stt", files={"file": f}, timeout=30)
        if response.status_code == 200:
            return response.json()["text"]
        else:
            raise RuntimeError(f"STT 서버 오류: {response.status_code}")
    except Exception as e:
        print(f"STT 오류: {e}")
        raise

# LLM 호출
def run_bllossom_llm(user_text: str, message_type: str = "general"):
    try:
        payload = {
            "text": user_text,
            "type": message_type
        }
        response = requests.post(f"{LLM_SERVER_URL}/llm", json=payload, timeout=30)
        if response.status_code == 200:
            return response.json()["text"]
        else:
            raise RuntimeError(f"LLM 서버 오류: {response.status_code}")
    except Exception as e:
        print(f"LLM 오류: {e}")
        raise

# TTS 호출
def run_tts(text: str) -> str:
    try:
        response = requests.post(f"{TTS_SERVER_URL}/tts", json={"text": text, "speed": 1.0}, timeout=30)
        if response.status_code == 200:
            return response.json()["audio_path"]
        else:
            raise RuntimeError(f"TTS 서버 오류: {response.status_code}")
    except Exception as e:
        print(f"TTS 오류: {e}")
        raise

# 사용자 음성 업로드
@app.post("/upload-audio/")
async def upload_audio(file: UploadFile = File(...)):
    try:
        file_id = str(uuid.uuid4())
        file_path = os.path.join(UPLOAD_DIR, f"{file_id}.wav")
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        return {"file_id": file_id, "message": "File uploaded successfully"}
    except Exception as e:
        print(f"파일 업로드 오류: {e}")
        return JSONResponse(content={"error": "File upload failed"}, status_code=500)

# TTS 음성 직접 생성 (프론트엔드 /api/speak 용)
@app.post("/speak")
async def speak_text(request: Request):
    try:
        body = await request.json()
        text = body.get("text", "")
        
        if not text:
            return JSONResponse(content={"error": "No text provided"}, status_code=400)
        
        audio_path = await run_in_threadpool(run_tts, text)
        return {"audio_path": audio_path, "message": "TTS generated successfully"}
    except Exception as e:
        print(f"TTS 생성 오류: {e}")
        return JSONResponse(content={"error": "TTS generation failed"}, status_code=500)

# 생성된 TTS 음성 반환 (브라우저에서 직접 접근용)
@app.get("/ttsaudio/{filename}")
def get_tts_audio(filename: str):
    try:
        response = requests.get(f"{TTS_SERVER_URL}/audio/{filename}", timeout=10)
        if response.status_code == 200:
            return Response(content=response.content, media_type="audio/wav")
        else:
            return JSONResponse(content={"error": "Audio file not found"}, status_code=404)
    except Exception as e:
        print(f"TTS 오디오 가져오기 오류: {e}")
        return JSONResponse(content={"error": "Failed to fetch audio"}, status_code=500)

# WebSocket 상호작용
@app.websocket("/ws/kiosk")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    try:
        while True:
            data = await websocket.receive_json()
            
            # 파일 ID로 STT 처리
            if "file_id" in data:
                file_id = data["file_id"]
                audio_path = os.path.join(UPLOAD_DIR, f"{file_id}.wav")
                
                if not os.path.exists(audio_path):
                    await websocket.send_json({"stage": "error", "text": "Audio file not found"})
                    continue
                
                try:
                    # STT 처리
                    await websocket.send_json({"stage": "status", "text": "음성 인식 중..."})
                    stt_text = await run_in_threadpool(run_stt, audio_path)
                    await websocket.send_json({"stage": "stt", "text": stt_text})
                    
                    # 파일 정리
                    os.remove(audio_path)
                    
                except Exception as e:
                    print(f"STT 처리 오류: {e}")
                    await websocket.send_json({"stage": "error", "text": "STT processing failed"})
            
            # 텍스트와 타입으로 LLM 처리
            elif "text" in data:
                user_text = data["text"]
                message_type = data.get("type", "general")
                
                try:
                    # LLM 처리
                    await websocket.send_json({"stage": "status", "text": "응답 생성 중..."})
                    llm_response = await run_in_threadpool(run_bllossom_llm, user_text, message_type)
                    await websocket.send_json({"stage": "llm", "text": llm_response})
                    
                except Exception as e:
                    print(f"LLM 처리 오류: {e}")
                    await websocket.send_json({"stage": "error", "text": "LLM processing failed"})
            
    except Exception as e:
        print(f"WebSocket error: {e}")
        await websocket.close()

# 정적 파일 서빙 (프론트엔드)
FRONTEND_BUILD_DIR = os.path.abspath("../frontend/hospital-kiosk/out")

if os.path.exists(FRONTEND_BUILD_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_BUILD_DIR, html=True), name="static")
    print(f"✅ 프론트엔드 정적 파일 서빙: {FRONTEND_BUILD_DIR}")
else:
    print(f"❌ 빌드된 프론트엔드 정적 파일이 존재하지 않습니다: {FRONTEND_BUILD_DIR}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
