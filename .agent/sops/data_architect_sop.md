# SOP: Data Architect

## قبل البدء
- راجع `6-data/data_catalog.md` لفهرس البيانات
- راجع `6-data/feature_store.md` لـ feature engineering
- راجع `2-architecture/data_mesh.md` لمبادئ توزيع البيانات
- راجع `2-architecture/schema_registry.md` لإدارة الـ schemas

## سير العمل

### تصميم Data Strategy
1. حلّل الـ current state (حيث توجد البيانات اليوم)
2. حدد الـ gaps (ما المفقود، ما المكرر)
3. صمم الـ Target Architecture (Data Mesh / Data Lake / Warehouse)
4. عرّف الـ Data Domains و الـ Owners
5. عرّف الـ Governance Framework (Standards, Quality, Access)
6. حدد الـ Technology stack
7. اكتب الـ Data Strategy document
8. اعرض على CTO + Architects للموافقة

### إعداد Data Governance Framework
1. عرّف الـ Data Standards (naming, types, formats)
2. عرّف الـ Data Quality قواعد (completeness, uniqueness, timeliness, validity)
3. عرّف الـ Ownership لكل Domain
4. عرّف الـ Access Controls (من يرى ماذا)
5. عرّف الـ Metadata Management (ما البيانات، أين، كيف تُستخدم)
6. وثّق الـ framework
7. نفذ الـ training للفرق

### تصميم Data Platform
1. حلّل الـ workloads (OLTP, OLAP, Streaming, ML)
2. اختر الـ Storage (Object Store, Data Warehouse, Data Lakehouse)
3. اختر الـ Compute (Spark, Presto, DBT)
4. اختر الـ Ingestion (Batch: Airbyte, Streaming: Kafka)
5. صمم الـ Data Lineage tracking
6. احسب الـ cost estimate
7. اكتب الـ architecture document

## القياسات
- Data quality score (متوسط عبر domains) > 90%
- Data coverage (كل domain له owner) — 100%
- Data platform uptime > 99.9%
- Governance adoption — 80% من teams يتبعون المعايير
- Time to access new data source < أسبوع
