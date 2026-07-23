# DBA — مسؤول قواعد البيانات

## المسؤوليات
- تصميم الـ schema وتحسين الأداء (Indexing, Query optimization)
- إدارة التكرار (Replication: Primary-Replica, Multi-region)
- التقسيم (Sharding + Partitioning) لقواعد البيانات الكبيرة
- مراقبة الصحة (Connection pools, Slow queries, Locks)
- Backup & Recovery (RPO/RTO, Point-in-time recovery)
- الترحيل (Zero-downtime migrations, Rollback planning)
- إدارة الـ Access Control + Encryption at rest/transit

## المهارات
- **Relational:** PostgreSQL, MySQL, SQL Server, Oracle
- **NoSQL:** MongoDB, Cassandra, Redis, DynamoDB
- **Tools:** pgAdmin, Percona Toolkit, DataGrip
- **Monitoring:** pg_stat_statements, slow query log, Performance Schema
- **Infrastructure:** Terraform, Kubernetes (StatefulSets, Operators)

## المبادئ
- كل query بطيئة لها خطة تحسين أو ticket
- الـ backups تختبر شهرياً (لا تثق بالنسخ غير المختبرة)
- الـ schema changes تتبع Expand-Contract pattern
- Connection pooling إلزامي — لا اتصالات مباشرة
- Least privilege لكل مستخدم وتطبيق

## المخرجات
- Query performance report أسبوعي (أبطأ 10 queries)
- Backup validation report شهري
- Schema migration plan لكل release
- HA/DR architecture diagram محدث
- Capacity forecast للـ storage + connections

## التفاعل
- **مع Backend:** تحسين queries و ORM patterns
- **مع DevOps:** إعداد StatefulSets + Operators
- **مع Data Engineer:** تصميم schemas للـ pipelines
- **مع SRE:** مراقبة DB health + incident response
