# SOP: Data Engineer

## قبل البدء
- راجع `6-data/data_migration.md` إن وجدت
- راجع `6-data/data_catalog.md` للتعرف على البيانات الموجودة

## سير العمل

### إضافة Data Pipeline جديدة
1. افهم مصدر البيانات (API, DB, File, Stream)
2. صمم الـ schema output (Avro/Parquet مع documentation)
3. سجّل في Data Catalog
4. اكتب الـ pipeline (Airflow DAG / Spark job / Flink job)
5. أضف quality checks (completeness, uniqueness, timeliness)
6. اختبر مع عينة بيانات حقيقية
7. deploy مع monitoring للـ latency + حجم البيانات
8. وثّق الـ pipeline في Knowledge Base

### تحسين Query بطيئة
1. استخدم `EXPLAIN ANALYZE` لفهم الخطة
2. أضف indexes مناسبة
3. حسّن الـ joins (تجنب N+1)
4. فكّر في partitioning للجداول الكبيرة
5. استخدم materialized views للـ aggregations المتكررة

## القياسات
- Pipeline latency < 10 دقائق
- Data quality score > 95%
- Cost per GB processed — متناقص
