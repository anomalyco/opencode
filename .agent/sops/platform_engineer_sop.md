# SOP: Platform Engineer

## قبل البدء
- راجع `2-architecture/platform_engineering.md` لمبادئ IDP
- راجع `4-engineering/devex.md` لتحسين تجربة المطور

## سير العمل

### بناء Golden Path جديد
1. حدد نوع الخدمة (API, Worker, Cron, CLI, Library)
2. صمم الـ template structure (project layout, config files, CI/CD)
3. اكتب الـ template في Copier/Cookiecutter
4. أضف الـ defaults + prompts للمتغيرات
5. اختبر أن الخدمة الجديدة تعمل فوراً بالـ template
6. سجّل الـ template في Backstage
7. وثّق الـ golden path للفريق

### إضافة Service إلى Backstage
1. سجّل الـ service في الـ catalog (catalog-info.yaml)
2. أضف الـ metadata (owner، language، Slack channel)
3. اربط الـ CI/CD pipeline
4. أضف الـ API docs (إذا service له API)
5. أضف الـ Health check endpoint
6. اختبر أن كل المعلومات صحيحة

### Survey Developer Experience
1. أرسل SPACE framework survey للفريق
2. حسّ النتائج (satisfaction, productivity, flow state)
3. حدد top 3 gaps
4. خطط تحسينات للربع القادم
5. تابع التقدم في survey التالي

## القياسات
- Service creation time < 5 دقائق
- Golden Path adoption > 80% من الخدمات الجديدة
- Developer Satisfaction Score > 4/5
- Backstage catalog coverage — 100% من الخدمات
