import type { ContentOverlay } from "./source"

export const content = {
  products: {
    desktop: {
      name: "Desktop",
      body: "เซสชัน แท็บ diff เบราว์เซอร์ในตัว และส่วนขยาย บน macOS, Windows และ Linux",
      action: "ดาวน์โหลด",
    },
    mobile: {
      name: "Mobile",
      body: "เริ่ม สั่งงาน และอนุมัติเซสชันจากโทรศัพท์ของคุณ ไม่ว่าจะอยู่ที่ไหน",
      action: "ดาวน์โหลด",
    },
    terminal: {
      name: "Terminal",
      body: "UI เทอร์มินัลที่รวดเร็ว ใช้ได้ในทุกเชลล์ อีดิเตอร์ หรือเซิร์ฟเวอร์ระยะไกล",
      action: "ติดตั้ง",
    },
    sdk: { name: "SDK", body: "ควบคุม OpenCode จากสคริปต์ งาน CI และเครื่องมือของคุณเอง", action: "อ่านเอกสาร" },
    ide: {
      name: "ส่วนขยาย IDE",
      body: "เปิด OpenCode ใน VS Code, Cursor และ Windsurf หรือใน Zed และ JetBrains IDE ผ่าน ACP",
      action: "ติดตั้ง",
    },
    mini: {
      name: "Mini",
      body: "อินเทอร์เฟซเทอร์มินัลแบบมินิมอล คำตอบจะพิมพ์ลงใน scrollback ของคุณ โดยมีพรอมต์เดียวอยู่ด้านล่าง",
      action: "ติดตั้ง",
    },
  },
  productDetails: {
    desktop: {
      title: "OpenCode | แอปเดสก์ท็อปสำหรับ macOS, Windows และ Linux",
      description:
        "รันเอเจนต์ OpenCode พร้อมกันได้มากเท่าที่ต้องการ ดูทุกการเปลี่ยนแปลงในเบราว์เซอร์ข้างๆ และทำต่อได้บนทุกอุปกรณ์ สำหรับ macOS, Windows และ Linux",
      intro:
        "รันเอเจนต์หลายตัวพร้อมกัน แต่ละเซสชันอยู่ในแท็บของตัวเอง ตรวจทุกการเปลี่ยนแปลงเป็น diff แสดงความคิดเห็นในบรรทัดใดก็ได้ และตรวจผลลัพธ์ในเบราว์เซอร์ในตัว สำหรับ macOS, Windows และ Linux",
      showcase: {
        "parallel-agents": {
          title: "เอเจนต์แบบขนาน",
          body: "เริ่มเอเจนต์ได้มากเท่าที่ต้องการ แล้วปล่อยให้ทั้งหมดทำงานพร้อมกัน สลับไปดูแต่ละตัวเมื่อทำเสร็จ",
        },
        "see-it-in-the-browser": {
          title: "ดูในเบราว์เซอร์",
          body: "แอปของคุณเปิดในเบราว์เซอร์ข้างเอเจนต์ ทั้งคุณและเอเจนต์จึงเห็นทุกการเปลี่ยนแปลงทันที",
        },
        "on-every-device": {
          title: "บนทุกอุปกรณ์",
          body: "เริ่มเอเจนต์บนทุกอุปกรณ์ของคุณ แล้วทำต่อได้จากแอปเดสก์ท็อป เทอร์มินัล หรือโทรศัพท์",
        },
        "extend-it": {
          title: "ขยายความสามารถ",
          body: "เชื่อมต่อเครื่องมือและบริการของคุณ เพื่อให้เอเจนต์ทำงานกับอะไรก็ได้ หรือให้ OpenCode สร้างปลั๊กอินให้ตัวเอง พร้อม UI ของตัวเองในแถบด้านข้าง",
        },
      },
    },
    mobile: {
      title: "OpenCode | Mobile เซสชันเขียนโค้ดของคุณบนโทรศัพท์",
      description:
        "เริ่มและควบคุมเซสชัน OpenCode จากโทรศัพท์ของคุณ พูดคุยกับเอเจนต์ขณะที่มันทำงานบนคอมพิวเตอร์ของคุณ",
      intro:
        "เริ่มและควบคุมเซสชันจากโทรศัพท์ของคุณได้ทุกที่ โทรหาเซสชันและพูดคุยกับเอเจนต์ หรือเปิดเซสชันใดก็ได้เพื่อทำต่อจากจุดที่ค้างไว้ ทั้งหมดบน OpenCode ที่ทำงานบนคอมพิวเตอร์ของคุณ",
      features: {
        "notify-when-done": { title: "แจ้งเตือนเมื่อเสร็จ", body: "รับสรุปสั้นๆ เมื่อเซสชันที่คุณเริ่มไว้ทำงานเสร็จ" },
        "pair-from-anywhere": {
          title: "จับคู่จากทุกที่",
          body: "เชื่อมต่อจากเครือข่ายใดก็ได้ด้วย opencode pair --remote",
        },
        "every-computer": { title: "ทุกคอมพิวเตอร์", body: "สลับระหว่างคอมพิวเตอร์ที่จับคู่ไว้ได้ในแตะเดียว" },
        "siri-and-shortcuts": { title: "Siri และคำสั่งลัด", body: "เริ่มการโทรหรือเซสชันจาก Siri หรือศูนย์ควบคุม" },
        "follow-along": { title: "ติดตามงาน", body: "ดูไทม์ไลน์อัปเดตขณะที่เอเจนต์ทำงาน" },
        "your-computer": { title: "คอมพิวเตอร์ของคุณ", body: "เชื่อมต่อกับ OpenCode ที่รันบนเครื่องของคุณเอง" },
        "share-sheet": { title: "แผ่นแชร์", body: "แชร์อะไรก็ได้ไปยังเซสชันโดยไม่ต้องเปิดแอป" },
        "mute-sessions": { title: "ปิดเสียงเซสชัน", body: "เก็บเซสชันไว้ในรายการโดยไม่รับการแจ้งเตือน" },
      },
      showcase: {
        voice: { title: "เสียง", body: "โทรหาเซสชันแล้วพูดสิ่งที่ต้องการ เอเจนต์จะตอบออกเสียง" },
        sessions: { title: "เซสชัน", body: "เปิดเซสชันใดก็ได้เพื่อดูความคืบหน้า แล้วทำต่อจากจุดที่ค้างไว้" },
        results: { title: "ผลลัพธ์", body: "เมื่องานที่คุณขอเสร็จ การโทรจะบอกว่ามีอะไรเปลี่ยนไป" },
        steer: { title: "สั่งงาน", body: "ส่งข้อความเพิ่มเพื่อเปลี่ยนทิศทางระหว่างเซสชัน" },
      },
    },
    terminal: {
      title: "OpenCode | UI เทอร์มินัลของเอเจนต์เขียนโค้ดแบบโอเพนซอร์ส",
      description:
        "UI เทอร์มินัลที่รวดเร็วของ OpenCode ใช้ได้ในทุกเชลล์ อีดิเตอร์ หรือเซิร์ฟเวอร์ระยะไกล บอกสิ่งที่ต้องการ ดูการแก้ไขแต่ละครั้งเป็น diff และอนุมัติคำสั่ง",
      intro:
        "UI เทอร์มินัลที่รวดเร็ว ใช้ได้ในทุกเชลล์ อีดิเตอร์ หรือเซิร์ฟเวอร์ระยะไกล บอกสิ่งที่ต้องการด้วยภาษาธรรมดา ดูการแก้ไขแต่ละครั้งปรากฏเป็น diff และเลือกว่าคำสั่งใดรันได้เอง",
      features: {
        "any-terminal": {
          title: "ทุกเทอร์มินัล",
          body: "ใช้ได้ในทุกเชลล์ ในเทอร์มินัลของอีดิเตอร์ หรือบนเซิร์ฟเวอร์ระยะไกล",
        },
        "diffs-in-the-timeline": {
          title: "diff ในไทม์ไลน์",
          body: "ดูการแก้ไขแต่ละครั้งเป็น diff ในไทม์ไลน์ ขณะที่เอเจนต์แก้ไข",
        },
        "pick-up-later": { title: "ทำต่อภายหลัง", body: "ทำเซสชันล่าสุดต่อด้วย -c หรือเซสชันใดก็ได้ด้วย -s" },
        "one-off-runs": { title: "รันครั้งเดียว", body: "opencode run ส่งข้อความหนึ่งข้อความและพิมพ์คำตอบ" },
        "agents-and-commands": {
          title: "เอเจนต์และคำสั่ง",
          body: "สลับเอเจนต์ด้วย shift+tab และเปิดทุกคำสั่งด้วย ctrl+p",
        },
        "auto-approve": { title: "อนุมัติอัตโนมัติ", body: "รันด้วย --auto เพื่ออนุญาตทุกการกระทำที่คุณไม่ได้ปฏิเสธ" },
        "any-server": { title: "เซิร์ฟเวอร์ใดก็ได้", body: "เชื่อมต่อกับเซิร์ฟเวอร์ OpenCode ด้วย URL ผ่าน --server" },
        "usage-stats": { title: "สถิติการใช้งาน", body: "opencode stats แสดงสถิติการใช้งานที่แชร์ได้" },
      },
      showcase: {
        "ask-in-plain-words": { title: "ถามด้วยภาษาธรรมดา", body: "พิมพ์สิ่งที่ต้องการ แล้วเอเจนต์จะแสดงแผนขณะทำงาน" },
        "approve-what-runs": { title: "อนุมัติสิ่งที่รัน", body: "การแก้ไขแสดงเป็น diff และคำสั่งจะรอสิทธิ์จากคุณ" },
        "make-it-yours": {
          title: "ปรับให้เป็นของคุณ",
          body: "สลับธีมได้ในการกดแป้นเดียว ตั้งแต่ธีมเริ่มต้นไปจนถึง tokyonight และอื่นๆ",
        },
        mini: { title: "Mini", body: "รัน opencode mini แล้วคำตอบจะพิมพ์ลงใน scrollback ของคุณเอง" },
      },
    },
    sdk: {
      title: "OpenCode | TypeScript SDK สำหรับสคริปต์ งาน CI และเครื่องมือ",
      description:
        "ควบคุม OpenCode จากสคริปต์ งาน CI และเครื่องมือของคุณเอง ไคลเอนต์ TypeScript แบบมีชนิดข้อมูลสร้างเซสชัน ส่งพรอมต์ และสตรีมทุกอีเวนต์ทันทีที่เกิดขึ้น",
      intro:
        "ควบคุม OpenCode จากสคริปต์ งาน CI และเครื่องมือของคุณเอง SDK รัน OpenCode ภายในโปรเซสของคุณด้วยการตั้งค่าและโมเดลของคุณ และไคลเอนต์แบบมีชนิดข้อมูลจะสร้างเซสชัน ส่งพรอมต์ และสตรีมทุกอีเวนต์",
      features: {
        "typescript-client": {
          title: "ไคลเอนต์ TypeScript",
          body: "คำขอและอีเวนต์แบบมีชนิดข้อมูล ใช้ค่าเดียวกับ @opencode/client",
        },
        "sessions-from-code": { title: "เซสชันจากโค้ด", body: "สร้างเซสชันและส่งพรอมต์จากสคริปต์ใดก็ได้" },
        "any-model": { title: "โมเดลใดก็ได้", body: "ใช้โมเดลที่ตั้งค่าไว้ใน OpenCode ของคุณ" },
        "npm-or-bun": { title: "npm หรือ bun", body: "ติดตั้งด้วย npm i @opencode/sdk หรือ bun add @opencode/sdk" },
        "in-process-host": { title: "โฮสต์ในโปรเซส", body: "รัน OpenCode ในหน่วยความจำ โดยไม่ผ่านเครือข่าย" },
        "your-plugins": { title: "ปลั๊กอินของคุณ", body: "ส่งปลั๊กอินของคุณเข้าไปเมื่อสร้างโฮสต์ในโปรเซส" },
        "promise-or-effect": { title: "Promise หรือ Effect", body: "API แบบ Promise และแบบ Effect ที่ให้ค่าเดียวกัน" },
        "cloudflare-workers": {
          title: "Cloudflare Workers",
          body: "รัน OpenCode ใน Cloudflare Durable Object บน Workers",
        },
      },
      showcase: {
        "fix-ci-from-code": {
          title: "แก้ CI จากโค้ด",
          body: "สคริปต์สั้นๆ ขอให้ OpenCode แก้เทสต์ที่ล้มเหลว แล้วรันเทสต์อีกครั้ง",
        },
        "follow-every-step": {
          title: "ติดตามทุกขั้นตอน",
          body: "สตรีมอีเวนต์เพื่อดูเครื่องมือแต่ละตัวที่เอเจนต์เรียกใช้ ทันทีที่เกิดขึ้น",
        },
        "build-your-own-tools": {
          title: "สร้างเครื่องมือของคุณ",
          body: "เชื่อม OpenCode เข้ากับบอต แดชบอร์ด และเวิร์กโฟลว์ด้วยโค้ดไม่กี่บรรทัด",
        },
        "in-your-process": {
          title: "ในโปรเซสของคุณ",
          body: "รัน OpenCode ภายในโปรเซสของคุณ ด้วยการตั้งค่าและโมเดลของคุณ",
        },
      },
    },
    ide: {
      title: "OpenCode | การเชื่อมต่ออีดิเตอร์สำหรับ VS Code, Cursor และ Zed",
      description:
        "ใช้ OpenCode ในอีดิเตอร์ของคุณ ด้วยส่วนขยายสำหรับ VS Code, Cursor, Windsurf และ VSCodium และ opencode acp สำหรับ Zed, JetBrains IDE และอีดิเตอร์ ACP อื่นๆ",
      intro:
        "ใช้ OpenCode ในอีดิเตอร์ของคุณ ใน VS Code, Cursor, Windsurf และ VSCodium ให้รัน opencode ในเทอร์มินัลในตัว แล้วส่วนขยายจะติดตั้งเอง Zed, JetBrains IDE และอีดิเตอร์อื่นที่รองรับ Agent Client Protocol จะรัน OpenCode ด้วย opencode acp",
      features: {
        "quick-launch": { title: "เปิดด่วน", body: "Cmd+Esc หรือ Ctrl+Esc เปิด OpenCode ในเทอร์มินัลแบบแยกหน้าจอ" },
        "new-session": { title: "เซสชันใหม่", body: "Cmd+Shift+Esc หรือ Ctrl+Shift+Esc เริ่มอีกเซสชัน" },
        context: { title: "บริบท", body: "แชร์ส่วนที่เลือกหรือแท็บปัจจุบันกับ OpenCode" },
        "file-references": { title: "อ้างอิงไฟล์", body: "Cmd+Option+K หรือ Alt+Ctrl+K แทรก @File#L37-42" },
        "installs-itself": { title: "ติดตั้งเอง", body: "รัน opencode ในเทอร์มินัลในตัวเพื่อเพิ่มส่วนขยาย" },
        "acp-editors": { title: "อีดิเตอร์ ACP", body: "Zed, JetBrains IDE, Avante.nvim และ CodeCompanion.nvim" },
        "open-vsx": { title: "Open VSX", body: "มีบน Open VSX สำหรับ Cursor, Windsurf และ VSCodium ด้วย" },
        "same-agent": {
          title: "เอเจนต์เดียวกัน",
          body: "OpenCode ตัวเดียวกับที่คุณใช้ในเทอร์มินัล อยู่ข้างโค้ดของคุณ",
        },
      },
    },
    mini: {
      title: "OpenCode | Mini อินเทอร์เฟซเทอร์มินัลแบบมินิมอลสำหรับเอเจนต์",
      description:
        "Mini รัน OpenCode ในอินเทอร์เฟซเทอร์มินัลแบบมินิมอล คำตอบจะพิมพ์ลงใน scrollback ของเทอร์มินัลเอง และมีเพียงพรอมต์กับบรรทัดสถานะอยู่ด้านล่าง",
      intro:
        "อินเทอร์เฟซเทอร์มินัลแบบมินิมอลสำหรับ OpenCode รัน opencode mini แล้วคำตอบจะพิมพ์ลงใน scrollback ของเทอร์มินัลโดยตรง คุณจึงเลื่อน ค้นหา และคัดลอกได้เหมือนเอาต์พุตอื่นๆ มีเพียงพรอมต์และบรรทัดสถานะอยู่ด้านล่าง",
      features: {
        "your-scrollback": { title: "scrollback ของคุณ", body: "คำตอบกลายเป็นประวัติเทอร์มินัลตามปกติ" },
        "one-prompt": { title: "พรอมต์เดียว", body: "เอเจนต์ โมเดล บริบท และค่าใช้จ่ายในบรรทัดสถานะเดียว" },
        permissions: { title: "สิทธิ์", body: "อนุญาตการแก้ไขและคำสั่งจากพื้นที่พรอมต์" },
        "how-much-shows": {
          title: "ปริมาณที่แสดง",
          body: "เงียบ ค่าเริ่มต้น หรือทั้งหมด สำหรับการคิดและเอาต์พุตของเครื่องมือ",
        },
        "pick-up-later": { title: "ทำต่อภายหลัง", body: "ทำเซสชันล่าสุดต่อด้วย -c หรือเซสชันใดก็ได้ด้วย -s" },
        "same-opencode": { title: "OpenCode เดียวกัน", body: "เซิร์ฟเวอร์ เอเจนต์ และโมเดลเดียวกับแอปอื่นๆ" },
        agents: { title: "เอเจนต์", body: "สลับเอเจนต์ได้จากพรอมต์โดยตรง" },
        compact: { title: "ย่อเซสชัน", body: "ย่อเซสชันที่ยาวด้วย /compact" },
      },
    },
  },
  extensionCard: {
    name: "ส่วนขยาย",
    body: "ใช้ OpenCode ใน VS Code หรือใน Zed และอีดิเตอร์อื่นๆ ผ่าน ACP",
    action: "ติดตั้ง",
  },
  extensions: {
    browse: {
      name: "Browse",
      body: "ให้เอเจนต์ใช้เบราว์เซอร์จริงของคุณ",
      title: "OpenCode | Browse เบราว์เซอร์จริงของคุณสำหรับเอเจนต์เขียนโค้ด",
      description:
        "Browse ให้ OpenCode และไคลเอนต์ MCP อื่นๆ ใช้เบราว์เซอร์จริงของคุณ เอเจนต์ควบคุมแท็บเบื้องหลังด้วย Playwright และส่งการล็อกอินกับ 2FA กลับให้คุณทำเอง",
      intro:
        "เซิร์ฟเวอร์ MCP และส่วนขยาย Chromium ที่ให้เอเจนต์ใช้เบราว์เซอร์จริงของคุณ ทั้งแท็บ การล็อกอิน และส่วนขยายของคุณ เอเจนต์เปิดและควบคุมแท็บด้วย Playwright ถ่ายภาพหน้าจอ และบันทึกหน้าจอ ในแท็บเบื้องหลังที่จัดกลุ่มไว้ไม่ให้เกะกะ เมื่อถึงตาคุณ เช่น การล็อกอิน การยืนยัน 2FA หรือการชำระเงิน เอเจนต์จะส่งแท็บกลับให้คุณ และทำงานต่อเมื่อคุณคลิก Continue",
      features: {
        "your-real-browser": {
          title: "เบราว์เซอร์จริงของคุณ",
          body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera และ Chromium",
        },
        "out-of-your-way": { title: "ไม่เกะกะ", body: "แท็บของเอเจนต์เปิดอยู่เบื้องหลังในกลุ่มที่ยุบไว้" },
        handoffs: { title: "ส่งต่องาน", body: "ทำขั้นตอนล็อกอินหรือ 2FA เอง แล้วคลิก Continue" },
        "lend-a-tab": { title: "ให้ยืมแท็บ", body: "คลิกปุ่มในแถบเครื่องมือเพื่อส่งแท็บที่เปิดอยู่ให้เอเจนต์" },
        "record-and-capture": {
          title: "บันทึกและจับภาพ",
          body: "ภาพหน้าจอ การบันทึกหน้าจอ และทราฟฟิกเครือข่ายเป็นไฟล์ HAR",
        },
        "any-mcp-client": {
          title: "ไคลเอนต์ MCP ใดก็ได้",
          body: "OpenCode, Claude Code, Cursor, Codex, Zed และอีกมากมาย",
        },
        "named-sessions": { title: "เซสชันแบบตั้งชื่อ", body: "แต่ละเซสชันเก็บแท็บของตัวเองไว้แม้รีสตาร์ต" },
        allowlists: { title: "รายการที่อนุญาต", body: "จำกัดแท็บของเซสชันไว้เฉพาะเว็บไซต์ที่คุณระบุ" },
      },
      install:
        "บรรทัดเดียวติดตั้ง Browse เพิ่มให้เอเจนต์ที่พบ และจับคู่ส่วนขยาย บน Windows ให้รัน irm https://opencode.ai/browse/install.ps1 | iex หรือให้เอเจนต์ตั้งค่าให้",
    },
  },
  apps: {
    opentunnel: { category: "ทันเนลโลคัล", body: "URL HTTPS สาธารณะสำหรับแอปในเครื่อง" },
    opentui: { category: "ไลบรารี", body: "ไลบรารีสำหรับสร้างส่วนติดต่อผู้ใช้ในเทอร์มินัล" },
    hex: { category: "พิมพ์ด้วยเสียง", body: "พิมพ์ด้วยเสียงบนอุปกรณ์สำหรับทุกแอป" },
  },
  getStarted: {
    title: "เริ่มต้นใช้งาน",
    lead: "วิธีเริ่มต้นที่ง่ายที่สุดคือดาวน์โหลด OpenCode แล้วใช้โมเดลฟรี ไม่ต้องมีบัญชี หากต้องการมากกว่านั้น ใช้การสมัครสมาชิกของคุณเอง หรือใช้ OpenCode Go",
    phrases: {
      "download-opencode": { text: "ดาวน์โหลด OpenCode" },
      "free-models": { text: "โมเดลฟรี" },
      "your-own-subscription": { text: "การสมัครสมาชิกของคุณเอง" },
      "a-subscription-you-already-have": { text: "การสมัครสมาชิกที่คุณมีอยู่แล้ว" },
      "opencode-go": { text: "OpenCode Go" },
    },
    subscriptions: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } },
    steps: {
      download: { title: "ดาวน์โหลด", line: "เดสก์ท็อป เทอร์มินัล หรือมือถือ" },
      "use-free-models": { title: "ใช้โมเดลฟรี", line: "OpenCode มาพร้อมชุดโมเดลฟรี ไม่ต้องมีบัญชี" },
      "add-more-models": {
        title: "เพิ่มโมเดล",
        line: "ใช้การสมัครสมาชิกของคุณเอง หรือใช้โมเดลคัดสรรของ OpenCode Go เริ่มต้น $10/เดือน",
      },
    },
    sentence:
      "ดาวน์โหลด OpenCode เริ่มต้นด้วยโมเดลฟรี และใช้การสมัครสมาชิกของคุณเองหรือ OpenCode Go เมื่อต้องการมากขึ้น",
  },
  byos: {
    title: "ใช้การสมัครสมาชิกของคุณ",
    headline: "ใช้การสมัครสมาชิกที่คุณมีอยู่แล้ว",
    line: "เข้าสู่ระบบด้วย ChatGPT Plus หรือ Pro หรือ GitHub Copilot หรือใช้การสมัครสมาชิก OpenCode",
    yours: { label: "การสมัครสมาชิกของคุณ", items: { "chatgpt-plus-pro": { name: "ChatGPT Plus/Pro" } } },
    planLinks: ["การสมัครสมาชิก OpenCode", "OpenCode Go"],
    ours: { label: "แผนของ OpenCode" },
  },
  brand: {
    hero: { copy: { text: "กฎสำหรับเอเจนต์", copied: "คัดลอกกฎแล้ว" } },
    naming: {
      title: "ชื่อเรียก",
      body: "เขียน OpenCode เป็นคำเดียว โดยใช้ O และ C ตัวพิมพ์ใหญ่ อย่าเขียนเป็น Opencode, Open Code, OpenCode AI หรือ Open-Code",
      code: "ใช้ `opencode` ตัวพิมพ์เล็กเฉพาะในโค้ดและชื่อแพ็กเกจ เช่น `opencode-figma` หรือ `@acme/opencode-plugin`",
    },
    families: {
      logo: {
        title: "โลโก้",
        body: "โลโก้เดี่ยว สำหรับไอคอนแอป รูปโปรไฟล์ และพื้นที่เล็กอื่นๆ แบบสี่เหลี่ยมจัตุรัสเพิ่มระยะขอบสำหรับที่ที่ครอปเป็นสี่เหลี่ยมจัตุรัส",
        assets: {
          light: { name: "สว่าง" },
          dark: { name: "มืด" },
          "square-light": { name: "สี่เหลี่ยม สว่าง" },
          "square-dark": { name: "สี่เหลี่ยม มืด" },
        },
      },
      wordmark: {
        title: "ตัวอักษรแบรนด์",
        body: "ชื่อเต็มในรูปแบบตัวอักษรของ OpenCode ใช้ในทุกที่ที่มีพื้นที่พอสำหรับเขียนชื่อเต็ม",
        assets: { light: { name: "สว่าง" }, dark: { name: "มืด" } },
      },
      "simple-wordmark": {
        title: "ตัวอักษรแบรนด์แบบเรียบ",
        body: "ตัวอักษรแบรนด์แบบสีเดียว สำหรับงานพิมพ์ งานปัก และที่ที่ใช้ได้เพียงสีเดียว",
        assets: { light: { name: "สว่าง" }, dark: { name: "มืด" } },
      },
    },
    icons: {
      title: "รูปโปรไฟล์",
      body: "รูปโปรไฟล์สี่เหลี่ยมจัตุรัสขนาด 1024px สำหรับ Slack, Discord, GitHub และโปรไฟล์อื่นๆ พื้นหลังเต็มพื้นที่สี่เหลี่ยม และโลโก้อยู่ภายในวงกลมอย่างพอดี จึงครอปเป็นวงกลมได้โดยไม่เสียรูป",
      items: { dark: { name: "มืด" }, light: { name: "สว่าง" } },
    },
    colors: {
      title: "สี",
      body: "โลโก้และตัวอักษรแบรนด์ใช้หมึกสีเดียวที่ความทึบสามระดับ และใช้หมึกที่สว่างกว่าบนพื้นหลังมืด ค่าด้านล่างคือหมึกนั้นบนพื้นขาวหรือ #0B0B0B ตามที่ไฟล์มาตรฐานแสดง คลิกค่าเพื่อคัดลอก",
      palettes: {
        light: {
          name: "สว่าง",
          swatches: {
            ink: { name: "หมึก", use: "เส้นขอบโลโก้และตัวอักษรของ “code”" },
            "ink-70": { name: "หมึก 70%", use: "ตัวอักษรของ “open”", ink: "หมึกที่ความทึบ 70%" },
            "ink-20": { name: "หมึก 20%", use: "เงาด้านในของโลโก้", ink: "หมึกที่ความทึบ 20%" },
          },
        },
        dark: {
          name: "มืด",
          swatches: {
            ink: { name: "หมึก", use: "เส้นขอบโลโก้และตัวอักษรของ “code”" },
            "ink-72": { name: "หมึก 72%", use: "ตัวอักษรของ “open”", ink: "หมึกที่ความทึบ 72%" },
            "ink-28": { name: "หมึก 28%", use: "เงาด้านในของโลโก้", ink: "หมึกที่ความทึบ 28%" },
          },
        },
      },
    },
    variants: {
      title: "รูปแบบ",
      body: "เลือกแบบที่ทำให้โลโก้ชัดบนพื้นหลังของคุณ ใช้แบบมืดบนพื้นหลังสว่าง และแบบสว่างบนพื้นหลังมืด โลโก้และตัวอักษรแบรนด์เป็นไฟล์แยกกัน ให้ใช้อย่างใดอย่างหนึ่ง",
      groups: {
        default: {
          name: "ค่าเริ่มต้น",
          body: "โลโก้ที่ใช้ได้แทบทุกที่ เงาด้านในโปร่งใส บนพื้นขาวหรือดำจึงดูเหมือนสีเทาสองโทนทุกประการ และบนภาพถ่าย การไล่สี หรือพื้นสี พื้นหลังจะมองทะลุผ่านได้",
          rows: {
            logo: { title: "โลโก้", tiles: { dark: { name: "มืด" }, light: { name: "สว่าง" } } },
            wordmark: { title: "ตัวอักษรแบรนด์", tiles: { dark: { name: "มืด" }, light: { name: "สว่าง" } } },
          },
        },
        simple: {
          name: "แบบเรียบ",
          body: "สีเดียว ช่องในตัวอักษรเปิด และไม่มีเงาด้านใน ใช้บนพื้นหลังสีเรียบ งานพิมพ์สีเดียว และทุกที่ที่ใช้สีเทาไม่ได้ ใช้แบบเรียบสีมืดบนสีสว่าง และแบบเรียบสีสว่างบนสีมืด",
          rows: { wordmark: { title: "ตัวอักษรแบรนด์", tiles: { dark: { name: "มืด" }, light: { name: "สว่าง" } } } },
        },
      },
    },
    usage: {
      title: "วิธีใช้",
      body: "ใช้แบบสว่างบนพื้นหลังสว่าง และแบบมืดบนพื้นหลังมืด โลโก้และตัวอักษรแบรนด์แยกจากกัน ให้ใช้อย่างใดอย่างหนึ่ง ไม่ใช้ทั้งสองอย่างพร้อมกัน",
      stroke: {
        title: "หนึ่งเส้น",
        body: "กฎระยะห่างในหน้านี้วัดเป็นเส้น หนึ่งเส้นคือความหนาของเส้นขอบโลโก้ เท่ากับหนึ่งในสี่ของความกว้าง โลโก้จึงกว้าง 4 เส้นและสูง 5 เส้น",
      },
      clearSpace: {
        title: "พื้นที่ว่าง",
        body: "เว้นพื้นที่อย่างน้อยสองเส้นทุกด้านของโลโก้และตัวอักษรแบรนด์ สำหรับโลโก้ หนึ่งเส้นคือความหนาของเส้นขอบ เท่ากับหนึ่งในสี่ของความกว้าง สำหรับตัวอักษรแบรนด์ คือความหนาของตัวอักษร เท่ากับหนึ่งในเจ็ดของความสูง",
      },
      pixels: {
        title: "พิกเซลเต็ม",
        body: "สัดส่วนของโลโก้คงที่ที่ 4:5 และหนึ่งเส้นเท่ากับหนึ่งในสี่ของความกว้าง ปรับขนาดทีละ 4 × 5px เพื่อให้ทุกขอบและทุกเส้นตรงกับพิกเซลเต็ม",
        do: "ให้ทุกขอบและเส้น 4px อยู่บนพิกเซลเต็ม",
        dont: "ปรับขนาดโลโก้ผิดสัดส่วน 4:5 ไม่เช่นนั้นขอบจะตกระหว่างพิกเซลและเบลอ",
        sizes: { logo: { title: "โลโก้" }, wordmark: { title: "ตัวอักษรแบรนด์" } },
      },
      minimumTitle: "ขนาดขั้นต่ำ",
      minimum: {
        logo: { title: "โลโก้", body: "อย่างน้อย 16 × 20px โดยเส้นหนา 4px หากเล็กกว่านี้จะเบลอ" },
        wordmark: { title: "ตัวอักษรแบรนด์", body: "อย่างน้อย 117 × 21px โดยเส้นหนา 3px หากเล็กกว่านี้จะเบลอ" },
      },
    },
    donts: {
      title: "ข้อห้าม",
      body: "ข้อผิดพลาดที่พบบ่อยซึ่งควรหลีกเลี่ยงเมื่อใช้โลโก้และตัวอักษรแบรนด์",
      examples: {
        "two-tone": { caption: "เปลี่ยนโลโก้เป็นสีใหม่" },
        bright: { caption: "ใช้สีสดสีเดียว" },
        gradient: { caption: "เติมโลโก้ด้วยการไล่สี" },
        inverted: { caption: "สลับโทนสี" },
        stretch: { caption: "ยืดหรือบีบโลโก้" },
        shadow: { caption: "เพิ่มเงาตกกระทบ" },
        glow: { caption: "เพิ่มแสงเรืองหรือเส้นขอบ" },
        lockup: { caption: "วางคำอื่นไว้ข้างโลโก้" },
        "low-contrast": { caption: "ใช้สีเทาบนสีเทาที่คอนทราสต์ต่ำ" },
        color: { caption: "วางโลโก้สีเทาสองโทนบนพื้นหลังสี ซึ่งทำให้สีเทาดูหม่น" },
      },
    },
    integrations: {
      title: "การผสานรวม",
      body: "ปลั๊กอิน ผู้ให้บริการ และเครื่องมือที่ทำงานร่วมกับ OpenCode รวมถึงโปรเจกต์ที่สร้างด้วย OpenCode ระบุเช่นนั้นได้ ใช้ป้ายหรือโลโก้ร่วมพาร์ตเนอร์ และตั้งชื่อโปรเจกต์ให้ชัดว่าเป็นของคุณ",
      badges: {
        body: "ใส่ป้ายใน README เอกสาร หรือเว็บไซต์ของคุณ และลิงก์ไปที่ opencode.ai เลือกไฟล์แบบสว่างหรือมืดตามพื้นหลัง (HTML จะสลับให้เอง) และอย่าเปลี่ยนสีหรือข้อความ",
        sizes: "ทุกสไตล์มีขนาด 20, 32 และ 44px (Shields มีเฉพาะ 20px) ทั้งแบบ SVG และ PNG ขนาด 2×",
        mono: "แต่ละไฟล์มีแบบข้อความ OpenTUI Mono ด้วย เพิ่ม -mono ก่อนนามสกุลไฟล์ เช่น opencode-works-with-a-light-20-mono.svg หรือ -mono-caps สำหรับ OpenTUI Mono ตัวพิมพ์ใหญ่",
        groups: {
          "works-with": {
            title: "Works with",
            alt: "Works with OpenCode",
            body: "สำหรับปลั๊กอิน ผู้ให้บริการ และเครื่องมือที่ทำงานร่วมกับ OpenCode",
          },
          "built-with": {
            title: "Built with",
            alt: "Built with OpenCode",
            body: "สำหรับโปรเจกต์ที่สร้างด้วย OpenCode",
          },
        },
        styles: { a: { name: "กรอบ" }, c: { name: "ช่อง" }, f: { name: "ทึบ" }, g: { name: "Shields" } },
      },
      lockup: {
        title: "โลโก้ร่วมพาร์ตเนอร์",
        body: "วางโลโก้ OpenCode และโลโก้พาร์ตเนอร์เคียงกัน โดยมี × คั่นกลาง เว้นระยะ 3 เส้นทั้งสองข้างของ × ปรับขนาดโลโก้พาร์ตเนอร์ให้ดูสูงเท่าโลโก้ OpenCode และเว้นพื้นที่ว่างรอบโลโก้ร่วมทั้งหมด",
        partners: { github: { name: "GitHub" } },
      },
      naming: {
        title: "การตั้งชื่อโปรเจกต์",
        body: "ขึ้นต้นด้วยชื่อของคุณเอง เพื่อให้ชัดว่าโปรเจกต์เป็นของคุณ",
        rule: "เขียน `Linear for OpenCode` หรือตั้งชื่อแพ็กเกจว่า `opencode-linear` อย่าเขียน `OpenCode Linear` หรือ `Linear by OpenCode`",
      },
    },
    trademarks: {
      title: "เครื่องหมายการค้า",
      body: "OpenCode และโลโก้ OpenCode เป็นเครื่องหมายการค้าของ Anomaly ห้ามใช้เพื่อสื่อว่า Anomaly รับรองหรือสนับสนุนคุณ ห้ามใช้ในชื่อผลิตภัณฑ์หรือชื่อบริษัทของคุณ และห้ามใช้บนสินค้าโดยไม่ได้รับอนุญาต",
      contact: { before: "หากมีคำถาม อีเมลมาที่ ", after: " " },
    },
  },
  press: {
    title: "OpenCode | ชุดข้อมูลสื่อมวลชน ข้อมูลบริษัท และแอสเซทแบรนด์",
    description:
      "ชุดข้อมูลสื่อมวลชนของ OpenCode พร้อมข้อมูลเกี่ยวกับ OpenCode และ Anomaly บริษัทผู้พัฒนา โลโก้และตัวอักษรแบรนด์ให้ดาวน์โหลด และช่องทางติดต่อสำหรับสื่อมวลชน",
    hero: { title: "สื่อมวลชน", body: "ข้อมูล แอสเซทแบรนด์ และช่องทางติดต่อสำหรับการเขียนถึง OpenCode และ Anomaly" },
    company: {
      title: "เกี่ยวกับ Anomaly",
      lead: "Anomaly คือบริษัทผู้พัฒนา OpenCode บริษัทสร้างเครื่องมือโอเพนซอร์สสำหรับนักพัฒนา",
      more: "โปรเจกต์อื่นๆ ได้แก่ SST และ OpenTUI ทั้งหมดเป็นโอเพนซอร์สบน [GitHub](github)",
      learnMore: "ดูข้อมูลเพิ่มเติมได้ที่ [anoma.ly](site)",
      projects: {
        opencode: {
          name: "OpenCode",
          body: "เอเจนต์เขียนโค้ดแบบโอเพนซอร์ส มีแอปสำหรับเดสก์ท็อป เทอร์มินัล และมือถือ รวมถึง SDK ใช้สัญญาอนุญาต MIT มีดาว GitHub กว่า 220,000 ดวง",
        },
        sst: {
          name: "SST",
          body: "เฟรมเวิร์กสำหรับสร้างแอป full-stack บนโครงสร้างพื้นฐานของคุณเอง ใช้สัญญาอนุญาต MIT เปิดตั้งแต่ปี 2020 มีดาว GitHub กว่า 26,000 ดวง",
        },
        opentui: {
          name: "OpenTUI",
          body: "ไลบรารีสำหรับสร้าง UI เทอร์มินัลด้วย TypeScript, React หรือ Solid โดยมีแกนหลักเขียนด้วย Zig OpenCode ใช้งานจริงในโปรดักชัน มีดาว GitHub กว่า 13,000 ดวง",
        },
        "models-dev": {
          name: "Models.dev",
          body: "ฐานข้อมูลโอเพนซอร์สของสเปก ราคา และความสามารถของโมเดล AI พร้อม API สาธารณะ รวบรวมโมเดลกว่า 8,900 รายการจากผู้ให้บริการกว่า 200 ราย",
        },
        hex: {
          name: "Hex",
          body: "การพิมพ์ด้วยเสียงสำหรับ Mac, Windows และ Linux Hex ถอดเสียงบนอุปกรณ์ของคุณและวางลงในแอปใดก็ได้ เสียงจึงไม่ออกจากอุปกรณ์",
        },
        opentunnel: {
          name: "OpenTunnel",
          body: "CLI และ SDK ที่ให้แอปบนเครื่องของคุณมี URL HTTPS สาธารณะ TLS สิ้นสุดที่เครื่องของคุณ รีเลย์จึงไม่เห็นข้อมูลที่ไม่ได้เข้ารหัส",
        },
      },
    },
    about: {
      title: "เกี่ยวกับ OpenCode",
      boilerplate: {
        long: "OpenCode คือเอเจนต์เขียนโค้ดแบบโอเพนซอร์ส มีให้ใช้ทั้งแอปเดสก์ท็อป UI เทอร์มินัล แอปมือถือ และ SDK และทำงานกับโมเดลจากผู้ให้บริการใดก็ได้ รวมถึง Claude, GPT และ Gemini OpenCode ใช้สัญญาอนุญาต MIT และพัฒนาโดย Anomaly มีดาว GitHub กว่า 220,000 ดวง ผู้ร่วมพัฒนากว่า 1,000 คน และนักพัฒนากว่า 22 ล้านคนใช้งานทุกเดือน",
        short:
          "OpenCode คือเอเจนต์เขียนโค้ดแบบโอเพนซอร์สโดย Anomaly มีแอปสำหรับเดสก์ท็อป เทอร์มินัล และมือถือ รวมถึง SDK",
      },
      products: {
        "opencode-console": {
          name: "OpenCode Console",
          long: "OpenCode Console คือเว็บแอปที่นักพัฒนาและทีมใช้ซื้อและจัดการการเข้าถึงโมเดล AI สำหรับ OpenCode และเอเจนต์เขียนโค้ดอื่นๆ มีบริการ inference แบบจ่ายตามการใช้งานสำหรับโมเดล frontier และโมเดล open-weight โดยคิดค่าบริการต่อคำขอจากเครดิตที่เติมไว้ล่วงหน้า และมีการสมัครสมาชิก OpenCode Go ทีมจะได้เวิร์กสเปซที่มีบทบาท Member, Admin และ Owner วงเงินใช้จ่ายระดับเวิร์กสเปซและระดับผู้ใช้ การลงชื่อเข้าใช้ครั้งเดียวด้วย Okta, Microsoft Entra ID หรือ Google Workspace และ SCIM Console รองรับผู้ให้บริการกว่า 30 ราย ทีมจึงเชื่อมต่อบัญชีผู้ให้บริการที่มีอยู่แล้วได้ และการใช้ inference ของ Console เองเป็นทางเลือก อยู่ที่ opencode.ai/console",
          short:
            "OpenCode Console คือเว็บแอปของ Anomaly สำหรับการเข้าถึงโมเดล AI แบบจ่ายตามการใช้งาน การสมัครสมาชิก OpenCode Go และการควบคุมสำหรับทีม เช่น งบประมาณและการลงชื่อเข้าใช้ครั้งเดียว",
        },
        "opencode-go": {
          name: "OpenCode Go",
          long: "OpenCode Go คือการสมัครสมาชิกสำหรับนักพัฒนาที่ต้องการราคารายเดือนคงที่สำหรับโมเดลเขียนโค้ด Go ราคา $10/เดือน Go Plus ราคา $40/เดือนพร้อมขีดจำกัดที่สูงกว่า และ Go Teams ราคา $20/เดือนต่อสมาชิก แต่ละแผนมีชุดโมเดลคัดสรรที่ทดสอบแล้วสำหรับการเขียนโค้ดแบบเอเจนต์ ขีดจำกัดการใช้งานเป็นจำนวนเงินดอลลาร์รายเดือนสำหรับแต่ละโมเดล พร้อมโควตาแบบหมุนเวียนทุก 5 ชั่วโมงและรายสัปดาห์ที่ 20% และ 50% ของขีดจำกัดรายเดือน สมาชิกเติมเครดิต ใช้ยอดเงินแบบจ่ายตามการใช้งานเป็นทางสำรอง และยกเลิกได้ทุกเมื่อ Go ใช้ได้กับ OpenCode และเอเจนต์อื่นๆ อยู่ที่ opencode.ai/console/go",
          short:
            "OpenCode Go คือการสมัครสมาชิกรายเดือนจาก Anomaly ที่ให้นักพัฒนาใช้ชุดโมเดลเขียนโค้ดคัดสรรภายในขีดจำกัดรายเดือน เริ่มต้น $10/เดือน",
        },
        "opencode-data": {
          name: "OpenCode Data",
          long: "OpenCode Data คือแดชบอร์ดสาธารณะที่แสดงว่านักพัฒนาใช้โมเดล AI ใดใน OpenCode และสัดส่วนนั้นเปลี่ยนไปอย่างไรตามเวลา แสดงอันดับโมเดลยอดนิยม การใช้โทเค็น ค่าใช้จ่ายต่อเซสชันและต่อโทเค็น อัตราแคช ส่วนแบ่งตลาด และข้อมูลแยกตามประเทศ ตัวเลขรวบรวมทุกชั่วโมง โดยนับวันและสัปดาห์ตาม UTC จำนวนผู้ใช้และเซสชันเป็นค่าประมาณ และค่าใช้จ่ายใช้ราคาตั้งจากแคตตาล็อกโมเดลของ OpenCode ผู้สื่อข่าวอ้างอิงได้ว่า OpenCode Data (opencode.ai/data) พร้อมเวลาอัปเดตที่แสดงบนหน้า",
          short:
            "OpenCode Data คือแดชบอร์ดสาธารณะที่ opencode.ai/data ซึ่งจัดอันดับโมเดล AI ตามการใช้งานจริงใน OpenCode พร้อมโทเค็น ค่าใช้จ่าย และส่วนแบ่งตลาดที่อัปเดตทุกชั่วโมง",
        },
      },
    },
    facts: {
      title: "ข้อมูลโดยสรุป",
      items: {
        license: { label: "สัญญาอนุญาต" },
        "first-release": { label: "รุ่นแรก" },
        "made-by": { label: "ผู้พัฒนา" },
      },
    },
    milestones: {
      title: "เหตุการณ์สำคัญ",
      items: {
        "first-release-v0-0-1": { date: "เม.ย. 2025", text: "รุ่นแรก v0.0.1" },
        "1-million-downloads": { date: "ต.ค. 2025", text: "ดาวน์โหลดกว่า 1 ล้านครั้ง" },
        "opencode-1-0": { date: "ต.ค. 2025", text: "OpenCode 1.0" },
        "desktop-app-ships": { date: "ธ.ค. 2025", text: "เปิดตัวแอปเดสก์ท็อป" },
        "10-million-downloads": { date: "ม.ค. 2026", text: "ดาวน์โหลดกว่า 10 ล้านครั้ง" },
        "opencode-2-0": { date: "ก.ย. 2026", text: "OpenCode 2.0" },
        "220-000-github-stars": { date: "พ.ย. 2026", text: "ดาว GitHub กว่า 220,000 ดวง" },
      },
    },
    news: {
      title: "รุ่นล่าสุด",
      intro: "OpenCode ออกรุ่นใหม่บ่อย นี่คือรุ่นล่าสุดที่มีฟีเจอร์ใหม่",
      changelog: { text: "บันทึกฉบับเต็ม" },
      feed: { text: "ฟีด RSS" },
    },
    media: {
      title: "สื่อ",
      intro: "ภาพนิ่งและวิดีโอสั้นของแต่ละแอป บันทึกจากผลิตภัณฑ์จริง คุณใช้เพื่อเขียนถึง OpenCode ได้",
      note: "ทุกภาพใช้ธีมมืด ภาพนิ่งและโปสเตอร์เป็น JPG ขนาดสูงสุด 1920 × 1080 หรือ 1080 × 1350 ในแนวตั้ง วิดีโอเป็นคลิป MP4 ที่ไม่มีเสียง",
      products: {
        desktop: {
          name: "Desktop",
          items: {
            "locked-landscape": { title: "วิดีโอ Desktop" },
            "frame-1": { title: "ภาพนิ่ง Desktop 1" },
            "frame-2": { title: "ภาพนิ่ง Desktop 2" },
            "frame-3": { title: "ภาพนิ่ง Desktop 3" },
            "frame-4": { title: "ภาพนิ่ง Desktop 4" },
            "feature-1": { title: "เซสชันในแท็บ" },
            "feature-2": { title: "ตรวจและแสดงความคิดเห็น" },
            "feature-3": { title: "ดูในเบราว์เซอร์" },
            "locked-portrait": { title: "วิดีโอ Desktop แนวตั้ง" },
          },
        },
        mobile: {
          name: "Mobile",
          items: {
            "locked-landscape": { title: "วิดีโอ Mobile" },
            "frame-1": { title: "ภาพนิ่ง Mobile 1" },
            "frame-2": { title: "ภาพนิ่ง Mobile 2" },
            "frame-3": { title: "ภาพนิ่ง Mobile 3" },
            "feature-1": { title: "เสียง" },
            "feature-2": { title: "การอนุมัติ" },
            "feature-3": { title: "เซสชัน" },
            "locked-portrait": { title: "วิดีโอ Mobile แนวตั้ง" },
          },
        },
        terminal: {
          name: "Terminal",
          items: {
            "locked-landscape": { title: "วิดีโอ Terminal" },
            "frame-1": { title: "ภาพนิ่ง Terminal 1" },
            "frame-2": { title: "ภาพนิ่ง Terminal 2" },
            "frame-3": { title: "ภาพนิ่ง Terminal 3" },
            "frame-4": { title: "ภาพนิ่ง Terminal 4" },
            "feature-1": { title: "ถามด้วยภาษาธรรมดา" },
            "feature-2": { title: "อนุมัติสิ่งที่รัน" },
            "feature-3": { title: "ปรับให้เป็นของคุณ" },
            "locked-portrait": { title: "วิดีโอ Terminal แนวตั้ง" },
          },
        },
        sdk: {
          name: "SDK",
          items: {
            "locked-landscape": { title: "วิดีโอ SDK" },
            "frame-1": { title: "ภาพนิ่ง SDK 1" },
            "frame-2": { title: "ภาพนิ่ง SDK 2" },
            "frame-3": { title: "ภาพนิ่ง SDK 3" },
            "frame-4": { title: "ภาพนิ่ง SDK 4" },
            "feature-1": { title: "แก้ CI จากโค้ด" },
            "feature-2": { title: "ติดตามทุกขั้นตอน" },
            "feature-3": { title: "สร้างเครื่องมือของคุณ" },
            "locked-portrait": { title: "วิดีโอ SDK แนวตั้ง" },
          },
        },
      },
    },
    people: { title: "บุคคล" },
    anomalyLogo: {
      title: "โลโก้ Anomaly",
      body: "สัญลักษณ์และตัวอักษรแบรนด์ของ Anomaly ในสีดำและสีขาว ไฟล์ PNG กว้าง 2048 px",
      assets: {
        "mark-black": { name: "สัญลักษณ์ ดำ" },
        "mark-white": { name: "สัญลักษณ์ ขาว" },
        "wordmark-black": { name: "ตัวอักษรแบรนด์ ดำ" },
        "wordmark-white": { name: "ตัวอักษรแบรนด์ ขาว" },
      },
      all: { text: "ดาวน์โหลดทั้งหมด" },
    },
    coverage: { title: "ข่าวที่เผยแพร่" },
    brand: {
      title: "แบรนด์",
      before:
        "ดาวน์โหลดโลโก้และตัวอักษรแบรนด์ OpenCode ในไฟล์ ZIP เดียว สำหรับไฟล์แยก รูปแบบต่างๆ และกฎการใช้งาน ไปที่",
      link: { text: "หน้าแบรนด์" },
      after: " ",
      usage: "คุณใช้ไฟล์เหล่านี้เพื่อเขียนถึง OpenCode ได้ ห้ามแก้ไขไฟล์ และห้ามสื่อว่า OpenCode รับรองผลงานของคุณ",
    },
    product: {
      title: "ผลิตภัณฑ์",
      items: {
        desktop: {
          name: "Desktop",
          body: "รันเอเจนต์หลายตัวพร้อมกัน แต่ละตัวในแท็บของตัวเอง บน macOS, Windows และ Linux ตรวจทุกการเปลี่ยนแปลงเป็น diff และดูตัวอย่าง",
        },
        mobile: {
          name: "Mobile",
          body: "แอป OpenCode ใหม่ล่าสุด โทรหาเซสชันเพื่อคุยกับเอเจนต์ แล้วตรวจและอนุมัติการเปลี่ยนแปลงจากโทรศัพท์ได้ทุกที่",
        },
        terminal: {
          name: "Terminal",
          body: "UI เทอร์มินัลที่ใช้ได้ในทุกเชลล์ อีดิเตอร์ หรือเซิร์ฟเวอร์ระยะไกล ดูการแก้ไขแต่ละครั้งเป็น diff และเลือกว่าคำสั่งใดรันได้เอง",
        },
        sdk: {
          name: "SDK",
          body: "ไคลเอนต์ TypeScript แบบมีชนิดข้อมูลสำหรับสคริปต์ งาน CI และเครื่องมือของคุณ สร้างเซสชัน ส่งพรอมต์ และสตรีมทุกอีเวนต์ทันทีที่เกิดขึ้น",
        },
      },
    },
    contact: {
      title: "ติดต่อ",
      items: {
        press: { title: "สื่อมวลชน", body: "สำหรับผู้สื่อข่าวและนักวิเคราะห์ เราตอบเฉพาะคำขอจากสื่อเท่านั้น" },
        support: {
          links: { "github-issues": { text: "issue บน GitHub" }, "help-anoma-ly": { text: "help@anoma.ly" } },
          title: "ฝ่ายสนับสนุน",
          body: "หากต้องการความช่วยเหลือเกี่ยวกับ OpenCode ให้เปิด issue หรือถามในชุมชน สำหรับคำถามเรื่องบัญชีและการเรียกเก็บเงิน ส่งอีเมลถึงเรา",
        },
        security: {
          links: {
            "report-a-vulnerability": { text: "รายงานช่องโหว่" },
            "security-anoma-ly": { text: "security@anoma.ly" },
          },
          title: "ความปลอดภัย",
          body: "รายงานช่องโหว่ผ่าน GitHub หากไม่มีใครตอบภายใน 6 วันทำการ ส่งอีเมลถึงเรา",
        },
      },
    },
  },
  download: {
    desktop: { title: "Desktop" },
    mobile: { title: "Mobile", stores: { "google-play": { label: "Google Play" } } },
    terminal: { title: "Terminal", installs: { curl: { name: "สคริปต์" } } },
    extensions: {
      title: "ส่วนขยาย",
      items: {
        cursor: { label: "Cursor" },
        zed: { label: "Zed" },
        windsurf: { label: "Windsurf" },
        vscodium: { label: "VSCodium" },
      },
    },
    faq: {
      items: {
        "how-do-i-use-opencode": { answer: [undefined, undefined, undefined] },
        "can-i-use-my-existing-ai-subscriptions-with-opencode": { answer: [undefined, undefined, undefined] },
        "what-about-data-and-privacy": { answer: [undefined, undefined, undefined] },
      },
    },
  },
  productDownloads: {
    terminal: { commands: { curl: { name: "สคริปต์" } } },
    sdk: { more: { label: "อ่านเอกสาร SDK" } },
    ide: {
      lead: "รัน opencode ในเทอร์มินัลในตัวของอีดิเตอร์ แล้วส่วนขยายจะติดตั้งเอง หรือติดตั้งด้วยตัวเองก็ได้",
      links: {
        "vs-code-marketplace": { label: "VS Code Marketplace" },
        "open-vsx-cursor-windsurf-vscodium": { label: "Open VSX (Cursor, Windsurf, VSCodium)" },
      },
      more: { label: "ตั้งค่า Zed, JetBrains IDE และอีดิเตอร์ ACP อื่นๆ" },
    },
    mini: {
      commands: { curl: { name: "สคริปต์" } },
      lead: "Mini มาพร้อมกับ OpenCode CLI ติดตั้งด้วยวิธีใดก็ได้ด้านล่าง แล้วรัน opencode mini",
    },
  },
  pair: {
    title: "เชื่อมต่อโทรศัพท์ของคุณ",
    cardTitle: "จับคู่โทรศัพท์ด้วยคำสั่งเดียว",
    intro:
      "OpenCode Mobile คือรีโมตสำหรับ OpenCode บนคอมพิวเตอร์ของคุณ เซสชันยังคงทำงานอยู่บนคอมพิวเตอร์ ส่วนแอปจะแสดงเซสชันและให้คุณสั่งงานได้",
    steps: {
      "get-the-app": {
        title: "ติดตั้งแอป",
        body: "ติดตั้ง OpenCode เบต้าบน iPhone ของคุณจาก TestFlight แอป Android กำลังจะมาเร็วๆ นี้",
      },
      "run-this-on-your-computer": {
        title: "รันคำสั่งนี้บนคอมพิวเตอร์",
        body: "คำสั่งจะพิมพ์ลิงก์แบบใช้ครั้งเดียวและคิวอาร์โค้ด ใช้ได้ครั้งเดียวและหมดอายุใน 5 นาที",
      },
      "scan-the-code": {
        title: "สแกนโค้ด",
        body: "สแกนคิวอาร์โค้ดด้วยแอป หรือวางลิงก์ เซสชันล่าสุดในคอมพิวเตอร์จะเปิดบนโทรศัพท์ของคุณ",
      },
    },
    note: "--remote เชื่อมต่อผ่านที่อยู่ OpenTunnel จึงใช้ได้จากทุกเครือข่าย หากอยู่ใน Wi-Fi เดียวกัน ให้รัน opencode service set hostname 0.0.0.0 หนึ่งครั้ง แล้วรัน opencode pair",
    facts: [
      "การจับคู่ใช้ได้จากทุกเครือข่าย เพราะ --remote เชื่อมต่อผ่านที่อยู่ OpenTunnel",
      "ลิงก์และโค้ดใช้ได้ครั้งเดียวและหมดอายุใน 5 นาที",
      "เปิดคอมพิวเตอร์ไว้ เพราะเอเจนต์ทำงานบนคอมพิวเตอร์ ไม่ใช่บนโทรศัพท์",
      "หากอยู่ใน Wi-Fi เดียวกัน ให้รัน opencode service set hostname 0.0.0.0 หนึ่งครั้ง แล้วรัน opencode pair",
    ],
  },
  announcements: {
    "create-install-and-share-desktop-plugins": {
      text: "สร้าง ติดตั้ง และแชร์ปลั๊กอินเดสก์ท็อปได้แล้ว",
      link: "ดูสิ่งใหม่ในรุ่น 2.2",
    },
    "desktop-terminals-now-survive-restarts": { text: "เทอร์มินัลในแอปเดสก์ท็อปยังอยู่แม้รีสตาร์ต", link: "ดู v2.2.4" },
    "agents-can-now-generate-images": { text: "เอเจนต์สร้างรูปภาพได้แล้ว", link: "ดู v2.2.1" },
    "steer-your-sessions-from-your-phone": { text: "สั่งงานเซสชันจากโทรศัพท์ของคุณ", link: "รู้จัก OpenCode Mobile" },
    "a-refreshed-desktop-app": { text: "แอปเดสก์ท็อปโฉมใหม่", link: "ดูสิ่งใหม่ในรุ่น 2.2" },
  },
} satisfies ContentOverlay
