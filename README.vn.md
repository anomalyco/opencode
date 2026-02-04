<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">AI Coding Agent mã nguồn mở.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
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
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.vn.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Cài đặt

```bash
# Cài đặt nhanh (YOLO)
curl -fsSL https://opencode.ai/install | bash

# Trình quản lý gói
npm i -g opencode-ai@latest        # hoặc bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS và Linux (khuyên dùng, luôn cập nhật mới nhất)
brew install opencode              # macOS và Linux (formula chính thức của brew, cập nhật ít hơn)
paru -S opencode-bin               # Arch Linux
mise use -g opencode               # Mọi hệ điều hành
nix run nixpkgs#opencode           # hoặc github:anomalyco/opencode để lấy nhánh dev mới nhất
```

> [!TIP]
> Hãy gỡ bỏ các phiên bản cũ hơn 0.1.x trước khi cài đặt.

### Ứng dụng Desktop (BETA)

OpenCode cũng có phiên bản ứng dụng desktop. Tải trực tiếp từ [trang releases](https://github.com/anomalyco/opencode/releases) hoặc [opencode.ai/download](https://opencode.ai/download).

| Nền tảng              | Tải về                                |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, hoặc AppImage         |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Thư mục cài đặt

Script cài đặt sử dụng thứ tự ưu tiên sau cho đường dẫn cài đặt:

1. `$OPENCODE_INSTALL_DIR` - Thư mục cài đặt tùy chỉnh
2. `$XDG_BIN_DIR` - Đường dẫn tuân theo XDG Base Directory Specification
3. `$HOME/bin` - Thư mục binary của người dùng (nếu tồn tại hoặc có thể tạo)
4. `$HOME/.opencode/bin` - Đường dẫn mặc định dự phòng

```bash
# Ví dụ
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode có sẵn hai agent tích hợp, bạn có thể chuyển đổi bằng phím `Tab`.

- **build** - Mặc định, agent có toàn quyền truy cập để phát triển
- **plan** - Agent chỉ đọc để phân tích và khám phá code
  - Mặc định từ chối chỉnh sửa file
  - Hỏi quyền trước khi chạy lệnh bash
  - Lý tưởng để khám phá codebase mới hoặc lên kế hoạch thay đổi

Ngoài ra còn có **general** subagent cho các tìm kiếm phức tạp và tác vụ nhiều bước.
Agent này được sử dụng nội bộ và có thể gọi bằng `@general` trong tin nhắn.

Tìm hiểu thêm về [agents](https://opencode.ai/docs/agents).

### Tài liệu

Để biết thêm thông tin về cách cấu hình OpenCode, [**hãy xem tài liệu của chúng tôi**](https://opencode.ai/docs).

### Đóng góp

Nếu bạn muốn đóng góp cho OpenCode, vui lòng đọc [hướng dẫn đóng góp](./CONTRIBUTING.md) trước khi gửi pull request.

### Xây dựng trên nền OpenCode

Nếu bạn đang làm việc trên một dự án liên quan đến OpenCode và sử dụng "opencode" trong tên dự án, ví dụ "opencode-dashboard" hoặc "opencode-mobile", vui lòng thêm ghi chú vào README để làm rõ rằng dự án không được xây dựng bởi đội ngũ OpenCode và không liên kết với chúng tôi.

### Câu hỏi thường gặp (FAQ)

#### Điều này khác gì với Claude Code?

Về khả năng thì rất giống Claude Code. Đây là những điểm khác biệt chính:

- 100% mã nguồn mở
- Không phụ thuộc vào bất kỳ nhà cung cấp nào. Mặc dù chúng tôi khuyên dùng các model qua [OpenCode Zen](https://opencode.ai/zen), OpenCode có thể sử dụng với Claude, OpenAI, Google, hoặc thậm chí các model chạy local. Khi các model phát triển, khoảng cách giữa chúng sẽ thu hẹp và giá sẽ giảm, vì vậy việc không phụ thuộc nhà cung cấp là rất quan trọng.
- Hỗ trợ LSP sẵn có
- Tập trung vào TUI. OpenCode được xây dựng bởi những người dùng neovim và những người tạo ra [terminal.shop](https://terminal.shop); chúng tôi sẽ đẩy giới hạn của những gì có thể làm được trong terminal.
- Kiến trúc client/server. Điều này cho phép OpenCode chạy trên máy tính của bạn trong khi bạn điều khiển từ xa qua ứng dụng di động, nghĩa là giao diện TUI chỉ là một trong những client có thể có.

---

**Tham gia cộng đồng** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
