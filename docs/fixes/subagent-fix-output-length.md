# Subagent 输出截断误报成功修正方案

- 状态：实施完成；模块一（Session 截断终态）已提交（`0d75454b2`）；模块二（Task
  前后台失败传播）已提交（`4dada962e`）；模块三（Provider reasoning envelope）已提交
  （`77e509e81`）；CLI 文档和 17 个本地化版本已同步并通过生产构建
- 初稿日期：2026-07-23
- 最近审查：2026-07-25
- 对应问题：仓库外层 `Issue#1.md`
- 影响模块：Provider 输出/reasoning 预算、Session 终态、Task 前后台结果交接
- 源码基线：`34e58090595d`（`packages/opencode/package.json` 版本 `1.17.18`）

## 第一部分：现象与复现

### 1.1 现象

reasoning 模型在单次 provider turn 中耗尽输出额度时，provider 返回
`finish_reason = "length"`。当前实现会结束子 Session 的 agent loop，但不会为
assistant message 设置错误；Task 工具随后丢弃 finish reason 和 token usage，只取最后
一个 text part，并把后台作业登记为成功。

可见结果分两类：

1. reasoning 几乎耗尽全部输出额度，没有 text part：

   ```xml
   <task id="..." state="completed">
   <task_result>

   </task_result>
   </task>
   ```

2. 截断前已经产生部分 text：

   ```xml
   <task id="..." state="completed">
   <task_result>
   未完成的部分结果……
   </task_result>
   </task>
   ```

两类结果都把“不完整”错误地表达成“已完成”。前台 Task 和后台 Task 都受影响。

### 1.2 实证与环境

原问题来自 `glm-5.2` reasoning 模型和 OpenAI-compatible provider。对一次长时间多 subagent
运行中的 4,625 条 `step-finish` 记录统计如下：

| reasoning | output |   合计 | finish reason | 父 agent 所见结果 |
| --------: | -----: | -----: | ------------- | ----------------- |
|    31,994 |      6 | 32,000 | `length`      | 空 `completed`    |
|    31,989 |     11 | 32,000 | `length`      | 空 `completed`    |
|    31,940 |     60 | 32,000 | `length`      | 空 `completed`    |
|    25,653 |    110 | 25,763 | `tool-calls`  | 正常              |
|    22,823 |  5,395 | 28,218 | `stop`        | 正常              |

全部 4,625 条记录中，`reasoning + output` 的最大值恰好是 32,000，从未超过。该上限是
**单次 provider 请求**的 `max_tokens`，不是整个 Session 的累计预算：agent loop 每次
发起新的 LLM round-trip 都重新获得同一个请求上限。

实际故障任务曾在尝试证明一个错误的 Coq 命题时陷入长 reasoning。模型把本次请求的额度
耗尽后，没有剩余 token 报告“命题不可证”；父 agent 随后把空 `completed` 当成可靠结论，
继续建立下游任务。

为排除只依据历史数据库反推的偏差，又在同一源码基线上使用
`packages/opencode/test/lib/cli-process.ts` 启动真实 `opencode run` 子进程，并让本地
OpenAI-compatible SSE provider 返回可控的 `length`。模型声明
`reasoning=true, limit.output=64_000`，修复前的完整链路实测为：

| 观测边界                      | 修复前实测值                                |
| ----------------------------- | ------------------------------------------- |
| provider 收到的 child request | `max_tokens=32_000`                         |
| child assistant               | `finish=length`, `error=null`               |
| child token usage             | `input=512`, `output=0`, `reasoning=32_000` |
| child visible parts           | 无 text part                                |
| parent Task part              | `status=completed`, `error=null`            |
| parent Task output            | 空 `<task_result>`                          |
| 父 agent                      | 收到成功 tool result 后继续下一次 LLM 请求  |
| CLI                           | `exit=0`, `stderr` 为空                     |

该诊断使用当前源码而不是发布版二进制，覆盖
`CLI → provider request → child Session → Task/BackgroundJob → parent Session` 全链路。
诊断测试结果为 `1 pass, 0 fail, 10 assertions`；完整 JSON 证据的 SHA-256 为
`26b0f60e9c73cbd9e0b4c670a41f4332d71ce8d994c89c533692f4d6c6016d62`。
本轮诊断时的临时文件为 `/tmp/opencode-issue1-repro-evidence.json`，它不是仓库资产或后续
测试依赖。
第 1.4 节给出复现结构；第六部分要求把它固化到仓库内的 CLI subprocess 回归测试，而不是
把临时诊断脚本当成长期测试资产。

Issue 中“该环境变量未文档化”的描述相对当前源码已经过时：
`packages/web/src/content/docs/cli.mdx` 已列出
`OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX`，本次需要的是澄清其准确语义，而不是首次增加
该条目。

### 1.3 触发条件与影响范围

需要区分通用的错误语义和原始的空结果表现。

通用的“截断被误报为成功”只需要：

- 单次请求达到 provider 的有限输出额度；
- provider 把终止原因规范化为 `length`；
- 当前 Session 没有把 `length` 规范化为 assistant error；
- 调用方通过 Task 工具消费子 Session 结果。

原始 Issue 中“空 `completed`”还需要以下附加条件：

- 模型或 provider 把 reasoning token 与 visible output token 计入同一个输出额度；
- reasoning 几乎耗尽整个额度；
- 最终 assistant 没有产生 text part。

“没有完整 tool call”是最常见的空结果子场景，但不是本次错误语义的必要条件。完整 tool
call、部分 text 或成功的 StructuredOutput tool 都可能与 `finish=length` 同时出现；本方案
采用严格规则，任何 `length` 都是不完整终态。已经开始或完成的工具副作用不会回滚，因此
错误诊断必须提示检查文件系统/VCS。

当前固定的 `OUTPUT_TOKEN_MAX = 32_000` 显著提高 reasoning 模型触发该问题的概率。
`OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` 可以推迟截断，但不能修复错误的成功状态。

影响不局限于空结果：任何 `finish = "length"` 的可见文本都可能是半截 JSON、代码、
证明或结论，不能作为完整结果继续驱动父 agent。

### 1.4 最小复现用例

#### 真实 CLI 端到端复现

使用现有 `cliIt` fixture 启动真实 CLI 子进程，给 test provider 配置
`reasoning=true, limit.output=64_000`，并按以下顺序排队 provider response：

```ts
// Parent round 1: 发起前台 Task。
yield *
  llm.push(
    reply().tool("task", {
      description: "reproduce output truncation",
      prompt: "REPRO_CHILD_LENGTH: reason internally, then report the result",
      subagent_type: "general",
    }),
  )

// Child round 1: 只有 reasoning，随后达到 32k 并返回 length。
yield *
  llm.push(
    lengthSse({
      reasoning: "CHILD_INTERNAL_REASONING_ONLY",
      usage: { input: 512, output: 0, reasoning: 32_000 },
    }),
  )

// Parent round 2: 基线会在空 completed 之后继续。
yield * llm.push(reply().text("PARENT_CONTINUED_AFTER_SILENT_CHILD").stop())
```

`lengthSse()` 在诊断脚本中用 OpenAI-compatible SSE chunk 明确发送：

```text
delta.reasoning_content = "CHILD_INTERNAL_REASONING_ONLY"
finish_reason = "length"
completion_tokens = 32,000
completion_tokens_details.reasoning_tokens = 32,000
```

运行后通过 `opencode db ... --format json` 读取同一隔离 home 中的 session/message/part，
并同时读取 `llm.inputs` 检查实际 wire request。修复前必须稳定得到第 1.2 节的八项观测。

实施阶段把该诊断收敛为
`packages/opencode/test/cli/run/run-process.test.ts` 中的 `cliIt.live` 回归，使用 fixture
临时目录和独立数据库自动清理。回归必须保留真实 CLI、真实本地 HTTP/SSE 和真实数据库
边界；不能把它降格成只返回手工 `WithParts` 的 Task stub。

CLI 可能并行发起 title 请求，因此“不自动重放 child”按请求 body 中的
`REPRO_CHILD_LENGTH` marker 计数，不能用 provider 总 request 数断言。

为了让该错误传播回归在 Provider 默认值修复后仍能稳定制造同一个有限额度，最终用例显式
设置 `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=32000` 并断言 child wire request 为 32k；
这验证“即使用户主动选择较小上限，length 也不能成为成功”。另由
`test/session/llm.test.ts` 的无 override 用例验证同一个 reasoning model 的新默认 wire 值
是其声明的 64k。两个断言不能合并，否则测试会把“默认预算变大”和“达到任意有限预算后的
错误传播”重新耦合。

#### Session 层复现

在 `packages/opencode/test/lib/llm-server.ts` 的 `Reply` 测试构造器中增加一个仅供测试
使用的 `length()` finish helper，然后在 `packages/opencode/test/session/prompt.test.ts`
中使用现有 test LLM server：

```ts
yield *
  prompt.prompt({
    sessionID: chat.id,
    agent: "build",
    noReply: true,
    parts: [{ type: "text", text: "continue reasoning until capped" }],
  })
yield *
  llm.push(
    reply()
      .reason("long hidden reasoning")
      .usage({
        input: 10,
        output: 32_000,
        reasoning: 32_000,
      })
      .length(),
  )

const result = yield * prompt.loop({ sessionID: chat.id })
```

测试 fixture 中 `usage.output` 继续表示 provider 的总 `completion_tokens`；新增的可选
`usage.reasoning` 写入 `completion_tokens_details.reasoning_tokens`。因此上例在 Session
规范化后应得到 `tokens.output=0, tokens.reasoning=32_000`。

当前实际结果：

```text
result.info.finish == "length"
result.info.error == undefined
```

期望结果：

```text
result.info.finish == "length"
result.info.error.name == "MessageOutputLengthError"
```

同一用例分别以“无 text part”和“有 partial text part”运行。

#### Task 层复现

`packages/opencode/test/tool/task.test.ts` 已有可直接复用的 `reply()`、`stubOps()`、`seed()`
和 Task execute 测试脚手架。在该文件加入以下 helper，并新增独立诊断用例复用现有
execute 结构即可直接编译运行；不要改写或删除既有成功用例：

```ts
function lengthReply(input: SessionPrompt.PromptInput, text?: string): SessionV1.WithParts {
  const result = reply(input, text ?? "unused")
  if (result.info.role !== "assistant") throw new Error("expected assistant reply")
  result.info.finish = "length"
  result.info.tokens = {
    input: 10,
    output: text ? 6 : 0,
    reasoning: text ? 31_994 : 32_000,
    cache: { read: 0, write: 0 },
  }
  if (!text) result.parts = []
  return result
}

const promptOps: TaskPromptOps = {
  ...stubOps(),
  prompt: (input) => Effect.succeed(lengthReply(input)),
}
```

当前实际结果：

```text
Task Effect 成功
BackgroundJob.status == "completed"
Task output 包含 state="completed" 和空 task_result
```

期望结果：

```text
Task Effect 失败
BackgroundJob.status == "error"
错误信息包含 finish=length、reasoning/output token 统计和“没有可见输出”
```

再用 `lengthReply(input, "partial response")` 运行 partial text 变体，期望仍然失败。完整
partial text 保留在子 Session；Task 错误只携带有界 visible-text 摘录和子 Session ID。
若该变体还要断言 durable transcript，测试 stub 必须在返回前通过 `Session.Service`
持久化 assistant message/parts；仅返回内存 `WithParts` 只能验证 Task 分类和格式化。

### 1.5 出错代码路径

请求侧：

```text
packages/opencode/src/provider/transform.ts:18
  OUTPUT_TOKEN_MAX = 32_000
    ↓
packages/opencode/src/provider/transform.ts:1345-1346
  maxOutputTokens() = min(model.limit.output, 32_000)
    ↓
packages/opencode/src/session/llm/request.ts:129
  chat.params.maxOutputTokens
    ↓
packages/opencode/src/session/llm/native-request.ts:140
  maxTokens
    ↓
provider API: max_tokens = 32_000
```

终态与 Task 交接：

```text
provider finish_reason = length
    ↓
packages/opencode/src/session/processor.ts
  assistantMessage.finish = "length"
  step-finish 落库
    ↓
packages/opencode/src/session/prompt.ts:1295-1317
  length 被视为 finished，但只有 content-filter 被转为 error
    ↓
Session loop 结束，返回 finish=length / error=undefined
    ↓
packages/opencode/src/tool/task.ts:186-199
  runTask() 丢弃 info.finish / info.error / info.tokens
  只返回最后 text 或 ""
    ↓
packages/core/src/background-job.ts
  Effect 成功返回字符串，因此 status=completed
    ↓
packages/opencode/src/tool/task.ts:231-236 / 308-320
  前后台都向父 Session 报告 completed
```

### 1.6 预期行为与实际行为

| 场景                                     | 当前行为                                     | 预期行为                                                    |
| ---------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `length` 且无 text                       | 空 `completed`                               | 失败，明确说明没有可见输出                                  |
| `length` 且有 partial text               | partial text 被当作完整结果                  | 失败，保留并标记 partial text                               |
| 上一轮 tool 已完成，下一轮报告 `length`  | 副作用保留，但截断报告仍可能成为 `completed` | 工具只执行一次，不发第三次 child 请求并报告失败             |
| `length` 且 StructuredOutput tool 已成功 | structured 快捷路径可报告成功                | `length` 优先，仍报告失败                                   |
| 正常 `stop`                              | `completed`                                  | 保持 `completed`                                            |
| 用户显式设置输出上限                     | 作为上限使用                                 | 保持该语义                                                  |
| reasoning 模型未显式设置上限             | 默认仍被压到 32k                             | 使用模型声明的输出上限                                      |
| 已知 provider 的 numeric `max` variant   | 固定旧预算或与本次输出 envelope 脱节         | 以 10%/4,096 为请求级 headroom 目标，并遵守 provider bounds |
| effort/adaptive/thinking-level variant   | provider-native 定性控制                     | 保持原值，不伪造 numeric budget                             |
| non-reasoning 模型未显式设置上限         | 默认最多 32k                                 | 保持不变                                                    |

## 第二部分：根因分析

### 2.1 根因一：默认输出预算没有区分 reasoning 模型

`ProviderTransform.maxOutputTokens()` 对所有模型执行：

```text
min(model.limit.output, 32_000)
```

对于 `limit.output = 131_072` 的 reasoning 模型，实际请求仍为 32k。reasoning 与
visible output 共享额度时，模型可以先耗尽 reasoning budget，物理上没有剩余额度输出
最终答复。

这是截断高频发生的原因，但不是静默成功的充分原因。即使把额度提升到 131k，任何
有限额度仍可能被耗尽。

### 2.2 根因二：Session 把 `length` 当作终止，却不当作错误

`processor.ts` 在 `step-finish` 中先把 `finish` 和 token usage 写入 assistant message，
但没有在 `reason === "length"` 时同步设置 error。`prompt.ts` 的 `finished` 判定排除的
只有 `tool-calls` 和 `unknown`，随后只有 `content-filter` 被显式转换成 session error，
`length` 没有对应分支。

最终形成非法语义组合：

```text
finish = "length"
error = undefined
```

仓库其实已经定义了正确的错误契约：

- `packages/core/src/v1/session.ts`：`MessageOutputLengthError`
- `packages/schema/src/v1/session.ts`：对应 schema
- `packages/opencode/src/session/message-error.ts`：legacy/shared error
- `packages/opencode/src/acp/service.ts`：映射为 `stopReason = "max_tokens"`

缺失的是 `finish = "length" → MessageOutputLengthError` 的生产者。

如果只在 `prompt.ts` 的 process 返回之后补 error，还存在两个遗漏：

1. `finish` 已落库、prompt 尚未补 error 时进程退出，重启后的 loop 会在顶部终态检查直接
   break，留下持久化的非法组合；
2. Session compaction 直接调用 `SessionProcessor`，不经过普通 prompt 的终态分支。截断
   summary 会满足 `summary && finish && !error`，可能被当成完整 compaction 继续使用。

因此错误生产必须前移到 `SessionProcessor` 的 `step-finish`，使 `finish` 和 `error` 在
同一次 assistant message 更新中持久化；`prompt.ts` 只负责让该错误优先于 structured
success 快捷路径。

### 2.3 根因三：Task 把带状态的结果降格为字符串

`TaskPromptOps.prompt()` 返回完整 `SessionV1.WithParts`，其中包含：

```text
info.finish
info.error
info.tokens
parts
```

`runTask()` 却只返回：

```ts
result.parts.findLast((item) => item.type === "text")?.text ?? ""
```

因此 Task 边界丢失所有终态信息。BackgroundJob 只能依据 Effect 的成功/失败判定状态；
字符串 `""` 仍是成功值，所以它只能登记 `completed`。

该根因不只影响 output length。Session 当前已经可以产生 `ContentFilterError`、
`ContextOverflowError`、`APIError`、`ProviderAuthError` 等 assistant error，Task 同样会
忽略它们。若只对 length 加特殊判断，会修复 Issue #1 的症状，却保留“assistant error 被
降格为成功字符串”的同类根因。

### 2.4 相关风险：reasoning budget 与输出上限的关系

Issue 的补充分析基于较早的统一 `budgetVariants()` 实现，提出 A2：thinking budget 必须
相对最大输出额度为 visible answer 预留 `N` 个 token。当前源码基线已经把 reasoning
variant 逻辑拆到多个 provider 分支，不再存在统一 `budgetVariants()`：

- Anthropic/Gateway/Bedrock/SAP 等分支仍有 16,000 / 31,999 的固定预算；
- Google 2.5 使用自己的 24,576 / 32,768 上限；
- GLM 5.2 只有 reasoning effort，没有可表达的 numeric budget。

在当前代码中，A1 把 `maxOutputTokens` 从 32k 提升到模型声明上限后，对于
`limit.output > 32k` 的模型，现有 31,999 budget 会自然留下更多 visible headroom；但这也
意味着 numeric `max` variant 仍停留在旧的 32k 量级，没有随本次请求的有效输出 envelope
扩展。反过来还有两个安全风险：

1. `limit.output == 32k` 且 budget=31,999 时只剩一个 visible token；
2. 用户显式 `outputTokenMax` 小于 provider variant budget 时，二者可能不匹配。

本修复把这两个风险纳入范围，但不假设所有 reasoning 模型都有 numeric budget。实施规则为：

- 支持 numeric budget 的已知 provider 上、名为 `max` 的 variant，根据**本次请求的 core
  max output**动态计算；
- 以 10% 且不少于 4,096 token 作为请求参数级 visible-output headroom 目标；
- provider 有独立 numeric 上限时再执行 provider cap；
- `high`、自定义 numeric budget 不自动提高，只在超过安全上界时向下 clamp；
- effort/adaptive/thinking-level 模型保持 provider-native 控制，不伪造 token 换算。

因此 A1 与 A2 共享同一个运行时 `core max output`，但分别落在
`maxOutputTokens()` 和 request options normalization，而不是恢复一个并不存在的统一
`budgetVariants()`。

### 2.5 根因与症状的区分

- “空字符串”只是 reasoning 几乎耗尽额度时的一个症状；
- “32k 太小”是提高触发概率的预算问题；
- 真正破坏多 agent 正确性的根因是：截断状态没有从 provider/session 端到端传播到
  Task/BackgroundJob。
- 既有固定 31,999 thinking budget 是相关的 provider 策略风险；本次只对可识别的 numeric
  控制按安全 envelope 调整，它仍不是 Issue #1 中静默 `completed` 的必要条件。

只提高 token 上限属于延迟故障，不是完整修复。

## 第三部分：参考实现对照

### 3.1 对照对象

本机安装的 Claude Code：

```text
版本：2.1.218
路径：/home/yixiao/.local/share/claude/versions/2.1.218
形态：Bun 编译的 ELF；从内嵌 minified JavaScript 还原相关控制流
SHA-256：e12071751a9336b8af1012c103358ff04ac18f9aaff4a738cff7ba5cdfaf63f2
```

以下结论来自对该固定二进制中内嵌 minified JavaScript 的控制流分析，不把本机旧
`claude-code` 源码副本当作最新版实现。

### 3.2 Claude Code 2.1.218 的处理链

Claude Code 仍可能收到 `stop_reason = "max_tokens"`，但会：

1. 转换成显式 `apiError = "max_output_tokens"`；
2. 尝试续接不完整 thinking，或插入“从截断处继续”的 meta message；
3. 最多自动恢复三次；
4. 恢复耗尽后返回 `reason = "api_error"`；
5. Agent 生命周期把最后的 API error 转成 `AgentApiErrorTerminationError`；
6. 前台 Task 失败；
7. 后台 Task 标记 `failed`，并尽量附带最后一个非 API-error 的 partial output。

因此 Claude Code 仍可能发生截断，但不会把它静默表示成空 `completed`。

使用与本问题相同的终态输入对照：

| 输入场景                      | 当前 opencode          | Claude Code 2.1.218                    | 本修复                                |
| ----------------------------- | ---------------------- | -------------------------------------- | ------------------------------------- |
| 达到输出上限，无 visible text | 空 `completed`         | 自动恢复；耗尽后失败                   | 立即失败，注明无 visible output       |
| 达到输出上限，有 partial text | partial 被当成完整结果 | 自动恢复；耗尽后失败并保留最后 partial | 失败，保留子 Session 全文并附有界摘录 |
| 达到输出上限，后台 Task       | 后台 `completed`       | 后台 `failed`                          | 后台 `error`                          |
| 正常 `stop`                   | `completed`            | 完成                                   | 保持 `completed`                      |

### 3.3 本次采用与不采用的部分

本次参考 Claude Code 的重点不是照搬其实现，而是区分两类能力：

```text
状态正确性：
  截断发生后，系统能否如实记录并传播“任务未完成”

自动恢复能力：
  截断发生后，系统是否自动发起 continuation 并尝试完成任务
```

Issue #1 首先破坏的是状态正确性：子任务已经截断，却被报告成 `completed`。因此本次采用
Claude Code 的状态传播原则，但不把自动恢复能力纳入同一个修复。

#### 3.3.1 在 Session 终态处识别截断

provider 返回的 `finish_reason = "length"` 是物理停止原因，表示输出额度已耗尽，并不表示
任务目标已经完成。该信号规范化进入 assistant message 后，Session 同时拥有：

- `finish`；
- `error`；
- token usage；
- 已经落库的 reasoning、text、tool 和 step parts；
- agent loop 是否应继续的控制权。

因此 Session 是把 provider 停止原因转换为业务终态的最近公共边界。修复后同时保留：

```text
finish = "length"
error.name = "MessageOutputLengthError"
```

`finish` 回答“模型为什么停止”，`error` 回答“本次执行在业务上是否成功”，两者不能互相
替代。

具体生产位置是共享的 `SessionProcessor.step-finish`，而不是只在普通 prompt 退出前补写。
这样 finish/error 在同一次 assistant message 更新中持久化，普通 Session 与 compaction
都会得到相同语义，并关闭 finish 已落库、error 尚未落库的 crash window。

如果只在 Task 层临时抛错，会留下两个漏洞：

1. 不经过 Task 的普通 Session 仍会保存 `finish=length ∧ error=undefined`；
2. 错误没有持久化，Session 被重新读取或进程恢复后仍然表现为无错误终态。

#### 3.3.2 截断必须是显式失败

Claude Code 值得采用的关键性质不是“会重试”，而是恢复失败后不会继续报告成功。opencode
当前的错误链路是：

```text
finish=length
  → Session 没有设置 error
  → Task 只提取 text 或空字符串
  → Effect success
  → BackgroundJob completed
```

本次修复必须把链路改为：

```text
finish=length
  → MessageOutputLengthError
  → Task Effect failure
  → BackgroundJob error
```

即使截断前的文本表面上像一句完整结论，也不能推断任务已完成。后续被截掉的内容可能是：

- 尚未执行的修改或测试；
- 尚未报告的风险；
- 未闭合的 JSON、代码块或结构化输出；
- 未完成或尚未发出的 tool call。

provider 已明确声明输出因额度耗尽而终止，该机器可判定信号必须优先于对文本语义完整性的
主观猜测。

#### 3.3.3 partial output 的语义

截断前已经生成的 text 仍然有诊断和恢复价值，可以说明子 agent 调查到哪里、哪些文件可能
已经修改，以及下一次是否可以利用已有进度。因此本次不丢弃 partial output。

完整 partial output 保留在子 Session transcript 中；父 Task 的失败诊断只附带受
line/byte 上限约束的 visible-text excerpt：

```text
任务未完成：output limit reached
文件系统或 VCS 中可能存在部分修改，需要先检查

Partial output excerpt:
...
```

不能继续把它包装成：

```xml
<task state="completed">
  <task_result>...</task_result>
</task>
```

前一种表达表示“执行失败，内容只能辅助排查或恢复”；后一种表达表示“内容是完整、可靠的
任务结果”。Issue #1 的核心错误正是混淆了这两种语义。

无 text part 时也必须明确写出 `No visible output was produced`，避免空结果掩盖 reasoning
已经耗尽额度这一事实。reasoning part 的正文不复制到 Task 错误，只报告 token 数；父 agent
可使用子 Session ID 检查持久化的 visible partial 和文件系统状态。

#### 3.3.4 前台与后台共享同一失败语义

Task 可以前台等待，也可以后台运行。两条路径最终都依赖 BackgroundJob 根据 Effect exit
决定状态：

```text
Effect success       → completed
Effect failure       → error
Effect interruption  → cancelled
```

因此只返回一段描述错误的成功字符串不够，`runTask()` 必须真正以 Effect failure 结束。
这样同一个 length 截断才能稳定映射为：

```text
前台 Task：
  工具执行失败

后台 Task：
  BackgroundJob.status = error
  后台通知 state="error"
```

要保持的不变量是：

```text
只要子 Session 因 output length 截断，
无论 Task 采用前台还是后台方式，都不能得到 completed。
```

#### 3.3.5 本次不采用自动续写或请求重放

Claude Code 会对 `max_output_tokens` 尝试 continuation，改善了完成率，但这不只是“再请求
一次”。agent loop 中可能已经发生文件修改、命令执行或外部工具调用；自动重放需要解决：

- 非幂等工具副作用是否会重复；
- 截断前的 tool call 是否已经完整发送或开始执行；
- 半个流式 tool call / JSON 参数应该续接、丢弃还是重新生成；
- continuation 最多执行几次以及每次使用多少预算；
- 再次达到上限、用户取消、超时和进程重启时的终态；
- 重试产生的 token、费用和后台任务时间如何统计；
- durable Session 恢复时如何判断上一次 continuation 的完成边界。

##### 可复现实例：副作用已经提交，随后才发生 length

使用 `packages/opencode/test/lib/cli-process.ts` 的真实 CLI 子进程和本地
`TestLLMServer`，可以把截断点稳定放在已完成工具调用之后。子 Task 的目标是“追加且只追加
一条扣费记录，然后报告完成”，以文件追加模拟不可幂等的外部副作用：

```ts
const append = {
  command: `printf 'charged\\n' >> '${home}/side-effect.log'`,
  description: "Record one non-idempotent side effect",
}

yield * llm.push(parentTask())
yield * llm.push(reply().tool("bash", append))
yield * llm.push(lengthAfterCommittedTool())
yield * llm.push(reply().text("PARENT_FINISHED").stop())
```

`lengthAfterCommittedTool()` 不与 tool call 混在同一个不确定的流边界，而是在 Bash tool
result 已经写回子 Session 后，模拟下一次“生成最终报告”的 provider round：

```text
delta.content = "The charge was recorded; preparing the final report..."
finish_reason = "length"
completion_tokens = 32,000
```

真实执行顺序为：

```text
child round 1:
  Bash append 成功
  → side-effect.log 已持久化一行 "charged"
  → tool result 已写回 Session

child round 2:
  开始生成最终报告
  → finish=length
```

基线运行结束后，文件内容是：

```text
charged
```

这说明 `finish=length` 只能改变会话终态，不能回滚更早 provider round 已经完成的文件、
命令或外部系统副作用。

接着模拟最朴素的自动恢复策略：看到截断结果后，不建立 durable checkpoint，而是重新运行
原始 Task。第二个 child Session 收到相同 prompt，再次生成相同 Bash 操作，但使用新的
assistant message 和 tool call ID：

```ts
// 第一次 Task：副作用提交，报告被截断
yield * llm.push(parentTask())
yield * llm.push(reply().tool("bash", append))
yield * llm.push(lengthAfterCommittedTool())

// 朴素恢复：重放原始 Task
yield * llm.push(parentTask())
yield * llm.push(reply().tool("bash", append))
yield * llm.push(lengthAfterCommittedTool())
```

重放后文件内容稳定变为：

```text
charged
charged
```

两次 Bash 调用在协议上都是合法的新 tool call；当前没有跨 Session 的业务幂等键可以判断
它们都表示同一次扣费。真实 CLI 诊断运行的两个用例结果为：

```text
基线：   exit=0，file="charged\n"
重放：   exit=0，file="charged\ncharged\n"
测试：   2 pass，0 fail
```

文件追加只是安全替身；同一风险适用于数据库 `INSERT`、Git commit、发送消息、创建工单、
扣费 API 和部署发布。

该例不证明所有精心设计的 continuation 都必然重复副作用，而是证明：**没有持久化的完成
边界、幂等键和 tool-call 对账规则时，系统无法保证自动续写或请求重放不会重复副作用。**
即使 continuation 使用原 Session 并附加“不要重复已完成工作”的自然语言指令，新的 tool
call ID 也不能证明业务操作不同，模型遵循该指令也不是执行层幂等保证。

安全 continuation 至少需要记录已完成 tool input/result、副作用 checkpoint、partial tool
call 状态和恢复起点，并处理“工具成功后、状态落库前崩溃”等边界。这已经是独立的 durable
恢复状态机，不是给 provider 多发一次请求。

例如截断可能发生在 tool call 参数中间：

```json
{
  "path": "src/session/prompt.ts",
  "patch": "*** Begin Patch...
```

此时直接要求模型“继续”无法证明工具是否会收到一次完整调用，也无法证明重新生成不会重复
已经执行的副作用。

所以本次明确：

- 不实现自动续写；
- 不自动重放 provider 请求；
- 不增加 continuation 次数、恢复消息或 durable retry 状态。

这些能力需要独立设计其幂等性、tool call 完整性和恢复状态机，不能作为错误传播修复的隐含
副作用。

#### 3.3.6 按模型能力调整 provider-specific reasoning budget

部分 provider 支持独立的 thinking budget、reasoning effort 或 reasoning token 配额。
opencode 同时支持 Anthropic、OpenAI、Google、GitHub Copilot、Cloudflare 及兼容 API，
不能把一个数字写进所有 provider；本次改为“共享安全 envelope、按能力选择表达方式”：

- numeric budget：按本节公式动态计算或 clamp；
- effort/adaptive/thinking-level：保持原生定性控制；
- 未知 numeric 协议：不自动提高，只允许安全向下 clamp；
- 没有 reasoning 控制：不新增字段。

##### 统一安全 envelope

计算必须基于本次请求的 core max output `E`，不能直接基于 `model.limit.output`。否则
`model.limit.output=131,072`、显式 `outputTokenMax=32,000` 时会错误地产生约 118k 的
thinking budget。

```text
E = maxOutputTokens(model, RuntimeFlags.outputTokenMax)

desiredVisibleReserve = max(4,096, ceil(E × 10%))
safeNumericBudgetCap  = E - desiredVisibleReserve
```

当 provider minimum 允许时，请求参数满足：

```text
numeric thinking budget ≤ 90% × E
configured visible-output headroom = E - numeric thinking budget
configured visible-output headroom ≥ 10% × E
configured visible-output headroom ≥ 4,096
```

当 provider 另有 `providerNumericMax` 时：

```text
effectiveNumericMax = min(safeNumericBudgetCap, providerNumericMax)
```

这里的 headroom 是 OpenCode 对 wire request 参数的约束，不是模型实际 visible output 的
下限。provider 可以把 numeric budget 解释为目标、上限或建议值，模型也可能提前停止或把
剩余额度继续用于可见答案；所以本方案不承诺一定产生对应数量的 visible token。

这里的 `E` 明确定义为**本次请求的 provider 总输出 envelope**（thinking + visible），
不是无条件等于传给 AI SDK 的标准化 `maxOutputTokens` 参数。实现阶段的真实 wire 测试发现，
`@ai-sdk/anthropic`（Vertex Anthropic 复用同一实现）和
`@ai-sdk/amazon-bedrock` 的 Anthropic thinking 路径会在序列化时执行：

```text
provider total max = SDK maxOutputTokens + numeric thinking budget
```

因此设归一化后的 numeric budget 为 `B`，对这些已确认会自动加回 budget 的 transport，
核心必须传入 `S = E - B`；SDK 加回 budget 后的候选值为 `S + B = E`。其他 transport（例如 Google，
以及直接把标准化参数映射为总 output cap 的 SAP 路径）仍传 `S = E`。这一步是 transport
适配，不改变 `maxOutputTokens(model, ...)` 返回的 core envelope，也不改变 overflow 使用的
`E`。否则示例中的 `E=131,072、B=117,964` 会错误地产生
`wire max_tokens=249,036`；旧实现的 `63,999` 同样来自 `32,000 + 31,999`，不是正确的
32k 总上限。

`S+B=E` 描述的是 core 交给 transport 的算术关系；若 SDK 还掌握一个更小的内建模型 cap，
它可以继续把最终 wire 值向下 clamp，因此无条件不变量是 provider total max `≤E`，不是
所有模型都必须在 wire 上精确等于 `E`。

Anthropic/Vertex-Anthropic SDK 还有一个隐式分支：`thinking.type="enabled"` 但
`thinking.budgetTokens` 缺失时，SDK 会补默认 budget 1,024 后再做加法。核心不为此改写
options，但 transport adapter 必须把 `B` 视为 1,024；若 `E<=1,024`，normalization 在
发送前本地失败。这样既保留 SDK 的默认参数语义，又维持 total envelope。

##### provider minimum 与小输出上限

请求合法性优先于 headroom 目标。对已知 `providerNumericMin`，归一化按以下顺序处理：

```text
wireNumericMax = min(providerNumericMax ?? +∞, E - 1)

若 providerNumericMax < providerNumericMin：
  请求准备失败；provider bounds 自相矛盾

若 E <= providerNumericMin：
  请求准备失败；不存在同时满足 budget >= providerNumericMin 与 budget < E 的值

若 safeNumericBudgetCap >= providerNumericMin：
  使用正常的 safe cap

若 safeNumericBudgetCap < providerNumericMin < E：
  max variant 使用 providerNumericMin
  high/custom 的合法已有值最多向下 clamp 到 providerNumericMin
  接受 configured headroom 小于 10%/4,096
```

`high`/custom 的已有 numeric 值若非正数、低于已知 provider minimum，或无法通过只向下
clamp 得到 `0 < budget < E` 的合法值，则请求准备直接失败，不把必然非法的请求交给
provider，也不为了“修复”用户配置而向上提高该值。未知 provider minimum 时不猜测数字：
已有值合法则保留或只向下 clamp；无法证明 `0 < budget < E` 时同样本地失败。

失败使用请求准备阶段的普通配置 `Error`，错误文本包含 provider/model、`E`、已知
minimum/maximum 和选中的 variant；它通过既有 Session 错误管线传播，不新增公开错误
schema。这样可以区分“模型正常运行后耗尽长度”和“请求参数本身不存在合法组合”。

当前内置 Anthropic variant 还存在一个必须同时修复的 catalog 边界：
`model.limit.output == 0` 时直接用该值计算 `high/max` 会得到 `-1`。目录阶段生成内置
variant 时必须先使用：

```text
catalogOutput = model.limit.output > 0 ? model.limit.output : OUTPUT_TOKEN_MAX
```

再生成静态初值；请求阶段仍以本次 `E` 做最终 normalization。这个 fallback 只避免目录中
产生非法负 budget，不代替 RuntimeFlags 感知的运行时计算。

##### variant 与显式配置的优先级

预算归一化发生在 `packages/opencode/src/session/llm/request.ts`：

```text
合并 base options
  → model.options
  → agent.options
  → selected variant
  → 使用 core max output 归一化 numeric budget
  → 对会自动加回 budget 的 transport 计算 SDK maxOutputTokens = E - budget
  → chat.params plugin hook 最终覆盖
```

具体规则：

1. 已知 provider 上名为 `max` 的 numeric variant 使用 `effectiveNumericMax`，可以相对旧的
   31,999 自动提高，也可以在显式输出 cap 较小时向下调整；这是 variant 名称的请求时契约，
   不依赖无法保留到 request 阶段的“内建/用户覆盖”来源信息；
2. `high`、用户自定义 numeric budget 不自动提高，只在超过
   `safeNumericBudgetCap/providerNumericMax` 时向下 clamp；非法低值本地失败；
3. 显式 `outputTokenMax` 决定 `E`，优先于 numeric budget 偏好；
4. plugin hook 保持最终决定权，可以在归一化后删除或替换 `maxOutputTokens/options`；
5. small-model 请求沿用现有“跳过 selected variant”语义，传给 helper 的 active variant
   必须为 `undefined`，不能因用户原本选择了 `max` 而在 small 请求中合成 numeric max；
6. helper 必须返回新对象，不能修改 `model.variants`、`model.options` 或 agent 配置。

第 4 条中的 `maxOutputTokens` 是交给具体 transport 的 SDK 参数：通常等于 `E`；在已确认
会自动加回 numeric budget 的 Anthropic/Vertex-Anthropic/Bedrock-Anthropic transport 上
等于 `E - B`。plugin 仍在该适配之后运行，并对这个最终 SDK 入参拥有覆盖权。

这一区分避免把用户的 `high` 或自定义名称下的 8k budget 擅自提高到 90%，同时让语义明确
为 `max` 的 variant 真正使用扩大后的输出能力。用户若需要固定 numeric budget，应使用
非 `max` 的自定义 variant；该值仍受安全上界向下 clamp。

##### provider/model 分流

当前 `ProviderTransform.variants()` 和 GitHub Copilot 动态模型目录产生的关键结构如下：

| provider/model                           | 控制形状                             | 本次规则                                                                                                     |
| ---------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 旧式 Anthropic direct / Vertex / Gateway | `thinking.budgetTokens`              | `max` 使用安全 envelope；minimum 1,024；direct/Vertex transport 传 `E-B`，Gateway 保持自己的标准化语义       |
| Anthropic on Bedrock                     | `reasoningConfig.budgetTokens`       | 同上；SDK 入参传 `E-B`，序列化加回后总上限为 `E`                                                             |
| Anthropic on SAP                         | `modelParams.thinking.budget_tokens` | 同上，保留 SAP 包装                                                                                          |
| Gemini 2.5                               | `thinkingConfig.thinkingBudget`      | 安全 envelope 后再 clamp 到模型范围；Pro 128..32,768，Flash active numeric 1..24,576，Flash-Lite 512..24,576 |
| GitHub Copilot numeric model             | `thinking.budgetTokens`              | 以动态目录已编码的 `max` variant 值作为请求时上界；不从 `limit.output` 猜 cap                                |
| OpenAI-compatible / GLM 5.2              | `reasoningEffort`                    | 原样保留，不换算 token                                                                                       |
| 新版 Claude                              | adaptive thinking + `effort`         | 原样保留                                                                                                     |
| Gemini 3                                 | `thinkingLevel`                      | 原样保留                                                                                                     |
| Amazon Nova                              | `maxReasoningEffort`                 | 原样保留                                                                                                     |
| 未知 custom numeric shape                | 已有 numeric value                   | 不提高；能识别安全上界时只向下 clamp                                                                         |

支持的 numeric 路径至少包括：

```text
thinking.budgetTokens
thinking.budget_tokens
thinkingConfig.thinkingBudget
reasoningConfig.budgetTokens
modelParams.thinking.budget_tokens
modelParams.thinkingConfig.thinkingBudget
```

不递归改写任意名为 `budget` 的未知字段，避免碰到计费、task budget 或 provider 私有参数。

`providerNumericMax` 的来源优先级固定为：

1. provider 实时模型能力；GitHub Copilot 的远端 `max_thinking_budget` 当前在
   `plugin/github-copilot/models.ts` 中被编码为所选 `max` variant 的
   `thinking.budgetTokens`，request 阶段以这个已有值作为保守上界；
2. 官方公布且能按 API model ID 稳定匹配的静态范围，例如 Gemini 2.5 Pro
   128..32,768、Flash 0..24,576、Flash-Lite 512..24,576；本方案的 active numeric
   variant 仍要求正整数，因此 Flash 的 active 下限按 1 处理，`0` 的“禁用 thinking”语义
   不由 numeric `max/high` normalizer 合成。范围来源见
   [Gemini 2.5 thinking budget](https://ai.google.dev/gemini-api/docs/generate-content/thinking)；
3. provider 协议约束，例如 manual Anthropic 要求 `budget_tokens < max_tokens`，见
   [Claude extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
   和
   [Amazon Bedrock extended thinking](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-extended-thinking.html)；
4. 无可靠来源时不得从 `model.limit.output` 猜出独立 provider cap，也不得自动提高。

Copilot 远端的 `min_thinking_budget` 当前没有保存在通用 `Provider.Model` 中，本次不为此
扩展 models.dev 或公共模型 schema。因此不能在 request 阶段声称仍持有远端 minimum：
动态目录生成 `max/high` 时仍必须使用当次远端 min/max：

```text
discoveredCap = floor(max_thinking_budget) - 1
discoveredMin = max(1, ceil(min_thinking_budget ?? 1))

若 discoveredCap < discoveredMin：
  不暴露 numeric high/max variant

否则：
  max  = discoveredCap
  high = clamp(floor(max_thinking_budget / 2), discoveredMin, discoveredCap)
```

这样 remote min 在丢失前已经保证 catalog 初值合法。若显式 `E` 迫使 request helper 把
它继续降到一个无法证明满足 remote min 的范围，则本地报告配置不兼容，而不是猜测
minimum 或等待远端 400。

`Provider` 当前会把用户配置的 variants 深度合并到 Copilot 动态目录，若不加保护，用户可
在合并时覆盖并丢失远端 max。为避免新增模型字段，合并 Copilot 配置前先读取动态目录原始
`variants.max.thinking.budgetTokens`，合并后：

1. 恢复 `max` variant 的该值，使 request 阶段仍能把它当作可信远端 cap；
2. 所有用户 `high`/custom numeric variant 最多 clamp 到这个 cap；
3. 固定的较小预算必须使用非 `max` 名称；`max` 名称始终表示动态最大策略。

这项保护只应用于已由 Copilot 远端目录提供可信 max 的模型，不改变其他 provider 的通用
variant merge 语义。

##### 具体计算示例

| 场景                                      |     `E` | 目标 headroom |         provider bounds |                    结果 |
| ----------------------------------------- | ------: | ------------: | ----------------------: | ----------------------: |
| Anthropic numeric `max`，模型输出 131,072 | 131,072 |        13,108 |          无独立数字 cap |                 117,964 |
| Anthropic numeric `max`，输出 32,768      |  32,768 |         4,096 |          无独立数字 cap |                  28,672 |
| 同一 131,072 模型，显式 cap 32,000        |  32,000 |         4,096 |          无独立数字 cap |                  27,904 |
| Gemini 2.5 Pro，输出 65,536               |  65,536 |         6,554 |                  32,768 |                  32,768 |
| Anthropic numeric `max`，显式 cap 4,000   |   4,000 |         4,096 |           minimum 1,024 | 1,024；目标降级为 2,976 |
| Anthropic numeric `max`，显式 cap 1,024   |   1,024 |         4,096 |           minimum 1,024 |            本地配置失败 |
| GLM 5.2 `max`                             | 131,072 |        不适用 | `reasoningEffort="max"` |              不生成数字 |

对表中 Anthropic direct 的前三个 numeric 场景，传给 SDK 的标准化
`maxOutputTokens` 分别为 13,108、4,096 和 4,096，SDK 加回 budget 后的 wire
`max_tokens` 分别为 131,072、32,768 和 32,000。Gemini transport 不执行该加法，所以
仍直接传 `S=E`。

GitHub Copilot 是当前自动发现 numeric thinking bounds 的已知实例：
`max_thinking_budget/min_thinking_budget` 来自远端模型能力，但当前只有 max 被编码进
variant 并可作为 request-time cap；Gemini 2.5 的范围来自静态 model family 规则；通用
`models.dev` 目前只有 `reasoning: boolean` 和 `limit.output`，没有统一
`maxThinkingBudget`。因此本次不声称能为每个模型自动发现准确数字。

##### 运行成本、配额与稳定性

扩大 core max output 和 numeric `max` 会改变运行特征，不只是降低截断概率：

- reasoning 模型未设置显式 override 时使用 `model.limit.output`，会减少
  `context - core_max_output` 分支中的可用输入空间，可能更早触发 compaction；
- `max` variant 是用户显式选择的高成本模式；例如 Anthropic 的请求级 numeric budget
  可能从 31,999 提高到 117,964，延迟、连接存活时间和 token 消耗上界都会增加；
- Bedrock/Anthropic 对大 token 请求有 streaming 和长连接方面的限制，不能把更大的
  `max_tokens` 当作零成本配置，见
  [Amazon Bedrock extended thinking](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-extended-thinking.html)；
- Bedrock 会依据 input 加 `max_tokens` 预占 token quota，最终计费才按实际输出结算，见
  [Amazon Bedrock token quota](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-token-burndown.html)；
- Anthropic 的 prompt cache 会受 thinking 参数变化影响；相同 model、variant、显式 cap
  和 provider bounds 必须产生确定且稳定的 normalization 结果。

本次不额外增加 OpenCode 产品级硬上限：core 仍受 `model.limit.output`、显式
`OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` 和 provider cap 约束，plugin 仍可最终覆盖。
这是有意的产品取舍，必须在 CLI 文档中同时说明额度、compaction、延迟和 quota 影响。
实施后至少观察 provider rejection、length 终态比例、reasoning/output usage 和请求耗时；
若需要再增加产品级 cap，必须作为独立策略变更讨论，不能在实现中暗加。

##### 为什么仍不能代替 length error

第 1.2 节原始故障和第 1.4 节最小复现使用 OpenAI-compatible reasoning provider。该分支
只有 `reasoningEffort`，没有可扣减的 numeric budget，仍可产生：

```text
reasoning = E
visible output = 0
finish = length
```

即使 numeric 模型成功配置 10%/4,096 token 的请求级 headroom，visible answer 自身仍可能
耗尽剩余空间，provider 也不保证实际 thinking usage 精确等于 budget。
所以 provider-specific budget 只能降低部分模型的截断概率；Session / Task 的
`finish=length → error` 传播仍是无条件正确性边界。

当前 `variants()` 的既有 provider 测试用于固定字段形状；新增 helper 测试固定 envelope、
provider minimum/maximum、显式 RuntimeFlags cap、`output=0` fallback、不可变性、确定性
以及 effort/adaptive identity。不能复制 Claude Code 面向 Anthropic thinking block 的
恢复规则，也不实施自动 continuation。

#### 3.3.7 与 reasoning 默认输出上限修复的关系

不采用自动续写，并不意味着继续保留不合理的 32k 默认上限。四个能力分别解决不同问题：

```text
reasoning 默认使用模型声明的输出上限
  → 降低截断发生概率

numeric max budget 为 visible output 配置安全 envelope
  → 在参数层配置 visible-output headroom，降低可控 numeric 模型只产出 thinking 的概率

Session / Task 传播 length error
  → 截断发生后如实报告失败

自动 continuation
  → 截断发生后尝试恢复执行
```

本次实施前三项，不实施第四项。提高 reasoning 默认输出 envelope 并约束可控 numeric
budget 只能降低截断频率；任何有限上限和配置级 headroom 仍可能耗尽，所以它们不能替代
错误传播。反过来，只修复错误传播而不调整默认预算，状态虽然正确，但 reasoning 模型仍会
不必要地频繁失败。

最终修复边界为：

```text
第一层：减少故障
  reasoning 模型默认不再被统一压到 32k
  numeric max budget 以 10%/4,096 为请求级 visible-output headroom 目标

第二层：正确记录故障
  Session 把 length 持久化为 MessageOutputLengthError

第三层：正确传播故障
  Task / BackgroundJob 报告 error；子 Session 保留全文，父级获得有界 excerpt

非本次范围：自动恢复故障
  不续写、不重放、不实现 provider-specific thinking 恢复
```

修复完成后，截断仍可能发生，但父 agent 会获得明确错误、子 Session ID、token 统计和
有界 visible partial excerpt，可以据此检查已有修改、重新发起任务或选择更大的显式输出
额度，而不会把空结果或半成品误认为已经完成。

## 第四部分：修复方案

### 4.1 修复原则

1. `finish = "length"` 永远不是成功；
2. `finish` 与对应 `MessageOutputLengthError` 必须在 SessionProcessor 的同一次 assistant
   message 更新中持久化；
3. Task 必须依据完整子 Session 终态决定 BackgroundJob 状态，任何 assistant error 都不能
   降格为 `completed`；
4. 完整 partial text 保留在子 Session；父 Task 只接收有界 visible-text 摘录和定位信息；
5. reasoning 内容不进入 Task 错误，只报告 token 数；
6. `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` 优先于核心默认策略，但现有 provider plugin
   仍可在后续 hook 中删除或替换该值；
7. numeric max reasoning budget 使用同一个 core output envelope，并以
   10%/4,096 作为请求级 visible-output headroom 目标；provider minimum 不允许时按
   已定义规则降级或本地失败；会自动加回 numeric budget 的 SDK transport 传入 `E-B`，
   保证最终 total max 不超过 `E`；effort/adaptive 控制不做伪数字换算；
8. 不回滚已发生的 tool side effect，错误中必须提示检查文件系统/VCS；
9. 不改变正常 `stop`、取消和既有 provider plugin override 行为。

### 4.2 模块一：Session 截断终态

修改：

- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/prompt.ts`

#### SessionProcessor：错误生产与持久化

在 `processor.ts` 的 `step-finish` 分支收到 `value.reason === "length"` 时：

1. 设置 `ctx.assistantMessage.finish = value.reason`；
2. 计算本次是否发生
   `createdLengthError = !ctx.assistantMessage.error`；仅在为 true 时设置
   `new SessionV1.OutputLengthError({}).toObject()`，已有更早 terminal error 不被覆盖；
3. 继续保留并落库现有 reasoning/text/tool/step-finish parts 和 token usage；
4. 在现有 `session.updateMessage(ctx.assistantMessage)` 中同时持久化 finish 与 error；
5. message 更新成功且 `createdLengthError` 为 true 时发布一次
   `Session.Event.Error`；重复/既有 error 不再次发布；
6. 不抛异常、不自动续写，让 processor 在流清理完成后按已有
   `ctx.assistantMessage.error → "stop"` 路径退出。

该顺序消除“finish 已持久化、error 尚未写入”的 crash window。若进程在 assistant message
更新之前退出，数据库中不会出现新的 `finish=length ∧ error=undefined`；若更新已经完成，
finish 和 error 同时存在。

`SessionProcessor` 也被 compaction 直接使用。新行为使 length-truncated summary 带 error，
因此不会满足 `completedCompactions()` 的 `summary && finish && !error` 条件，并会沿
`processor.message.error → "stop"` 结束 compaction。本次不需要修改 compaction 生产代码，
但必须增加回归测试。

#### SessionPrompt：终态优先级

在 `prompt.ts` 的 `structured !== undefined` 成功捷径之前检查：

```text
handle.message.error.name == "MessageOutputLengthError"
OR handle.message.finish == "length"  // 防御 processor 测试桩或其他未规范化的当次返回
```

命中后直接返回 `"break"`；不再次设置 error 或发布事件，避免重复通知。该优先级保证
provider 明确声明 truncated 时，即使完整 tool call 已执行或 StructuredOutput tool 已经
给出值，也不会被推断为成功，更不会进入下一次 LLM 请求。

该 process 后检查不会修复已经持久化的历史
`finish=length ∧ error=undefined`：历史 terminal assistant 会在 loop 顶部直接退出，不会
再次进入 `handle.process()`。本次明确不做历史回填或 loop-entry normalization；Task 对
`finish=length` 的 defensive 检查只保证这类返回不会继续被降格为 completed。

工具可能已经执行，Session 不尝试回滚。完整 tool call 必须最多执行一次；partial/invalid
tool call 若在协议解析层先变成 API/parse error，则由 Task 的通用 assistant error 传播规则
保证不会成为 `completed`。

半形式化规约：

```text
模块：Session length terminal normalization

Requires:
  - provider stream 产生 step-finish(reason="length")

Ensures:
  - 新持久化的 assistant.finish == "length"
  - 若处理前 assistant 无 error，则同一 assistant.error.name ==
    "MessageOutputLengthError"
  - 若处理前已有 terminal error，则保留该 error 且仍停止，不降格为成功
  - 正常无中断处理路径对新建 OutputLengthError 恰好发布一次 Session.Event.Error
  - 单次 processor 执行对该转换最多发布一次 Session.Event.Error
  - 已产生的 parts、usage 和工具副作用不被删除或重放
  - 普通 prompt 和 compaction 都不会把该 assistant 当作成功终态

副作用:
  - 更新 assistant message
  - 发布 Session.Event.Error
```

assistant message 更新与事件发布不是同一 durable transaction。若进程在 message 已落库、
event 尚未发布之间崩溃，恢复后可以看到持久化 error，但本次事件可能没有观察者收到；本
方案不增加事件 outbox 或崩溃后重放。因此“恰好一次”只约束正常无中断执行，“最多一次”
约束单次 processor 执行。

`step-finish` 后仍会执行 snapshot patch、part update、summary scheduling 和 cleanup。
这些步骤中的异常当前会进入 `halt()`；现有 `halt()` 对非 ContextOverflow 错误会无条件
覆盖 `ctx.assistantMessage.error`。因此本次还必须给 `halt()` 增加 terminal-error
优先级：

```text
halt(laterError):
  始终记录 laterError 日志

  若 assistantMessage.error 已存在：
    将 laterError 视为 secondary processor failure
    不覆盖已有 terminal error
    不为 laterError 再发布 Session.Event.Error
    不把已有 length 终态改成 compaction/error
    完成必要的 idle/cleanup 收尾后返回

  否则：
    保持现有 ContextOverflow 与普通错误分支
```

这样可以保证“length error 已创建，随后 snapshot/event/cleanup 失败”不会把长度真值改写
成另一个错误。secondary failure 仍进入日志，避免静默丢失诊断；本次不为 secondary
failure 增加持久化字段或新事件 schema。

不新增错误 schema，不修改 Protocol/HttpApi，不需要生成 SDK。

### 4.3 模块二：Task 前后台失败传播

修改 `packages/opencode/src/tool/task.ts`。

`runTask()` 在取得 `SessionV1.WithParts` 后：

1. 先验证 `result.info.role === "assistant"`；否则以内部契约错误失败；
2. 收集所有 text parts，按原顺序用空行连接为 visible partial text；
3. 按固定优先级分类终态：
   1. `MessageAbortedError`；
   2. `MessageOutputLengthError`；
   3. 其他已有 assistant error；
   4. 仅在没有 error 时检查 defensive `finish === "length"`；
   5. 无 error 且非 length 才是成功；
4. `MessageAbortedError` 以 interrupt-only Effect 退出 `runTask()`，使 BackgroundJob
   进入 `cancelled`，而不是 generic failure 或 completed；
5. 其他 assistant error 以 Effect failure 退出，defensive length 不得覆盖一个已经存在的
   API/Auth/ContextOverflow 等错误；
6. output-length 错误构造专用诊断，包含：
   - 子 Session ID；
   - `finish_reason=length`；
   - reasoning token 和 output token；
   - “任务未完成，文件系统/VCS 可能已有部分修改”的提示；
   - 有 text 时附加有界 `Partial output excerpt`；
   - 无 text 时明确写 `No visible output was produced`；
7. 其他 error 使用错误名称和 `error.data.message` 中可用的字符串，仍附子 Session ID；
   不序列化完整 error data，不复制 API `responseBody`、headers 或 metadata，过长 message
   使用同一 UTF-8/line bounding helper。

终态映射：

| 子 assistant 终态                                                                               | runTask Effect           | BackgroundJob |
| ----------------------------------------------------------------------------------------------- | ------------------------ | ------------- |
| `MessageAbortedError`                                                                           | interrupt-only           | `cancelled`   |
| `MessageOutputLengthError`                                                                      | failure                  | `error`       |
| ContentFilter/API/Auth/ContextOverflow/StructuredOutput/Unknown error，即使同时 `finish=length` | failure，保留原错误分类  | `error`       |
| 无 error，仅 defensive `finish=length`                                                          | failure，length 专用诊断 | `error`       |
| 无 error，正常 finish                                                                           | success                  | `completed`   |
| 非 assistant result                                                                             | failure                  | `error`       |

partial output 的权威副本是已经持久化的子 Session，不把完整大文本复制到
`Error.message`。`task.ts` 使用 `Truncate.Service.limits()` 取得现有 `tool_output` 的
max-lines/max-bytes，并由 Task 本地的纯 helper 生成不超过这两个限制的 excerpt；不另存
truncation 文件，因为完整内容已经在子 Session。超出部分提示通过子 Session ID 检查。
这是必需的，因为通用 Tool truncation 只处理成功 output，Effect failure 会绕过它。

只允许收集 `type === "text"` 的 part；禁止把 `type === "reasoning"` 的内容放入错误文本。
reasoning 只报告 token count。

excerpt 从连接后的 visible text 头部开始，保持 part 与行的原始顺序；`maxLines/maxBytes`
只约束 `Partial output excerpt` 正文，不包含固定诊断标签。截断必须按完整 Unicode code
point 计算 UTF-8 bytes，不能切出半个 surrogate/code point；命中任一上限后追加固定的
“完整内容位于子 Session”提示，但不把全文另存一次。

`renderOutput()` 使用 XML-like vocabulary 把 Task 结果注入父 Session。子模型的 text、
error message 和用户可控 summary 都不能原样进入标签结构，否则
`</task_error><task state="completed">` 一类内容可以伪造终止标签和成功状态。本次增加两个
纯 helper：

```text
escapeTaskMarkupAttribute(value)
escapeTaskMarkupText(value)
```

所有 attribute 和 element text 中的 `& < > " '` 按上下文转义；固定标签只能由
`renderOutput()` 生成。visible excerpt 的 byte limit 按**转义后的 UTF-8 表示**计算，
helper 只能在完整 Unicode code point 和完整 entity 边界停止，避免转义扩张后突破上限或
切出半个 entity。成功 `task_result`、失败 `task_error` 和 `summary` 使用同一套规则，
避免只保护新错误分支而保留既有结构注入路径。

诊断 helper 规约：

```text
函数：formatAssistantFailure(result, sessionID, limits)

Requires:
  - result.info.role == "assistant"
  - limits.maxLines > 0
  - limits.maxBytes > 0

Ensures:
  - 返回非空错误字符串，包含 sessionID 和 assistant error/finish
  - output-length 时包含 output/reasoning token count
  - visible excerpt 的行数和 UTF-8 bytes 不超过 limits
  - 不包含任何 reasoning part.text
  - 不复制 error responseBody、headers 或 metadata
  - 无 visible text 时明确说明没有 visible output
  - 经 renderOutput() 序列化后，动态内容不能产生新的 task/summary/result/error 标签

副作用：
  - 无
```

BackgroundJob 已有正确的状态映射：

```text
Effect success → completed
Effect failure → error
Effect interrupt → cancelled
```

因此不修改 `packages/core/src/background-job.ts`：

- 前台等待路径会在 `status === "error"` 时失败，由现有 tool runtime 把父 ToolPart 标为
  `status="error"`，不会生成成功 XML；
- 后台通知路径会调用现有 `inject("error", ...)`；
- 后台 synthetic prompt 的现有 Task XML vocabulary 使用 `state="error"`，不引入新的
  `failed` 枚举。

取消需要区分三层可观察状态，不能把它与普通 assistant failure 合并：

```text
child assistant.error = MessageAbortedError
  → runTask interrupt-only
  → BackgroundJob.status = cancelled

foreground waiter:
  cancelled → 保持现有 Error("Task cancelled") 非 completed 行为

background notifier:
  保持现有行为，不为 cancelled 注入 completed/error synthetic prompt
```

当前 `notify()` 只处理 `completed` 和 `error`，前台 waiter 则会把 `cancelled` 转成
`Task cancelled` failure。因此“保持取消语义”指 BackgroundJob 的取消分类和父工具不成功，
不表示前台 ToolPart 与后台通知拥有同一种呈现形式。若将来需要
`<task state="cancelled">` 或 cancelled 后台通知，必须单独扩展 Task vocabulary，本修复不做。

无需修改 `packages/core/src/background-job.ts`。Task 的行为契约改变为：任何 terminal
assistant error 都不得成为 completed；output length 只是其中需要额外 token/partial
诊断的一个分支。

### 4.4 模块三：reasoning 输出 envelope 与 numeric budget

#### 4.4.1 reasoning 模型默认输出上限

修改 `packages/opencode/src/provider/transform.ts` 中的
`maxOutputTokens(model, outputTokenMax)`。

移除参数上的 `= OUTPUT_TOKEN_MAX` 默认值，改为显式 optional 参数；否则调用方传入
`undefined` 时无法区分“用户未配置”和“用户配置了 32k”。

新规则：

```text
若 RuntimeFlags 显式提供 outputTokenMax：
  min(model.limit.output, outputTokenMax)

否则若 model.capabilities.reasoning：
  model.limit.output

否则：
  min(model.limit.output, OUTPUT_TOKEN_MAX)

若模型声明 output=0：
  保持当前 fallback 行为，使用显式上限或 OUTPUT_TOKEN_MAX
```

半形式化规约：

```text
函数：maxOutputTokens(model, outputTokenMax?)

Requires:
  - model.limit.output ≥ 0
  - outputTokenMax 若存在则为正整数（RuntimeFlags 已校验）

Ensures:
  - 返回值 > 0
  - model.limit.output > 0 时，返回值 ≤ model.limit.output
  - outputTokenMax 存在时，返回值 ≤ outputTokenMax
  - outputTokenMax 不存在且 reasoning=true 且 model.limit.output>0 时，
    返回 model.limit.output
  - outputTokenMax 不存在且 reasoning=false 时，返回值 ≤ 32_000

副作用：
  - 无
```

上述 Ensures 约束的是 `maxOutputTokens()` 返回的**核心默认值**，不是 plugin 处理后的最终
wire request。plugin 的 `chat.params` hook 仍在该计算之后运行，因此 Cloudflare、Codex
和 GitHub Copilot 等现有 provider-specific override 仍可把值设为 `undefined` 或其他值。
本次不把环境变量升级为不可覆盖的全局硬上限。

默认选择依据 `model.capabilities.reasoning`，与当前选择的 variant 是否关闭 reasoning
无关。这与 Issue 建议和现有 Cloudflare reasoning capability 判断一致；测试需固定该行为，
避免实现时无意引入 variant-specific 分支。

`packages/opencode/src/session/overflow.ts` 已复用同一函数计算可用 context，无需计划修改，
但必须在实际测试文件 `test/session/compaction.test.ts` 中验证现有两种 reservation 公式：

```text
model.limit.input 存在：
  usable = input_limit - min(COMPACTION_BUFFER, core_max_output)

model.limit.input 不存在：
  usable = context_limit - core_max_output
```

这里的“一致”是指 request 和 overflow 使用同一个 core max-output 计算结果，不表示
`reserved` 必然等于完整输出额度；存在 input limit 时仍保留当前最大 20k buffer 语义。
同时在 `test/session/llm.test.ts` 验证没有 provider override 的 reasoning 模型实际请求
body 使用新的 max token 值，并验证现有 plugin override 不变。

#### 4.4.2 运行时 numeric reasoning budget normalization

先修改 `ProviderTransform.variants()` 的内置 numeric variant 生成逻辑：
`model.limit.output == 0` 时使用 `OUTPUT_TOKEN_MAX` 作为 catalog fallback，再计算
`high/max` 静态初值，保证目录中不产生负数或零 budget。这里不读取 RuntimeFlags，也不负责
最终请求 envelope。

随后在 `packages/opencode/src/provider/transform.ts` 增加确定性 helper
`normalizeReasoningBudget()`，由 `packages/opencode/src/session/llm/request.ts` 在所有
base/model/agent/variant options 合并完成后调用：

```text
函数：normalizeReasoningBudget({
  model,
  variant,
  options,
  maxOutputTokens,
})

Requires:
  - maxOutputTokens > 0
  - options 是 request-local merged options

Ensures:
  - 返回新 options，不修改输入及 model/agent catalog
  - effort/adaptive/thinkingLevel/maxReasoningEffort 值不变
  - provider minimum 允许时，已知 numeric `max` 不超过 safe cap 和 provider cap
  - provider minimum 不允许目标 headroom、但仍存在合法值时，使用 minimum 并接受目标降级
  - high/custom 的合法 numeric budget 不会被自动提高
  - 未知字段和值保持不变

Failure:
  - provider bounds 自相矛盾
  - E 不足以容纳 provider minimum 和至少一个 visible token
  - high/custom 已有值非法，且不能通过只向下 clamp 得到合法值
  - Copilot 显式 E 要求降到无法证明满足远端 minimum 的范围

Failure behavior:
  - 抛出包含 provider/model/variant/E/bounds 的普通配置 Error
  - 不发送 provider 请求
  - 不新增公开错误 schema
```

`request.ts` 必须只计算一次 core max output `E`，用它完成预算 normalization，再根据
transport 是否会自动加回 numeric budget 计算交给 `chat.params` 的 SDK 参数 `S`：

```ts
const coreMaxOutputTokens = ProviderTransform.maxOutputTokens(input.model, input.flags.outputTokenMax)
const activeVariant = input.small ? undefined : input.user.model.variant
const options = yield* Effect.try({
  try: () =>
    ProviderTransform.normalizeReasoningBudget({
      model: input.model,
      variant: activeVariant,
      options: mergedOptions,
      maxOutputTokens: coreMaxOutputTokens,
    }),
  catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
})

const maxOutputTokens = ProviderTransform.transportMaxOutputTokens({
  model: input.model,
  options,
  maxOutputTokens: coreMaxOutputTokens,
})

const params = yield* input.plugin.trigger("chat.params", ..., {
  maxOutputTokens,
  options,
})
```

不能在 `ProviderTransform.variants()` 创建模型目录时完成动态计算，因为那里拿不到本次请求的
RuntimeFlags；也不能在 plugin hook 之后再强制改写，否则会破坏 plugin 的最终覆盖契约。
若某个 plugin 主动把 `maxOutputTokens` 调得更低并保留 numeric thinking，它也必须同步调整
自己的 options；核心层不能在 hook 返回后再次覆盖。现有 Cloudflare/Codex/Copilot hook
需要通过第六部分回归测试证明没有制造新的不匹配。

其中 `normalizeReasoningBudget()` 始终接收 core total envelope `E`；
`transportMaxOutputTokens()` 是无副作用 transport adapter：

```text
若 transport 已确认会序列化为 SDK maxOutputTokens + B：
  返回 E - B
否则：
  返回 E
```

当前确认需要减法的路径是 `@ai-sdk/anthropic`、复用其 message model 的
`@ai-sdk/google-vertex/anthropic`，以及 `@ai-sdk/amazon-bedrock` 的 Anthropic numeric
thinking。helper 只读取各 SDK 实际消费的 numeric 路径与 `thinking.type="enabled"`，
不会因为 options 中存在同名私有字段就盲目扣减。Anthropic/Vertex-Anthropic 的 enabled
thinking 若省略 camelCase budget，则按 SDK 隐式 1,024 计算；normalization 保证实际或
隐式的 `0 < B < E`，所以需要减法时返回值恒大于 0。

因此核心不变量保证传入 `chat.params` hook 的 options 已归一化，且传入的
`maxOutputTokens` 是 transport-ready 的 `S`。第三方 plugin 可以最终删除或替换
`S/options`，也可能主动破坏二者关系；这属于 plugin 的责任边界，不能表述为 core 对最终
wire request 的无条件保证。测试必须证明 hook 能看到已归一化的 options 和适配后的 `S`，
并仍能同时替换两者；真实 Anthropic wire 测试必须证明 SDK 加回 budget 后总值恰好为 `E`。

安全 cap：

```text
desiredReserve = max(4,096, ceil(maxOutputTokens × 0.10))
safeCap        = maxOutputTokens - desiredReserve
```

对可识别的 numeric 值：

```text
已知 provider 且 selected variant == "max":
  若 safeCap >= providerNumericMin：
    min(safeCap, providerNumericMax ?? safeCap)
  否则若 providerNumericMin < maxOutputTokens：
    providerNumericMin  // configured headroom 目标降级
  否则：
    配置失败

selected variant != "max":
  先验证 existingNumericBudget > 0 且不低于已知 providerNumericMin
  再只向下 clamp 到 provider maximum 和可达到的安全上界
  若目标 safeCap 低于 provider minimum，则最多向下到 minimum
  若无法保持 0 < budget < maxOutputTokens，则配置失败
```

minimum 造成的目标降级不增加 wire option、公开状态字段或新事件；规范中的
`configured headroom` 数值和 CLI 文档就是该取舍的契约记录。运行时只需产生确定的合法
budget。`activeVariant == undefined` 时 helper 绝不能进入 numeric `max` 自动提高分支。

只有已知 manual Anthropic family 可以在名为 `max` 的 variant 下突破旧的 31,999；
Gemini 2.5 使用按 Pro/Flash/Flash-Lite 区分的静态 provider minimum/maximum；GitHub
Copilot 以动态模型目录已经编码到 variant 的 max 值作为保守 cap。未知 custom numeric
协议只向下 clamp，不自动提高；缺少 minimum 元数据且向下调整可能越过 minimum 时本地
失败，不猜测也不等待 provider 校验。

对相同的 model、variant、merged options、`maxOutputTokens` 和 provider bounds，helper
必须产生 byte-for-byte 相同的 options 或相同错误，不能读取时间、随机数或 Session 状态。
这既便于测试，也避免同一会话中无原因改变 thinking 参数而破坏 cache 稳定性。

对以下控制，helper 必须是 identity：

```text
reasoningEffort
reasoning.effort
thinking.type == "adaptive"
thinkingLevel
maxReasoningEffort
```

这意味着原始 GLM 5.2 仍只发送 `reasoningEffort="max"`；本模块不声称能把该定性值限制为
90% token。

### 4.5 修复后的最小复现路径

对原始复现：

```text
provider 返回 length
  → SessionProcessor 在持久化 finish 时同步设置 MessageOutputLengthError
  → 普通 prompt / compaction 停止，structured 快捷路径不能覆盖该错误
  → Task 验证 assistant 终态并读取 error/tokens
  → runTask Effect failure
  → BackgroundJob.status = error
  → 前台工具失败 / 后台注入 state="error"
  → 完整 partial text 留在子 Session，父 agent 只收到有界 visible excerpt
```

父 agent 不再可能把该结果解释为成功完成。

## 第五部分：正确性论证

### 5.1 根因消除

- Provider 修复移除 reasoning 模型不必要的固定 32k 默认压缩，降低截断频率；
- Session 修复补上已有错误契约的生产者，消除
  `finish=length ∧ error=undefined` 的非法终态；
- Task 修复不再把带终态的结果无条件降格成成功字符串，消除
  `assistant error → completed` 的状态丢失，其中 length 使用专用诊断。

三者分别处理“频率”“Session 真值”和“跨边界传播”，不是通过增加一个提示文本掩盖症状。

### 5.2 不变量

修复后必须保持：

```text
I1: 修复后新完成持久化的 assistant.finish == "length"
    ⇒ assistant.error 存在
    ∧ 若 step-finish 前没有 terminal error，
      assistant.error.name == "MessageOutputLengthError"
    ∧ 后续 processor secondary failure 不覆盖该 terminal error

I2: child assistant 因 output length 截断
    ⇒ BackgroundJob.status != "completed"

I3: parent ToolPart / BackgroundJob / Task XML 中任一 Task state == "completed"
    ⇒ child terminal assistant 没有 error，且不是 defensive finish=length

I4: length partial output 被保留
    ⇒ 完整 visible text 存在于子 Session
    ∧ 父 Task 只获得有界、标记为 incomplete 的 excerpt
    ∧ reasoning part 内容不进入错误文本

I5: 显式 outputTokenMax 存在
    ⇒ maxOutputTokens() 返回的核心默认值不超过该值和 model.limit.output

I6: non-reasoning 且无显式覆盖
    ⇒ maxOutputTokens() 的现有 32k 默认行为不变

I7: summary assistant.finish == "length"
    ⇒ 该 summary 不进入 completedCompactions()

I8: length terminal normalization
    ⇒ 正常无中断路径 Session.Event.Error 恰好发布一次
    ∧ 单次 processor 执行最多发布一次
    ∧ 已有 terminal error 时 halt() 只记录 secondary failure，不再发布终态错误事件
    ∧ 不承诺持久化后崩溃场景的事件重放

I9: provider chat.params override
    ⇒ 仍可在核心默认值之后删除或替换 maxOutputTokens

I10: child assistant.error.name == "MessageAbortedError"
     ⇒ BackgroundJob.status == "cancelled"
     ∧ foreground/background 均不得呈现 completed

I11: 已知 provider 的 numeric variant 名为 max，且 safeCap 满足 provider minimum
     ⇒ normalized budget ≤ core max output - max(4,096, ceil(core max output × 10%))
     ∧ normalized budget ≤ providerNumericMax（若存在）

I12: 已知 provider minimum > safeCap 且 provider minimum < core max output
     ⇒ normalized numeric max == provider minimum
     ∧ configured headroom 目标明确降级

I13: provider minimum >= core max output，或 provider bounds 自相矛盾
     ⇒ 请求准备本地失败
     ∧ 不发送 provider 请求

I14: 合法的 high/custom numeric budget
     ⇒ normalization 后的值 ≤ normalization 前
     ∧ 非法低值不被静默向上提高，而是请求准备失败

I15: effort/adaptive/thinking-level reasoning control
     ⇒ normalization 前后结构和值相同

I16: reasoning options normalization
     ⇒ 不修改 model.variants、model.options、agent.options 或输入 options
     ∧ 相同输入产生相同 options 或相同配置错误
     ∧ chat.params plugin 收到 normalized options 后仍可最终删除或替换
       maxOutputTokens/options
     ∧ small request 的 active variant 为 undefined，不进入 numeric max 自动提高

I17: 内置 numeric variant 的 model.limit.output == 0
     ⇒ catalog fallback 后生成的 high/max budget 均为正数

I18: transport 会把 numeric thinking budget 加回标准化 maxOutputTokens
     ⇒ transportMaxOutputTokens() == core max output - normalized budget
     ∧ transport 加回后的候选 provider total max == core max output
     ∧ SDK 继续应用自己的模型 cap 后，最终 provider total max ≤ core max output
     ∧ 不会加回 budget 的 transport 保持 transportMaxOutputTokens() == core max output

I19: Task XML-like serialization
     ⇒ 动态 attribute/element 内容均经过上下文转义
     ∧ 动态内容不能伪造 task/summary/task_result/task_error 标签或 completed 状态
     ∧ visible excerpt 的转义后 UTF-8 表示仍满足配置上限
```

### 5.3 模块保持论证

#### Session

- `step-finish` 在 processor 中同时决定 finish reason、tokens 和 length error；
- error 在同一次 assistant message 更新中持久化，prompt 只消费，不重复生产；
- 新分支不删除任何 part；
- 因此 transcript 与 token accounting 保持完整；
- processor 已被普通 prompt 与 compaction 共享，因此两条路径得到同一终态；
- prompt 让 error 优先于 structured success，不新增 provider 请求；
- `halt()` 只记录 length 之后的 secondary failure，不覆盖已持久化 terminal error；
- 已执行工具不回滚也不重放。

#### Task

- 正常 `stop` 继续返回原 text，BackgroundJob 仍为 completed；
- 所有 assistant error 都不再成为 completed，length 改为带专用诊断的 Effect failure；
- `MessageAbortedError` 通过 interrupt-only Effect 保持 BackgroundJob cancelled；
- 前台 cancelled waiter 保持现有 `Task cancelled` failure，后台 cancelled 保持不注入通知；
- length/其他失败的前后台都消费同一个 BackgroundJob error，因此都不能成为 completed；
- defensive `finish=length` 只在没有已有 error 时生效，不覆盖更具体的 API/Auth 等错误；
- 完整 partial text 保留在子 Session，父级 excerpt 有界且不包含 reasoning；
- partial text 不会进入 completed task_result；
- 所有 Task XML-like 动态内容统一转义，模型文本不能伪造标签或 completed 状态。

#### Provider

- 对 non-reasoning 模型和显式 override 保持原有上界语义；
- reasoning 默认值仍不超过模型声明的 `limit.output`；
- numeric `max` 按同一个 core max output 配置 10%/4,096 的 headroom 目标；
- provider minimum 不允许目标 headroom 时使用确定的降级/失败规则，不发送已知非法请求；
- 合法 `high`/custom 不提高，非法低值本地失败，effort/adaptive/thinking-level 不做数字换算；
- `output=0` 的内置 variant catalog 使用正数 fallback；
- max-output、budget 与 transport adapter 都无副作用；已知会自动加回 budget 的 SDK 收到
  `E-B`，加回后的候选 total 为 `E`，后续 SDK/provider cap 只允许继续向下；
- core 参数关系只保证到 plugin hook 输入，plugin hook 的后置 override 顺序不变，最终
  wire override 由 plugin 负责；
- overflow 与 request 继续复用同一个 core max-output 函数。

### 5.4 无回归论证

无回归依赖第六部分测试验证：

- processor/session 正常 stop/tool-call/content-filter/structured-output/compaction 测试保持通过；
- 真实 CLI subprocess 覆盖 provider wire、child durable state、父 Task 和顶层错误出口；
- Task 正常、resume、精确取消映射、前后台、promotion 和既有失败测试保持通过；
- provider transform、LLM request、plugin override、compaction overflow 测试保持通过；
- ACP 保持既有 `MessageOutputLengthError → max_tokens` 契约；
- `bun typecheck` 从 `packages/opencode` 执行；
- CLI 文档及本地化更新后从 `packages/web` 执行 `bun run build`。

### 5.5 已知非目标

- 不保证模型永远不达到任何有限输出上限；
- 不保证配置级 visible-output headroom 会转化为同等数量的实际 visible token；
- 不实现自动 continuation；
- 不恢复被截断的半个 tool call；
- 不回滚截断前已完成的工具副作用；
- 不迁移或回填修复前已经存入数据库的历史 `finish=length ∧ error=undefined` 消息；
- 不把 process-local BackgroundJob 改造成 durable job registry；
- 不把 effort/adaptive/thinking-level 自动换算为 token；
- 不为通用 `models.dev` 新增尚不可靠的 `maxThinkingBudget` 字段；
- 不通过真实计费请求探测 provider 的 numeric thinking 上限；
- 不递归改写未知 provider 私有 budget 字段。

## 第六部分：测试用例清单

| 类型     | 文件 / 用例                                                                                 | 验证内容                                                                                                                                           | 状态                                                                                             |
| -------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 回归     | `test/cli/run/run-process.test.ts`：subagent length without text                            | 真实 CLI/SSE/DB 全链路；wire max token 正确；child 持久化 length error；父 Task 非 completed；不自动重放 child 请求                                | 已加并通过，提交 `4dada962e`                                                                     |
| 回归     | `test/session/prompt.test.ts`：length without text                                          | processor 同步持久化 finish/error；error event 恰好一次；只发一个 LLM 请求                                                                         | 已加并通过，提交 `0d75454b2`                                                                     |
| 回归     | `test/tool/task.test.ts`：foreground length without text                                    | 不产生空 `completed`；Task/BackgroundJob 失败                                                                                                      | 已加并通过，提交 `4dada962e`                                                                     |
| 回归     | `test/tool/task.test.ts`：foreground length with partial text                               | 失败；完整内容可由子 Session 定位；错误带有界 incomplete excerpt                                                                                   | 已加并通过，提交 `4dada962e`                                                                     |
| 回归     | `test/tool/task.test.ts`：background length                                                 | 后台通知使用 `state="error"`，不使用 completed                                                                                                     | 已加并通过，提交 `4dada962e`                                                                     |
| 新增     | `test/session/processor-effect.test.ts`：length terminal normalization                      | 直接输入共享 LLM `step-finish(reason="length")`；返回 stop；正常路径事件恰好一次；既有 terminal error 不覆盖/不重复发布                            | 已加并通过，提交 `0d75454b2`                                                                     |
| 新增     | `test/session/processor-effect.test.ts`：length then secondary processor failure            | length error 落库后模拟 snapshot/part/cleanup 失败；`halt()` 保留原终态、只记录 secondary failure、不重复发事件                                    | 已加并通过（snapshot failure 同时覆盖 cleanup；part failure 走同一 halt seam），提交 `0d75454b2` |
| 新增     | `test/cli/run/run-process.test.ts`：top-level length                                        | 顶层 Session 产生 error event；partial 仍输出/落库；CLI 非零退出且不自动续写                                                                       | 已加并通过（CLI 可观察项；落库由同组 processor/prompt 用例断言），提交 `0d75454b2`               |
| 新增     | `test/session/prompt.test.ts`：length with partial text/reasoning                           | error 与 parts 同时保留；事件一次；不重放请求                                                                                                      | 已加并通过，提交 `0d75454b2`                                                                     |
| 新增     | `test/session/prompt.test.ts`：length after a tool completed in the previous provider round | round 1 文件追加一次并持久化 tool result；round 2 报告被截断；文件仍只有一行；不发 child round 3                                                   | 已加并通过，提交 `0d75454b2`                                                                     |
| 新增     | `test/session/prompt.test.ts`：length after StructuredOutput success                        | 通过可控 processor/tool seam 同时建立 structured value 与 length；structured 快捷路径不能绕过 length error                                         | 已加并通过，提交 `0d75454b2`                                                                     |
| 新增     | `test/session/compaction.test.ts`：length summary                                           | summary 带 OutputLengthError，不进入 completed compaction，不发布成功 compact event                                                                | 已加并通过，提交 `0d75454b2`                                                                     |
| 新增     | `test/tool/task.test.ts`：content-filter/API assistant error                                | 非 length assistant error 同样不会成为 completed；只取安全 message，不复制 responseBody/headers/metadata                                           | 已加并通过，提交 `4dada962e`                                                                     |
| 新增     | `test/tool/task.test.ts`：existing error plus finish length                                 | aborted 优先为 cancelled；其他已有错误保留原分类；defensive length 仅在无 error 时生效                                                             | 已加并通过，提交 `4dada962e`                                                                     |
| 新增     | `test/tool/task.test.ts`：non-assistant result                                              | `TaskPromptOps.prompt()` 违反 assistant 结果契约时 Task/BackgroundJob 失败                                                                         | 已加并通过，提交 `4dada962e`                                                                     |
| 新增     | `test/tool/task.test.ts`：aborted assistant foreground/background                           | runTask interrupt-only；BackgroundJob cancelled；前台 `Task cancelled`；后台不注入 completed/error 通知                                            | 已加并通过，提交 `4dada962e`                                                                     |
| 新增     | `test/tool/task.test.ts`：multiple text parts                                               | 按顺序形成 visible excerpt，不只取最后 part                                                                                                        | 已加并通过，提交 `4dada962e`                                                                     |
| 新增     | `test/tool/task.test.ts`：large/unicode partial output                                      | excerpt 按完整 code point 满足 line/UTF-8 byte 上限并包含 Session ID；全文只存在于已持久化子 Session                                               | 已加并通过，提交 `4dada962e`                                                                     |
| 新增     | `test/tool/task.test.ts`：reasoning privacy                                                 | 错误包含 reasoning token count，但不包含 reasoning part 文本                                                                                       | 已加并通过，提交 `4dada962e`                                                                     |
| 新增     | `test/tool/task.test.ts`：task markup injection                                             | text/error/summary 含闭合标签和 `state="completed"` 时全部转义；转义后 excerpt 仍满足 UTF-8 byte/line 上限                                         | 已加并通过，提交 `4dada962e`                                                                     |
| 新增     | `test/tool/task.test.ts`：promotion then length                                             | foreground 被提升为 background 后仍注入 `state="error"`                                                                                            | 已加并通过，提交 `4dada962e`                                                                     |
| 既有回归 | `test/tool/task.test.ts`：normal stop/resume/background completion                          | 正常 completed 行为不变                                                                                                                            | 已全量通过（Task 文件 29 个用例），提交 `4dada962e`                                              |
| 新增     | `test/provider/transform.test.ts`：reasoning 131072, no override                            | 返回 131072                                                                                                                                        | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/transform.test.ts`：non-reasoning 131072                                     | 返回 32000                                                                                                                                         | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/transform.test.ts`：reasoning + explicit 64000                               | 返回 64000                                                                                                                                         | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/transform.test.ts`：override > model limit                                   | 返回 model limit                                                                                                                                   | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/transform.test.ts`：model output=0 fallback                                  | max output 保持正数 fallback；内置 Anthropic high/max catalog budget 也均为正数                                                                    | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/transform.test.ts`：reasoning capability + no variant                        | 仍按 capability 使用模型输出上限，不依赖 variant                                                                                                   | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/transform.test.ts`：Anthropic numeric max envelope                           | `E=131072 → 117964`；`E=32768 → 28672`；camelCase/snake_case/SAP/Bedrock shape 都正确                                                              | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/transform.test.ts`：Gemini 2.5 provider bounds                               | 65,536 输出下 Pro/Flash clamp 32,768/24,576；小 `E` 使用 Pro 128、Flash-Lite 512 minimum；`E<=minimum` 本地失败                                    | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/transform.test.ts`：high/custom numeric policy                               | 合法既有值不提高；超过 safe cap 时向下 clamp；低于已知 minimum 时本地失败；未知字段不递归改写                                                      | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/transform.test.ts`：small output/provider minimum                            | Anthropic `E=4000 → budget=1024` 并接受 headroom 目标降级；`E=1024` 和非法 custom 值均本地失败                                                     | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/transform.test.ts`：max variant name contract                                | `variants.max` 遵守动态 max 契约；high/custom 固定值不提高且只向下 clamp                                                                           | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/transform.test.ts`：Copilot encoded cap                                      | request-time cap 取动态目录已编码的 max variant；不能证明远端 minimum 的下调本地失败                                                               | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/transform.test.ts`：effort/adaptive identity                                 | effort、adaptive、thinking level、maxReasoningEffort 结构和值保持不变                                                                              | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/transform.test.ts`：numeric normalization immutability                       | 返回新对象；输入 options 和 model catalog 均不变                                                                                                   | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/transform.test.ts`：numeric normalization determinism                        | 相同 model/variant/options/E/bounds 产生相同 options 或相同配置错误                                                                                | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/transform.test.ts`：transport max adaptation                                 | Anthropic/Bedrock 使用 `E-B`；Anthropic enabled 缺省 budget 按 SDK 隐式 1,024；Google 等不加回的 transport 保持 `E`                                | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/session/llm.test.ts`：reasoning request body                                          | Anthropic SDK 入参 13,108 + budget 117,964，真实 wire `max_tokens=131,072`                                                                         | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/session/llm.test.ts`：reasoning request + explicit RuntimeFlags cap                   | request 参数使用 `S=4,096`、budget 27,904，总 envelope 为显式 32,000                                                                               | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/session/llm.test.ts`：effort-only request                                             | GLM `reasoningEffort=max` 保持原样，不由 normalizer 新增 numeric thinking 字段                                                                     | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/session/llm.test.ts`：small request with user max variant                             | active variant 为 undefined；沿用 small options，不合成或提高 numeric max budget                                                                   | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/session/llm.test.ts`：normalized plugin input/final override                          | `chat.params` 先看到 normalized options 和 transport-ready `S`，并仍可同时替换两者                                                                 | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/session/compaction.test.ts`：reasoning without input limit                            | usable 使用 `context - core_max_output`                                                                                                            | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/session/compaction.test.ts`：reasoning with input limit                               | usable 保持 `input - min(20k, core_max_output)`                                                                                                    | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/acp/service-session.test.ts`：output length stop reason                               | 持久化 MessageOutputLengthError 后 ACP 返回 `stopReason=max_tokens`                                                                                | 已加并通过，提交 `0d75454b2`                                                                     |
| 既有回归 | `test/plugin/cloudflare.test.ts`：max output override                                       | Cloudflare 仍可删除/保留 transport-ready maxOutputTokens                                                                                           | 已全量通过（4 pass，模块三）                                                                     |
| 新增     | `test/plugin/codex.test.ts`：max output override                                            | OpenAI Codex `chat.params` 仍删除 maxOutputTokens                                                                                                  | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/plugin/github-copilot-models.test.ts`：max output/budget discovery                    | Copilot GPT 删除、非 GPT 保留 maxOutputTokens；远端 min/max 生成合法 high/max；矛盾 bounds 不暴露 numeric variant；min 不被误当成 request metadata | 已加并通过，提交 `77e509e81`                                                                     |
| 新增     | `test/provider/provider.test.ts`：Copilot config variant merge                              | 用户不能覆盖或禁用动态 max；high/custom numeric clamp 到发现的 cap；其他 provider merge 语义不变                                                   | 已加并通过，提交 `77e509e81`                                                                     |

计划验证命令均从 package 目录执行：

```bash
cd packages/opencode
bun test test/session/processor-effect.test.ts
bun test test/session/prompt.test.ts
bun test test/session/compaction.test.ts
bun test test/tool/task.test.ts
bun test test/provider/transform.test.ts
bun test test/session/llm.test.ts
bun test test/cli/run/run-process.test.ts
bun test test/acp/service-session.test.ts
bun test test/plugin/cloudflare.test.ts
bun test test/plugin/codex.test.ts
bun test test/plugin/github-copilot-models.test.ts
bun test test/provider/provider.test.ts
bun typecheck

cd ../web
bun run build
```

模块一实际验证记录：

- 上述 processor、prompt、compaction、ACP 的完整目标文件合计
  `164 pass, 2 skip, 0 fail`；processor 在 cleanup 保护收窄后又单独全量运行，
  `18 pass, 0 fail`；
- 顶层 CLI subprocess 文件全量运行，`14 pass, 0 fail`；
- 模块一新增的 10 个 length/ACP/CLI 定向用例全部通过；
- `packages/opencode` 的 `bun run typecheck` 通过。

本轮 secondary-failure 用例让同一个 `Snapshot.patch` seam 在 step-finish 后和 cleanup 中都
失败，从而同时验证两次 `halt()` 都不会覆盖或重复发布已经持久化的 length error。未为
`session.updatePart` 再造一份等价失败桩，因为它与 snapshot failure 进入完全相同的
processor cause/halt 管线。CLI fixture 只断言可观察的 partial stdout、错误 stderr、非零
退出和无第三次主请求；durable finish/error/parts 由同组 processor/prompt 用例直接读取
数据库断言。

当前 Cloudflare 已有 `maxOutputTokens` 直接断言；Codex 和 GitHub Copilot 虽有现成 plugin
测试文件，但都没有覆盖对应 `chat.params` override。实现阶段在上述既有文件补断言，不为
命名一致性新建测试文件。

`test/tool/task.test.ts` 的普通 `stubOps()` 只返回 `WithParts`，不会把该结果写入数据库。
凡是断言“完整 partial 仍可由子 Session 定位”的用例，stub 必须通过 `Session.Service`
持久化 assistant message/parts，或者使用真实 Session/CLI fixture；不能仅检查内存返回值
后声称 durable transcript 已保留。

模块二实际验证记录：

- 按测试先行执行：在修改 `task.ts` 前，8 个 Task 定向回归均按预期失败，表现为
  foreground/background/promotion 的 length 与 aborted 结果仍被登记为 `completed`，markup
  注入产生额外 `<task>`；真实 subagent CLI 用例也观察到父 Task `status=completed`；
- 实现后 Task 定向用例（含复核阶段补充的 defensive length、non-assistant result 和
  ContentFilter 边界）为 `11 pass, 0 fail, 79 assertions`；
- `test/tool/task.test.ts` 全量为 `29 pass, 0 fail, 142 assertions`，既有 resume、正常
  completed、后台运行、promotion 与递归取消测试全部保持通过；
- `test/cli/run/run-process.test.ts` 全量为 `15 pass, 0 fail, 60 assertions`；其中真实
  subagent/DB 链路定向重跑为 `1 pass, 0 fail, 11 assertions`；
- `packages/opencode` 的 `bun run typecheck` 通过；四个 TypeScript 改动文件的 Prettier
  检查通过；定向 oxlint 为 0 error，报告的 8 个 warning 均位于本模块修改前已存在的代码；
  新增 CLI 用例使用 Effect Schema 解码数据库 JSON，避免以不安全类型断言掩盖持久化结构
  错误。

CLI fixture 为每个测试 home 显式设置隔离的 `OPENCODE_DB`，使同一 fixture 中先后启动的
`opencode run` 与 `opencode db` 子进程稳定读取同一个临时数据库。该改动只影响测试环境，
不改变生产数据库路径解析。

模块三实际验证记录：

- 按测试先行执行：旧实现下 transform 新增用例为 `4 pass, 15 fail`，暴露 reasoning
  默认值仍为 32k、`output=0` catalog 产生 `-1`、normalizer 不存在；compaction、
  Copilot bounds/config merge 和 LLM request 用例也分别观察到旧 reservation、非法 high、
  动态 cap 被覆盖以及 request/budget 不共享 envelope；
- 首次真实 Anthropic wire 测试没有按原计划得到 131,072，而是得到
  `249,036 = 131,072 + 117,964`。检查当前 AI SDK 源码确认 Anthropic 与 Bedrock
  transport 会在序列化时把 numeric thinking budget 加回标准化 `maxOutputTokens`。方案据此
  增加 `transportMaxOutputTokens()`：normalizer 仍以 core total envelope `E` 计算，
  已知 add-back transport 改传 `E-B`；修正后真实 wire 为
  `13,108 + 117,964 = 131,072`；
- 五维审核补查官方 Gemini 范围后增加 Pro/Flash-Lite minimum 红测；旧 helper 在
  `E=200` 的 Pro 请求中产生非法 budget 1，补全静态 minimum 后转绿；
- `test/provider/transform.test.ts` 全量 `316 pass, 0 fail`；
  `test/provider/provider.test.ts` 全量 `97 pass, 0 fail`；
  GitHub Copilot/Codex/Cloudflare plugin 文件分别为 `8/17/4 pass, 0 fail`；
  `test/session/compaction.test.ts` 为 `56 pass, 1 skip, 0 fail`；
  `test/session/llm.test.ts` 为 `34 pass, 0 fail`；模块三合计
  `532 pass, 1 skip, 0 fail, 1,134 assertions`；
- `packages/opencode` 的 `bun run typecheck` 通过；10 个模块三 TypeScript 文件已执行
  Prettier；`git diff --check` 通过；全仓 oxlint 为 `0 error`（仓库当前仍有既有 warning，
  本轮未顺带清理）；模块三代码、测试及当时的方案回填已提交为 `77e509e81`。

最终文档与全修复回归记录：

- 英文 `packages/web/src/content/docs/cli.mdx` 已新增 output token limit 说明，明确
  `limit.output=0` 的 32,000 fallback、reasoning 默认模型上限、显式环境变量 cap、
  numeric `max` 的 10%/4,096 headroom、provider minimum 降级/本地失败、compaction、
  延迟/quota 影响以及 plugin 最终覆盖；
- 按 `.opencode/command/translate.md` 和 locale glossary 同步全部 17 个现有本地化
  `cli.mdx`；18 份文档均保留相同的配置键、数值和 `chat.params`/`maxOutputTokens`
  技术标识，并通过 Prettier 与 `git diff --check`；
- `packages/opencode` 的 `bun run typecheck` 最终通过；
- 从 `packages/web` 执行 `bun run build` 最终通过：Astro 成功解析 18 种语言、生成
  648 个页面并建立 Pagefind 索引；构建只报告仓库既有的 Starlight override、
  Vite externalization 和部分语言无 stemming 支持警告；
- 12 个受影响完整测试文件最终有效结果为 `687 pass, 2 skip, 0 fail`。首次合并运行
  有 14 个 CLI 子进程用例因启动命令没有把 Bun 目录放入子进程 `PATH` 而统一报
  `Executable not found in $PATH: "bun"`；使用既定 PATH 环境完整重跑 CLI 文件后为
  `15 pass, 0 fail`，确认属于测试启动环境错误，不是产品回归；
- 最终五维审核通过：实现与修正方案/CLI 契约一致；格式与本地化结构一致；固定字段路径、
  本地配置失败和 XML-like 转义未引入新的 CWE 风险；request 只计算一次 core envelope，
  numeric normalization 最多遍历六条固定路径；Session/Task/Provider 职责边界和 plugin
  最终覆盖点保持清晰。审核中发现并修正文档对 `limit.output=0` sentinel 的歧义。

## 第七部分：代码更新清单

| 文件                                                          | 函数 / 位置                                                                              | 改动概述                                                                                                                           | 状态                                                                                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/session/processor.ts`                  | `step-finish` / `halt`                                                                   | 在同一次 message 更新中生产 OutputLengthError；后续 processor failure 不覆盖已有终态或重复发事件                                   | 已改并通过，提交 `0d75454b2`                                                                                              |
| `packages/opencode/src/session/prompt.ts`                     | process 后终态优先级                                                                     | length error 早于 structured success；只消费错误，不重复发布                                                                       | 已改并通过，提交 `0d75454b2`                                                                                              |
| `packages/opencode/src/tool/task.ts`                          | `runTask` / failure formatter / `renderOutput`                                           | 固定终态优先级；length 诊断与有界 visible excerpt；不泄漏 reasoning；统一转义 XML-like 动态内容                                    | 已改并通过，提交 `4dada962e`                                                                                              |
| `packages/opencode/src/provider/transform.ts`                 | `variants` / `maxOutputTokens` / `normalizeReasoningBudget` / `transportMaxOutputTokens` | `output=0` catalog fallback；reasoning 默认模型上限；numeric max 按 headroom/bounds 归一化；已知 SDK add-back transport 使用 `E-B` | 已改并通过，提交 `77e509e81`                                                                                              |
| `packages/opencode/src/provider/provider.ts`                  | Copilot config variant merge                                                             | 合并前保留动态远端 max；合并后恢复不可覆盖/禁用的 max contract，并 clamp custom numeric variant 到远端 cap                         | 已改并通过，提交 `77e509e81`                                                                                              |
| `packages/opencode/src/plugin/github-copilot/models.ts`       | remote numeric variants                                                                  | 使用远端 min/max 生成合法 high/max；bounds 矛盾时不暴露 numeric variant；max cap 供后续 merge/request 使用                         | 已改并通过，提交 `77e509e81`                                                                                              |
| `packages/opencode/src/session/llm/request.ts`                | merged options / `chat.params`                                                           | core `E` 只计算一次；以 Effect 捕获配置失败；hook 前完成 numeric normalization 和 transport `S` 适配                               | 已改并通过，提交 `77e509e81`                                                                                              |
| `packages/opencode/test/lib/llm-server.ts`                    | `Reply` / usage fixture                                                                  | 增加测试用 `length()` finish helper；支持可选 reasoning usage 明细                                                                 | `length()` 已改并通过，提交 `0d75454b2`；模块三未需要扩展共享 usage fixture，真实 wire 用例使用局部 Anthropic SSE fixture |
| `packages/opencode/test/session/processor-effect.test.ts`     | processor regression                                                                     | 覆盖共享 length normalization、事件投递和后续 secondary failure 不覆盖                                                             | 已改并通过，提交 `0d75454b2`                                                                                              |
| `packages/opencode/test/session/prompt.test.ts`               | session regression tests                                                                 | 覆盖无 text、partial、上一轮已完成 tool、StructuredOutput 优先级和不重放                                                           | 已改并通过，提交 `0d75454b2`                                                                                              |
| `packages/opencode/test/session/compaction.test.ts`           | compaction/overflow tests                                                                | 覆盖 length summary 和两种 context reservation 公式                                                                                | length summary 提交 `0d75454b2`；overflow 公式提交 `77e509e81`                                                            |
| `packages/opencode/test/tool/task.test.ts`                    | Task regression tests                                                                    | 覆盖错误优先级、取消、前后台、promotion、durable partial bounds/privacy、markup 注入和正常完成                                     | 已改并通过，提交 `4dada962e`                                                                                              |
| `packages/opencode/test/provider/transform.test.ts`           | max output/budget tests                                                                  | 覆盖 fallback、numeric shapes、min/max/小 E/Copilot/high-custom/identity/immutability/determinism/transport add-back               | 已改并通过，提交 `77e509e81`                                                                                              |
| `packages/opencode/test/provider/provider.test.ts`            | Copilot variant merge test                                                               | 验证动态远端 max 不被用户覆盖或禁用，high/custom 不越 cap，其他 provider merge 不变                                                | 已改并通过，提交 `77e509e81`                                                                                              |
| `packages/opencode/test/session/llm.test.ts`                  | request body tests                                                                       | 验证 SDK 入参 `S` + numeric budget = core `E`、真实 wire total、配置失败、effort identity 和 plugin override                       | 已改并通过，提交 `77e509e81`                                                                                              |
| `packages/opencode/test/cli/run/run-process.test.ts`          | CLI subprocess regression                                                                | 固化真实 provider/child Session/Task/parent/DB 全链路和顶层 length 行为                                                            | 顶层 length 已提交（`0d75454b2`）；subagent 全链路已提交（`4dada962e`）                                                   |
| `packages/opencode/test/lib/cli-process.ts`                   | isolated CLI fixture environment                                                         | 为同一 fixture 的 run/db 子进程固定共享的临时 `OPENCODE_DB`，保持测试间隔离                                                        | 已改并通过，提交 `4dada962e`                                                                                              |
| `packages/opencode/test/acp/service-session.test.ts`          | ACP stop reason regression                                                               | 验证 OutputLengthError 激活既有 `max_tokens` 映射                                                                                  | 已改并通过，提交 `0d75454b2`                                                                                              |
| `packages/opencode/test/plugin/cloudflare.test.ts`            | existing override tests                                                                  | 运行既有 maxOutputTokens 删除/保留断言                                                                                             | 已全量通过（4 pass，模块三）                                                                                              |
| `packages/opencode/test/plugin/codex.test.ts`                 | Codex override test                                                                      | 补 `chat.params` 删除 maxOutputTokens 的直接断言                                                                                   | 已改并通过，提交 `77e509e81`                                                                                              |
| `packages/opencode/test/plugin/github-copilot-models.test.ts` | Copilot override/bounds test                                                             | 补 maxOutputTokens override；远端 min/max 生成合法 variant，矛盾 bounds 不生成 numeric variant，min 不被误报为 request metadata    | 已改并通过，提交 `77e509e81`                                                                                              |

以上清单已按三个实现提交逐项回填；最终 CLI 文档、本地化和本文件回填已完成并纳入本轮
文档提交。

明确不计划修改：

- `packages/core/src/v1/session.ts`
- `packages/schema/src/v1/session.ts`
- generated SDK 文件
- `packages/core/src/background-job.ts`
- `packages/opencode/src/session/compaction.ts`

理由：所需错误类型、BackgroundJob 状态机和 compaction 的
`processor.message.error → stop`/`!error` 过滤已经存在；numeric budget 通过 request-local
normalization 复用既有 provider option 形状，不新增 session schema，也不改写
effort/adaptive 协议。

## 第八部分：文档更新清单

| 文档路径                                   | 要改什么                                                                                                                                         | 状态                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `docs/fixes/subagent-fix-output-length.md` | 修复后回填测试、代码、文档状态及偏差决策                                                                                                         | 模块一至三提交和最终测试/构建/五维审核均已回填，已完成         |
| `packages/web/src/content/docs/cli.mdx`    | 澄清环境变量覆盖 core default；reasoning 默认模型上限；numeric `max` 的配置级 headroom/最小值降级；compaction、延迟、quota 风险；plugin 最终覆盖 | 已同步并通过 Astro 生产构建                                    |
| 现有本地化 `cli.mdx`                       | 按 `.opencode/command/translate.md` 同步英文改动，保留变量名和技术术语                                                                           | 17 个现有 locale 已按各自 glossary 同步，18 种语言生产构建通过 |

契约变更说明：

- `MessageOutputLengthError` schema 没有变化，只是从未生产变为在正确条件下生产；
- Task 的现有 `state="error"` vocabulary 没有变化，但所有 terminal assistant error 都不再
  被降格为 completed；`MessageAbortedError` 通过 interrupt-only Effect 保持
  BackgroundJob cancelled，前台沿用 `Task cancelled` failure，后台沿用不注入通知的行为；
- `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` 仍是 core default calculation 的显式最大值，
  不是不可被 provider hook 覆盖的最终 wire-level hard cap；
- reasoning 模型未配置该变量时的默认输出上限发生变化，因此必须在本修正方案和 CLI
  文档中明确；
- 已知 provider 上名为 `max` 的 numeric variant，其 budget 契约发生变化：使用本次 core
  max output，以 10%/4,096 为请求级 headroom 目标，并遵守 provider numeric bounds；
- provider minimum 与目标冲突时允许明确降级；不存在合法值时请求准备本地失败；
- 合法 `high`/custom numeric 不提高，非法低值本地失败，
  effort/adaptive/thinking-level 契约不变；
- 对已确认会自动把 numeric thinking budget 加回标准化 max output 的 Anthropic/Vertex
  Anthropic/Bedrock Anthropic transport，`chat.params` 前的 SDK 参数为 `S=E-B`，保证
  transport 未被 plugin 覆盖时最终 provider total max 不超过 core `E`；
- Task XML vocabulary 不变，但所有动态 attribute/element 内容开始统一转义；
- chat.params plugin 仍是 max output 和 provider options 的最终覆盖层，core 只保证 hook
  输入的 options 已 normalization，且 maxOutputTokens 已完成 transport 适配。

本修复不属于已有带 `expectations.md` 的子计划，未发现需要同步的
`docs/audits/<subplan-id>/expectations.md`。

## 实施顺序与确认门

严格按以下单步推进：

1. SessionProcessor/prompt length 终态 + processor/普通 Session/compaction/顶层 CLI/ACP 回归测试；
2. 用户确认；
3. Task 全 assistant error 前后台传播、终态优先级、有界 partial 诊断、XML-like 转义 +
   Task/真实 subagent CLI 回归测试；
4. 用户确认；
5. Provider reasoning core 输出上限 + catalog fallback + Copilot cap-preserving variant merge +
   numeric budget normalization/本地配置失败 + transform/request/compaction/plugin 测试；
6. 用户确认；
7. 文档及本地化同步、相关测试、opencode typecheck、web build、五维代码审核；
8. 回填本文件第六、七、八部分。

任何一步发现需要改变错误 schema、Task 状态 vocabulary、自动续写策略或 BackgroundJob
接口，或者必须把 effort/adaptive 控制换算成 numeric budget、递归改写未知 provider 字段、
新增通用模型 reasoning-bound schema 或产品级 hard cap，必须暂停并先更新本方案文档，
不能直接扩大实现范围。
