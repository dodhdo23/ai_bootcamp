conda activate llm-server
CUDA_VISIBLE_DEVICES=1 uvicorn llm1:app --host 0.0.0.0 --port 9100 --reload --log-level debug
