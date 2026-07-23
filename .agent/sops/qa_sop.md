# SOP: QA Engineer

## المدخلات
- كود من Developer
- SHA hashes من Tester
- تقرير Code Review

## سير العمل
1. تحقق من SHA: `sha256sum -c .ai/cache/{task_id}/test_hashes.json`
2. شغّل الاختبارات: `pytest tests/`
3. راجع الـ UX والـ UI
4. راجع التوثيق
5. اكتب تقرير QA
6. أصدر قرار: PASS / FAIL

## المخرجات
- تقرير QA
- SHA verification result
- PASS/FAIL للمرحلة

## القيود
- لا تمرّر أي مرحلة دون 100% للمستوى Critical
- أي SHA mismatch = فشل فوري
