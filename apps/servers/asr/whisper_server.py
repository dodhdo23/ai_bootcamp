from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
import torch
import torchaudio
from transformers import WhisperForConditionalGeneration, WhisperProcessor
from io import BytesIO
import logging

import subprocess

def convert_to_wav(audio_bytes: bytes) -> bytes:
    p = subprocess.Popen(
        ["ffmpeg", "-y",
         "-i", "pipe:0",
         "-ar", "16000",
         "-ac", "1",
         "-f", "wav",
         "pipe:1"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    out, _ = p.communicate(audio_bytes)
    return out
# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI()
MODEL_DIR = "/data/bootcamp/final_project/asr_finetune/outputs/whisper-finetuned-ko-star-v1"
processor = WhisperProcessor.from_pretrained(MODEL_DIR)
model = WhisperForConditionalGeneration.from_pretrained(MODEL_DIR).to("cuda" if torch.cuda.is_available() else "cpu")
logger.info("Whisper 모델 로딩 완료")

@app.get("/health")
def health():
    try:
        dummy = torch.zeros(1, 80, 3000).to(model.device)
        _ = model.generate(dummy, max_new_tokens=1)
        return JSONResponse({"status": "ok"})
    except Exception as e:
        logger.error("[x] STT health check failed", exc_info=e)
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=503)

@app.post("/stt")
async def transcribe(file: UploadFile = File(...)):
    audio_bytes = await file.read()

    # 1) 모든 입력 포맷 → WAV(16k, mono) 로 변환
    try:
        wav_bytes = convert_to_wav(audio_bytes)
    except Exception as e:
        logger.exception("[x] ffmpeg 변환 실패")
        return JSONResponse({"error": "Audio conversion failed", "detail": str(e)}, status_code=400)

    # 2) 변환된 WAV 바이트를 torchaudio 로드
    try:
        waveform, sampling_rate = torchaudio.load(BytesIO(wav_bytes))
    except Exception as e:
        logger.exception("[x] torchaudio.load 실패")
        return JSONResponse({"error": "Invalid audio format after conversion", "detail": str(e)}, status_code=400)


    if waveform.shape[0] > 1:
        logger.info("멀티채널 입력 감지 → 모노 변환")
        waveform = torch.mean(waveform, dim=0, keepdim=True)

    if sampling_rate != 16000:
        logger.info(f"샘플레이트 변환: {sampling_rate}Hz → 16000Hz")
        resampler = torchaudio.transforms.Resample(orig_freq=sampling_rate, new_freq=16000)
        waveform = resampler(waveform)

    input_features = processor(
        waveform.squeeze(),
        sampling_rate=16000,
        return_tensors="pt"
    ).input_features.to(model.device)

    predicted_ids = model.generate(input_features)
    transcription = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]

    logger.info(f"인식 결과: {transcription}")
    return JSONResponse({"text": transcription})

