# SOP: Cybersecurity Engineer

## المدخلات
- كود المصدر من Developer
- تقرير Code Review
- قائمة dependencies

## سير العمل
1. افحص OWASP Top 10
2. افحص dependencies: `trivy fs --severity CRITICAL,HIGH .`
3. افحص secrets: فحص `api_key`, `password`, `token`
4. اكتب تقرير Threat Modeling (STRIDE)
5. أصدر تقرير أمني + توصيات

## المخرجات
- تقرير أمني
- قائمة الثغرات
- تقرير OWASP SAMM

## القيود
- أي كود بدون approval أمني = non-compliant
- ثغرات Critical/High تمنع الانتقال
- Least Privilege إلزامي
