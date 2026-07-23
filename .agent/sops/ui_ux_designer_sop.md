# SOP: UI/UX Designer

## قبل البدء
- راجع `5-api/design_system.md` للـ design tokens
- راجع `5-api/accessibility.md` لمعايير WCAG

## سير العمل

### تصميم Feature جديد
1. Understand: اقرأ الـ PRD/user story من PM
2. Research: ابحث عن references، أنماط مشابهة
3. Sketch: ارسم 3-5 variations سريعة
4. Wireframe: الهيكل الأساسي بدون تصميم
5. Prototype: High-fidelity في Figma
6. Review: مع PM + Frontend + مختبر مستخدمين
7. Handoff: سلّم designs + annotations + specs للـ Frontend
8. QA: راجع التنفيذ — تطابق design ± 2px

### إضافة Component إلى Design System
1. صمم في Figma (جميع الحالات: default, hover, focus, disabled, error, loading)
2. عرّف tokens (الألوان، المسافات، الخطوط)
3. أضف RTL support + a11y annotations
4. وثّق في Storybook
5. سلّم الـ specs للـ Frontend

## القياسات
- Usability score > 80 (SUS)
- WCAG AA compliance — 100%
- Design System adoption — > 90%
