---
feat-id: claude-code-loop-fix
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# claude-code-loop-fix — plan

## 当前位置

**spec 待 user 审签**(R4 必经)。审签前不动一行代码。

签后顺序:阶段 A 诊断 → spec 补充修订(若需要)→ 阶段 B 实施 → 阶段 C 收尾 → commit(单笔)+ push。

## 阶段 A — 诊断(必做先做)

### A.1 复现确认

```powershell
# 1. 杀残留进程 + 清旧日志
Stop-Process -Name DeskFox,OpenCode,opencode-cli -Force -ErrorAction SilentlyContinue
# 注意:不要带 `claude`!user 的 Claude Code CLI 主进程也叫 claude,会误杀当前会话。
# claude-code plugin 是被 opencode-cli 内嵌加载的 npm 模块,杀 opencode-cli 已足够。
Remove-Item -Force -ErrorAction SilentlyContinue D:\project\deskfox-plugins\claude-code\debug.log

# 2. 确认现有 DeskFox 装的是 release(prod)版,且 ~/.config/opencode/opencode.jsonc 里
#    provider.claude-code.npm = file:///D:/project/deskfox-plugins/claude-code/dist/index.js 已就位

# 3. 启动 DeskFox(直接跑老的 release exe 即可,本步未动 fork)
# 4. 新对话,选 Claude Sonnet (via Claude Code),发 "你好"
# 5. 等 5-10 秒"思考中"卡死出现
# 6. 确认 D:\project\deskfox-plugins\claude-code\debug.log 里有连续 short-circuit 行(无限循环)
```

**判定**:卡死 + log 循环 → 复现成功,进 A.2。不复现 → 工单作废,关闭 feature。

### A.2 插临时 debug 日志

文件:`packages/opencode/src/session/prompt.ts`,在 line 1345(`if (` 之前)插:

```ts
// FORK: temp diagnostic 2026-04-29 — claude-code-loop-fix Phase A,完成后阶段 C 移除
yield* slog.info("loop break check", {
  step,
  hasFinish: Boolean(lastAssistant?.finish),
  finish: lastAssistant?.finish,
  isNotToolCalls: lastAssistant?.finish ? !["tool-calls"].includes(lastAssistant.finish) : null,
  hasToolCalls,
  lastUserID: lastUser.id,
  lastAssistantID: lastAssistant?.id,
  idOrderOk: lastAssistant ? lastUser.id < lastAssistant.id : null,
  lastAssistantPartTypes: lastAssistantMsg?.parts.map((p) => p.type),
  toolPartsMeta: lastAssistantMsg?.parts.filter((p) => p.type === "tool").map((p: any) => ({
    metadataProviderExecuted: p.metadata?.providerExecuted,
    topLevelProviderExecuted: p.providerExecuted,
  })),
})
```

加 `// FORK: temp diagnostic 2026-04-29 (R2)` marker(单行 marker 即可,因为是临时测量)。

### A.3 重 build + 跑 + 看日志

```powershell
# 重 build dev env(不出 installer,只产 raw exe 加快迭代)
& D:\project\opencode-fork\packages\branding\scripts\build-deskfox.ps1 -Env dev -NoBundle

# 跑新 exe(路径)
# packages/desktop/src-tauri/target/release/DeskFox.exe

# 触发 bug:发 "你好",等卡死

# 看 sidecar 日志:opencode-cli 的 slog 输出位置
# Windows: %APPDATA%\opencode\log\ 或 ~/.local/share/opencode/log/
# 用 grep 找 "loop break check" 行:
Select-String -Path "$env:APPDATA\opencode\log\*" -Pattern "loop break check"
```

**输出**:每次 doStream 后会有一条 `loop break check` JSON 行,字段值告诉我们 4 项哪项 false。

### A.4 记录诊断结果到本文 + 决定 Phase B 路径

在本文末尾"Phase A 诊断结果"段(空白待填)写:
- 第一次循环各字段值
- 第二次循环各字段值(看 lastUserID 和 lastAssistantID 是否变了)
- 凶手是 case 1/2/3/4 哪个

## 阶段 B — 修复

### B.1 按 A 诊断结果选路径

| 凶手 | 修法 | 估改动 |
|---|---|---|
| **case 1**:`finish` 是 undefined | 兜底块加 `finish !== undefined` 不再硬要求,改成 `(lastAssistant?.finish === undefined || !["tool-calls", "unknown"].includes(lastAssistant.finish))` 同时 `&& !hasToolCalls`(继承原逻辑保留 tool-calls 排除) | ~10 行 |
| **case 2**:`hasToolCalls` 误判 true | 兜底块跳过 hasToolCalls 检查(用 1-spec 里给的现成块) | ~10 行 |
| **case 3**:`lastUser.id < lastAssistant.id` 不成立 | 进一步追查 — 可能 plugin emit 的 message id 时序错;若是,改 plugin 而非 opencode(回退给 plugin agent) | 0(回工单 plugin 侧) |
| **case 4**:都满足但还不 break | 加更多日志找别的早期分支吃掉 break;可能在 line 1366-1390 区间(handleSubtask / compaction 等)| TBD |

### B.2 实施修法(以 case 2 为例)

文件 `packages/opencode/src/session/prompt.ts`,在 line 1345(`if (` 原 break 块)**之前**插:

```ts
// FORK-BEGIN: claude-code-loop-fix — workaround upstream step-loop bug
// 现象:plugin emit finish=stop 后 opencode runLoop 不 break,UI 卡死
// 根因(Phase A 诊断):<填具体根因,如 "ai-sdk providerExecuted 写到顶级而非 metadata">
// 上游 sst/opencode dev 当前未修(2026-04-29 核实)
// 上游若改了删除本块 + tracking 注释即可恢复主线
// 详见 docs/features/claude-code-loop-fix/3-changelog.md
if (
  lastAssistant?.finish &&
  !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
  lastUser.id < lastAssistant.id
) {
  yield* slog.info("exiting loop (FORK claude-code-loop-fix)")
  break
}
// FORK-END
```

**关键**:
- **前置 guard,不替换原块** — 原块完全保留(line 1345-1353 不动),前置 guard 不进时走原路
- **白名单 `["tool-calls", "unknown"]`** — `unknown` 是防御性新增,避免 ai-sdk 协议演进引入新 reason 时炸
- **跳过 hasToolCalls** — 凶手 case 2 的兜底
- **R2 marker 用 FORK-BEGIN/END 多行**(因为是多行 fix,符合改动规则.md)

### B.3 验证

```powershell
# 1. 杀进程 + 清旧日志
Stop-Process -Name DeskFox,OpenCode,opencode-cli -Force -ErrorAction SilentlyContinue
# 注意:不要带 `claude`!user 的 Claude Code CLI 主进程也叫 claude,会误杀当前会话。
# claude-code plugin 是被 opencode-cli 内嵌加载的 npm 模块,杀 opencode-cli 已足够。
Remove-Item -Force -ErrorAction SilentlyContinue D:\project\deskfox-plugins\claude-code\debug.log

# 2. 重 build prod release(本次出正式 exe + installer 给 user 装)
& D:\project\opencode-fork\packages\branding\scripts\build-deskfox.ps1 -Env prod -NoBundle
& "C:\ProgramData\chocolatey\bin\ISCC.exe" "D:\project\opencode-fork\packages\branding\installer\DeskFox.iss"

# 3. user 重装 installer + 跑验收 6 项

# 4. 验完 debug.log
$count = (Get-Content D:\project\deskfox-plugins\claude-code\debug.log -ErrorAction SilentlyContinue | Select-String "short-circuit").Count
Write-Output "short-circuit count: $count (期望 ≤ 2)"
```

**验收 6 项**(详见 [1-spec.md](./1-spec.md) "验收标准"):
- [ ] 基础对话 "你好" 不卡
- [ ] 多轮对话(再发"你的强项是什么")不卡
- [ ] Read 工具调用不卡(让 Claude 读 `D:\project\deskfox-plugins\claude-code\package.json`)
- [ ] Bash 工具不卡(`git status`)
- [ ] 回归 — getbot provider 模型(MiniMax-M2.7、qwen3-coder-480b)依然能用
- [ ] debug.log 干净(short-circuit ≤ 2)

## 阶段 C — 收尾

1. 移除 Phase A 临时诊断日志(line 1345 那段 `loop break check`)
2. 保留 Phase B fix 块(FORK-BEGIN/END + tracking 注释)
3. 写 `3-changelog.md`:
   - 一句话 + commit hash + 改动文件 + Phase A 诊断结果 + 选用 case + 验收 6 项实测结果 + 影响 + 回退
4. 更新 `docs/features/INDEX.md` 把 status 置 done
5. 更新 `改动日志.md` 索引补行

## R4 commit 流程(关键)

按 12-fork-跟随升级与协作规范.md R4:

```bash
# commit message 必须含 [override-blacklist: ...] tag
git commit --no-verify -m "fix(opencode): claude-code plugin step loop 兜底 — workaround upstream bug [feat: claude-code-loop-fix] [override-blacklist: 修上游 sst/opencode step loop 不 break,plugin 5 轮证伤,wrapper 不可行]"
```

**为什么 --no-verify**:packages/opencode/ 在黑名单 hook 拦截范围,改动规则.md 第 5 节明示用 --no-verify + override tag 走 R4 通道。

**配额计算**:本次后季度 override = 2/2(满),下季度才能开新 R4。

## 决策轨迹

| 决策点 | 选 | 理由 |
|---|---|---|
| 修哪儿 | packages/opencode/src/session/prompt.ts | 唯一可行,见 1-spec wrapper 不可行性段 |
| 修法形式 | 前置 guard 不替换原块 | rebase 友好,行为可独立 revert |
| 白名单严格度 | `["tool-calls", "unknown"]` 排除式 | 比 `=== "stop"` 包含式安全(协议演进新 reason 默认 break) |
| 是否跳 hasToolCalls | 跳(workaround case 2) | 本次最可能凶手;Phase A 若否,改 |
| 是否 cherry-pick 上游 PR | 否 | sst/opencode 上没相关 PR;anomalyco 引用是另一个 fork,不适用 |
| 是否同时修 plugin | 否 | plugin 5 轮已对,问题不在 plugin |
| 是否提 sst PR | 本季不做 | 本季先修自用 fork,下季评估;轨道 1 已搁置 |
| 季度配额 | 本季 2/2 后封顶 | 下次 R4 等下季度 |

## 风险与预案

(详细见 [1-spec.md](./1-spec.md) R4 复核报告)

| 风险 | 预案 |
|---|---|
| Phase A 诊断不准 | 必跑 A 不跳;诊断结果回填本文,若否定 case 2 兜底,补改 spec 再实施 |
| 修了还是卡 | 加更细日志(line 1366+ 的 handleSubtask / compaction 早期分支)再追;实在不行考虑加 step 上限(超 N 步直接 break) |
| 误伤多步 agent | 验收 6 项里没多步 agent 测;补一个手测(让 Claude 用 Read + Write + Bash 串行 3 步),通过才算 done |
| rebase 上游冲突 | FORK-BEGIN/END 块独立,rebase 时整段保留或删,不破原块 |

## 预算

| 项 | 行数 |
|---|---|
| `packages/opencode/src/session/prompt.ts` 加 FORK 块 | ~15 行 |
| `docs/features/claude-code-loop-fix/{1-spec,2-plan,3-changelog}.md` | ~600 行(本三文档) |
| `docs/features/INDEX.md` 加索引行 | +1 行 |
| `改动日志.md` 加索引行 | +1 行 |
| **代码增量** | ~15 行 source(1 文件) |

R4 override 单文件改动,Medium 规模(代码 < 50 行,文档 ~600 行)。

## Phase A 诊断结果(2026-04-29 跑完回填)

诊断手段中途调整:slog.info 写不进任何 log(desktop 启动后停 capture sidecar stderr;sidecar 自己 Path.log 没创建)。换成 fs.appendFileSync 直写固定文件 `D:\project\opencode-fork\loop-diag.log`,稳定输出。

另一关键发现:**build pipeline 漏 sidecar 重 build**(详 task #9)。`build-deskfox.ps1` 只跑 tauri build(rust wrapper),sidecar binary 是 `packages/desktop/src-tauri/sidecars/opencode-cli-x86_64-pc-windows-msvc.exe`(预 build 产物),tauri 把它拷到 target/release/。要想让 prompt.ts 改动进 sidecar,必须先跑 `bun run predev`(packages/desktop/scripts/predev.ts → cd packages/opencode && bun run build → 拷到 sidecars/)。Phase A 诊断花在这个上很多迭代。

### 诊断数据(loop-diag.log 302 行汇总)

| 字段 | 第 1 次循环(step=0) | 第 50 次循环(step=49)| 第 300 次循环(step=299) | 备注 |
|---|---|---|---|---|
| step | 0 | 49 | 299 | step 增到 301 仍未 break |
| hasFinish | **false** | **false** | **false** | 永远 falsy → 凶手 |
| finish | undefined | undefined | undefined | message info.finish 字段从未被写 |
| isNotToolCalls | null | null | null | 因 hasFinish=false |
| hasToolCalls | false | false | false | 没工具调用 |
| lastUserID | msg_dd707660f001... | msg_dd707660f001... | msg_dd707660f001... | 同一条 user message |
| lastAssistantID | msg_dd70258ad001... | msg_dd707f5f7001... | msg_dd7082c71001... | 每 step 新建 assistant message |
| idOrderOk | false(step=0)/ true(step≥1) | true | true | step 0 时 last assistant 是 user 之前的 history;step 1+ 是新建的 |
| lastAssistantPartTypes | [] (step=0) / ["step-start","text","step-finish"] (step≥1) | 同上 | 同上 | **关键**:含 step-finish part |
| toolPartsMeta | [] | [] | [] | 无 tool parts |

### 凶手判定:**case 1**

`lastAssistant?.finish` 永远是 undefined。但 message 的 `parts` 数组里**有** `step-finish` part。这意味着:

- plugin emit `finish` event(reason=stop)→ ai-sdk LanguageModelV2 协议层转成 **step-finish part**,写进 `assistant.parts`
- opencode 不把 step-finish part 的 reason 提升到 `assistant.info.finish` 顶层字段
- 原 break 块查 `lastAssistant?.finish`(顶层),永远 falsy → 永不 break
- 每次 doStream 后 streamText 立即结束(plugin short-circuit 返回空 stream + finish=stop),prompt.ts step++ 进下次循环
- 每秒 ~6 步,无上限保护,UI 卡死

### B.1 选定路径

**新 case-1 修法**(不在 plan B.1 表里,从诊断推出):兜底块用 **`step-finish` part 存在 + !hasToolCalls + idOrderOk** 三条件判断。原块完全保留作 fallback。

```ts
// FORK-BEGIN: claude-code-loop-fix — workaround upstream step-loop bug (case 1)
const hasStepFinish =
  lastAssistantMsg?.parts.some((part) => part.type === "step-finish") ?? false
if (
  hasStepFinish &&
  !hasToolCalls &&
  lastAssistant &&
  lastUser.id < lastAssistant.id
) {
  yield* slog.info("exiting loop (FORK claude-code-loop-fix case-1)")
  break
}
// FORK-END
```

**关键设计**:
- `hasStepFinish` 用 part 类型替代 `lastAssistant.finish`(顶层) — 绕过 case 1
- `!hasToolCalls` 保留(防止 ai-sdk 协议演进引入 step-finish 但还有未处理 tool 的情况)
- `lastUser.id < lastAssistant.id` 保留(防止 id 顺序错乱)
- 前置 guard,**不替换原块**;原块保留作 fallback,任何其他 provider 走老路

## 重启后 resume 提示

下次会话接手:
1. 检查 1-spec 是否已被 user 签(看 1-spec.md status 字段是否还是 `spec`,签完后 user 会让你改成 `in-progress`)
2. 如果 spec 已签 → 跑 Phase A;如果没签 → 等
3. Phase A 跑完结果回填本文 "Phase A 诊断结果" 段
4. 按 B.1 表选路径,实施 B.2;验收 B.3
5. 阶段 C 收尾 + commit + push
6. 别忘:本次 R4 用 --no-verify + [override-blacklist: ...] tag,且 commit 后季度配额 2/2 满
