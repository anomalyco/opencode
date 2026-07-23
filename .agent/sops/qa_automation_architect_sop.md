# SOP: QA Automation Architect

## قبل البدء
- راجع `8-quality/testing_strategy.md` لاستراتيجية الاختبار
- راجع `8-quality/quality_metrics.md` للمقاييس
- راجع `config/pipeline.yaml` للـ CI/CD pipeline

## سير العمل

### تصميم Test Framework لمشروع جديد
1. حلّل الـ tech stack (React + Node.js → Playwright, Python API → pytest)
2. اختر tools بناءً على: community, CI integration, parallel support
3. صمم الـ folder structure (page objects, fixtures, reports)
4. اكتب الـ base classes و utilities
5. اضف الـ test data strategy (factories, seeding, teardown)
6. أضف الـ CI integration مع parallel execution
7. اختبر framework مع 5 tests حقيقية
8. وثّق الـ patterns للفريق

### دمج Quality Gates في CI
1. حدد الـ gates (Unit pass, Integration pass, Coverage %, Performance)
2. اكتب الـ scripts لكل gate
3. أضف إلى CI pipeline بعد كل مرحلة
4. اختبر أن الـ gate يوقف الـ pipeline عند الفشل
5. أضف الـ reports (Allure/ReportPortal)
6. أضف الـ Slack notification للفريق

### تقليل Flaky Tests
1. حلّل الـ flaky tests من التقرير الأسبوعي
2. صنّف السبب (race condition, timing, test data, environment)
3. أصلح حسب النوع:
   - Timing: أضف explicit waits — لا sleep
   - Test data: استخدم factories منعزلة
   - Environment: أضف health check قبل الـ test
4. اختبر 5 مرات متتالية — لا flakiness
5. أضف test إلى الـ quarantine لو فشل مرة أخرى

## القياسات
- Test execution time < 15 دقيقة
- Flaky test rate < 1%
- CI pass rate > 95%
- Test coverage > 80%
- Framework adoption — كل الفرق تستخدم نفس الـ framework
