/**
 * OpenCode Workflows —— Extension_System（扩展系统）。
 *
 * Extension_System 在 {@link HookRegistry}（task 9.1）之上组合出完整的扩展能力：
 *
 * 1. **Hook 注册转发**：`registerHook`/`unregisterHook` 及四类 Hook runner
 *    （before-tool / before-agent / after-agent / workflow-complete）直接委托给底层
 *    {@link HookRegistry}，保持注册顺序与容错策略（R11.5/R11.6/R11.8-R11.11）。
 * 2. **sessionID 映射（R11.7）**：`bindSession`/`unbindSession`/`getBinding` 维护
 *    `sessionID → { runId, phase, constraints }`，使 Hook 能识别「当前子 Agent 属于哪个
 *    workflow 的哪个阶段、应套用何种约束规则」。
 * 3. **Workflow 发现与解析（R11.1/R11.2/R11.3/R14.4）**：`discoverWorkflows` 扫描
 *    内置 `workflows/` 与用户全局目录 `~/.opencode-workflows/`（R3.5：发现来源限定为
 *    「内置目录 + 全局目录」两类，不含项目级 `.opencode/workflows`），通过 ScriptLoader 的
 *    **AST 静态提取** 读取 meta（**不执行脚本**）；`resolveWorkflow` 按名称解析路径，
 *    **同名时用户自定义优先**。
 * 4. **全局 before-tool 单分发器（R11.4/R11.7，实现约束）**：OpenCode 的
 *    `tool.execute.before` 对单插件仅有一个注册位，故本模块导出
 *    {@link ExtensionSystem.dispatchBeforeTool} 作为唯一全局 handler——凭 sessionID
 *    经 `getBinding` 网关命中才依次调用该 run 的 before-tool Hooks；reject 或安全默认
 *    reject 时**抛出**以阻断工具执行；未命中（非 workflow 子 session）一律放行。
 *
 * 依赖注入：ScriptLoader 的 `extractMeta`、内置/用户目录路径、目录读取与存在性判定均经
 * 工厂参数注入，便于 task 9.4 属性测试提供 fake 实现（避免真实文件系统/进程依赖）。
 *
 * @see .kiro/specs/opencode-workflows/design.md — 9. Extension_System / 全局 before-tool 单分发器
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.7, 14.4
 */

import { join } from "node:path"
import { readdir } from "node:fs/promises"

import { WorkflowError } from "../errors"
import { resolveGlobalDir } from "../config/config-loader"
import { extractMeta as defaultExtractMeta } from "../engine/script-loader"
import type { PhaseDefinition, WorkflowMeta } from "../types"
import {
  createHookRegistry,
  type AfterAgentHookResult,
  type GateHookResult,
  type HookContext,
  type HookDefinition,
  type HookRegistry,
} from "./hook-registry"
import type { WFLogger } from "../logging/wf-logger"

// 复用 hook-registry 的共享 Hook 类型作为 Extension_System 的对外契约（单一来源）。
export type {
  AfterAgentHookResult,
  CompleteHookResult,
  GateHookResult,
  HookContext,
  HookDefinition,
  HookHandler,
  HookTiming,
} from "./hook-registry"

// ============================================================================
// 公开类型
// ============================================================================

/** sessionID → 所属 run/phase/约束规则 映射（R11.7）。 */
export interface SessionBinding {
  sessionID: string
  runId: string
  phase: string
  constraints?: unknown
}

/** 发现到的 Workflow 注册项。 */
export interface WorkflowRegistryEntry {
  name: string
  description: string
  path: string
  source: "builtin" | "user"
  whenToUse?: string
  /**
   * 声明阶段（来自 `meta.phases`，AST 静态提取）。供 Studio「浏览类型」详情展示
   * 「声明阶段」栏。注意：这是脚本作者**静态声明**的阶段，不等于 `execute()` 运行时真实
   * 跑的步骤（后者藏于函数体，无法静态提取）。缺省（脚本未声明）时为 undefined。
   */
  phases?: PhaseDefinition[]
}

/** 工具调用信息（before-tool 分发器入参的一部分）。 */
export interface ToolInvocation {
  name: string
  input: unknown
}

/** Extension_System 公开接口（对应 design.md「9. Extension_System」）。 */
export interface ExtensionSystem {
  registerHook(hook: HookDefinition): void
  unregisterHook(name: string): void

  /** 维护 sessionID → runId/phase/约束规则 映射（R11.7）。 */
  bindSession(binding: SessionBinding): void
  unbindSession(sessionID: string): void
  getBinding(sessionID: string): SessionBinding | undefined

  /** 发现并注册所有可用 Workflow（内置 + 用户；AST 提取 meta，不执行脚本）。 */
  discoverWorkflows(): Promise<WorkflowRegistryEntry[]>
  /** 按名称解析 Workflow 路径（同名时用户自定义优先）；解析失败抛 WORKFLOW_NOT_FOUND。 */
  resolveWorkflow(nameOrRef: string | { scriptPath: string }): Promise<string>

  /**
   * 全局 `tool.execute.before` 单分发器：凭 sessionID 经 getBinding 网关。
   * - 命中某 run：依次调用该 run 的 before-tool Hooks；reject / 异常 / 超时（安全默认
   *   reject）→ **throw** 阻断工具执行（错误回传子 Agent）。
   * - 未命中（非 workflow 子 session）：放行，不干预。
   */
  dispatchBeforeTool(sessionID: string, tool: ToolInvocation): Promise<void>

  /** before-agent：reject 则 agent() 返回 null。 */
  runBeforeAgentHooks(ctx: HookContext): Promise<GateHookResult>
  /** after-agent：观察 + 可 modify 结果。 */
  runAfterAgentHooks(ctx: HookContext): Promise<AfterAgentHookResult>
  /** workflow-complete：workflow 结束后触发。 */
  runWorkflowCompleteHooks(ctx: HookContext): Promise<void>

  /** 暴露底层 Hook 容错日志（R14.5 可观测性）。 */
  getHookLog(): ReturnType<HookRegistry["getLog"]>
}

/** Extension_System 工厂选项（依赖注入，便于测试）。 */
export interface ExtensionSystemOptions {
  /** 内置 workflows 目录（plugin 包内），默认 `workflows`。 */
  builtinDir?: string
  /** 用户 workflows 目录（全局目录），默认 `~/.opencode-workflows`（{@link resolveGlobalDir}）。 */
  userDir?: string
  /** AST 静态 meta 提取函数（注入式，默认使用 ScriptLoader.extractMeta）。 */
  extractMeta?: (scriptPath: string) => Promise<WorkflowMeta>
  /**
   * 目录扫描器：返回该目录下的 workflow 脚本绝对/相对路径数组。
   * 默认实现：扫描目录下 `*.mjs` 文件及含 `index.mjs` 的一级子目录。
   * 注入式以便测试用内存目录。
   */
  scanDir?: (dir: string) => Promise<string[]>
  /** 可选的底层 HookRegistry（默认自建），便于与外部共享。 */
  registry?: HookRegistry
  /**
   * 可选的 WF_Logger 实例（依赖注入，R8.1）。
   *
   * 当未提供外部 `registry` 时，本 logger 透传给内部自建的 {@link createHookRegistry}，
   * 使 Hook 的跳过 / 超时 / 安全默认 reject 经 WF_Logger 双写输出（R7.2 / R7.3 /
   * R7.4）。若显式提供了 `registry`，则以该 registry 自身的 logger 装配为准（本字段被忽略，
   * 避免重复装配）。未注入时 HookRegistry 经 {@link coerceLogger} 回退 No_Op_Logger（R8.6）。
   */
  logger?: WFLogger
}

// ============================================================================
// 默认目录扫描器
// ============================================================================

/**
 * 默认目录扫描器：在 `dir` 下收集 workflow 脚本路径。
 *
 * 规则（对应 design.md 文件系统布局）：
 * - 顶层 `*.mjs` 文件 → 各为一个 workflow（如 `~/.opencode-workflows/foo.mjs`）；
 * - 含 `index.mjs` 的一级子目录 → 该 `index.mjs` 为入口（如 `workflows/lingxi-harness/index.mjs`）。
 *
 * 目录不存在/不可读时返回空数组（视为无 workflow）。
 */
async function defaultScanDir(dir: string): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const results: string[] = []
  for (const name of names) {
    if (name.endsWith(".mjs")) {
      // 顶层 .mjs 文件 → 各为一个 workflow。
      results.push(join(dir, name))
      continue
    }
    // 否则尝试作为子目录：含 index.mjs 的子目录视为一个 workflow 包。
    try {
      const sub = await readdir(join(dir, name))
      if (sub.includes("index.mjs")) results.push(join(dir, name, "index.mjs"))
    } catch {
      // 非目录或不可读：跳过。
    }
  }
  return results
}

// ============================================================================
// 工厂
// ============================================================================

/** 内置 workflows 目录默认值（plugin 包内）。 */
export const DEFAULT_BUILTIN_DIR = "workflows"
/**
 * 用户 workflows 目录默认值（用户全局目录 `~/.opencode-workflows`）。
 *
 * R3.5：发现来源限定为「内置目录 + 全局目录」两类，不再含项目级 `.opencode/workflows`。
 * 跨平台 home 解析委托给 ConfigLoader 的 {@link resolveGlobalDir}。
 */
export const DEFAULT_USER_DIR = resolveGlobalDir()

/**
 * 创建一个 Extension_System。
 *
 * @param options 见 {@link ExtensionSystemOptions}（依赖注入，便于测试）。
 */
export function createExtensionSystem(options: ExtensionSystemOptions = {}): ExtensionSystem {
  // 自建 HookRegistry 时透传注入的 logger（R8.1）；显式提供 registry 时以其自身装配为准。
  const registry = options.registry ?? createHookRegistry({ logger: options.logger })
  const builtinDir = options.builtinDir ?? DEFAULT_BUILTIN_DIR
  const userDir = options.userDir ?? DEFAULT_USER_DIR
  const extractMeta = options.extractMeta ?? defaultExtractMeta
  const scanDir = options.scanDir ?? defaultScanDir

  /** sessionID → 绑定记录（R11.7）。 */
  const bindings = new Map<string, SessionBinding>()
  /** name → 注册项（resolveWorkflow 用；discoverWorkflows 时填充，用户优先覆盖内置）。 */
  let registryCache: Map<string, WorkflowRegistryEntry> | undefined

  // ---- sessionID 映射 ----
  function bindSession(binding: SessionBinding): void {
    bindings.set(binding.sessionID, binding)
  }
  function unbindSession(sessionID: string): void {
    bindings.delete(sessionID)
  }
  function getBinding(sessionID: string): SessionBinding | undefined {
    return bindings.get(sessionID)
  }

  // ---- Workflow 发现 ----
  async function discoverFrom(
    dir: string,
    source: "builtin" | "user",
  ): Promise<WorkflowRegistryEntry[]> {
    const paths = await scanDir(dir)
    const entries: WorkflowRegistryEntry[] = []
    for (const path of paths) {
      try {
        const meta = await extractMeta(path)
        entries.push({
          name: meta.name,
          description: meta.description,
          path,
          source,
          whenToUse: meta.whenToUse,
          phases: meta.phases,
        })
      } catch {
        // 单个脚本 meta 提取失败（META_INVALID / 读取失败）不影响其余发现：跳过。
      }
    }
    return entries
  }

  async function discoverWorkflows(): Promise<WorkflowRegistryEntry[]> {
    const builtin = await discoverFrom(builtinDir, "builtin")
    const user = await discoverFrom(userDir, "user")

    // 同名解析：用户自定义优先（R11.3）。先放内置，再用用户覆盖。
    const byName = new Map<string, WorkflowRegistryEntry>()
    for (const e of builtin) byName.set(e.name, e)
    for (const e of user) byName.set(e.name, e)

    registryCache = byName
    return [...byName.values()]
  }

  async function resolveWorkflow(
    nameOrRef: string | { scriptPath: string },
  ): Promise<string> {
    // 对象引用：直接使用 scriptPath（受控目录校验由 Command_System/WorkflowEngine 负责）。
    if (typeof nameOrRef !== "string") {
      if (nameOrRef.scriptPath) return nameOrRef.scriptPath
      throw new WorkflowError("WORKFLOW_NOT_FOUND", "workflow 引用缺少 scriptPath", {})
    }

    // 名称解析：必要时先发现一次。
    if (!registryCache) await discoverWorkflows()
    const entry = registryCache?.get(nameOrRef)
    if (!entry) {
      throw new WorkflowError(
        "WORKFLOW_NOT_FOUND",
        `未找到名为 "${nameOrRef}" 的 workflow（已扫描内置与用户目录）`,
        { workflowName: nameOrRef },
      )
    }
    return entry.path
  }

  // ---- 全局 before-tool 分发器 ----
  async function dispatchBeforeTool(sessionID: string, tool: ToolInvocation): Promise<void> {
    const binding = bindings.get(sessionID)
    // 未命中（非 workflow 子 session）：放行，不干预（隔离）。
    if (!binding) return

    const ctx: HookContext = {
      runId: binding.runId,
      phase: binding.phase,
      sessionID,
      tool,
      constraints: binding.constraints,
    }
    const result = await registry.runBeforeToolHooks(ctx)
    if (result.action === "reject") {
      // throw → 阻断本次工具执行（OpenCode 在 item.execute() 前 await 此 hook 且不吞异常）。
      throw new WorkflowError("HOOK_ERROR", `工具调用被 before-tool Hook 阻止：${result.reason}`, {
        runId: binding.runId,
        sessionID,
        tool: tool.name,
        reason: result.reason,
      })
    }
  }

  return {
    registerHook: (hook) => registry.registerHook(hook),
    unregisterHook: (name) => registry.unregisterHook(name),
    bindSession,
    unbindSession,
    getBinding,
    discoverWorkflows,
    resolveWorkflow,
    dispatchBeforeTool,
    runBeforeAgentHooks: (ctx) => registry.runBeforeAgentHooks(ctx),
    runAfterAgentHooks: (ctx) => registry.runAfterAgentHooks(ctx),
    runWorkflowCompleteHooks: (ctx) => registry.runWorkflowCompleteHooks(ctx),
    getHookLog: () => registry.getLog(),
  }
}
