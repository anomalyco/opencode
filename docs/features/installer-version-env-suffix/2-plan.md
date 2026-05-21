---
feat-id: installer-version-env-suffix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# installer-version-env-suffix — 2-plan

## 实施步骤(5 步)

### Step 1:`bump-installer-version.ps1` Env 参数

- 加 `[ValidateSet("dev", "beta", "prod")] [string]$Env = "prod"` 参数
- 计算 `$envSuffix`:prod="" / beta="-beta" / dev="-dev"
- regex pattern 加 suffix + trailing space anchor:`## \[Platform\] today\.(\d+)$escSuffix `
- `$newVersion = "$today.$nextN$envSuffix"`

### Step 2:`bump-installer-version.sh` 对应

- 加 `-Env|--env|-e` 参数,默认 "prod",校验 prod/beta/dev
- sed pattern 加 `${ENV_SUFFIX}` 后缀 + trailing space anchor
- `NEW_VERSION="$TODAY.$NEXT_N$ENV_SUFFIX"`

### Step 3:`pack-installer.ps1` 透传 Env

bump 调用:`bump-installer-version.ps1 -Platform "Windows" -Env $Env`(原默认 prod 不变)

### Step 4:`pack-installer.sh` 透传 env

bump 调用:`bump-installer-version.sh -Platform macOS --env "$ENV"`

### Step 5:`DeskFox.iss` VersionInfoVersion strip suffix

ISPP preprocessor 在 AppVersion 含 `-` 时 strip 后缀给 `NumericAppVersion`,`[Setup]` 段 `VersionInfoVersion={#NumericAppVersion}` 明示数字格式。

### 验证策略

- **dry-run 3 路径**:env=dev / env=prod / 默认无 Env(应 fallback prod)— 全部跑过 ✅
- **regex 隔离分析**:trailing space anchor 防 prod ".1" 误匹配 dev ".1-dev"(代码注释 + 1-spec 详述)
- **集成 pack 测试**:跑 `pack-installer.ps1 -Env dev` 真实 bump + build + ISCC,出包 + 打开验证

## 决策轨迹

### regex 锚定方式 — trailing space vs lookahead

初版试 `(?=[ —-])` 字符类 lookahead(兼容 `-` `—` ` ` 三种分隔符),后审视发现 lookahead 字符类含 `-` 会引起歧义(若 dev 条目实际是 `## [Win] 2026.5.21.1-dev-2 - timestamp` 这种边界情况,prod 模式可能误匹配 `.1-` 然后从 `dev` 提取数字)。简化为**单一 trailing literal space anchor**,placeholder 模板都用 ` - `(space-hyphen-space)或 ` — `(space-em-dash-space),trailing space 在所有场景都成立。

### N 序列 env 独立 vs env 单方向 fallback

考虑过"dev 找不到当天 entry 时 fallback 看 prod N"(让 dev 从 prod 最新 N + 1 开始)。否决:增加复杂度,user 看到 `2026.5.21.5-dev` 反而困惑(以为已经打过 4 次 dev)。**完全独立**最干净,user 看版本号就知道 dev 打过几次。

### VersionInfoVersion strip 还是省略

考虑过完全省略 `VersionInfoVersion`(让 Inno Setup 默认行为)。否决:Inno Setup 文档说 AppVersion 不是 N.N.N.N 时会 warning 编译,以后可能出问题。显式 strip 后缀更稳健。

### dev/beta 是否也写入 docs/installer-versions.md log

讨论过 dev/beta 是否 pollute log。结论:**继续写入**。
- log 是历史轨迹,dev/beta entry 用 `-dev`/`-beta` 后缀一眼识别,不会跟 prod 混淆
- 未来万一某次"dev 出问题被外部 user 拿到"也能回溯具体 build
- bump 脚本简单复用同一逻辑,不必分两套 log

## 后续 follow-up

- **本笔不动**:user 之前打过的 `2026.5.15.1` 历史版本号没有 `-prod` 后缀(因为 prod 本就是无后缀),log 不需要回填
- **本笔不动**:Mac `mirror-asset-to-gitee.sh` 上传逻辑(它读 .dmg 文件名,自适应版本号无关)
- **本笔不动**:GitHub Release workflow(读 tag,跟版本号格式无关)
- **观察项**:首次 prod ship 走新流程时确认 release tag 仍是 `ship-prod-2026.5.21.1`(无后缀)而非 `ship-prod-2026.5.21.1-prod`
