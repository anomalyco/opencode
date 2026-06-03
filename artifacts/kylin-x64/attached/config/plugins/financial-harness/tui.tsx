/** @jsxImportSource @opentui/solid */
// tui.tsx — 独立 TUI Plugin：sidebar 进度面板（SolidJS 响应式版）
// 重要：首行 JSX 运行时声明**必须保留且全文件唯一**！
// - Bun 的解析器会取最后一个匹配 token；本文件内除首行外不可再出现相同指令字样
// - 若丢失首行，Bun 会 fallback 到 react 运行时并报错 "Cannot find module 'react/jsx-dev-runtime'"
//
// 数据流：
//   1. 初始化时主动读取 .harness/progress.json（兜底）
//   2. file.watcher.updated 事件监听 .harness/progress.json 变化（实时）
//   3. createSignal 驱动 sidebar_content 槽位重渲染
//
// 槽位函数返回 JSX.Element（@opentui/solid 原语），呈现两层嵌套结构：
//   第 1 层：4 个阶段（PRD/Design/Code/Test）
//   第 2 层：每个阶段的 Step 子阶段 + Ralph Loop + 覆盖率重试

import path from "path"
import { createEffect, createSignal, For, Show, type JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiSlotPlugin,
  TuiSlotContext,
} from "@opencode-ai/plugin/tui"

// ── 进度数据类型（与 LingxiProgressTracker 保持一致） ──────

interface StageData {
  name: string
  description: string
  status: "pending" | "running" | "completed" | "skipped" | "failed"
}

interface RalphLoopData {
  active: boolean
  activeStage: string
  currentRound: number
  maxRounds: number
  currentPhase: "reviewing" | "fixing"
  rounds: Array<{ round: number; result: "pass" | "fail"; timestamp: number }>
}

interface CoverageRetryData {
  active: boolean
  currentAttempt: number
  maxAttempts: number
  lastCoverage: number
  targetCoverage: number
}

interface PhaseData {
  id: "prd" | "design" | "code" | "test"
  label: string
  status: "pending" | "running" | "completed" | "failed"
  stages: StageData[]
  ralphLoop: RalphLoopData
  coverageRetry?: CoverageRetryData
  startTime?: number
  endTime?: number
}

interface FeatureSummary {
  status: "in_progress" | "completed" | "failed" | "prd_done" | "design_done" | "code_done" | "test_done"
  currentPhase: PhaseData["id"] | null
  artifacts: {
    docsDir: string
  }
}

interface ProgressData {
  id: string
  title: string
  sessionId: string
  summary: FeatureSummary
  execution: {
    phases: PhaseData[]
    startTime: number
    endTime?: number
  }
}

// ── 工具函数 ──────────────────────────────────────────────

const ICONS = {
  pending: "⬜",
  running: "🔄",
  completed: "✅",
  failed: "❌",
  skipped: "⏭️",
} as const

function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

/** Ralph Loop 默认触发 Step（activeStage 为空时的回退值）：
 * - PRD/Design → Step_5（审查验证，Momus）
 * - Code → Step_7（代码审查，Momus）；Step_6 测试失败时由 review_stage="Step_6" 显式指定
 * - Test → Step_5（测试执行与覆盖率）
 */
function defaultRalphStageName(phaseId: PhaseData["id"]): string {
  if (phaseId === "code") return "Step_7"
  if (phaseId === "test") return "Step_5"
  return "Step_5"  // prd, design
}

// ── 主题颜色映射 ─────────────────────────────────────────

type Theme = TuiSlotContext["theme"]

function phaseFg(status: PhaseData["status"], theme: Theme) {
  const t = theme.current
  if (status === "completed") return t.success
  if (status === "running") return t.info
  if (status === "failed") return t.error
  return t.textMuted
}

function stageFg(status: StageData["status"], theme: Theme) {
  const t = theme.current
  if (status === "completed") return t.success
  if (status === "running") return t.info
  if (status === "failed") return t.error
  if (status === "skipped") return t.textMuted
  return t.textMuted
}

// ── 子组件 ────────────────────────────────────────────────

function PhaseRow(props: {
  phase: PhaseData
  theme: Theme
  expanded: () => boolean
  onToggle: () => void
}): JSX.Element {
  const phase = () => props.phase
  const dur = () => {
    const p = phase()
    if (p.startTime && p.endTime) return fmtDur(p.endTime - p.startTime)
    return ""
  }
  const statusText = () => {
    const s = phase().status
    if (s === "running") return "执行中..."
    if (s === "completed") return dur() ? `完成 · ${dur()}` : "完成"
    if (s === "failed") return "失败"
    return "待执行"
  }
  const arrow = () => (props.expanded() ? "▼" : "▶")
  const phaseIcon = () => ICONS[phase().status]
  const timeCol = () => (phase().startTime && phase().endTime ? dur() : "")

  return (
    <box flexDirection="column" marginTop={1}>
      <box flexDirection="row" gap={1} onMouseDown={() => props.onToggle()}>
        <text flexShrink={0} fg={phaseFg(phase().status, props.theme)}>
          {arrow()}
        </text>
        <text flexShrink={0} fg={phaseFg(phase().status, props.theme)}>
          {phaseIcon()}
        </text>
        <text flexGrow={1} fg={phaseFg(phase().status, props.theme)}>
          <b>{phase().label}</b>
        </text>
        <text flexShrink={0} fg={phaseFg(phase().status, props.theme)}>
          {statusText()}
        </text>
      </box>

      {/* 时间单独第二行，右对齐，仅在有时间时显示 */}
      <Show when={timeCol()}>
        <box flexDirection="row" marginLeft={4}>
          <text flexGrow={1} />
          <text fg={props.theme.current.textMuted}>{timeCol()}</text>
        </box>
      </Show>

      <Show when={props.expanded()}>
        <box flexDirection="column" marginLeft={2} marginTop={0}>
          <For each={phase().stages}>
            {(stage, i) => (
              <StageRow
                stage={stage}
                phase={phase()}
                isLast={i() === phase().stages.length - 1}
                theme={props.theme}
              />
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

function StageRow(props: {
  stage: StageData
  phase: PhaseData
  isLast: boolean
  theme: Theme
}): JSX.Element {
  const stage = () => props.stage
  const phase = () => props.phase
  const branch = () => (props.isLast ? "└─" : "├─")

  // 当前 Ralph Loop 发生在哪个 Step（优先用 activeStage，回退到默认映射）
  const ralphStep = () => phase().ralphLoop.activeStage || defaultRalphStageName(phase().id)
  // 活跃中：控制图标和行颜色
  const isRalphStage = () =>
    phase().ralphLoop.active && stage().name === ralphStep()
  // 有历史记录：无论活跃与否，只要 rounds 有数据且 Step 匹配就展示轮次明细
  const hasRalphHistory = () =>
    phase().ralphLoop.rounds.length > 0 && stage().name === ralphStep()
  // 覆盖率重试：仅 Test 阶段 Step_5（Code 阶段不检测覆盖率）
  const isCoverageStage = () =>
    phase().id === "test" && phase().coverageRetry?.active && stage().name === "Step_5"

  const icon = () => {
    if (isRalphStage() || isCoverageStage()) return "🔁"
    return ICONS[stage().status]
  }

  const stageLineFg = () =>
    isRalphStage() ? props.theme.current.warning : stageFg(stage().status, props.theme)

  const ralph = () => phase().ralphLoop
  const lastRoundIdx = () => Math.max(0, ralph().rounds.length - 1)

  return (
    <box flexDirection="column">
      <text fg={stageLineFg()}>
        {branch()} {stage().name.padEnd(8)} {icon()} {stage().description}
      </text>

      {/* Ralph Loop 轮次明细：有历史记录就展示（活跃中或已完成均显示） */}
      <Show when={hasRalphHistory()}>
        <For each={ralph().rounds}>
          {(r, i) => {
            const isLast = () => i() === lastRoundIdx()
            const isRunning = () =>
              ralph().active && r.round === ralph().currentRound && i() === lastRoundIdx()
            const lineFg = () =>
              isRunning()
                ? props.theme.current.warning
                : r.result === "fail"
                  ? props.theme.current.error
                  : props.theme.current.success
            const tail = () => {
              if (isRunning()) {
                return ralph().currentPhase === "fixing" ? "🔧 修正中…" : "⏳ 审查中…"
              }
              return r.result === "pass" ? "✅ 通过" : "❌ 未通过"
            }
            return (
              <text fg={lineFg()}>
                {"     "}│ {isLast() ? "└" : "├"}─ 第{r.round}轮 {tail()}
              </text>
            )
          }}
        </For>
      </Show>

      {/* 覆盖率重试明细 */}
      <Show when={isCoverageStage() && phase().coverageRetry}>
        <text fg={props.theme.current.warning}>
          {"     "}└─ 第{phase().coverageRetry!.currentAttempt}/
          {phase().coverageRetry!.maxAttempts}次 覆盖率 {phase().coverageRetry!.lastCoverage}% /{" "}
          {phase().coverageRetry!.targetCoverage}%
        </text>
      </Show>
    </box>
  )
}

function Divider(props: { theme: Theme }): JSX.Element {
  return <text fg={props.theme.current.borderSubtle}>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</text>
}

function ProgressPanel(props: { data: ProgressData; theme: Theme }): JSX.Element {
  const data = () => props.data
  const [phaseOpen, setPhaseOpen] = createStore<Partial<Record<PhaseData["id"], boolean>>>({})

  const lastFeatureId = { current: "" as string }
  createEffect(() => {
    const fid = data().id
    if (lastFeatureId.current !== "" && lastFeatureId.current !== fid) {
      setPhaseOpen(reconcile({}))
    }
    lastFeatureId.current = fid
  })

  const phaseExpanded = (phase: PhaseData) => {
    const o = phaseOpen[phase.id]
    if (o !== undefined) return o
    return phase.status === "running"
  }

  const togglePhase = (phase: PhaseData) => {
    setPhaseOpen(phase.id, !phaseExpanded(phase))
  }

  const title = () =>
    data().summary.status === "completed"
      ? `🎉 Lingxi Harness — ${data().title}`
      : `🚀 Lingxi Harness — ${data().title}`

  const phases = () => data().execution.phases
  const doneCount = () => phases().filter((p) => p.status === "completed").length
  const totalElapsed = () => {
    const end = data().execution.endTime ?? Date.now()
    return fmtDur(end - data().execution.startTime)
  }
  const summary = () =>
    data().summary.status === "completed"
      ? `✅ 全部完成  ⏱ ${totalElapsed()}`
      : `总进度: ${doneCount()}/4 阶段完成  ⏱ ${totalElapsed()}`

  const barW = 22
  const progressBar = () => {
    const filled = Math.min(barW, Math.round((doneCount() / 4) * barW))
    return `${"█".repeat(filled)}${"░".repeat(barW - filled)}`
  }

  // 产出目录（完成态）
  const artifactsLine = () => `📁 ${data().summary.artifacts.docsDir}/  概要设计文档.md | 详细设计与程序设计文档.md | code | 测试报告文档.md`

  return (
    <box
      border
      borderColor={props.theme.current.border}
      title={title()}
      titleAlignment="left"
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      <Divider theme={props.theme} />

      <For each={phases()}>
        {(phase) => (
          <PhaseRow
            phase={phase}
            theme={props.theme}
            expanded={() => phaseExpanded(phase)}
            onToggle={() => togglePhase(phase)}
          />
        )}
      </For>

      <box marginTop={1}>
        <Divider theme={props.theme} />
      </box>
      <text fg={props.theme.current.info}>{progressBar()}</text>
      <text fg={props.theme.current.accent}>{summary()}</text>

      <Show when={data().summary.status === "completed"}>
        <text fg={props.theme.current.textMuted}>{artifactsLine()}</text>
      </Show>
    </box>
  )
}

// ── 进度文件读取（初始化 + 定时轮询兜底） ─────────────────

/** 读取统一进度文件 .harness/progress.json */
async function readProgressFile(directory: string): Promise<ProgressData[]> {
  const progressFile = path.join(directory, ".harness", "progress.json")
  try {
    const file = Bun.file(progressFile)
    if (!(await file.exists())) return []
    const parsed = JSON.parse(await file.text()) as { features?: ProgressData[] }
    return Array.isArray(parsed.features) ? parsed.features.filter((feature) => feature?.id) : []
  } catch {
    // .harness 目录不存在或进度文件暂不可读
    return []
  }
}

// ── TUI Plugin 入口 ───────────────────────────────────────

const tuiPlugin: TuiPlugin = async (api: TuiPluginApi) => {
  const [progressMap, setProgressMap] = createSignal<Record<string, ProgressData>>({})

  // 获取工作目录
  const directory = api.state.path.directory

  // ── 策略 1：初始化时主动扫描已有进度文件 ──────────────
  try {
    const existing = await readProgressFile(directory)
    if (existing.length > 0) {
      const map: Record<string, ProgressData> = {}
      for (const p of existing) map[p.id] = p
      setProgressMap(map)
    }
  } catch {
    // 初始化扫描失败不阻塞
  }

  // ── 策略 2：file.watcher.updated 事件实时监听 ─────────
  api.event.on("file.watcher.updated", async (event) => {
    const file = event.properties.file
    if (!file.replace(/\\/g, "/").endsWith(".harness/progress.json")) return
    try {
      const parsed = JSON.parse(await Bun.file(file).text()) as { features?: ProgressData[] }
      if (!Array.isArray(parsed.features)) return
      const map: Record<string, ProgressData> = {}
      for (const p of parsed.features) {
        if (p?.id) map[p.id] = p
      }
      setProgressMap(map)
    } catch {
      // 解析进度文件失败不阻塞
    }
  })

  // ── 策略 3：定时轮询兜底（每 5 秒扫描一次，仅在有活跃进度时） ──
  let pollTimer: ReturnType<typeof setTimeout> | null = null

  function startPolling() {
    if (pollTimer) return
    async function tick() {
      try {
        const scanned = await readProgressFile(directory)
        if (scanned.length > 0) {
          const map: Record<string, ProgressData> = {}
          for (const p of scanned) map[p.id] = p
          setProgressMap(map)
        }
      } catch {
        // 轮询失败静默忽略
      }
      pollTimer = setTimeout(tick, 5000)
    }
    pollTimer = setTimeout(tick, 0)
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  // 监听 session 状态变化，在有活跃 session 时启动轮询
  api.event.on("session.status", (event) => {
    if (event.properties.status.type === "busy") {
      startPolling()
    } else if (event.properties.status.type === "idle") {
      // idle 后延迟 10 秒停止轮询（给最后一次进度更新留时间）
      setTimeout(stopPolling, 10000)
    }
  })

  // 清理
  api.lifecycle.onDispose(() => {
    stopPolling()
  })

  // ── 注册 sidebar_content 槽位 ─────────────────────────
  const slot: TuiSlotPlugin = {
    order: 400,
    slots: {
      sidebar_content: (ctx: Readonly<TuiSlotContext>, props: { session_id: string }) => {
        // 根据 session_id 匹配对应的 Lingxi 进度
        // 非 /lingxi_code session 不渲染（返回 null 不影响默认 sidebar 内容）
        const data = () =>
          Object.values(progressMap()).find((d) => d.sessionId === props.session_id)

        return (
          <Show when={data()}>
            {(d) => <ProgressPanel data={d()} theme={ctx.theme} />}
          </Show>
        )
      },
    },
  }
  api.slots.register(slot)

  api.command.register(() => [
    {
      title: "Lingxi Harness 进度",
      value: "lingxi_progress",
      description: "查看 Lingxi Harness 全链路执行进度",
      category: "Financial Harness",
    },
  ])
}

// 同时支持命名导出和默认导出
export { tuiPlugin as tui }
export default { id: "financial-harness-tui", tui: tuiPlugin }
