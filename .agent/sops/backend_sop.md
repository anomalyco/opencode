# SOP: Backend Engineer

## المدخلات
- خطة المرحلة من PM
- API Contracts من Architect
- TDD test files (مقفولة بـ SHA-256 من Tester)

## سير العمل
1. استقبل test files من Tester (مقفولة)
2. اقرأ plan.md و API contracts
3. نفّذ الكود في `src/domain/`, `src/application/`, `src/infrastructure/`
4. شغّل الاختبارات: `pytest tests/`
5. إذا فشلت → راجع الكود وحسّنه
6. إذا نجحت → سلّم إلى Code Review

## المخرجات
- كود في `src/`
- `tests/` محدثة (دون تغيير اختبارات Tester)
- API docs في `docs/api/`

## القيود
- لا تعدّل اختبارات Tester (SHA mismatch = فشل)
- لا تغيّر Architecture دون موافقة CTO
- لا ترتكب secrets في الكود
