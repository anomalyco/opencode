/**
 * OpenCode Workflows —— Plugin 入口装配（server plugin）。
 *
 * 本入口把 Phase 1 各组件接线为一个 OpenCode server plugin：
 *
 * - 创建 {@link StateStore}、{@link ExtensionSystem}、{@link ResumeEngine}、
 *   {@link WorkflowEngine}（每 Run 独立 {@link AgentExecutor}）、{@link CommandSystem}。
 * - 适配真实 SDK `client`（`@opencode-ai/sdk` 的 `OpencodeClient`）为
 *   {@link OpenCodeClientPort}（仅用 session.create/prompt/abort）。
 * - 注册 Hooks（**单入口收敛后仅保留两个 Phase 2 占位 Hook**，spec: workflow-command-control R3.5）：
 *   - 全局 `tool.execute.before` → {@link ExtensionSystem.dispatchBeforeTool} 单分发器（Phase 2 占位，
 *     本期不激活 write-guard，对未绑定 session 放行）；
 *   - `experimental.chat.system.transform` → SystemInjector transform-hook 兜底注入（Phase 2 占位）。
 * - 从配置读取运行时参数（并发/maxAgents/agentTimeout 等），缺省用 defaults（R14.6）。
 *
 * **已移除（R3.1/R3.2）**：agent 自主发起的 `tool["run-workflow"]`、面向用户的 `tool["workflow"]`
 * 工具，以及原 `chat.message` opt-in 追踪 hook。Workflow 唯一发起入口收敛为 TUI 斜杠命令
 * （由用户显式敲命令，见 `tui.tsx` + `src/tui/commands.ts`），server 进程不再执行 workflow。
 *
 * **新增 `chat.message`（使用习惯纠偏）**：检测用户把 `/workflows-*` 斜杠命令当普通对话发出
 * （命令后接空格+参数导致补全面板关闭、整句被提交），改写消息文本为「指引指令」，让模型仅
 * 复述正确用法提示，而非瞎猜或执行。此 hook **不**追踪 opt-in、不发起 workflow，仅做纠偏。
 *
 * SystemInjector 默认走 direct 路径（task 1.3 risk gate：per-call system override
 * VERIFIED-AVAILABLE）；transform-hook 作为兜底保留并已在此注册回调。
 *
 * @see .kiro/specs/workflow-command-control/design.md — 8. 入口装配
 * Requirements: 3.1, 3.2, 3.5
 */

import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin"
import { fileURLToPath } from "node:url"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"

import type { WorkflowConfig } from "./src/types"
import { WorkflowError } from "./src/errors"
import { createStateStore } from "./src/state/state-store"
import { createResumeEngine } from "./src/resume/resume-engine"
import { createExtensionSystem, type ExtensionSystem } from "./src/extension/extension-system"
import { createSystemInjector, type SystemInjector } from "./src/executor/system-injector"
import {
  createAgentExecutor,
  type AgentExecutor,
  type OpenCodeClientPort,
} from "./src/executor/agent-executor"
import { createSemaphore } from "./src/executor/semaphore"
import {
  createWorkflowEngine,
  defaultWorkflowConfig,
  type WorkflowEngine,
} from "./src/engine/workflow-engine"
import { load as loadScript } from "./src/engine/script-loader"
import { createConfigLoader, defaultScriptDefaults, resolveGlobalDir } from "./src/config/config-loader"
import { createCommandSystem } from "./src/command/command-system"
import {
  isPathInControlledDir,
  detectWorkflowCommandMisuse,
  buildWorkflowMisuseDirective,
} from "./src/command/command-system"
import { coerceLevel, createWFLogger, NO_OP_LOGGER, type LogLevel, type LogSink, type WFLogger } from "./src/logging/wf-logger"
import { createWorkflowCreateTool } from "./src/tools/workflow-create"
import { createFileSink, DEFAULT_STORAGE_ROOT } from "./src/logging/file-sink"
import { createMemorySink } from "./src/logging/memory-sink"
import {
  resolveDefaultModel as resolveDefaultModelPure,
  type DefaultModelResolution,
  type ProviderModelsInfo,
} from "./src/engine/default-model"
import {
  createOpenCodeBridgeSink,
  type OpenCodeLogClientPort,
} from "./src/logging/opencode-bridge-sink"

// 复用导出，便于消费方/测试从入口取得装配器与类型。
export * from "./src/types"
export * from "./src/errors"
export { createWorkflowEngine } from "./src/engine/workflow-engine"
export { createCommandSystem } from "./src/command/command-system"
export { createExtensionSystem } from "./src/extension/extension-system"

// ============================================================================
// SDK client 适配：真实 OpencodeClient → OpenCodeClientPort
// ============================================================================

/**
 * 把真实 SDK `client`（ThrowOnError=false 时返回 `{ data, error, ... }`）适配为
 * Agent_Executor 所需的 {@link OpenCodeClientPort}。仅转发 session.create/prompt/abort。
 *
 * 导出以便契约测试（`__tests__/integration/sdk-client-adapter.test.ts`）锁定
 * 「端口 ↔ v1 client」形态映射，防止 client 形态回归。
 */
export function adaptClient(client: PluginInput["client"]): OpenCodeClientPort {
  // 形态对齐（重要）：OpenCode plugin host **注入的是 v1 SDK 客户端**——见
  //   packages/opencode/src/plugin/index.ts：`createOpencodeClient` from "@opencode-ai/sdk"（v1）。
  // v1 client 的 `session.create/prompt/abort` 采用**嵌套参数** `{ path:{id}, body, query }`，
  // URL 模板 `/session/{id}/message` 由 `path.id` 替换（见 sdk 的 core/utils.gen.ts 的
  // defaultPathSerializer）。本端口 {@link OpenCodeClientPort} 本就以 `{ path:{id}, body }`
  // 表达，故此处近乎**直通**，无需把 path.id 摊平为 sessionID。
  //
  // 背景：v1 与 v2 SDK 在 opencode 1.15.x 并行存在——`@opencode-ai/sdk`(v1, 嵌套) 与
  // `@opencode-ai/sdk/v2`(v2, 扁平 `{ sessionID, ... }`)。**对外的 plugin 契约冻结在 v1**
  // （`PluginInput.client = ReturnType<typeof createOpencodeClient>`，来自 v1 入口），
  // OpenCode 内部新代码（CLI/TUI/ACP）才用 v2。曾经把端口摊平成 v2 扁平参数去调 host 传入的
  // v1 client，会导致 `path` 缺失、URL 模板 `{id}` 不被替换（变成字面量 `%7Bid%7D`），
  // 服务端立即拒绝，表现为子 Agent 全部 AGENT_TIMEOUT。改回 v1 嵌套形态即根治。
  //
  // 唯一类型缺口：结构化输出 `format`——**服务端** `PromptInput` 支持 `format`（json_schema，
  // 见 packages/opencode/src/session/prompt.ts），但**冻结的 v1 SDK 类型** `SessionPromptData.body`
  // 未暴露它。运行时 client 仅把 `body` 原样 POST，多带 `format` 服务端会正常处理；故 prompt
  // 的 `body` 以局部类型断言透传，绕过 v1 类型缺口（v2 类型已含 `format`，将来切 v2 可去断言）。
  const session = client.session
  return {
    session: {
      async create(options) {
        const res = await session.create({ body: options.body })
        return { data: res.data as { id: string } | undefined, error: res.error }
      },
      async prompt(options) {
        const res = await session.prompt({
          path: { id: options.path.id },
          // body 含 format（v1 SDK 类型未暴露，运行时透传，见上方说明）：断言绕过类型缺口。
          body: options.body as never,
        })
        return { data: res.data as never, error: res.error }
      },
      async abort(options) {
        return session.abort({ path: { id: options.path.id } })
      },
    },
  }
}

// ============================================================================
// SDK client 适配（v2）：host 注入的 v2 OpencodeClient（扁平参数）→ 端口
// ============================================================================

/**
 * host 注入的 **v2** SDK 客户端中，本插件实际消费的最小扁平结构（解耦完整 v2 SDK 类型，
 * 便于在边界做一次结构化断言而不引入 `@opencode-ai/sdk/v2` 的全量类型）。
 *
 * 仅声明 `session.create/prompt/abort` 与 `app.log`，参数一律为 **v2 扁平形态**
 * （`{ sessionID, parts, ... }` / `{ service, level, message }`）。
 */
export interface V2ClientLike {
  session: {
    create(params: { title?: string; parentID?: string }): Promise<{ data?: unknown; error?: unknown }>
    prompt(params: {
      sessionID: string
      parts: Array<{ type: "text"; text: string }>
      system?: string
      model?: { providerID: string; modelID: string }
      agent?: string
      format?: unknown
    }): Promise<{ data?: unknown; error?: unknown }>
    abort(params: { sessionID: string }): Promise<unknown>
  }
  app: {
    log(params: {
      service?: string
      level?: "debug" | "info" | "warn" | "error"
      message?: string
      extra?: Record<string, unknown>
    }): Promise<unknown>
  }
}

/**
 * v2 适配器：把 host 注入的 **v2** OpencodeClient（扁平参数）适配为 {@link OpenCodeClientPort}。
 *
 * **P0 修复背景**：单引擎架构（D1）下 **TUI 是唯一 workflow 执行体**，而 TUI host 注入的是
 * v2 SDK 客户端（`@opencode-ai/sdk/v2`，见 `packages/opencode/src/cli/cmd/tui/context/sdk.tsx`
 * 的 `createOpencodeClient`）。v2 的 `session.create/prompt/abort` 采用 **扁平参数**
 * （`{ sessionID, parts, system, model, agent, format }`），其参数映射器 `buildClientParams`
 * 对不在 keymap、又无 `allowExtra` 的键（v1 的 `path`/`body`）**静默丢弃**。
 *
 * 因此把 v1 形态的 {@link adaptClient} 喂给 v2 client 会导致 `sessionID` 永不赋值、URL 模板
 * `/session/{sessionID}/message` 占位符不被替换、请求 body 为空 → **每个子 Agent 的 prompt
 * 必败、返回 null**（开发期把适配改回 v1 的回归根因）。本适配器以扁平形态直通修复。
 *
 * 端口契约（{@link OpenCodeClientPort}，v1 嵌套）保持稳定不变；此处仅在边界把端口的
 * `{ path:{id}, body }` 翻译为 v2 扁平参数。
 */
export function adaptClientV2(client: V2ClientLike): OpenCodeClientPort {
  const session = client.session
  return {
    session: {
      async create(options) {
        const res = await session.create({
          title: options.body?.title,
          parentID: options.body?.parentID,
        })
        return { data: res.data as { id: string } | undefined, error: res.error }
      },
      async prompt(options) {
        const res = await session.prompt({
          // ★ 核心修复：v1 端口的 path.id → v2 扁平 sessionID（占位符替换的关键）。
          sessionID: options.path.id,
          parts: options.body?.parts ?? [],
          system: options.body?.system,
          model: options.body?.model,
          agent: options.body?.agent,
          // format：端口已是 json_schema 子集，与 v2 OutputFormat 兼容，断言透传。
          format: options.body?.format as never,
        })
        return { data: res.data as never, error: res.error }
      },
      async abort(options) {
        return session.abort({ sessionID: options.path.id })
      },
    },
  }
}

// ============================================================================
// SDK client 适配：真实 OpencodeClient → OpenCodeLogClientPort（日志桥接）
// ============================================================================

/**
 * 把真实 SDK `client` 适配为 OpenCode_Bridge_Sink 所需的 {@link OpenCodeLogClientPort}
 * （仅暴露 `app.log`），与 {@link adaptClient}（session 端口）并列。
 *
 * 形态对齐：host 注入的是 v1 SDK 客户端，其 `app.log(options)` 以嵌套 `{ body }` 表达
 * 入参（`Options<AppLogData>`，`AppLogData.body = { service, level, message, extra? }`，
 * 见 `packages/sdk/js/src/gen/types.gen.ts` 与 `sdk.gen.ts`）。{@link OpenCodeLogClientPort}
 * 本就以 `{ body: { service, level, message } }` 表达，故此处近乎**直通**——与
 * {@link adaptClient} 的 `session.create({ body: options.body })` 同款嵌套形态。
 *
 * 通过窄化端口而非依赖完整 SDK，使 Bridge_Sink 与真实 SDK 解耦（核心层/单测可注入轻量
 * Mock，R8.7）。`app.log` 失败（reject / 错误状态）由 Bridge_Sink 自身吞掉（R6.6），此
 * 适配不额外容错。
 */
export function adaptLogClient(client: PluginInput["client"]): OpenCodeLogClientPort {
  const app = client.app
  return {
    app: {
      log(options) {
        // 端口 { body:{...} } 直通 v1 client 的嵌套 { body } 入参（与 adaptClient 同款）。
        return app.log({ body: options.body })
      },
    },
  }
}

/**
 * v2 日志适配器：把 host 注入的 **v2** client 的 `app.log`（扁平参数）适配为
 * {@link OpenCodeLogClientPort}。
 *
 * 与 {@link adaptClientV2} 同源问题：v2 的 `app.log` 采用扁平 `{ service, level, message, extra }`，
 * v1 形态的 {@link adaptLogClient}（`{ body:{...} }`）喂给 v2 client 会被 `buildClientParams`
 * 静默丢弃 `body` 键 → 桥接日志静默失效（虽被 Bridge_Sink 吞掉不影响业务，但日志丢失）。
 * 本适配器以扁平形态直通修复。
 */
export function adaptLogClientV2(client: V2ClientLike): OpenCodeLogClientPort {
  const app = client.app
  return {
    app: {
      log(options) {
        // 端口 { body:{ service, level, message } } → v2 扁平参数。
        return app.log({
          service: options.body.service,
          level: options.body.level,
          message: options.body.message,
        })
      },
    },
  }
}

// ============================================================================
// 运行时配置读取（R14.6）
// ============================================================================

/** 从插件 options 读取运行时配置，缺省填充默认值。导出以便单测验证解析语义。 */
export function readConfig(options: Record<string, unknown> | undefined): WorkflowConfig {
  const base = defaultWorkflowConfig()
  if (!options || typeof options !== "object") return base
  const o = options as Partial<WorkflowConfig>
  const numOr = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
  // workflowTimeout 允许显式关闭：null 或 <=0 → null（关闭整体超时）；缺省/非法 → 默认（168h）。
  const timeoutOr = (v: unknown, fallback: number | null): number | null => {
    if (v === null) return null
    if (typeof v === "number" && Number.isFinite(v)) return v > 0 ? Math.floor(v) : null
    return fallback
  }
  return {
    maxConcurrency: numOr(o.maxConcurrency, base.maxConcurrency),
    maxAgents: numOr(o.maxAgents, base.maxAgents),
    // agentTimeout 复用 timeoutOr 关闭语义：null 或 <=0 → null（不限制单 Agent 运行时间）；
    // 正数 → 启用超时；缺省/非法 → 默认（null）。
    agentTimeout: timeoutOr(o.agentTimeout, base.agentTimeout),
    workflowTimeout: timeoutOr(o.workflowTimeout, base.workflowTimeout),
    schemaRetries:
      typeof o.schemaRetries === "number" && o.schemaRetries >= 0
        ? Math.floor(o.schemaRetries)
        : base.schemaRetries,
    storageRoot: typeof o.storageRoot === "string" ? o.storageRoot : base.storageRoot,
    // 心跳/孤儿回收复用 timeoutOr 的关闭语义：null 或 <=0 → null（关闭）；缺省/非法 → 默认。
    heartbeatIntervalMs: timeoutOr(o.heartbeatIntervalMs, base.heartbeatIntervalMs),
    orphanTimeoutMs: timeoutOr(o.orphanTimeoutMs, base.orphanTimeoutMs),
    // 日志配置（workflow-logging spec，可选，向后兼容）：原样保留有效对象，
    // 归一/回退留待 readLoggingConfig（装配时消费）。非对象/缺省 → 省略字段。
    ...(o.logging && typeof o.logging === "object" ? { logging: o.logging } : {}),
  }
}

// ============================================================================
// 日志运行时配置读取与归一（workflow-logging spec，R2.6/R2.7/R8.2/R8.3/R8.4/R8.5）
// ============================================================================

/**
 * 归一后的日志运行时配置：装配层据此构造 WF_Logger 与 File_Sink。
 *
 * - `level`：WF_Logger 的最小输出级别（已归一为 {@link LogLevel} 四档之一）。
 * - `storageRoot`：File_Sink 的落盘根目录（已归一，缺省/空白回退默认值）。
 * - `enabled`：日志总开关；`false` 时装配层把注入核心模块的 logger 替换为 No_Op。
 */
export interface ResolvedLoggingConfig {
  level: LogLevel
  storageRoot: string
  enabled: boolean
}

/**
 * 归一 storageRoot（R8.3）：缺省 / 空串 / 仅含空白字符 → 默认
 * {@link DEFAULT_STORAGE_ROOT}（`.opencode/workflows`）；否则原样返回。
 *
 * 与 File_Sink 内部的 `normalizeStorageRoot` 同语义，构成双重兜底（R8.3）。
 */
function normalizeStorageRoot(input: unknown): string {
  if (typeof input === "string" && input.trim() !== "") {
    return input
  }
  return DEFAULT_STORAGE_ROOT
}

/**
 * 从已读取的运行时配置归一出日志装配所需的有效值（R2.6/R2.7/R8.2/R8.3/R8.4/R8.5）。
 *
 * 归一规则：
 * - **level（R2.6 / R2.7）**：取 `config.logging.level`，经 {@link coerceLevel}
 *   归一——精确等于 `DEBUG`/`INFO`/`WARN`/`ERROR` 之一时生效，否则（缺失/空串/
 *   未知字符串/非字符串）回退 `INFO`。
 * - **storageRoot（R8.3）**：取 `config.storageRoot`，缺省 / 空串 / 仅含空白字符
 *   回退默认 `.opencode/workflows`。
 * - **enabled（R8.4 / R8.5）**：取 `config.logging.enabled`，仅当显式为 `false`
 *   时为关闭；缺省 / `true` / 非布尔均视为启用（日志默认启用）。
 *
 * 仅做「读取 + 归一」，不构造任何 Logger / Sink（装配在 14.2 完成）。
 */
export function readLoggingConfig(config: WorkflowConfig): ResolvedLoggingConfig {
  const logging = config.logging
  return {
    level: coerceLevel(logging?.level),
    storageRoot: normalizeStorageRoot(config.storageRoot),
    enabled: logging?.enabled !== false,
  }
}

// ============================================================================
// WF_Logger 构造（恒定装配，R8.1/R8.2/R8.4/R8.5/R6.5）
// ============================================================================

/**
 * 据已归一的日志运行时配置构造注入核心模块的 WF_Logger（R8.1）。
 *
 * 装配步骤（与 design.md §8「assembleWorkflows 改造步骤」逐一对齐）：
 * 1. 构造 `fileSink`（恒定包含 File_Sink，R8.1）；`onError` 兜底为非抛出的 no-op
 *    （日志自身故障绝不影响业务，R5.6/R5.7）。
 * 2. 持有 SDK client 时构造 `bridge`（{@link createOpenCodeBridgeSink} 经
 *    {@link adaptLogClient} 适配）；无 client 时省略 Bridge（仍以 File_Sink 运行，R6.5）。
 * 3. `active = createWFLogger({ minLevel, sinks: [fileSink, ...(bridge ? [bridge] : [])] })`。
 * 4. `enabled === false` → 返回 {@link NO_OP_LOGGER}（R8.4）；否则返回 `active`（R8.5）。
 *
 * 返回**单一** logger 实例，由 {@link assembleWorkflows} 注入全部四个核心模块（同一实例，R8.1）。
 *
 * @param client 可选 SDK client；提供时额外注入 OpenCode_Bridge_Sink（R6.5）。
 * @param logging 已归一的日志配置（{@link readLoggingConfig} 的产物）。
 */
export function buildLogger(
  client: PluginInput["client"] | undefined,
  logging: ResolvedLoggingConfig,
  clientKind: "v1" | "v2" = "v1",
  extraSinks: LogSink[] = [],
): WFLogger {
  // File_Sink 恒定注入（R8.1）。onError 设为非抛出 no-op：日志自身写盘失败不应影响业务，
  // 也不向控制台喷错（保持装配静默）。需要探测日志健康度时可在此接入诊断回调。
  const fileSink = createFileSink({
    storageRoot: logging.storageRoot,
    onError: () => {},
  })

  // 持有 client 才注入 Bridge_Sink（R6.5）：无 client（核心层单测/无头场景）省略 Bridge，
  // 仅以 File_Sink 运行。按 clientKind 选择适配器形态：TUI 注入 v2（扁平），server 注入 v1（嵌套）。
  const bridge = client
    ? createOpenCodeBridgeSink(
        clientKind === "v2"
          ? adaptLogClientV2(client as unknown as V2ClientLike)
          : adaptLogClient(client),
      )
    : undefined

  const active = createWFLogger({
    minLevel: logging.level,
    // extraSinks：装配层附加 Sink（如 Memory_Sink——失败原因倒查的数据源）。
    sinks: [fileSink, ...(bridge ? [bridge] : []), ...extraSinks],
  })

  // 关闭开关（R8.4 / R8.5）：enabled === false → No_Op（不向任何 Sink 产生输出）；
  // 否则保留 active（日志默认启用）。
  return logging.enabled === false ? NO_OP_LOGGER : active
}

// ============================================================================
// 装配（导出供 tui.tsx 与测试复用）
// ============================================================================

/** 装配产物：可被 server plugin 与 TUI plugin 共享。 */
export interface AssembledWorkflows {
  config: WorkflowConfig
  injector: SystemInjector
  extensions: ExtensionSystem
  engine: WorkflowEngine
  commands: ReturnType<typeof createCommandSystem>
  /** 已发现的 workflow name 集合（同步快照，用于 isRegisteredName 判定）。 */
  registeredNames: Set<string>
}

/**
 * 构造引擎用的 `resolvePath`：把 `nameOrPath` 解析为脚本绝对路径。
 *
 * **冷启动竞态兜底（风险1）**：`registeredNames` 由 `assembleWorkflows` 内部的
 * fire-and-forget `discoverWorkflows()` 异步填充。插件刚启动、首次 discover 尚未完成
 * 时该快照为空；若仅以「快照命中」判定 name，会把尚未登记的内置/用户 workflow（如
 * `default-prd`）误当作受控目录 path 处理，导致解析走错分支而运行失败。
 *
 * 因此判定顺序调整为：
 * 1. 快照命中 → 直接按 name 解析（已确认是注册 workflow）。
 * 2. 快照未命中 → **仍先尝试按 name 解析**（`resolveWorkflow` 内部会按需 lazy
 *    `discoverWorkflows()`，覆盖异步快照未就绪的窗口）；
 *    - 解析成功 → 命中 name，返回其路径；
 *    - 抛 `WORKFLOW_NOT_FOUND` → 确认不是已知 name，**降级**按受控目录 path 处理；
 *    - 其它异常 → 原样上抛（不吞非「未找到」类错误）。
 *
 * 注：受控目录 path 的安全校验由 Command_System / WorkflowEngine 负责，本函数仅做名称
 * 与路径两种解析形态的分流。
 */
export function makeResolvePath(
  extensions: Pick<ExtensionSystem, "resolveWorkflow">,
  registeredNames: ReadonlySet<string>,
  controlledDirs: readonly string[] = [],
): (nameOrPath: string) => Promise<string> {
  return async (nameOrPath: string) => {
    // 已注册 name（同步快照命中）→ 经 ExtensionSystem 解析路径。
    if (registeredNames.has(nameOrPath)) {
      return extensions.resolveWorkflow(nameOrPath)
    }
    // 快照未命中：先尝试按 name 解析，覆盖异步发现尚未填充快照的冷启动窗口。
    try {
      return await extensions.resolveWorkflow(nameOrPath)
    } catch (error) {
      // 仅当确认「不是已知 name」时降级为受控目录 path；其它异常原样上抛。
      if (error instanceof WorkflowError && error.code === "WORKFLOW_NOT_FOUND") {
        // 降级 path 强制受控目录白名单校验（M3）：使「只接受已注册 name 或受控目录内 path」
        // 的防线真正部署在执行路径（此前仅 Command_System 校验，而生产 TUI 不经 CommandSystem）。
        if (!isPathInControlledDir(nameOrPath, controlledDirs)) {
          throw new WorkflowError(
            "PATH_NOT_ALLOWED",
            `workflow "${nameOrPath}" 既非已注册 name，其 path 也不在受控目录内（${controlledDirs.join(" / ") || "<空白名单>"}）`,
            { workflow: nameOrPath, controlledDirs: [...controlledDirs] },
          )
        }
        return extensions.resolveWorkflow({ scriptPath: nameOrPath })
      }
      throw error
    }
  }
}

/**
 * 在给定 SDK client 与配置上装配全部组件。导出以便 TUI 入口与测试复用同一套实例。
 */
// ============================================================================
// 引擎默认模型解析的 I/O 装配（数据获取 + 归一；纯解析见 src/engine/default-model.ts）
// ============================================================================

/** 窄化的 config/provider 客户端形态（v1 与 v2 SDK 的端点命名在此收拢兼容）。 */
interface ConfigClientLike {
  config?: {
    get?: () => Promise<unknown>
    providers?: () => Promise<unknown>
  }
  provider?: {
    list?: (parameters?: unknown) => Promise<unknown>
  }
}

/** 判定为普通对象（record）。 */
function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** 解包 SDK 响应信封（`{ data, error }` 形态直取 data，裸数据原样返回）。 */
function unwrapSdkData(res: unknown): unknown {
  if (isRecordObject(res) && "data" in res) return res.data
  return res
}

/** 读 server 合成配置的顶层 `model`（`"providerID/modelID"`）；不可得返回 undefined。 */
async function fetchConfigModel(client: PluginInput["client"] | undefined): Promise<string | undefined> {
  if (!client) return undefined
  try {
    const c = (client as unknown as ConfigClientLike).config
    if (typeof c?.get !== "function") return undefined
    const data = unwrapSdkData(await c.get()) as { model?: unknown } | undefined
    const model = isRecordObject(data) ? data.model : undefined
    return typeof model === "string" && model.trim().length > 0 ? model.trim() : undefined
  } catch {
    return undefined
  }
}

/**
 * 读 server 运行时 provider 清单并归一为纯函数输入形状。
 * 优先 v1 `config.providers()`（含 provider 级 default 映射）；回退 v2 `provider.list()`
 * （无 default → 该级由「第一个模型」兜底）。全部不可得返回 undefined（⑤级判定依据）。
 */
async function fetchProviders(
  client: PluginInput["client"] | undefined,
): Promise<ProviderModelsInfo[] | undefined> {
  if (!client) return undefined
  const c = (client as unknown as ConfigClientLike).config
  // v1 形态：config.providers() → { providers: [{id, models}], default: { <id>: modelID } }。
  if (typeof c?.providers === "function") {
    try {
      const data = unwrapSdkData(await c.providers()) as {
        providers?: Array<{ id?: unknown; models?: unknown }>
        default?: unknown
      } | undefined
      if (isRecordObject(data) && Array.isArray(data.providers)) {
        const defaults = isRecordObject(data.default) ? data.default : {}
        const list = data.providers
          .filter((p) => typeof p?.id === "string")
          .map((p) => ({
            id: p.id as string,
            default: typeof defaults[p.id as string] === "string" ? (defaults[p.id as string] as string) : undefined,
            models: isRecordObject(p.models) ? Object.keys(p.models) : [],
          }))
        if (list.length > 0) return list
      }
    } catch {
      // 落入 v2 形态重试。
    }
  }
  // v2 形态：provider.list() → { all: [{id, models: Record<modelID, ...>] } }（无 default）。
  const p = (client as unknown as ConfigClientLike).provider
  if (typeof p?.list === "function") {
    try {
      const data = unwrapSdkData(await p.list()) as {
        all?: Array<{ id?: unknown; models?: unknown }>
      } | undefined
      if (isRecordObject(data) && Array.isArray(data.all)) {
        const list = data.all
          .filter((item) => typeof item?.id === "string")
          .map((item) => ({
            id: item.id as string,
            models: isRecordObject(item.models) ? Object.keys(item.models) : [],
          }))
        if (list.length > 0) return list
      }
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * 读 model.json 的 recent 近期使用模型（server 端状态文件，TUI 换模型时写入），
 * 归一为 `"providerID/modelID"` 字符串数组（新 → 旧）。文件缺失/非法/无 client 时返回 []。
 * 供解析链 ③ 级（recent）与提示建议使用；读失败静默（recent 层缺失不阻塞解析）。
 */
async function readRecentModels(): Promise<string[]> {
  try {
    const stateDir = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
    const raw = await readFile(join(stateDir, "opencode", "model.json"), "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (!isRecordObject(parsed) || !Array.isArray(parsed.recent)) return []
    return parsed.recent
      .filter(
        (item): item is { providerID: string; modelID: string } =>
          isRecordObject(item) &&
          typeof item.providerID === "string" &&
          typeof item.modelID === "string",
      )
      .map((item) => `${item.providerID}/${item.modelID}`)
  } catch {
    return []
  }
}

/**
 * 创建引擎默认模型解析器（进程级缓存）：首次调用发起真实 I/O
 * （config.get + provider 清单 + model.json），之后整个进程复用同一结论——
 * 修改 opencode.json 顶层 model 需重启生效（提示文案已含此语义）。
 * 解析成功（含 null 结果）缓存；意外异常不缓存（下次 run 重试）。
 */
function createDefaultModelResolver(
  client: PluginInput["client"] | undefined,
): () => Promise<DefaultModelResolution | null> {
  let cached: Promise<DefaultModelResolution | null> | undefined
  return () => {
    if (!cached) {
      cached = (async () => {
        const [configModel, recent, providers] = await Promise.all([
          fetchConfigModel(client),
          readRecentModels(),
          fetchProviders(client),
        ])
        return resolveDefaultModelPure({ configModel, recent, providers })
      })()
    }
    return cached
  }
}

/**
 * 创建失败原因倒查器：以 agentIndex 在内存日志环形缓冲（Memory_Sink）里
 * 倒查最近一条 ERROR 日志的真实 reason（executor 的 session.create 失败 /
 * SDK 错误 / 超时事件均带 agentIndex + reason）。超出截断上限时截断。
 */
function createFailureReasonLookup(memorySink: ReturnType<typeof createMemorySink>) {
  const MAX_REASON_LENGTH = 300
  return (agentIndex: number): string | undefined => {
    const entries = memorySink.getEntries()
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i]
      if (entry.level !== "ERROR") continue
      const extra = entry.extra
      if (!extra) continue
      if (typeof extra.agentIndex !== "number" || extra.agentIndex !== agentIndex) continue
      const reason = extra.reason
      if (typeof reason === "string" && reason.length > 0) {
        return reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH)}…` : reason
      }
    }
    return undefined
  }
}

export function assembleWorkflows(
  client: PluginInput["client"],
  options?: Record<string, unknown>,
  clientKind: "v1" | "v2" = "v1",
): AssembledWorkflows {
  const config = readConfig(options)
  // 按 clientKind 选择 session 端口适配器（P0 修复）：
  // - "v2"（TUI 唯一执行入口，host 注入 v2 client）→ adaptClientV2（扁平参数）；
  // - "v1"（server plugin 入口，host 注入 v1 client）→ adaptClient（嵌套参数，默认）。
  const port =
    clientKind === "v2" ? adaptClientV2(client as unknown as V2ClientLike) : adaptClient(client)

  // 构造唯一 WF_Logger 实例（恒定注入，R8.1）：从运行时配置归一日志级别 / storageRoot /
  // enabled 开关后，经 buildLogger 装配 File_Sink（恒定）+ OpenCode_Bridge_Sink（仅持有
  // client 时，R6.5）。enabled === false 时为 No_Op（R8.4）。同一实例注入下方四个核心模块。
  // clientKind 透传给 buildLogger，使桥接日志按 v1/v2 形态正确调用 app.log。
  // Memory_Sink（内存环形缓冲）随装配恒定注入：供「失败原因倒查」在 agent 失败时
  // 取回 executor 记录的真实错误原因（否则 journal 只能写笼统串）。
  const memorySink = createMemorySink({ capacity: 500 })
  const logger = buildLogger(client, readLoggingConfig(config), clientKind, [memorySink])
  const lookupFailureReason = createFailureReasonLookup(memorySink)
  // 引擎默认模型解析器（进程级缓存）：经引擎 deps 在 run 启动时调用，
  // 结论随引擎日志记录（model/source/invalidConfigModel），不向对话流注入提示。
  const resolveDefaultModel = createDefaultModelResolver(client)

  // 项目根（OpenCode 启动目录）：单点解析，供 storageRoot 绝对化、ConfigLoader、受控目录复用。
  const projectRoot = process.cwd()
  // storageRoot 绝对化（修复 C）：config.storageRoot 默认是相对路径 `.opencode/workflows`，
  // 若靠 process.cwd() 在每次文件操作时延迟解析，一旦服务进程 cwd 漂移就会扫错目录
  // （recoverOrphans / resume / monitor 全部受影响）。此处在装配时基于 projectRoot 一次性
  // 绝对化为固定绝对路径再注入 store，根除 cwd 漂移。绝对路径原样保留。
  const storageRootAbs = isAbsolute(config.storageRoot)
    ? config.storageRoot
    : resolve(projectRoot, config.storageRoot)

  const store = createStateStore(storageRootAbs, { logger })
  const injector = createSystemInjector("direct")
  // 内置 workflows 目录随插件包发布，须相对**插件包自身位置**解析（而非用户项目 cwd），
  // 否则 OpenCode 在用户项目目录运行时找不到内置 prd/design/code/test。
  const builtinDir = join(dirname(fileURLToPath(import.meta.url)), "workflows")
  const userDir =
    typeof options?.userWorkflowsDir === "string" ? options.userWorkflowsDir : undefined
  // 注入同一 logger（R8.1）：ExtensionSystem 透传给内部自建 HookRegistry。
  const extensions = createExtensionSystem({ builtinDir, ...(userDir ? { userDir } : {}), logger })
  const resumeEngine = createResumeEngine(store)

  // 为每个 Run 创建独立 AgentExecutor（独立 Semaphore/计数/活跃 session 集合）。
  // 注入同一 logger（R8.1）：透传给 createAgentExecutor，记录后台关键事件。
  const createExecutor = (): AgentExecutor =>
    createAgentExecutor({
      client: port,
      injector,
      extensions,
      semaphore: createSemaphore(config.maxConcurrency),
      maxAgents: config.maxAgents,
      agentTimeout: config.agentTimeout,
      schemaRetries: config.schemaRetries,
      logger,
    })

  const registeredNames = new Set<string>()

  // 企业配置桥接（task 10.1/14.1）：发现项目级与全局 workflows.config.json，
  // 三层合并后注入引擎，由引擎在启动 Run 时解析为 ctx.config。projectRoot 用
  // process.cwd()（OpenCode 启动目录，上方已解析），全局配置目录为 ~/.opencode-workflows/。
  // globalDir 单点解析，供 ConfigLoader 与受控目录白名单复用（避免重复解析）。
  const globalDir = resolveGlobalDir()
  const configLoader = createConfigLoader({ globalDir, projectRoot, scriptDefaults: defaultScriptDefaults })

  // 受控目录白名单（M3）：内置目录 + 全局用户目录 + 显式配置的 userWorkflowsDir（若有）。
  // userWorkflowsDir 是用户主动配置的 workflow 发现目录，其中的脚本理应可被加载，故纳入白名单。
  // 单点计算，供 resolvePath 降级分支、引擎 subLoader、Command_System 三处共用。
  const controlledDirs: string[] = [builtinDir, globalDir, ...(userDir ? [userDir] : [])]

  const engine = createWorkflowEngine({
    resolvePath: makeResolvePath(extensions, registeredNames, controlledDirs),
    load: loadScript,
    store,
    extensions,
    resumeEngine,
    createExecutor,
    configLoader,
    projectRoot,
    config,
    // 受控目录白名单（M3）：内置目录 + 全局目录 + userWorkflowsDir 注入引擎，使 makeSubLoader
    // 的对象 path 分支与 resolvePath 降级分支强制校验，白名单防线真正部署在执行路径。
    controlledDirs,
    // 注入同一 logger（R8.1）：引擎记录生命周期事件（脚本加载失败 / cancel / pause / 整体超时）。
    logger,
    // 引擎默认模型解析 + 失败原因倒查（可选注入；缺省时引擎行为与既有版本一致）。
    resolveDefaultModel,
    lookupFailureReason,
  })

  const commands = createCommandSystem({
    engine,
    isRegisteredName: (name) => registeredNames.has(name),
    // 受控目录白名单（R3.3/R3.4）：与引擎共用同一份（内置 + 全局 + userWorkflowsDir）。
    // 已移除项目级 .opencode/workflows——自定义 workflow 统一收敛到全局目录。
    controlledDirs,
  })

  // 异步发现 workflow（填充 registeredNames）；不阻塞装配。
  void extensions.discoverWorkflows().then((entries) => {
    for (const e of entries) registeredNames.add(e.name)
  })

  // 进程启动时回收孤儿 run（crash recovery）：上次进程崩溃/被强杀遗留的 running 快照，
  // 心跳停滞超阈值者标记为 failed。不阻塞装配（fire-and-forget，失败静默）。
  void engine.recoverOrphans().catch(() => {})

  return { config, injector, extensions, engine, commands, registeredNames }
}

// ============================================================================
// server plugin 入口
// ============================================================================

/**
 * OpenCode server plugin 入口。返回 {@link Hooks}，仅接线两个 Phase 2 占位 Hook：
 * 全局 before-tool 分发器与 system transform 兜底注入。
 *
 * 单入口收敛后（R3.1/R3.2），server 进程不再注册任何启动 run 的入口（run-workflow /
 * workflow 工具与 opt-in 追踪 hook 均已移除）；workflow 仅由 TUI 斜杠命令显式发起。
 * `assembleWorkflows` 仍在此装配，供占位 Hook 引用 `extensions`/`injector`。
 */
export const WorkflowsPlugin: Plugin = async (input: PluginInput, options?: Record<string, unknown>): Promise<Hooks> => {
  const { injector, extensions, registeredNames } = assembleWorkflows(input.client, options)

  return {
    // workflow-create 工具：对话式动态创建自定义 workflow。description 承载隐藏的生成规范
    // （对标 Claude Code Workflow 工具，不进对话）；execute 做契约校验 + 原子写盘到全局目录。
    // registeredNames 供重名校验（装配期快照）。
    tool: {
      "workflow-create": createWorkflowCreateTool({ getRegisteredNames: () => registeredNames }),
    },

    // chat.message：检测「被误当对话发出的 workflow 斜杠命令」并纠偏（使用习惯提示）。
    //
    // 背景：插件 TUI 斜杠命令（/workflows-*）只能从补全列表选中触发（command.trigger），
    // 不经此 hook。但用户若敲「/workflows-run <空格> 参数」，OpenCode autocomplete 的「空格即
    // 关闭」规则会收起补全面板，整句被当普通对话提交——文本即经 chat.message 到达这里。
    //
    // chat.message 无法干净阻断该轮 LLM（hook 跑完消息照常保存并进入 loop），但能**改写**
    // output.parts 的文本：把用户那句"命令+参数"替换为一段「指引指令」，让模型只回复正确用法
    // 提示，而非对着原文瞎猜甚至真去执行。代价是一轮（很短的）模型调用——这是该机制下的固有约束。
    //
    // 防御：整段包 try/catch，绝不抛未捕获异常（Issue #13461）。
    "chat.message": async (_inp, output) => {
      try {
        const parts = output.parts
        if (!Array.isArray(parts)) return
        // 取第一个 text part 作为命令文本载体。
        const idx = parts.findIndex((p) => (p as { type?: string }).type === "text")
        if (idx < 0) return
        const textPart = parts[idx] as { type: "text"; text?: string }
        const misuse = detectWorkflowCommandMisuse(textPart.text ?? "")
        if (!misuse) return
        // 命中误用：把该 text part 文本替换为指引指令，引导模型仅复述正确用法。
        textPart.text = buildWorkflowMisuseDirective(misuse)
      } catch {
        // 静默吞错：检测/改写失败不阻断正常消息流（Issue #13461）。
      }
    },

    // 全局 before-tool 单分发器（Phase 2 占位）：凭 sessionID 网关，命中才跑 before-tool Hooks。
    // 本期不激活 write-guard——无绑定 session 一律放行；保留接线以便 Phase 2 落地。
    // 注意：dispatchBeforeTool 对「Hook reject」会**故意 throw** 以阻断工具执行（write-guard
    // 依赖的语义，SDK 在 item.execute() 前 await 此 hook 且不吞异常）。该 throw 是受控的
    // WorkflowError(HOOK_ERROR)，仅短路单次工具调用、由子 Agent 接收为工具失败，不会导致
    // 主 TUI 黑屏（Issue #13461 针对的是 command/chat 类 hook 的未捕获异常）。
    "tool.execute.before": async (inp, output) => {
      await extensions.dispatchBeforeTool(inp.sessionID, { name: inp.tool, input: output.args })
    },

    // SystemInjector transform-hook 兜底（Phase 2 占位）：凭 sessionID 注入登记的 system 文本。
    // 防御：本 hook 绝不抛出未捕获异常（Issue #13461）。
    "experimental.chat.system.transform": async (inp, output) => {
      try {
        if (!inp.sessionID) return
        const text = injector.resolve(inp.sessionID)
        if (text && injector.mode() === "transform-hook") {
          output.system.unshift(text)
        }
      } catch {
        // 静默吞错：注入失败时不阻断 LLM 调用。
      }
    },
  }
}

export default { id: "opencode-workflows", server: WorkflowsPlugin }

// 触发 lint 友好的未使用引用消除：isPathInControlledDir 经 Command_System 间接使用，
// 这里导出以便外部直接复用受控目录校验。
export { isPathInControlledDir }
