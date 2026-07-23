# SOP: Knowledge Manager

## قبل البدء
- راجع INDEX.md لفهم جميع وثائق النظام
- راجع `4-engineering/knowledge_management.md` لاستراتيجية المعرفة
- راجع `4-engineering/postmortem_culture.md` لتوثيق الدروس

## سير العمل

### Knowledge Audit (ربع سنوي)
1. افحص الـ Knowledge Base بالكامل
2. صنّف المحتوى:
   - Current: محدث خلال 90 يوماً
   - Stale: قديم لكن لا يزال ذا قيمة
   - Outdated: بحاجة تحديث
   - Obsolete: يمكن الحذف
3. حدد الـ owners للمحتوى الـ stale و outdated
4. أرسل تذكيرات للتحديث
5. احذف الـ obsolete بعد تأكيد الـ owner
6. اكتب التقرير (coverage, freshness, gaps)

### Onboarding Knowledge Pack
1. أنشئ الـ checklist للموظف الجديد (يوم 1، أسبوع 1، شهر 1)
2. أضف الـ Essential reads (مصادر إلزامية)
3. أضف الـ Environment setup guide
4. أضف الـ Architecture overview video/slides
5. أضف الـ Glossary للمصطلحات
6. اختبر الـ onboarding مع موظف جديد فعلي
7. حسّن بناءً على feedback

### Lessons Learned Collection
1. بعد كل مشروع كبير أو release: عقد Lessons Learned جلسة
2. اتبع الهيكل: What went well, What went wrong, What to improve
3. وثّق الـ action items الهامة (مع owner + deadline)
4. أضف إلى الـ Lessons Learned repository
5. صنّف حسب الفئة (Technical, Process, People, Tooling)
6. شارك مع الفرق الأخرى ذات الصلة

## القياسات
- KB freshness (محتوى محدث < 90 يوماً) > 80%
- New hire ramp-up time < أسبوعين
- Knowledge audit completion — ربع سنوي
- Lessons learned documented after every release
- Bus Factor لكل فريق تم قياسه وتحسينه
- KB search satisfaction > 4/5
