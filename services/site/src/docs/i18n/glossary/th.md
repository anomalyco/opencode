# แนวทางการแปลภาษาไทย (th)

การแปล V2 docs (`src/docs/content/th/`) และพจนานุกรมการตลาดของ Console (`packages/site/src/i18n/th/` ใน
anomalyco/opencode-console) ใช้แนวทางเดียวกันนี้ รักษาแถวของ `../glossary.md` ไว้ และไฟล์นี้บันทึกวิธีที่ภาษาไทย
แสดงแถวเหล่านั้นและคำที่ไฟล์กลางเปิดให้แต่ละภาษาเลือกเอง

## สำนวนและรูปแบบ

- ภาษาไทยเขียนเอกสารนักพัฒนาที่สุภาพ เป็นธรรมชาติ กระชับ ใช้ "คุณ" กับผู้อ่าน และไม่ลงท้ายด้วย ครับ/ค่ะ
- ใส่ช่องว่างระหว่างข้อความไทยกับอักษรละตินและตัวเลข (`ติดตั้ง OpenCode`, `ใช้ 5 นาที`, `โมเดล 200 ราย`)
- ไม่แปลคำสั่ง ตัวเลือกการกำหนดค่า พาธ URL ตัวแปรสภาพแวดล้อม ชื่อแพ็กเกจ หรือโค้ดใน backtick
- รักษาหัวข้อให้มีจำนวน ลำดับ และระดับเดียวกับภาษาอังกฤษ เพราะ anchor ใช้หัวข้ออังกฤษ
- รักษาลิงก์ภายในแบบ root-relative (`/config`) แปลเฉพาะข้อความลิงก์
- ใช้ประโยคบอกเล่าแทนคำถามเมื่อภาษาอังกฤษเป็นคำถามในหัวข้อ และหลีกเลี่ยงการขึ้นต้นด้วยคำแปลตรงตัวของ "It"
- ตัวเลข ราคา วันที่ รุ่น และ ID โมเดลตรงกับภาษาอังกฤษทุกตัวอักษร

## คำที่ไม่แปล

- ชื่อผลิตภัณฑ์: OpenCode, OpenCode Console, Console, OpenCode Models, Zen, Go, Go Plus, Go Teams, Desktop,
  Enterprise, Anomaly
- ชื่อผู้ให้บริการ โมเดล บริษัท แอป เครื่องมือ: Anthropic, OpenAI, Claude, Codex, Gemini, GPT, Kimi, Qwen, DeepSeek,
  MiniMax, GLM, Grok, Muse, Nemotron, Big Pickle, Ollama, LM Studio, vLLM, Zed, Raycast, Hermes, OpenClaw, Pi,
  Claude Code, GitHub Copilot และอื่นๆ
- คำย่อ: MCP, LSP, SDK, CLI, API, TUI, GUI, JSON, JSONC, YAML, HTTP, HTTPS, URL, URI, ZDR, SSO, SCIM, OIDC, SAML,
  OAuth, PKCE, ACP, RPC, IPC, ABI, AST, VCS, PTY, IDE, LLM, AI, CORS, DNS, TLS, mDNS, JWT, CSV, SVG, PDF
- คำเทคนิคที่คงอังกฤษ: harness, profile, regular expression, Code Mode, Effect, Layer, Scope, Fiber, Stream, Diff (ชื่อ
  ตัวแสดง), location, schema, registry, plugin RPC, workerd, checkpoints (เมื่อเป็นชื่อฟีเจอร์), snake case, mutual TLS,
  user agent, type guard, async iterable
- ป้าย UI อังกฤษที่อ้างในตัวหนา: **Settings › Billing**, **Add credits**, **Personal**, **Owner**, **Member**,
  **Admin**, **Enabled**, **New models**, **Free models**, **Extra Usage**, **Invite Members**, **Join workspace**,
  **Send invitations**, **Create Workspace**, **Delete workspace**, **Leave workspace**

## คำที่ใช้

| อังกฤษ | ไทย | หมายเหตุ |
| --- | --- | --- |
| agent, subagent | เอเจนต์, ซับเอเจนต์ | `coding agent` → เอเจนต์เขียนโค้ด; `child agent`/`child session` → เอเจนต์ลูก/เซสชันลูก |
| open source coding agent | เอเจนต์เขียนโค้ดแบบโอเพนซอร์ส | ห้ามเติม "AI" ในวลีนี้ |
| Console (ผลิตภัณฑ์) | Console | `OpenCode Console` คงทั้งวลี; รูปทั่วไปอาจเป็น "คอนโซล" ได้ |
| workspace / team / member | เวิร์กสเปซ / ทีม / สมาชิก | Go Teams คงอังกฤษ |
| owner / admin / role | เจ้าของ / ผู้ดูแล / บทบาท | |
| account | บัญชี | |
| session | เซสชัน | |
| provider | ผู้ให้บริการ | model provider → ผู้ให้บริการโมเดล |
| model | โมเดล | ID โมเดลไม่แปล |
| model variant / reasoning effort | ตัวเลือกย่อยของโมเดล / ระดับการให้เหตุผล | ไม่ใช้ "ตัวแปร" แทน variant เพื่อไม่ให้สับสนกับ variable |
| inference | inference | หรือ "การประมวลผลโมเดล" เมื่อเป็นคำอธิบาย |
| request / response | คำขอ / การตอบกลับ | |
| tool / tool call | เครื่องมือ / การเรียกเครื่องมือ | |
| skill | สกิล | |
| plugin | ปลั๊กอิน | |
| prompt | พรอมต์ | |
| token | โทเคน | ตัวเลขข้างหน้าคงรูป (`1M โทเคน`) |
| API key | คีย์ API | |
| bearer token / bearer authentication | โทเคน Bearer / การยืนยันตัวตนด้วยโทเคน Bearer | คง `Bearer` ในเฮดเดอร์และตัวอย่าง |
| HTTP Basic auth | การยืนยันตัวตนแบบ HTTP Basic | |
| context | บริบท | |
| permission | สิทธิ์ | |
| policy | นโยบาย | |
| command | คำสั่ง | |
| config / configuration | การกำหนดค่า | `config file` → ไฟล์กำหนดค่า |
| setting | การตั้งค่า | |
| formatter | ฟอร์แมตเตอร์ | |
| theme | ธีม | |
| keybind | คีย์ลัด | |
| snapshot | สแนปช็อต | |
| compaction | การบีบอัด | |
| cache / prompt cache | แคช / พรอมต์แคช | |
| checkpoint | เช็กพอยต์ | |
| worktree | เวิร์กทรี | |
| gateway | เกตเวย์ | |
| endpoint | เอนด์พอยต์ | |
| base URL | base URL | |
| harness | harness | |
| bundle | บันเดิล | ใช้ในข้อความทั่วไป คง `bundle` เมื่อเป็นชื่อในโค้ด |
| provider key | คีย์ผู้ให้บริการ | |
| usage / spend | การใช้งาน / การใช้จ่าย | |
| budget / limit / allowance | งบประมาณ / ขีดจำกัด / วงเงิน | |
| credit / balance / top up | เครดิต / ยอดคงเหลือ / เติมเงิน | |
| invoice / billing | ใบแจ้งหนี้ / การเรียกเก็บเงิน | |
| payment processing fee | ค่าธรรมเนียมการชำระเงิน | |
| subscription / plan / tier | การสมัครสมาชิก / แพ็กเกจ / ระดับ | |
| Free (ราคา) | ฟรี | |
| transcript | บทสนทนา / ทรานสคริปต์ | ใช้ "บทสนทนา" เมื่อหมายถึงประวัติที่แสดง |
| scrollback | ประวัติการเลื่อน | |
| loopback | ลูปแบ็ก | |
| expose (API/RPC) | เปิดให้ใช้ | เลี่ยง "เปิดเผย" |
| composer | ช่องพิมพ์ | |
| reference (ฟีเจอร์) | การอ้างอิง | ส่วน "Reference" ของ API → Reference |
| attachment | ไฟล์แนบ | |
| route / slot / panel | เส้นทาง / สล็อต / แผง | |
| dialog / toast | กล่องโต้ตอบ / ทอสต์ | |
| layer (Effect) | เลเยอร์ | |
| instructions / command | คำแนะนำ / คำสั่ง | คำแนะนำเป็นข้อความที่เอเจนต์ใช้ ไม่ใช่คำสั่งที่เรียกใช้ได้ |
| cleanup (resource lifecycle) | การคืนทรัพยากร | ไม่ใช้ "การล้างข้อมูล" หากไม่ได้ลบข้อมูล |
| array (JSON, code) | อาร์เรย์ | |
| resolve (path, model, color) | อ้างอิงจาก / หาโมเดลที่ระบุ / คำนวณค่าสี | เลือกตามบริบท ไม่ใช้ "แก้ไข" เมื่อไม่ได้เปลี่ยนค่าต้นฉบับ |
