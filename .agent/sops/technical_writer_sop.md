# SOP: Technical Writer

## قبل البدء
- راجع `4-engineering/technical_writing.md` للمعايير
- راجع `4-engineering/knowledge_management.md` لهيكل الـ KB

## سير العمل

### كتابة توثيق لميزة جديدة
1. افهم الميزة: اقرأ الـ PR + تكلم مع Developer
2. اكتب الـ Quick Start (للمستخدم الجديد)
3. اكتب الـ API Reference (إذا API)
4. أضف أمثلة حقيقية
5. راجع الدقة مع Developer
6. انشر في Knowledge Base

### كتابة ADR
1. اقرأ الـ ADR السابق
2. ناقش مع Architect
3. اكتب التحديث (Context → Decision → Consequences)
4. راجع مع الفريق
5. سجّل في docs/decisions/

### مراجعة PR للتوثيق
1. هل يشرح why ليس how فقط؟
2. هل الأمثلة صحيحة وقابلة للتنفيذ؟
3. هل يتبع الـ style guide؟
4. هل يضيف glossary terms جديدة؟

## القياسات
- API documentation coverage — 100%
- Developer satisfaction with docs — > 4/5
- Time to publish — < 2 أيام
