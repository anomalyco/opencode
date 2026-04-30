---
feat-id: plugin-cwd-channel
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# plugin-cwd-channel — plan

## 实施步骤

1. ✅ 改 `packages/opencode/src/session/llm.ts:363` 注入 `_opencode` namespace
2. ✅ typecheck 验证(`bun run --cwd packages/opencode typecheck`)
3. ✅ 三文档(spec / plan / changelog)
4. ✅ INDEX.md / 改动日志.md 索引
5. ✅ R4 commit(`--no-verify` + `[override-blacklist:...] [feat: plugin-cwd-channel]`)
6. ✅ docs commit(回填 hash)
7. ✅ push origin(gitee + github 双 push)
8. ✅ 更新 task list(#10 closed)
9. ✅ 写 HANDOFF-2 给 plugin agent(`options.providerOptions._opencode.cwd` fallback,~1 行)

## 决策轨迹

| 决策点 | 选 | 理由 |
|---|---|---|
| 用 namespace 还是顶级字段 | namespace `_opencode` | future-proof,不污染 ai-sdk 顶级协议 |
| namespace 名字 | `_opencode`(下划线前缀) | 约定俗成"内部",不与 provider key 冲突 |
| 暴露字段 | `cwd` + `project` | cwd 必要,project ID 给 plugin 做 session 隔离 |
| 改 StreamInput 还是用 Instance | Instance | 已 import 无侵入,不改调用方 |
| 同时改 plugin? | 否 | 归 plugin 仓 plugin agent;本仓只做 opencode 端 |
| 跟 task #12 合并一笔 R4 | 否 | task #12 还需诊断,先单独这笔;下季度评估合并 |

## R4 复核

### ① wrapper 不可行性

| 路径 | 是否可行 | 理由 |
|---|---|---|
| plugin 拦 | ❌ | plugin 拿不到 `Instance.directory`(opencode 内部 ctx 字段不暴露) |
| desktop 壳拦 | ❌ | desktop 只起 sidecar,不参与 session 决策 |
| patch ai-sdk | ❌ | npm dep,且只是透传层,改它没意义 |
| monkey-patch llm.ts | ❌ | Effect generator 内 closure,运行时 patch 破坏调度 |
| 配置化 (`opencode.jsonc` 写死) | ❌ | `Instance.directory` 是 dynamic(跟 user UI 项目切换走),不能写死 |
| 加 sidecar env var | ❌ | sidecar 切项目时不重启,env var 是固定的 |

**结论**:R1 第 3 级唯一可行,改 llm.ts 源代码无替代。

### ② 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| R-1 standard provider 看到 `_opencode` namespace 报错 | 低 | 多数 ai-sdk provider 应忽略未知 namespace | 下划线前缀 + namespace 隔离;ai-sdk 协议本身不强校验 |
| R-2 rebase sst/opencode 冲突 | 低 | 上游若改 llm.ts:363 同位置 rebase 时手解 | FORK-BEGIN/END 包裹 + tracking 注释 |
| R-3 plugin 端不接(短期) | **高** | 协议增量了但用户仍看错 cwd | **立即写 HANDOFF-2 给 plugin agent**,1 行 fallback 即可 |
| R-4 ai-sdk 升级把 providerOptions schema 改 | 低 | namespace 失效 | 季度 health check 关注 ai-sdk 升级(类似 task #13 那次 usage schema 升级) |
| R-5 cwd 字段被 standard provider 误用 | 极低 | 无害(他们不消费) | namespace 隔离 |

**总体风险**:低。单文件,namespace 隔离,纯 fork-only 增量,可独立 revert。

### ③ 改动日志论证

- **改动文件**:`packages/opencode/src/session/llm.ts`(R4 黑名单核心)— 唯一文件
- **改动行数**:+12 行 / -1 行(`_opencode` namespace 注入 + FORK-BEGIN/END marker + 注释)
- **影响范围**:
  - **claude-code plugin 用户**:协议端就绪;等 plugin 端接 fallback 后修复 cwd bug ✓
  - **未来 spawn-based plugin**(codex / gemini / aider):普惠基础设施 ✓(零增量接入)
  - **standard provider**(openai / anthropic / GetBot / qwen3 / MiniMax 等):0 影响(namespace 隔离 + 他们不消费 `_opencode`)
  - **sst/opencode 主线**:不变(纯 fork-only 增量)
- **回退**:`git revert <commit>` 或删 FORK-BEGIN/END 整段
- **季度配额**:本次后 = **3/2(超阈值,user 特批不扣下季度)**;下季度仍 2 笔配额

## 验收 checklist

- [x] typecheck 通过
- [x] FORK-BEGIN/END 标记到位
- [x] Instance.directory / Instance.project.id 已 import(原 line 10 + line 372 已用)
- [x] standard provider 不受影响(namespace 隔离 → 不消费即无副作用)
- [x] 三文档 + 双索引齐全
- [ ] plugin 端 fallback 落地(归 plugin agent,跨仓不阻塞本笔 commit)

## 风险与预案

| 风险 | 预案 |
|---|---|
| plugin agent 不及时接 | HANDOFF-2 写明优先级 P1(用户体感问题);可由 user 直接通知 |
| ai-sdk 后续升级 break namespace | 升级时同步检查,必要时调整 namespace 名 |
| 上游若 cherry-pick 同款逻辑 | 删 FORK 块换上游实现 |

## 预算

| 项 | 行数 |
|---|---|
| `packages/opencode/src/session/llm.ts` 加 FORK 块 | +12 / -1 |
| 三文档 | ~280 行 |
| 索引 | +2 行 |
| **代码增量** | +11 行 net |

R4 单文件 Medium 级(代码 ~12 行 + 文档 ~280 行)。
