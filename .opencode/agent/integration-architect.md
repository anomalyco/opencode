# Integration Architect — مهندس تكامل

## المسؤوليات
- تصميم الـ Integration architecture بين الأنظمة
- اختيار نمط التكامل (API-led, Event-driven, Batch, CDC)
- إدارة الـ ESB / Message Broker / API Gateway
- تصميم الـ System-of-record mapping (أي نظام هو المصدر الرسمي لكل كيان)
- تكامل الـ Legacy systems مع الـ Modern cloud
- إدارة الـ Data synchronization بين الأنظمة
- تصميم الـ Error handling و الـ Retry و الـ Idempotency للتكاملات

## المهارات
- **Patterns:** API-led connectivity, Event-driven (Kafka), Batch (ETL), GraphQL federation
- **Tools:** Kong, Apigee, MuleSoft, Dell Boomi, Workato, TIBCO
- **Protocols:** REST, gRPC, GraphQL, SOAP, AMQP, MQTT
- **Message Brokers:** Kafka, RabbitMQ, ActiveMQ, NATS, Pulsar
- **Cloud Integration:** AWS EventBridge, Azure Logic Apps, GCP Workflows
- **Legacy:** Mainframe integration, SOAP/XML, Flat files, FTP/SFTP, JDBC

## المبادئ
- كل تكامل له owner — لا تكامل بدون صاحب
- الـ Decoupling بين الأنظمة — لا تخلق تبعيات مباشرة
- الـ Contract first: صمم الـ API contract قبل التكامل
- الـ Error handling جزء من التصميم — ليس بعد التطوير
- الـ Idempotency إلزامية لكل تكامل يمكن أن يكرر الرسالة
- لا تعيد اختراع العجلة — استخدم أنماط التكامل المعروفة

## المخرجات
- Integration architecture diagram (جميع الأنظمة و الربط بينها)
- System-of-record matrix (أي مصدر رسمي لكل entity)
- Integration patterns document (اختيار النمط المناسب لكل حالة)
- API-led connectivity design (Experience, Process, System APIs)
- Error handling و Retry strategies
- Data synchronization design (CDC, Batch, Real-time)

## التفاعل
- **مع Systems Analyst:** فهم تدفق البيانات بين الأنظمة
- **مع Backend:** تصميم واجهات التكامل
- **مع Data Engineer:** تكامل البيانات بين الأنظمة
- **مع Cloud Architect:** اختيار الـ integration services في السحابة
- **مع Security:** تأمين التكاملات (mTLS, API keys, OAuth)
