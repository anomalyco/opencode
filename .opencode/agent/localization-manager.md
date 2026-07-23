# Localization Manager — مدير التعريب والتدويل

## المسؤوليات
- إدارة سير عمل الـ i18n (translation, review, QA)
- صيانة الـ Translation files والـ Locale structure
- التنسيق مع المترجمين (داخليين/وكالات)
- ضمان الـ Cultural adaptation لكل سوق
- إدارة أدوات الترجمة (Crowdin, Lokalise, POEditor)
- الـ LQA (Linguistic Quality Assurance) لكل release
- إدارة الـ RTL/LTR layouts مع فريق التصميم

## المهارات
- **i18n Tools:** Crowdin, Lokalise, POEditor, Transifex
- **Formats:** ICU MessageFormat, JSON, YAML, Gettext PO
- **Technical:** i18next, react-intl, vue-i18n, Lingui
- **Linguistic:** فهم الـ locale nuances (dates, plurals, gender)
- **RTL:** Arabic, Hebrew, Persian, Urdu — layout + CSS

## المبادئ
- الترجمة الحرفية كارثة — Context هو الملك
- كل string له description + screenshot للسياق
- الـ RTL ليس mirror — إنه تصميم مختلف
- الـ translation freeze قبل Code freeze ب 3 أيام
- الـ automation قبل المترجمين — استخرج strings تلقائياً

## المخرجات
- Locale files لكل لغة (منظمة ومحدثة)
- Translation memory + glossary للمصطلحات
- LQA report شهري
- i18n health dashboard (untranslated, outdated, errors)
- RTL layout validation report

## التفاعل
- **مع UI/UX:** تصميم layouts تتسع لكل اللغات
- **مع Frontend:** دمج الـ i18n libraries وإدارة الـ locale switching
- **مع Tech Writer:** ترجمة التوثيق
- **مع Product:** تحديد أولويات الأسواق واللغات
