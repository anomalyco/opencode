# 内网 / 断网部署 OpenCode Web

在本地构建前端后，通过 **`OPENCODE_APP_DIST`** 指定 `vite build` 产物目录，服务端会优先提供静态文件，**不再依赖** `https://app.opencode.ai` 代理。若未设置或目录下无 `index.html`，仍会回退到该代理（需外网）。

---

## 1. 联网时：构建前端

```bash
cd /path/to/opencode
export PATH="$HOME/.bun/bin:$PATH"
bun install
cd packages/app
bun run build
```

确认存在 **`packages/app/dist/index.html`**。

---

## 2. 环境变量（内网）

| 变量 | 说明 |
|------|------|
| `OPENCODE_APP_DIST` | 前端 `dist` 目录的**绝对路径**（须含 `index.html`）。不设则尝试使用仓库内 `packages/app/dist` 相对路径。 |
| `OPENCODE_DISABLE_MODELS_FETCH` | 设为 `1` 关闭对 `https://models.dev` 的定时拉取。 |
| `OPENCODE_MODELS_PATH` | 指向本地 `models-api.json`（仓库内 **`offline/models-api.json`** 或联网时自行下载）。 |
| `OPENCODE_DISABLE_AUTOUPDATE` | 设为 `1` 关闭自动更新检查。 |
| `OPENCODE_SERVER_PASSWORD` | 建议设置，为 Web 服务提供 Basic 认证。 |

下载模型列表（若未使用仓库内 `offline/models-api.json`）：

```bash
mkdir -p offline
curl -fsSL "https://models.dev/api.json" -o offline/models-api.json
```

---

## 3. 启动

```bash
export PATH="$HOME/.bun/bin:$PATH"
REPO="/path/to/opencode"
export OPENCODE_APP_DIST="$REPO/packages/app/dist"
export OPENCODE_DISABLE_MODELS_FETCH=1
export OPENCODE_MODELS_PATH="$REPO/offline/models-api.json"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_SERVER_PASSWORD="your-strong-password"

cd "$REPO/packages/opencode"
bun run --conditions=browser ./src/index.ts web
```

浏览器打开终端里打印的地址（一般为 `http://127.0.0.1:4096/`）。

---

## 4. 与本仓库相关的离线资源

- **`packages/app/public/changelog.json`**：发布说明请求同源路径 `/changelog.json`，构建后会进入 `dist`。
- **`offline/models-api.json`**：供 `OPENCODE_MODELS_PATH` 使用（可选，但断网建议配置）。

---

## 5. 排错

| 现象 | 处理 |
|------|------|
| 白屏或无法加载 UI | 检查 `OPENCODE_APP_DIST` 与 `dist/index.html` 是否存在。 |
| 仍访问外网拉前端 | 未正确设置 `OPENCODE_APP_DIST` 或路径无效，会回退代理 `app.opencode.ai`。 |

---

## 6. 本机路径示例

若仓库在：

`/Users/chenlong/Desktop/ai-projects/opencode`

将上文 `REPO` 与 `path/to/opencode` 替换为该路径即可。
