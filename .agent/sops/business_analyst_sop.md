# SOP: Business Analyst

## قبل البدء
- راجع الفكرة/الطلب من PM
- راجع `4-engineering/sprint_planning.md` لفهم الـ sprint structure

## سير العمل

### استخراج Requirements لميزة جديدة
1. Interview الـ stakeholders (اسأل "لماذا" 5 مرات)
2. اكتب الـ Business Context (مشكلة، فرصة، أثر)
3. عرّف الـ Scope (in-scope / out-of-scope)
4. اكتب الـ User Stories (format: As a… I want… So that…)
5. أضف Acceptance Criteria (Given-When-Then)
6. عرّف الـ Non-functional Requirements (performance, security, a11y)
7. اعمل Process map (AS-IS → TO-BE)
8. راجع مع PM + Architect + Developer
9. أضف إلى الـ Traceability Matrix

### Gap Analysis
1. وثّق الوضع الحالي (AS-IS)
2. وثّق الوضع المطلوب (TO-BE)
3. حدد الفجوات
4. صنّف الفجوات (تقنية / عملية / معرفة)
5. أعطِ توصيات لكل فجوة مع الـ impact
6. راجع مع CTO + PM

## القياسات
- Requirements clarity score (تقييم الفريق) > 4/5
- Requirements change rate < 20% بعد الـ approval
- Time from request → documented requirements < 3 أيام
- Traceability coverage — 100% من الـ requirements مغطاة بـ tests
