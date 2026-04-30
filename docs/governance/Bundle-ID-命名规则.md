# Bundle ID 命名规则(macOS)

> macOS 应用的 reverse-DNS Bundle ID 决定:TCC 沙盒权限边界 / `~/Library/Application Support/<id>/` 数据目录 / URL Scheme handler / Universal Link 验证 / Crash 报告与遥测关联。
> 改 Bundle ID = 系统视为全新应用(权限重置、数据目录易主)。**改动须谨慎,merge 上游时勿误覆盖**。

## 当前规则(2026-04-30 起,`bundle-id-debrand` 落地)

| 档 | Bundle ID | 用途 | 应用程序网格搜索 |
|---|---|---|---|
| **prod** | `ai.deskfox.app` | 正式发布 | ✅ 可见 + 可搜(无后缀) |
| **beta** | `ai.deskfox.app.beta` | 测试版 | ✅ 可见 + 可搜(`.beta` 类 Chrome Beta) |
| **dev** | `ai.deskfox.app.dev` | 开发自用 | ⚠️ 网格搜索过滤 `.dev` 后缀,Cmd+Space / Launchpad / 第三方 launcher 仍可见 |

**配置位置**:`packages/branding/tauri-overrides/{prod,beta,dev}.json` 各自的 `identifier` 字段。

**base `tauri.conf.json` 仍是上游 `ai.opencode.desktop.dev`** — 这是 sst/opencode 上游 contract,**不动**(P1 隔离,merge upstream/dev 不冲突)。三档全在 fork 自己的 override 里覆盖。

## 设计原则

1. **reverse-DNS 与域名所有权对齐**:`ai.deskfox.app` ↔ user 持有的 `deskfox.ai` 域名。未来做 URL Scheme handler / Universal Link / OAuth callback 时,Apple 要求 `apple-app-site-association` 校验 reverse-DNS 与域名所有权一致;现在对齐 = 未来 0 迁移成本
2. **完全切断 sst/opencode 命名空间共享**:不用 `ai.opencode.*` 前缀(那是上游的)。用户即使同 Mac 装两个软件,TCC / 数据目录 / URL Scheme 完全独立
3. **三档 Bundle ID 互不冲突**:可在同一 Mac 上共存(macOS 按 Bundle ID 识别 .app),开发者本机能同时装 dev / beta / prod 三套自测
4. **`ai.` 前缀不用 `com.`**:符合 AI / agent 类工具命名习惯(对照 `ai.cursor.app`、上游 `ai.opencode.*` 都用此前缀)

## 维护规则

- **merge upstream/dev 时**:base `tauri.conf.json` 的 `identifier` 字段会回到上游(`ai.opencode.desktop.dev`),**这是预期行为,接受 theirs**;三档 override 在 `packages/branding/tauri-overrides/` 里,跟上游 0 路径冲突,自动保留
- **扩新档**(如未来加 `nightly`):新建 `packages/branding/tauri-overrides/nightly.json`,`identifier` 用 `ai.deskfox.app.nightly` 形式延续 reverse-DNS 树
- **绝不在 base `tauri.conf.json` 里改 identifier**:违反 P1 隔离,merge upstream 必冲突
- **绝不用回 `ai.opencode.*` 前缀**:那是上游命名空间,共享会出 4 类问题(详见 [`docs/features/bundle-id-debrand/3-changelog.md`](../features/bundle-id-debrand/3-changelog.md) 触发原因段)
- **改 Bundle ID 须重打安装包并通知 user 重装**:旧 ID 的 `/Applications/<App>.app` 不会自动清(macOS 按 ID 识别),TCC 权限重置一次(实测 macOS 14+ 自动放行用户目录,无干预)

## 历史溯源

- **2026-04-30 早**:三档全用上游 base `ai.opencode.desktop.dev`,prod / beta / dev 不区分,踩坑发现 `.dev` 后缀触发 macOS 26 应用程序网格搜索隐藏 → `prod-bundle-id-fix`(`7618346fe`)给 prod / beta 各加独立 identifier(prod 去 `.dev`),但仍带 `opencode` 字眼
- **2026-04-30 晚**:`bundle-id-debrand`(`3fd5ceaf5`)完整品牌切割,三档全去 `opencode` 改 `ai.deskfox.app` 系列,与上游 0 命名空间共享。本规则文档同笔落地

详见 [`docs/features/bundle-id-debrand/3-changelog.md`](../features/bundle-id-debrand/3-changelog.md) 完整设计 rationale。
