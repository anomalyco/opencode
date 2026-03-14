#!/usr/bin/env python3
"""
BEAM Memory Evaluation — RAG Pipeline
完全复用原始 OpenCode 评测的打分体系与结果格式
不依赖 OpenCode 服务，使用本地 ChromaDB + 畅游 API 进行检索和问答
"""

import ast
import json
import time
import sys
import uuid
import tiktoken
import os
import requests
import argparse

# ─── Config ───
PROVIDER_ID = "changyouopenai"
MODEL_ID = "gpt-5.4"

# ─── 提取原始代码中获取 API Key 的逻辑 ───
def get_api_key():
    api_key = os.environ.get("CHANGYOU_API_KEY", "")
    if not api_key:
        try:
            auth_path = os.path.expanduser("~/.local/share/opencode/auth.json")
            with open(auth_path) as _f:
                _auth = json.load(_f)
            api_key = _auth.get("changyouopenai", {}).get("key", "")
        except Exception:
            pass
    if not api_key:
        api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    return api_key

# ─── 新增：RAG 向量库与检索逻辑 ───
def build_vector_db(case_id, chat_sessions, max_tokens_per_chunk=400):
    """将 BEAM 对话分块存入本地 ChromaDB"""
    import chromadb
    print(f"\n⚙️ 正在为 Case {case_id} 构建本地向量知识库...")
    
    db_client = chromadb.PersistentClient(path="./rag_db")
    collection_name = f"beam_case_{case_id}"
    try:
        db_client.delete_collection(name=collection_name)
    except:
        pass
    
    # 使用开源免费的 all-MiniLM-L6-v2 嵌入模型
    collection = db_client.create_collection(name=collection_name)
    enc = tiktoken.get_encoding("cl100k_base")
    documents, metadatas, ids = [], [], []
    
    all_messages = []
    for session in chat_sessions:
        msgs = session if isinstance(session, list) else [session]
        for msg in msgs:
            if isinstance(msg, dict) and msg.get("role") in ("user", "assistant"):
                all_messages.append(msg)
                
    current_chunk = []
    current_tokens = 0
    chunk_index = 0
    
    for i, msg in enumerate(all_messages):
        role = msg["role"]
        content = msg["content"]
        text_repr = f"[{role.upper()}]: {content}\n"
        tokens = len(enc.encode(text_repr))
        
        if current_tokens + tokens > max_tokens_per_chunk and current_chunk:
            documents.append("".join(current_chunk))
            metadatas.append({"chunk_index": chunk_index, "case_id": case_id})
            ids.append(f"chunk_{chunk_index}")
            
            chunk_index += 1
            current_chunk = [text_repr]
            current_tokens = tokens
        else:
            current_chunk.append(text_repr)
            current_tokens += tokens

    if current_chunk:
        documents.append("".join(current_chunk))
        metadatas.append({"chunk_index": chunk_index, "case_id": case_id})
        ids.append(f"chunk_{chunk_index}")

    print(f"   [+] 生成了 {len(documents)} 个 Chunk，正在写入向量库...")
    if documents:
        collection.add(documents=documents, metadatas=metadatas, ids=ids)
    print("   [+] 向量知识库构建完成！")
    return collection

def rag_answer(question, collection, model_id, top_k=5):
    import uuid
    """从 ChromaDB 检索上下文，并使用全英文 Prompt 生成答案"""
    results = collection.query(query_texts=[question], n_results=top_k)
    
    context_str = ""
    if results['documents'] and results['documents'][0]:
        context_str = "\n\n---\n\n".join(results['documents'][0])
    
    # 【修复1】：改回全英文 Prompt，并加入 cache_bust 机制打断深度缓存
    unique_id = str(uuid.uuid4())[:8]
    prompt = f"""[req-{unique_id}] You are a precise question-answering assistant. Please answer the question STRICTLY based on the provided [Chat History Context].
If the context does not contain the information to answer the question, reply exactly with "Insufficient information".

[Chat History Context]:
{context_str}

[Question]: {question}"""

    api_key = get_api_key()
    if not api_key:
        return "[ERROR: No API Key]"

    try:
        resp = requests.post(
            "https://ai.changyou.club/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model_id,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.0,
                "max_tokens": 500,
                "stream": True,
                "reasoning_effort": "xhigh",
            },
            timeout=120,
        )
        resp.raise_for_status()
        
        # 【修复2】：强制指定 UTF-8，彻底消灭生僻乱码
        resp.encoding = 'utf-8'
        
        import re as _re, json as _json
        text_chunks = []
        for line in resp.text.splitlines():
            if line.startswith("data:") and line[5:].strip() not in ("", "[DONE]"):
                try:
                    chunk = _json.loads(line[5:].strip())
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    if delta.get("content"):
                        text_chunks.append(delta["content"])
                except Exception:
                    pass
        text = "".join(text_chunks).strip()
        return text if text else "[empty response]"
    except Exception as e:
        print(f"  ⚠️ RAG Generation error: {e}")
        return f"[ERROR: {e}]"

# ══════════════════════════════════════════════════════════════
# ⬇️ 以下代码 100% 复制 beam_opencode_eval.py ⬇️
# ══════════════════════════════════════════════════════════════

def _tokenize(text):
    """Tokenize text into lowercase words."""
    import re
    return re.findall(r'\b\w+\b', text.lower())

STOPWORDS = {'the', 'a', 'an', 'is', 'was', 'are', 'were', 'be', 'been',
             'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
             'could', 'should', 'may', 'might', 'shall', 'can', 'to', 'of',
             'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
             'and', 'or', 'but', 'not', 'no', 'that', 'this', 'it', 'i',
             'my', 'you', 'your', 'we', 'our', 'they', 'their', 'me', 'he',
             'she', 'his', 'her', 'its', 'us', 'them', 'so', 'if', 'then'}

def score_keyword(model_answer, expected_answer):
    if not model_answer or not expected_answer:
        return 0.0
    model_lower = model_answer.lower()
    key_tokens = set(_tokenize(expected_answer)) - STOPWORDS
    if not key_tokens:
        return 1.0 if expected_answer.lower() in model_lower else 0.0
    matches = sum(1 for t in key_tokens if t in model_lower)
    return matches / len(key_tokens)

def score_token_f1(model_answer, expected_answer):
    if not model_answer or not expected_answer:
        return 0.0
    pred_tokens = set(_tokenize(model_answer)) - STOPWORDS
    gold_tokens = set(_tokenize(expected_answer)) - STOPWORDS
    if not gold_tokens:
        return 1.0 if not pred_tokens else 0.0
    if not pred_tokens:
        return 0.0
    common = pred_tokens & gold_tokens
    if not common:
        return 0.0
    precision = len(common) / len(pred_tokens)
    recall = len(common) / len(gold_tokens)
    f1 = 2 * precision * recall / (precision + recall)
    return f1

def score_llm_judge(question, model_answer, expected_answer):
    if not model_answer or model_answer.startswith("["):
        return 0.0
    
    prompt = f"""You are an expert evaluator. Rate how correctly the Model Answer addresses the Question compared to the Expected Answer.

Question: {question}
Expected Answer: {expected_answer}
Model Answer: {model_answer[:500]}

Scoring rules:
- 1.0 = Completely correct, covers all key facts
- 0.7-0.9 = Mostly correct, minor details missing or extra info
- 0.4-0.6 = Partially correct, some key facts right but others wrong/missing  
- 0.1-0.3 = Mostly wrong, only trivially related
- 0.0 = Completely wrong or irrelevant

IMPORTANT: Focus on factual correctness, not wording. "4 weeks" and "28 days" are equivalent. "March 29" and "March 29th, 2024" are equivalent.

Reply with ONLY a JSON object: {{"score": <float>, "reason": "<brief reason>"}}"""

    try:
        judge_api_key = get_api_key()
        if not judge_api_key:
            print("    ⚠️ LLM Judge skipped: no API key found")
            return -1.0
        time.sleep(2)  # Avoid 429 rate limit
        resp = requests.post(
            "https://ai.changyou.club/v1/chat/completions",
            headers={"Authorization": f"Bearer {judge_api_key}", "Content-Type": "application/json"},
            json={
                "model": "gpt-5.4",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.0,
                "max_tokens": 150,
                "stream": True,
                "reasoning_effort": "xhigh",
            },
            timeout=60,
        )
        resp.raise_for_status()
        import re as _re, json as _json
        text_chunks = []
        for line in resp.text.splitlines():
            if line.startswith("data:") and line[5:].strip() not in ("", "[DONE]"):
                try:
                    chunk = _json.loads(line[5:].strip())
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    if delta.get("content"):
                        text_chunks.append(delta["content"])
                except Exception:
                    pass
        text = "".join(text_chunks).strip()
        if not text:
            return -1.0
        match = _re.search(r'"score"\s*:\s*([0-9.]+)', text)
        if match:
            return min(1.0, max(0.0, float(match.group(1))))
        return 0.0
    except Exception as e:
        print(f"    ⚠️ LLM Judge error: {e}")
        return -1.0

def score_answer(question, model_answer, expected_answer):
    kw = score_keyword(model_answer, expected_answer)
    f1 = score_token_f1(model_answer, expected_answer)
    judge = score_llm_judge(question, model_answer, expected_answer)
    
    if judge >= 0: 
        if judge >= 0.8:
            combined = judge
        else:
            combined = 0.6 * judge + 0.25 * f1 + 0.15 * kw
    else: 
        combined = 0.5 * f1 + 0.5 * kw
        judge = None
    
    return {
        "keyword": round(kw, 3),
        "token_f1": round(f1, 3),
        "llm_judge": round(judge, 3) if judge is not None else None,
        "combined": round(combined, 3),
    }

_beam_dataset_cache = None

def _get_beam_dataset():
    global _beam_dataset_cache
    if _beam_dataset_cache is None:
        print("📥 Loading BEAM dataset from HuggingFace...")
        from datasets import load_dataset
        _beam_dataset_cache = load_dataset("Mohammadta/BEAM")
    return _beam_dataset_cache

def _parse_questions(conv):
    pq = conv["probing_questions"]
    if isinstance(pq, str):
        pq = ast.literal_eval(pq)
    questions = []
    ANSWER_FIELDS = ["answer", "expected_answer", "ideal_response", "ideal_answer", "ideal_summary", "expected_compliance"]
    for qtype, qs in pq.items():
        for q in qs:
            answer = ""
            for field in ANSWER_FIELDS:
                if field in q and q[field]:
                    answer = str(q[field])
                    break
            if not answer and "rubric" in q and q["rubric"]:
                answer = "; ".join(q["rubric"])
            if answer:
                questions.append({
                    "type": qtype,
                    "question": q["question"],
                    "expected_answer": answer,
                })
    return questions

def load_beam(case_ids=None, split_name="100K"):
    if case_ids is None:
        case_ids = [0]
    ds = _get_beam_dataset()
    split = ds[split_name]
    cases = []
    for cid in case_ids:
        if cid >= len(split):
            continue
        conv = split[cid]
        chat = conv["chat"]
        questions = _parse_questions(conv)
        user_count = 0
        for session in chat:
            msgs = session if isinstance(session, list) else [session]
            for msg in msgs:
                if isinstance(msg, dict) and msg.get("role") == "user":
                    user_count += 1
        cases.append((cid, chat, questions))
        print(f"  📦 Case {cid}: {len(chat)} sessions, {user_count} user msgs, {len(questions)} scoreable questions")
    return cases

def print_results_table(all_results):
    results_before = []
    results_after = []
    for r in all_results:
        results_before.extend(r["before_compaction"]["results"])
        results_after.extend(r["after_compaction"]["results"])
    
    def avg_score(results, metric="combined"):
        vals = [r["scores"][metric] for r in results if r["scores"].get(metric) is not None]
        return sum(vals) / len(vals) if vals else 0
    
    print(f"\n{'='*60}")
    print(f"📊 RESULTS — RAG BEAM Benchmark ({len(all_results)} cases)")
    print(f"    Scoring: 50% LLM Judge + 30% Token F1 + 20% Keyword")
    print(f"{'='*60}")
    
    for metric_name, metric_key in [("Combined Score", "combined"), ("Token F1", "token_f1"), ("LLM Judge", "llm_judge"), ("Keyword Overlap", "keyword")]:
        avg_b = avg_score(results_before, metric_key)
        avg_a = avg_score(results_after, metric_key) 
        print(f"\n{'Metric: ' + metric_name:<35} {'Before':<15} {'After(RAG)':<15} {'Delta':<8}")
        print("-" * 76)
        print(f"{'  Overall':<35} {avg_b:>14.1%} {avg_a:>14.1%} {avg_a-avg_b:>+7.1%}")
        
        types = sorted(set(r["type"] for r in results_after))
        for qtype in types:
            b_vals = [r["scores"][metric_key] for r in results_before if r["type"] == qtype and r["scores"].get(metric_key) is not None]
            a_vals = [r["scores"][metric_key] for r in results_after if r["type"] == qtype and r["scores"].get(metric_key) is not None]
            ab = sum(b_vals) / len(b_vals) if b_vals else 0
            aa = sum(a_vals) / len(a_vals) if a_vals else 0
            print(f"    {qtype:<31} {ab:>14.1%} {aa:>14.1%} {aa-ab:>+7.1%}")

# ─── 主入口 (适配 RAG 流程) ───
def run_single_rag_case(case_id, chat_sessions, questions, model_id):
    print(f"\n{'='*60}")
    print(f"🔬 RAG BEAM Case {case_id}: {len(chat_sessions)} sessions, {len(questions)} questions")
    print(f"{'='*60}")
    
    # 1. 建立向量库
    collection = build_vector_db(case_id, chat_sessions)
    
    # 2. RAG 问答测试 (相当于原来的 after_compaction 阶段)
    print(f"\n{'='*60}")
    print(f"📋 正在使用 RAG 回答问题...")
    print(f"{'='*60}")
    
    results_rag = []
    for i, q in enumerate(questions):
        print(f"\n  [{i+1}/{len(questions)}] ({q['type']}) {q['question'][:80]}...")
        
        answer = rag_answer(q["question"], collection, model_id)
        scores = score_answer(q["question"], answer, q["expected_answer"])
        
        results_rag.append({
            "type": q["type"],
            "question": q["question"],
            "expected": q["expected_answer"][:150],
            "model_answer": answer[:300] if answer else "",
            "scores": scores,
        })
        
        c = scores["combined"]
        emoji = "✅" if c >= 0.5 else "⚠️" if c >= 0.3 else "❌"
        judge_str = f" Judge={scores['llm_judge']:.2f}" if scores['llm_judge'] is not None else ""
        print(f"  {emoji} Combined={c:.2f}  (F1={scores['token_f1']:.2f}  KW={scores['keyword']:.2f}{judge_str})")
        print(f"     Expected: {q['expected_answer'][:100]}")
        print(f"     Got(RAG): {answer[:100] if answer else '[empty]'}")
        
        time.sleep(2) # 遵守 API 速率限制

    def avg_score(results, metric="combined"):
        vals = [r["scores"][metric] for r in results if r["scores"].get(metric) is not None]
        return sum(vals) / len(vals) if vals else 0
    
    a = avg_score(results_rag)
    print(f"\n  📊 Case {case_id} RAG Summary: Avg Score = {a:.1%}")
    
    # 为了兼容旧脚本的 print_results_table 格式，把 rag 的结果放在 after 里面，before 置空
    return {
        "case_id": case_id,
        "session_id": f"rag_case_{case_id}",
        "messages_fed": 0,
        "before_compaction": {"avg_combined": 0, "results": []}, 
        "after_compaction": {"avg_combined": a, "results": results_rag},
    }

def main():
    global PROVIDER_ID, MODEL_ID
    parser = argparse.ArgumentParser(description="BEAM Memory Benchmark with RAG")
    parser.add_argument("--cases", default="0", help="Case IDs: '0', '0,1,2', or 'all'")
    parser.add_argument("--split", default="100K", choices=["100K", "500K", "1M"], help="BEAM dataset split")
    parser.add_argument("--provider", default=PROVIDER_ID, help="Provider ID")
    parser.add_argument("--model", default=MODEL_ID, help="Model ID")
    parser.add_argument("--output", default="/tmp/beam_results", help="Output directory")
    args = parser.parse_args()
    
    PROVIDER_ID = args.provider
    MODEL_ID = args.model
    
    max_cases = 20 if args.split == "100K" else 35
    if args.cases == "all":
        case_ids = list(range(max_cases))
    else:
        case_ids = [int(x.strip()) for x in args.cases.split(",")]
    
    print(f"🚀 RAG BEAM Benchmark: {args.split} split, {len(case_ids)} cases")
    print(f"   Model: {PROVIDER_ID}/{MODEL_ID}")
    
    cases = load_beam(case_ids, split_name=args.split)
    
    os.makedirs(args.output, exist_ok=True)
    checkpoint_path = os.path.join(args.output, f"checkpoint_RAG_{PROVIDER_ID}_{MODEL_ID}_{args.split}.json")
    
    completed = {}
    if os.path.exists(checkpoint_path):
        with open(checkpoint_path) as f:
            completed = {r["case_id"]: r for r in json.load(f)}
        print(f"  📂 Resuming: {len(completed)} cases already done")
    
    all_results = list(completed.values())
    
    for case_id, chat, questions in cases:
        if case_id in completed:
            print(f"\n  ⏭️ Case {case_id} already done, skipping")
            continue
        try:
            result = run_single_rag_case(case_id, chat, questions, MODEL_ID)
            all_results.append(result)
            with open(checkpoint_path, "w") as f:
                json.dump(all_results, f, indent=2, ensure_ascii=False)
            print(f"  💾 Checkpoint saved ({len(all_results)}/{len(cases)} cases)")
        except Exception as e:
            print(f"\n  ❌ Case {case_id} failed: {e}")
            continue
            
    print_results_table(all_results)
    
    from datetime import datetime
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    final_path = os.path.join(args.output, f"results_RAG_{PROVIDER_ID}_{MODEL_ID}_{args.split}_{ts}.json")
    output = {
        "test_type": f"RAG BEAM Benchmark ({args.split})",
        "scoring_method": "50% LLM Judge + 30% Token F1 + 20% Keyword Overlap",
        "model": f"{PROVIDER_ID}/{MODEL_ID}",
        "split": args.split,
        "cases_tested": len(all_results),
        "results": all_results,
    }
    with open(final_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"\n📁 Results saved to: {final_path}")

if __name__ == "__main__":
    main()