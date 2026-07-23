# SOP: Performance Engineer

## قبل البدء
- راجع `8-quality/performance_optimization.md` للاستراتيجيات
- راجع `8-quality/caching_strategy.md` لحلول التخزين المؤقت
- راجع `8-quality/quality_metrics.md` للمقاييس المعتمدة

## سير العمل

### إجراء Performance Audit لخدمة
1. حدد الـ baseline (Current P50/P95/P99 للـ latency)
2. استخدم الـ APM لتحليل الـ bottlenecks
3. حقّق في الـ slowest endpoints
4. افحص الـ DB queries (N+1, missing indexes, lock contention)
5. افحص الـ memory usage و الـ GC patterns
6. اختبر الـ load (k6 — 50% / 100% / 150% من المتوقع)
7. اكتب التقرير مع توصيات قابلة للتنفيذ
8. سجّل الـ performance budget الجديد إن لزم

### إضافة Performance Budget إلى CI
1. حدد الـ metrics (LCP < 2.5s, TBT < 200ms, API P95 < 500ms)
2. اكتب test يفشل إذا تجاوز الـ budget
3. أضف الـ test إلى الـ CI pipeline
4. اختبر أن الـ test يعمل (يفشل مع الـ bad code)
5. وثّق الـ budget للفريق

### Load Test Scenario
1. عرّف الـ scenario (Normal load, Peak, Stress, Spike)
2. اكتب الـ k6 script
3. اختبر في staging
4. حلّل النتائج (Response times, Error rate, Resource usage)
5. حدد الـ bottlenecks
6. أعد الاختبار بعد التحسين
7. وثّق الفرق (before/after)

## القياسات
- API P95 < 500ms
- Core Web Vitals (LCP < 2.5s, FID < 100ms, CLS < 0.1)
- Performance budget compliance — 100%
- Load test pass rate — 100% قبل كل release
