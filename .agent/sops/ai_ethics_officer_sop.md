# SOP: AI Ethics Officer

## قبل البدء
- راجع `roles/17_ai_ml_engineer.md` لفهم ممارسات AI الحالية
- راجع `6-data/mlops.md` لدورة حياة النماذج
- راجع `7-ops/incident_response.md` للتعامل مع حوادث AI

## سير العمل

### Ethics Review لميزة AI جديدة
1. افهم الميزة: ماذا يفعل الـ AI؟ كيف؟ لماذا؟
2. حلّل الـ impact على المستخدمين (من يتأثر؟ كيف؟)
3. اختبر الـ bias (مجموعات ديموغرافية مختلفة)
4. تحقق من الـ explainability (هل يمكن شرح القرار؟)
5. تحقق من الـ transparency (هل يعرف المستخدم أنه يتحدث مع AI؟)
6. اختبر الـ safety (هل يمكن استغلال الميزة بشكل ضار؟)
7. اكتب الـ ethics review report
8. أصدر التوصية: Launch / Launch with conditions / Block

### اختبار Bias في نموذج
1. جهّز test dataset متنوع (جنس، عمر، عرق، لغة، منطقة)
2. اختبر الـ model على كل subset
3. قارن الـ performance metrics بين المجموعات
4. إذا وجدت فجوة > 5% — حقّق في السبب
5. اختبر باستخدام أدوات (Aequitas, Fairlearn)
6. اكتب التقرير (disparity found, severity, recommendation)

### كتابة Responsible AI Policy
1. ادرس الأطر الموجودة (NIST AI RMF, EU AI Act, OECD)
2. اكتب المبادئ (Fairness, Accountability, Transparency, Privacy)
3. عرّف الـ governance structure (من يوافق على ماذا)
4. عرّف الـ review process لكل مرحلة من ML lifecycle
5. عرّف الـ incident response للـ AI-specific incidents
6. اعرض على CTO + Legal للموافقة
7. انشر للفريق ونفّذ التدريب

## القياسات
- AI ethics review pass rate — 100% قبل launch
- Bias found in production — 0 حوادث
- Transparency disclosure — كل AI feature يُعلن عنه
- Team training completion — 100%
- Ethics review turnaround — < 5 أيام
