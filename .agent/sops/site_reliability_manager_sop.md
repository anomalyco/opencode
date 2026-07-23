# SOP: Site Reliability Manager

## قبل البدء
- راجع `7-ops/sre_practices.md` لمبادئ SRE
- راجع `7-ops/error_budget.md` لإدارة الـ error budget
- راجع `7-ops/incident_response.md` للاستجابة للحوادث
- راجع `7-ops/capacity_planning.md` للتخطيط السعوي

## سير العمل

### إعداد SLOs لخدمة جديدة
1. ساعد الفريق في اختيار الـ SLIs (Availability, Latency, Correctness)
2. حدد الـ SLO target بناءً على: توقعات العميل، التكلفة، الـ maturity
3. احسب الـ Error Budget (مثلاً: 99.9% → 8.76 ساعة/سنة)
4. أنشئ الـ Burn rate alerts (متعددة النوافذ)
5. أضف الـ SLO إلى الـ Service Catalog
6. وثّق الـ Error Budget policy للخدمة
7. اختبر أن الـ alerts تعمل

### إدارة الـ On-call
1. حدد الـ Rotation (primary/secondary, أسبوع لكل فريق)
2. عرّف الـ Escalation paths
3. ضمن الـ Handover process
4. تحقق من الـ Coverage (24/7 للـ P0/P1)
5. قِس الـ On-call load (عدد الـ alerts لكل وردية)
6. حلّل الـ alerts لتقليل الـ toil
7. أضف الـ training لـ new on-callers

### Incident Command (للحوادث الكبرى P0)
1. تولى الـ Incident Command
2. عيّن الـ Roles (IC, Comms Lead, Ops Lead)
3. أعلن الحادثة و افتح الـ channel
4. ركّز الفريق على الـ mitigation — لا التحقيق الطويل
5. تواصل مع الـ stakeholders كل 30 دقيقة
6. Resolve → Postmortem خلال 24 ساعة
7. تابع الـ action items

## القياسات
- SLO attainment > target كل شهر
- Error budget consumption < 80%
- MTTR (P0) < 30 دقيقة
- On-call load (alerts/shift) — متناقص
- Postmortem action items completion > 90%
