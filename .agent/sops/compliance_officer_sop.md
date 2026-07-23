# SOP: Compliance Officer

## قبل البدء
- راجع `3-security/security_policies.md` للسياسات الأمنية
- راجع `3-security/data_privacy.md` لخصوصية البيانات
- راجع `3-security/compliance_automation.md` لأتمتة الامتثال
- راجع `3-security/open_source_governance.md` للتراخيص

## سير العمل

### إعداد لتدقيق خارجي
1. حدد نطاق التدقيق (SOC 2 / ISO 27001 / GDPR)
2. اطلع على قائمة الـ controls المطلوبة
3. جهز الأدلة (Evidence collection automation)
4. أجرِ تدقيقاً داخلياً أولاً (Dry run)
5. سدّ الثغرات قبل التدقيق الرسمي
6. قدّم الأدلة للمدقق
7. تابع الـ Corrective Actions بعد التدقيق

### DPIA (Data Privacy Impact Assessment)
1. صف معالجة البيانات (ما البيانات؟ لماذا؟ أين؟)
2. قيّم الضرورة والتناسب (Necessity + Proportionality)
3. حدد المخاطر على حقوق المستخدمين
4. خطط لتخفيف المخاطر
5. وثّق الـ DPIA
6. راجع مع CTO + Legal

### مراجعة License لمكتبة جديدة
1. حدد نوع الترخيص (MIT, Apache 2.0, GPL, AGPL)
2. قارن مع تراخيص المشروع الحالية
3. افحص الـ conflicts (مثل AGPL مع منتج تجاري مغلق)
4. سجّل في الـ SBOM (Software Bill of Materials)
5. أعطِ موافقة / رفض مع التبرير

## القياسات
- Audit pass rate — 100% (لا findings حرجة)
- Time to close compliance gaps < 30 يوماً
- Licensing compliance — 100% من الـ dependencies
- DPIA completed لكل ميزة جديدة قبل launch
- Training completion > 90% للفريق
