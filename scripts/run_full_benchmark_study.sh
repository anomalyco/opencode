#!/usr/bin/env bash
set -e
export PYTHONUNBUFFERED=1

# =========================================================================
#  COMPLETE DUAL-ARM SWE-BENCH BENCHMARK & COMPARATIVE SCORECARD PIPELINE
#  Sequence:
#    1. (Optional) Boot DGX vLLM Model Server & Verify Healthcheck
#    2. Arm A: Official Vanilla Upstream OpenCode (`bunx opencode-ai`)
#    3. Arm B: OpenCode-Evolve System (`~/.local/bin/opencode`)
#    4. Stage 3: Head-to-Head Scorecard & Pass@1 Delta Computation
# =========================================================================

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WORKSPACE_ROOT"

INSTANCES=(
  pallets__flask-4045
  pallets__flask-4992
  psf__requests-2674
  psf__requests-2148
  django__django-11099
  django__django-10914
  django__django-10924
  mwaskom__seaborn-2848
  mwaskom__seaborn-3010
  pallets__flask-5063
)

DGX_IP="${DGX_IP:-${DGX_HOST:-localhost}}"
DGX_PORT="8080"
MODEL="${1:-dgx/qwen3.8-27b}"
RUN_ID_VANILLA="vanilla-qwen-10"
RUN_ID_EVOLVE="evolve-qwen-10"

# -------------------------------------------------------------------------
# STEP 0: Check / Start vLLM Model Server on DGX (if using dgx model)
# -------------------------------------------------------------------------
if [[ "$MODEL" == dgx/* ]]; then
  echo "========================================================================="
  echo "   INFRASTRUCTURE: CHECKING DGX vLLM MODEL SERVER ($DGX_IP:$DGX_PORT)   "
  echo "========================================================================="

  if curl -s -f "http://$DGX_IP:$DGX_PORT/v1/models" > /dev/null 2>&1; then
    echo "[+] DGX vLLM server is already running and responding at http://$DGX_IP:$DGX_PORT/v1"
  else
    echo "[*] DGX vLLM server is not responding. Starting background server on DGX..."
    ssh Nvidiadgx "export PATH=\"/home/root-ziq/vllm-env/bin:/home/root-ziq/.local/bin:\$PATH\" && export VLLM_USE_DEEP_GEMM=0 && nohup /home/root-ziq/vllm-env/bin/vllm serve /home/root-ziq/Qwen3.8-27B-FP8 \
      --host 0.0.0.0 \
      --port $DGX_PORT \
      --served-model-name qwen3.8-27b \
      --max-model-len 131072 \
      --max-num-seqs 2 \
      --trust-remote-code \
      --enable-auto-tool-choice \
      --tool-call-parser qwen3_xml \
      --gpu-memory-utilization 0.50 > /home/root-ziq/vllm_server.log 2>&1 < /dev/null & sleep 1"

    echo "[*] Waiting for vLLM model server to initialize and load weights..."
    MAX_RETRIES=60
    RETRY_COUNT=0
    until curl -s -f "http://$DGX_IP:$DGX_PORT/v1/models" > /dev/null 2>&1; do
      sleep 5
      RETRY_COUNT=$((RETRY_COUNT + 1))
      echo "    ... waiting for vLLM startup ($((RETRY_COUNT * 5))s / 300s)"
      if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "[-] Timeout waiting for vLLM server on DGX. Check log: ssh Nvidiadgx 'cat /home/root-ziq/vllm_server.log'"
        exit 1
      fi
    done
    echo "[+] DGX vLLM server is online and healthy!"
  fi
fi

echo ""
echo "Using Model: $MODEL"

# -------------------------------------------------------------------------
# STEP 1: Execute Arm A (Vanilla OpenCode Baseline)
# -------------------------------------------------------------------------
echo "========================================================================="
echo "   STAGE 1/3: EXECUTING ARM A (OFFICIAL VANILLA OPENCODE BASELINE)        "
echo "========================================================================="
.swebench-venv/bin/python scripts/swebench_run_batch.py \
  --instances "${INSTANCES[@]}" \
  --model "$MODEL" \
  --workers 2 \
  --timeout 0 \
  --max-eval-workers 12 \
  --vanilla \
  --run-id "$RUN_ID_VANILLA"

echo ""
# -------------------------------------------------------------------------
# STEP 2: Execute Arm B (OpenCode-Evolve System)
# -------------------------------------------------------------------------
echo "========================================================================="
echo "   STAGE 2/3: EXECUTING ARM B (OPENCODE-EVOLVE HARNESS & SEMBLE)          "
echo "========================================================================="
.swebench-venv/bin/python scripts/swebench_run_batch.py \
  --instances "${INSTANCES[@]}" \
  --model "$MODEL" \
  --workers 2 \
  --timeout 0 \
  --max-eval-workers 12 \
  --run-id "$RUN_ID_EVOLVE"

echo ""
# -------------------------------------------------------------------------
# STEP 3: Compute Head-to-Head Comparative Study
# -------------------------------------------------------------------------
echo "========================================================================="
echo "   STAGE 3/3: COMPUTING HEAD-TO-HEAD COMPARISON & GENERATING REPORT      "
echo "========================================================================="

VANILLA_REPORT=$(find . -maxdepth 1 -name "*${RUN_ID_VANILLA}.json" | head -n 1)
EVOLVE_REPORT=$(find . -maxdepth 1 -name "*${RUN_ID_EVOLVE}.json" | head -n 1)

if [ -f "$VANILLA_REPORT" ] && [ -f "$EVOLVE_REPORT" ]; then
  python scripts/compare_swebench_results.py \
    --baseline "$VANILLA_REPORT" \
    --evolved "$EVOLVE_REPORT" | tee BENCHMARK_FINAL_SCORECARD.txt
  echo "✅ Complete comparative scorecard saved to: BENCHMARK_FINAL_SCORECARD.txt"
else
  echo "[-] Could not locate both JSON report files ($VANILLA_REPORT, $EVOLVE_REPORT)."
fi

echo "========================================================================="
echo "          🎉 COMPLETE DUAL-ARM BENCHMARK STUDY FINISHED!                 "
echo "========================================================================="
