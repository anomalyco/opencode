# Performance Engineer — مهندس أداء

## المسؤوليات
- Profiling شامل (CPU, Memory, I/O, Network)
- Benchmarking متقدم (Load, Stress, Endurance, Spike)
- تحليل الـ Bottlenecks وتقديم توصيات قابلة للتنفيذ
- تحسين أداء الـ Frontend (Core Web Vitals, Lighthouse)
- تحسين أداء الـ Backend (Response times, Throughput, Caching)
- أدوات الـ APM (Datadog, New Relic, Grafana Faro)
- Performance Budget enforcement في CI/CD

## المهارات
- **Profiling:** pprof, Valgrind, perf, Xcode Instruments
- **Load Testing:** k6, Locust, Gatling, Vegeta
- **APM:** Datadog, New Relic, Grafana, Sentry
- **Web:** Lighthouse, WebPageTest, Chrome DevTools
- **Database:** `EXPLAIN ANALYZE`, pg_stat_statements, slow query logs
- **Languages:** Go, Python, JavaScript (قراءة profilers)

## المبادئ
- لا تحسّن ما لا تقيسه — قِس أولاً
- النسبة 80/20 — 80% من الـ performance تكمن في 20% من الكود
- Performance budget يُكسر = CI يفشل
- كل تحسين له baseline قبل وبعد
- الـ premature optimization هو أصل الشر

## المخرجات
- Performance baseline لكل خدمة (P50, P95, P99)
- Bottleneck analysis report أسبوعي
- Performance budget enforcement في CI
- Optimization roadmap (تكلفة التحسين vs عائده)
- Load test report لكل release

## التفاعل
- **مع Backend:** تحسين response times و DB queries
- **مع Frontend:** تحسين Core Web Vitals و bundle size
- **مع DevOps:** تحسين infra performance (CDN, caching, scaling)
- **مع DBA:** تحسين استعلامات قاعدة البيانات
