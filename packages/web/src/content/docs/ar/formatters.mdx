---
title: المُنسِّقات
description: يستخدم OpenCode مُنسِّقات خاصة بكل لغة.
---

يُنسِّق OpenCode الملفات تلقائيا بعد كتابتها أو تعديلها باستخدام مُنسِّقات خاصة بكل لغة. يضمن ذلك أن الشيفرة التي يتم توليدها تتبع أساليب التنسيق المعتمدة في مشروعك.

---

## مُضمَّنة

يأتي OpenCode مع عدة مُنسِّقات مُضمَّنة للغات وأطر العمل الشائعة. فيما يلي قائمة بالمُنسِّقات وامتدادات الملفات المدعومة والأوامر أو خيارات الإعداد التي تحتاجها.

| المُنسِّق            | الامتدادات                                                                                               | المتطلبات                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| gofmt                | .go                                                                                                      | يتوفر أمر `gofmt`                                                                       |
| mix                  | .ex, .exs, .eex, .heex, .leex, .neex, .sface                                                             | يتوفر أمر `mix`                                                                         |
| prettier             | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml، و[غير ذلك](https://prettier.io/docs/en/index.html) | وجود اعتماد `prettier` في `package.json`                                                |
| biome                | .js, .jsx, .ts, .tsx, .html, .css, .md, .json, .yaml، و[غير ذلك](https://biomejs.dev/)                   | ملف إعداد `biome.json(c)`                                                               |
| zig                  | .zig, .zon                                                                                               | يتوفر أمر `zig`                                                                         |
| clang-format         | .c, .cpp, .h, .hpp, .ino، و[غير ذلك](https://clang.llvm.org/docs/ClangFormat.html)                       | ملف إعداد `.clang-format`                                                               |
| ktlint               | .kt, .kts                                                                                                | يتوفر أمر `ktlint`                                                                      |
| ruff                 | .py, .pyi                                                                                                | يتوفر أمر `ruff` مع إعداد                                                               |
| rustfmt              | .rs                                                                                                      | يتوفر أمر `rustfmt`                                                                     |
| cargofmt             | .rs                                                                                                      | يتوفر أمر `cargo fmt`                                                                   |
| uv                   | .py, .pyi                                                                                                | يتوفر أمر `uv`                                                                          |
| rubocop              | .rb, .rake, .gemspec, .ru                                                                                | يتوفر أمر `rubocop`                                                                     |
| standardrb           | .rb, .rake, .gemspec, .ru                                                                                | يتوفر أمر `standardrb`                                                                  |
| htmlbeautifier       | .erb, .html.erb                                                                                          | يتوفر أمر `htmlbeautifier`                                                              |
| air                  | .R                                                                                                       | يتوفر أمر `air`                                                                         |
| dart                 | .dart                                                                                                    | يتوفر أمر `dart`                                                                        |
| dfmt                 | .d                                                                                                       | يتوفر أمر `dfmt`                                                                        |
| ocamlformat          | .ml, .mli                                                                                                | يتوفر أمر `ocamlformat` وملف إعداد `.ocamlformat`                                       |
| terraform            | .tf, .tfvars                                                                                             | يتوفر أمر `terraform`                                                                   |
| gleam                | .gleam                                                                                                   | يتوفر أمر `gleam`                                                                       |
| nixfmt               | .nix                                                                                                     | يتوفر أمر `nixfmt`                                                                      |
| shfmt                | .sh, .bash                                                                                               | يتوفر أمر `shfmt`                                                                       |
| pint                 | .php                                                                                                     | وجود اعتماد `laravel/pint` في `composer.json`                                           |
| oxfmt (Experimental) | .js, .jsx, .ts, .tsx                                                                                     | وجود اعتماد `oxfmt` في `package.json` و[علم متغير بيئة تجريبي](/docs/cli/#experimental) |
| ormolu               | .hs                                                                                                      | يتوفر أمر `ormolu`                                                                      |

لذا إذا كان مشروعك يتضمن `prettier` ضمن `package.json`، فسيستخدمه OpenCode تلقائيا.

---

## كيف يعمل

عندما يكتب OpenCode ملفا أو يحرره، فإنه:

1. يتحقق من امتداد الملف مقابل جميع المُنسِّقات المفعّلة.
2. يشغّل أمر المُنسِّق المناسب على الملف.
3. يطبق تغييرات التنسيق تلقائيا.

تتم هذه العملية في الخلفية لضمان الحفاظ على أساليب تنسيق الشيفرة دون أي خطوات يدوية.

---

## الإعداد

يمكنك تخصيص المُنسِّقات عبر قسم `formatter` في إعدادات OpenCode.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {}
}
```

يدعم إعداد كل مُنسِّق ما يلي:

| الخاصية       | النوع    | الوصف                                                  |
| ------------- | -------- | ------------------------------------------------------ |
| `disabled`    | boolean  | اضبطها على `true` لتعطيل المُنسِّق                     |
| `command`     | string[] | الأمر الذي سيتم تشغيله للتنسيق                         |
| `environment` | object   | متغيرات البيئة التي يتم ضبطها عند تشغيل المُنسِّق      |
| `extensions`  | string[] | امتدادات الملفات التي يجب أن يتعامل معها هذا المُنسِّق |

لنلقِ نظرة على بعض الأمثلة.

---

### تعطيل المُنسِّقات

لتعطيل **جميع** المُنسِّقات على مستوى عام، اضبط `formatter` على `false`:

```json title="opencode.json" {3}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": false
}
```

لتعطيل مُنسِّق **محدد**، اضبط `disabled` على `true`:

```json title="opencode.json" {5}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {
    "prettier": {
      "disabled": true
    }
  }
}
```

---

### مُنسِّقات مخصّصة

يمكنك تجاوز المُنسِّقات المُضمَّنة أو إضافة مُنسِّقات جديدة عبر تحديد الأمر ومتغيرات البيئة وامتدادات الملفات:

```json title="opencode.json" {4-14}
{
  "$schema": "https://opencode.ai/config.json",
  "formatter": {
    "prettier": {
      "command": ["npx", "prettier", "--write", "$FILE"],
      "environment": {
        "NODE_ENV": "development"
      },
      "extensions": [".js", ".ts", ".jsx", ".tsx"]
    },
    "custom-markdown-formatter": {
      "command": ["deno", "fmt", "$FILE"],
      "extensions": [".md"]
    }
  }
}
```

سيتم استبدال **العنصر النائب `$FILE`** في الأمر بمسار الملف الذي يجري تنسيقه.
