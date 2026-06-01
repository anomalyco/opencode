---
title: GitHub
description: ใช้ OpenCode ในปัญหา GitHub และคำขอแบบดึง
---

OpenCode ผสานรวมกับเวิร์กโฟลว์ GitHub ของคุณ พูดถึง `/opencode` หรือ `/oc` ในความคิดเห็นของคุณ แล้ว OpenCode จะดำเนินการงานภายใน GitHub Actions runner ของคุณ

---

## คุณสมบัติ

- **Issue Triage**: ขอให้ OpenCode ตรวจสอบปัญหาและอธิบายให้คุณทราบ
- **แก้ไขและนำไปใช้**: ขอให้ OpenCode แก้ไขปัญหาหรือใช้ฟีเจอร์ และมันจะทำงานในสาขาใหม่และส่ง PR พร้อมการเปลี่ยนแปลงทั้งหมด
- **ปลอดภัย**: OpenCode ทำงานภายในรันเนอร์ของ GitHub ของคุณ

---

## การติดตั้ง

รันคำสั่งต่อไปนี้ในโปรเจ็กต์ที่อยู่ใน repo GitHub:

```bash
opencode github install
```

ขั้นตอนนี้จะแนะนำคุณตลอดขั้นตอนการติดตั้งแอป GitHub การสร้างเวิร์กโฟลว์ และการตั้งค่าความลับ

---

### การตั้งค่าด้วยตนเอง

หรือคุณสามารถตั้งค่าได้ด้วยตนเอง

1. **ติดตั้งแอป GitHub**

   ไปที่ [**github.com/apps/opencode-agent**](https://github.com/apps/opencode-agent) ตรวจสอบให้แน่ใจว่าได้ติดตั้งบนที่เก็บเป้าหมายแล้ว

2. **เพิ่มขั้นตอนการทำงาน**

   เพิ่มไฟล์เวิร์กโฟลว์ต่อไปนี้ไปที่ `.github/workflows/opencode.yml` ใน repo ของคุณ ตรวจสอบให้แน่ใจว่าได้ตั้งค่า `model` ที่เหมาะสมและคีย์ API ที่จำเป็นใน `env`

   ```yml title=".github/workflows/opencode.yml" {24,26}
   name: opencode

   on:
     issue_comment:
       types: [created]
     pull_request_review_comment:
       types: [created]

   jobs:
     opencode:
       if: |
         contains(github.event.comment.body, '/oc') ||
         contains(github.event.comment.body, '/opencode')
       runs-on: ubuntu-latest
       permissions:
         id-token: write
       steps:
          - name: Checkout repository
            uses: actions/checkout@v6
            with:
              fetch-depth: 1
              persist-credentials: false

          - name: Run OpenCode
           uses: anomalyco/opencode/github@latest
           env:
             ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
           with:
             model: anthropic/claude-sonnet-4-20250514
             # share: true
             # github_token: xxxx
   ```

3. **เก็บคีย์ API เป็นความลับ**

   ในองค์กรหรือโครงการ **การตั้งค่า** ให้ขยาย **ความลับและตัวแปร** ทางด้านซ้าย แล้วเลือก **การดำเนินการ** และเพิ่มคีย์ API ที่จำเป็น

---

## การกำหนดค่า

- `model`: โมเดลที่จะใช้กับ OpenCode ใช้รูปแบบของ `provider/model` นี่คือ **จำเป็น**
- `agent`: ตัวแทนที่จะใช้ จะต้องเป็นตัวแทนหลัก ย้อนกลับไปที่ `default_agent` จาก config หรือ `"build"` หากไม่พบ
- `share`: ไม่ว่าจะแชร์เซสชัน OpenCode หรือไม่ ค่าเริ่มต้นเป็น **จริง** สำหรับที่เก็บข้อมูลสาธารณะ
- `prompt`: ตัวเลือกที่กำหนดเองพร้อมท์เพื่อแทนที่การทำงานเริ่มต้น ใช้สิ่งนี้เพื่อปรับแต่งวิธีที่ OpenCode ประมวลผลคำขอ
- `token`: GitHub Access Token เสริมสำหรับการดำเนินการ เช่น การสร้างความคิดเห็น การยอมรับการเปลี่ยนแปลง และการเปิดคำขอดึง ตามค่าเริ่มต้น OpenCode จะใช้โทเค็นการเข้าถึงการติดตั้งจาก OpenCode GitHub App ดังนั้นคอมมิต แสดงความคิดเห็น และคำขอดึงข้อมูลจะปรากฏว่ามาจากแอป

  หรือคุณสามารถใช้ [ในตัว `GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) ของ GitHub Action runner ได้โดยไม่ต้องติดตั้งแอป OpenCode GitHub เพียงตรวจสอบให้แน่ใจว่าได้ให้สิทธิ์ที่จำเป็นในขั้นตอนการทำงานของคุณ:

  ```yaml
  permissions:
    id-token: write
    contents: write
    pull-requests: write
    issues: write
  ```

  คุณยังสามารถใช้ [Personal Access Token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)(PAT) ได้หากต้องการ

---

## กิจกรรมที่รองรับ

OpenCode สามารถทริกเกอร์ได้โดยเหตุการณ์ GitHub ต่อไปนี้:

| ประเภทเหตุการณ์               | กระตุ้นโดย                                                | รายละเอียด                                                                                                        |
| ----------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `issue_comment`               | แสดงความคิดเห็นในประเด็นหรือประชาสัมพันธ์                 | พูดถึง `/opencode` หรือ `/oc` ในความคิดเห็นของคุณ OpenCode อ่านบริบทและสามารถสร้างสาขา เปิด PR หรือตอบกลับได้     |
| `pull_request_review_comment` | แสดงความคิดเห็นเกี่ยวกับบรรทัดรหัสเฉพาะในการประชาสัมพันธ์ | พูดถึง `/opencode` หรือ `/oc` ในขณะที่ตรวจสอบโค้ด OpenCode รับเส้นทางไฟล์ หมายเลขบรรทัด และบริบทที่แตกต่าง        |
| `issues`                      | ปัญหาเปิดหรือแก้ไข                                        | ทริกเกอร์ OpenCode โดยอัตโนมัติเมื่อมีการสร้างหรือแก้ไขปัญหา ต้องป้อนข้อมูล `prompt`                              |
| `pull_request`                | PR เปิดหรืออัปเดตแล้ว                                     | ทริกเกอร์ OpenCode โดยอัตโนมัติเมื่อมีการเปิด ซิงโครไนซ์ หรือเปิด PR อีกครั้ง มีประโยชน์สำหรับการตรวจสอบอัตโนมัติ |
| `schedule`                    | กำหนดการตาม Cron                                          | เรียกใช้ OpenCode ตามกำหนดเวลา ต้องป้อนข้อมูล `prompt` เอาต์พุตไปที่บันทึกและ PR (ไม่มีปัญหาในการแสดงความคิดเห็น) |
| `workflow_dispatch`           | ทริกเกอร์ด้วยตนเองจาก GitHub UI                           | ทริกเกอร์ OpenCode ตามความต้องการผ่านแท็บการดำเนินการ ต้องป้อนข้อมูล `prompt` เอาต์พุตไปที่บันทึกและ PR           |

### ตัวอย่างกำหนดการ

เรียกใช้ OpenCode ตามกำหนดเวลาเพื่อทำงานอัตโนมัติ:

```yaml title=".github/workflows/opencode-scheduled.yml"
name: Scheduled OpenCode Task

on:
  schedule:
    - cron: "0 9 * * 1" # Every Monday at 9am UTC

jobs:
  opencode:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
      pull-requests: write
      issues: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6
        with:
          persist-credentials: false

      - name: Run OpenCode
        uses: anomalyco/opencode/github@latest
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        with:
          model: anthropic/claude-sonnet-4-20250514
          prompt: |
            Review the codebase for any TODO comments and create a summary.
            If you find issues worth addressing, open an issue to track them.
```

สำหรับกิจกรรมที่กำหนดเวลาไว้ อินพุต `prompt` เป็นสิ่งที่จำเป็น\*\* เนื่องจากไม่มีความคิดเห็นที่จะดึงคำแนะนำออกมา เวิร์กโฟลว์ตามกำหนดการทำงานโดยไม่มีบริบทผู้ใช้ในการตรวจสอบสิทธิ์ ดังนั้นเวิร์กโฟลว์จะต้องให้สิทธิ์ `contents: write` และ `pull-requests: write` หากคุณคาดหวังให้ OpenCode สร้างสาขาหรือ PR

---

### ตัวอย่างคำขอดึง

ตรวจสอบ PR โดยอัตโนมัติเมื่อมีการเปิดหรืออัปเดต:

```yaml title=".github/workflows/opencode-review.yml"
name: opencode-review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
      pull-requests: read
      issues: read
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: anomalyco/opencode/github@latest
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          model: anthropic/claude-sonnet-4-20250514
          use_github_token: true
          prompt: |
            Review this pull request:
            - Check for code quality issues
            - Look for potential bugs
            - Suggest improvements
```

สำหรับกิจกรรม `pull_request` หากไม่มีการระบุ `prompt` OpenCode จะใช้ค่าเริ่มต้นในการตรวจสอบคำขอดึง

---

### ตัวอย่าง Triage ปัญหา

คัดแยกปัญหาใหม่โดยอัตโนมัติ ตัวอย่างนี้กรองไปยังบัญชีที่มีอายุมากกว่า 30 วันเพื่อลดสแปม:

```yaml title=".github/workflows/opencode-triage.yml"
name: Issue Triage

on:
  issues:
    types: [opened]

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
      pull-requests: write
      issues: write
    steps:
      - name: Check account age
        id: check
        uses: actions/github-script@v7
        with:
          script: |
            const user = await github.rest.users.getByUsername({
              username: context.payload.issue.user.login
            });
            const created = new Date(user.data.created_at);
            const days = (Date.now() - created) / (1000 * 60 * 60 * 24);
            return days >= 30;
          result-encoding: string

      - uses: actions/checkout@v6
        if: steps.check.outputs.result == 'true'
        with:
          persist-credentials: false

      - uses: anomalyco/opencode/github@latest
        if: steps.check.outputs.result == 'true'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        with:
          model: anthropic/claude-sonnet-4-20250514
          prompt: |
            Review this issue. If there's a clear fix or relevant docs:
            - Provide documentation links
            - Add error handling guidance for code examples
            Otherwise, do not comment.
```

สำหรับเหตุการณ์ `issues` อินพุต `prompt` นั้น **จำเป็น** เนื่องจากไม่มีความคิดเห็นที่จะดึงคำแนะนำออกมา

---

## ข้อความแจ้งที่กำหนดเอง

แทนที่ข้อความแจ้งเริ่มต้นเพื่อปรับแต่งการทำงานของ OpenCode สำหรับเวิร์กโฟลว์ของคุณ

```yaml title=".github/workflows/opencode.yml"
- uses: anomalyco/opencode/github@latest
  with:
    model: anthropic/claude-sonnet-4-5
    prompt: |
      Review this pull request:
      - Check for code quality issues
      - Look for potential bugs
      - Suggest improvements
```

สิ่งนี้มีประโยชน์สำหรับการบังคับใช้เกณฑ์การตรวจสอบเฉพาะ มาตรฐานการเขียนโค้ด หรือประเด็นมุ่งเน้นที่เกี่ยวข้องกับโครงการของคุณ

---

## ตัวอย่าง

นี่คือตัวอย่างบางส่วนของวิธีที่คุณสามารถใช้ OpenCode ใน GitHub

- **อธิบายปัญหา**

  เพิ่มความคิดเห็นนี้ในปัญหา GitHub

  ```
  /opencode explain this issue
  ```

  OpenCode จะอ่านกระทู้ทั้งหมด รวมถึงความคิดเห็นทั้งหมด และตอบกลับพร้อมคำอธิบายที่ชัดเจน

- **แก้ไขปัญหา**

  ในปัญหา GitHub ให้พูดว่า:

  ```
  /opencode fix this
  ```

  และ OpenCode จะสร้างสาขาใหม่ ดำเนินการเปลี่ยนแปลง และเปิด PR ที่มีการเปลี่ยนแปลง

- **ตรวจสอบ PR และทำการเปลี่ยนแปลง**

  แสดงความคิดเห็นต่อไปนี้ใน GitHub PR

  ```
  Delete the attachment from S3 when the note is removed /oc
  ```

  OpenCode จะดำเนินการเปลี่ยนแปลงที่ร้องขอและส่งมอบให้กับ PR เดียวกัน

- **ตรวจสอบบรรทัดรหัสเฉพาะ**

  แสดงความคิดเห็นโดยตรงบนบรรทัดโค้ดในแท็บ "ไฟล์" ของ PR OpenCode จะตรวจจับไฟล์ หมายเลขบรรทัด และบริบทต่างโดยอัตโนมัติเพื่อให้การตอบสนองที่แม่นยำ

  ```
  [Comment on specific lines in Files tab]
  /oc add error handling here
  ```

  เมื่อแสดงความคิดเห็นในบรรทัดใดบรรทัดหนึ่ง OpenCode จะได้รับ:
  - กำลังตรวจสอบไฟล์ที่แน่นอน
  - บรรทัดโค้ดเฉพาะ
  - บริบทที่แตกต่างโดยรอบ
  - ข้อมูลหมายเลขบรรทัด

  ซึ่งช่วยให้สามารถร้องขอที่ตรงเป้าหมายมากขึ้นโดยไม่จำเป็นต้องระบุเส้นทางไฟล์หรือหมายเลขบรรทัดด้วยตนเอง
