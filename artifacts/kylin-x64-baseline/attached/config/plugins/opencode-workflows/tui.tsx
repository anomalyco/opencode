/**
 * OpenCode Workflows —— TUI Plugin 入口（sidebar_content 槽位）。
 *
 * 注册 `sidebar_content` 槽位，渲染 WorkflowPanelList。数据来源为 runs/ 目录下
 * **全部** Run 的 Snapshot（`.opencode/workflows/runs/wf_<runId>.json`），经
 * {@link sortRunsForDisplay} 排序后（running 优先、最近启动在前，至多 MAX_RUNS 个）
 * 同时展示多个 workflow，而非只显示最近一个。
 *
 * 数据流（R3.3/R10.3）：
 *   1. 初始化时读取 runs/ 目录下全部 Snapshot（兜底）；
 *   2. `file.watcher.updated` 事件监听 runs/ 下 `wf_*.json` 变化（实时，仅在 OpenCode
 *      原生 FS watcher 启用时才会对外部写入派发——见下方「为何需要轮询」）；
 *   3. **定时轮询兜底**（每 POLL_INTERVAL_MS 扫描一次 runs/），不依赖 watcher 是否启用；
 *   4. 用「快照签名」比较去抖：仅当排序后的可见集合发生实质变化时才更新 signal，
 *      避免无谓重渲染；
 *   5. Snapshot 不可读/扫描失败时**保留上次成功内容**（R10.6）。
 *
 * 为何需要轮询兜底：OpenCode 原生的 `file.watcher.updated` 仅在
 * `OPENCODE_EXPERIMENTAL_FILEWATCHER` 启用时才订阅项目目录的 FS 变化；默认情况下该事件
 * 只由 write/edit/apply_patch 工具自身 publish。而 workflow 的 Snapshot 由插件内部
 * `node:fs` 直接写入（不经工具），因此默认配置下 watcher **不会**对 runs/ 的写入派发事件，
 * 必须用轮询兜底，否则面板会停留在初次读取的快照上。
 *
 * 本入口保持 **JSX-free**：所有 JSX 渲染封装在 `src/tui/`（该目录 JSX 运行时解析正常），
 * 经 {@link createSidebarRenderer} 注入槽位回调。本文件仅负责数据接线（含折叠状态信号）与槽位注册。
 *
 * **折叠交互**：维护 `collapsed`（`Set<runId>`）信号，点击某 Run 标题行经 `onToggle` 切换；
 * 折叠状态独立于数据轮询，刷新快照不会重置用户选择。
 *
 * **全屏监控（/workflow-monitor）**：注册唯一全屏路由 `workflow-monitor` 与同名斜杠命令，
 * 打开三层下钻界面（列表 → phases → 单 agent 的 Prompt/Outcome）。journal 经缓存按需拉取，
 * 轮询时刷新已请求 run 的 journal。渲染封装在 src/tui/monitor-screens（保持本入口 JSX-free）。
 *
 * @see .kiro/specs/opencode-workflows/design.md — 10. TUI_Panel
 * Requirements: 9.7, 10.1-10.6, 13.3, 14.6
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve as resolvePath } from "node:path"
import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiSlotPlugin } from "@opencode-ai/plugin/tui"

import type { RunSnapshot, JournalEntry, RawConfigBlock, DraftStructure } from "./src/types"
import {
  resolveGlobalDir,
  configFileNameOf,
  defaultScriptDefaults,
} from "./src/config/config-loader"
import { renderConfigJson } from "./src/config/config-writer"
import { draftFileNameOf, parseDraftJson } from "./src/config/draft-store"
import { createSidebarRenderer } from "./src/tui/sidebar-slot"
import { sortRunsForDisplay, toggleCollapsed } from "./src/tui/panel-data"
import {
  MONITOR_ROUTE,
  renderMonitorRoute,
  type MonitorControlFeedback,
} from "./src/tui/monitor-screens"
import { CREATE_ROUTE, renderCreatePlaceholder, type AgentChoice } from "./src/tui/create-screen"
import { renderStudioRoute } from "./src/tui/studio-screen"
import type { WorkflowRegistryEntry } from "./src/extension/extension-system"
import { filterAgents } from "./src/tui/create-state"
import type { SdkMessageWithParts } from "./src/tui/monitor-data"
import { assembleWorkflows, type AssembledWorkflows } from "./index"
import { registerWorkflowCommands, buildActionMessage, buildCreateTriggerMessage, type WorkflowActionFeedback } from "./src/tui/commands"

/** 轮询兜底间隔（ms）。watcher 不可靠时由此保证面板刷新。 */
const POLL_INTERVAL_MS = 2000

/** 读取 runs 目录下**全部**可解析 Snapshot；无则返回空数组。 */
async function readAllSnapshots(runsDir: string): Promise<RunSnapshot[]> {
  const scanned = await scanSnapshots(runsDir)
  return scanned ?? []
}

/**
 * 扫描 runs 目录，**区分「目录不可读（扫描失败）」与「目录可读但确实没有 run」**：
 * - 目录读取（readdir）失败 → 返回 `null`（调用方据此「保留上次内容」，避免瞬时不可读闪空）；
 * - 目录可读（含确实为空 / 全部删空）→ 返回数组（可能为 `[]`，调用方据此**清空面板**）。
 *
 * 单个文件不可读/解析失败仍跳过（不致整次扫描失败），与原 readAllSnapshots 语义一致。
 *
 * 背景修复：原 refresh 用 `all.length === 0` 同时表示「读不到」与「删空了」，导致用户删光
 * 全部 run 实例后 sidebar/monitor 仍显示陈旧快照（永不 setSnapshots([])）。本函数让二者可区分。
 */
export async function scanSnapshots(runsDir: string): Promise<RunSnapshot[] | null> {
  let files: string[]
  try {
    files = await readdir(runsDir)
  } catch {
    return null // 目录不可读（扫描失败）：保留上次内容。
  }
  const out: RunSnapshot[] = []
  for (const file of files) {
    if (!file.startsWith("wf_") || !file.endsWith(".json")) continue
    try {
      const text = await readFile(join(runsDir, file), "utf8")
      out.push(JSON.parse(text) as RunSnapshot)
    } catch {
      // 单个文件不可读/解析失败：跳过（不影响其余 run）。
    }
  }
  return out // 目录可读（可能为空数组=确实无 run/已删空）。
}

/** 读取某 run 的 journal.jsonl 并解析为事件数组；缺失/损坏行跳过。 */
async function readJournalFile(storageRoot: string, runId: string): Promise<JournalEntry[]> {
  const file = join(storageRoot, "journal", runId, "journal.jsonl")
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch {
    return []
  }
  const out: JournalEntry[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      out.push(JSON.parse(trimmed) as JournalEntry)
    } catch {
      // 跳过损坏行（崩溃半行写入等）。
    }
  }
  return out
}

/**
 * 把 Studio「新建」生成的脚本以原子写方式落盘到全局目录 `~/.opencode-workflows/`。
 *
 * 实现 {@link WorkflowCommandsDeps.writeUserWorkflow} 契约（任务 14.2）：
 * 1. `dir = resolveGlobalDir()`，`mkdir -p` 确保全局目录存在（首次创建）；
 * 2. 目标路径 `target = join(dir, fileName)`（`fileName` 为命令层据 `answers.name`
 *    拼装的 `<name>.mjs`）；
 * 3. **原子写避免残留**：先写入同目录下的临时文件 `${target}.tmp-<rand>`，再 `rename`
 *    到 `target`（同目录 rename 为原子操作，下次发现不会看到半截脚本）；任一步失败时
 *    尽力 `rm`（`force`）清理临时文件，再 throw 让命令层 catch 后 toast（R8.10）；
 * 4. 成功返回写入的**绝对路径**（供 toast 展示落盘位置）。
 *
 * 失败以 reject（抛错）告知命令层；本函数不吞错——由命令层负责 toast 且不向上抛。
 *
 * Requirements: 8.8
 */
async function writeUserWorkflowToGlobalDir(fileName: string, content: string): Promise<string> {
  const dir = resolveGlobalDir()
  // 确保全局目录存在（首次创建）；recursive 对已存在目录是幂等的。
  await mkdir(dir, { recursive: true })
  const target = join(dir, fileName)
  // 临时文件与目标同目录，保证 rename 为同卷原子操作（跨卷 rename 可能退化为拷贝）。
  const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  try {
    await writeFile(tmp, content, "utf8")
    await rename(tmp, target)
  } catch (err) {
    // 失败清理：尽力删除可能残留的临时文件，绝不留下半截脚本（R8.10）。
    try {
      await rm(tmp, { force: true })
    } catch {
      // 清理失败本身不掩盖原始错误：忽略，继续抛原始错误。
    }
    throw err
  }
  return target
}

/**
 * 把 Studio「新建 / 改配置」生成的**配置**以原子写方式落盘到全局目录
 * `~/.opencode-workflows/`。
 *
 * 与 {@link writeUserWorkflowToGlobalDir} **同实现、同语义**，唯一区别是文件名为
 * `<name>.config.json`（由命令/向导层据 `answers.name` 拼装）：
 * 1. `dir = resolveGlobalDir()`，`mkdir -p` 确保全局目录存在；
 * 2. 目标 `target = join(dir, fileName)`；
 * 3. **原子写避免残留**：先写同目录临时文件 `${target}.tmp-<rand>`，再 `rename` 到 `target`
 *    （同目录 rename 为原子操作）；任一步失败时尽力 `rm`（`force`）清理临时文件后 re-throw；
 * 4. 成功返回写入的**绝对路径**（供 toast 展示落盘位置）。
 *
 * 失败以 reject（抛错）告知向导层；本函数不吞错——由向导层负责 toast 且不向上抛（R17.3/R17.4）。
 *
 * Requirements: 12.2, 13.4, 17.1
 */
async function writeUserConfigToGlobalDir(fileName: string, content: string): Promise<string> {
  const dir = resolveGlobalDir()
  // 确保全局目录存在（首次创建）；recursive 对已存在目录是幂等的。
  await mkdir(dir, { recursive: true })
  const target = join(dir, fileName)
  // 临时文件与目标同目录，保证 rename 为同卷原子操作（跨卷 rename 可能退化为拷贝）。
  const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  try {
    await writeFile(tmp, content, "utf8")
    await rename(tmp, target)
  } catch (err) {
    // 失败清理：尽力删除可能残留的临时文件，绝不留下半截配置（R13.4）。
    try {
      await rm(tmp, { force: true })
    } catch {
      // 清理失败本身不掩盖原始错误：忽略，继续抛原始错误。
    }
    throw err
  }
  return target
}

/**
 * 内置 `default-*` workflow 的默认配置块提供者（studio「改配置」首次编辑种子化用）。
 *
 * **单一事实源**（修复 P1：此前本处维护了一份与引擎真值漂移的种子——default-code 被错
 * 误种子化 `docs/<FEATURE>/default-code.md` 落盘路径，而引擎默认本就不落盘）。现直接
 * 复用 {@link defaultScriptDefaults}（config-loader.ts 的引擎兜底真值），表单所见即运行所得。
 *
 * 引擎真值的返回形态是 `RawConfigBlock | undefined`；表单契约要 `RawConfigBlock | null`
 * （null = 非内置、无种子，向导回退空表单），此处做一层形态适配。
 */
function builtinDefaults(name: string): RawConfigBlock | null {
  return defaultScriptDefaults(name) ?? null
}

/**
 * 读取某 workflow 现有的 `<name>.config.json` 原始配置块（编辑入口回填用，R13.3）。
 *
 * 直接读全局目录下的单文件并 `JSON.parse`：
 * - 文件缺失/不可读/非法 JSON/顶层非对象 → 返回 `null`（向导回退 builtinDefaults 或空表单）；
 * - 顶层为对象 → 原样作为 {@link RawConfigBlock} 返回（字段解析由 LOAD_CONFIG 归约器完成）。
 *
 * 只读单文件、不做两层合并、不读所指向资源文件内容（与 config-loader 的单文件语义一致）。
 *
 * Requirements: 13.3
 */
async function loadExistingConfigBlock(name: string): Promise<RawConfigBlock | null> {
  const dir = resolveGlobalDir()
  const target = join(dir, configFileNameOf(name))
  let text: string
  try {
    text = await readFile(target, "utf8")
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  return parsed as RawConfigBlock
}

/**
 * 读取某 workflow 现有的结构草稿 `<name>.draft.json` 并解析为 {@link DraftStructure}（方案 C）。
 *
 * 直接读全局目录下的单文件经 {@link parseDraftJson} 防御式解析：
 * - 文件缺失/不可读 → 返回 `null`（向导回退「无结构草稿」，不回填结构）；
 * - 文件存在但非法 JSON/顶层非对象 → parseDraftJson 返回 `null`；
 * - 合法 → 返回结构（字段缺失由 parseDraftJson 补安全默认）。
 */
async function loadDraftStructure(name: string): Promise<DraftStructure | null> {
  const dir = resolveGlobalDir()
  const target = join(dir, draftFileNameOf(name))
  let text: string
  try {
    text = await readFile(target, "utf8")
  } catch {
    return null
  }
  return parseDraftJson(text)
}

/**
 * 判定某 workflow 是否存在结构草稿 sidecar `<name>.draft.json`（方案 C 的「可编辑结构」护栏）。
 *
 * 仅当文件存在且可解析为合法结构时返回 true——手写 `.mjs`（无 sidecar）与内置 `default-*`
 * 一律返回 false，杜绝结构编辑 SUBMIT 覆盖用户手写脚本。
 */
async function hasDraftStructure(name: string): Promise<boolean> {
  return (await loadDraftStructure(name)) !== null
}

/**
 * 删除一个**用户自定义** workflow 类型的源文件（全局目录 `~/.opencode-workflows/` 内）。
 *
 * 实现 {@link WorkflowCommandsDeps.deleteUserWorkflow} 契约：
 * 1. 解析全局目录 `dir = resolveGlobalDir()` 并规范化目标 `target = resolve(scriptPath)`；
 * 2. **越界防护**：`target` 必须落在全局目录 `dir` 内（用 `relative(dir, target)` 判定：
 *    非空、不以 `..` 开头、非绝对路径），否则拒绝（抛错），杜绝经构造的路径删全局目录之外的文件
 *    （内置类型在 plugin 包内，天然落在 `dir` 之外，会被此防护拦下）；
 * 3. `rm(target, { force: true })` 删除——`force` 使「目标不存在」视为成功（幂等）；
 * 4. 失败以 reject 告知命令层，由命令层 toast 提示、不向上抛。
 *
 * 注意：删的是 workflow **类型定义**（源文件），与 `engine.delete` 删「运行实例产物」无关。
 */
async function deleteUserWorkflowFromGlobalDir(scriptPath: string): Promise<void> {
  const dir = resolveGlobalDir()
  const target = resolvePath(scriptPath)
  const rel = relative(dir, target)
  const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
  if (!inside) {
    throw new Error(`拒绝删除：目标不在全局自定义目录内（${dir}）：${scriptPath}`)
  }
  await rm(target, { force: true })
}

/**
 * 计算可见快照集合的签名，用于去抖：仅当签名变化时才更新 signal。
 * 纳入会影响展示的字段（runId/status/进度计数/token/错误），顺序敏感。
 */
function snapshotsSignature(snaps: RunSnapshot[]): string {
  return snaps
    .map((s) => {
      const total = s.workflowProgress?.length ?? 0
      const done = s.workflowProgress?.filter(
        (e) => e.type === "workflow_agent" && e.state === "done",
      ).length ?? 0
      return `${s.runId}:${s.status}:${done}/${total}:${s.totalTokens}:${s.error ? 1 : 0}`
    })
    .join("|")
}

/**
 * TUI plugin 入口：注册 sidebar_content 槽位，并以「文件监听 + 定时轮询」双通道驱动刷新。
 */
export const tuiPlugin: TuiPlugin = async (
  api: TuiPluginApi,
  options: Record<string, unknown> | undefined,
): Promise<void> => {
  const storageRoot =
    options && typeof options.storageRoot === "string" ? options.storageRoot : ".opencode/workflows"
  const runsDir = join(storageRoot, "runs")

  const [snapshots, setSnapshots] = createSignal<RunSnapshot[]>([])
  let lastSignature = ""

  // 折叠状态：已折叠的 runId 集合（不在集合中即展开）。由标题行点击切换，
  // 独立于数据轮询——刷新快照不会重置用户的折叠选择。新 run 默认展开。
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const onToggle = (runId: string): void => {
    setCollapsed((prev) => toggleCollapsed(prev, runId))
  }

  // 打开 Monitor 前的来源路由快照。Monitor 是全屏路由，进入后 route.current 会变成
  // Monitor 自身，因此必须在 navigate 之前捕获来源（通常是用户当时所在的工作 session），
  // 以便 Esc 关闭时精确返回，而不是一律跳回 home 主界面。
  type OriginRoute = { sessionID: string } | { home: true }
  let originRoute: OriginRoute = { home: true }

  /**
   * 记录当前路由为「来源」，随后导航进入 Monitor 全屏路由。
   *
   * @param runId 可选目标 run。Monitor 全屏当前从 L0 列表打开（内部 `view` 信号默认
   *   `list`，无 route param 深链入口），故传 runId 时按现有能力**尽量实现**：预热该 run
   *   的 journal 缓存并把 runId 透传为 route param（render 当前忽略该 param，不影响行为），
   *   用户在 L0 列表选中后下钻即可即时看到详情。
   * @param originSessionID 可选显式来源 session：传入时强制以该 session 作为 Esc 返回目标
   *   （用于 notify：把承载反馈消息的 session 设为返回目标，避免 home 页新建 session 后
   *   Esc 回到空 home 而看不到刚注入的消息）。缺省则读当前路由推断来源。
   */
  const navigateMonitor = (runId?: string, originSessionID?: string): void => {
    if (originSessionID) {
      originRoute = { sessionID: originSessionID }
    } else {
      const cur = api.route.current
      const sid =
        cur?.name === "session" && typeof cur.params?.sessionID === "string"
          ? cur.params.sessionID
          : undefined
      originRoute = sid ? { sessionID: sid } : { home: true }
    }
    if (runId) requestJournal(runId) // 预热详情缓存（深链尽量实现）。
    api.route.navigate(MONITOR_ROUTE, runId ? { runId } : undefined)
  }

  /** 关闭 Monitor：返回打开前的来源路由（来源为 session 则回该 session，否则回 home）。 */
  const navigateBack = (): void => {
    if ("sessionID" in originRoute) {
      api.route.navigate("session", { sessionID: originRoute.sessionID })
    } else {
      api.route.navigate("home")
    }
  }

  /**
   * `/workflows-studio` 的统一入口：记录来源路由后进入 Workflow Studio 全屏（`workflow-studio`）。
   *
   * 复刻 {@link navigateMonitor} 的来源路由模式：进入全屏前先捕获来源（当前工作 session 或 home），
   * 以便 Studio Esc/完成后经 {@link navigateBack} 精确返回，而非一律跳回 home。
   *
   * Studio 内先选意图（浏览 / 新建 / 改配置 / 改结构 / 删除），再按意图选目标 workflow
   * （新建除外），最后进入浏览详情 / 删除确认 / 向导。见 docs/WF-Studio统一与命令收敛方案.md。
   */
  const navigateStudio = (): void => {
    const cur = api.route.current
    const sid =
      cur?.name === "session" && typeof cur.params?.sessionID === "string" ? cur.params.sessionID : undefined
    originRoute = sid ? { sessionID: sid } : { home: true }
    api.route.navigate(CREATE_ROUTE)
  }

  /**
   * 列举可作为 workflow 步骤执行 Agent 的候选（仅 `subagent`/`all`，附静态 ask 规则扫描）。
   *
   * 经 OpenCode server 的 `/agent` 端点（`api.client.app.agents()` → `Agent[]`）拉取后经
   * {@link filterAgents} 过滤 + 映射：
   * - 响应 data 非数组（畸形响应）→ 返回 `[]`（降级，R14.5）；
   * - 端点不可用 / 超时 / 任意错误 → catch 返回 `[]`（降级，R14.5/R14.6）；
   * - **每次调用重新拉取**（不读缓存），端点不可用一律降级为不展示候选项（R14.6）。
   *
   * Requirements: 14.1, 14.2, 14.5, 14.6, 15.1
   */
  const listAgents = async (): Promise<AgentChoice[]> => {
    try {
      const res = await api.client.app.agents()
      const data = (res as { data?: unknown }).data
      if (!Array.isArray(data)) return [] // 畸形响应 → 降级空（R14.5）。
      return filterAgents(data as Array<{ name: string; mode: string; permission?: unknown }>)
    } catch {
      return [] // 端点不可用/超时/任意错误 → 降级空（R14.5/R14.6）。
    }
  }

  /**
   * 解析当前路由所在的 session（用户正在工作的主 session）；不在 session 路由时返回 undefined。
   */
  const currentSessionID = (): string | undefined => {
    const cur = api.route.current
    return cur?.name === "session" && typeof cur.params?.sessionID === "string" ? cur.params.sessionID : undefined
  }

  /**
   * 解析注入消息用的兜底 model（`{ providerID, modelID }`）。
   *
   * 取 `api.state.config.model`（用户默认模型，格式 `provider/modelID`，modelID 可含 `/`）。
   * 解析失败返回 undefined（有 session 上下文时 server 端会以该 session 的 lastModel 兜底；
   * home 页新建的空 session 无 lastModel，则需要本兜底，否则 createUserMessage 取不到 model
   * 会抛错导致注入静默失败）。
   */
  const resolveModel = (): { providerID: string; modelID: string } | undefined => {
    try {
      const cfg = api.state?.config as { model?: unknown } | undefined
      const raw = cfg && typeof cfg.model === "string" ? cfg.model : undefined
      if (!raw) return undefined
      const slash = raw.indexOf("/")
      if (slash <= 0 || slash >= raw.length - 1) return undefined
      return { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) }
    } catch {
      return undefined
    }
  }

  // 收件箱 session 闭包缓存：home 场景新建的「Workflows」session 在本进程内复用，防增殖
  // （monitor 按键 / `/wf-*` 命令 / 对话式创建三条注入路径共用）。不持久化（决策）：跨重启
  // 首次使用会新建一个，长期积累为已知遗留问题（可手动删除，删后下次自动重建）。
  let noticeSessionID: string | undefined

  /** 目标是本进程缓存的收件箱时清缓存（注入失败容忍 session 被删，下次按键/命令自动重建）。 */
  const invalidateNoticeSession = (sessionID: string): void => {
    if (noticeSessionID === sessionID) noticeSessionID = undefined
  }

  /**
   * 确保存在用于承载反馈消息的 session，按优先级解析（防增殖统一链，三条注入路径共用）：
   * 1. 显式 `preferSessionID`（monitor 按键传 `originRoute.sessionID`）→ 直接用；
   * 2. 当前路由在 session → 用当前 session（原版行为：回执进当前对话流）；
   * 3. 本进程已建的收件箱缓存 → 复用；
   * 4. 都没有 → 新建「Workflows」收件箱并记缓存。
   *
   * 返回 `{ sessionID, created }`；created 标记是否本次新建（新建的空 session 无 lastModel，
   * 注入时须显式带 model）。新建失败返回 undefined（调用方降级为仅 toast，不抛）。
   */
  const ensureSession = async (
    preferSessionID?: string,
  ): Promise<{ sessionID: string; created: boolean } | undefined> => {
    if (preferSessionID) return { sessionID: preferSessionID, created: false }
    const existing = currentSessionID()
    if (existing) return { sessionID: existing, created: false }
    if (noticeSessionID) return { sessionID: noticeSessionID, created: false }
    try {
      const res = await api.client.session.create({ title: "Workflows" } as never)
      const id = (res as { data?: { id?: string } }).data?.id
      if (typeof id === "string" && id.length > 0) {
        noticeSessionID = id
        return { sessionID: id, created: true }
      }
      return undefined
    } catch {
      return undefined // 新建失败：调用方降级为仅 toast，不抛（Issue #13461）。
    }
  }

  /**
   * 向指定 session 注入一条**不触发 LLM** 的运行态反馈消息（`session.promptAsync` 带
   * `noReply:true`——写入对话流、落盘、TUI 渲染，但不跑模型）。notify / notifyControl
   * 两条注入路径共用的原语。
   *
   * - 注入带 {@link resolveModel} 的兜底 model（新建/空 session 无 lastModel，否则 server
   *   端 createUserMessage 取不到 model 会抛错导致注入静默失败）；
   * - 注入失败经 toast 暴露原因并清收件箱缓存（session 可能已被删，下次重建）；
   * - 返回是否注入成功（调用方据此决定 Esc 落点更新等后续动作）。
   */
  const injectFeedback = async (sessionID: string, feedback: WorkflowActionFeedback): Promise<boolean> => {
    const body: Record<string, unknown> = {
      sessionID,
      noReply: true,
      parts: [{ type: "text", text: buildActionMessage(feedback) }],
    }
    const model = resolveModel()
    if (model) body.model = model
    try {
      await api.client.session.promptAsync(body as never)
      return true
    } catch (e) {
      invalidateNoticeSession(sessionID)
      try {
        api.ui.toast({
          variant: "warning",
          title: "Workflows 反馈注入失败",
          message: e instanceof Error ? e.message : String(e),
        })
      } catch {
        // toast 失败静默——绝不向上抛（Issue #13461）。
      }
      return false
    }
  }

  /**
   * 运行态反馈（决策：注入 + 跳转）：写操作成功后向主 session 注入一条**不触发 LLM** 的提示
   * 消息（经 {@link injectFeedback}，noReply——写入对话流、落盘、TUI 渲染，但不跑模型），
   * 随后跳转 monitor 全屏运行界面（run 带 runId 直达详情）。
   *
   * 关键点（修复「无消息」）：
   * - home 页（无 session）时经 {@link ensureSession} 防增殖链取得收件箱 session 并把它
   *   设为 Esc 返回目标，避免 Esc 回到空 home 看不到刚注入的消息；
   * - 注入失败经 toast 暴露原因（不再完全静默），便于定位；
   * - 无论注入成败都跳转，保证用户能看到运行界面。
   */
  const notify = async (feedback: WorkflowActionFeedback): Promise<void> => {
    let originSessionID: string | undefined
    try {
      const ensured = await ensureSession()
      if (ensured) {
        originSessionID = ensured.sessionID
        await injectFeedback(ensured.sessionID, feedback)
      }
    } catch {
      // 兜底自吞（ensureSession/injectFeedback 已自处理，理论到不了这里）。
    }
    try {
      if (feedback.navigate !== false) {
        navigateMonitor(feedback.runId, originSessionID)
      } else if (originSessionID) {
        // 不跳转 monitor（如 delete：产物已删，无运行可看）；若本次新建了 session，
        // 仍导航到该 session 让用户看到注入的反馈消息，避免停留在 home 看不到。
        api.route.navigate("session", { sessionID: originSessionID })
      }
    } catch {
      // 跳转失败静默。
    }
  }

  /**
   * monitor 全屏按键（p/r/x/d）成功后的运行态回执：向来源 session（或收件箱）注入同款
   * noReply 反馈消息，使 Esc 返回后对话流有操作痕迹可见（与命令路径反馈一致——否则按键
   * 路径只 toast，瞬时即逝）。
   *
   * - session 来源：优先 `originRoute.sessionID`（用户打开 monitor 前所在的工作 session）；
   *   来源为 home 时走 {@link ensureSession} 防增殖链（收件箱缓存或新建）；
   * - 注入成功且来源为 home 时，把 `originRoute` 更新为承载 session——Esc 返回正好落在有
   *   回执消息、有 sidebar 任务面板的 session 页（home 页不渲染 sidebar_content 槽，
   *   这是让面板可见的唯一插件侧途径；不按键则 Esc 仍回 home，行为不变）；
   * - 不主动跳转：用户正在 monitor 操作，返回时机由 Esc 自主决定；
   * - 任何失败降级为仅按键 toast（现状行为），绝不向上抛。
   */
  const notifyControl = async (fb: MonitorControlFeedback): Promise<void> => {
    try {
      const prefer = "sessionID" in originRoute ? originRoute.sessionID : undefined
      const ensured = await ensureSession(prefer)
      if (!ensured) return
      const ok = await injectFeedback(ensured.sessionID, {
        kind: fb.kind,
        runId: fb.runId,
        ...(fb.workflowName ? { workflowName: fb.workflowName } : {}),
        fromMonitor: true,
      })
      if (ok && !prefer) originRoute = { sessionID: ensured.sessionID }
    } catch {
      // 兜底自吞：按键反馈失败不影响 monitor 操作本身。
    }
  }

  // 启动「对话式创建 workflow」：注入一条**触发模型回复**的消息（与 notify 的 noReply 相反），
  // 让主 session 模型用 workflow-create 工具引导用户完成创建。失败自吞（Issue #13461）。
  const startCreate = async (requirement: string): Promise<void> => {
    let sid: string | undefined
    try {
      const ensured = await ensureSession()
      if (!ensured) return
      sid = ensured.sessionID
      const body: Record<string, unknown> = {
        sessionID: ensured.sessionID,
        // 不带 noReply：本消息须触发模型回复，进入对话式创建。
        parts: [{ type: "text", text: buildCreateTriggerMessage(requirement) }],
      }
      const model = resolveModel()
      if (model) body.model = model
      try {
        await api.client.session.promptAsync(body as never)
      } catch (e) {
        api.ui.toast({
          variant: "warning",
          title: "创建 Workflow 启动失败",
          message: e instanceof Error ? e.message : String(e),
        })
      }
    } catch {
      // 兜底自吞。
    }
    try {
      if (sid) api.route.navigate("session", { sessionID: sid })
    } catch {
      // 跳转失败静默。
    }
  }

  // Monitor 全屏界面：journal 缓存（runId → 事件数组），供 L2 详情读取 prompt/outcome。
  // 进入 L1/L2 时 requestJournal 触发异步拉取；轮询时刷新当前激活 run 的 journal。
  const [journals, setJournals] = createSignal<ReadonlyMap<string, JournalEntry[]>>(new Map())
  const requestedRuns = new Set<string>()
  const loadJournal = async (runId: string): Promise<void> => {
    try {
      const entries = await readJournalFile(storageRoot, runId)
      setJournals((prev) => {
        const next = new Map(prev)
        next.set(runId, entries)
        return next
      })
    } catch {
      // 读取失败：保留上次缓存（不覆盖）。
    }
  }
  const requestJournal = (runId: string): void => {
    requestedRuns.add(runId)
    void loadJournal(runId)
  }
  const journalOf = (runId: string): JournalEntry[] => journals().get(runId) ?? []

  // Monitor L2 会话日志：sessionID → OpenCode 消息+parts（经 client.session.messages 拉取）。
  // 进入 L2 时 requestSessionLog 触发拉取并登记为「关注的子 session」；事件/轮询时刷新。
  const [sessionLogs, setSessionLogs] = createSignal<ReadonlyMap<string, SdkMessageWithParts[]>>(new Map())
  const watchedSessions = new Set<string>()
  const loadSessionLog = async (sessionID: string): Promise<void> => {
    try {
      const res = await api.client.session.messages({ sessionID } as never)
      const data = (res as { data?: unknown }).data
      if (!Array.isArray(data)) return // 拉取失败/无数据：保留上次缓存。
      setSessionLogs((prev) => {
        const next = new Map(prev)
        next.set(sessionID, data as unknown as SdkMessageWithParts[])
        return next
      })
    } catch {
      // 读取失败：保留上次缓存（不覆盖）。
    }
  }
  const requestSessionLog = (sessionID: string): void => {
    watchedSessions.add(sessionID)
    void loadSessionLog(sessionID)
  }
  const sessionLogOf = (sessionID: string): SdkMessageWithParts[] => sessionLogs().get(sessionID) ?? []

  /** 扫描 runs/ → 排序 → 去抖更新；不可读/为空时保留上次内容（R10.6）。 */
  const refresh = async (): Promise<void> => {
    // 区分「扫描失败（null）」与「确实为空（[]）」：
    // - null（目录不可读/瞬时竞态）→ 保留上次内容，避免闪空（R10.6）；
    // - []（目录可读但已删空所有 run）→ 正常走下去，最终 setSnapshots([]) 清空面板。
    let all: RunSnapshot[] | null
    try {
      all = await scanSnapshots(runsDir)
    } catch {
      return // 扫描异常：保留上次内容。
    }
    if (all === null) return // 目录不可读：保留上次内容（防瞬时闪空）。
    const sorted = sortRunsForDisplay(all)
    const sig = snapshotsSignature(sorted)
    if (sig === lastSignature) return // 无实质变化：跳过重渲染。
    lastSignature = sig
    setSnapshots(sorted)
  }

  // 策略 1：初始化兜底读取。
  void refresh()

  // 策略 2：file.watcher.updated 实时监听 runs/ 下 wf_*.json（watcher 启用时才有效）。
  api.event.on("file.watcher.updated", async (event) => {
    try {
      const file = (event.properties as { file?: string }).file
      if (!file) return
      const normalized = file.replace(/\\/g, "/")
      if (!normalized.includes("/runs/") || !normalized.endsWith(".json")) return
      await refresh()
    } catch {
      // 监听回调内异常静默吞错，绝不向上抛（Issue #13461：TUI hook 抛异常会黑屏）。
    }
  })

  // 策略 2b：订阅 message.part.updated / session.idle，实时刷新「关注的」子 session 日志（R 第二期）。
  // 仅当事件的 sessionID 属于 watchedSessions 时才拉取，避免无关刷新；handler 不抛。
  const onSessionEvent = (event: { properties?: unknown }): void => {
    try {
      const props = (event.properties ?? {}) as { sessionID?: string }
      const sid = props.sessionID
      if (!sid || !watchedSessions.has(sid)) return
      void loadSessionLog(sid).catch(() => {})
    } catch {
      // 静默：事件 handler 绝不抛（Issue #13461）。
    }
  }
  api.event.on("message.part.updated", onSessionEvent)
  api.event.on("session.idle", onSessionEvent)

  // 策略 3：定时轮询兜底（不依赖 watcher）。setInterval 不阻塞、异常自包含。
  const timer = setInterval(() => {
    void refresh().catch(() => {})
    // 同时刷新已被请求过的 run 的 journal（monitor L2 实时更新 prompt/outcome）。
    for (const runId of requestedRuns) void loadJournal(runId).catch(() => {})
    // 兜底刷新关注的子 session 会话日志（事件漏报时仍能更新）。
    for (const sid of watchedSessions) void loadSessionLog(sid).catch(() => {})
  }, POLL_INTERVAL_MS)
  // 进程退出时不挂起事件循环（Node/Bun 支持 unref）。
  ;(timer as { unref?: () => void }).unref?.()

  // ── 装配唯一执行引擎 E_tui + 注册 8 条斜杠命令（R1.1/R1.4）──
  //
  // 单引擎架构（D1）：移除 agent 工具后，只有 TUI 进程执行 workflow（用户敲斜杠命令发起）。
  // 这里经 assembleWorkflows(api.client, options) 装配唯一引擎实例，作为所有写操作
  // （run/resume/cancel/pause/delete）的权威执行体，并注入 monitor 全屏 p/r/x/d 按键。
  //
  // 防御（Issue #13461）：装配可能抛错（如配置异常）。整段包 try/catch 降级——失败时
  // 不注册写命令、仅 toast 提示并保留只读 monitor 入口，绝不向上抛致 TUI 黑屏。
  let engine: AssembledWorkflows["engine"] | undefined
  // 已注册名集合获取器（内置 default-* + 全局自定义）：由 assembleWorkflows 的 registeredNames
  // 派生（discover 异步填充）。create-screen 的 validateName / subflow 选项用。装配失败时回退空集。
  let registeredNamesGetter: () => ReadonlySet<string> = () => new Set<string>()
  // Workflow 类型发现获取器：由 assembleWorkflows 的 ExtensionSystem 派生。Studio 壳层（route
  // render）在 assembly 闭包外，故经此模块级 getter 取 discover；装配失败时回退空列表。
  let discoverGetter: () => Promise<WorkflowRegistryEntry[]> = async () => []
  try {
    // api.client 是 SDK v2 的 OpencodeClient（扁平参数）。传第三参 "v2"，使
    // assembleWorkflows 内部经 adaptClientV2 以 v2 扁平形态调用 session.create/prompt/abort
    // 与 app.log（P0 修复：v1 嵌套形态会被 v2 client 静默丢弃 path/body 致 prompt 必败）。
    // 首参类型声明仍为 v1 的 PluginInput["client"]，在此边界做一次类型转换。
    const assembled = assembleWorkflows(
      api.client as unknown as Parameters<typeof assembleWorkflows>[0],
      options,
      "v2",
    )
    engine = assembled.engine
    // registeredNames 是 assembleWorkflows 内部 discover() 异步填充的同步快照 Set，
    // 包装为 getter 供 create-screen 在每次进入 name 步时取最新集合（派生自 discover，R18.5）。
    registeredNamesGetter = () => assembled.registeredNames
    discoverGetter = () => assembled.extensions.discoverWorkflows()
    // 注册 7 条 /workflows-* 命令（+ wf-* 别名）：run / studio / monitor / resume / pause /
    // cancel / delete。其中 workflows-studio 经 navigateStudio 进入类型增删改查全屏。
    registerWorkflowCommands(api, {
      engine: assembled.engine,
      // discover：复用 ExtensionSystem 的 workflow 发现（内置 + 用户自定义）。
      discover: () => assembled.extensions.discoverWorkflows(),
      // readRuns：复用本入口的 readAllSnapshots 读取全部 run 快照。
      readRuns: () => readAllSnapshots(runsDir),
      // ui：api.ui 子集（对话框栈 + 选择/确认/输入工厂 + toast）。
      ui: {
        dialog: api.ui.dialog,
        DialogSelect: api.ui.DialogSelect,
        DialogConfirm: api.ui.DialogConfirm,
        DialogPrompt: api.ui.DialogPrompt,
        toast: api.ui.toast,
      },
      navigateMonitor,
      navigateStudio,
      notify,
      startCreate,
      // writeUserWorkflow：Studio 新建/编辑落盘端口。真实实现（写 resolveGlobalDir() +
      // mkdir -p + 原子写避免残留）见 writeUserWorkflowToGlobalDir：先写同目录临时文件再
      // 原子 rename，失败清理临时文件并以 reject 抛出，由命令层 catch 后 toast（R8.10）。
      writeUserWorkflow: writeUserWorkflowToGlobalDir,
    })
  } catch (err) {
    // 装配失败降级：不注册写命令；保留只读 monitor 入口（read-only，不依赖引擎），并 toast 提示。
    try {
      api.ui.toast({
        variant: "error",
        title: "Workflows",
        message: `初始化失败，运行态控制不可用：${err instanceof Error ? err.message : String(err)}`,
      })
    } catch {
      // toast 失败静默——绝不向上抛（Issue #13461）。
    }
    api.command?.register(() => [
      {
        title: "Workflows: Monitor",
        value: "workflows.monitor",
        category: "Workflow",
        slash: { name: "workflows-monitor", aliases: ["wf-monitor"] },
        onSelect: () => {
          try {
            navigateMonitor()
          } catch {
            // 导航失败静默。
          }
        },
      },
    ])
  }

  // 注册 Monitor 全屏路由（/workflows-monitor 打开）。route render 来自 src/tui（JSX-free 入口）。
  // 注入 engine 句柄：monitor 全屏 p/r/x/d 按键经此调用引擎；装配失败时 engine 为 undefined，
  // 按键控制为 no-op（monitor-screens 内部已处理），只读展示不受影响。
  api.route.register([
    {
      name: MONITOR_ROUTE,
      render: () =>
        renderMonitorRoute({
          api,
          snapshots,
          journalOf,
          requestJournal,
          sessionLogOf,
          requestSessionLog,
          engine,
          notifyControl,
          onRefresh: () => {
            void refresh()
          },
          onClose: navigateBack,
        }),
    },
  ])

  // 注册 Workflow Studio 全屏路由（workflow-studio，/workflows-studio 打开）。
  // render 注入 StudioScreenProps（discover/hasDraft/deleteUserWorkflow + 全部 CreateScreenProps）。
  // 防御（Issue #13461 / R1.6）：render 回调整体包 try/catch，装配/渲染异常时回退**只读占位**
  // 渲染而非黑屏。Studio 壳层自管意图分流，editName/editStructureName 不再经 route param 透传。
  api.route.register([
    {
      name: CREATE_ROUTE,
      render: (input) => {
        try {
          const editName =
            input?.params && typeof input.params.editName === "string" ? input.params.editName : undefined
          const editStructureName =
            input?.params && typeof input.params.editStructureName === "string"
              ? input.params.editStructureName
              : undefined
          return renderStudioRoute({
            api,
            // discover/hasDraft/deleteUserWorkflow：Studio 壳层意图分流所需读写端口。
            discover: discoverGetter,
            hasDraft: hasDraftStructure,
            deleteUserWorkflow: deleteUserWorkflowFromGlobalDir,
            // registeredNames：从 discover 派生的已注册名集合（内置 + 全局自定义）。
            registeredNames: registeredNamesGetter,
            // listAgents：/agent 列举（仅 subagent/all + ask 扫描，端点不可用/畸形/超时降级空、忽略缓存）。
            listAgents,
            // 双落盘端口（各自原子写，同 writeUserWorkflowToGlobalDir 语义）。
            writeUserWorkflow: writeUserWorkflowToGlobalDir,
            writeUserConfig: writeUserConfigToGlobalDir,
            // 编辑入口回填：读现有 <name>.config.json；缺失回退 builtinDefaults（含内置种子化语义）。
            loadExistingConfig: loadExistingConfigBlock,
            builtinDefaults,
            // 结构编辑回填（方案 C）：读现有 <name>.draft.json 结构草稿。
            loadDraft: loadDraftStructure,
            // 全局目录绝对路径：配置来源行显示完整文件路径用。
            globalDir: resolveGlobalDir(),
            ...(editName ? { editName } : {}),
            ...(editStructureName ? { editStructureName } : {}),
            // Esc/完成安全返回来源路由（与 monitor 共用 navigateBack）。
            onClose: navigateBack,
          })
        } catch (err) {
          // 装配/渲染失败：注册只读占位界面而非黑屏（R1.6）。
          return renderCreatePlaceholder(
            api,
            `创建向导装配失败：${err instanceof Error ? err.message : String(err)}`,
          )
        }
      },
    },
  ])

  // 注册 sidebar_content 槽位（渲染回调来自 src/tui，保持本入口 JSX-free）。
  const slot: TuiSlotPlugin = {
    order: 400,
    slots: {
      sidebar_content: createSidebarRenderer(snapshots, collapsed, onToggle),
    },
  }
  api.slots.register(slot)
}

export { tuiPlugin as tui }
export default { id: "opencode-workflows-tui", tui: tuiPlugin }
