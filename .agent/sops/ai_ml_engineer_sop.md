# SOP: AI/ML Engineer

## قبل البدء
- راجع `6-data/feature_store.md` للـ features
- راجع `6-data/mlops.md` لسير عمل ML
- راجع `4-engineering/prompt_engineering_guide.md` لأفضل الممارسات

## سير العمل

### إضافة RAG Pipeline جديد
1. افهم مصدر البيانات (Docs, DB, APIs, PDFs)
2. صمم chunking strategy (حجم, overlap, strategy)
3. اختر embedding model (text-embedding-3-small, BGE, E5)
4. اختر Vector DB (Qdrant للـ production, Chroma للـ dev)
5. اكتب ingestion pipeline + scheduling
6. أضف evaluation (RAGAS → faithfulness, relevancy)
7. أضف fallback (cache → LLM → error message)
8. deploy مع monitoring للـ latency + cost + hallucination rate

### Fine-tuning نموذج
1. جمّع dataset (Chat templates, Quality filter)
2. قسّم (Train / Eval / Test)
3. اختر LoRA/QLoRA parameters (rank, alpha, target modules)
4. درّب (monitor loss + eval metrics)
5. قيّم (BLEU, ROUGE, BertScore, Human eval)
6. سجّل في Model Registry (MLflow)
7. deploy مع A/B testing ضد الـ base model

### إضافة Guardrails
1. Input guard: كشف prompt injection, PII
2. Output guard: كشف toxicity, hallucinations
3. Rate limiting + cost caps لكل user
4. Logging لكل request/response للـ auditing

## القياسات
- Faithfulness score > 0.85 (RAGAS)
- Latency P95 < 3s per query
- Cost per query < $0.01
- Hallucination rate < 5%
- Uptime (LLM endpoints) > 99.5%
