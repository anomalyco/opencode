# SOP: Data Scientist

## قبل البدء
- راجع `6-data/data_catalog.md` للبيانات المتاحة
- راجع `6-data/feature_store.md` للـ features الموجودة
- راجع `8-quality/quality_metrics.md` للـ metrics المعتمدة

## سير العمل

### تحليل مشكلة تجارية
1. افهم السؤال التجاري من PM/BA
2. اكتب الـ hypothesis بوضوح
3. ابحث عن البيانات المتاحة (Data Catalog)
4. EDA: أعد توزيع البيانات، القيم المفقودة، الـ outliers
5. اختبر الفرضية (t-test, chi-square, Bayesian A/B)
6. قدّم النتائج مع visualizations
7. سجّل الـ findings في Knowledge Base

### بناء ML Model
1. عرّف الـ business metric أولاً
2. Feature engineering من الـ Feature Store
3. اختر baseline (simple heuristic أو linear model)
4. جرّب 3-5 models مع cross-validation
5. حسّن hyperparameters (Optuna, Grid Search)
6. قيّم على test set مع الـ business metric
7. سجّل الـ model + features في Model Registry
8. اكتب report مع business impact

### A/B Testing
1. عرّف الـ metric الأساسي (Primary)
2. احسب sample size المطلوب
3. صمم الـ randomization (user/session level)
4. حدد minimum detectable effect
5. ركّض التجربة للمدة المحسوبة
6. حلّل النتائج (frequentist + Bayesian)
7. اكتب التوصية النهائية

## القياسات
- Model accuracy/RMSE على test set
- Business impact لكل model (شرح بـ $)
- A/B test confidence > 95%
- Time from hypothesis → insights < 5 أيام
