---
title: นโยบาย
description: ควบคุมว่า OpenCode สามารถใช้ทรัพยากรที่กำหนดค่าไว้ใดได้บ้าง
---

:::caution[ต้องใช้ OpenCode 2]
OpenCode 1 ไม่บังคับใช้นโยบาย ตัวอย่างในหน้านี้ต้องใช้ OpenCode 2 ใน OpenCode 1 ให้ใช้ [`disabled_providers`](/docs/config#disabled-providers) หรือ [`enabled_providers`](/docs/config#enabled-providers) เพื่อควบคุมว่าผู้ให้บริการใดใช้งานได้ ดูวิธีใช้งานปัจจุบันได้ที่ [เอกสารนโยบายของ OpenCode 2](https://opencode.ai/docs/policies/)
:::

นโยบายควบคุมว่า OpenCode สามารถดำเนินการกับทรัพยากรที่ระบุชื่อได้หรือไม่ ฟีเจอร์นี้ของ OpenCode 2 ยังอยู่ในขั้นทดลอง และกำหนดค่าผ่านอาร์เรย์ `experimental.policies` ใน `opencode.json`

นโยบายแยกจาก [สิทธิ์](/docs/permissions) สิทธิ์ควบคุมว่าเครื่องมือทำอะไรได้บ้างระหว่างเซสชัน ส่วนนโยบายควบคุมว่า OpenCode สามารถใช้ทรัพยากร เช่น ผู้ให้บริการ LLM ได้หรือไม่

---

## การกำหนดค่า

คำสั่งนโยบายแต่ละรายการมีสามฟิลด์:

- `effect` - เป็น `"allow"` หรือ `"deny"`
- `action` - การดำเนินการที่ถูกควบคุม
- `resource` - ID ของทรัพยากรหรือรูปแบบไวด์การ์ดที่คำสั่งนี้มีผล

ตัวอย่างเช่น ปฏิเสธการใช้ผู้ให้บริการ `openai`:

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

ผู้ให้บริการที่ถูกปฏิเสธโดยนโยบายจะไม่สามารถใช้เลือกโมเดลหรือใช้งานโมเดลได้ แม้จะมีข้อมูลประจำตัวหรือกำหนดค่าอื่นๆ ไว้อย่างถูกต้องแล้วก็ตาม

---

## นโยบายที่ใช้ได้

ปัจจุบัน OpenCode รองรับการดำเนินการของนโยบายหนึ่งรายการ:

| การดำเนินการ   | ทรัพยากร                      | คำอธิบาย                               |
| -------------- | ----------------------------- | -------------------------------------- |
| `provider.use` | ID ผู้ให้บริการ เช่น `openai` | อนุญาตหรือปฏิเสธการใช้ผู้ให้บริการ LLM |

อาจมีการเพิ่มการดำเนินการของนโยบายอื่นๆ ในอนาคต

---

## การจับคู่

ฟิลด์ `resource` รองรับการจับคู่ไวด์การ์ด ใช้ `*` เพื่อจับคู่อักขระตั้งแต่ศูนย์ตัวขึ้นไป และใช้ `?` เพื่อจับคู่อักขระหนึ่งตัว

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

ตัวอย่างนี้ปฏิเสธผู้ให้บริการอย่าง `company-us` และ `company-eu`

---

## ลำดับของกฎ

เมื่อมีหลายคำสั่งที่ตรงกัน คำสั่งสุดท้ายที่ตรงกันจะมีผล ให้ใส่กฎแบบกว้างไว้ก่อน แล้วจึงใส่ข้อยกเว้นที่เฉพาะเจาะจงกว่าไว้หลังจากนั้น

ตัวอย่างเช่น อนุญาตเฉพาะ Anthropic:

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

หากไม่มีนโยบายใดตรงกับผู้ให้บริการ ค่าเริ่มต้นคืออนุญาตให้ใช้ผู้ให้บริการนั้น

คุณสามารถตั้งนโยบายได้ทั้งในการกำหนดค่าส่วนกลางและการกำหนดค่าโครงการ หากนโยบายจากทั้งสองแห่งตรงกับผู้ให้บริการเดียวกัน นโยบายส่วนกลางของคุณจะมีลำดับความสำคัญเหนือนโยบายของโครงการ วิธีนี้ป้องกันไม่ให้ที่เก็บโค้ดเปิดใช้ผู้ให้บริการที่คุณปฏิเสธไว้ในระดับส่วนกลางขึ้นมาใหม่

---

## รายการผู้ให้บริการ

ใน OpenCode 2 ให้ใช้นโยบายแทนการตั้งค่า `disabled_providers` และ `enabled_providers` แบบเดิมเมื่อควบคุมการเข้าถึงผู้ให้บริการ ใน OpenCode 1 ให้ใช้รายการผู้ให้บริการเหล่านั้นต่อไป

เพื่อแทนที่ `disabled_providers`:

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

เพื่อแทนที่ `enabled_providers` ให้ปฏิเสธผู้ให้บริการทั้งหมดก่อน แล้วจึงอนุญาตผู้ให้บริการที่เลือกไว้หลังจากนั้น:

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
