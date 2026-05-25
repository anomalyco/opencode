---
feat-id: imbot-workspace-rename
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# imbot-workspace-rename — 3-changelog

> **状态**:✅ 代码 + 测试落地(2026-05-25,等 user 实测 C9)
> **commit 链**:3 commits(spec/plan + 主实施 + changelog)
> **规模**:Medium 净 +180 行(238 + / 39 -)+ 三文档 / 8 文件触动 / 0 上游侵入

## commit 链

| hash | 内容 |
|---|---|
| `3ad07cefb` | docs: 1-spec + 2-plan + INDEX entry |
| `11f6b739e` | feat: rename + migration helper + 6 测试 case + active docs 同步 |
| (本次填) | docs: 3-changelog + INDEX done + 改动日志 |

## 改动文件

| 文件 | 净行数 | 改动 |
|---|---|---|
| `packages/adapter-feishu-lark/src/plugin.ts` | +63 / -3 | 加 `LEGACY_WORKSPACE` 常量 + `migrateLegacyWorkspace` helper(35 行,DI 友好测) + `initBackground` 启动时调用 + 引用全改 `IMBOT_WORKSPACE` + fs import 加 `existsSync`/`renameSync` |
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` | +10 / -10 | 常量 `FEISHU_WORKSPACE` → `IMBOT_WORKSPACE` + 路径字面 `~/.opencode/feishu-workspace` → `~/.opencode/imbot-workspace`(9 处引用 + JSDoc) |
| `packages/adapter-feishu-lark/src/feishu/reply-actions.ts` | +3 / -3 | `FEISHU_WORKSPACE_ROOT` → `IMBOT_WORKSPACE_ROOT`(ATTACH 路径白名单) + 注释 |
| `packages/adapter-feishu-lark/src/core/opencode-client.ts` | +1 / -1 | JSDoc 注释路径更新 |
| `packages/adapter-feishu-lark/src/__tests__/migrate-legacy-workspace.test.ts` | +127 / 0 | **新文件** — 6 个测试 case(T1-T6,DI mock 5 case + 真实 fs 1 case)|
| `packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts` | +1 / -1 | tmp dir 名同步 imbot-workspace |
| `packages/adapter-feishu-lark/src/feishu/__tests__/reply-actions.test.ts` | +4 / -4 | import + 断言改 `IMBOT_WORKSPACE_ROOT` |
| `docs/governance/imbot-定制指南.md` | +12 / -12 | 全文路径替换(mac/linux/windows 各路径示例 + 文末关联文档)|
| `CLAUDE.md` | +1 / -1 | governance table imbot 指南 entry 路径更新 |

**OPENCODE-PLAN 仓**(独立 commit):
- `架构决策/im桥接-imbot单一架构.md`:全文 `feishu-workspace` → `imbot-workspace`(代码块 + 工作流示例 + 架构图 mermaid + 表格)

## 关键设计点

### 1. 区分 IM 共享 vs IM-specific(只改 1 个,保留 4 个)

| 路径 | 是否 IM 共享 | 处置 |
|---|---|---|
| `~/.opencode/imbot-workspace/` ← **本次改名 from feishu-workspace** | 共享 home base | **改** |
| `~/.opencode/feishu-config.json` | feishu-specific 账号凭证 | 保留 |
| `~/.opencode/feishu-chat-sessions.json` | feishu-specific per-account chat→session | 保留 |
| `~/.opencode/feishu-plugin-server.json` | feishu-specific plugin local server | 保留 |
| `~/.opencode/feishu-wss-dedup.json` | feishu-specific WSS dedup cache | 保留 |

未来 telegram plugin 会建 `telegram-config.json` / `telegram-chat-sessions.json` 等(各 IM 各自管),但**共用同一个 `imbot-workspace/`** home base。

### 2. `migrateLegacyWorkspace` 行为表

| 输入 | 返回 | 副作用 |
|---|---|---|
| legacy 存在 + new 不存在 | `"migrated"` | `renameSync(legacy → new)` + info log |
| legacy 不存在 + new 存在 | `"noop-already-new"` | 0 |
| 两者都不存在(初次安装) | `"noop-no-legacy"` | 0 |
| 两者都存在(罕见,user 自己 mkdir 过) | `"skipped-both-exist"` | warn log,**不动** |
| rename 抛错(EACCES/磁盘满/跨盘符) | `"failed"` | warn log,**不崩** |

### 3. DI 友好 helper extract 模式

`migrateLegacyWorkspace` 接受 `fs` + `logger` 注入参数,**5/6 测试用 mock**,**1 个用真实 tmp fs 验 rename 子内容跟随**。R5 双清单 Logic 80% 行覆盖达标。

### 4. 初始化时机

`migrateLegacyWorkspace` 在 `initBackground` **最早期**(mkdirSync 之前)调用 — 避免:
- 老 user 启动时先 mkdir 新路径,再迁移 → "两者都存在" 路径触发 warn
- 顺序:`migrate → mkdir`(new 路径不存在时 mkdir 才创建,存在时 noop)

## 测试

### 新加 6 个 migration helper case(对应 1-spec T1-T6)

| # | case | 验证 |
|---|---|---|
| T1 | legacy 存 + new 不存 → migrated | renameSync 调一次 + log "migrated legacy workspace" |
| T2 | only new 存 → noop-already-new | renameSync 0 调用 |
| T3 | 都不存(初次) → noop-no-legacy | renameSync 0 调用 |
| T4 | 都存 → skipped-both-exist + warn | warn log 含 "both" |
| T5 | rename 抛 EACCES → failed + warn + 不崩 | 不抛出去,warn log 含 "EACCES" + "failed to migrate" |
| T6 | **真实 fs** mv 子目录 + 子文件全部跟着 | tmp dir 操作,验证 `.opencode/agent/imbot.md` + `test.png` 跟着到 new path |

### 既有测试更新(回归)

- `reply-actions.test.ts:9/190/191/193`:import + 断言改 `IMBOT_WORKSPACE_ROOT`
- `message-pipeline.test.ts:974`:tmp dir 命名 `"imbot-workspace"`(测试 fixture 命名跟生产代码常量一致)

### 套件状态

- typecheck:**16/16**(C1 ✅)
- adapter-feishu-lark 套件:**511/511**(C2-C5 ✅,原 505 + 新 6)
- 历史 4 个 feat 的测试 0 回归
- Rust cargo check:**N/A**(Tauri 无 feishu-workspace 引用,本 feat 0 Rust 改动,C10 跳过)

## 三铁律走流程

| 步骤 | 状态 |
|---|---|
| 开 feat 分支 `feat/imbot-workspace-rename` | ✅ |
| 本地 commit 不动主分支 | ✅ |
| 合主分支 user 同意 | (待 user 拍)|
| 推主分支 user 同意 | (待 user 拍)|

## 实测建议(C7-C9,等 user 验证)

build dev .app 装 `/Applications/DeskFox Dev.app` 后:

### C7:fresh install 模拟

```bash
# 清掉两个路径模拟初次安装
rm -rf ~/.opencode/feishu-workspace ~/.opencode/imbot-workspace
# 启动 DeskFox Dev.app
open "/Applications/DeskFox Dev.app"
# 验证
ls -la ~/.opencode/imbot-workspace/  # 应该创建出来
ls ~/.opencode/feishu-workspace 2>&1  # 应该 "No such file"(没创建老路径)
tail -20 ~/Library/Logs/ai.deskfox.app.dev/opencode-desktop_*.log | grep -i workspace
# 预期 log:"plugin] server: ... workspace=/Users/.../.opencode/imbot-workspace"
```

### C8:migration 路径模拟(老 user 升级)

```bash
# 模拟老 user 已有 feishu-workspace + 一个 imbot.md 定制文件
rm -rf ~/.opencode/imbot-workspace
mkdir -p ~/.opencode/feishu-workspace/.opencode/agent
echo "test prompt" > ~/.opencode/feishu-workspace/.opencode/agent/imbot.md
# 启动
open "/Applications/DeskFox Dev.app"
# 验证迁移
ls -la ~/.opencode/imbot-workspace/.opencode/agent/imbot.md  # 应该存在
ls ~/.opencode/feishu-workspace 2>&1  # 应该 "No such file"(被 mv 走了)
grep -i "migrated legacy" ~/Library/Logs/ai.deskfox.app.dev/opencode-desktop_*.log | tail -5
# 预期 log:"plugin] migrated legacy workspace path ... feishu-workspace → ... imbot-workspace"
```

### C9:飞书桥接 happy path 不回归

启动 DeskFox 后,真实测试(user 自己跑):
- 私聊发 `/new` → ✅ 已开启新对话
- 私聊发 `/group 测试群` → 弹 confirm card
- AI reply 含 `[ATTACH:<path>]` → 路径白名单按 `~/.opencode/imbot-workspace` 判定(不是老路径)

## 风险 / 已知限制

1. **跨文件系统 rename 失败**(罕见,user 把 `~/.opencode/` 软链到外置盘):T5 case 兜底 warn,user 看日志手动 mv
2. **跨 ship 回退兼容**:本 ship 装上后 user 文件已 mv 到 imbot-workspace;如 user 回装老版本(2026.5.25.1 prod),老版本认 feishu-workspace 路径 → 找不到文件 → user 需手动 mv 回去。**建议本次走 Tier 2 dev ship 先验,稳定后再 Tier 1 prod**
3. **legacy 是 symlink**:`renameSync` 默认改 symlink 自己的名字,不 follow。user 自定义 symlink 行为不破坏
4. **历史 changelog 文档保留 feishu-workspace 字眼**:作为历史快照,不修改;搜索时可能看到老路径,这是有意的(那时实际就是用 feishu-workspace)

## 回退方法

`git revert <主 commit 11f6b739e>` 一次性退回。但 user 文件已 mv 到新路径 → 还需手动 `mv ~/.opencode/imbot-workspace ~/.opencode/feishu-workspace` 才能跟回退后的代码对得上。

## 关联

- 上游 ADR:`OPENCODE-PLAN/架构决策/im桥接-imbot单一架构.md`(本 feat 实现路径名跟 ADR §一语义一致化)
- 配套 user 指南:`docs/governance/imbot-定制指南.md`(本 feat 同步改路径)
- 历史 feat(home base 命名出处):
  - `feishu-bridge-light`(2026-05-23,引入 FEISHU_WORKSPACE 常量)
  - `feishu-attach-upload-robustness`(2026-05-24,ATTACH 路径白名单)
  - `feishu-bridge-system-prompt-disable-question`(2026-05-23,workspace 隔离背景)
- 关联 memory:`reference_imbot_agent.md` 等(active memory 含路径引用的需同步)
