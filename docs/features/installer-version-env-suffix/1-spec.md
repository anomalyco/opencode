---
feat-id: installer-version-env-suffix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# installer-version-env-suffix — 1-spec

> 安装包版本号按 env 加后缀 + N 序列独立(B2 口径)

## 需求来源

2026-05-21 user 实施 `large-file-preview-guard` 后请求"先本地打开安装包"。Claude 用 `pack-installer.ps1 -Env dev -SkipBump -SkipBuild` 跑了一个 `DeskFox-Dev-2026.5.15.1-setup.exe`,user 反馈版本号是上次 5.15 prod ship 的旧值,问"开发包的版本号有没有规范"。

调研发现规范文件(`bump-installer-version.ps1` 头注)只写了 `YYYY.M.D.N` 平台级独立,**没有 env 维度规则**。Claude 给 3 候选(B1 同 prod 共享 N / B2 加 env suffix N 独立 / B3 不 bump 永远复用上次 prod 版本号),user 选 **B2**。

## 决策(B2 — env suffix + N 独立)

| env | 版本号形态 | 示例 |
|---|---|---|
| **prod** | `YYYY.M.D.N` (无后缀,保持原口径) | `2026.5.21.1` |
| **beta** | `YYYY.M.D.N-beta` | `2026.5.21.1-beta` |
| **dev** | `YYYY.M.D.N-dev` | `2026.5.21.1-dev` |

**N 计数器维度升级:平台 × env 双维度独立**。同一天:
- Windows prod 第 1 笔 → `2026.5.21.1`
- Windows dev 第 1 笔 → `2026.5.21.1-dev`(N 不受 prod 影响)
- Windows prod 第 2 笔 → `2026.5.21.2`(N 不受 dev 影响)
- macOS dev 第 1 笔 → `2026.5.21.1-dev`(平台独立)

## 候选方案对比

| 方案 | 行为 | 优点 | 缺点 | 用户决议 |
|---|---|---|---|---|
| **B1** dev 同 prod 共用 N | 先打 dev 占 .1 后打 prod 跳 .2 | 简单,1 套版本号 | dev 频繁打污染 prod N(误以为 prod ship 多次)| 否决 |
| **B2** dev 用 `-dev` 后缀 + N 独立 | 视觉一眼区分 + 各自独立计数 | dev/prod 解耦,prod log 干净 | 脚本 / .iss 改动 | **采用** |
| **B3** dev 不 bump 永远复用上次 prod | 0 改动 | 最快 | 多次 dev 包同版本号容易搞混 | 否决 |

## 架构选型

### 改动落点

| 文件 | 改动 |
|---|---|
| `packages/branding/scripts/bump-installer-version.ps1` | 加 `-Env dev\|beta\|prod` 参数(默认 prod),regex 加 env suffix 匹配,N 按 env 独立计数 |
| `packages/branding/scripts/bump-installer-version.sh` | 同上,双端 parity |
| `packages/branding/scripts/pack-installer.ps1` | 调 bump 时透传 `-Env $Env` |
| `packages/branding/scripts/pack-installer.sh` | 调 bump 时透传 `--env $ENV` |
| `packages/branding/installer/DeskFox.iss` | 加 `NumericAppVersion` ISPP preprocessor,strip env suffix 给 `VersionInfoVersion`(Inno Setup 必须 N.N.N.N 数字)|

### 关键技术细节

#### N 计数器隔离 — regex trailing space anchor

bump 脚本 regex 加 env suffix 作为 N 之后的字面量,**trailing space 锚定** 防误匹配:

```
pattern = "## \[Platform\] YYYY\.M\.D\.(\d+)$envSuffix "
                                                       ↑ literal trailing space
```

- env=prod (suffix=""): 匹配 `## [Windows] 2026.5.21.1 - timestamp` ✓,**不**匹配 `## [Windows] 2026.5.21.1-dev` ✗(.1 后是 `-` 不是 space)
- env=dev (suffix="-dev"): 匹配 `## [Windows] 2026.5.21.1-dev - timestamp` ✓,**不**匹配 `## [Windows] 2026.5.21.1 - timestamp` ✗

#### Inno Setup VersionInfoVersion N.N.N.N 限制

`VersionInfoVersion` 写进 .exe PE header,Windows API 解析需要纯数字 N.N.N.N。`-dev` 后缀写进去 Inno Setup 会报错。

修法:ISPP preprocessor 剥后缀:

```iss
#if Pos("-", AppVersion) > 0
  #define NumericAppVersion Copy(AppVersion, 1, Pos("-", AppVersion) - 1)
#else
  #define NumericAppVersion AppVersion
#endif

[Setup]
AppVersion={#AppVersion}           ; 人类可读字符串(含后缀)
VersionInfoVersion={#NumericAppVersion}  ; 数字格式(strip 后缀)
```

User 看到的"控制面板 → 已安装应用"是 AppVersion(含后缀,显示 `2026.5.21.1-dev`),exe 文件 properties 详细信息看到的是 VersionInfoVersion(数字,`2026.5.21.1`)— 这是合理设计。

## 口径(写进 governance)

| 场景 | 命令 | 出包文件名 | 何时用 |
|---|---|---|---|
| **正式安装包**(发 GitHub Release / Gitee / 官网,user 用)| `pack-installer.ps1 -Env prod`(不加 `-SkipBump`)| `DeskFox-2026.5.21.1-setup.exe` | release ship,配套 `ship-prod-<version>` tag |
| **beta 安装包**(预发,内部 / 受邀 user 测) | `pack-installer.ps1 -Env beta` | `DeskFox-Beta-2026.5.21.1-beta-setup.exe` | beta 渠道 ship |
| **开发包**(本地自测,不发布) | `pack-installer.ps1 -Env dev` | `DeskFox-Dev-2026.5.21.1-dev-setup.exe` | 本地 / 同机共存测试 |
| **快速重打**(版本号已 bump 过,只换内容) | `pack-installer.ps1 -Env <env> -SkipBump -SkipBuild` | 复用现有 AppVersion | CI / 极速迭代 |

## R 合规

- **R2** FORK marker 各脚本 / .iss 改动点
- **R3** 不涉及品牌资源(版本号本身是 metadata 不算品牌)
- **R4** 0 override(全 fork 白名单 + Inno Setup 配置)
- **R5** Tiny+ 工具脚本改动,dry-run 验证 + 实际 pack 跑通即覆盖;无 unit test 框架(ps1/sh 脚本)
- **R6** 不涉及网络监听
