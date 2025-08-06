🏥 AI 음성 키오스크 통합 시스템
이 프로젝트는 고령자 및 병원 환경에 최적화된 음성 기반 키오스크 시스템입니다.
음성 인식(STT), 자연어 응답(LLM), 음성 합성(TTS), 그리고 전체 흐름을 관리하는 메인 서버로 구성되어 있으며, 각각 독립 실행 가능한 FastAPI 서버로 구성됩니다.
'''
📦 전체 디렉토리 구조
apps/

├── envs/                  # 가상환경 폴더
│   ├── app-backend        # main.py 실행용
│   ├── whisper-server     # STT 서버용 (Whisper)
│   ├── llm-server         # LLM 서버용 (LLaMA)
│   └── tts-server         # TTS 서버용
│
├── servers/
│   ├── asr/               # STT 서버
│   │   └── whisper_server.py
│   ├── llm/               # LLM 서버
│   │   └── llm1.py
│   └── tts/               # TTS 서버
│       └── tts1.py
├── apps-v3/
│   └── backend/
│       └── main.py        # 전체 통합 실행 서버
'''
## 📁 프로젝트 구조

```plaintext
apps/
├── envs/
│   ├── app-backend
│   ├── whisper-server
│   ├── llm-server
│   └── tts-server
├── servers/
│   ├── asr/
│   │   └── whisper_server.py
│   ├── llm/
│   │   └── llm1.py
│   └── tts/
│       └── tts1.py
├── apps-v3/
│   ├── frontend/
│   │   └── hospital-kiosk/
│   └── backend/
│       └── main.py
└── text_normalization/

🧠 구성요소 및 포트 설정

구성	설명	파일명	포트	GPU 할당
STT	음성 → 텍스트 인식	whisper_server.py	9000	GPU 2
LLM	텍스트 → 자연어 응답 생성	llm1.py	9100	GPU 1
TTS	텍스트 → 음성 합성	tts1.py	9200	 GPU 3
APP	전체 통합 및 라우팅	main.py	

⚙️ 주요 기능 흐름
사용자가 실시간 음성 파일 업로드

STT 서버가 Whisper로 텍스트 변환

LLM 서버가 bllossom으로 자연어 응답 생성

TTS 서버가 Melo-tts로 음성으로 변환

메인 서버가 WebSocket으로 통합 처리

🚀 실행 방법
가상환경 활성화 및 실행
# STT (포트 9000)
conda activate whisper-server
CUDA_VISIBLE_DEVICES=2 python servers/asr/whisper_server.py

# LLM (포트 9100)
conda activate llm-server
CUDA_VISIBLE_DEVICES=1 python servers/llm/llm1.py

# TTS (포트 9200)
conda activate tts-server
CUDA_VISIBLE_DEVICES=3 python servers/tts/tts1.py

# Main 서버 (전체 통합)
conda activate app-backend
python apps-v3/backend/main.py
uvicorn main:app --host 0.0.0.0 --port 8000 --reload --log-level debug

🔌 API 및 WebSocket
STT 서버: /stt (POST, wav 파일 업로드)

TTS 서버: /speak (POST, 텍스트 → 음성 변환)

LLM 서버: /llm (POST, 텍스트 → 응답 생성)


메인 서버:

/upload-audio : 음성 파일 업로드 및 처리 시작

/ttsaudio/{filename} : 합성된 음성 반환

/ws/kiosk : WebSocket 기반 대화 흐름 처리

curl http://localhost:8000 # 통합 서버
curl http://localhost:9000 # STT 서버
curl http://localhost:9100  # LLM 서버
curl http://localhost:9200  # TTS 서버

🛠️ 주의 사항
모든 오디오 파일은 16kHz WAV 형식이어야 정상 동작합니다.

Whisper STT는 torchaudio.load() 기반으로 동작하므로 파일 포맷 오류 시 400 Bad Request가 발생할 수 있습니다.

WebSocket 서버는 프론트엔드와 실시간 통신을 위해 사용됩니다 (/ws/kiosk).

📁 apps-v3/frontend/hospital-kiosk/
병원 키오스크용 React 기반 웹 프론트엔드입니다.

📁 apps-v3/backend/
전체 시스템의 흐름을 조율하는 FastAPI 백엔드 메인 서버입니다.

🧹 텍스트 정규화 (text_normalization/)
Whisper STT 모델 훈련용 전처리 모듈입니다.
