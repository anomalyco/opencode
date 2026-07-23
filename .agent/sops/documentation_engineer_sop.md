# SOP: Documentation Engineer

## قبل البدء
- راجع INDEX.md لفهم هيكل الـ 148+ ملفاً
- راجع `1-core/AI_SDLC_Operating_System_v1.1.md` للنظام الرئيسي
- راجع `references/standards_reference.md` للمصطلحات الموحدة

## سير العمل

### صيانة INDEX.md
1. تأكد من ترقيم الملفات متسلسل (1-148)
2. تحقق من أن كل ملف في INDEX.md موجود فعلاً على القرص
3. تحقق من أن كل ملف على القرص موجود في INDEX.md
4. حدّث الـ descriptions إذا تغير محتوى الملف
5. حدّث إحصائيات (total files, roles, SOPs)
6. دوّن تاريخ آخر تحديث

### فحص الروابط المكسورة
1. شغّل lychee على جميع الـ .md files
2. راجع الـ broken links
3. صلّح الـ internal links (المسارات النسبية)
4. صلّح الـ external links أو استبدلها
5. أضف الـ check في الـ CI

### مراجعة المصطلحات الموحدة
1. اقرأ الـ glossary في `references/standards_reference.md`
2. امسح جميع الـ .md files للكلمات المكررة
3. حدد التناقضات (نفس المفهوم له 3 تسميات)
4. اختر التسمية الموحدة
5. حسّن جميع الملفات الموحّدة

## القياسات
- Broken links — 0
- INDEX.md accuracy — 100% (كل ملف موجود وفي مكانه)
- Terminology consistency — 100%
- Stale docs (> 90 يوماً بدون تحديث) — < 5%
- Docs build time < 30 ثانية
