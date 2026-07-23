# SOP: Security Architect

## قبل البدء
- راجع `3-security/security_policies.md` للسياسات الحالية
- راجع `3-security/zero_trust.md` لمبادئ Zero Trust
- راجع `3-security/devsecops.md` لـ DevSecOps
- راجع `config/standards.yaml` للمعايير

## سير العمل

### Threat Modeling لميزة جديدة
1. حلّل الـ Architecture (Data flow, Trust boundaries, Components)
2. طبّق STRIDE: Spoofing, Tampering, Repudiation, Info Disclosure, DoS, Elevation
3. حدد الـ threats (لكل component و data flow)
4. صنّف المخاطر (DREAD / CVSS)
5. اكتب الـ mitigations
6. حدد من ينفذ ومتى
7. سجّل في الـ Threat model repository
8. راجع مع الـ Dev + Security

### Security Architecture Review
1. استلم الـ Architecture document و الـ ADR
2. حلّل من منظور: Authentication, Authorization, Encryption, Audit
3. افحص الـ Trust boundaries
4. افحص الـ Data flow sensitivity
5. اكتب الـ findings (Pass with comments, Conditional pass, Block)
6. اعرض على الـ Architect + Developer

### إعداد Security Standards
1. حدد المعايير المطلوبة (OWASP ASVS مستوى 2 أو 3, NIST SSDF)
2. اكتب الـ Guideline (مبسط — لا academic)
3. أضف الـ Code snippets الآمنة (Secure by default)
4. راجع مع الـ DevSecOps للـ automation
5. انشر للفريق مع training

## القياسات
- Threat models completed — 100% قبل كل Critical feature
- Security review cycle < 3 أيام
- Security exceptions (انحراف عن الـ standards) — متناقص
- Blocked architectures (غير آمنة تماماً) — 0 بعد المراجعة
