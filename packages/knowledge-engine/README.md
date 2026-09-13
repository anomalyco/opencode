# 🧠 OpenCode Local Knowledge Engine

محرك معرفي محلي بالكامل (Local & Embedded RAG): `bun:sqlite` + مولد متجهات
محلي، بدون مفاتيح API أو تكاليف خارجية.

## 🚀 المميزات

- **محلي 100% (Zero-Cost & Embedded):** يعتمد على `bun:sqlite` ومولد متجهات
  كثيفة (Dense Vectors) محلي مدمج.
- **بحث هجين (Hybrid Search):** يجمع بين البحث الدلالي بالمتجهات
  (Vector Cosine Similarity) والبحث النصي (SQLite FTS5 BM25)، مع بوابة امتناع
  تُرجع قائمة فارغة عند غياب معرفة مرتبطة بدل عرض نتائج غير مرتبطة.
- **دعم متعدد اللغات:** معالجة وتطبيع النصوص العربية والإنجليزية واستخراج
  الأقسام والوسوم.
- **تكامل V2 First-Turn Retrieval:** خدمتا `KnowledgeRetrieval` و
  `KnowledgeGuidance` تزودان أول دور مزود بالمعرفة المسترجعة عبر الطبقات
  المعتمدة فقط.
- **حوكمة صارمة للذاكرة:** Candidate → Staging → مراجعة بشرية إلزامية →
  قبول Approved-only → تحقق persistence واسترجاع مع تعويض بالحذف عند الفشل.
  قاعدتا staging و knowledge منفصلتان. لا قبول تلقائي، لا إدخال تلقائي.

## 💻 أوامر الاستخدام

### 1. أوامر الإنتاج (عبر OpenCode CLI)

```bash
# البحث في قاعدة المعرفة
bun src/index.ts search "سؤال البحث هنا"

# دورة الحوكمة: اقتراح ← مراجعة ← قبول ← إدخال
bun src/index.ts learn propose --session <id> --summary-file <path>
bun src/index.ts learn candidates
bun src/index.ts learn show <id>
bun src/index.ts learn approve <id> --note "<note>"
bun src/index.ts learn admit <id>
bun src/index.ts learn retrieve --query "<query>"
bun src/index.ts learn status
```

### 2. عمليات الحزمة نفسها

```bash
cd /mnt/k/opencode/packages/knowledge-engine
bun run src/cli.ts stats
bun run src/cli.ts search --query "سؤال البحث هنا"
bun run src/cli.ts index /path/to/markdown/docs
```

### 3. اختبار الوحدة والتكامل

```bash
cd /mnt/k/opencode/packages/knowledge-engine
bun test
```

## ⚠️ حدود الاستخدام

- الاستخدام المنضبط (Controlled Use) فقط؛ المراجعة البشرية إلزامية قبل أي إدخال.
- لا استعلامات خارج نطاق المشروع: المحرك يمتنع (`results=0`) بدل التخمين.
