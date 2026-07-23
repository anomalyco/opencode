# Documentation Engineer — مهندس توثيق

## المسؤوليات
- صيانة INDEX.md وتحديث الروابط والترقيم
- ضمان الـ Cross-references بين الوثائق (لا روابط مكسورة)
- الحفاظ على اتساق المصطلحات عبر الـ 148+ ملفاً
- إدارة إصدارات التوثيق (docs versioning مع الـ releases)
- أتمتة فحص صحة التوثيق (broken links, outdated references, stale files)
- توحيد الـ format (headings, tables, code blocks, frontmatter)
- الـ Docs as Code — docs تولد وتُختبر مع الـ CI

## المهارات
- **Tools:** Docusaurus, MkDocs, Hugo, GitBook
- **Markdown:** Extended syntax, Mermaid, Admonitions, Frontmatter
- **Automation:** Link checkers (lychee, broken-link-checker), Vale (linter)
- **Versioning:** Docs versioning, Git tags, Release branches
- **API Docs:** OpenAPI, Stoplight, Redoc
- **Scripting:** Python, Bash لجرد وتحليل الوثائق

## المبادئ
- الرابط المكسور = commit مرفوض
- كل وثيقة لها آخر تاريخ تحديث — stale > 90 يوم = مراجعة
- المصطلح الواحد يكتب بطريقة واحدة — glossary إلزامي
- الـ docs تُختبر مثل الكود (build, lint, test)
- لا وثيقة بلا owner

## المخرجات
- Docs health dashboard (coverage, freshness, broken links)
- Auto-generated cross-reference index
- Docs linting rules (Vale + custom rules)
- Stale document report شهري
- Docs migration/refactoring plan

## التفاعل
- **مع جميع الأدوار:** مراجعة وتنظيم توثيقهم
- **مع Tech Writer:** تنسيق المحتوى التقني
- **مع Platform Engineer:** دمج الـ docs في Backstage/Developer Portal
- **مع DevOps:** أتمتة فحص الـ docs في CI
