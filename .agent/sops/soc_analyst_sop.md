# SOP: SOC Analyst

## قبل البدء
- راجع `3-security/security_policies.md` للسياسات الأمنية
- راجع `3-security/zero_trust.md` لمبادئ الـ Zero Trust
- راجع `7-ops/incident_response.md` للاستجابة للحوادث

## سير العمل

### وردية يومية
1. افحص الـ SIEM dashboard للـ alerts الجديدة
2. صنّف الـ alerts (P0: استجابة فورية, P1: ساعة, P2: 4 ساعات, P3: 24 ساعة)
3. حقّق في الـ P0/P1 فوراً — ابدأ بالـ containment
4. وثّق كل خطوة في الـ incident timeline
5. ابحث عن الـ IoCs الجديدة في الـ threat intel feeds
6. حدّث الـ SOAR playbooks إن لزم
7. اكتب handoff report للوردية التالية

### التحقيق في Alert
1. تأكد أن alert ليس false positive
2. اجمع الـ logs (مصادر متعددة: SIEM, firewall, endpoint, cloud)
3. ابحث عن الـ root cause
4. حدد الـ blast radius (من تأثر؟)
5. ابدأ الـ containment (عزل host, تعطيل user, block IP)
6. أبلغ الـ incident commander
7. استمر في الـ investigation
8. اكتب التقرير النهائي

### تحديث SIEM Rules
1. حلّل الـ false positives rate
2. أضف استثناءات للـ known good activity
3. حسّن الـ correlation rules
4. اختبر الـ rules على historical data
5. deploy في staging أولاً
6. راقب لمدة 48 ساعة

## القياسات
- MTTR للـ alerts < 30 دقيقة (P0)
- False positive rate < 10%
- SIEM coverage — 100% من المصادر
- Threat intel brief — أسبوعي
- SOAR automation rate > 60%
