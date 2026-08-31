#!/usr/bin/env bash
set -e
export PYTHONUNBUFFERED=1

# =========================================================================
#  DGX vLLM Qwen3.8-27B Server Startup & Healthcheck Manager
# =========================================================================

DGX_HOST="${DGX_HOST:-Nvidiadgx}"
DGX_IP="${DGX_IP:-10.169.20.183}"
DGX_PORT="${DGX_PORT:-8080}"
MODEL_PATH="${MODEL_PATH:-/home/root-ziq/Qwen3.8-27B-FP8}"
SERVED_MODEL_NAME="${SERVED_MODEL_NAME:-qwen3.8-27b}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-131072}"
GPU_MEM_UTIL="${GPU_MEM_UTIL:-0.50}"
MAX_NUM_SEQS="${MAX_NUM_SEQS:-2}"

echo "========================================================================="
echo "   CHECKING DGX vLLM MODEL SERVER ($DGX_IP:$DGX_PORT)   "
echo "========================================================================="

if curl -s -f "http://$DGX_IP:$DGX_PORT/v1/models" > /dev/null 2>&1; then
  echo "[+] DGX vLLM server is already running and responding at http://$DGX_IP:$DGX_PORT/v1"
  curl -s "http://$DGX_IP:$DGX_PORT/v1/models" | jq . 2>/dev/null || curl -s "http://$DGX_IP:$DGX_PORT/v1/models"
  exit 0
fi

echo "[*] DGX vLLM server is not responding. Starting background server on $DGX_HOST..."
ssh "$DGX_HOST" "export PATH=\"/home/root-ziq/vllm-env/bin:/home/root-ziq/.local/bin:\$PATH\" && \
  export VLLM_USE_DEEP_GEMM=0 && \
  nohup /home/root-ziq/vllm-env/bin/vllm serve $MODEL_PATH \
    --host 0.0.0.0 \
    --port $DGX_PORT \
    --served-model-name $SERVED_MODEL_NAME \
    --max-model-len $MAX_MODEL_LEN \
    --max-num-seqs $MAX_NUM_SEQS \
    --trust-remote-code \
    --enable-auto-tool-choice \
    --tool-call-parser qwen3_xml \
    --gpu-memory-utilization $GPU_MEM_UTIL > /home/root-ziq/vllm_server.log 2>&1 < /dev/null & sleep 1"

echo "[*] Waiting for vLLM model server to initialize weights on GB10 GPU..."
MAX_RETRIES=60
RETRY_COUNT=0
until curl -s -f "http://$DGX_IP:$DGX_PORT/v1/models" > /dev/null 2>&1; do
  sleep 5
  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "    ... waiting for vLLM startup ($((RETRY_COUNT * 5))s / 300s)"
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "[-] Timeout waiting for vLLM server on DGX. Tail of server log:"
    ssh "$DGX_HOST" "tail -n 30 /home/root-ziq/vllm_server.log" 2>/dev/null || true
    exit 1
  fi
done

echo "[+] DGX vLLM server ($SERVED_MODEL_NAME) is online and healthy at http://$DGX_IP:$DGX_PORT/v1 !"
