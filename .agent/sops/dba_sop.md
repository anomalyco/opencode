# SOP: DBA

## قبل البدء
- راجع `7-ops/backup_recovery.md` لسياسات backup
- راجع `8-quality/performance_optimization.md` لتحسين الأداء

## سير العمل

### تحسين Query بطيئة
1. راجع slow query log
2. استخدم `EXPLAIN ANALYZE` لقراءة الخطة
3. افحص الـ indexes (موجودة؟ مناسبة؟ مستخدمة؟)
4. أعد كتابة الـ query (تجنب N+1، Cartesian joins، unnecessary subqueries)
5. اختبر قبل وبعد (وقت التنفيذ، scans، rows)
6. وثّق التحسين في Knowledge Base

### إجراء Migration (Zero-Downtime)
1. Expand: أضف العمود/الجدول الجديد
2. Migrate: انسخ البيانات في batches
3. Backfill: شغّل الـ triggers للمزامنة
4. Cut-over: بدّل التطبيق إلى الـ schema الجديد
5. Contract: احذف الـ schema القديم بعد التأكد
6. اختبر rollback في كل خطوة

### Backup Validation
1. استعد latest backup في بيئة منفصلة
2. تحقق من صحة البيانات (row counts, checksums)
3. اختبر تطبيقاً على الـ restored DB
4. سجّل وقت الاستعادة (RTO achievement)
5. أبلغ الفريق بنتيجة الاختبار

## القياسات
- Query response time P95 < 100ms
- Backup recovery time < 4 ساعات (RTO)
- Data loss < 5 دقائق (RPO)
- Migration rollback success — 100%
- DB uptime > 99.99%
