import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { Task } from "@bearmanser/opencode-superpowers-execution/contract"
import { useLanguage } from "@/runtime/i18n/language"
import { ExecutionProgress } from "./progress"
import { taskStateKey } from "./task-list"
import {
  GRAPH_GROUPING_THRESHOLD,
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  cachedLayout,
  clampZoom,
  groupTasksByPhase,
} from "./graph-layout"
import type { ExecutionModel } from "./model"

const FIT_PADDING = 24

export function ExecutionMap(props: { model: ExecutionModel }) {
  const language = useLanguage()
  const [view, setView] = createStore({ zoom: 1, x: 0, y: 0, phase: "all" })
  let viewport: HTMLDivElement | undefined
  let panning = false
  let moved = false
  let startX = 0
  let startY = 0
  let originX = 0
  let originY = 0

  const tasks = createMemo(() => props.model.run()?.tasks ?? [])
  const phases = createMemo(() => [...new Set(tasks().map((task) => task.phase))].sort())
  const byID = createMemo(() => new Map(tasks().map((task) => [task.id, task])))
  const visibleTasks = createMemo(() => {
    const phase = view.phase
    if (phase === "all") return [...tasks()].sort(compareTasks)
    return tasks().filter((task) => task.phase === phase).sort(compareTasks)
  })
  const grouped = createMemo(() => visibleTasks().length > GRAPH_GROUPING_THRESHOLD)
  const layout = createMemo(() => cachedLayout(tasks(), measureTask))
  const visibleNodeIDs = createMemo(() => new Set(visibleTasks().map((task) => task.id)))
  const visibleNodes = createMemo(() => layout().nodes.filter((node) => visibleNodeIDs().has(node.id)))
  const visibleEdges = createMemo(() =>
    layout().edges.filter((edge) => visibleNodeIDs().has(edge.from) && visibleNodeIDs().has(edge.to)),
  )
  const phaseGroups = createMemo(() => groupTasksByPhase(visibleTasks()))

  const assignmentCount = (taskID: string) =>
    props.model.run()?.assignments.filter((assignment) => assignment.taskID === taskID).length ?? 0

  const stateLabel = (task: Task | undefined) => (task ? language.t(taskStateKey(task.state)) : "")

  const zoomIn = () => setView("zoom", clampZoom(view.zoom * 1.25))
  const zoomOut = () => setView("zoom", clampZoom(view.zoom / 1.25))
  const reset = () => setView({ zoom: 1, x: 0, y: 0 })
  const fit = () => {
    const element = viewport
    const current = layout()
    if (!element || current.width === 0 || current.height === 0) return
    const zoom = clampZoom(
      Math.min(
        (element.clientWidth - FIT_PADDING * 2) / current.width,
        (element.clientHeight - FIT_PADDING * 2) / current.height,
      ),
    )
    setView({
      zoom,
      x: (element.clientWidth - current.width * zoom) / 2,
      y: (element.clientHeight - current.height * zoom) / 2,
    })
  }
  const centerSelected = () => {
    const element = viewport
    const node = layout().nodes.find((candidate) => candidate.id === props.model.selectedTaskID())
    if (!element || !node) return
    setView({
      x: element.clientWidth / 2 - (node.x + node.width / 2) * view.zoom,
      y: element.clientHeight / 2 - (node.y + node.height / 2) * view.zoom,
    })
  }
  const startPan = (event: PointerEvent) => {
    if (event.button !== 0) return
    panning = true
    moved = false
    startX = event.clientX
    startY = event.clientY
    originX = view.x
    originY = view.y
  }
  const movePan = (event: PointerEvent) => {
    if (!panning) return
    if ((event.buttons & 1) === 0) {
      panning = false
      return
    }
    const deltaX = event.clientX - startX
    const deltaY = event.clientY - startY
    if (!moved && Math.abs(deltaX) + Math.abs(deltaY) > 3) moved = true
    if (!moved) return
    setView({ x: originX + deltaX, y: originY + deltaY })
  }
  const endPan = () => {
    panning = false
  }
  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    setView("zoom", clampZoom(view.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)))
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return
    const step = 40
    if (event.key === "ArrowLeft") setView("x", view.x - step)
    if (event.key === "ArrowRight") setView("x", view.x + step)
    if (event.key === "ArrowUp") setView("y", view.y - step)
    if (event.key === "ArrowDown") setView("y", view.y + step)
    if (event.key.startsWith("Arrow")) event.preventDefault()
  }

  return (
    <div class="execution-map" data-testid="execution-map">
      <ExecutionProgress
        summary={props.model.progress()}
        runStatus={props.model.run()?.status}
        stale={props.model.attention().stale}
      />
      <div class="execution-map__controls" role="toolbar" aria-label={language.t("execution.map.controls.label")}>
        <Show when={!grouped()}>
          <button type="button" class="execution-map__control" data-testid="execution-map-zoom-out" onClick={zoomOut}>
            {language.t("execution.map.zoom.out")}
          </button>
          <button type="button" class="execution-map__control" data-testid="execution-map-zoom-in" onClick={zoomIn}>
            {language.t("execution.map.zoom.in")}
          </button>
          <button type="button" class="execution-map__control" data-testid="execution-map-fit" onClick={fit}>
            {language.t("execution.map.fit")}
          </button>
          <button type="button" class="execution-map__control" data-testid="execution-map-reset" onClick={reset}>
            {language.t("execution.map.reset")}
          </button>
          <button type="button" class="execution-map__control" data-testid="execution-map-center" onClick={centerSelected}>
            {language.t("execution.map.center")}
          </button>
        </Show>
        <label class="execution-map__phase">
          <span class="execution-map__phase-label">{language.t("execution.map.phase.label")}</span>
          <select
            class="execution-map__phase-select"
            data-testid="execution-map-phase"
            value={view.phase}
            onChange={(event) => setView("phase", event.currentTarget.value)}
          >
            <option value="all">{language.t("execution.map.phase.all")}</option>
            <For each={phases()}>{(phase) => <option value={phase}>{phase}</option>}</For>
          </select>
        </label>
      </div>
      <Show when={tasks().length > 0} fallback={<p class="execution-map__empty" data-testid="execution-map-empty">{language.t("execution.map.empty")}</p>}>
        <Show
          when={grouped()}
          fallback={
            <div
              class="execution-map__viewport"
              data-testid="execution-map-viewport"
              data-zoom={String(view.zoom)}
              data-pan-x={String(view.x)}
              data-pan-y={String(view.y)}
              role="region"
              aria-label={language.t("execution.map.viewport.label")}
              tabindex="0"
              ref={(element) => (viewport = element)}
              onPointerDown={startPan}
              onPointerMove={movePan}
              onPointerUp={endPan}
              onPointerCancel={endPan}
              onPointerLeave={endPan}
              onWheel={onWheel}
              onKeyDown={onKeyDown}
              on:click={{
                capture: true,
                handleEvent: (event) => {
                  if (!moved) return
                  event.stopPropagation()
                  event.preventDefault()
                  moved = false
                },
              }}
            >
              <div
                class="execution-map__canvas"
                style={{
                  width: `${layout().width}px`,
                  height: `${layout().height}px`,
                  transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                }}
              >
                <svg class="execution-map__edges" width={layout().width} height={layout().height} aria-hidden="true">
                  <For each={visibleEdges()}>
                    {(edge) => (
                      <path
                        class="execution-map__edge"
                        data-testid="execution-map-edge"
                        data-from={edge.from}
                        data-to={edge.to}
                        d={edge.path}
                      />
                    )}
                  </For>
                </svg>
                <ul class="execution-map__nodes" role="list" aria-label={language.t("execution.map.label")}>
                  <For each={visibleNodes()}>
                    {(node) => {
                      const task = () => byID().get(node.id)
                      return (
                        <li
                          class="execution-map__node"
                          data-selected={props.model.selectedTaskID() === node.id}
                          style={{
                            left: `${node.x}px`,
                            top: `${node.y}px`,
                            width: `${node.width}px`,
                            height: `${node.height}px`,
                          }}
                        >
                          <button
                            type="button"
                            class="execution-map__node-button"
                            data-testid="execution-map-node"
                            data-task-id={node.id}
                            data-state={task()?.state}
                            aria-pressed={props.model.selectedTaskID() === node.id}
                            aria-label={language.t("execution.map.node.label", {
                              title: task()?.title ?? node.id,
                              state: stateLabel(task()),
                              phase: task()?.phase ?? "",
                            })}
                            onClick={() => props.model.selectTask(node.id)}
                          >
                            <span class="execution-map__node-title">{task()?.title}</span>
                            <span class="execution-map__node-meta">
                              <span class="execution-map__node-phase">{task()?.phase}</span>
                              <span class="execution-map__node-state">{stateLabel(task())}</span>
                            </span>
                            <Show when={assignmentCount(node.id) > 0}>
                              <span class="execution-map__node-assignments">
                                {language.plural("execution.tasks.assignmentCount", assignmentCount(node.id))}
                              </span>
                            </Show>
                          </button>
                        </li>
                      )
                    }}
                  </For>
                </ul>
              </div>
            </div>
          }
        >
          <div class="execution-map__grouped" data-testid="execution-map-grouped">
            <p class="execution-map__grouped-note" data-testid="execution-map-grouped-note">
              {language.plural("execution.map.grouped", visibleTasks().length, { threshold: GRAPH_GROUPING_THRESHOLD })}
            </p>
            <For each={phaseGroups()}>
              {(group) => (
                <section class="execution-map__group" data-testid="execution-map-group">
                  <h3 class="execution-map__group-title">{group.phase}</h3>
                  <ul class="execution-map__group-list" role="list">
                    <For each={group.tasks}>
                      {(task) => (
                        <li class="execution-map__group-item">
                          <button
                            type="button"
                            class="execution-map__group-node"
                            data-testid="execution-map-grouped-node"
                            data-task-id={task.id}
                            data-state={task.state}
                            aria-pressed={props.model.selectedTaskID() === task.id}
                            aria-label={language.t("execution.map.node.label", {
                              title: task.title,
                              state: language.t(taskStateKey(task.state)),
                              phase: task.phase,
                            })}
                            onClick={() => props.model.selectTask(task.id)}
                          >
                            <span class="execution-map__node-title">{task.title}</span>
                            <span class="execution-map__node-meta">
                              <span class="execution-map__node-phase">{task.phase}</span>
                              <span class="execution-map__node-state">{language.t(taskStateKey(task.state))}</span>
                              <Show when={assignmentCount(task.id) > 0}>
                                <span class="execution-map__node-assignments">
                                  {language.plural("execution.tasks.assignmentCount", assignmentCount(task.id))}
                                </span>
                              </Show>
                            </span>
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}

let measurementCanvas: HTMLCanvasElement | undefined

function measureTask(task: Task) {
  if (measurementCanvas === undefined) measurementCanvas = document.createElement("canvas")
  const context = measurementCanvas.getContext("2d")
  if (!context) return { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT }
  context.font = "13px sans-serif"
  const lines = Math.max(1, Math.ceil(context.measureText(task.title).width / (GRAPH_NODE_WIDTH - 16)))
  return { width: GRAPH_NODE_WIDTH, height: 24 + lines * 16 + 4 + 16 }
}

function compareTasks(left: Task, right: Task) {
  if (left.order !== right.order) return left.order - right.order
  if (left.id < right.id) return -1
  if (left.id > right.id) return 1
  return 0
}
