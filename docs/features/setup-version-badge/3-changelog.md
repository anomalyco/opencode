---
feat-id: setup-version-badge
status: done
related: ./3-changelog.md
---

# 3-changelog — 设置面板左下角版本牌改 DeskFox 自家文案 + installer 版本号

## 现象 / 需求

设置面板左下角显示"OpenCode Desktop / v1.14.33"——
- 第一行是上游 i18n key `app.name.desktop`(17 份字典都填了 "OpenCode Desktop")
- 第二行版本号 `v1.14.33` 来自 `packages/desktop/package.json` 的 `"version"` 字段(上游同步过来的)

需要改成:
- 第一行:`DeskFox for <Platform>`(平台名根据当前 OS 选 "Windows" / "macOS" / "Linux")
- 第二行:对应平台的 installer 版本号(`YYYY.M.D.N` 格式,如 `v2026.5.6.2`)

## 方案选型(B 入选)

| 方案 | 上游 sync 冲突 | 跨平台 | 单一来源 |
|---|---|---|---|
| A 写进 `desktop/package.json` `"version"` | **每次 sync 必冲突**(那是上游字段)| ✓ | ✓ |
| **B 新建 fork-only `installer-versions.json`,bump 脚本同步写**(入选)| 0 | ✓ | ✓ |
| C vite-plugin build 时读 `.iss` 字面量注入全局变量 | 0 | **✗ Mac 没 .iss** | ✓ |

方案 B 用一个 fork-only JSON 做单一来源,bump 脚本(`.ps1` + `.sh`)各管对应平台 key,前端按 `platform.os` 选 key。**0 上游冲突 + 跨平台等价 + 维护开销最低**。

## 改动清单(净改 ~50 行)

### 新文件

- `packages/branding/installer-versions.json`(2 行 JSON,fork-only)
  ```json
  {
    "windows": "2026.5.6.2",
    "macos": "2026.5.5.1"
  }
  ```

### 配置

- `packages/branding/package.json`:`exports` 表加一项 `"./installer-versions.json"`,让前端能 `import installerVersions from "@opencode-ai/branding/installer-versions.json"`

### bump 脚本(两端等价)

- `packages/branding/scripts/bump-installer-version.ps1`:加 step 3 — `[regex]::Replace` surgical update 对应平台 key 的 value;regex `("<key>"\s*:\s*")[^"]*(")` 保留缩进 / 引号 / 文件 trailing newline;若 replace 前后内容一致 → throw(防 JSON malformed)
- `packages/branding/scripts/bump-installer-version.sh`:同语义,用 `sed -i.bak` BSD 兼容写法 + `rm -f .bak` + `grep -q` verify 替换是否生效

### 前端

- `packages/app/src/components/dialog-settings.tsx`:
  - `import installerVersions from "@opencode-ai/branding/installer-versions.json"`
  - 新增 `platformLabel`(macos/windows/linux 三档映射,行业惯例 `Windows` W 大写 / `macOS` m 小写 OS 大写 / `Linux` L 大写)
  - 新增 `installerVer`(按 `platform.os` 选 JSON 对应 key,fallback `platform.version` 兼容 undefined)
  - 渲染从 `language.t("app.name.desktop")` + `v{platform.version}` 改成 ``DeskFox for ${platformLabel}`` + `v{installerVer}`

## 设计决策记录

### 为什么平台名不走 i18n?

平台名属于专有名词:
- `Windows` 是 Microsoft 注册商标,任何语言都不翻译
- `macOS` Apple 强制小写 m + 大写 OS,2016 起官方拼写
- `Linux` Linus 命名习惯
- `for` 英文介词,标题 case 中惯例小写(参考 `Microsoft Edge for Windows` / `Adobe Acrobat for Mac`)

塞进 17 份 i18n 字典纯噪音,且大概率某些语言会翻错。直接 hardcode 单字串。

### 为什么 i18n key `app.name.desktop` 留着不删?

代码里唯一 callsite 已被本次改动删除,这条 key 现 dead。但 17 份字典里(`en/zh/zht/ja/ko/ar/...`)的字典条目**保留不动**,理由:这些文件是上游同步过来的,删了下次 sync 必冲突,留着 0 副作用。

### 为什么 JSON 用 regex 替换而不用 ConvertFrom/ConvertTo-Json?

PS 5.1 的 `ConvertTo-Json` 输出格式不稳定(默认缩进 4 空格,尾随空格,某些字符转义不一致)。surgical regex 替换可以确保:
- 缩进保留(2 空格)
- key 顺序保留
- 引号风格保留
- 文件无意义 diff 噪音

inline test 已验证替换前后 diff 仅 value 一行变化,其他字节级一致。

## 验证

- typecheck:15/15 ✓
- DeskFox.exe release dev build:`packages/desktop/src-tauri/target/release/DeskFox.exe`(35MB,2 次 build 都 exit 0)
- bump.ps1 dry-run:JSON 文件未被改动 ✓
- bump.ps1 inline regex test:`{ "windows": "2026.5.6.2", "macos": "2026.5.5.1" }` → `{ "windows": "9999.9.9.9", "macos": "2026.5.5.1" }` 缩进 / 引号 / 换行全保留 ✓
- user runtime 实测:设置面板左下角显示 `DeskFox for Windows` / `v2026.5.6.2` ✓

## 待 Mac 端首次 bump 时验证

- `bump-installer-version.sh` 在 Mac 端真跑 — 验证 `sed -i.bak` BSD 行为 / `grep -q` verify / `rm -f` 清理是否正常工作
- 失败的话现场反馈我修。Win 端模拟不出来,平台坑只能 Mac 端首次 bump 自然 trigger 时暴露

## 规模 / R 标记

- 规模:Tiny(~50 行净增 / 5 文件 / 1 新 JSON)
- R2 FORK marker:✓(`dialog-settings.tsx` import 注释 + 渲染段注释)
- R3 黑名单:无(`installer-versions.json` 是 fork-only 新文件,不在黑名单)
- R4 override:无
- 上游侵入:0(全 fork-only 修改 + 新建)
