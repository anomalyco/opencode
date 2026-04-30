---
feat-id: prod-bundle-id-fix
status: done
related: ./3-changelog.md
---

# prod-bundle-id-fix — changelog

**关联 commit**: 待回填
**所在分支**: `feat/editable-file-viewer`
**规模**: Tiny(2 文件 +2 行,无 1-spec / 2-plan)
**触发原因**: 2026-04-30 首版 macOS prod installer `2026.4.30.1` 装到 `/Applications/DeskFox.app` 后,**应用程序网格搜索"desk"搜不到**。诊断发现 prod 包 `CFBundleIdentifier` = `ai.opencode.desktop.dev`,继承自 base `tauri.conf.json`(没被 `prod.json` override)。macOS 26+ 应用程序网格搜索把含 `.dev` 后缀的 Bundle ID 当开发版降权 / 隐藏(网格里图标显示 OK,搜索栏过滤掉)。

## 实际改动

### `packages/branding/tauri-overrides/prod.json`(+1)

```diff
   "productName": "DeskFox",
   "mainBinaryName": "DeskFox",
+  "identifier": "ai.opencode.desktop",
   "bundle": { ... }
```

prod 用干净 ID `ai.opencode.desktop`(无后缀,正经发布)。

### `packages/branding/tauri-overrides/beta.json`(+1)

```diff
   "productName": "DeskFox Beta",
-  "mainBinaryName": "DeskFox"
+  "mainBinaryName": "DeskFox",
+  "identifier": "ai.opencode.desktop.beta"
```

beta 用 `.beta` 后缀,跟 prod / dev 三档 Bundle ID 完全独立。

### `dev.json` / `tauri.conf.json` base 不动

- base 仍是 `ai.opencode.desktop.dev`(沿用上游 sst/opencode,他们桌面端 0 fork 侵入)
- `dev.json` 不 override identifier(继承 base),实际 dev build Bundle ID = `.dev`,符合开发版语义

## 行数

| 项 | 行数 |
|---|---|
| `prod.json` insertions | 1 |
| `beta.json` insertions | 1 + 1 行末尾逗号 |
| **代码 staged 净** | **2 行** |

Tiny 极轻(2 行配置改动),远在阈值内,白名单内,无 override。

## 影响范围

- ✅ **prod 包 Bundle ID = `ai.opencode.desktop`**:Launchpad / Spotlight / 应用程序网格全能搜到 / 通过 `.dev` 隐藏过滤
- ✅ **三档独立 Bundle ID**:dev / beta / prod 可在同一 Mac 上**共存安装**,不互相覆盖(macOS 按 Bundle ID 识别 .app)
- ✅ **base 不动**:沿用上游 `tauri.conf.json` 的 `ai.opencode.desktop.dev`,与 sst/opencode 0 冲突,merge upstream/dev 不会产生分歧
- ✅ Win 端不受影响(Bundle ID 是 macOS 概念,Win 用 AppId / GUID 走 Inno Setup,跟此 feat 无关)
- ⚠️ **首次升级冲击**:已经装过旧 prod(Bundle ID `.dev`)到 `/Applications/DeskFox.app` 的 user,新 prod(Bundle ID 无后缀)装上去会被 LS 视为**不同应用**;旧 .app 不会自动清,需要手动删 `/Applications/DeskFox.app` 后再装新版(本笔配套 ship 即生效,首版 prod 用户唯一,现场处理一次即可)

## 回归测试点

- [ ] 重打 prod 后装到 /Applications,Bundle ID = `ai.opencode.desktop`(无 .dev),`defaults read /Applications/DeskFox.app/Contents/Info.plist CFBundleIdentifier` 验证
- [ ] 应用程序网格搜 "desk" / "fox" → DeskFox 出现 ✅
- [ ] Cmd+Space 系统 Spotlight 搜 → 出现 ✅
- [ ] Launchpad 搜 → 出现 ✅
- [ ] 应用启动 + 核心功能(右键加聊天 / Option+Enter / LibreOffice 装机)无回归

## review 自检

- [x] 仅触动 fork 白名单(`packages/branding/tauri-overrides/`)
- [x] 不动上游 `tauri.conf.json`,沿用上游 contract
- [x] 三档 Bundle ID 设计互不冲突(dev `.dev` / beta `.beta` / prod 无后缀)
- [x] 配置 JSON schema 校验通过(tauri 2 schema)
- [x] 无新增依赖

## 回退方法

```
git revert <code commit hash>
```

revert 后 prod / beta 回到继承 base `.dev` Bundle ID 状态,网格搜不到。

## 备注

- macOS 26 隐藏 `.dev` Bundle ID 是新近行为(macOS 14 / Sonoma 起逐渐收紧),未来 Apple 可能进一步过滤其它后缀(如 `.test`),但 prod 用干净 ID 是最稳妥姿势,长期不踩
- 如果要让上游 sst/opencode 也"按 env 用不同 ID",PR upstream 让他们也加 prod identifier override 是更大治理,现阶段 fork-only 解决够用
