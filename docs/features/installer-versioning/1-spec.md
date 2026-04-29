---
feat-id: installer-versioning
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# installer-versioning — spec

## 一句话

引入 DeskFox installer 版本号规则 `YYYY.M.D.N`(年.月.日.当天第几版,N 从 1 开始,**Windows / macOS 各自独立 N 序列不共享计数器**),写脚本自动 bump + 一键 pack-installer,建立版本日志记录每次 ship 出去的 installer。

## 背景

之前所有 installer 都叫 `DeskFox-1.14.21-setup.exe`(继承上游 1.14.21 baseline 不动),04-28 / 04-29 早些时候多次重打都同名,接收方区分不开,Windows 装新版可能跳过覆盖。

user 决定:**版本号规则 `YYYY.M.D.N`,每次 installer 打包升一次**。

## 验收标准

1. 跑 `pack-installer.ps1` → 自动 bump + ISCC + 出 `DeskFox-YYYY.M.D.N-setup.exe`
2. 同一天连跑 N 次,文件名 N 自动递增(`.1` → `.2` → `.3`)
3. 跨天第一次跑,N 重置为 `.1`
4. `docs/installer-versions.md` 自动追加占位 entry,user ship 验证后回填详情
5. **不**动 `package.json` × 2(那是 sidecar/desktop binary 内部版本,跟上游 rebase 节奏)
6. 接收方能从 installer 文件名看出版本日期 + 当天迭代次数

## 不做什么

- 不改 `package.json`(version 跟上游)
- 不改 `tauri.conf.json`(它引用 package.json,自动跟)
- 不嵌入 build pipeline(让 user 显式跑 `pack-installer.ps1`,避免误触发 — 测试 build 不该 bump)
- 不做 git tag(installer 版本跟 commit 解耦,bump 不绑 tag)

## 架构选型

### 路径分析

| 策略 | 选 | 理由 |
|---|---|---|
| A 跟上游不动(`1.14.21` 永远) | ❌ | 当前问题来源,接收方区分不开 |
| **B `YYYY.M.D.N`(user 指定)** | ✅ | 时间序自然递增 + 当天迭代显式;ASCII 友好 |
| C 上游+fork 后缀(`1.14.21-deskfox.N`) | ❌ | 跟上游耦合,rebase 时主部分要跟,N 重置规则复杂 |
| D 全自定 SemVer(`1.0.0`) | ❌ | 跟上游脱钩,语义不清 |

### 选定:B

```
YYYY.M.D.N
例:2026.4.29.1, 2026.4.29.2, 2026.5.1.1
```

特点:
- **无前导零**(2026.4.29 而不是 2026.04.29)— user 指定
- **N 从 1 起**(每天第一个版本是 .1)
- **跨天重置**(不累计)— user 指定"当天的第几版"
- **Windows / macOS 各自独立计数**(user 补规则,2026-04-29):同一天 Win 打 1 次 + Mac 打 2 次 → 版本号 `[Windows] 2026.4.29.1` + `[macOS] 2026.4.29.1` + `[macOS] 2026.4.29.2`,**不共享 N 计数器**。版本日志 entry header 用 `## [Platform] YYYY.M.D.N` 格式区分。

### 改动范围(只 installer 层)

| 位置 | 是否改 | 备注 |
|---|---|---|
| `packages/branding/installer/DeskFox.iss` 的 `#define AppVersion` | ✅ | bump 脚本自动改 |
| `docs/installer-versions.md` | ✅(新建) | 每次 bump 加占位 entry |
| `packages/branding/scripts/bump-installer-version.ps1` | ✅(新建) | 算 N + 改 .iss + 写日志 |
| `packages/branding/scripts/pack-installer.ps1` | ✅(新建) | 一键 bump + ISCC |
| `packages/desktop/package.json` | ❌ | 跟上游不动 |
| `packages/opencode/package.json` | ❌ | 跟上游不动 |
| `packages/desktop/src-tauri/tauri.conf.json` | ❌ | 引用 package.json 自动跟 |

### 关键设计

- **bump 脚本读 `installer-versions.md` 里今天已有的 N**:`Select-String -Pattern "^## $today\.(\d+) "` 提取 → max + 1
- **placeholder entry**:bump 时插入"待填",user ship 验证后回填详情
- **PowerShell 5.1 ASCII 路径**:文件名 `installer-versions.md` 而不是 `版本日志.md`,因 PowerShell 5.1 在脚本传参时把中文 GBK 错码(实战踩过 `apply-icons.ps1` / `build-deskfox.ps1` 同款 bug)

## 后续

- macOS:同 bump 脚本支持 `-Platform macOS`(本次已实现);pack-installer.sh / dmg 编译脚本另外做(macos-打包 那边补)
- Linux .deb 走同样规则需要时再加
- pack-installer.ps1 可加 git tag 选项(现在解耦,后续如需要可加)
- 上游 rebase 时,baseline 版本号(package.json 的 1.14.21)更新,但 installer 版本号 `YYYY.M.D.N` 不受影响
