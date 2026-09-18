# MUC Harness 分发与实现报告

> 生成：2026-09-18 · 基线 OpenCode v1.18.31 · Sub2API（Wei-Shaw/sub2api fork）
> 计划文件：`IMPLEMENTATION_PLAN.md`（仓库根）

## 1. Architecture

```
Sub2API 网站 (Vue 3, admin.wuxuexi.top)
  /muc 页面: 平台识别 → [下载 MUC] → [一键连接 MUC]
      │ POST /api/v1/muc/connect-code        (JWT 登录态)
      │ ← { code, expires_in: 60 }
      ▼ location.href = muc://connect?code=...
MUC Desktop (Electron, /Applications/MUC.app)
      │ main: open-url / second-instance → emitDeepLinks（单实例锁，已有）
      │ MucConnectController.connect(code):
      │   POST /api/v1/muc/exchange { code, device_name }
      │   ← { gateway, api_key, key_name, user }   ← 该用户 per-device Key
      │ MucSecretStore: safeStorage(macOS=Keychain) 密文 → userData/muc-credential.bin
      │ process.env.MUC_API_KEY = <key>（仅内存）
      ▼ 注入内嵌 opencode server
opencode core (fork: packages/opencode/src/provider/muc.ts)
      GET {gateway}/v1/models → 动态注册该用户可用模型（机制与 Phase 前一致）
```

## 2. Changed Files

### opencode-muc 仓库（branch `muc-harness`）
| 文件 | 变更 |
|---|---|
| `packages/tui/src/logo.ts` `component/logo.tsx` `util/presentation.ts` | MUC 校名字符画/校训（品牌） |
| `packages/tui/src/theme/index.ts` + `assets/minzu.json` | minzu 内置主题并设为默认 |
| `packages/tui/src/context/theme.tsx` | 默认主题 fallback → minzu |
| `packages/opencode/src/provider/muc.ts` | 网关常量（HTTPS 优先 + `MUC_GATEWAY_URL` 覆盖）、`/v1/models` 发现；**无任何烧入 Key** |
| `packages/opencode/src/provider/provider.ts` | 凭据驱动的 sub2api provider 注入 + 动态模型展开 |
| `packages/desktop/src/main/muc/secret-store.ts` | safeStorage（Keychain 背书）凭据存储 |
| `packages/desktop/src/main/muc/deep-link.ts`(+test) | `muc://connect?code=` 解析（拒绝 key 参数走私）|
| `packages/desktop/src/main/muc/connect.ts` `controller.ts` | exchange 客户端 + 连接控制器 + 模型计数 |
| `packages/desktop/src/main/muc/ipc.ts` | `muc:get-state/connect/disconnect/pending-code` |
| `packages/desktop/src/main/index.ts` | muc 协议注册、深链捕获（日志脱敏）、启动凭据恢复（限时异步）|
| `packages/desktop/src/main/constants.ts` `scripts/*` `electron*.ts` | `muc` 打包通道（appId `cn.edu.muc.harness`、productName MUC、protocols、sidecar 打包、TAURI_APP_IDS）|
| `packages/ui/src/components/logo.tsx` `v2/components/wordmark-v2.tsx` | 源码级品牌：Mark/Splash 民 字徽标、WordmarkV2 校名水印 |
| `packages/app/src/assets/help/home.png` | 校门合成图 |

### sub2api 仓库
| 文件 | 变更 |
|---|---|
| `backend/internal/handler/muc_connect_handler.go` | connect-code / exchange 处理器（窄接口可测）|
| `backend/internal/handler/muc_connect_handler_test.go` | 6 个测试（miniredis）|
| `backend/internal/server/routes/muc.go` + `router.go` | 路由注册（connect-code 需登录；exchange 公开）|
| `backend/internal/handler/handler.go` `wire.go` `cmd/server/wire_gen.go` | Handlers 聚合与依赖接线 |
| `frontend/src/api/muc.ts` `views/user/MucView.vue` `router/index.ts` | /muc 页面 |

## 3. Credential Security
- 真实 Key 只存在于：Sub2API 数据库、exchange 响应（内存/TLS）、本机 safeStorage 密文。
- 客户端源码扫描（`sk-[0-9a-f]{32,}`）：opencode-muc 与 sub2api 前后端均 **0 命中**（验收 A）。
- 构建包 asar 解包扫描：0 命中（验收 B）。
- Phase 1 前曾被烧入的 Key 已从 `muc.ts` 移除（历史 commit 21922ef 含 Key，如仓库外泄需轮换该 Key —— 已在 Release Checklist 标注）。

## 4. Deep Link Flow
- 注册：`setAsDefaultProtocolClient("muc")`（运行时）+ Info.plist `CFBundleURLTypes`（构建配置）。
- 单实例：`requestSingleInstanceLock`（上游已有）；热启动 `second-instance` → 现有窗口前置并处理。
- 解析：`muc://connect?code=` 之外一律忽略；`key`/`api_key` 参数直接拒绝；code 形状校验 `[A-Za-z0-9_-]{16,128}`。
- 日志：深链仅记录协议与数量，不记录 code（`src/main/index.ts` 脱敏改造）。

## 5. Website Flow
- `/muc`（需登录）：UA + User-Agent Client Hints 识别 `mac-arm / mac-intel / win`，推荐项高亮；下载指向同源 `/downloads/MUC-*.dmg|exe`（部署时将 `dist/` 产物挂载到该路径）。
- 一键连接：签发 code → `location.href = muc://connect?...`；2.5s 未失焦判定未安装 → 展示安装引导。
- 未登录：路由守卫跳登录（验收 F 的前端面）。

## 6. Packaging
- `OPENCODE_CHANNEL=muc` → electron-builder 产出：
  - `packages/desktop/dist/MUC-mac-arm64.dmg`（含 MUC.app + Applications 拖装链接）
  - 内嵌 fork CLI sidecar（`resources/opencode-cli`，版本 `0.0.0-muc-harness-*`，冒烟通过）
  - Info.plist：URL Schemes `muc`/`opencode`；已移除 `ElectronAsarIntegrity`（换皮需求）
- **BLOCKED**：本机 `security find-identity` 无 Apple Developer ID 证书 → 当前 DMG 为 ad-hoc 开发测试签名，不可正式公网分发；正式发布需 Developer ID Application 证书 + Hardened Runtime + notarization + staple。
- Windows：✅ 已完成 `mucode-windows-x64.exe`（NSIS 一键安装，免 wine：`signAndEditExecutable:false`，需 Rosetta 运行 makensis）。exe 未内嵌自定义图标/版本信息（该步骤需 Windows/wine），功能不受影响。
- Linux：CLI 侧车已产出（`opencode-linux-*`），AppImage/deb 打包按需追加。

## 7. E2E Tests（实际执行证据）
| 验收 | 测试 | 结果 |
|---|---|---|
| D 单次使用 | `go test ./internal/handler/ -run TestMuc`：`TestMucExchange_HappyPath_SingleUse` | ✅（二次 exchange 404）|
| E 过期/未知 | `TestMucExchange_UnknownOrExpiredCode` | ✅ 404 |
| F 未登录 | `TestMucConnectCode_RequiresAuth` | ✅ 401 |
| A/B Key 泄漏扫描 | grep `sk-[0-9a-f]{32,}`（源码+构建包） | ✅ 0 命中 |
| G 未配置可打开 | 启动 → 品牌连接门（CDP 截图 `/tmp/muc_e2e_gate.png`）| ✅ |
| H 自动连接 | CDP 驱动 `muc:connect`：`ok:true, modelCount:2`（mock 网关 2 模型）| ✅ |
| I 动态模型 | CLI `models` 命令实测 11 个 claude 模型动态拉取 | ✅ |
| J 重启免授权 | 连接 → 杀进程 → 重启 → `mucGetState` connected:true | ✅ |
| K 断开删除 | `mucDisconnect` → `muc-credential.bin` 不存在 | ✅ |
| L 原版无影响 | `/Applications/OpenCode.app` 未修改 | ✅ |
| M DMG | `dist/mucode-mac-arm64.dmg` + `mucode-mac-x64.dmg` + `mucode-win-x64.exe` | ✅ |
| N 真实推理 | **受阻**：网关 3 把旧 Key 失效 + claude 分组上游 "Service temporarily unavailable"（curl 复现，与代码无关）| ⏸ |
| C URL 无 Key | 解析器拒绝 key 参数 + 网站端只发 code | ✅ |

E2E 环境：本地 mock 授权服务（`/tmp/muc_mock_server.py`）+ 真实 MUC.app + CDP（`--remote-debugging-port=9444`）。

## 8. Known Limitations
1. **N 未闭环**：需网关侧恢复有效 Key/上游后重跑；或提供测试账号在真实网站登录后走完整链路。
2. **正式分发**：无 Developer ID → DMG 仅限开发测试；Gatekeeper 会拦截未公证包。
3. **Windows** 包与代码签名未做（第二阶段）。
4. 首次 Keychain 访问可能弹授权对话框（safeStorage 行为），批准一次即可。
5. 深链热启动的连接状态页为简版（主进程静默完成 → 重启进入已连接状态）。
6. 用户在 OpenCode.json 手工配置的旧 provider 仍为明文 Key（既有行为，未被本方案改动）。

## 9. Rollback
- `opencode-muc`：每 Phase 独立 commit（`git log`）；回滚 = `git revert` 或 `git checkout 014614d -- .`
- `sub2api`：backend/frontend 变更各自 commit；回滚同上。
- 桌面端：原版 `/Applications/OpenCode.app` 从未修改；MUC.app 可直接删除。
- 网关地址常量集中于 `muc.ts` / `gateway.ts`（`MUC Harness` 注释标记），rebase 友好。

## 10. Release Checklist（正式发布）
- [ ] Apple Developer ID Application 证书 + `codesign` 正式签名 + notarization + staple
- [ ] HTTPS 证书确认（客户端默认 `https://admin.wuxuexi.top`）
- [ ] `dist/` 安装包挂载到网关 `/downloads/` 路径
- [ ] 生产 Redis 可用（connect-code 依赖）
- [ ] 轮换 commit 21922ef 中曾出现的旧 Key（历史安全）
- [ ] Windows x64 包（第二阶段）
- [ ] 真实推理 E2E（验收 N）复测
