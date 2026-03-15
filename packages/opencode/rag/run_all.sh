#!/bin/bash

# 定义公共参数
PROVIDER="openai"
MODEL="gpt-5.4"

echo "🚀 开始批量执行 10 个 RAG 评估任务..."

# ================= 方案 2 (Scheme 2) =================
echo "▶️ [1/10] 运行 方案2 | 500K | Case 2"
python3 beam_rag_eval_old2.py --split 500K --cases 2 --provider $PROVIDER --model $MODEL

echo "▶️ [2/10] 运行 方案2 | 500K | Case 4"
python3 beam_rag_eval_old2.py --split 500K --cases 4 --provider $PROVIDER --model $MODEL

echo "▶️ [3/10] 运行 方案2 | 1M | Case 0"
python3 beam_rag_eval_old2.py --split 1M --cases 0 --provider $PROVIDER --model $MODEL

echo "▶️ [4/10] 运行 方案2 | 1M | Case 2"
python3 beam_rag_eval_old2.py --split 1M --cases 2 --provider $PROVIDER --model $MODEL

echo "▶️ [5/10] 运行 方案2 | 1M | Case 3"
python3 beam_rag_eval_old2.py --split 1M --cases 3 --provider $PROVIDER --model $MODEL

# ================= 方案 4 (Scheme 4) =================
echo "▶️ [6/10] 运行 方案4 | 500K | Case 2"
python3 beam_rag_eval.py --split 500K --cases 2 --provider $PROVIDER --model $MODEL

echo "▶️ [7/10] 运行 方案4 | 500K | Case 4"
python3 beam_rag_eval.py --split 500K --cases 4 --provider $PROVIDER --model $MODEL

echo "▶️ [8/10] 运行 方案4 | 1M | Case 0"
python3 beam_rag_eval.py --split 1M --cases 0 --provider $PROVIDER --model $MODEL

echo "▶️ [9/10] 运行 方案4 | 1M | Case 2"
python3 beam_rag_eval.py --split 1M --cases 2 --provider $PROVIDER --model $MODEL

echo "▶️ [10/10] 运行 方案4 | 1M | Case 3"
python3 beam_rag_eval.py --split 1M --cases 3 --provider $PROVIDER --model $MODEL

echo "✅ 10 个任务全部执行完毕！结果保存在 /tmp/beam_results/ 目录下。"
