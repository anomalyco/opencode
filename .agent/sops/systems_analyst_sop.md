# SOP: Systems Analyst

## قبل البدء
- راجع `4-engineering/sprint_planning.md` للفهم العام
- راجع `roles/19_business_analyst.md` لفهم مخرجات الـ BA

## سير العمل

### تحليل نظام قائم (AS-IS)
1. اجمع المعلومات (مقابلات، توثيق، كود، DB schema)
2. ارسم الـ System context diagram
3. ارسم الـ Data flow diagram (Level 0)
4. حلّل كل وحدة وظيفية (Module → Inputs → Process → Outputs)
5. وثّق الـ Business rules المنطقية
6. حدد الـ Gaps (ما لا يعمل، ما ينقص، ما يحتاج تحسين)
7. اكتب التقرير مع التوصيات

### كتابة SRS لنظام جديد
1. استخدم قالب SRS موحد
2. اكتب الـ Introduction (Purpose, Scope, Definitions)
3. اكتب الـ Overall description (User characteristics, Constraints, Assumptions)
4. اكتب الـ System features بالتفصيل (functional requirements)
5. اكتب الـ Non-functional requirements (Performance, Security, Availability)
6. أضف الـ Use cases لكل feature
7. أضف الـ Sequence diagrams للـ scenarios الحرجة
8. راجع مع BA + Architect + Developer
9. سجّل النسخة و الـ revisions

### تحليل الأثر (Impact Analysis)
1. حدد التغيير المطلوب
2. حلّل أي الأنظمة/الموديولات تتأثر
3. قدّر الـ Effort (Low, Medium, High)
4. حلّل المخاطر (ما يمكن أن ينكسر)
5. اكتب التوصية (Proceed, Proceed with caution, Blocked)
6. اعرض على PM + CTO

## القياسات
- Requirements ambiguity (عدد أسئلة التوضيح من الفريق) — متناقص
- SRS completion قبل الـ dev — 100%
- Change requests بعد الـ SRS — < 15%
- Feasibility accuracy (التقدير يطابق الواقع) > 80%
