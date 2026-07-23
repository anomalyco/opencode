# SOP: Legal Counsel

## قبل البدء
- راجع `3-security/open_source_governance.md` لسياسات المصادر المفتوحة
- راجع `3-security/compliance_automation.md` لأتمتة الامتثال
- راجع `3-security/data_privacy.md` لخصوصية البيانات

## سير العمل

### مراجعة Contract جديد
1. حدد نوع العقد (SaaS, NDA, MSA, Partnership, DPA)
2. استخدم القالب المعتمد — عدّل حسب الحاجة
3. راجع الـ liability caps و indemnification
4. راجع الـ data processing terms (GDPR compliance)
5. راجع الـ termination و SLA penalties
6. أضف الـ boilerplate (governing law, dispute resolution)
7. أرسل للطرف الآخر مع tracked changes
8. سجّل العقد النهائي في الـ contract repository

### Audit License لمكتبة جديدة
1. حدد الـ license (SPDX identifier)
2. قارن مع الـ allowlist المعتمد
3. افحص الـ copyleft vs permissive
4. حلّل الـ obligations (attribution, source disclosure)
5. اكتب التوصية (موافقة، رفض، شروط)
6. سجّل في الـ SBOM

### تقييم AI Training Data
1. هل البيانات تحتوي على PII؟
2. هل لديك الحق القانوني لاستخدامها للـ training؟
3. هل الـ consent يغطي استخدام AI؟
4. هل تنتهك حقوق النشر لأحد؟
5. وثّق الـ data provenance
6. اكتب legal opinion

## القياسات
- Contract review turnaround < 3 أيام
- Licensing compliance — 100%
- Legal issues per release < 1
- AI training data legality — 100% مؤكدة
