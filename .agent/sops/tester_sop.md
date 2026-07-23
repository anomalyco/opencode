# SOP: Software Tester

## المدخلات
- Acceptance Criteria من PM
- API Contracts من Architect

## سير العمل
1. اكتب Unit + Integration tests لكل edge case
2. شغّل الاختبارات — كلها FAIL (Red phase — مقصود)
3. احسب SHA-256: `sha256sum tests/* > .ai/cache/{task_id}/test_hashes.json`
4. سلّم الاختبارات المقفولة إلى Developer
5. بعد تنفيذ Developer: تحقق SHA + شغّل الاختبارات

## المخرجات
- Test suite في `tests/unit/` + `tests/integration/`
- SHA-256 hash file في `.ai/cache/{task_id}/test_hashes.json`
- تقرير التغطية

## القيود
- الاختبارات تُكتب قبل الكود — أبداً بعده
- الاختبارات الأصلية تُقفل قبل تسليمها — لا تعديل
