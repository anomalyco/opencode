/**
 * OpenCode Workflows —— 跨模块共享核心类型定义。
 *
 * 本文件汇总 ScriptLoader、Orchestration_API、Agent_Executor、State_Store 等模块
 * 共享的数据结构，作为各模块之间的类型契约单一来源（single source of truth）。
 *
 * 类型形状严格对应技术设计文档 design.md 的「Components and Interfaces」与
 * 「Data Models」两节，不得擅自增删字段。
 *
 * 注：本文件仅包含类型/接口声明（type-only），不含任何运行时代码，
 * 因此即使包 tsconfig 尚未就绪也可独立通过类型检查。
 *
 * @see .kiro/specs/opencode-workflows/design.md — Components and Interfaces / Data Models
 * Requirements: 7.2
 */

// ============================================================================
// JSON Schema（结构化输出模式）
// ============================================================================

/**
 * 结构化输出所用的 JSON Schema 描述。
 *
 * 采用结构化字段 + 索引签名的开放式定义：既覆盖常见关键字（type/properties/
 * items/required/enum 等），又允许携带任意额外的 JSON Schema 关键字
 * （如 `minLength`、`additionalProperties`、`$ref` 等），保持灵活可扩展。
 */
export interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema | JsonSchema[]
  required?: string[]
  enum?: unknown[]
  /** 允许携带任意额外的 JSON Schema 关键字 */
  [key: string]: unknown
}

// ============================================================================
// Workflow 元数据（ScriptLoader）
// ============================================================================

/**
 * Workflow 元数据声明（`export const meta = {...}`）。
 *
 * 要求为纯字面量对象（不允许变量引用、函数调用、展开运算符或模板插值），
 * 以保证「纯字面量」约束静态可判定（R1.6、R2.1）。
 */
export interface WorkflowMeta {
  /** 必需，非空，≤64 字符 */
  name: string
  /** 必需，非空，≤256 字符 */
  description: string
  /** 可选，≤20 个元素 */
  phases?: PhaseDefinition[]
  /** 可选，≤512 字符；作为使用场景说明显示在 workflow 列表中 */
  whenToUse?: string
  /**
   * 可选，默认产物落盘的友好文件名（不含扩展名），≤64 字符，禁含路径分隔符 `/`/`\` 与 `..`。
   *
   * 用户未在 `<name>.config.json` 配 `output_path` 时，框架默认落盘到 `docs/<outputName>.md`
   * （缺省则回退 `docs/<name>.md`）。使内置/自定义 wf 的默认产出文件名更易理解（如
   * "产品需求文档" → `docs/产品需求文档.md`）。落盘内容仍由脚本决定，不消费 outputPath 的 wf 忽略。
   */
  outputName?: string
}

/**
 * 阶段定义。供 TUI_Panel 按阶段分组显示 Agent 进度（R2.2）。
 */
export interface PhaseDefinition {
  /** 必需，非空 string */
  title: string
  /** 可选，阶段说明 */
  detail?: string
  /** 可选，阶段默认模型 */
  model?: string
}

// ============================================================================
// 编排 API 选项（Orchestration_API）
// ============================================================================

/**
 * agent() 的可选参数。
 *
 * 注：`opts.isolation: 'worktree'` 第一版不实现，故此处不声明该字段。
 */
export interface AgentOptions {
  /** TUI 进度树显示标签 */
  label?: string
  /** 显式归属阶段（parallel/pipeline 内部必须使用，避免竞争全局 phase） */
  phase?: string
  /** 结构化输出 Schema */
  schema?: JsonSchema
  /** 模型覆盖，默认继承主 session 模型 */
  model?: string
  /** 自定义 Agent 类型，从 Agent 注册表解析，可与 schema 组合 */
  agentType?: string
  /** 单 Agent 超时（ms），默认 300_000 */
  timeout?: number
  /** 关键步标记：重试耗尽后仍 null 时抛 REQUIRED_STEP_FAILED 终止 run（默认 false）。 */
  required?: boolean
}

// ============================================================================
// Agent 执行结果（Agent_Executor）
// ============================================================================

/**
 * 单个 Agent 任务的执行结果。
 *
 * 注：token 用量字段依赖 `session.prompt()` 是否回传 input/output token，
 * 该依赖尚待验证（见 design.md 待验证依赖表），不回传时按降级方案处理。
 */
export interface AgentResult {
  /** string 或结构化对象 */
  output: unknown
  /** input/output token 用量（待验证回传，降级见风险表） */
  tokens: { input: number; output: number }
  /** 从 session.prompt 发起到响应返回的耗时（ms） */
  durationMs: number
  /** 实际使用的模型 */
  model: string
}

// ============================================================================
// 运行状态与快照（State_Store）
// ============================================================================

/**
 * Run 状态枚举。
 *
 * `paused` 为**非终态**：表示 Workflow 被显式暂停，后续可经 resume 续跑，
 * 也可从 paused 进一步 finalize 到 `cancelled`/`failed`。终态集合
 * （`TERMINAL_STATUSES`）不含 `paused`（R4.1）。
 *
 * `pausing` 为**非终态过渡态**（FIX-1 / BUG-007 / BUG-006）：用户按下暂停后，由于 JS 无
 * 协程、暂停采用「检查点停止」语义——当前正在跑的 Agent 要等跑到「下一个 agent 边界」才
 * 真正停下并落 `paused`。`pausing` 表示「已收到暂停请求、正在等待当前 Agent 到达检查点」，
 * 让 Monitor/面板能立刻显示「⏸ 暂停中…」而不是让用户误以为暂停失灵。`pausing` 同样可经
 * resume 翻回 running、可被 cancel 终止；终态集合不含 `pausing`。
 */
export type RunStatus = "running" | "completed" | "failed" | "cancelled" | "paused" | "pausing"

/**
 * Run Snapshot —— 每次 Workflow 执行的完整状态快照，
 * 持久化为 `.opencode/workflows/runs/wf_<runId>.json`。
 */
export interface RunSnapshot {
  /** 不含 wf_ 前缀（wf_ 仅用于文件名） */
  runId: string
  workflowName: string
  status: RunStatus
  /**
   * 本次运行的需求/提示词原文（来自 `/workflows-run` 第二步 DialogPrompt 收集的
   * `args.feature`），用于在 monitor/Sidebar/反馈消息中区分**同名 workflow 的多次运行**。
   *
   * 落盘时按上限截断（见 createRun 的 `MAX_LABEL_LEN`）以防超长文本。展示侧用
   * `deriveRunLabel()` 智能提取简短标签（首行/首句、路径取文件名、再限长）。
   * 旧快照或未传 feature 时缺省（可选，向后兼容）。
   */
  label?: string
  /**
   * 本次运行的**完整原始入参**（来自 `/workflows-run` 收集的 `args`，含 `feature` 等）。
   *
   * 与 `label`（仅截断后的需求摘要、不可逆）不同，此字段保留可序列化的完整 args，供
   * **resume 精确重建 prompt**：resume 若以 `args=undefined` 重跑，内置 workflow 读
   * `ctx.args.feature` 会回退默认值 → 重建的 prompt 与 Journal 的 `started.prompt` 失配
   * → 缓存复用前缀终止（全部重跑且用错误需求文本）。落盘前经 JSON 往返过滤不可序列化值；
   * 旧快照或不可序列化时缺省（可选，向后兼容）。
   */
  args?: unknown
  /**
   * 审计用内嵌脚本副本；超过可配置大小阈值时允许截断，
   * 完整来源为 scriptPath 指向的归档文件（R7.2）。
   */
  script: string
  scriptPath: string
  result: unknown | null
  error: string | null
  startTime: number
  endTime: number | null
  durationMs: number | null
  /**
   * 最近一次心跳时间戳（ms）。由后台执行进程在运行期间定期刷新并落盘，用于
   * **崩溃恢复 / 孤儿 run 检测**（R3.x crash recovery）：
   *
   * - 持有此 run 的进程存活时，心跳持续更新；
   * - 进程崩溃 / 被强制结束后，心跳停滞；
   * - 另一进程启动时扫描 `status==="running"` 的快照，若 `heartbeatAt`（缺省回退
   *   到 `startTime`）距今超过孤儿超时阈值，判定为孤儿并标记 `failed`。
   *
   * 旧 Snapshot 无此字段（可选，向后兼容）；缺省时回收逻辑以 `startTime` 兜底。
   */
  heartbeatAt?: number
  agentCount: number
  /** input_tokens + output_tokens 之和（成本统计/UI 口径） */
  totalTokens: number
  phases: PhaseDefinition[]
  /** 进度条目数组（R7.2/R7.6 字段名为 workflowProgress） */
  workflowProgress: ProgressEntry[]
  logs: string[]
}

// ============================================================================
// 进度条目（State_Store / TUI_Panel）
// ============================================================================

/** 进度条目联合类型 */
export type ProgressEntry = PhaseProgress | AgentProgress

/** 阶段进度条目 */
export interface PhaseProgress {
  type: "workflow_phase"
  index: number
  title: string
}

/** Agent 进度条目 */
export interface AgentProgress {
  type: "workflow_agent"
  index: number
  label: string
  phaseIndex: number
  phaseTitle: string
  model: string
  state: "running" | "done" | "failed"
  /** 该 agent 的 input+output 之和 */
  tokens: number
  durationMs: number
  /**
   * 该 agent 对应的 OpenCode 子 session id（R 第二期）。
   * 由 AgentExecutor 在创建子 session 后经回调回填，供 Workflow Monitor 经
   * `client.session.messages(sessionID)` 拉取该 agent 的完整会话日志（工具调用等）。
   * 旧 Snapshot 无此字段（可选，向后兼容）。
   */
  sessionID?: string
}

// ============================================================================
// Journal 事件（State_Store / Resume_Engine）
// ============================================================================

/**
 * Journal 条目 —— 落盘到 `.opencode/workflows/journal/<runId>/journal.jsonl`。
 *
 * started 事件携带 prompt/phase/opts；result 事件携带 result/error/
 * input_tokens/output_tokens/durationMs（token 分别记录，R7.5、R14.1）。
 * 按事件实际发生顺序 append；agentIndex 作为对齐键用于按 index 分组重建状态。
 */
export interface JournalEntry {
  eventType: "agent_started" | "agent_result"
  agentIndex: number
  timestamp: number
  // ---- started 事件字段 ----
  prompt?: string
  phase?: string
  opts?: AgentOptions
  /**
   * 该 agent 对应的 OpenCode 子 session id（R 第二期）。
   * 在 agent_started 事件上携带，供 Resume / Monitor 关联 agentIndex ↔ sessionID。
   * 旧 Journal 无此字段（可选，向后兼容）；Resume 不依赖此字段做配对判定。
   */
  sessionID?: string
  // ---- result 事件字段 ----
  result?: unknown
  error?: string
  /** 分别记录（R7.5） */
  input_tokens?: number
  /** 分别记录（R7.5） */
  output_tokens?: number
  durationMs?: number
  /**
   * 实际使用的模型（providerID/modelID，来自 session.prompt 信封 info）。
   * Resume 复用路径据此重建进度条目的 model 字段（旧 Journal 无此字段，向后兼容——
   * 恢复时回退 started 记录的 opts.model，再回退空串）。
   */
  model?: string
}

// ============================================================================
// Workflow 运行时配置（WorkflowEngine）
// ============================================================================

/**
 * Workflow 引擎运行时配置。
 *
 * 字段与 design.md 的 `WorkflowEngineConfig` 一一对应，作为从配置文件
 * 读取运行时参数的契约（R14.6）。
 */
export interface WorkflowConfig {
  /** 最大并发 Agent 数，默认 min(16, cpu_cores - 2)，最小 1 */
  maxConcurrency: number
  /** 单 Workflow Agent 调用上限（防失控循环安全阀），默认 1000 */
  maxAgents: number
  /**
   * 单 Agent 超时时间（ms）。默认 `null`（**不限制单 Agent 运行时间**）——不同任务耗时差异
   * 很大（写测试/跑测试/大重构等可能耗时很久），框架不应强行墙钟打断。
   * 设为正数可启用超时（超时则 `session.abort()` 并将该 Agent 结果置 null）；
   * `null` 或 `<= 0` 表示关闭。亦可经单步 `ctx.agent(prompt, { timeout })` 局部启用。
   */
  agentTimeout: number | null
  /**
   * Workflow 整体超时时间（ms），默认 604_800_000（168 小时 / 7 天）。
   * 设为 `null` 或 `<= 0` 表示**关闭**整体超时（长跑 workflow 不被墙钟打断）。
   */
  workflowTimeout: number | null
  /** 结构化输出 Schema 验证失败重试上限，默认 2 */
  schemaRetries: number
  /** 持久化根目录，默认 ".opencode/workflows" */
  storageRoot: string
  /**
   * 运行期心跳写入间隔（ms），默认 10_000（10s）。后台执行进程按此间隔刷新
   * {@link RunSnapshot.heartbeatAt} 并落盘，作为「进程存活」信号。
   * 设为 `null` 或 `<= 0` 表示**关闭**心跳（同时不进行孤儿回收）。
   */
  heartbeatIntervalMs: number | null
  /**
   * 孤儿 run 判定超时（ms），默认 60_000（60s，约心跳间隔的 6 倍）。引擎装配时
   * 扫描 `status==="running"` 的快照，若其 `heartbeatAt`（缺省回退 `startTime`）
   * 距今超过此阈值，判定持有进程已死，标记该 run 为 `failed`。
   * 设为 `null` 或 `<= 0` 表示**关闭**孤儿回收。
   */
  orphanTimeoutMs: number | null
  /**
   * 日志能力配置（workflow-logging spec 新增，可选，向后兼容）。
   *
   * 缺省时日志默认启用、最小级别回退 `INFO`、落盘根目录复用
   * {@link WorkflowConfig.storageRoot}。详见 {@link WorkflowLoggingConfig}。
   */
  logging?: WorkflowLoggingConfig
}

/**
 * 日志能力运行时配置（workflow-logging spec 新增）。
 *
 * 经运行时配置（插件 options）的 `logging` 字段提供，全部字段可选以保持向后
 * 兼容：缺省时日志默认启用、最小输出级别回退 `INFO`。
 *
 * @see .kiro/specs/workflow-logging/design.md — Data Models / WorkflowConfig 扩展
 * Requirements: 2.6, 2.7, 8.2, 8.3, 8.4, 8.5
 */
export interface WorkflowLoggingConfig {
  /**
   * 最小输出级别字符串（R2.6 / R8.2）；取值精确等于 `DEBUG`/`INFO`/`WARN`/
   * `ERROR` 四档之一时生效，非法 / 缺失 / 空串 / 未知字符串回退 `INFO`（R2.7）。
   */
  level?: string
  /**
   * 关闭日志开关（R8.4 / R8.5）；缺省 / `true` = 启用，`false` = 关闭。
   * 关闭时装配层把注入核心模块的 WF_Logger 替换为 No_Op_Logger。
   */
  enabled?: boolean
}

// ============================================================================
// 企业配置桥接（ConfigLoader / workflows.config.json）
// ============================================================================

/**
 * 配置值：单字符串或字符串数组（本地文件路径）。
 *
 * 单值与数组等价处理（数组表示多个资源叠加，顺序保持）。
 *
 * @see .kiro/specs/workflow-enhancements/design.md — Data Models / 模型 1
 */
export type ConfigValue = string | string[]

/**
 * 单 workflow 配置文件 `<name>.config.json` 的原始形状（解析前）。
 *
 * workflow-create-studio：从「`workflows.config.json` 多块 + 两层合并」改为
 * 「一个 workflow 一个独立配置文件」（`~/.opencode-workflows/<name>.config.json`，
 * 按 workflow 名索引）。仅含**外部资源的本地文件路径**与**产出落盘路径**；
 * 所有行为参数仍由 workflow 脚本自身定义。
 *
 * 资源建模为**开放命名字典** `resources`（任意类别名 → 路径或路径数组），
 * 并保留 `template`/`rules`/`review` 作为**知名类别别名**（向后兼容，供内置
 * `default-*` 继续使用）。`resourceLabels` 为各自定义类别提供「引导子 Agent
 * 如何使用该资源」的提示语。
 *
 * @see .kiro/specs/workflow-create-studio/design.md — Data Models / RawConfigBlock 新形状
 * Requirements: 7.1, 10.1, 10.2, 10.3
 */
export interface RawConfigBlock {
  /**
   * 纯 per-phase 资源配置（嵌套字典）：阶段名 → { 类别名 → 路径或路径数组 }。
   *
   * 采用纯 per-phase 设计，不再支持全局扁平字典。每个阶段独立配置资源类别，
   * 未配置的阶段/类别返回空数组。ConfigLoader 检测到旧格式（扁平字典）时拒绝解析。
   */
  resources?: Record<string, Record<string, ConfigValue>>
  /**
   * 纯 per-phase 资源引导语（嵌套字典）：阶段名 → { 类别名 → 引导语 }。
   *
   * 为各阶段的各资源类别提供「如何使用该资源」的提示语，供 renderScript 生成
   * 引导子 Agent 的 prompt 时使用。未配置时使用默认引导语。
   */
  resourceLabels?: Record<string, Record<string, string>>
  /**
   * 纯 per-phase 产出落盘路径（字典）：阶段名 → 该阶段的落盘路径模板（含 `<FEATURE>`/`<RUNID>` 占位符）。
   *
   * 采用纯 per-phase 设计，不再支持全局 string 模式。每个阶段独立配置落盘路径，
   * 未配置的阶段不落盘。ConfigLoader 检测到旧格式（string）时拒绝解析。
   */
  output_path?: Record<string, string>
  /**
   * 纯 per-phase 审查门控最大轮次（字典）：阶段名 → 该阶段的轮次（1-10）。
   *
   * 采用纯 per-phase 设计，不再支持全局 number 模式。每个阶段独立配置审查轮次，
   * 未配置的阶段使用默认值 3。ConfigLoader 检测到旧格式（number）时拒绝解析。
   */
  max_review_rounds?: Record<string, number>
}

/**
 * 解析后的配置块，作为 `ctx.config` 注入脚本（路径已绝对化）。
 *
 * 框架只产出**绝对路径**，不含文件内容（内容由子 agent 用 `read` 工具读取）。
 * 资源未配置/非法 → 空数组（脚本据此回退到自带的内置默认）。
 *
 * 值解析规则（仅本地路径，无 `default`、无 MCP）：
 * - `"none"` / `""` / `[]` / 未配置 → 空数组；
 * - 任意非空字符串按本地文件路径处理（相对路径以 projectRoot 绝对化，绝对路径规范化保留）；
 * - 数组逐元素解析后叠加（concat，顺序保持）。
 *
 * **知名三类双暴露（R16.4 等价性关键）**：`template`/`rules`/`review` 既经顶层别名字段
 * 暴露（旧式 `ctx.config.template`），也镜像到 `resources.template`/`...rules`/`...review`
 * （新式 `ctx.config.resources.template`），二者指向内容相等的绝对路径数组。
 *
 * @see .kiro/specs/workflow-create-studio/design.md — Data Models / ResolvedConfigBlock 新形状
 * Requirements: 10.5, 10.6, 16.4
 */
export interface ResolvedConfigBlock {
  /**
   * 纯 per-phase 资源字典：阶段名 → { 类别名 → 绝对路径数组 }。
   *
   * ConfigLoader 从 RawConfigBlock.resources 解析而来，每个阶段每个类别为独立的
   * 绝对路径数组。未配置/非法 → 空数组。脚本消费：`ctx.config.resourcesByPhase[phase][category] ?? []`。
   */
  resourcesByPhase: Record<string, Record<string, string[]>>
  /**
   * 纯 per-phase 资源引导语：阶段名 → { 类别名 → 引导语 }。
   *
   * 供 renderScript 生成引导子 Agent 的 prompt 时使用。未配置时使用默认引导语。
   */
  resourceLabelsByPhase: Record<string, Record<string, string>>
  /**
   * 纯 per-phase 产出落盘路径：阶段名 → 该阶段的落盘绝对路径模板（含占位符）。
   *
   * ConfigLoader 从 RawConfigBlock.output_path 解析而来，逐阶段处理占位符模板。
   * 未配置的阶段不落盘。脚本消费：`ctx.config.outputPathByPhase[phase]`（无回退）。
   */
  outputPathByPhase: Record<string, string>
  /**
   * 纯 per-phase 审查门控最大轮次：阶段名 → 已钳制 [1,10] 的轮次。
   *
   * ConfigLoader 从 RawConfigBlock.max_review_rounds 解析而来，逐阶段钳制到 [1,10]。
   * 未配置的阶段使用默认值 3。脚本消费：`ctx.config.maxReviewRoundsByPhase[phase] ?? 3`。
   */
  maxReviewRoundsByPhase: Record<string, number>
  
  // ---- 旧版兼容字段（已废弃，保留空值以避免脚本报错）----
  /** @deprecated 已废弃，统一使用 resourcesByPhase */
  resources: Record<string, string[]>
  /** @deprecated 已废弃，统一使用 resourceLabelsByPhase */
  resourceLabels: Record<string, string>
  /** @deprecated 已废弃，统一使用 resourcesByPhase */
  template: string[]
  /** @deprecated 已废弃，统一使用 resourcesByPhase */
  rules: string[]
  /** @deprecated 已废弃，统一使用 resourcesByPhase */
  review: string[]
  /** @deprecated 已废弃，统一使用 outputPathByPhase */
  outputPath: string | null
  /** @deprecated 已废弃，统一使用 maxReviewRoundsByPhase */
  maxReviewRounds: number
}

// ============================================================================
// 引导式脚手架（WorkflowScaffolder / Workflow Studio「新建」）
// ============================================================================

/**
 * 单个步骤的编排模式。
 *
 * @see .kiro/specs/workflow-enhancements/design.md — Components and Interfaces / 组件 3
 */
export type StepKind =
  | "single" // 单个 agent()（一次子 Agent 调用）
  | "parallel" // parallel() 扇出：N 路并发，全部完成才汇合（检索/审查/编码均可）
  | "pipeline" // pipeline() 流水线：每个条目独立过多个 stage，无屏障
  | "gate" // 审查门控（Ralph Loop）：跑门控→未过则修正→重跑，直至通过或轮次耗尽
  | "subflow" // 内联调用另一个已注册 workflow（ctx.workflow(name, args)，嵌套一层）
  | "branches" // 异构并行步：各分支独立 intent/useConfig/agentType，并发后合并为命名 section 字符串
  | "adversarial" // 对抗式验证：N 反驳者按阈值杀产物
  | "finder-loop" // 挖到挖干：收敛轮次去重
  | "judge-panel" // 评审团：多角度起草+打分+综合

/**
 * 异构并行步的单个分支（`kind === "branches"` 时有效）。
 *
 * 与 parallel 的同质扇出不同：branches 的每个分支各自独立声明 intent / useConfig /
 * agentType，并发执行后由渲染层合并为带命名 section 的单一字符串，供下游经 usePrev 接力。
 *
 * @see .kiro/specs/scaffold-branches-multigate/design.md — Components and Interfaces / 组件 1
 * Requirements: 1.2
 */
export interface BranchSpec {
  /** 分支显示标签，同时用作合并 section 的标题与 ctx.agent 的 label。 */
  label: string
  /** 该分支的自然语言意图，渲染为本分支 ctx.agent prompt 主体。 */
  intent: string
  /** 该分支引用的资源类别名列表（任意已声明类别，含知名 template/rules/review）。 */
  useConfig?: string[]
  /** 该分支专精执行子 Agent（如 explore/librarian）；未设置则用框架默认。 */
  agentType?: string
}

/**
 * 多维门控的单个审查维度（`kind === "gate"` 且 `dimensions` 非空时有效）。
 *
 * @see .kiro/specs/scaffold-branches-multigate/design.md — Components and Interfaces / 组件 1
 * Requirements: 3.1
 */
export interface DimensionSpec {
  /** 维度名（如「模板遵循」/「设计一致性」），用于 issues 标注与维度对象 name。 */
  name: string
  /** 该维度的审查要点，渲染为该维度审查 prompt 主体。 */
  intent: string
  /** 该维度引用的资源类别名列表。 */
  useConfig?: string[]
  /** 该维度审查子 Agent（通常 momus）；未设置则用框架默认。 */
  agentType?: string
}

/**
 * 步骤可参考的**知名**企业配置资源种类（向后兼容别名）。
 *
 * workflow-create-studio：资源已扩展为开放命名字典，步骤的 `useConfig` 改为
 * 任意已声明类别名（`string[]`）。本类型保留为知名三类的别名常量，供内置
 * `default-*` 与默认引导语表（CONFIG_PROMPT_LABEL）继续使用。
 *
 * @see .kiro/specs/workflow-create-studio/design.md — Components and Interfaces / 组件 5
 */
export type ConfigResourceKind = "template" | "rules" | "review"

/**
 * 引导式定义的单个步骤。
 *
 * @see .kiro/specs/workflow-create-studio/design.md — Data Models / ScaffoldStep 扩展
 * Requirements: 8.4, 11.1, 14.3
 */
export interface ScaffoldStep {
  /**
   * 稳定唯一标识（路径 A，可选）。供其它步经 {@link ScaffoldStep.useSteps} 按 id 引用本步产物，
   * 重排/插删步骤后引用不失效。缺省时本步不可被具名引用（仅能经 usePrev 单步接力）。
   */
  id?: string
  /** 归属阶段标题（须是 phases 之一）。 */
  phase: string
  /** 编排模式。 */
  kind: StepKind
  /** 步骤显示标签（写入 agent() 的 label / 进度分组）。 */
  label: string
  /** 用户用自然语言描述「这步要干什么」→ 渲染为本步 agent() prompt 的主体。 */
  intent: string
  /** parallel/pipeline 的分支数（kind 为 parallel/pipeline 时有效，默认 3）。 */
  fanout?: number
  /** gate 的最大轮次（kind 为 gate 时有效，默认 3）；这是写进脚本的常量，非配置项。 */
  maxRounds?: number
  /** kind === "adversarial" 时有效：反驳达此数量即判产物不通过；缺省 ceil(fanout/2)。 */
  threshold?: number
  /** kind === "finder-loop" 时有效：连续无新增的收敛轮次；缺省 2。 */
  convergenceRounds?: number
  /** kind === "judge-panel" 时有效：起草角度列表；缺省取默认互异角度。 */
  perspectives?: string[]
  /** kind === "judge-panel" 时有效：综合提示语。 */
  synthesis?: string
  /** subflow 调用的已注册 workflow 名（kind 为 subflow 时必填，如 "default-prd"）。 */
  subflowName?: string
  /**
   * 本步要参考的资源类别名列表（R11.1）。**从固定三枚举扩展为任意已声明类别名**
   * （含知名 template/rules/review 与自定义类别）。renderScript 据此把
   * `ctx.config.resources[<类别>]` 的绝对路径与引导语拼进本步 prompt
   * （指示子 agent 用 read 读取）。空/缺省表示本步不引用任何配置资源。
   */
  useConfig?: string[]
  /**
   * 执行用子 Agent 名（R14.3）。仅允许 OpenCode 中 `mode` 为 `subagent`/`all` 的 Agent。
   * 设置后由 renderScript 渲染进该步 `ctx.agent(prompt, { agentType })`（R14.4）；
   * 未设置则由框架按默认 Agent 类型执行（R16.6）。
   */
  agentType?: string
  /**
   * 该步是否把「上一步结果」接力到本步 prompt（Agent 间通信）。
   * 默认 true：上一步返回值作为本步输入参数拼入 prompt。
   */
  usePrev?: boolean
  /**
   * 具名多上游引用（路径 A）：本步要引用的**更早**步骤的 {@link ScaffoldStep.id} 列表。
   * 非空时**取代** usePrev 单步接力——renderScript 把所引用各步产物合并为命名 section
   * （`=== <label> ===\n + str(stepN)`）拼入本步 prompt / 门控 artifact。
   * 仅保留「更早的、已声明 id 的」引用，忽略未知 id / 自引用 / 前向引用（渲染期防御 + Studio 校验）。
   * 缺省/空 → 回退 usePrev 语义（向后兼容，渲染产物逐字节不变）。
   */
  useSteps?: string[]
  /**
   * 异构并行分支列表（仅 `kind === "branches"` 时有效）。每个分支独立声明
   * intent / useConfig / agentType，并发执行后合并为命名 section 字符串。
   * 缺省/undefined 时不改变现有步骤行为（向后兼容，R1.3/R1.4）。
   */
  branches?: BranchSpec[]
  /**
   * 多维审查维度列表（仅 `kind === "gate"` 时有效）。非空 → 渲染为多维门控
   * `runMultiGate`；空数组或缺省 → 退化为现有单维 `runStopGate`（向后兼容，R3.2/R3.4）。
   */
  dimensions?: DimensionSpec[]
}

/**
 * 引导式创建收集到的答案（向导单一状态源 WizardState 的 answers 草稿）。
 *
 * workflow-create-studio：移除 `consumesConfig` 布尔，改为声明式资源字典
 * `resources` + `resourceLabels` + `outputPath`。空 `resources` 字典且无 `outputPath`
 * 等价于旧 `consumesConfig=false`（R16.1 等价性）。
 *
 * @see .kiro/specs/workflow-create-studio/design.md — Data Models / ScaffoldAnswers 扩展
 * Requirements: 8.1, 8.4, 10.3, 12.1
 */
export interface ScaffoldAnswers {
  /** workflow 名（kebab-case，已通过 validateName 校验不冲突）。 */
  name: string
  /** workflow 描述（meta.description）。 */
  description: string
  /** 阶段标题列表（meta.phases）；至少 1 个。 */
  phases: string[]
  /** 步骤列表（按顺序定义；用户可定义任意多步，每步选一种 kind）。 */
  steps: ScaffoldStep[]
  /**
   * 声明的资源类别字典（取代 consumesConfig 布尔，R12.1）：键为类别名，值为本地路径数组。
   * renderScript 据此判断哪些 `ctx.config.resources[<类别>]` 被消费；空字典等价于
   * 「不消费配置」（旧 consumesConfig=false 的等价形态，R16.1）。
   */
  resources: Record<string, string[]>
  /** 各资源类别引导语（R10.3）：类别名 → 引导子 Agent 如何使用该资源的提示语。 */
  resourceLabels: Record<string, string>
  /** 产出落盘路径模板（含 <FEATURE>/<RUNID> 占位）；空/缺省表示不落盘。 */
  outputPath?: string
  /** 自定义 args 参数名列表（运行时经 ctx.args 注入；如 ["maxItems", "targetDir"]）。 */
  args: string[]
}

/**
 * 名称校验结果。
 *
 * @see .kiro/specs/workflow-enhancements/design.md — Components and Interfaces / 组件 3
 * Requirements: 8.3
 */
export type NameValidation =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * 向导结构草稿（方案 C）：`<name>.draft.json` sidecar 承载的「结构性」字段子集。
 *
 * 仅含 name/description/phases/steps/args——**不含** resources/resourceLabels/outputPath
 * （那些由 `<name>.config.json` 承载，编辑时各自独立回填，互不覆盖）。draft-store.ts 的
 * 序列化/解析与本类型一一对应。
 */
export type DraftStructure = Pick<ScaffoldAnswers, "name" | "description" | "phases" | "steps" | "args">

// ============================================================================
// workflow-create-studio 全屏向导类型（create-state.ts / create-screen.tsx）
// ============================================================================

/**
 * 向导主步骤游标。配置编辑器（config）取代原「是否消费配置」布尔步（R12.1）。
 *
 * @see .kiro/specs/workflow-create-studio/design.md — Components and Interfaces / 1
 */
export type WizardStep = "name" | "desc" | "phases" | "steps" | "config" | "args" | "confirm"

/** 分步校验结果（与 NameValidation 同构）。 */
export type StepValidation = { ok: true } | { ok: false; reason: string }

/** agent 选择器候选项（create-screen 从 listAgents 拿到，喂给归约器，R14/R15）。 */
export interface AgentChoice {
  /** Agent 名（写入 ScaffoldStep.agentType）。 */
  name: string
  /** 仅 subagent/all 可作为 workflow 步骤执行 Agent（R14.2）。 */
  mode: "subagent" | "all"
  /** 静态扫描结果：permission ruleset 是否含 action 为 "ask" 的规则（R15.1）。 */
  hasAskRule: boolean
}

/** 单条资源类别草稿（配置编辑器编辑中，提交前可部分填充）。 */
export interface ResourceDraft {
  /** 归属阶段（per-phase：该资源类别挂在哪个阶段下，须 ∈ answers.phases，空回退首个阶段/Main）。 */
  phase: string
  /** 类别名（任意非空、同阶段内不与其他条目重复）。 */
  category: string
  /** 本地路径数组（可空 → 落盘占位 "none"）。 */
  paths: string[]
  /** 该类别引导语（可空 → renderScript 用默认引导语）。 */
  label: string
}

/** 单条已提交的资源类别条目。 */
export interface ResourceEntry {
  category: string
  paths: string[]
  label: string
}

/** 步骤草稿（编辑中的 ScaffoldStep，提交前可部分填充）。 */
export interface StepDraft {
  phase: string
  kind: StepKind
  label: string
  intent: string
  subflowName?: string
  /** 任意已声明资源类别名（R11.1）。 */
  useConfig: string[]
  fanout?: number
  maxRounds?: number
  threshold?: number
  convergenceRounds?: number
  perspectives?: string[]
  synthesis?: string
  /** 执行用子 Agent（R14.3）。 */
  agentType?: string
  usePrev?: boolean
  /** 稳定标识（路径 A）：供其它步以 useSteps 具名引用本步；重排/插删不失效。 */
  id?: string
  /** 引用的上游步 id 列表（路径 A）：非空时取代单步接力，须均为更早的步。 */
  useSteps?: string[]
  /** 编辑中的分支列表（branches kind 子编辑器维护，R6.5/R6.6）。 */
  branches?: BranchSpec[]
  /** 编辑中的维度列表（gate 多维子编辑器维护，R6.5/R6.6）。 */
  dimensions?: DimensionSpec[]
}

/** steps 编辑子界面的字段游标。 */
export type StepField =
  | "phase"
  | "kind"
  | "subflowName"
  | "label"
  | "intent"
  | "useConfig"
  | "useSteps" // 具名多上游引用列表整体（A2-full 多选控件以整列表写回）
  | "agentType"
  | "fanout"
  | "maxRounds"
  | "threshold"
  | "convergenceRounds"
  | "perspectives"
  | "synthesis"
  | "branches" // 分支列表整体（branches 子编辑器以整列表写回）
  | "dimensions" // 维度列表整体（多维 gate 子编辑器以整列表写回）

/** steps 子流程内部状态（仅 mainStep==="steps" 激活）。 */
export type StepEditorMode =
  | { kind: "list" }
  | { kind: "edit"; index: number; draft: StepDraft } // 新增时 index = steps.length

/** phases 子流程内部状态（仅 mainStep==="phases" 激活）。 */
export type ListEditorMode =
  | { kind: "list" }
  | { kind: "edit"; index: number; value: string } // 新增时 index = phases.length

/** config 子流程（资源类别列表编辑器）内部状态（仅 mainStep==="config" 激活）。 */
export type ResourceEditorMode =
  | { kind: "list" }
  | { kind: "edit"; index: number; draft: ResourceDraft } // 新增时 index = resources.length

/** 配置编辑器草稿：纯 per-phase 嵌套字典（取代旧 consumesConfig 布尔 + 联合类型，R12.1）。 */
export interface ConfigDraft {
  /**
   * 纯 per-phase 资源配置（嵌套字典）：阶段名 → { 类别名 → 路径数组 }。
   *
   * UI 按阶段列表展示，每个阶段下有资源类别子列表。用户可为每个阶段独立添加/删除类别。
   */
  resources: Record<string, Record<string, string[]>>
  /**
   * 纯 per-phase 资源引导语（嵌套字典）：阶段名 → { 类别名 → 引导语 }。
   *
   * 为各阶段的各资源类别提供「如何使用该资源」的提示语。
   */
  resourceLabels: Record<string, Record<string, string>>
  /**
   * 纯 per-phase 产出落盘路径（字典）：阶段名 → 该阶段路径模板字符串。
   *
   * UI 按阶段列表展示，每个阶段一个输入框。用户可为每个阶段独立配置落盘路径。
   */
  outputPath: Record<string, string>
  /**
   * 纯 per-phase 审查门控最大轮次（字典，输入态为字符串）：阶段名 → 轮次字符串（提交时转为数字）。
   *
   * UI 按阶段列表展示，每个阶段一个输入框。用户可为每个阶段独立配置审查轮次。
   * 提交时转换为 number 并钳制到 [1,10]。
   */
  maxReviewRounds: Record<string, string>
}

/** 左栏每步摘要（stepSummaries 投影，R2）。 */
export interface StepSummary {
  step: WizardStep
  /** 渲染为 ✔（done）/ ▶（current）/ 空（todo）（R2.3）。 */
  icon: "done" | "current" | "todo"
  title: string
  /** 已填值摘要（超长截断）。 */
  summary: string
}

/**
 * 向导单一状态源（R1.2）。前进/后退/跳转仅移动 `mainStep`，`answers`/`config` 始终完整。
 *
 * @see .kiro/specs/workflow-create-studio/design.md — Data Models / WizardState
 * Requirements: 1.2, 12.1, 13, 14
 */
export interface WizardState {
  /**
   * create=新建（落 .mjs + .config.json + .draft.json）；
   * edit=仅改配置（只写 .config.json，R13）；
   * edit-structure=编辑已有自定义 wf 的完整结构（方案 C：回填 draft+config，重写三文件，name 只读）。
   */
  mode: "create" | "edit" | "edit-structure"
  /** 步骤游标；前进/后退只移动它。 */
  mainStep: WizardStep
  /** 完整草稿答案（扩展后结构）。 */
  answers: ScaffoldAnswers
  /** 配置编辑器草稿（取代 consumesConfig 布尔，R12.1）。 */
  config: ConfigDraft
  /** 已注册名集合（内置 + 全局自定义），validateName 与 subflow 选项用。 */
  registeredNames: ReadonlySet<string>
  /** 当前可选 Agent（listAgents 拉取后喂入；空=降级不展示，R14.5）。 */
  agentOptions: AgentChoice[]
  /** /agent 端点是否可用（false=降级，R14.5）。 */
  agentEndpointAvailable: boolean
  /** 步骤子流程状态。 */
  stepEditor: StepEditorMode
  /** 阶段子流程状态。 */
  phaseEditor: ListEditorMode
  /** 资源类别子流程状态。 */
  resourceEditor: ResourceEditorMode
  /** 当前步常驻校验提示（null = 无错，R4）。 */
  stepError: string | null
  /** 右栏焦点（输入框/列表），用于键盘路由。 */
  focus: "input" | "list"
  /** 是否已尝试提交（确认页用）。 */
  finished: boolean
}

/**
 * 向导归约器输入动作（R1.3：导航始终保持 answers/config 不变，仅移动游标）。
 *
 * @see .kiro/specs/workflow-create-studio/design.md — Data Models / WizardAction
 */
export type WizardAction =
  // 导航
  | { type: "GOTO"; step: WizardStep }
  | { type: "NEXT" } // 校验当前步，通过才推进
  | { type: "BACK" } // 不校验，直接退
  // 字段编辑
  | { type: "SET_NAME"; value: string }
  | { type: "SET_DESC"; value: string }
  | { type: "SET_ARGS"; value: string }
  | { type: "SET_MAX_REVIEW_ROUNDS"; value: string }
  // 纯 per-phase 配置 actions（资源/输出/轮次按阶段独立增删改）
  | { type: "SET_RESOURCE_PHASE"; phase: string; category: string; paths: string[] }
  | { type: "DELETE_RESOURCE_PHASE"; phase: string; category?: string } // 删除整个阶段或某类别
  | { type: "SET_RESOURCE_LABEL_PHASE"; phase: string; category: string; label: string }
  | { type: "SET_OUTPUT_PHASE"; phase: string; value: string }
  | { type: "DELETE_OUTPUT_PHASE"; phase: string }
  | { type: "SET_MAX_REVIEW_ROUNDS_PHASE"; phase: string; value: string }
  | { type: "DELETE_MAX_REVIEW_ROUNDS_PHASE"; phase: string }
  // phases 列表（R5）
  | { type: "PHASE_ADD"; value: string }
  | { type: "PHASE_EDIT"; index: number; value: string }
  | { type: "PHASE_DELETE"; index: number }
  | { type: "PHASE_MOVE"; index: number; dir: -1 | 1 }
  | { type: "PHASE_CANCEL" }
  // steps 子流程（R5）
  | { type: "STEP_ADD" }
  | { type: "STEP_EDIT"; index: number }
  | { type: "STEP_DELETE"; index: number }
  | { type: "STEP_MOVE"; index: number; dir: -1 | 1 }
  | { type: "STEP_SET_FIELD"; field: StepField; value: unknown }
  | { type: "STEP_COMMIT" }
  | { type: "STEP_CANCEL" }
  // 资源类别列表（R12.1，与 steps/phases 同构）
  // phase（可选）：新增类别归属的阶段（阶段分组树视图：在某阶段的「新增类别」行触发时携带）；
  // 缺省时回退首个声明阶段（与旧平铺视图一致）。
  | { type: "RES_ADD"; phase?: string }
  | { type: "RES_EDIT"; index: number }
  | { type: "RES_DELETE"; index: number }
  | { type: "RES_MOVE"; index: number; dir: -1 | 1 }
  | { type: "RES_SET_FIELD"; field: "phase" | "category" | "paths" | "label"; value: unknown }
  | { type: "RES_COMMIT" }
  | { type: "RES_CANCEL" }
  // agent 选择器（R14）
  | { type: "SET_AGENT_OPTIONS"; options: AgentChoice[]; available: boolean }
  | { type: "STEP_SET_AGENT"; agentType: string | undefined }
  // 分支子列表（branches kind 步草稿内，与 steps/phases 同构，R6.1/R6.3）
  | { type: "BRANCH_ADD" }
  | { type: "BRANCH_EDIT"; index: number }
  | { type: "BRANCH_DELETE"; index: number }
  | { type: "BRANCH_MOVE"; index: number; dir: -1 | 1 }
  | { type: "BRANCH_SET_FIELD"; index: number; field: keyof BranchSpec; value: unknown }
  | { type: "BRANCH_COMMIT" }
  | { type: "BRANCH_CANCEL" }
  // 维度子列表（多维 gate 步草稿内，与 BRANCH_* 同构，R6.2/R6.4）
  | { type: "DIM_ADD" }
  | { type: "DIM_EDIT"; index: number }
  | { type: "DIM_DELETE"; index: number }
  | { type: "DIM_MOVE"; index: number; dir: -1 | 1 }
  | { type: "DIM_SET_FIELD"; index: number; field: keyof DimensionSpec; value: unknown }
  | { type: "DIM_COMMIT" }
  | { type: "DIM_CANCEL" }
  // 编辑入口回填（R13.3）。declaredPhases：脚本声明阶段（meta.phases），用于自愈旧配置里
  // 错位的阶段键（单阶段时把所有键合并到唯一声明阶段，消除 code/Main 等历史遗留错配）。
  | { type: "LOAD_CONFIG"; block: RawConfigBlock; declaredPhases?: string[] }
  // 结构编辑回填（方案 C）：把 <name>.draft.json 解析出的结构回填进 answers（name/desc/phases/steps/args）
  | { type: "LOAD_DRAFT"; structure: DraftStructure }
  // 收尾
  | { type: "SUBMIT" }
