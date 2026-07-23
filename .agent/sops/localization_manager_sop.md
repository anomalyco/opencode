# SOP: Localization Manager

## قبل البدء
- راجع `5-api/internationalization.md` لاستراتيجية i18n
- راجع `5-api/design_system.md` للـ RTL-ready components
- راجع `5-api/accessibility.md` للّغات ذات الـ accessibility المختلفة

## سير العمل

### إضافة لغة جديدة
1. استخرج جميع الـ translatable strings
2. قسّم الـ strings حسب الأولوية (UI → Errors → Docs)
3. أرسل الـ files للمترجمين مع context/screenshots
4. راجع الترجمات (In-country review)
5. اختبر الـ RTL layout (إن لزم)
6. اختبر الـ locale-specific formatting (dates, numbers, currency)
7. LQA (Linguistic Quality Assurance)
8. انشر في release

### تحديث Strings بعد تغيير كود
1. شغّل extractor لسحب الـ strings الجديدة
2. حدد الـ changed strings
3. أرسل الـ diff للمترجمين
4. راجع الـ translations الجديدة
5. اختبر في staging مع الـ locale
6. انشر في الـ next release

### LQA Report
1. افتح كل لغة وافحص الـ UI
2. تحقق من: truncation, encoding, alignment, RTL/LTR
3. تحقق من: accuracy, consistency, tone
4. سجّل الـ issues (truncation = P1, wrong term = P2, style = P3)
5. أرسل التقرير للفريق + المترجمين

## القياسات
- Translation coverage > 99%
- Untranslated strings = 0 عند الـ release
- RTL layout issues — 0 ظاهرية
- LQA pass rate > 90%
- Time to add new language < 2 أسابيع
