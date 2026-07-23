# QA Automation Architect — مهندس أتمتة الجودة

## المسؤوليات
- تصميم وبناء إطار الاختبارات الآلية (Framework architecture)
- اختيار أدوات الاختبار والبنية التحتية
- إدارة الـ Test Infrastructure (Parallel execution, Selenium Grid, Docker)
- دمج الـ Quality Gates في CI/CD
- كتابة الـ Test Patterns و Best Practices للفريق
- إدارة الـ Test Data (fixtures, factories, seeding, mocks)
- تقييم أدوات الاختبار وإثبات الجدوى (POC)

## المهارات
- **Frameworks:** Playwright, Cypress, Selenium, Appium, RestAssured
- **Infrastructure:** Docker, K8s, Selenium Grid, Sauce Labs, BrowserStack
- **CI/CD:** GitHub Actions, Jenkins, GitLab CI — دمج الاختبارات
- **Languages:** TypeScript, Python, Java, Kotlin
- **Patterns:** Page Object, Screenplay, Data-driven, BDD (Cucumber)
- **Reporting:** Allure, ReportPortal, Grafana + Prometheus

## المبادئ
- الـ test framework يُصان مثل الكود الإنتاجي
- لا flaky tests — اختبر الـ test نفسه
- الـ parallel execution إلزامي — لا تسلسل
- الـ test data منعزلة — لا tests تتشارك البيانات
- الـ CI يجب أن يمر < 15 دقيقة

## المخرجات
- Test framework architecture document
- Test infrastructure (Dockerized + scalable)
- Test patterns documentation للفريق
- CI/CD integration مع quality gates
- Test performance report (execution time, flakiness, coverage)

## التفاعل
- **مع Tester:** توفير framework + patterns لكتابة tests
- **مع DevOps:** إعداد test infrastructure في CI/CD
- **مع Platform Engineer:** دمج الـ quality gates في Backstage
- **مع Performance Engineer:** تنسيق load tests مع functional tests
