# Hướng dẫn dùng fork opencode + Langfuse

Fork: https://github.com/viethungvili/opencode (upstream: `anomalyco/opencode`)
Branches custom:
- `custom/main` — integration branch, theo sát `dev` của upstream
- `custom/langfuse-config` — feature branch chứa `opencode.jsonc` + `.env.example`

Setup này cho phép gọi `opencode` ở bất kỳ đâu trên máy, mọi LLM call tự động về Langfuse self-hosted: https://langfuse.vili.vn

---

## 1. Cài đặt lần đầu (WSL2 Ubuntu — môi trường chính)

Chạy lần lượt:

```bash
# Bun (runtime cho opencode)
curl -fsSL https://bun.com/install | bash
source ~/.bashrc

# Node (cần cho launcher của opencode binary)
sudo apt-get install -y nodejs

# opencode global
bun i -g opencode-ai
opencode --version    # verify

# Clone fork (để pull update từ upstream)
mkdir -p ~/code && cd ~/code
git clone https://github.com/viethungvili/opencode.git
cd opencode
git remote add upstream https://github.com/anomalyco/opencode.git
git checkout custom/langfuse-config
bun install            # ~2 phút
```

Cài Git Credential Manager hoặc dùng gh token cho push từ WSL2 (xem mục 6).

---

## 2. Cấu hình global (1 lần)

### 2a. File config opencode

```bash
mkdir -p ~/.config/opencode
cat > ~/.config/opencode/config.json <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "experimental": {
    "openTelemetry": true
  },
  "model": "deepseek/deepseek-v4-flash",
  "provider": {
    "deepseek": {
      "models": {
        "deepseek-v4-flash": {
          "name": "DeepSeek V4 Flash"
        }
      }
    }
  }
}
EOF
```

### 2b. Env vars (DeepSeek + Langfuse) — append vào `~/.bashrc`

```bash
cat >> ~/.bashrc <<'EOF'

# OPENCODE_LANGFUSE_BLOCK begin
export DEEPSEEK_API_KEY=sk-7ef2b9ad06394fec937ea805137f702a
export OTEL_EXPORTER_OTLP_ENDPOINT=https://langfuse.vili.vn/api/public/otel
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic cGstbGYtMTlmMmYxNDYtMWEyNC00ODYwLThkOTctOTgxYjBhMTMyODU4OnNrLWxmLTMyNzMyZGU1LWE2M2UtNGExMS1hMmZjLTM4NDJjNTkxNzIyNQ=="
export OTEL_BSP_SCHEDULE_DELAY=100
export OTEL_BSP_EXPORT_TIMEOUT=10000
# OPENCODE_LANGFUSE_BLOCK end
EOF
source ~/.bashrc
```

> **Quan trọng**: dấu `"..."` quanh `OTEL_EXPORTER_OTLP_HEADERS` là bắt buộc — giá trị có space sau `Basic`, bash sẽ split nếu không quote.

---

## 3. Cách dùng hằng ngày

Mở terminal WSL2 ở **bất kỳ đâu**:

```bash
# TUI (interactive, Tab để switch giữa agent build / plan)
opencode

# One-shot
opencode run "viết hàm fibonacci bằng Python"

# TUI cho project cụ thể
cd /path/to/your-project
opencode
```

Mọi prompt đều tự ghi trace vào Langfuse trong ~2-3 phút (lag pipeline nội bộ). Vào https://langfuse.vili.vn/project/cmom4c9rs001ep607fx972ttx → **Tracing** → **Generations** để xem.

---

## 4. Reference cấu hình

### opencode.jsonc trong fork (đã commit)

Áp dụng khi `cd` vào fork dir. Có cùng nội dung như global `~/.config/opencode/config.json`. Khi chạy ở fork dir, project config thắng global config.

### .env trong fork (gitignored, KHÔNG commit)

Tạo từ `.env.example`. Áp dụng khi chạy `bun run dev` từ source. Khi dùng `opencode` global thì env trong `~/.bashrc` mới active.

### Phân quyền

- Global config: `~/.config/opencode/config.json` — áp dụng khắp nơi
- Project config: `<dir>/opencode.jsonc` (hoặc `.json`) — override khi cwd ở dir đó
- Env vars: ưu tiên cao nhất, override mọi config

---

## 5. Workflow update fork từ upstream

Định kỳ kéo code mới về fork:

```bash
cd ~/code/opencode
git fetch upstream

# Sync dev với upstream
git checkout dev
git merge upstream/dev
git push origin dev

# Đẩy custom/main theo dev
git checkout custom/main
git merge dev
git push origin custom/main

# Rebase custom/langfuse-config (và các branch custom khác) lên custom/main
git checkout custom/langfuse-config
git rebase custom/main
git push -f origin custom/langfuse-config
```

Khi muốn thêm feature custom mới: tách branch từ `custom/main`:

```bash
git checkout -b custom/<feature> custom/main
# ... commit ...
git push -u origin custom/<feature>
```

---

## 6. Push từ WSL2 (lần đầu cần auth)

WSL2 không có GitHub credential sẵn. Dùng token từ gh CLI Windows:

```bash
# Trên Windows (PowerShell hoặc git-bash):
gh auth token

# Copy token, sau đó trên WSL2:
TOKEN="ghp_xxxxxxxxxxxx"
git -c http.extraHeader="Authorization: Bearer $TOKEN" push origin <branch>
```

Hoặc cấu hình credential helper Windows GCM một lần (cần test thêm trên setup của bạn):

```bash
git config --global credential.helper "/mnt/c/Program\\ Files/Git/mingw64/bin/git-credential-manager.exe"
```

---

## 7. Khi nào cần build binary từ fork

Bạn đang dùng `opencode-ai` từ npm — code y hệt fork vì fork chưa có thay đổi code, chỉ có config files. Chỉ cần build binary từ fork khi:

- Bạn sửa code TypeScript trong `packages/opencode/src/`
- Bạn thêm provider/tool/agent mới trong `packages/opencode/src/`

Khi đó:

```bash
cd ~/code/opencode
bun run --cwd packages/opencode build
# binary ra: packages/opencode/bin/.opencode hoặc dist/
# copy vào ~/.local/bin/opencode để override npm version
```

---

## 8. Troubleshooting

| Triệu chứng | Nguyên nhân | Fix |
|---|---|---|
| Trace không lên Langfuse | BatchSpanProcessor delay default 5s, opencode `run` thoát trước khi flush | Set `OTEL_BSP_SCHEDULE_DELAY=100` trong env |
| Bash báo "command not found: cGst..." | Header value chứa space mà không quote | Bọc value bằng `"..."` trong .env hoặc bashrc |
| `bun typecheck` fail trên Windows: `TS1128 Declaration or statement expected` | Windows checkout không xử lý git symlinks | Push từ WSL2 hoặc bật Developer Mode + `git config core.symlinks true` |
| `/usr/bin/env: 'node': No such file` | opencode launcher cần node | `apt install nodejs` |
| Trace có nhưng không thấy LLM input/output | Thiếu `experimental.openTelemetry: true` trong config | Bật trong `~/.config/opencode/config.json` |
| Pre-push hook fail "bun: command not found" | Bun chưa trong PATH | `source ~/.bashrc` hoặc cài bun |

---

## 9. Verify nhanh setup còn ổn

```bash
# Env vars có?
env | grep -E "OTEL|DEEPSEEK"

# Config được load?
opencode debug config | head -10

# Langfuse có nhận trace?
opencode run "say HI_$(date +%s)"
sleep 180
curl -sSu "$LANGFUSE_PK:$LANGFUSE_SK" https://langfuse.vili.vn/api/public/observations?type=GENERATION\&limit=3 | python3 -m json.tool
```

---

## 10. Khoá / token tham chiếu (KHÔNG commit)

Đường dẫn local (Windows):
- DeepSeek: `E:\HUNG\code\opencode\api-key\api deepseek cho opencode dung.txt`
- Langfuse: `E:\HUNG\code\opencode\langfuse\langfuse key opencode.txt`

Project Langfuse: `cmom4c9rs001ep607fx972ttx` ([settings](https://langfuse.vili.vn/project/cmom4c9rs001ep607fx972ttx/settings)).
