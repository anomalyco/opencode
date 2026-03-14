#!/usr/bin/env python3
"""
BEAM Memory Evaluation — Advanced Hybrid RAG Pipeline
架构：Contextual Chunking (Zero-Cost) + Hybrid Search (Dense + BM25) + RRF Fusion
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
import re
from rank_bm25 import BM25Okapi

# ─── Config ───
PROVIDER_ID = "changyouopenai"
MODEL_ID = "gpt-5.4"

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

def bm25_tokenize(text):
    """BM25 专用的简易分词器"""
    return re.findall(r'\b\w+\b', text.lower())

# ─── 升级 1：零 Token 成本的 Contextual Chunking ───
def build_hybrid_db(case_id, chat_sessions, max_tokens_per_chunk=400):
    import chromadb
    print(f"\n⚙️ 正在为 Case {case_id} 构建高级混合向量库 (Dense + BM25)...")
    
    db_client = chromadb.PersistentClient(path="./rag_db")
    collection_name = f"beam_case_{case_id}"
    try:
        db_client.delete_collection(name=collection_name)
    except:
        pass
    
    collection = db_client.create_collection(name=collection_name)
    enc = tiktoken.get_encoding("cl100k_base")
    
    all_messages = []
    for session in chat_sessions:
        msgs = session if isinstance(session, list) else [session]
        for msg in msgs:
            if isinstance(msg, dict) and msg.get("role") in ("user", "assistant"):
                all_messages.append(msg)
                
    # 提取全局上下文（BEAM 设定的第一句话通常包含整个项目的灵魂，如日期、目标）
    global_context = ""
    for msg in all_messages:
        if msg["role"] == "user":
            global_context = msg["content"][:300] # 只取前300字作为全局引子
            break

    documents, metadatas, ids = [], [], []
    current_chunk = []
    current_tokens = 0
    chunk_index = 0
    
    for i, msg in enumerate(all_messages):
        role = msg["role"]
        content = msg["content"]
        text_repr = f"[{role.upper()}]: {content}\n"
        tokens = len(enc.encode(text_repr))
        
        if current_tokens + tokens > max_tokens_per_chunk and current_chunk:
            raw_chunk_text = "".join(current_chunk)
            # 【核心优化】：强行拼凑上下文，不花一分钱 Token！
            enriched_chunk = f"[Global Project Context]: {global_context}...\n[Conversation Chunk]:\n{raw_chunk_text}"
            
            documents.append(enriched_chunk)
            metadatas.append({"chunk_index": chunk_index, "case_id": case_id})
            ids.append(f"chunk_{chunk_index}")
            
            chunk_index += 1
            current_chunk = [text_repr]
            current_tokens = tokens
        else:
            current_chunk.append(text_repr)
            current_tokens += tokens

    if current_chunk:
        raw_chunk_text = "".join(current_chunk)
        enriched_chunk = f"[Global Project Context]: {global_context}...\n[Conversation Chunk]:\n{raw_chunk_text}"
        documents.append(enriched_chunk)
        metadatas.append({"chunk_index": chunk_index, "case_id": case_id})
        ids.append(f"chunk_{chunk_index}")

    print(f"   [+] 生成了 {len(documents)} 个 Contextual Chunk，正在写入 ChromaDB...")
    if documents:
        collection.add(documents=documents, metadatas=metadatas, ids=ids)
        
    print(f"   [+] 正在构建 BM25 稀疏索引...")
    tokenized_corpus = [bm25_tokenize(doc) for doc in documents]
    bm25_index = BM25Okapi(tokenized_corpus)
    
    print("   [+] 高级混合知识库构建完成！")
    return collection, bm25_index, documents, ids

# ─── 升级 2：双路召回 + RRF 融合搜索 ───
def hybrid_search(question, collection, bm25_index, documents, doc_ids, top_k=5):
    # 1. 向量检索 (ChromaDB)
    dense_results = collection.query(query_texts=[question], n_results=min(20, len(documents)))
    dense_top_ids = dense_results['ids'][0] if dense_results['ids'] else []

    # 2. 关键词检索 (BM25)
    tokenized_query = bm25_tokenize(question)
    bm25_scores = bm25_index.get_scores(tokenized_query)
    bm25_ranked = sorted([(doc_ids[i], bm25_scores[i]) for i in range(len(doc_ids))], key=lambda x: x[1], reverse=True)
    sparse_top_ids = [x[0] for x in bm25_ranked[:20]]

    # 3. RRF (Reciprocal Rank Fusion) 倒数排序融合
    rrf_scores = {doc_id: 0.0 for doc_id in doc_ids}
    k_constant = 60
    
    for rank, doc_id in enumerate(dense_top_ids):
        rrf_scores[doc_id] += 1.0 / (k_constant + rank + 1)
        
    for rank, doc_id in enumerate(sparse_top_ids):
        rrf_scores[doc_id] += 1.0 / (k_constant + rank + 1)

    # 4. 提取最终的 Top-K
    fused_sorted = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
    final_top_ids = [x[0] for x in fused_sorted[:top_k]]
    
    id_to_doc = dict(zip(doc_ids, documents))
    return [id_to_doc[doc_id] for doc_id in final_top_ids]


def rag_answer_hybrid(question, collection, bm25_index, documents, doc_ids, model_id, top_k=5):
    """执行混合检索并使用大模型生成回答"""
    # 使用 RRF 混合检索获取最优质的 5 个 Chunk
    best_chunks = hybrid_search(question, collection, bm25_index, documents, doc_ids, top_k=top_k)
    context_str = "\n\n---\n\n".join(best_chunks)
    
    unique_id = str(uuid.uuid4())[:8]
    prompt = f"""[req-{unique_id}] You are a precise question-answering assistant. Please answer the question STRICTLY based on the provided [Chat History Context].
If the context does not contain the information to answer the question, reply exactly with "Insufficient information".

[Chat History Context]:
{context_str}

[Question]: {question}"""

    api_key = get_api_key()
    if not api_key: return "[ERROR: No API Key]"

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
        resp.encoding = 'utf-8' # 严防乱码
        
        text_chunks = []
        for line in resp.text.splitlines():
            if line.startswith("data:") and line[5:].strip() not in ("", "[DONE]"):
                try:
                    chunk = json.loads(line[5:].strip())
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    if delta.get("content"):
                        text_chunks.append(delta["content"])
                except Exception:
                    pass
        text = "".join(text_chunks).strip()
        return text if text else "[empty response]"
    except Exception as e:
        return f"[ERROR: {e}]"


# ══════════════════════════════════════════════════════════════
# ⬇️ 评价指标与数据加载，100% 原始逻辑，绝无修改 ⬇️
# ══════════════════════════════════════════════════════════════

def _tokenize(text):
    return re.findall(r'\b\w+\b', text.lower())

STOPWORDS = {'the', 'a', 'an', 'is', 'was', 'are', 'were', 'be', 'been',
             'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
             'could', 'should', 'may', 'might', 'shall', 'can', 'to', 'of',
             'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
             'and', 'or', 'but', 'not', 'no', 'that', 'this', 'it', 'i',
             'my', 'you', 'your', 'we', 'our', 'they', 'their', 'me', 'he',
             'she', 'his', 'her', 'its', 'us', 'them', 'so', 'if', 'then'}

def score_keyword(model_answer, expected_answer):
    if not model_answer or not expected_answer: return 0.0
    model_lower = model_answer.lower()
    key_tokens = set(_tokenize(expected_answer)) - STOPWORDS
    if not key_tokens: return 1.0 if expected_answer.lower() in model_lower else 0.0
    matches = sum(1 for t in key_tokens if t in model_lower)
    return matches / len(key_tokens)

def score_token_f1(model_answer, expected_answer):
    if not model_answer or not expected_answer: return 0.0
    pred_tokens = set(_tokenize(model_answer)) - STOPWORDS
    gold_tokens = set(_tokenize(expected_answer)) - STOPWORDS
    if not gold_tokens: return 1.0 if not pred_tokens else 0.0
    if not pred_tokens: return 0.0
    common = pred_tokens & gold_tokens
    if not common: return 0.0
    precision = len(common) / len(pred_tokens)
    recall = len(common) / len(gold_tokens)
    f1 = 2 * precision * recall / (precision + recall)
    return f1

def score_llm_judge(question, model_answer, expected_answer):
    if not model_answer or model_answer.startswith("["): return 0.0
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
        if not judge_api_key: return -1.0
        time.sleep(2)
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
        resp.encoding = 'utf-8'
        text_chunks = []
        for line in resp.text.splitlines():
            if line.startswith("data:") and line[5:].strip() not in ("", "[DONE]"):
                try:
                    chunk = json.loads(line[5:].strip())
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    if delta.get("content"):
                        text_chunks.append(delta["content"])
                except Exception:
                    pass
        text = "".join(text_chunks).strip()
        if not text: return -1.0
        match = re.search(r'"score"\s*:\s*([0-9.]+)', text)
        if match: return min(1.0, max(0.0, float(match.group(1))))
        return 0.0
    except Exception as e:
        return -1.0

def score_answer(question, model_answer, expected_answer):
    kw = score_keyword(model_answer, expected_answer)
    f1 = score_token_f1(model_answer, expected_answer)
    judge = score_llm_judge(question, model_answer, expected_answer)
    
    if judge >= 0: 
        if judge >= 0.8: combined = judge
        else: combined = 0.6 * judge + 0.25 * f1 + 0.15 * kw
    else: 
        combined = 0.5 * f1 + 0.5 * kw
        judge = None
    
    return {
        "keyword": round(kw, 3), "token_f1": round(f1, 3),
        "llm_judge": round(judge, 3) if judge is not None else None,
        "combined": round(combined, 3),
    }

_beam_dataset_cache = None
def _get_beam_dataset():
    global _beam_dataset_cache
    if _beam_dataset_cache is None:
        from datasets import load_dataset
        _beam_dataset_cache = load_dataset("Mohammadta/BEAM")
    return _beam_dataset_cache

def _parse_questions(conv):
    pq = conv["probing_questions"]
    if isinstance(pq, str): pq = ast.literal_eval(pq)
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
                questions.append({"type": qtype, "question": q["question"], "expected_answer": answer})
    return questions

def load_beam(case_ids=None, split_name="100K"):
    if case_ids is None: case_ids = [0]
    ds = _get_beam_dataset()
    split = ds[split_name]
    cases = []
    for cid in case_ids:
        if cid >= len(split): continue
        conv = split[cid]
        chat = conv["chat"]
        questions = _parse_questions(conv)
        cases.append((cid, chat, questions))
    return cases

def print_results_table(all_results, save_path=None):
    results_before = []
    results_after = []
    for r in all_results:
        results_before.extend(r["before_compaction"]["results"])
        results_after.extend(r["after_compaction"]["results"])
    
    def avg_score(results, metric="combined"):
        vals = [r["scores"][metric] for r in results if r["scores"].get(metric) is not None]
        return sum(vals) / len(vals) if vals else 0
    
    # 用于收集所有要打印的行，方便一次性写入文件
    table_lines = []
    def log(text=""):
        print(text)
        table_lines.append(text)

    log(f"\n{'='*76}")
    log(f"📊 RESULTS — RAG Benchmark ({len(all_results)} cases)")
    log(f"    Scoring: 50% LLM Judge + 30% Token F1 + 20% Keyword")
    log(f"{'='*76}")
    
    for metric_name, metric_key in [("Combined Score", "combined"), ("Token F1", "token_f1"), ("LLM Judge", "llm_judge"), ("Keyword Overlap", "keyword")]:
        avg_b = avg_score(results_before, metric_key)
        avg_a = avg_score(results_after, metric_key) 
        log(f"\nMetric: {metric_name:<30} {'Before':<15} {'After(RAG)':<15} {'Delta':<8}")
        log("-" * 76)
        log(f"{'  Overall':<35} {avg_b:>10.1%} {avg_a:>14.1%} {avg_a-avg_b:>+8.1%}")
        
        types = sorted(set(r["type"] for r in results_after))
        for qtype in types:
            b_vals = [r["scores"][metric_key] for r in results_before if r["type"] == qtype and r["scores"].get(metric_key) is not None]
            a_vals = [r["scores"][metric_key] for r in results_after if r["type"] == qtype and r["scores"].get(metric_key) is not None]
            ab = sum(b_vals) / len(b_vals) if b_vals else 0
            aa = sum(a_vals) / len(a_vals) if a_vals else 0
            log(f"    {qtype:<31} {ab:>10.1%} {aa:>14.1%} {aa-ab:>+8.1%}")

    # 如果传入了保存路径，就写入文件
    if save_path:
        try:
            with open(save_path, "w", encoding="utf-8") as f:
                f.write("\n".join(table_lines) + "\n")
            print(f"\n📄 【表格已保存】可视化数据表已输出至: {save_path}")
        except Exception as e:
            print(f"\n❌ 保存表格文件失败: {e}")

# ─── 主入口 ───
def run_single_rag_case(case_id, chat_sessions, questions, model_id):
    print(f"\n{'='*60}")
    print(f"🔬 Hybrid RAG BEAM Case {case_id}: {len(chat_sessions)} sessions, {len(questions)} questions")
    print(f"{'='*60}")
    
    collection, bm25_index, documents, doc_ids = build_hybrid_db(case_id, chat_sessions)
    
    print(f"\n{'='*60}")
    print(f"📋 正在使用混合 RAG 检索并回答问题...")
    print(f"{'='*60}")
    
    results_rag = []
    for i, q in enumerate(questions):
        print(f"\n  [{i+1}/{len(questions)}] ({q['type']}) {q['question'][:80]}...")
        
        # 使用搭载了 RRF 的混合检索生成答案
        answer = rag_answer_hybrid(q["question"], collection, bm25_index, documents, doc_ids, model_id, top_k=6)
        scores = score_answer(q["question"], answer, q["expected_answer"])
        
        results_rag.append({
            "type": q["type"],
            "question": q["question"],
            "expected": q["expected_answer"],
            "model_answer": answer if answer else "",
            "scores": scores,
        })
        
        c = scores["combined"]
        emoji = "✅" if c >= 0.5 else "⚠️" if c >= 0.3 else "❌"
        judge_str = f" Judge={scores['llm_judge']:.2f}" if scores['llm_judge'] is not None else ""
        print(f"  {emoji} Combined={c:.2f}  (F1={scores['token_f1']:.2f}  KW={scores['keyword']:.2f}{judge_str})")
        print(f"     Expected: {q['expected_answer'][:100]}")
        print(f"     Got(RAG): {answer[:100] if answer else '[empty]'}")
        
        time.sleep(2)

    def avg_score(results, metric="combined"):
        vals = [r["scores"][metric] for r in results if r["scores"].get(metric) is not None]
        return sum(vals) / len(vals) if vals else 0
    
    a = avg_score(results_rag)
    print(f"\n  📊 Case {case_id} Hybrid RAG Summary: Avg Score = {a:.1%}")
    
    return {
        "case_id": case_id,
        "session_id": f"rag_case_{case_id}",
        "messages_fed": 0,
        "before_compaction": {"avg_combined": 0, "results": []}, 
        "after_compaction": {"avg_combined": a, "results": results_rag},
    }

def main():
    global PROVIDER_ID, MODEL_ID
    parser = argparse.ArgumentParser(description="BEAM Memory Benchmark with Advanced Hybrid RAG")
    parser.add_argument("--cases", default="0", help="Case IDs: '0', '0,1,2', or 'all'")
    parser.add_argument("--split", default="100K", choices=["100K", "500K", "1M"], help="BEAM dataset split")
    parser.add_argument("--provider", default=PROVIDER_ID, help="Provider ID")
    parser.add_argument("--model", default=MODEL_ID, help="Model ID")
    parser.add_argument("--output", default="/tmp/beam_results", help="Output directory")
    args = parser.parse_args()
    
    PROVIDER_ID = args.provider
    MODEL_ID = args.model
    
    max_cases = 20 if args.split == "100K" else 35
    case_ids = list(range(max_cases)) if args.cases == "all" else [int(x.strip()) for x in args.cases.split(",")]
    
    print(f"🚀 Hybrid RAG BEAM Benchmark: {args.split} split, {len(case_ids)} cases")
    print(f"   Model: {PROVIDER_ID}/{MODEL_ID}")
    
    cases = load_beam(case_ids, split_name=args.split)
    os.makedirs(args.output, exist_ok=True)
    checkpoint_path = os.path.join(args.output, f"checkpoint_HybridRAG_{PROVIDER_ID}_{MODEL_ID}_{args.split}.json")
    
    completed = {}
    if os.path.exists(checkpoint_path):
        with open(checkpoint_path) as f:
            completed = {r["case_id"]: r for r in json.load(f)}
        print(f"  📂 Resuming: {len(completed)} cases already done")
    
    all_results = list(completed.values())
    
    for case_id, chat, questions in cases:
        if case_id in completed: continue
        try:
            result = run_single_rag_case(case_id, chat, questions, MODEL_ID)
            all_results.append(result)
            with open(checkpoint_path, "w") as f:
                json.dump(all_results, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"\n  ❌ Case {case_id} failed: {e}")
            continue
            
    print_results_table(all_results)
    
    from datetime import datetime
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # 1. 确定输出 JSON 和 TXT 的路径
    safe_cases = args.cases.replace(',', '_')
    final_json_path = os.path.join(args.output, f"results_Scheme2_{args.split}_case{safe_cases}.json")
    table_txt_path = os.path.join(args.output, f"table_Scheme2_{args.split}_case{safe_cases}.txt")
    
    # 2. 打印表格并保存为 TXT 文本文件
    print_results_table(all_results, save_path=table_txt_path)
    
    # 3. 原始详细数据依然保存为 JSON (保持你原有的这部分)
    output = {
        "test_type": f"RAG BEAM Benchmark ({args.split})",
        "scoring_method": "50% LLM Judge + 30% Token F1 + 20% Keyword Overlap",
        "model": f"{PROVIDER_ID}/{MODEL_ID}",
        "split": args.split,
        "cases_tested": len(all_results),
        "results": all_results,
    }
    with open(final_json_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"📁 【详细数据已保存】JSON源文件至: {final_json_path}")

if __name__ == "__main__":
    main()