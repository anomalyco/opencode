---
title: السمات
description: اختر سمة مدمجة أو عرّف سمة خاصة بك.
---

مع OpenCode يمكنك الاختيار من بين عدة سمات مدمجة، أو استخدام سمة تتكيّف مع سمة terminal لديك، أو تعريف سمة مخصصة خاصة بك.

افتراضيًا، يستخدم OpenCode سمتنا `opencode`.

---

## متطلبات terminal

لكي تُعرض السمات بشكل صحيح مع لوحة ألوانها الكاملة، يجب أن يدعم terminal لديك **truecolor** (ألوان 24-بت). تدعم معظم تطبيقات terminal الحديثة ذلك افتراضيًا، لكن قد تحتاج إلى تفعيله:

- **التحقق من الدعم**: شغّل `echo $COLORTERM` - يجب أن يطبع `truecolor` أو `24bit`
- **تفعيل truecolor**: اضبط متغير البيئة `COLORTERM=truecolor` في ملف إعدادات shell
- **توافق terminal**: تأكد من أن محاكي terminal يدعم ألوان 24-بت (معظم تطبيقات terminal الحديثة مثل iTerm2 وAlacritty وKitty وWindows Terminal والإصدارات الحديثة من GNOME Terminal تدعم ذلك)

بدون دعم truecolor، قد تظهر السمات بدقة ألوان أقل أو تعود إلى أقرب تقريب ضمن 256 لونًا.

---

## السمات المدمجة

يأتي OpenCode مع عدة سمات مدمجة.

| الاسم                  | الوصف                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| `system`               | يتكيّف مع لون خلفية terminal لديك                                           |
| `tokyonight`           | مبني على سمة [Tokyonight](https://github.com/folke/tokyonight.nvim)         |
| `everforest`           | مبني على سمة [Everforest](https://github.com/sainnhe/everforest)            |
| `ayu`                  | مبني على السمة الداكنة [Ayu](https://github.com/ayu-theme)                  |
| `catppuccin`           | مبني على سمة [Catppuccin](https://github.com/catppuccin)                    |
| `catppuccin-macchiato` | مبني على سمة [Catppuccin](https://github.com/catppuccin)                    |
| `gruvbox`              | مبني على سمة [Gruvbox](https://github.com/morhetz/gruvbox)                  |
| `kanagawa`             | مبني على سمة [Kanagawa](https://github.com/rebelot/kanagawa.nvim)           |
| `nord`                 | مبني على سمة [Nord](https://github.com/nordtheme/nord)                      |
| `matrix`               | سمة خضراء على أسود بأسلوب الهاكر                                            |
| `one-dark`             | مبني على السمة الداكنة [Atom One](https://github.com/Th3Whit3Wolf/one-nvim) |

وغير ذلك؛ نضيف سمات جديدة باستمرار.

---

## سمة النظام

صُممت سمة `system` لتتكيّف تلقائيًا مع مخطط ألوان terminal لديك. وعلى عكس السمات التقليدية التي تستخدم ألوانًا ثابتة، فإن سمة _system_:

- **توليد تدرج رمادي**: تنشئ تدرجًا رماديًا مخصصًا اعتمادًا على لون خلفية terminal لديك، بما يضمن أفضل تباين.
- **استخدام ألوان ANSI**: تستفيد من ألوان ANSI القياسية (0-15) لإبراز الصياغة وعناصر الواجهة، والتي تحترم لوحة ألوان terminal لديك.
- **الحفاظ على افتراضيات terminal**: تستخدم `none` لألوان النص والخلفية للحفاظ على مظهر terminal الأصلي.

سمة النظام مناسبة للمستخدمين الذين:

- يريدون أن يطابق OpenCode مظهر terminal لديهم
- يستخدمون مخططات ألوان مخصصة لـ terminal
- يفضلون مظهرًا متسقًا عبر جميع تطبيقات terminal

---

## استخدام سمة

يمكنك اختيار سمة بفتح منتقي السمات باستخدام الأمر `/theme`. أو يمكنك تحديدها في [الضبط](/docs/config).

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "theme": "tokyonight"
}
```

---

## سمات مخصصة

يدعم OpenCode نظام سمات مرنًا قائمًا على JSON يتيح للمستخدمين إنشاء السمات وتخصيصها بسهولة.

---

### التسلسل الهرمي

تُحمَّل السمات من عدة مجلدات بالترتيب التالي، حيث تتجاوز المجلدات اللاحقة المجلدات السابقة:

1. **السمات المدمجة** - تكون مضمنة داخل الملف التنفيذي
2. **مجلد ضبط المستخدم** - معرّف في `~/.config/opencode/themes/*.json` أو `$XDG_CONFIG_HOME/opencode/themes/*.json`
3. **مجلد جذر المشروع** - معرّف في `<project-root>/.opencode/themes/*.json`
4. **مجلد العمل الحالي** - معرّف في `./.opencode/themes/*.json`

إذا احتوت عدة مجلدات على سمة بالاسم نفسه، فستُستخدم السمة من المجلد ذي الأولوية الأعلى.

---

### إنشاء سمة

لإنشاء سمة مخصصة، أنشئ ملف JSON في أحد مجلدات السمات.

للسمات على مستوى المستخدم:

```bash no-frame
mkdir -p ~/.config/opencode/themes
vim ~/.config/opencode/themes/my-theme.json
```

وللسمات الخاصة بالمشروع:

```bash no-frame
mkdir -p .opencode/themes
vim .opencode/themes/my-theme.json
```

---

### تنسيق JSON

تستخدم السمات تنسيق JSON مرنًا مع دعم لـ:

- **ألوان سداسية عشرية**: `"#ffffff"`
- **ألوان ANSI**: `3` (0-255)
- **مراجع الألوان**: `"primary"` أو تعريفات مخصصة
- **متغيرات داكن/فاتح**: `{"dark": "#000", "light": "#fff"}`
- **بدون لون**: `"none"` - يستخدم اللون الافتراضي لـ terminal أو يكون شفافًا

---

### تعريفات الألوان

قسم `defs` اختياري، ويتيح لك تعريف ألوان قابلة لإعادة الاستخدام يمكن الإشارة إليها داخل السمة.

---

### افتراضيات terminal

يمكن استخدام القيمة الخاصة `"none"` لأي لون لوراثة اللون الافتراضي لـ terminal. هذا مفيد خصوصًا لإنشاء سمات تمتزج بسلاسة مع مخطط ألوان terminal لديك:

- `"text": "none"` - يستخدم لون المقدمة الافتراضي لـ terminal
- `"background": "none"` - يستخدم لون الخلفية الافتراضي لـ terminal

---

### مثال

إليك مثالًا على سمة مخصصة:

```json title="my-theme.json"
{
  "$schema": "https://opencode.ai/theme.json",
  "defs": {
    "nord0": "#2E3440",
    "nord1": "#3B4252",
    "nord2": "#434C5E",
    "nord3": "#4C566A",
    "nord4": "#D8DEE9",
    "nord5": "#E5E9F0",
    "nord6": "#ECEFF4",
    "nord7": "#8FBCBB",
    "nord8": "#88C0D0",
    "nord9": "#81A1C1",
    "nord10": "#5E81AC",
    "nord11": "#BF616A",
    "nord12": "#D08770",
    "nord13": "#EBCB8B",
    "nord14": "#A3BE8C",
    "nord15": "#B48EAD"
  },
  "theme": {
    "primary": {
      "dark": "nord8",
      "light": "nord10"
    },
    "secondary": {
      "dark": "nord9",
      "light": "nord9"
    },
    "accent": {
      "dark": "nord7",
      "light": "nord7"
    },
    "error": {
      "dark": "nord11",
      "light": "nord11"
    },
    "warning": {
      "dark": "nord12",
      "light": "nord12"
    },
    "success": {
      "dark": "nord14",
      "light": "nord14"
    },
    "info": {
      "dark": "nord8",
      "light": "nord10"
    },
    "text": {
      "dark": "nord4",
      "light": "nord0"
    },
    "textMuted": {
      "dark": "nord3",
      "light": "nord1"
    },
    "background": {
      "dark": "nord0",
      "light": "nord6"
    },
    "backgroundPanel": {
      "dark": "nord1",
      "light": "nord5"
    },
    "backgroundElement": {
      "dark": "nord1",
      "light": "nord4"
    },
    "border": {
      "dark": "nord2",
      "light": "nord3"
    },
    "borderActive": {
      "dark": "nord3",
      "light": "nord2"
    },
    "borderSubtle": {
      "dark": "nord2",
      "light": "nord3"
    },
    "diffAdded": {
      "dark": "nord14",
      "light": "nord14"
    },
    "diffRemoved": {
      "dark": "nord11",
      "light": "nord11"
    },
    "diffContext": {
      "dark": "nord3",
      "light": "nord3"
    },
    "diffHunkHeader": {
      "dark": "nord3",
      "light": "nord3"
    },
    "diffHighlightAdded": {
      "dark": "nord14",
      "light": "nord14"
    },
    "diffHighlightRemoved": {
      "dark": "nord11",
      "light": "nord11"
    },
    "diffAddedBg": {
      "dark": "#3B4252",
      "light": "#E5E9F0"
    },
    "diffRemovedBg": {
      "dark": "#3B4252",
      "light": "#E5E9F0"
    },
    "diffContextBg": {
      "dark": "nord1",
      "light": "nord5"
    },
    "diffLineNumber": {
      "dark": "nord2",
      "light": "nord4"
    },
    "diffAddedLineNumberBg": {
      "dark": "#3B4252",
      "light": "#E5E9F0"
    },
    "diffRemovedLineNumberBg": {
      "dark": "#3B4252",
      "light": "#E5E9F0"
    },
    "markdownText": {
      "dark": "nord4",
      "light": "nord0"
    },
    "markdownHeading": {
      "dark": "nord8",
      "light": "nord10"
    },
    "markdownLink": {
      "dark": "nord9",
      "light": "nord9"
    },
    "markdownLinkText": {
      "dark": "nord7",
      "light": "nord7"
    },
    "markdownCode": {
      "dark": "nord14",
      "light": "nord14"
    },
    "markdownBlockQuote": {
      "dark": "nord3",
      "light": "nord3"
    },
    "markdownEmph": {
      "dark": "nord12",
      "light": "nord12"
    },
    "markdownStrong": {
      "dark": "nord13",
      "light": "nord13"
    },
    "markdownHorizontalRule": {
      "dark": "nord3",
      "light": "nord3"
    },
    "markdownListItem": {
      "dark": "nord8",
      "light": "nord10"
    },
    "markdownListEnumeration": {
      "dark": "nord7",
      "light": "nord7"
    },
    "markdownImage": {
      "dark": "nord9",
      "light": "nord9"
    },
    "markdownImageText": {
      "dark": "nord7",
      "light": "nord7"
    },
    "markdownCodeBlock": {
      "dark": "nord4",
      "light": "nord0"
    },
    "syntaxComment": {
      "dark": "nord3",
      "light": "nord3"
    },
    "syntaxKeyword": {
      "dark": "nord9",
      "light": "nord9"
    },
    "syntaxFunction": {
      "dark": "nord8",
      "light": "nord8"
    },
    "syntaxVariable": {
      "dark": "nord7",
      "light": "nord7"
    },
    "syntaxString": {
      "dark": "nord14",
      "light": "nord14"
    },
    "syntaxNumber": {
      "dark": "nord15",
      "light": "nord15"
    },
    "syntaxType": {
      "dark": "nord7",
      "light": "nord7"
    },
    "syntaxOperator": {
      "dark": "nord9",
      "light": "nord9"
    },
    "syntaxPunctuation": {
      "dark": "nord4",
      "light": "nord0"
    }
  }
}
```
