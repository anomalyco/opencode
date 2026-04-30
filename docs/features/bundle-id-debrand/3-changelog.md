---
feat-id: bundle-id-debrand
status: done
related: ./3-changelog.md
---

# bundle-id-debrand — changelog

**关联 commit**: 待回填
**所在分支**: `feat/editable-file-viewer`
**规模**: Tiny(3 文件 +3 行,无 1-spec / 2-plan)
**触发原因**: `prod-bundle-id-fix`(`7618346fe`)只解决了"prod 去掉 `.dev` 后缀"让应用程序网格搜得到,但 prod / beta / dev 三档 Bundle ID 仍带 **`opencode`** 字眼(`ai.opencode.desktop` 系列),共享 sst/opencode 上游的 reverse-DNS 命名空间。两个软件未来同 Mac 共存会:① TCC 权限混 ② `~/Library/Application Support/ai.opencode.*/` 数据目录命名空间共享 ③ URL Scheme / Universal Link 冲突 ④ Crash 报告 / 遥测按 reverse-DNS 关联 ⑤ 法律 / 品牌:DeskFox 是独立产品,不该用 opencode 命名空间。本笔做完整品牌切割,改用 fork 自己的 `ai.deskfox.app` 系列(域名 `deskfox.ai` 在 user 手中)。

## 实际改动

### `packages/branding/tauri-overrides/prod.json`(1 行替换)

```diff
-  "identifier": "ai.opencode.desktop",
+  "identifier": "ai.deskfox.app",
```

### `packages/branding/tauri-overrides/beta.json`(1 行替换)

```diff
-  "identifier": "ai.opencode.desktop.beta"
+  "identifier": "ai.deskfox.app.beta"
```

### `packages/branding/tauri-overrides/dev.json`(+1 行新加)

```diff
   "productName": "DeskFox Dev",
-  "mainBinaryName": "DeskFox"
+  "mainBinaryName": "DeskFox",
+  "identifier": "ai.deskfox.app.dev"
```

之前 `dev.json` 不 override identifier,继承 base `tauri.conf.json` 的 `ai.opencode.desktop.dev`(上游 sst/opencode 的);本笔 override 成 `ai.deskfox.app.dev`,**dev / beta / prod 三档全部 fork 化,完全切断 opencode 命名空间共享**。

### `tauri.conf.json` base 不动

- 仍是上游的 `ai.opencode.desktop.dev`(P1 隔离原则,merge upstream/dev 不冲突)
- 三档 override 全在 `packages/branding/tauri-overrides/`,fork-only

## 行数

| 项 | 行数 |
|---|---|
| `prod.json` 替换 | 1 |
| `beta.json` 替换 | 1 |
| `dev.json` 新增 | 1 |
| **代码 staged 净** | **3 行** |

Tiny 级 — 极轻配置改动。白名单内,无 override。

## 影响范围

- ✅ **三档 Bundle ID 完全独立**:
  - prod: `ai.deskfox.app` ← 干净品牌
  - beta: `ai.deskfox.app.beta` ← 类 Chrome Beta
  - dev: `ai.deskfox.app.dev` ← 开发者自用
- ✅ **跟 sst/opencode 上游 0 命名空间共享**:即使 user 同 Mac 装两个软件,TCC / 数据目录 / URL Scheme 完全独立
- ✅ **域名归属对齐**:`deskfox.ai` 在 user 手中,未来做 URL Scheme handler / Universal Link / OAuth callback 时 reverse-DNS 与域名所有权一致(Apple Universal Link 需要域名 well-known 文件验证 reverse-DNS 与域名匹配)
- ✅ **base `tauri.conf.json` 不动**:与 sst/opencode 0 上游侵入,merge upstream 不冲突
- ⚠️ **首次升级冲击(对当前已装 user)**:
  - 旧 `ai.opencode.desktop` Bundle ID 的 `/Applications/DeskFox.app` 不会自动清(macOS 按 Bundle ID 识别 .app,改 ID = 全新应用)
  - 需要手动删旧 .app 后装新版
  - TCC 权限重置一次(新 Bundle ID 首次访问 ~/Downloads 时,macOS 自动弹对话框,user 点允许 = 15 秒,实测 macOS 14+ 该流程对 lstat syscall 也工作,见 memory `feedback_verify_before_assert_os_behavior.md`)
  - Tauri workspace 状态(`~/Library/Application Support/ai.opencode.desktop/` 那份)不再读取,新版用 `~/Library/Application Support/ai.deskfox.app/` — UI 偏好(上次打开了哪几个项目等)丢失,user 重新打开几个项目就回来
- ✅ **opencode 项目数据 0 影响**:数据 db 在 `~/.local/share/opencode/`(SQLite,跟 Bundle ID 解耦),会话 / 消息 / 配置全保留

## 不影响的

- Windows installer(走 Inno Setup AppId/GUID,跟 Bundle ID 无关)
- plugin 仓(deskfox-plugins / claude-code 等,走 `_opencode.cwd` 协议字段,跟 Bundle ID 无关)
- 历史 commit / changelog(都不动,过去事实保留;`prod-bundle-id-fix` 那一笔的 changelog 仍记当时是 `ai.opencode.desktop`,反映当时事实)

## 回归测试点

- [ ] 重打 prod 后装到 /Applications,Bundle ID 验证 `ai.deskfox.app`(`defaults read /Applications/DeskFox.app/Contents/Info.plist CFBundleIdentifier`)
- [ ] 应用程序网格搜 "desk" / "fox" → DeskFox 出现 ✅
- [ ] Cmd+Space Spotlight 搜 → 出现 ✅
- [ ] 首次访问 ~/Downloads → macOS 弹对话框 → user 允许 → 项目正常加载
- [ ] 应用启动 + 核心功能(右键加聊天 / Option+Enter / LibreOffice 装机)无回归

## review 自检

- [x] 仅触动 fork 白名单(`packages/branding/tauri-overrides/`)
- [x] 不动上游 `tauri.conf.json` base(P1 隔离,0 上游侵入)
- [x] 三档 Bundle ID 设计互不冲突(完整 reverse-DNS 树状区分)
- [x] reverse-DNS 与域名所有权对齐(`ai.deskfox.app` ↔ `deskfox.ai`)
- [x] 配置 JSON schema 校验通过(tauri 2 schema)
- [x] 无新增依赖

## 回退方法

```
git revert <code commit hash>
```

revert 后回到 `ai.opencode.desktop` 系列(`prod-bundle-id-fix` 时的状态)。

## 备注

- **关联 feat 链**:`prod-bundle-id-fix`(去 `.dev` 后缀,让 prod 网格搜得到)→ `bundle-id-debrand`(本笔,完整品牌切割,去 `opencode` 字眼)。两笔分开做的原因:`prod-bundle-id-fix` 是修紧急 bug(网格搜不到 prod),`bundle-id-debrand` 是品牌治理,合并一笔会让 trade-off 不清晰。
- **`deskfox.ai` 域名**:user 手中,未来:① URL Scheme handler 走 `deskfox://` ② Universal Link 走 `https://deskfox.ai/...` apple-app-site-association(需要 reverse-DNS `ai.deskfox.app` 与域名匹配,本笔已对齐)③ OAuth redirect URL 走 `https://deskfox.ai/auth/callback`
