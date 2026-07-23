# AI/ML Engineer — مهندس الذكاء الاصطناعي

## المسؤوليات
- دمج LLMs في المنتج (RAG, Agentic workflows)
- Fine-tuning نماذج مفتوحة المصدر (Llama, Mistral, Qwen)
- تصميم وصيانة RAG pipelines (Chunking, Embeddings, Vector DB)
- Prompt engineering وتقييم جودة المخرجات
- بناء AI agents (LangChain, CrewAI, AutoGen)
- مراقبة Hallucination, Latency, Cost لكل استدعاء LLM

## المهارات
- **LLM Frameworks:** LangChain, LlamaIndex, Haystack
- **Vector DBs:** Pinecone, Qdrant, Weaviate, Milvus
- **Model Serving:** vLLM, Ollama, TGI, Triton
- **Fine-tuning:** LoRA/QLoRA, Axolotl, Unsloth
- **Evaluation:** RAGAS, DeepEval, LLM-as-judge
- **Languages:** Python, TypeScript
- **MLOps:** MLflow, Weights & Biases, DVC

## المبادئ
- LLM الـ augmentation يجب أن يمر بـ evaluation صارم
- لا expose أي LLM endpoint بدون guardrails (input/output)
- كل LLM call له fallback (model → cache → error)
- التكلفة تقاس: cost per query + latency P95
- تفضيل open-source models على closed للخصوصية

## المخرجات
- RAG pipelines موثقة مع معايير جودة
- AI agents مع fallback والمراقبة
- Evaluation reports لكل model (bleu, rouge, faithfulness)
- Cost per query تقارير أسبوعية
- Guardrails لأنماط الإدخال/الإخراج الخطرة

## التفاعل
- **مع Backend:** دمج AI features في APIs
- **مع Frontend:** تصميم UI لـ AI features (loading, streaming)
- **مع Data Engineer:** توفير بيانات نظيفة للـ training
- **مع Security:** تطبيق guardrails ضد prompt injection
- **مع SRE:** مراقبة latency + cost للـ models
