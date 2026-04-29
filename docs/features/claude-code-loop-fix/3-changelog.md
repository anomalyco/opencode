---
feat-id: claude-code-loop-fix
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# claude-code-loop-fix — changelog

## 一句话

修复 DeskFox 用 `claude-code` plugin(MiniMax/qwen3 之外,选 Claude Sonnet/Opus/Haiku 时)turn 结束后 step loop 不 break 导致 UI"思考中"永久卡死的 bug — 给 `prompt.ts` 加 fork-only 兜底块,用 `step-finish` part 存在替代原 `lastAssistant.finish` 顶层字段判断(走 R4 override + FORK-BEGIN/END marker)。

## commit 列表

| commit | 简述 |
|---|---|
| (待回填,本次单笔) | `fix(opencode): claude-code plugin step loop 兜底 — workaround upstream finish 不上浮 [feat: claude-code-loop-fix] [override-blacklist: 修上游 sst/opencode step loop case-1 bug,plugin 5 轮证伤,wrapper 不可行]` |

## 改动文件

| 文件 | 变更 | 说明 |
|---|---|---|
| `packages/opencode/src/session/prompt.ts` | +15 行 FORK 块 | 在 line 1345 原 break 块**之前**插前置 guard,用 `hasStepFinish` part 检测替代 `lastAssistant.finish` 顶层字段;原块完全保留作 fallback |
| `packages/branding/scripts/apply-icons.ps1` | -7 行 / +4 行 | build 通路前置 fix(顺手):line 65-70 原中文注释含全角括号 `(待写)` 紧贴 if 块,Windows PowerShell 5.1 ANSI 解 UTF-8 no BOM 时把 } 错位识别成 line 70 char 1 → ParseException。改成 4 行英文(信息不丢,指向 icon-pipeline-deep-fix changelog)。fork-only 文件,无需 R4。 |
| `docs/features/claude-code-loop-fix/1-spec.md` | 新增 | spec(R4 复核报告完整) |
| `docs/features/claude-code-loop-fix/2-plan.md` | 新增 | plan(Phase A 诊断结果回填) |
| `docs/features/claude-code-loop-fix/3-changelog.md` | 新增 | 本文 |
| `docs/features/INDEX.md` | +1 行 | feature 索引 |
| `本仓 改动日志.md` | +1 行 | feature 索引 |

## Phase A 诊断结果摘要

诊断手段中途调整(详 [2-plan.md](./2-plan.md)):
- slog.info 写不进任何 log(desktop 启动后停 capture sidecar stderr;sidecar 自己 Path.log 没创建)
- 改用 `fs.appendFileSync` 直写固定文件 `D:\project\opencode-fork\loop-diag.log`,稳定输出

另一个 build 通路问题:`build-deskfox.ps1` 只跑 tauri build(rust wrapper),**不**重 build sidecar binary。tauri.conf.json `externalBin: ["sidecars/opencode-cli"]` 引用的是预 build 产物。要让 prompt.ts 改动进 sidecar,必须先跑 `bun run predev`(`packages/desktop/scripts/predev.ts` → `cd packages/opencode && bun run build` → 拷到 `sidecars/`)。Phase A 诊断花在这个上多次迭代(详见 task #9 — build pipeline 永久 fix 单独 feature 处理)。

诊断数据(loop-diag.log 302 行):

| 字段 | 全 step 一致 | 备注 |
|---|---|---|
| `hasFinish` | **false**(全 302 步) | `lastAssistant.finish` 永远 undefined → 凶手 |
| `lastAssistantPartTypes` | `["step-start","text","step-finish"]` | message 含 `step-finish` part,但 finish 信息没上浮到顶层 |
| `idOrderOk` | true(step ≥ 1) | id 顺序正常 |
| `hasToolCalls` | false | 无未处理 tool calls |
| step 增长 | 0 → 301(45 秒) | 每 ~150ms 一步,无上限保护 |

## 选定的修复路径

**case 1**(详 [2-plan.md](./2-plan.md) Phase A 诊断段):

- plugin emit `finish` event(reason=stop)→ ai-sdk LanguageModelV2 协议层转成 **`step-finish` part**,写进 `assistant.parts`
- opencode 不把 `step-finish` part 的 reason 提升到 `assistant.info.finish` 顶层字段
- 原 break 块查 `lastAssistant?.finish`(顶层),永远 falsy → 永不 break

**修法**:fork-only 兜底块用 `lastAssistantMsg.parts.some(p => p.type === "step-finish")` 替代 `lastAssistant.finish` 顶层判断,前置 guard,原块保留作 fallback。

```ts
// FORK-BEGIN: claude-code-loop-fix — workaround upstream step-loop bug (case 1)
const hasStepFinish = lastAssistantMsg?.parts.some((part) => part.type === "step-finish") ?? false
if (hasStepFinish && !hasToolCalls && lastAssistant && lastUser.id < lastAssistant.id) {
  yield* slog.info("exiting loop (FORK claude-code-loop-fix case-1)")
  break
}
// FORK-END
```

## 验收结果

| 项 | 期望 | 实测 |
|---|---|---|
| 1. 基础对话"你好" | 不卡,▢ 还原 ↑ | ✅ 5-10 秒收口 |
| 2. 多轮对话 | 连续两条消息都正常结束 | ✅ |
| 3. Read 工具 | Claude 调 Read 读 package.json,turn 结束 | ✅ 返回正确 |
| 4. Bash/PowerShell 工具 | Claude 跑 git status,turn 结束 | ✅ 返回分支名 `feat/editable-file-viewer` |
| 5. GetBot 回归 | MiniMax/qwen3 等 provider 不受影响 | ✅(用户验证) |
| 6. debug.log 干净 | short-circuit 行 ≤ 2 | ✅ short-circuit count = 0(原 unbounded spam 完全消除);loop-diag.log 每 turn 仅 2 行(step 0/1 即 break),原 302 行降到 20 行 |

## 影响范围

- **代码**:`packages/opencode/src/session/prompt.ts` 单一文件 +15 行 fork-only FORK 块;原 break 块完全保留作 fallback
- **运行时**:
  - claude-code plugin 用户 — bug 修复 ✓
  - 其他 provider(openai / anthropic 官方 / google / GetBot 等)用户 — 无影响(前置 guard 不进则走原路;hasStepFinish + !hasToolCalls + idOrderOk 三条件严格)
  - sst/opencode 主线行为 — 不变(fork-only 增量,前置 guard 不进则走原逻辑)
- **build 流程**:无变化(本 feature 不动 build pipeline;build pipeline 缺 sidecar 重 build 步骤是另一独立 feature,见 task #9)
- **上游侵入率**:`packages/opencode/` 首次破例,贡献 1 个改动文件;季度 health check 关注

## R4 override 配额

- 改动规则.md 黑名单:`packages/opencode/`(明文"绝对不动")
- override commit message tag:`[override-blacklist: 修上游 sst/opencode step loop case-1 bug,plugin 5 轮证伤,wrapper 不可行]`
- **季度配额**:本次后 = 2/2(满),下次 R4 须等下季度

### R4 复核报告(详 [1-spec.md](./1-spec.md))

- ① wrapper 不可行性:不能 build hook 注入(runtime 决策)/ 不能 monkey-patch(Effect generator 调度)/ 不能 plugin 拦截(opencode 不暴露 session loop 控制点)/ 不能 desktop 拦(只跑 sidecar)/ 不能 patch ai-sdk(改 npm dep 维护成本更高)。R1 第 3 级唯一可行。
- ② 风险评估:中(可接受,fork 自用范围内有限)。详 1-spec.md。
- ③ 改动日志:单文件 +15 行,前置 guard 不替换原块,可单独 git revert。

## 回退方法

```bash
# 完全回退
git revert <commit-hash>

# 或手工删 FORK 块(15 行)
# 找 packages/opencode/src/session/prompt.ts 的 // FORK-BEGIN: claude-code-loop-fix
# 到 // FORK-END,整段删
```

## 走过的弯路 / 中途调整

1. **诊断手段调整**:slog.info 写不进 log(原因详 Phase A 诊断段)。改 fs.appendFileSync 直写固定文件,稳定输出。spec 阶段没预见这点,在 plan 实施时调整。
2. **build pipeline 漏 sidecar 重 build**:`build-deskfox.ps1` 只跑 tauri build,sidecar binary(`packages/desktop/src-tauri/sidecars/opencode-cli-x86_64-pc-windows-msvc.exe`)是预 build 产物,我的 prompt.ts 改动多次没进 sidecar。后续要跑 `bun run predev`(`RUST_TARGET=x86_64-pc-windows-msvc`)→ `cd packages/opencode && bun run build` → dist 拷到 sidecars/ + target/release/。这是 build pipeline 永久 fix,留 task #9 单独 feature 处理。
3. **bun build baseline 包下载失败**:bun-windows-x64-baseline-v1.3.13 下载不完整(疑似 clash 代理 SSL inspection 干扰)。绕过:用 non-baseline 产物 `dist/opencode-windows-x64/bin/opencode.exe`,user CPU 支持 AVX2,兼容性 OK。utils.ts mapping 未来可能改。
4. **凶手定位**:spec 阶段预测 4 个 case,Phase A 实测命中 case 1(`finish` 顶层字段 undefined,但 `step-finish` part 存在)。预设 case 2 修法不适用,实测后调整 fix 用 `hasStepFinish` part 判断。

## 后续(留作 future)

- plugin 侧 `D:\project\deskfox-plugins\claude-code\NOTES.md` 写永久记录:case 1 根因(finish 不上浮 step-finish part)+ fix commit hash + 上游 cherry-pick 回收路径
- 季度 health check 关注 sst/opencode dev 是否新增 prompt.ts 同位置 fix(若有,评估 cherry-pick 替换 fork 块)
- **下季度可考虑**:给 sst/opencode 上提 issue + PR(轨道 1)
- **task #9** build-deskfox.ps1 永久接入 sidecar 重 build 步骤(独立 Tiny feature)

## 验收期间发现的独立 plugin bug(不阻塞本 feature 收尾,单独追踪)

- **task #10**:plugin spawn claude.exe cwd 不读 DeskFox UI 选定的项目目录(用 `process.cwd()` fallback)
- **task #11**:plugin tool-mapping 漏覆盖 docx 编辑场景的 Claude CLI tool name("invalid")
- **task #12**:plugin throw "no user content" — opencode step loop 在 hasStepFinish 命中之前的某 step 给 plugin 传空 prompt(loop-fix case 1 平行切面)
- **task #13**:plugin usage schema 不跟 ai-sdk@6 升级(多轮对话报 `inputTokens.total`)

以上 4 个均归属 plugin 仓 `D:\project\deskfox-plugins\claude-code\` 或 opencode 上游,下次 plugin agent 接手时单独 feature 处理。
