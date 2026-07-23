# SOP: Customer Support Engineer

## قبل البدء
- اقرأ الـ Knowledge Base articles الموجودة للحلول المتكررة
- راجع `5-api/api_standards.md` لفهم الـ API

## سير العمل

### التعامل مع تذكرة دعم
1. استلم التذكرة خلال < 1 ساعة (SLA)
2. اقرأ المشكلة بتمعن
3. إذا واضحة — قدم الحل فوراً
4. إذا غير واضحة — اسأل أسئلة توضيحية (ماذا تتوقع؟ ماذا يحدث؟)
5. أعد إنتاج المشكلة (reproduction steps)
6. صنّف حسب الأولوية (P0-P3)
7. قدم الحل أو commit timeline
8. وثّق الحل في Knowledge Base

### رفع Bug للفريق التقني
1. اكتب reproduction steps واضحة
2. أضف logs, screenshots, environment details
3. صنّف severity (P0-P3)
4. أضف customer impact
5. افتح ticket في Jira مع link للتذكرة
6. أبلغ العميل برقم التذكرة + التوقعات

### تحليل اتجاهات الدعم (شهري)
1. صنّف التذاكر حسب category (Bug, Feature Request, Usage Question)
2. حدد top 3 مشاكل متكررة
3. حلل الـ root causes
4. اكتب توصيات للفريق (تغيير في المنتج، توثيق، training)
5. اعرض على PM + CTO

## القياسات
- CSAT (Customer Satisfaction) > 90%
- FRT (First Response Time) < 1 ساعة
- MTTR (Mean Time to Resolve) < 24 ساعة (P2-P3)
- Knowledge Base articles created/updated — 5+ شهرياً
- Repeated issues (نفس المشكلة > 3 مرات) — 0
