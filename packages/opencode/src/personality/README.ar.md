# نظام الشخصيات (Personality System)

## نظرة عامة

يوفر OpenCode نظام شخصيات متقدم يسمح لك بإنشاء وكلاء ذكيين مخصصين بصفات فريدة وقدرات تعلم مستمرة.

## الميزات الرئيسية

### 1. إنشاء شخصية مخصصة

يمكنك إنشاء شخصية جديدة بإضافة ملف Markdown في مجلد `personalities/` أو `personality/`:

```markdown
---
name: محمد
description: مساعد ذكي متخصص في البرمجة وتطوير التطبيقات
mode: primary
color: primary
model:
  providerID: anthropic
  modelID: claude-sonnet-4-20250514
options:
  temperature: 0.7
  top_p: 0.9
permission:
  "*": allow
  edit:
    "*.ts": allow
    "*.js": allow
steps: 50
traits:
  - دقيق
  - منظم
  - صبور
learning_enabled: true
learning_file: learnings.md
---

# وصف الشخصية

أنا محمد، مساعد ذكي متخصص في البرمجة...
```

### 2. حقول التكوين المتاحة

| الحقل | النوع | الوصف |
|-------|-------|--------|
| `name` | string | اسم الشخصية (مطلوب) |
| `description` | string | وصف الشخصية ومتى تُستخدم |
| `mode` | "primary" \| "subagent" \| "all" | وضع التشغيل |
| `color` | string | لون الشخصية (hex أو theme color) |
| `model` | object | النموذج المستخدم (providerID + modelID) |
| `temperature` | number | درجة الإبداع (0-1) |
| `top_p` | number | Top-p sampling |
| `prompt` | string | System prompt للشخصية |
| `permission` | object | قواعد الصلاحيات |
| `steps` | number | أقصى عدد من الخطوات |
| `traits` | string[] | قائمة صفات الشخصية |
| `learning_enabled` | boolean | تفعيل ميزة التعلم (افتراضي: true) |
| `learning_file` | string | مسار ملف التعلم النسبي |
| `options` | object | خيارات إضافية مخصصة |

### 3. نظام التعلم المستمر

كل شخصية لها ملف `learnings.md` خاص بها يتم تخزينه في:
```
.opencode/agents/{اسم_الشخصية}/learnings.md
```

#### كيفية عمل التعلم:

1. **عند حدوث خطأ**: يتم تسجيل الدرس المستفاد تلقائيًا
2. **قراءة التعلم السابق**: قبل كل مهمة، تقرأ الشخصية ما تعلمته سابقًا
3. **التحديث المستمر**: يزداد ملف التعلم مع كل تجربة جديدة
4. **التعديل الذاتي**: الوكيل يمكنه تعديل ملف التعلم وشخصيته ذاتيًا باستخدام الأدوات المدمجة

#### أدوات الوكيل للتعلم الذاتي:

الوكيل يمتلك ثلاث أدوات رئيسية للتعلم والتطور:

**أ. `update_learning`** - إضافة دروس جديدة لملف `learnings.md`
```typescript
await tools.update_learning({
  lesson: "- تعلمت كيفية التعامل مع الملفات الكبيرة",
  date: "2024-01-15"
})
```

**ب. `update_personality_profile`** - تعديل سمات ووصف الشخصية
```typescript
await tools.update_personality_profile({
  traits: ["دقيق", "منظم", "صبور", "سريع التعلم"],
  description: "مساعد ذكي متخصص في البرمجة وتطوير التطبيقات"
})
```

**ج. `read_personality_context`** - قراءة ملف التعريف والتعلم الحاليين
```typescript
const context = await tools.read_personality_context()
console.log(context.profile) // ملف التعريف
console.log(context.learnings) // جميع الدروس المستفادة
```

#### مثال على درس مُضاف:

```markdown
---

## [2024-01-15] التعامل مع الملفات الكبيرة

- **الموقف**: حاولت قراءة ملف كبير جدًا دفعة واحدة مما تسبب في نفاذ الذاكرة
- **ما تم تعلمه**: يجب استخدام القراءة المتدفقة (streaming) للملفات الكبيرة
- **كيف سيتم تجنبه**: سأتحقق دائمًا من حجم الملف قبل قراءته وأستخدم streaming إذا كان أكبر من 1MB
```

### 4. استخدام الشخصيات

#### في سطر الأوامر:
```bash
opencode --personality محمد "اكتب لي تطبيق React"
```

#### في المحادثة:
```
@محمد اكتب لي دالة للتعامل مع التاريخ
```

### 5. أمثلة على الشخصيات

#### شخصية المطور الخبير:
```markdown
---
name: خبير
description: مطور برمجيات خبير متخصص في الحلول المعقدة
mode: primary
temperature: 0.5
traits:
  - محترف
  - دقيق
  - منهجي
---

أنا خبير، مطور برمجيات بخبرة 10 سنوات...
```

#### شخصية المبتكر المبدع:
```markdown
---
name: مبدع
description: مساعد إبداعي للحلول المبتكرة والتصميم
mode: primary
temperature: 0.9
color: "#FF5733"
traits:
  - مبدع
  - خيالي
  - جريء
---

أنا مبدع، أساعدك في ابتكار حلول فريدة...
```

### 6. إدارة ملفات التعلم

#### قراءة التعلم:
```bash
cat .opencode/agents/محمد/learnings.md
```

#### إضافة درس يدويًا:
```markdown
## [2024-01-20] عنوان الدرس

- وصف الموقف
- ما تم تعلمه
- كيفية التطبيق مستقبلاً
```

## أفضل الممارسات

1. **سمِّ الشخصية بوضوح**: اختر اسمًا يعكس دور الشخصية
2. **حدد الصفات بدقة**: كلما كانت الصفات محددة، كان الأداء أفضل
3. **راجع التعلم دوريًا**: احذف الدروس القديمة غير ذات صلة
4. **اضبط درجة الحرارة**: استخدم قيم منخفضة للمهام الدقيقة ومرتفعة للإبداع
5. **وثّق الأخطاء المهمة**: سجّل فقط الدروس التي ستؤثر على السلوك المستقبلي

## استكشاف الأخطاء

### الشخصية لا تظهر:
- تأكد من أن الملف في المجلد الصحيح (`personalities/` أو `personality/`)
- تحقق من صحة YAML frontmatter
- تأكد من أن `mode` ليس `subagent` إذا كنت تريدها كخيار افتراضي

### التعلم لا يُحفظ:
- تحقق من أن `learning_enabled: true`
- تأكد من وجود صلاحيات الكتابة في مجلد `.opencode`
- راجع سجلات النظام للأخطاء

## API للمطورين

```typescript
import { Personality } from "@opencode/personality"

// الحصول على ملف التعلم
const learningFile = await Personality.getLearningFile("محمد")

// إضافة درس جديد
await Personality.appendLearning({
  personalityName: "محمد",
  lesson: "- تعلمت كيفية التعامل مع الملفات الكبيرة",
  date: "2024-01-15"
})

// قراءة جميع التعلميات
const learnings = await Personality.readLearnings("محمد")
```

## مساحات العمل المتعددة (Multi-Project Workspaces) 🆕

يمكن للوكيل العمل على عدة مشاريع مترابطة في نفس الوقت باستخدام نظام مساحات العمل:

### ربط المشاريع

```bash
# إنشاء مساحة عمل جديدة تربط بين مشاريع متعددة
opencode workspace:create "fullstack-app" --projects ./frontend ./backend ./shared
```

### أدوات الوكيل لمساحات العمل:

**أ. `link_projects`** - ربط مشاريع متعددة في مساحة عمل واحدة
```typescript
await tools.link_projects({
  name: "fullstack-app",
  projects: ["./frontend", "./backend", "./shared"]
})
```

**ب. `get_workspace_context`** - الحصول على سياق مشترك لجميع المشاريع المرتبطة
```typescript
const context = await tools.get_workspace_context()
console.log(context.projects) // قائمة المشاريع المرتبطة
console.log(context.sharedFiles) // الملفات المشتركة
```

### ميزات مساحات العمل:

- **سياق مشترك**: الوكيل يفهم العلاقات والتبعيات بين المشاريع المرتبطة
- **إدارة مركزية**: إدارة جميع المشاريع من واجهة موحدة في تطبيق سطح المكتب
- **تعلم عبر المشاريع**: ملفات `learnings.md` يمكنها تخزين دروس مشتركة بين المشاريع
- **تبديل سريع**: اختر مساحة العمل النشطة مباشرة من حقل كتابة الرسالة

### مثال على استخدام مساحة عمل:

```markdown
---
workspace: fullstack-app
personality: محمد
---

@محمد قم بإضافة endpoint جديد في الـ backend وتحديث الـ frontend لاستخدامه
```

الوكيل سيفهم تلقائيًا هيكلية المشاريع الثلاثة وسيعرف أين يضيف الكود المناسب.
