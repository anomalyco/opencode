# MUC Harness Implementation Plan

> 生成于 Phase 0 审计之后。所有结论基于源码事实，非记忆假设。
> 基线：OpenCode v1.18.31 fork（本仓库）+ Sub2API 后端/前端（`/Users/cccc/Desktop/共用/sub2api`）。

## 0. Phase 0 审计结论（源码事实）

### 0.1 仓库状态
- 本仓库 `opencode-muc`：v1.18.31 浅克隆 + 8 个未提交补丁文件（TUI 品牌、minzu 主题、动态模型发现 `provider/muc.ts`）。
- **安全整改项**：现有 `packages/opencode/src/provider/muc.ts` 内烧入了一把真实 Sub2API Key（违反新硬性约束 §3.1），Phase 1 必须移除并改为凭据驱动。

### 0.2 Desktop（packages/desktop）已有能力（可直接复用）
| 能力 | 位置 | 状态 |
|---|---|---|
| 单实例锁 | `src/main/index.ts:198` `requestSingleInstanceLock` | ✅ 已有 |
| second-instance 深链 | `index.ts:205` → `emitDeepLinks` | ✅ 已有（opencode://） |
| open-url 深链 | `index.ts:218` | ✅ 已有 |
| 协议注册 | `index.ts:271` `setAsDefaultProtocolClient("opencode")` | ➕ 追加 `muc` |
| deep link → renderer | `emitDeepLinks` → `pendingDeepLinks` + `sendDeepLinks` → renderer `env.d.ts deepLinks` → `packages/app/src/pages/layout/deep-links.ts` → `app.tsx` | ✅ 通道现成，需加 connect 路由 |
| 打包 | `electron-builder.config.ts`（mac: dmg+zip，APP_IDS[channel]）| ➕ 加 MUC 变体与 protocols |
| 凭据存储 | 无 SecretStore；opencode 核心凭据为 `~/.local/share/opencode/auth.json` 明文 | ➕ Phase 1 新建 safeStorage（Keychain 背书）|

### 0.3 Sub2API 后端（Go + ent + gin）
- 路由：`internal/server/router.go`，`/api/v1` 分组；用户级密钥接口已存在：`v1Keys.GET/POST /keys`（见 `api_contract_test.go:1517`），`APIKeyHandler.Create`（`api_key_handler.go:182`）→ **per-device key 第一版即可真创建**（exchange 时以用户身份调内部服务建 `MUC <device>` Key）。
- 前端鉴权：`frontend/src/api/client.ts:43-46`，localStorage `auth_token` + Bearer → connect-code 接口复用现有 JWT 中间件。
- 前端框架：Vue 3 + axios；路由在 `frontend/src/router/index.ts`。

### 0.4 动态模型机制（保留，不破坏）
- `provider/muc.ts` + `provider.ts` 已实现 `GET /v1/models` 动态展开（11 模型实测通过）。Phase 1 仅改凭据来源：`环境变量 MUC_API_KEY（Desktop 注入，不落盘）→ 用户 config（既有行为）`，**移除烧入 Key**。

### 0.5 签名与分发
- `security find-identity`：**无 Developer ID 证书** → Phase 6 产出开发测试版 DMG（ad-hoc 签名），报告中显式标注 `BLOCKED: 正式公网分发仍需 Apple Developer ID + notarization`。

### 0.6 环境风险
- 网关 `http://admin.wuxuexi.top` 当前 3/4 旧 Key 失效、claude 分组上游暂不可用 → E2E 真实推理（验收 N）可能受阻，需以可用的 per-device Key + 上游恢复为前提，报告中如实记录。
- Base URL 常量化：`https` 优先、允许 `MUC_GATEWAY_URL` 环境覆盖，禁止写死 http-only。

## 1. 架构

```
网站(sub2api frontend, Vue)
  /muc 页面: 平台识别 → [下载 MUC] / [一键连接 MUC]
        │ POST /api/v1/muc/connect-code   (JWT, 已登录)
        │ ← { code, expires_in: 60 }
        ▼ location.href = muc://connect?code=...
MUC Desktop (Electron, packages/desktop)
  main: open-url/second-instance → emitDeepLinks → renderer
        ├ single-instance（已有）
        ├ MucConnectService: POST /api/v1/muc/exchange {code}
        │    ← { gateway, api_key, key_name, user }
        ├ SecretStore: safeStorage(macOS=Keychain) 加密存 userData/muc-credential.bin
        └ IPC: muc:getState / muc:connect / muc:disconnect
        ▼ 注入 MUC_API_KEY(内存) 给内嵌 opencode server
opencode core (packages/opencode)
  provider/muc.ts: 凭据驱动 → GET {gateway}/v1/models → 动态注册模型（机制不变）
```

## 2. 安全设计（对照硬性约束）
- 真实 Key 只存在于：Sub2API 数据库（key 本体哈希校验）、exchange 响应（内存/TLS）、本机 safeStorage 密文。
- connect-code：随机 32B → 存 SHA-256 哈希（60s TTL，单次使用，绑定用户+设备名）；DB 不存明文 code，日志不出现 code/Key。
- exchange：哈希比对 + TTL + 未使用（DB 原子置 used）+ 用户有效 → 以该用户身份创建 per-device Key（名 `MUC <device>`，可单独撤销）→ 返回。接口留 `device_id` 字段以便未来升级绑定。
- 客户端源码/asar/安装包：无任何真实 Key（验收 A/B）；CI 上加 grep 检查 `sk-[0-9a-f]{32,}`。

## 3. 阶段拆分（与执行一致，逐 Phase commit）
| Phase | 内容 | 验收项 |
|---|---|---|
| 0 | 本文件 + 基线 commit | — |
| 1 | Desktop SecretStore(safeStorage→Keychain) + muc.ts 移除烧入 Key、凭据驱动化 + connected/disconnected 状态 | A,G,J,K |
| 2 | `muc` 协议注册 + connect 路由解析 + 冷/热启动 + 错误处理 + URL 解析单测 | C |
| 3 | 后端 connect-code/exchange + ent 迁移 + handler 测试（60s/单次/绑定/无日志泄露）| D,E,F |
| 4 | 网站 /muc 页面（平台识别、下载、一键连接、未装提示）| F |
| 5 | MUC 自动连接 UI（品牌连接页=校门背景）+ exchange→存储→/v1/models 同步→进入主界面 + 设置断开 | H,I,J,K |
| 6 | electron-builder MUC 变体 → dist/MUC-mac-arm64.dmg（无证书→开发测试版+BLOCKED 标注）| B,M |
| 7 | E2E（登录→连接→同步→推理）+ `docs/MUC_DISTRIBUTION_REPORT.md` | N |

## 4. 不做的事
- 不重写 opencode 核心/provider 系统；不破坏动态模型机制；不引入大型新依赖（safeStorage 为 Electron 内建）。
- 不修改 `/Applications/OpenCode.app`；MUC 独立打包。
- 不把管理员凭据/上游凭据暴露给客户端（exchange 只返回该用户自己的 Key）。

## 5. 已知限制（预测，Phase 7 复核）
- 正式分发需 Developer ID + notarization（当前机器无证书）。
- Windows 包第二阶段。
- E2E 真实推理依赖网关上游恢复与测试账号。
- HTTP 兼容仅限开发期；发布默认 HTTPS。
