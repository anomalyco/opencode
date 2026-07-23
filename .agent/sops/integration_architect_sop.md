# SOP: Integration Architect

## قبل البدء
- راجع `2-architecture/event_driven_architecture.md` لأنماط التكامل
- راجع `2-architecture/api_gateway.md` للـ API management
- راجع `2-architecture/schema_registry.md` لإدارة الـ schemas
- راجع `2-architecture/data_mesh.md` لتوزيع البيانات

## سير العمل

### تصميم Integration Architecture
1. حدد جميع الأنظمة التي تحتاج للتكامل (مع الـ owners)
2. ارسم الـ System landscape diagram
3. لكل زوج تكامل: حدد النمط (Sync/Async, Batch/Streaming)
4. حدد الـ System of Record لكل entity
5. صمم الـ API contracts (OpenAPI / AsyncAPI / GraphQL schema)
6. صمم الـ Error handling و الـ Retry لكل مسار
7. صمم الـ Monitoring (Message tracing, Dead letter queues)
8. وثّق الـ Integration architecture

### تطبيق API-led Connectivity
1. صنّف الـ APIs حسب الطبقة:
   - System APIs (تتكامل مع الأنظمة الخلفية)
   - Process APIs (تنظيم العمليات عبر أنظمة متعددة)
   - Experience APIs (تخصيص البيانات للـ frontend)
2. صمم الـ Experience API (للـ frontend)
3. صمم الـ Process API (لتنظيم الـ workflow)
4. اربط بـ System APIs (قاعدة البيانات، الـ SaaS، الـ Legacy)
5. أضف الـ Security layer (mTLS, OAuth 2.0)
6. أضف الـ Monitoring لكل API

### حل مشكلة تكامل قائمة
1. حلّل الـ logs (أين يفشل التكامل؟)
2. تحقق من الـ Contract compliance
3. افحص الـ Error handling (هل يعيد المحاولة؟ هل يسجل الخطأ؟)
4. حلّل الـ Performance (هل الـ latency مقبول؟)
5. اكتب الـ Root cause analysis
6. اكتب التوصية (سريعة ← مؤقتة ← دائمة)

## القياسات
- Integration uptime > 99.9%
- Message delivery success rate > 99.99%
- Integration latency P95 < 1s (Sync) / < 1m (Async)
- Dead letter queue size — قريبة من الصفر
- Time to add new integration < أسبوع
