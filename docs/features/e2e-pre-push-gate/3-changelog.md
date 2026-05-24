---
feat-id: e2e-pre-push-gate
status: done
related: ./3-changelog.md
---

# e2e-pre-push-gate — 3-changelog

> **测试纪律自动化最后一公里** — `.husky/pre-push` 加 Phase 1 e2e gate(只在 push 含 main 时触发),失败拦推送,关 ping-pong 循环

## 一句话

`.husky/pre-push` 在原有 bun 版本检查 + typecheck 后追加 e2e gate 段:`while read remote_ref` 探测 push 目标含 main 才跑;vite mock 必须已在 :3000(不自动 spawn 避开 Win Git Bash 跨平台 pid 管理坑);通过 `--no-verify` + `[override-pre-push: 理由]` tag 跳过。3 种场景手动验证全过。

## 改动清单

| 文件 | 改动 | 行数 |
|---|---|---|
| `.husky/pre-push` | 追加 e2e gate 段(只 main + vite 检测 + playwright test 调用) | +43 |
| `docs/features/e2e-pre-push-gate/3-changelog.md` | 新文档(本) | +80 |
| `docs/features/INDEX.md` | feat 入口 | +1 |
| `改动日志.md` | feat 索引行 | +1 |

**总:~125 行**,Tiny+ 规模。

## 设计决策

### D1 — 只在 push 含 main 时触发(feat 分支 push 不卡)

读 stdin 解析 push refs,只有 `refs/heads/main` 才跑 e2e 段;feat 分支 push(常用作备份 / 协作)只跑 typecheck 不付 e2e 成本(~24s)。FORCE_E2E_GATE=1 env 可强制开启用于 CI 或局部测试。

### D2 — 不自动 spawn vite

实测候选方案:
- 自动 spawn vite + trap EXIT cleanup → 跨平台 pid 管理(Git Bash on Win 无 pkill,子进程 pgid 不可靠);kill 父 bun 不杀子 vite;清理坏可能留孤儿进程
- **失败 + 清楚指引** → 单 curl 探测,fail 时打印启动命令;符合 "vite mock 在另一终端常驻" 的实际开发习惯

选后者 — 简单稳健 + 0 跨平台问题 + 清晰错误恢复。

### D3 — 跳过机制 `git push --no-verify`

继承 husky 标准跳过路径(同 pre-commit override 哲学)。配 commit 或 改动日志 加 `[override-pre-push: 理由]` 留 audit trail。

## 验证(3 场景手动测)

| # | 场景 | 期望 | 实测 |
|---|---|---|---|
| 1 | 无 vite + push 含 main | HOOK_EXIT=1 + 清楚指引 | ✅ HOOK_EXIT=1,打印"vite mock dev server 没在 :3000 跑" + 启动 + skip 指令 |
| 2 | 无 vite + push 到 feat 分支 | HOOK_EXIT=0,跳过 e2e 段 | ✅ HOOK_EXIT=0,typecheck 跑了但完全无 "e2e gate" 字眼 |
| 3 | vite 跑 + push 含 main | HOOK_EXIT=0 + 11/11 全过 | ✅ HOOK_EXIT=0,11 passed / 1 skipped / 24.1s + "[pre-push] e2e all pass" |

模拟方式:`echo "0000 0000 refs/heads/<target> 0000" | bash .husky/pre-push origin <url>`(mimic husky 给 hook 的 stdin)。

## 影响范围

### 生产 build:0 影响
- pre-push 只在 git push 时跑,生产路径 0 接触

### Dev workflow:**习惯改变**
- **push 到 main**:vite mock 必须在 :3000 跑(开发时常驻在另一终端的工作习惯需养成)
- **push 到 feat 分支**:不变(只 typecheck)
- **CI / Mac 协作者**:同步生效;Mac 端建议同样开常驻 vite mock 用于本地 e2e 验证(若 Mac 端不跑 e2e,push 到 main 必走 `--no-verify`)
- **首次跑的人**:fail 时清楚提示如何启动,迁移成本低

### 双端协作(Mac)
- pre-push 改 = 双端立即生效(Mac 协作者下次 push main 需要 vite mock 在 :3000)
- **建议 Mac 端文档化此约定**(本 changelog 已说明)

### R5 v4 履约
- **测试纪律 100% 自动化**最后一块拼图 — 从此 Claude 改完不跑 e2e 直接 push main 会被 hook 拦,关 ping-pong 循环

## 回退方法

如需回退本 feat:
1. `git revert <commit-hash>` 撤掉本笔
2. `.husky/pre-push` 回到只跑 typecheck 状态

## Follow-up backlog(不阻塞本 feat done)

| 项 | 内容 | 时长 |
|---|---|---|
| **vite mock 自动 spawn**(可选)| 重新评估:封装到 fork-only ps1+sh 脚本 wrap pid 管理,Win Git Bash + Mac bash 双端 parity | 1-2d(优先级低,失败 + 指引足够好) |
| **CI 跑 e2e gate**(若启用 GitHub Actions PR check)| 现已 abandoned cloud build(`abandon-cloud-build-workflows`)— 启用前先评估是否反转;复活的话要补 vite warmup 顺序 | 半 d |
| **Mac 端常驻 vite mock 文档化** | 双端协作 SOP 加段:Mac 端开发常驻 vite mock + 触发 e2e gate 路径 | 0.5h |
| **markSelfWriting 反向用例 / A4 完整版** | 继承自 `e2e-bug-repro-3case` follow-up | 各 1-3d |

## 规模 / R 标记

- **规模**:Tiny+(~125 行,1 hook + 3 docs)
- **R1 三级跳**:N/A(改 hook 文件,不涉新功能上游接入)
- **R2 FORK marker**:`.husky/pre-push` 新增段头注 `FORK: Phase 1 e2e gate(fork 自加)[feat: e2e-pre-push-gate]`
- **R3 / R6**:N/A
- **R4 黑名单 override**:0 — `.husky/pre-push` 不在 BLACKLIST_REGEX 命中(本季配额已用满 2/2 但本笔不消耗)
- **R5 v4 履约**:测试纪律自动化最后一公里
- **R7 bug-repro**:N/A(基础设施 feat,非 bug fix)

## 时间戳

- 立项 + 实施 + 验证 + 收尾:2026-05-23 单日
