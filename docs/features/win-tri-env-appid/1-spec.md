---
feat-id: win-tri-env-appid
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# Windows 三档 AppId — 同机共存

## 一、需求

让 Windows 端 DeskFox 的 dev / beta / prod 三档可以**在同一台机器同时安装并存**,跟 macOS 端 2026-04-30 落地的三档 Bundle ID 行为对齐。

## 二、触发原因

分支策略 v2 讨论(2026-04-30)发现 Mac / Win 行为不对称:

| 平台 | 三档共存 | 实现机制 |
|---|---|---|
| **Mac**(已落地) | ✅ 可同机共存 | 三档独立 Bundle ID(`ai.deskfox.app[.beta/.dev]`)|
| **Win**(本次前) | ❌ 后装替换先装 | `DeskFox.iss` 单一固定 GUID |

DeskFox官方反馈:在 mac 上能并存测试三档,win 不行 → 想让 win 也补齐这个能力(参考"应用身份命名规则"讨论)。

## 三、验收标准

1. **三档可同时装在一台 Win 机器上**:dev / beta / prod 各自有独立的"应用与功能"卸载入口、独立的开始菜单分组、独立的桌面快捷方式
2. **prod GUID 不变**:`{F9F6F6C5-D865-468C-BCE5-BF0ECA24A763}` 沿用 — 已装 prod 用户的版本仍能正常被识别为升级,不会变成"装两份"
3. **打包入口统一,显式指定档**:`pack-installer.ps1 -Env dev|beta|prod`,默认 `prod`(向后兼容老调用)
4. **产物文件名区分**:三档安装包文件名带后缀(prod 无后缀,beta 加 `-Beta`,dev 加 `-Dev`)— 跟 macOS `productName` 命名约定对齐
5. **不影响 macOS 端打包链路**:`pack-installer.sh` 已经支持 `-Env`,本次只改 Win 端

## 四、架构选型

### 4.1 GUID 生成

| 档 | GUID | 来源 |
|---|---|---|
| **prod** | `{F9F6F6C5-D865-468C-BCE5-BF0ECA24A763}` | 沿用现有(锁死,不动) |
| **beta** | `{86413DCA-EA81-415A-A309-473EBFD78990}` | 本次 `[System.Guid]::NewGuid()` 生成 |
| **dev** | `{4C5D29F2-3BBB-49A2-B248-B74B716F8EA1}` | 本次 `[System.Guid]::NewGuid()` 生成 |

### 4.2 .iss 切档机制

用 Inno Setup 预处理器 `#if AppEnv == "..."` + ISCC 命令行 `/DAppEnv=<env>` 注入:

```iss
#ifndef AppEnv
  #define AppEnv "prod"   ; 默认 prod,兼容不传 -Env 的老调用
#endif

#if AppEnv == "prod"
  #define AppId          "{{F9F6F6C5-...}"
  #define AppName        "DeskFox"
  #define OutputBase     "DeskFox"
#elif AppEnv == "beta"
  ...
#elif AppEnv == "dev"
  ...
#else
  #error Unknown AppEnv. Use prod | beta | dev.
#endif
```

`AppName` 同时作为 `DefaultDirName={autopf}\{#AppName}` 和 `DefaultGroupName={#AppName}` → 三档分别装到 `Program Files\DeskFox` / `\DeskFox Beta` / `\DeskFox Dev`,开始菜单分组也分开。

### 4.3 命名约定(跟 macOS 对齐)

| 平台 | 显示名(productName/AppName) | 文件名前缀 |
|---|---|---|
| Mac `productName` | "DeskFox" / "DeskFox Beta" / "DeskFox Dev" | `DeskFox*.dmg` |
| Win `AppName` | 同上(显示用空格)| `DeskFox-Beta` / `DeskFox-Dev`(文件名用中划线,空格在 Win 命令行需要引号)|

### 4.4 N 序列共享(三档共用 Win 计数器)

bump-installer-version 不改 — 三档共用同一个 Win 端 N 序列。理由:
- 同一份代码出三档产物,版本号同步是合理的
- 简化心智模型:今天打了第几次 = N,不分档
- 跟 mac 端约定一致(macOS 三档也共享 macOS N 序列)

### 4.5 替代方案对比

| 方案 | 评估 |
|---|---|
| ✅ **本方案**:`#if AppEnv` + ISCC `/D` 注入 | 单文件三档,逻辑清晰,Inno Setup 标准做法 |
| ❌ 三个独立 .iss 文件 | 重复 70% 内容,维护负担,改一处要同步三处 |
| ❌ 改 `mainBinaryName` 让三档 .exe 不同名 | 影响 tauri 上游 contract,而且 .iss 的 `[Files]` 段路径要跟着变,牵连面大 |

## 五、影响范围

### 改动文件(2 个)

| 文件 | 改动 |
|---|---|
| `packages/branding/installer/DeskFox.iss` | `+27` 行 — 加 `#ifndef AppEnv` + 三档 `#if/#elif/#else` 块,`AppId` / `OutputBaseFilename` 改用 `{#...}` 引用 |
| `packages/branding/scripts/pack-installer.ps1` | `+15 / -3` 行 — 加 `param([ValidateSet] [string]$Env = "prod")` + ISCC 调用加 `/DAppEnv=$Env` + 产物路径按 env 选 suffix |

### 同笔配套文档

- `docs/governance/应用身份-命名规则.md` — Win 三档表填实际 GUID,去掉"待落地"标记
- `docs/features/INDEX.md` — 加 `win-tri-env-appid` 索引行
- `docs/features/win-tri-env-appid/{1-spec,2-plan,3-changelog}.md` — 本三文档

### 不动的部分

- `tauri-overrides/{prod,beta,dev}.json` — 已有,本次不改
- `build-deskfox.ps1` — 已支持 `-Env`,产物固定 `DeskFox.exe`,本次不改
- `bump-installer-version.ps1` — N 序列共享,本次不改
- macOS 链路全部 — 本次只动 Win 端

## 六、风险

| 风险 | 评估 | 缓解 |
|---|---|---|
| GUID 写错,prod 装不上旧版 | 低 — prod GUID 直接复制粘贴自原 .iss line 19 | 改完 git diff 人眼确认 prod GUID 字面值未动 |
| ISCC 预处理 `{{` 字面 GUID 解析错 | 低 — `{{XXX}` 是 Inno Setup AppId 标准写法,通过 `#define` 间接引用过去也没问题 | 至少跑一次 prod 实际 ISCC 编译验证 |
| 用户用旧 pack 命令(无 `-Env`)默认 prod 没出错 | 低 — `param [string]$Env = "prod"` 默认值兜底,行为完全等价老调用 | 老命令 `& .\pack-installer.ps1` 不传参,效果跟改前一样 |
| 三档 GUID 写到 git 后泄露? | 无 — GUID 不是密码,公开仓库写 GUID 是 Inno Setup 标准做法 | N/A |

## 七、规模估算

| 维度 | 值 |
|---|---|
| 改动文件数 | 2 个代码 + 4 个文档 |
| 改动行数 | 代码 ~50 行,文档 ~150 行 |
| 规范 v2 规模档 | **Medium** — 三文档全要,各 1 页够 |
