# SOP: DevSecOps Engineer

## قبل البدء
- راجع `3-security/devsecops.md` لمبادئ Shift Left
- راجع `3-security/zero_trust.md` لمبادئ الـ Zero Trust
- راجع `config/pipeline.yaml` للـ CI/CD pipeline

## سير العمل

### إضافة Security CI/CD Pipeline
1. صمم الـ Security Stages في الـ pipeline:
   - Commit: Pre-commit hooks (secrets scan, lint)
   - Build: SAST + SCA + container scan
   - Test: DAST + dependency check
   - Deploy: IaC scan + compliance check
   - Post-deploy: Runtime monitoring
2. اختر الأدوات لكل مرحلة
3. اكتب الـ pipeline as code
4. اختبر (أضف vulnerability معروف للتأكد من الفشل)
5. أضف الـ Slack notification للأمان
6. وثّق الـ pipeline للفريق

### Container Security
1. اختر Base Image معروف (Distroless, Alpine, Chainguard)
2. افحص الـ image قبل كل build (Trivy, Grype)
3. وقّع الـ image (Cosign)
4. افحص الـ runtime (Falco لنظام K8s)
5. دقق في الـ SBOM لكل container image
6. حقن الـ Security Context في الـ K8s manifests

### Policy as Code مع OPA/Kyverno
1. اكتب القواعد (مثلاً: لا containers مع privileged: true)
2. اختبر الـ rules في CI
3. طبق في staging أولاً
4. طبق في production (audit mode أولاً، ثم enforce)
5. راقب الـ violations
6. حدّث القواعد حسب الحاجة

## القياسات
- Pipeline security stage pass rate > 90%
- Container vulnerabilities (Critical/High) — 0 في production
- Time from vulnerability detection → fix < 24 ساعة (Critical)
- Policy compliance rate > 95%
- SBOM generation — 100% من الـ builds
