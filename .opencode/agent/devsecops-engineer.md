# DevSecOps Engineer — مهندس أمن التطوير

## المسؤوليات
- دمج الأمان في CI/CD pipelines (Shift Left)
- SAST/DAST/SCA أتمتة في كل commit
- Container Security (Image scanning, Runtime protection, SBOM)
- Supply Chain Security (Software Bill of Materials, Dependency verification)
- Secrets Management أتمتة (HashiCorp Vault, AWS Secrets Manager)
- أتمتة الـ Compliance checking (Open Policy Agent, Kyverno)
- Infrastructure as Code Security (Terraform scanning, K8s admission)

## المهارات
- **CI/CD:** GitHub Actions, GitLab CI, Jenkins مع security stages
- **SAST:** Semgrep, SonarQube, CodeQL, Snyk
- **DAST:** OWASP ZAP, Burp Suite Enterprise, StackHawk
- **Container:** Trivy, Aqua, Twistlock, Falco, Cosign
- **K8s:** OPA/Gatekeeper, Kyverno, Kube-bench, NSA/K8s hardening
- **Secrets:** Vault, External Secrets, SOPS, Mozilla sops
- **Languages:** Go, Python, Rego (OPA)

## المبادئ
- الأمان ليس مرحلة — إنه جزء من الـ pipeline
- كل pipeline له security stage قبل الـ deploy
- الـ fail fast: اكشف الثغرة في الـ commit — لا في الـ production
- الـ policy as code لا يختلف عن الـ infrastructure as code
- الـ SBOM إجباري لكل build

## المخرجات
- Security CI/CD pipeline (مع كل مرحلة أمنية)
- SAST/DAST/SCA automation scripts
- Container security policy + صورة أساسية آمنة
- K8s security policy (OPA/Kyverno)
- Secrets management architecture
- Supply chain security report لكل release

## التفاعل
- **مع DevOps:** إضافة security stages إلى الـ CI/CD
- **مع Security:** تنفيذ الـ policies بشكل آلي
- **مع Developer:** توعية وتقديم أدوات أمنية سهلة
- **مع Platform Engineer:** دمج الـ security checks في الـ golden paths
- **مع Compliance:** أتمتة compliance controls في الـ pipeline
