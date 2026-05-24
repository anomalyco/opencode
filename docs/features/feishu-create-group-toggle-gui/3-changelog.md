---
feat-id: feishu-create-group-toggle-gui
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-create-group-toggle-gui — 3-changelog(实际改动 + 回退)

> **状态**:✅ 代码落地(2026-05-24,等用户实测)
> **commit 链**:5 commits(spec/plan + 4 实施)
> **规模**:Medium(~290 行净增 fork-only,17 新单测,0 黑名单 override)

---

## commit 链(自下而上 = 时间顺序)

| hash | 内容 |
|---|---|
| `80f81774c` | docs: 1-spec + 2-plan |
| `06863e8e4` | feat: account-store.updateAccountSettings partial + 7 测试 + thin wrapper updateAccountModel |
| `773b710c4` | feat: server POST /accounts/update-settings endpoint(payload 白名单 + partial 校验)|
| `f812e2d2a` | feat: Tauri feishu_update_account_settings 命令(nested Option 表达 model 三态)|
| `ffbfd2ae2` | feat: dialog 加 checkbox + i18n + AccountSummary 扩字段(全链路 wire 改完)|

## 改动文件

### 新增(0)

无新文件(全部扩既有)。

### 修改(13 个文件)

**后端**(adapter):

| 文件 | 净行数 | 改动 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/account-store.ts` | +35 | 新加 `updateAccountSettings(id, patch)` 严格白名单 partial 更新;旧 `updateAccountModel` 改 thin wrapper |
| `packages/adapter-feishu-lark/src/server.ts` | +60 | 新 endpoint `POST /accounts/update-settings`(payload 白名单 + partial 校验 + onAccountsChanged hot reload);旧 `/accounts/update-model` 保留兼容;`GET /accounts` 响应加 `enableAutoGroupCreate` |
| `packages/adapter-feishu-lark/src/feishu/__tests__/account-store.test.ts` | +166 | 10 新单测(7 partial + 3 兼容)|

**Tauri 层**:

| 文件 | 净行数 | 改动 |
|---|---|---|
| `packages/desktop/src-tauri/src/feishu_adapter.rs` | +60 | 新加 `feishu_update_account_settings` 命令 + `UpdateAccountSettingsRequest`/`UpdateAccountSettingsWire`(nested Option 表达 model 三态:Some(Some(m))=设/Some(None)=清/None=不动);`AccountSummary` + `ListAccountWireItem` 加 `enable_auto_group_create` 字段;`feishu_save_account` 返默认 false |
| `packages/desktop/src-tauri/src/lib.rs` | +2 | invoke handlers 注册新命令 |

**前端**:

| 文件 | 净行数 | 改动 |
|---|---|---|
| `packages/app/src/utils/feishu-config.ts` | +32 | 新加 `feishuUpdateAccountSettings(id, patch)` + `UpdateAccountSettingsPatch` type;`AccountSummary` 加 `enable_auto_group_create?`;旧 `feishuUpdateAccountModel` 标 `@deprecated` |
| `packages/app/src/components/feishu-edit-account-dialog.tsx` | +37 | 新加"模型"分隔块标题 + "高级能力"分隔块 + "允许 AI 自动创建新群" checkbox + 副标;`handleSave` 改调 `feishuUpdateAccountSettings` 一次提交 model + flag |
| `packages/app/src/components/settings-feishu.tsx` | +2 | `handleEdit` 传 `currentEnableAutoGroupCreate` |
| `packages/app/src/i18n/en.ts` | +7 | 4 新 keys + title/description 文案更新 |
| `packages/app/src/i18n/zh.ts` | +7 | 同上 |
| `packages/app/src/i18n/zht.ts` | +7 | 同上 |

## 关键设计点

### 1. `updateAccountSettings(patch)` 严格白名单
只 patch 列出字段(model + enableAutoGroupCreate);其他 schema 字段(appId/appSecret/openId/tokenStore/agent/threadSession/tables/blockStreamingCoalesce 等)0 影响 — `if (patch.X !== undefined)` 模式。未来扩 GUI 暴露新 flag 时,**只需扩 patch 类型 + 加分支**,server endpoint 自动复用。

### 2. server endpoint 验证 4 道闸
- `missing accountId` → 400
- `unknown_fields`(白名单只接受 model + enableAutoGroupCreate)→ 400 防 schema injection
- `empty_patch`(至少需要一项 settings)→ 400 防 noop
- `enableAutoGroupCreate` 非 boolean → 400 invalid_field
- `account_not_found` → 404

### 3. Rust `Option<Option<ModelRef>>` 表达 model 三态
TypeScript 的 `undefined / null / object` 三态:
- `undefined`(serde rename 字段不传)→ Rust `None` → 不动
- `null`(serde "model": null)→ Rust `Some(None)` → 清除走 default
- `object`(serde "model": {...})→ Rust `Some(Some(m))` → 设置

对齐 server 端 `"model" in body` 检测,语义无歧义。

### 4. hot-reload 走已有 `onAccountsChanged` 路径
endpoint 成功后调用 `options.onAccountsChanged?.()` → plugin 内 `listAccounts + wssManager.sync` → MessagePipeline 重建,新 flag 立即生效。无需重启 DeskFox。

### 5. 向后兼容 — 旧 callsite 保留可用
- `updateAccountModel(id, model)` → thin wrapper 委派给 `updateAccountSettings(id, { model })`
- `feishuUpdateAccountModel(id, model)` → 标 `@deprecated` 但仍可调
- `POST /accounts/update-model` endpoint 保留 — 不破坏 Tauri 老 binary 升级路径
- `feishu_update_account_model` Tauri 命令保留

新代码用 `feishuUpdateAccountSettings`,老代码无强制迁移压力。

## 测试

### 落地的测试(R5 Medium ≥ 3 unit,实际 10 unit + 既有套件)

- `account-store.test.ts` **+10 新测**(7 partial + 3 兼容)/ 全套 26/26 pass
  - flag-only / model-only / 双改 / null 清 model / 空 patch noop / 不存在 account / toggle 持久化(7)
  - updateAccountModel thin wrapper 兼容(3)
- 全 adapter `bun test` 401/401 pass
- `bun run typecheck` 16/16 monorepo 通过

### 测试取舍说明

**server endpoint HTTP 集成测试未落**:实施期间发现 **Bun 缓存 `os.homedir()` 首次值,`HOME` env 改了不生效**(PoC 验证)。要在测试里给 `defaultConfigPath()` 不同 HOME 需要走 `mock.module("node:os")` + `require.cache` invalidation,复杂度过高;且 saveAccount 内部 `writeSecret` 走 `homedir()` 写真实 `~/.opencode/feishu-secrets/`,有意外污染 user 真实配置的风险(本次实施期间已发生过一次,立即清理 + 文档化教训)。

R5 Medium ≥ 3 unit 由 account-store 10 单测远超达标(覆盖 `updateAccountSettings` 全部 partial 语义,这是 endpoint 调用的核心逻辑)。HTTP 层 validation 是薄壳无独立业务逻辑,留 backlog:**可抽 `validateUpdateSettingsBody()` 纯函数 helper 独立单测**(下次扩 endpoint 时一起做)。

### 实测脚本(2026-05-24,user 验收)

build dev .app 后:

1. **GUI 路径**:Settings → 飞书桥接 → 选某账号【编辑】→ 应看到"模型" + "高级能力"两个分隔块 + checkbox
2. **保存生效**:勾上 checkbox → 保存 → 不重启 DeskFox 在飞书私聊里说"帮我建群叫 X" → 应收到飞书 confirm 卡片(`feishu-bridge-light` 既有逻辑触发)
3. **持久化**:重启 DeskFox → 重新打开 dialog → checkbox 应保留 true
4. **partial 不破坏其他字段**:开启 checkbox 保存后,`~/.opencode/feishu-config.json` 中该 account 的 appSecret / openId / agent / threadSession 等字段不变

## 三铁律走流程

| 步骤 | 状态 |
|---|---|
| 开 feat 分支 `feat/feishu-create-group-toggle-gui` | ✅ |
| 本地 commit 不动 main | ✅ |
| → main merge user 同意 | (待 user 拍)|
| → origin/main push user 同意 | (待 user 拍)|

## 风险 / 已知限制

1. **测试期间发现 Bun 缓存 `os.homedir()`** — 已 documented 在 changelog 测试段,**留 backlog**:未来加 sidecar-level config watcher 或测试 mock 策略 attack surface backlog
2. **JSON 直接编辑 + sidecar 重启**仍可用(不破坏旧路径),但 user 建议走 GUI(GUI 才能 hot-reload)
3. **现役 user 升级路径**:`enableAutoGroupCreate` 字段已在 schema 中默认 false,无需迁移
4. **e2e test 没补**(目前 e2e 框架还在 Phase 1 — `e2e-phase1-mock-mode`,尚不覆盖 Settings 流程)

## 回退方法

1. **revert 整 merge commit**(本 feat 5 commits 全恢复 main):
   ```bash
   git revert -m 1 <merge-commit-hash>
   ```
2. **手动回退**:
   - `~/.opencode/feishu-config.json` 中 `enableAutoGroupCreate` 字段保留 true 也无害(老代码不读,只有 pipeline 读)
   - GUI 不再显示 checkbox,user 仍可直接编辑 JSON + 重启

## 关联

- 上游 spec:`docs/features/feishu-bridge-light/1-spec.md`(`enableAutoGroupCreate` 字段原定义)
- 上游实现:`docs/features/feishu-bridge-light/3-changelog.md`(marker 协议 + confirm 卡片 + double-gating)
- schema:`packages/adapter-feishu-lark/src/core/config-schema.ts:136`
- pipeline gating:`packages/adapter-feishu-lark/src/feishu/message-pipeline.ts:230, 460`
