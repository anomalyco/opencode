# SOP: Site Reliability Engineer

## قبل البدء
- راجع `7-ops/monitoring_observability.md`
- راجع `7-ops/incident_response.md`
- راجع `7-ops/error_budget.md`
- راجع `7-ops/capacity_planning.md`
- راجع `7-ops/chaos_engineering.md`

## سير العمل

### تعريف SLO لخدمة جديدة
1. حدد الـ SLIs (Availability, Latency P95, Error Rate)
2. حدد الـ targets (مثلاً: 99.9% Availability, P95 < 500ms)
3. احسب الـ Error Budget (1 - SLO) x الوقت
4. أنشئ dashboards في Grafana للـ burn rate
5. أنشئ alerts (multi-window, multi-burn-rate)
6. وثّق الـ runbook لكل alert

### Incident Response
1. Acknowledge (PagerDuty — أسرع من 5 دقائق)
2. Triage: هل P0/P1/P2/P3؟
3. إعلان القناة + فتح War Room إن لزم
4. حلّ مع الفريق — IC يقرر
5. Resolve + أعلن all-clear
6. اكتب postmortem خلال 24 ساعة (P0/P1)
7. تابع الـ action items

### Game Day (Chaos Experiment)
1. اختر فرضية: "إذا فشلت DB، النظام يتحمل"
2. صمم experiment (blast radius صغير)
3. أبلغ الفريق
4. نفّذ في staging أولاً
5. قِس الـ metrics
6. وثّق النتائج + الدروس
7. أضف تحسينات

## القياسات
- MTTD < 5 min
- MTTR < 30 min (P0)
- Error Budget consumption < 80%
- Toil < 30% من الوقت
