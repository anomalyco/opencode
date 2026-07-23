# SOP: UX Writer

## قبل البدء
- راجع `5-api/design_system.md` لنظام التصميم
- راجع `5-api/accessibility.md` لمعايير الـ accessibility
- راجع `5-api/internationalization.md` للترجمة

## سير العمل

### كتابة Copy لميزة جديدة
1. افهم الميزة من الـ Product Designer + PM
2. اقرأ الـ User flow وافهم رحلة المستخدم
3. اكتب الـ Microcopy لكل شاشة:
   - Title (واضح، قصير، يعكس المحتوى)
   - Description (عند الحاجة فقط)
   - Labels و Placeholders (ماذا يتوقع المستخدم)
   - Buttons (فعل — "احفظ" وليس "نعم")
   - Error messages (ماذا حدث + ماذا يفعل المستخدم)
   - Empty states (ما هذه الشاشة + ماذا يفعل الآن)
4. راجع مع الـ UI/UX Designer (هل يناسب التصميم؟)
5. اختبر مع المستخدمين (هل يفهمون الكلام؟)
6. سلّم لـ Developer مع الـ annotations

### كتابة Error Message
1. اعرف الخطأ (What happened — تقنياً)
2. ترجم للمستخدم (Plain language — لا تقني)
3. قدم الحل (What to do next)
4. اختر الـ Tone (مهذب، مفيد، غير تقني)
5. مثال: "تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مرة أخرى."

### الحفاظ على الـ Content Style Guide
1. وثّق الـ Voice (شخصية العلامة التجارية)
2. وثّق الـ Tone (لكل سياق: error, success, notification, marketing)
3. وثّق الـ Grammar rules (لكل لغة)
4. وثّق الـ Terminology (المصطلحات الموحدة)
5. حدّث الـ guide كل ربع سنة

## القياسات
- Copy errors (أخطاء إملائية، غير واضحة) — 0 في production
- Usability test pass rate للـ copy > 90%
- Content style guide compliance audit > 95%
- Time from feature spec → copy delivered < يومان
- A/B test improvements (تحسين الـ conversion عبر الـ copy) > 5%
