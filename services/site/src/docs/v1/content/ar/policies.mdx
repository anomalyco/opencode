---
title: السياسات
description: تحكّم في الموارد المُعدّة التي يُسمح لـ OpenCode باستخدامها.
---

:::caution[يتطلب OpenCode 2]
لا تُطبَّق السياسات في OpenCode 1. تتطلب الأمثلة في هذه الصفحة OpenCode 2. في OpenCode 1، استخدم [`disabled_providers`](/docs/config#disabled-providers) أو [`enabled_providers`](/docs/config#enabled-providers) للتحكم في إتاحة المزوّدين. راجع [توثيق السياسات في OpenCode 2](https://opencode.ai/docs/policies/) لمعرفة طريقة الاستخدام الحالية.
:::

تحدد السياسات ما إذا كان يُسمح لـ OpenCode بتنفيذ إجراء على مورد مُسمّى. هذه الميزة في OpenCode 2 تجريبية، وتُضبط عبر المصفوفة `experimental.policies` في `opencode.json`.

السياسات منفصلة عن [الأذونات](/docs/permissions). تتحكم الأذونات فيما يمكن للأدوات فعله أثناء الجلسة، بينما تتحكم السياسات في ما إذا كان يُسمح لـ OpenCode باستخدام مورد مثل مزوّد LLM.

---

## الإعداد

تحتوي كل عبارة سياسة على ثلاثة حقول:

- `effect` - إما `"allow"` أو `"deny"`.
- `action` - العملية الخاضعة للتحكم.
- `resource` - معرّف المورد أو نمط أحرف البدل الذي تنطبق عليه العبارة.

على سبيل المثال، لحظر استخدام المزوّد `openai`:

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "experimental": {
    "policies": [
      {
        "effect": "deny",
        "action": "provider.use",
        "resource": "openai"
      }
    ]
  }
}
```

المزوّد المحظور بسياسة لا يكون متاحًا لاختيار النماذج أو استخدامها، حتى لو كانت لديه بيانات اعتماد أو كان مضبوطًا بشكل صحيح من نواحٍ أخرى.

---

## السياسات المتاحة

يدعم OpenCode حاليًا إجراء سياسة واحدًا:

| الإجراء        | المورد                      | الوصف                              |
| -------------- | --------------------------- | ---------------------------------- |
| `provider.use` | معرّف المزوّد، مثل `openai` | السماح باستخدام مزوّد LLM أو حظره. |

قد تُضاف إجراءات سياسات أخرى مستقبلًا.

---

## المطابقة

يدعم الحقل `resource` المطابقة بأحرف البدل. استخدم `*` لمطابقة صفر أو أكثر من الأحرف، و`?` لمطابقة حرف واحد.

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "experimental": {
    "policies": [
      {
        "effect": "deny",
        "action": "provider.use",
        "resource": "company-*"
      }
    ]
  }
}
```

يحظر هذا مزوّدين مثل `company-us` و`company-eu`.

---

## ترتيب القواعد

عند تطابق عدة عبارات، تكون الغلبة لآخر عبارة مطابقة. ضع القواعد العامة أولًا، ثم الاستثناءات الأكثر تحديدًا بعدها.

على سبيل المثال، للسماح بـ Anthropic فقط:

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "experimental": {
    "policies": [
      {
        "effect": "deny",
        "action": "provider.use",
        "resource": "*"
      },
      {
        "effect": "allow",
        "action": "provider.use",
        "resource": "anthropic"
      }
    ]
  }
}
```

إذا لم تطابق أي سياسة مزوّدًا ما، يكون استخدامه مسموحًا افتراضيًا.

يمكن ضبط السياسات في كلٍّ من الإعدادات العامة وإعدادات المشروع. إذا طابقت سياسات من الموقعين المزوّد نفسه، تكون الأولوية لسياستك العامة على سياسة المشروع. يمنع هذا أي مستودع من إعادة تفعيل مزوّد حظرته على المستوى العام.

---

## قوائم المزوّدين

في OpenCode 2، استخدم السياسات بدلًا من الإعدادين الأقدم `disabled_providers` و`enabled_providers` عند التحكم في الوصول إلى المزوّدين. واصل استخدام قوائم المزوّدين هذه في OpenCode 1.

لاستبدال `disabled_providers`:

```json title="opencode.json"
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "openai" },
      { "effect": "deny", "action": "provider.use", "resource": "google" }
    ]
  }
}
```

لاستبدال `enabled_providers`، احظر جميع المزوّدين أولًا ثم اسمح بالمزوّدين المختارين بعد ذلك:

```json title="opencode.json"
{
  "experimental": {
    "policies": [
      { "effect": "deny", "action": "provider.use", "resource": "*" },
      { "effect": "allow", "action": "provider.use", "resource": "anthropic" },
      { "effect": "allow", "action": "provider.use", "resource": "openai" }
    ]
  }
}
```
