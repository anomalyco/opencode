---
feat-id: installer-versioning
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# installer-versioning — plan

## 实施步骤

1. ✅ 改 `packages/branding/installer/DeskFox.iss`:`#define AppVersion "2026.4.29.1"`(替代 1.14.21)
2. ✅ 新建 `docs/installer-versions.md`:模板 + 2026.4.29.1 第一条 entry + 历史段(回溯 04-28 ~ 04-29 早些时候的旧命名)
3. ✅ 新建 `packages/branding/scripts/bump-installer-version.ps1`:算今天 N + 改 .iss + 加占位 entry
4. ✅ 新建 `packages/branding/scripts/pack-installer.ps1`:一键 bump + ISCC + 报路径
5. ✅ DryRun 验证 bump 脚本(读到 .1,提议 .2)
6. ✅ 跑 ISCC 出 `DeskFox-2026.4.29.1-setup.exe`(34 秒,49 MB)
7. ✅ 删旧 `DeskFox-1.14.21-setup.exe`
8. ✅ 三文档 + 索引
9. ✅ 双 commit + push

## 决策轨迹

| 决策点 | 选 | 理由 |
|---|---|---|
| 版本号格式 | `YYYY.M.D.N` 无前导零 | user 明确指定 |
| 改动层 | 只 installer 层(.iss + 版本日志) | sidecar/desktop binary version 跟上游 baseline,不该跟 installer 节奏耦合 |
| 文件名 | `installer-versions.md`(ASCII)放 `docs/` | PowerShell 5.1 中文路径解析坑(踩了 3 次,这次主动避开)|
| bump 脚本是否嵌入 build pipeline | 否 | 测试 build 不该 bump;让 user 显式跑 `pack-installer.ps1` ship 时才 bump |
| 是否做 macOS / Linux 同款 | 否 | 本次只 Windows installer;cross-platform 后续 |
| 是否绑 git tag | 否 | installer 跟 commit 解耦;tag 后续可选加 |

## PowerShell 5.1 中文路径教训

`版本日志.md` 在 PowerShell 5.1 调用时被错码成 `鐗堟湰鏃ュ織.md`(GBK 误读 UTF-8 文件名),脚本 `Test-Path` 失败抛 "version log not found"。

**实战根因**:同 apply-icons.ps1 / build-deskfox.ps1 中文注释解析 bug — PowerShell 5.1 默认 ANSI(GBK on zh-CN system)解 UTF-8 内容,中文字符被错码。

**对策**:**fork-only ps1 脚本接触的所有路径名 + 注释,统一 ASCII**。本仓 `.ps1` 累计踩过 3 次相同坑:
- apply-icons.ps1 line 65-70 中文注释紧贴 if 块(已修)
- build-deskfox.ps1 sidecar 自动 build 段中文注释(已 ASCII 化)
- bump-installer-version.ps1 中文路径(本次)

经验更新到 `docs/features/build-pipeline-sidecar-fix/3-changelog.md` 经验沉淀段。

## 验收 checklist

- [x] DryRun bump 输出 `next=2026.4.29.2`(因为版本日志已有 .1)
- [x] ISCC 出 `DeskFox-2026.4.29.1-setup.exe`(49 MB)
- [x] 旧 `DeskFox-1.14.21-setup.exe` 已删
- [x] `docs/installer-versions.md` 第一条 entry 内容准确(commits / 配套 plugin / installer 路径全)
- [x] 三文档(spec / plan / changelog)+ 双索引齐全
- [x] 跑 `pack-installer.ps1` 时 bump 脚本路径正确(ASCII `installer-versions.md`)

## 风险 / 预案

| 风险 | 预案 |
|---|---|
| user 跨天打包但版本日志没 entry → bump 脚本算 N=1 但意图可能是延续昨天 .N | 接受 — user 规则明确"跨天重置";如需累计可后续改脚本 |
| bump 脚本失败但 ISCC 仍跑 → installer 用旧版本号 | `pack-installer.ps1` 走 `set -e` 等价,bump 失败立即终止 |
| user 手动跑 ISCC 不跑 bump → 版本号不升 | 文档明确"打包用 pack-installer.ps1"作为标准入口 |
| 上游 rebase 改 package.json version → 影响 installer? | 不影响(installer 版本跟 .iss AppVersion 走,跟 package.json 解耦) |

## 预算

| 项 | 行数 |
|---|---|
| `.iss` AppVersion 改 | +5 / -2 |
| `docs/installer-versions.md` | +37(新建) |
| `bump-installer-version.ps1` | +70(新建) |
| `pack-installer.ps1` | +40(新建) |
| 三文档 | ~250 行 |
| 索引 | +2 行 |
| **代码增量** | ~150 行(全 fork-only,无 R4) |
