---
feat-id: release-mac-ci
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# release-mac-ci — 实施计划

> spec 见 [`./1-spec.md`](./1-spec.md)。本文档实时记录实施过程。

---

## 一、实施步骤

| # | 动作 | 状态 |
|---|---|---|
| 1 | 起 spec(决策表 + 改动范围)| ✅ |
| 2 | user 审 spec | ✅(2026-05-02,user 确认 tag 命名 + 延后扩展点)|
| 3 | 写 `.github/workflows/release-mac-deskfox.yml`(对照 win 版)| ✅ |
| 4 | 写 2-plan(本文档)+ 3-changelog 框架 | ✅ |
| 5 | 同步 `docs/features/INDEX.md` + `改动日志.md` 索引 | ✅ |
| 6 | commit 主体(2 笔:`3c7877225` 三文档+索引 / `9a80c7dc9` workflow)| ✅ |
| 7 | 本地 build-deskfox.sh -Env dev 实测出 .dmg | ✅(2026-05-02 22:13)|
| 8 | rebase 到新 dev(`ac5af022d`)— resolve 2 文件冲突,chore-crlf auto-drop | ✅ |
| 9 | 回填 commit hash + status: done(本笔补全 commit)| ✅ |
| 10 | merge feat → dev(--no-ff,保留拓扑)+ 删本地 feat 分支 | ⏳(user 拍板时机)|
| 11 | push origin + dispatch dev 模式 GitHub Actions 验 | ⏳(user 决定 push 时机)|

---

## 二、决策轨迹(spec 后的细化)

### 2.1 不改 `pack-installer.sh`(spec 改动范围里删除该项)

spec 第三节列了 `packages/branding/scripts/pack-installer.sh` 加 `--version` 参数。**实际实施时取消** — 改成 workflow 内直接 mv .dmg(逻辑约 18 行 bash,与 pack-installer.sh 内嵌的 mv 块完全相同),原因:

- pack-installer.sh 现有职责是"bump → build → mv",workflow 上的 bump 在本地完成、build 由 build-deskfox.sh 完成,只剩 mv 一步,调 pack-installer.sh 反而多绕路
- pack-installer.sh 不改,本地 user 用法不变(零 risk)
- workflow 内自带 mv 逻辑也好读,关联清晰

按 R1 三级跳:**新文件 + 上游加 ≤5 行接口注入**(本笔 0 行接口注入,纯新增 fork-only workflow + 文档)。

### 2.2 sidecar build 由 `build-deskfox.sh` 自动接管

build-deskfox.sh 已经内嵌 sidecar 自动 detect + build(`predev.ts`)。Win workflow 走单独 step 是因为它走 PowerShell 路径有差异;mac 直接 `bash build-deskfox.sh -Env <env>` 一行接管,无需额外 step。

### 2.3 Cache key 与 Win 共用 `rust-${{ runner.os }}-...`

`runner.os` 在 macOS runner 是 `macOS`,与 Win 的 `Windows` 不同 → 两端 cache 互不干扰,同时 hashFiles('**/Cargo.lock') 让 lock 变更时自动 invalidate。无需改 key。

### 2.4 dispatch 模式不写 placeholder 到 `docs/installer-versions.md`

dispatch 是测试用,build 完即丢,不应污染版本日志。tag 模式下 user 已在本地跑过 bump 写好 placeholder,workflow 不重复写。

---

## 三、测试计划

### 3.1 本地验证(commit 前)

- [x] `bash -n .github/workflows/release-mac-deskfox.yml`(yaml 语法不能直 bash check,但 yml 缩进肉眼审过)
- 不跑 typecheck — 本笔 0 修改 ts/rs/js,纯 yaml + md

### 3.2 远端验证(commit + push 后)

| 测试项 | 操作 | 预期 |
|---|---|---|
| workflow 文件被识别 | push feat 分支后,看 GitHub Actions 列表 | 出现 `release-mac-deskfox` 入口 |
| dispatch dev 模式 | UI 点 "Run workflow" → env=dev | macos-latest runner 拉起,build 完成,artifact 上 7.x MB+ 的 `DeskFox Dev-<dispatchN>_aarch64.dmg`,**不发 Release** |
| dispatch beta 模式 | env=beta | 出 `DeskFox Beta-...` |
| (合 dev 后)tag 模式 | 本地 bump → tag `ship-mac-prod-<v>` → push tag | workflow 拉起,build 完成,**发 draft Release** |

### 3.3 不在本笔范围内

- 实际下载 dmg → 拖 Applications → Gatekeeper 右键打开 → 启动 — user 实测,本笔不阻塞
- universal binary / 签名 / notarize — spec 第六节延后

---

## 四、风险监控点

| 风险 | 监控方式 |
|---|---|
| macos-latest runner 实际是 arm64? | dispatch 跑完看 log:`uname -m` 应出 `arm64` |
| sidecar build 在 CI 失败 | log 应有 `[deskfox] sidecar built: <bytes> bytes` |
| .dmg 重命名匹配 tauri 输出 | rename step 应打印 `[rename] <old> → <new>` |
| Release body 模板渲染 | tag 模式跑完看 draft Release 页面,SHA256 / 大小 / 文案是否正常 |
