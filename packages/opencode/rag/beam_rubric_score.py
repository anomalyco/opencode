#!/usr/bin/env python3
"""BEAM Official Nugget Scorer v11 — 终极四表合一版 + 运行耗时统计
- 核心评分逻辑 (Rubric + Kendall tau-b + 15 并发) 100% 对齐官方，绝无魔改！
- 自动扫描 /tmp/beam_results/ 下的 results_Scheme*.json 并智能去重
- 自动生成 4 张表格（总分对比表 + 各题型分项表）并输出 TXT
"""

import json, os, re, sys, ast, glob, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from scipy.stats import kendalltau
import requests

DIR = os.path.dirname(os.path.abspath(__file__))
WORKERS = 15
API_URL = "https://ai.changyou.club/v1/chat/completions"
MODEL = "gpt-5.4"
RESULT_DIR = "/tmp/beam_results"

def _key():
    k = os.environ.get("CHANGYOU_API_KEY", "sk-proj-5fk7b2hjnx9zef06bx2vh5i2gbv8sofm")
    if not k:
        try:
            with open(os.path.expanduser("~/.local/share/opencode/auth.json")) as f:
                k = json.load(f).get("changyouopenai", {}).get("key", "")
        except Exception: pass
    return k or os.environ.get("DEEPSEEK_API_KEY", "")

KEY = _key()

def llm(prompt, temp=0.0, tokens=300):
    for attempt in range(3):
        try:
            resp = requests.post(API_URL,
                headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
                json={"model": MODEL, "messages": [{"role": "user", "content": prompt}],
                      "temperature": temp, "max_tokens": tokens, "stream": True},
                timeout=90)
            resp.raise_for_status()
            parts = []
            for line in resp.text.splitlines():
                if line.startswith("data:") and line[5:].strip() not in ("", "[DONE]"):
                    try:
                        d = json.loads(line[5:].strip())
                        c = d.get("choices", [{}])[0].get("delta", {}).get("content")
                        if c: parts.append(c)
                    except Exception: pass
            return "".join(parts).strip()
        except Exception as e:
            if attempt == 2: raise
    return ""

# ─── 官方 BEAM 打分 Prompt (绝对原汁原味) ───
JUDGE_PROMPT = """You are an expert evaluator. Score how well the model's answer satisfies the following evaluation criterion.

Question: {question}
Evaluation Criterion: {rubric}
Model Answer: {answer}

Score:
- 1.0 = Criterion is FULLY satisfied
- 0.5 = Criterion is PARTIALLY satisfied (related info but incomplete/vague)
- 0.0 = Criterion is NOT satisfied (missing, wrong, or contradicted)

IMPORTANT: Focus on factual content. Minor wording differences don't matter.

Reply with ONLY a JSON: {{"score": <0 or 0.5 or 1.0>}}"""

def score_rubric(question, rubric_item, answer):
    text = llm(JUDGE_PROMPT.format(question=question, rubric=rubric_item, answer=answer))
    match = re.search(r'"score"\s*:\s*([0-9.]+)', text)
    if match:
        raw = float(match.group(1))
        if raw >= 0.75: return 1.0
        if raw >= 0.25: return 0.5
        return 0.0
    return 0.0

# ─── 官方 Kendall tau-b 排序算法 (绝对原汁原味) ───
def score_event_ordering(question, expected, answer):
    prompt = f"""Extract the ordered list of items/events from both the expected answer and the model answer.
Question: {question}
Expected Answer: {expected}
Model Answer: {answer}
Return a JSON with:
- "expected_order": list of short item descriptions in expected order
- "model_order": list of short item descriptions in the order the model gave them
- "matched": number of items from expected that appear in model answer
If the model doesn't provide an ordered list, return {{"expected_order": [], "model_order": [], "matched": 0}}
Reply with ONLY a JSON object."""
    text = llm(prompt, tokens=500)
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if not match: return 0.0
    try:
        d = json.loads(match.group())
        exp = d.get("expected_order", [])
        mod = d.get("model_order", [])
        matched = d.get("matched", 0)
        if not exp or matched == 0: return 0.0
        if len(exp) < 2: return 1.0 if matched > 0 else 0.0
        n = len(exp)
        exp_ranks = list(range(n))
        mod_ranks = list(range(n)) 
        for i, e_item in enumerate(exp):
            best_pos = i 
            for j, m_item in enumerate(mod):
                if m_item.lower().strip() in e_item.lower().strip() or e_item.lower().strip() in m_item.lower().strip():
                    best_pos = j
                    break
            mod_ranks[i] = best_pos
        tau, _ = kendalltau(exp_ranks, mod_ranks)
        if tau != tau: return 0.0
        return round(max(0, (tau + 1) / 2), 4)
    except Exception: return 0.0

def load_rubric(split, case_id):
    from datasets import load_dataset
    ds = load_dataset("Mohammadta/BEAM", split=split)
    case = ds[case_id]
    qs = case["probing_questions"]
    if isinstance(qs, str): qs = ast.literal_eval(qs)
    rubric_map = {}
    for qtype, qdata in qs.items():
        if isinstance(qdata, dict): qdata = [qdata]
        elif isinstance(qdata, str): qdata = ast.literal_eval(qdata)
        for q in (qdata if isinstance(qdata, list) else [qdata]):
            question = q.get("question", "")
            rubric = q.get("rubric", [])
            expected = q.get("ideal_response") or q.get("ideal_answer") or q.get("expected_answer", "")
            if isinstance(rubric, str): rubric = ast.literal_eval(rubric)
            rubric_map[question[:80]] = {"type": qtype, "rubric": rubric, "expected": expected}
    return rubric_map

def score_one(idx, total, qdata, rubric_map):
    question = qdata["question"]
    answer = qdata.get("model_answer", "")
    qtype = qdata.get("type", "")
    key = question[:80]
    rinfo = rubric_map.get(key, {})
    rubric = rinfo.get("rubric", [])
    expected = rinfo.get("expected", qdata.get("expected", ""))

    if qtype == "event_ordering":
        score = score_event_ordering(question, expected, answer)
        return {"question": question, "type": qtype, "score": score}

    if not rubric: rubric = [expected[:500]] if expected else ["answer matches expected"]
    scores = [(r, score_rubric(question, r, answer)) for r in rubric]
    avg = sum(s for _, s in scores) / len(scores) if scores else 0.0
    return {"question": question, "type": qtype, "score": round(avg, 4)}

def process_case(case_data, scheme, split):
    cid = case_data["case_id"]
    qs = case_data.get("after_compaction", {}).get("results", [])
    if not qs: return None

    print(f"\n 正在由 GPT-5.4 并行评分: [{scheme}] Split: {split} | Case: {cid} (共 {len(qs)} 题)...")
    rubric_map = load_rubric(split, cid)

    scored = [None] * len(qs)
    # 核心：保留了 15 线程并发，保证打分速度
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futs = {pool.submit(score_one, i, len(qs), q, rubric_map): i for i, q in enumerate(qs)}
        for fut in as_completed(futs):
            i = futs[fut]
            try: scored[i] = fut.result()
            except Exception: scored[i] = {"score": 0, "type": "?"}

    avg = sum(s["score"] for s in scored) / len(scored)
    old_combined = sum((q.get("scores", {}).get("combined") or 0) for q in qs) / len(qs)

    types = {}
    for s in scored: types.setdefault(s.get("type", "?"), []).append(s["score"])
    per_type_avg = {t: sum(v)/len(v) for t, v in types.items()}
    
    print(f"  ✅ 完成! Official: {avg*100:.1f}% | Fast Combined: {old_combined*100:.1f}%")

    return {
        "scheme": scheme, "case_id": cid, "split": split,
        "official_avg": avg, "combined_avg": old_combined, "per_type": per_type_avg
    }

def main():
    # ⏱ 记录开始时间
    start_time = time.time()
    
    file_pattern = os.path.join(RESULT_DIR, "results_Scheme*.json")
    json_files = glob.glob(file_pattern)
    if not json_files:
        print(f"❌ 未在 {RESULT_DIR} 找到 JSON 结果文件。")
        return

    # 1. 智能提取并去重
    unique_cases = {}
    for path in json_files:
        match_split = re.search(r'_(100K|500K|1M)_', path)
        match_scheme = re.search(r'(Scheme[24])', path)
        split = match_split.group(1) if match_split else "100K"
        scheme = match_scheme.group(1) if match_scheme else "Unknown"

        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            for case_data in data.get("results", []):
                cid = case_data["case_id"]
                unique_cases[(scheme, split, cid)] = case_data

    print(f" 扫描完成，排重后共发现 {len(unique_cases)} 个独立测试用例等待官方评分。")

    # 2. 执行打分
    final_results = []
    for (scheme, split, cid), case_data in unique_cases.items():
        res = process_case(case_data, scheme, split)
        if res: final_results.append(res)

    # 3. 准备生成报表
    report_lines = []
    def log(text):
        print(text)
        report_lines.append(text)

    expected_cols = [("500K", 2), ("500K", 4), ("1M", 0), ("1M", 2), ("1M", 3)]
    col_names = ["500K C2", "500K C4", "1M C0", "1M C2", "1M C3"]

    # 4. 按方案输出 4 张表
    for target_scheme in ["Scheme2", "Scheme4"]:
        data = [r for r in final_results if r["scheme"] == target_scheme]
        if not data: continue
        data.sort(key=lambda x: (0 if x["split"]=="500K" else 1, x["case_id"]))

        log(f"\n{'='*70}")
        log(f"🟩 {target_scheme} 官方 v11 评分总结")
        log(f"{'='*70}")
        log(f"{'Case':<8} | {'Split':<6} | {'Official':<10} | {'Combined(旧)':<15}")
        log("-" * 55)
        
        tot_o, tot_c = 0, 0
        for r in data:
            o = r["official_avg"] * 100
            c = r["combined_avg"] * 100
            log(f"Case {r['case_id']:<3} | {r['split']:<6} | {o:>8.1f}%   | {c:>10.1f}%")
            tot_o += o; tot_c += c
        n = len(data) or 1
        log("-" * 55)
        log(f"{'平均':<17} | {tot_o/n:>8.1f}%   | {tot_c/n:>10.1f}%")

        log(f"\n🟨 {target_scheme} 各 Question Type 得分 (5 cases 平均)")
        log("-" * 90)
        header = f"{'类别 (Type)':<25} | " + " | ".join([f"{c:<7}" for c in col_names]) + " | 平均"
        log(header)
        log("-" * 90)

        q_types = set()
        for r in data: q_types.update(r["per_type"].keys())

        for qt in sorted(q_types):
            row_str = f"{qt[:25]:<25} | "
            sum_qt, count_qt = 0, 0
            for split, cid in expected_cols:
                match_r = next((x for x in data if x["split"] == split and x["case_id"] == cid), None)
                if match_r and qt in match_r["per_type"]:
                    val = match_r["per_type"][qt] * 100
                    row_str += f"{val:>6.1f}% | "
                    sum_qt += val
                    count_qt += 1
                else:
                    row_str += f"{'-':>7} | "
            avg_qt = (sum_qt / count_qt) if count_qt > 0 else 0
            row_str += f"{avg_qt:>6.1f}%"
            log(row_str)
        log("-" * 90)

    # ⏱️ 记录结束时间并计算耗时
    end_time = time.time()
    elapsed_seconds = end_time - start_time
    mins, secs = divmod(int(elapsed_seconds), 60)
    time_str = f"\n⏱ 官方打分总耗时: {mins}分 {secs}秒"
    log(time_str)

    # 5. 输出 TXT 文件
    out_txt = os.path.join(RESULT_DIR, "final_4_tables_official_report.txt")
    with open(out_txt, "w", encoding="utf-8") as f:
        f.write("\n".join(report_lines) + "\n")
    print(f"\n 4个表格与耗时统计已输出至文本文件: {out_txt}")

if __name__ == "__main__":
    main()