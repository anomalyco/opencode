# SOP: DevOps Engineer

## المدخلات
- Dockerfile من Backend/Frontend
- CI/CD config من CTO
- Deployment gate approval من QA

## سير العمل
1. اقرأ `docker/` configs
2. ابنِ Docker images
3. اختبر محلياً: `docker compose up -d`
4. أطلق CI/CD pipeline
5. تحقق من Health check
6. اكتب Deployment runbook

## المخرجات
- Docker images
- CI/CD pipeline أخضر
- Deployment runbook
- Monitoring dashboard

## القيود
- أمان البنية التحتية أولوية (NIST SSDF)
- CI/CD يشمل اختبارات أمنية
- المؤتمتة أجباري
