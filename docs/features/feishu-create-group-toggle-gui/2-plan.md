---
feat-id: feishu-create-group-toggle-gui
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-create-group-toggle-gui — 2-plan(实施计划)

## 规模:Medium(~250 行代码 + 3 单测块 + 三文档)

## 实施顺序(自下而上 — schema → backend → Tauri → frontend → 测试)

### Phase 1 — 后端 partial update endpoint(~80 行)

**1.1** `packages/adapter-feishu-lark/src/feishu/account-store.ts`(+ ~25 行)
- 新加 `updateAccountSettings(accountId, partial: Partial<Pick<FeishuAccount, "model" | "enableAutoGroupCreate">>): { accountId, account }`
- 旧 `updateAccountModel` **保留作 thin wrapper**(调 `updateAccountSettings` with `{ model }`),向后兼容 server.ts 现有调用
- 实现:`load() → 找 account → reject if not found → 合并 partial 字段(用 spread,只覆盖给的字段)→ persist`
- 注意:**严格只 patch 白名单字段**(model / enableAutoGroupCreate)— 防未来加新 schema 字段被意外暴露

**1.2** `packages/adapter-feishu-lark/src/server.ts`(+ ~30 行)
- 新加 endpoint 处理函数 + `POST /account/settings`
- payload schema(zod):`{ accountId: string, model?: ModelRef | null, enableAutoGroupCreate?: boolean }`(`.partial().refine(at least one)`)
- 调 `account-store.updateAccountSettings`
- 触发 `onAccountsChanged()` hot reload(已有机制)
- 返回 GUI 显示用的 safe 摘要(accountId, appId, openId, domain, agent, botName + 这两项 settings 当前值)
- **保留旧 `POST /account/model` endpoint**(向后兼容 Tauri 旧调用,内部委派给新 endpoint)

**1.3** Tauri 命令(`packages/desktop/src-tauri/src/feishu_adapter.rs` 或同等位置)
- 现有 `feishu_update_account_model` Tauri 命令 → 新加 `feishu_update_account_settings`(payload 含 model + enableAutoGroupCreate optional)
- 旧命令保留 thin wrapper 调新命令(传 model only)
- payload 序列化用现有 reqwest 模式

### Phase 2 — 前端 API + dialog(~70 行 + i18n ~18)

**2.1** `packages/app/src/utils/feishu-config.ts`(+ ~25 行)
- 新加 `feishuUpdateAccountSettings(accountId, settings)` 调 Tauri `feishu_update_account_settings`
- 旧 `feishuUpdateAccountModel` 保留 thin wrapper(避免改 settings-feishu.tsx 等 callsite,grep 看有多少处)

**2.2** `packages/app/src/components/feishu-edit-account-dialog.tsx`(+ ~40 行)
- props 加 `currentEnableAutoGroupCreate?: boolean`(从父传入)
- state 加 `enableGroupCreate` signal,初始值 = props 值 ?? false
- 渲染:在现有 model 段下方加分隔线 + "高级能力" 标题 + 1 checkbox + 副标
- handleSave 改调 `feishuUpdateAccountSettings`,payload 包含 model + enableGroupCreate
- dialog title i18n key 改 `settings.feishu.edit.title` 含义("编辑账号设置")
- canSave 逻辑保持(useDefault 或 model 全选 都算合法)

**2.3** `packages/app/src/components/settings-feishu.tsx`(可能需要 ~5 行)
- 检查父组件传 dialog 时是否需要把 `enableAutoGroupCreate` 当前值传下去(grep 现有 `FeishuEditAccountDialog` 调用)
- 如果父组件已经有 account 完整对象,只需把字段加到 props

**2.4** i18n keys(`packages/app/src/i18n/{en,zh,zht}.ts` 各 +6 keys = 18 strings)
- `settings.feishu.edit.title` 改文案("编辑账号模型" → "编辑账号设置")
- `settings.feishu.edit.modelSectionTitle` "模型"(分隔块标题,新加)
- `settings.feishu.edit.advancedSectionTitle` "高级能力"
- `settings.feishu.edit.enableAutoGroupCreate.label` "允许 AI 自动创建新群"
- `settings.feishu.edit.enableAutoGroupCreate.hint` "开后私聊说「帮我建群」AI 会发确认卡,你点准才真建。默认关 防 prompt injection。"

### Phase 3 — 单测(~80 行,R5 Medium ≥ 3 unit)

**3.1** `account-store.test.ts` 加 case(+ ~30 行)
- `updateAccountSettings(id, { enableAutoGroupCreate: true })` 改 flag,model 不动
- `updateAccountSettings(id, { model: ref })` 改 model,flag 不动(向后兼容)
- `updateAccountSettings(id, {})` reject
- `updateAccountSettings("不存在的 id", { ... })` reject
- 其他字段(appId / appSecret / token 等)不被任何 partial 覆盖

**3.2** `server.test.ts` 加 endpoint case(+ ~30 行)
- `POST /account/settings` 含 model + flag both 200
- 含 flag only 200
- 含 model only 200(向后兼容)
- 空 payload reject 400
- 未知字段 reject 400
- accountId 不存在 reject 404
- 触发 onAccountsChanged callback 调用

**3.3** (可选)dialog 状态 helper extract 测试 — 看 dialog 是否能 helper extract validation 逻辑出来给单测调,如果纯 UI 不抽出就略

### Phase 4 — 验证 + 文档(典型 30 分钟)

**4.1** `bun run typecheck`(全 monorepo 16/16)
**4.2** `bun test packages/adapter-feishu-lark/`(目标:0 fail,新测全过)
**4.3** 可选 build + GUI smoke:`build-deskfox.sh -Env dev`,user 自己装新 .app 试 toggle
**4.4** 写 `3-changelog.md`
**4.5** 更新 `docs/features/INDEX.md` + `改动日志.md`

## commit 链(预期)

| # | commit message |
|---|---|
| 1 | `docs(feishu-create-group-toggle-gui): 1-spec + 2-plan [feat: feishu-create-group-toggle-gui]` |
| 2 | `feat(feishu-create-group-toggle-gui): account-store.updateAccountSettings + 单测 [feat: feishu-create-group-toggle-gui]` |
| 3 | `feat(feishu-create-group-toggle-gui): server POST /account/settings endpoint + 单测 [feat: feishu-create-group-toggle-gui]` |
| 4 | `feat(feishu-create-group-toggle-gui): Tauri feishu_update_account_settings 命令 [feat: feishu-create-group-toggle-gui]` |
| 5 | `feat(feishu-create-group-toggle-gui): dialog 加 enableAutoGroupCreate checkbox + i18n [feat: feishu-create-group-toggle-gui]` |
| 6 | `docs(feishu-create-group-toggle-gui): 3-changelog + INDEX + 改动日志 [feat: feishu-create-group-toggle-gui]` |

## 风险 / 注意点

| 风险 | 缓解 |
|---|---|
| 旧 callsite `feishuUpdateAccountModel` 调用残留 | thin wrapper 保留,grep 验证所有 callsite 都能跑(渐进 deprecate) |
| account 当前 `enableAutoGroupCreate` 没传到 dialog | grep `FeishuEditAccountDialog` 调用点,确认父组件能获取这个字段 |
| `~/.opencode/feishu-config.json` JSON 完整性(防丢字段) | account-store 用 spread 合并不替换 — 既有单测保护 |
| pipeline 已构造的 instance 不感知新 flag | onAccountsChanged → wssManager.sync 已实现重建逻辑,后续要查实际是否会重建 pipeline / 还是只 update opts |
| Tauri 命名冲突或 typecheck error | typecheck 兜底 |

## 实施中决策点(开发中 append 到本文档)

### 2026-05-24 — server endpoint 集成测试取舍 + Bun homedir 缓存教训

**问题发现**:Phase 3 加 server HTTP endpoint 集成测试时,beforeEach 用
`process.env.HOME = tmpHome` 想隔离 user 真实 `~/.opencode/`,但发现 saveAccount 仍写到 user 真实 home。PoC 验证:**Bun 缓存 `os.homedir()` 首次调用返值**,后续 HOME 改了不生效(Node.js 同样测试是 live 读)。

**测试污染事故**:测试 saveAccount 调用导致 user 真实 `~/.opencode/feishu-config.json` 多了 `acc1` 账号 + `~/.opencode/feishu-secrets/acc1.key` 等 11 个 secret 文件。**已立即清理**(只删测试用 ID,真实 `cli_a969*` / `cli_aa98*` 3 个 account 保留)。这是项目 latent issue:既有 `account-store.test.ts` 也是同样 pattern(`writeSecret` 走 homedir 写真实路径),长期污染但低危(test ID 不撞真实 account)。

**取舍**:撤掉 server endpoint HTTP 集成测试 describe 块,依赖 account-store 10 单测覆盖核心逻辑。R5 Medium ≥ 3 unit 远超达标。HTTP 层是薄壳无独立业务逻辑,留 backlog:可抽 `validateUpdateSettingsBody()` 纯函数 helper extract 独立单测,或后续真做 e2e 框架时通过浏览器/Tauri 端覆盖完整链路。

**沉淀**:
1. Bun `os.homedir()` 缓存行为是项目级隐患 — 任何依赖 HOME override 的测试都不可靠,需走 `mock.module("node:os")` 路径
2. `account-store.test.ts` pre-existing 污染问题留 backlog,不在本 feat 范围
3. 单测调 `saveAccount` 时必须传 explicit `configPath` arg,但 `writeSecret` 没相应 arg → 长期看应该改 `writeSecret` 加 `path` option 或 `homedir` 抽 IO 边界

详细沉淀写在 3-changelog.md 测试取舍说明段。
