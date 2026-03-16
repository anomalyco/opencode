<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">เอเจนต์สำหรับเขียนโค้ดด้วย AI แบบโอเพนซอร์ส</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="สถานะการสร้าง" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### วิธีการติดตั้ง

```bash
# YOLO(ใช้คำสั่งเดียว)
curl -fsSL https://opencode.ai/install | bash

# ใช้ตัวจัดการแพ็กเกจ
npm i -g opencode-ai@latest        # หรือใช้ bun/pnpm/yarn
scoop install opencode             # สำหรับ Windows
choco install opencode             # สำหรับ Windows
brew install anomalyco/tap/opencode # สำหรับ macOS และ Linux (แบบแนะนำ,อัปเดตสม่ำเสมอ)
brew install opencode              # สำหรับ macOS และ Linux (brew formula แบบเป็นทางการ,อัปเดตน้อยกว่า)
sudo pacman -S opencode            # สำหรับ Arch Linux (Stable)
paru -S opencode-bin               # สำหรับ Arch Linux (Latest from AUR)
mise use -g opencode               # ระบบปฏิบัติการใดก็ได้
nix run nixpkgs#opencode           # หรือ github:anomalyco/opencode สำหรับเวอชันพัฒนาล่าสุด
```

> [!TIP]
> ลบเวอร์ชันที่เก่ากว่า 0.1.x ก่อนติดตั้ง

### แอปพลิเคชันเดสก์ท็อป (เบต้า)

OpenCode มีแอปพลิเคชันเดสก์ท็อปให้ใช้งาน สามารถดาวน์โหลดได้โดยตรงจาก [หน้ารายละเอียดเวอร์ชัน](https://github.com/anomalyco/opencode/releases) หรือ [opencode.ai/download](https://opencode.ai/download)

| แพลตฟอร์ม             | ดาวน์โหลด                             |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, หรือ AppImage         |

```bash
# macOS (Homebrew)ติดตั้งบน macOS
brew install --cask opencode-desktop
# Windows (Scoop)ติดตั้งบน Windows
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### ไดเรกทอรีการติดตั้ง

สคริปต์การติดตั้งจะใช้ลำดับความสำคัญตามเส้นทางการติดตั้ง:

1. `$OPENCODE_INSTALL_DIR` - ไดเรกทอรีการติดตั้งที่กำหนดเอง
2. `$XDG_BIN_DIR` - เส้นทางที่สอดคล้องกับ XDG Base Directory Specification
3. `$HOME/bin` - ไดเรกทอรีไบนารีผู้ใช้มาตรฐาน (หากมีอยู่หรือสามารถสร้างได้)
4. `$HOME/.opencode/bin` - ค่าสำรองเริ่มต้น

```bash
# ตัวอย่าง
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### เอเจนต์

OpenCode มาพร้อมกับเอเจนต์ภายในสองตัวที่คุณสามารถสลับได้ด้วยปุ่ม `Tab`

- **build** - เอเจนต์เริ่มต้น มีสิทธิ์เข้าถึงแบบเต็มสำหรับงานพัฒนาโปรแกรม
- **plan** - เอเจนต์แบบอ่านอย่างเดียวสำหรับการวิเคราะห์ และ การสำรวจโค้ด
  - ปฏิเสธการแก้ไขไฟล์เป็นค่าเริ่มต้น
  - ขออนุญาตก่อนเรียกใช้คำสั่ง bash
  - เหมาะสำหรับสำรวจโค้ดเบสที่ไม่คุ้นเคย หรือ วางแผนการเปลี่ยนแปลง

นอกจากนี้ยังมีเอเจนต์ย่อย **general** สำหรับการค้นหาที่ซับซ้อน และ การทำงานหลายขั้นตอน
ให้ใช้ภายในและสามารถเรียกใช้ได้โดยใช้ `@general` ในข้อความ

เรียนรู้เพิ่มเติมเกี่ยวกับ [เอเจนต์](https://opencode.ai/docs/agents)

### เอกสารประกอบ

สำหรับข้อมูลเพิ่มเติมเกี่ยวกับวิธีการตั้งค่า OpenCode [**ไปที่เอกสารของเรา**](https://opencode.ai/docs)

### การมีส่วนร่วม

หากคุณสนใจที่จะมีส่วนร่วมใน OpenCode โปรดอ่าน [เอกสารการมีส่วนร่วม](./CONTRIBUTING.md) ก่อนส่ง Pull Request

### การพัฒนาระบบต่อยอดจาก OpenCode

หากคุณทำงานในโปรเจกต์ที่มีส่วนเกี่ยวข้องกับ OpenCode และใช้ "opencode" เป็นส่วนหนึ่งของชื่อ เช่น "opencode-dashboard" หรือ "opencode-mobile" โปรดเพิ่มหมายเหตุใน README ของคุณเพื่อชี้แจงว่าไม่ได้สร้างโดยทีม OpenCode และไม่ได้มีส่วนเกี่ยวข้องใดๆกับเรา

### คำถามที่พบบ่อย

#### ต่างจาก Claude Code อย่างไร?

มีความคล้ายกับ Claude Code อย่างมากในแง่ความสามารถ
ส่วนที่แตกต่างกันหลักๆมีดังนี้:

- โอเพนซอร์ส 100%
- ไม่ผูกมัดกับผู้ให้บริการใดๆ แม้ว่าเราจะแนะนำโมเดลที่เราจัดหาให้ผ่าน [OpenCode Zen](https://opencode.ai/zen) OpenCode สามารถใช้งานได้กับ Claude, OpenAI, Google หรือแม้กระทั่งโมเดลภายในเครื่องได้,เมื่อโมเดลมีการพัฒนามากขึ้นทำให้ช่องว่างระหว่างโมเดลลดลงและส่งผลให้ราคาลดลง ดังนั้นการไม่ต้องผูกมัดกับผู้ให้บริการจึงสำคัญ
- รองรับ LSP ใช้งานได้ทันทีหลังการติดตั้งโดยไม่ต้องปรับแต่งหรือเปลี่ยนแปลงฟังก์ชันการทำงานใด ๆ
- มุ่งเน้นที่การใช้งานผ่าน TUI OpenCode สร้างโดยผู้ใช้ neovim และ ผู้สร้าง [terminal.shop](https://terminal.shop) เราจะผลักดันขีดจำกัดของสิ่งที่เป็นไปได้ในเทอร์มินัล
- สถาปัตยกรรมไคลเอนต์/เซิร์ฟเวอร์ ตัวอย่าง เช่น อาจอนุญาตให้ OpenCode ทำงานบนคอมพิวเตอร์ของคุณ โดยที่คุณสามารถควบคุมการทำงานของมันจากระยะไกลผ่านแอปมือถือ หมายความว่า TUI frontend เป็นเพียงหนึ่งในไคลเอนต์ที่เป็นไปได้

---

**เข้าร่วมคอมมูนิตี้ของเรา** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
