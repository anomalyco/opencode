import type { SessionMessageAssistant, SessionMessageAssistantText } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import type { ResolvedTheme } from "@opencode/theme/tui"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { batch, createMemo, createSignal, For, Show } from "solid-js"
import { useConfig } from "../../../config"
import { useThemes } from "../../../context/theme"
import { PatchDiff } from "../../../component/patch-diff"
import {
  EMPTY_SESSION_TAB_STATUS,
  SessionTabs,
  type SessionTabsController,
  type SessionTabsStatus,
} from "../../../component/session-tabs"
import { TodoItem } from "../../../component/todo-item"
import { InlineToolRow, TextPart } from "../../../routes/session/message-parts"
import { createTimelineAnchors } from "../../../routes/session/anchors"
import { context } from "../../../routes/session/render-context"
import { icon, type UiStyle } from "../../../ui/design"
import { useDesign } from "../../../ui/design-context"
import { MessageCard } from "../../../ui/message-card"
import { type Todo } from "../../../util/todo"
import { StoryFooter } from "./footer"
import type { Story } from "./index"

type TaskStatus = "run" | "wait" | "done"

type TaskFixture = {
  id: string
  title: string
  project: string
  branch: string
  model: string
  status: TaskStatus
  additions: number
  deletions: number
}

type DiffFixture = {
  file: string
  patch: string
  additions: number
  deletions: number
}

const TASKS: TaskFixture[] = [
  {
    id: "fixture-tasks",
    title: "Refonte de l'écran Tâches",
    project: "opencode-rs",
    branch: "main",
    model: "claude-sonnet",
    status: "wait",
    additions: 42,
    deletions: 8,
  },
  {
    id: "fixture-diff",
    title: "Corriger le diff tronqué",
    project: "opencode",
    branch: "dev",
    model: "gpt-5",
    status: "run",
    additions: 12,
    deletions: 3,
  },
  {
    id: "fixture-permissions",
    title: "Brancher les permissions",
    project: "opencode",
    branch: "dev",
    model: "claude-sonnet",
    status: "done",
    additions: 18,
    deletions: 2,
  },
  {
    id: "fixture-release",
    title: "Préparer la release",
    project: "opencode",
    branch: "release",
    model: "gpt-5",
    status: "done",
    additions: 4,
    deletions: 1,
  },
]

const TODOS: Todo[] = [
  { content: "Lire les composants de la TUI existants", status: "completed" },
  { content: "Reprendre les tokens et icônes du fork", status: "in_progress" },
  { content: "Vérifier la story en large et en étroit", status: "pending" },
]

const DIFF: DiffFixture[] = [
  {
    file: "routes/session/index.tsx",
    additions: 8,
    deletions: 2,
    patch: `@@ -184,9 +184,15 @@ export function Session(props: {
   const permissions = createMemo(() => {
     return [route.sessionID, ...descendantSessionIDs()].flatMap(
       (sessionID) => data.session.permission.list(sessionID) ?? [],
     )
   })
-  const promptedPermissions = createMemo(() => permissions())
+  const promptedPermissions = createMemo(() => {
+    if (local.permission.mode === "autoaccept") return []
+    return permissions()
+  })
+  const permission = createMemo(() => promptedPermissions()[0])
   return (
-    <PermissionPrompt request={permissions()[0]} />
+    <Show when={permission()}>
+      {(request) => <PermissionPrompt request={request()} />}
+    </Show>
   )`,
  },
  {
    file: "storybook/tasks-session-diff",
    additions: 4,
    deletions: 0,
    patch: `@@ -1,3 +1,7 @@
+import { SessionTabs } from "../../../component/session-tabs"
+import { PatchDiff } from "../../../component/patch-diff"
+import { icon } from "../../../ui/design"
+
 const TASKS = [
   { id: "fixture-tasks", title: "Refonte de l'écran Tâches" },
 ]`,
  },
]

const ASSISTANT_PART: SessionMessageAssistantText = {
  type: "text",
  text: "J'ai repris les composants de la TUI et les tokens du fork. Le rail de sessions utilise `SessionTabs`, le diff utilise `PatchDiff` et les statuts viennent des mêmes icônes que le reste de l'application.",
}

const ASSISTANT: SessionMessageAssistant = {
  id: "fixture-assistant",
  type: "assistant",
  agent: "build",
  model: { providerID: "fixture", id: "claude-sonnet" },
  time: { created: 0, completed: 1 },
  content: [ASSISTANT_PART],
}

const INITIAL_STATUSES = Object.fromEntries(TASKS.map((task) => [task.id, task.status])) as Record<string, TaskStatus>

function statusColor(theme: ResolvedTheme, status: TaskStatus) {
  if (status === "wait") return theme.text.feedback.warning.base
  if (status === "run") return theme.text.action.primary.base
  return theme.text.feedback.success.base
}

function statusIcon(status: TaskStatus) {
  if (status === "wait") return icon("warning")
  if (status === "run") return icon("dot")
  return icon("check")
}

function statusLabel(status: TaskStatus) {
  if (status === "wait") return "attend ta réponse"
  if (status === "run") return "en cours"
  return "terminée"
}

function PermissionCard(props: { theme: ResolvedTheme; style: UiStyle; onAllow: () => void; onReject: () => void }) {
  const theme = props.theme
  return (
    <MessageCard
      style={props.style}
      borderColor={theme.text.feedback.warning.base}
      backgroundColor={theme.background.raised.base}
    >
      <box padding={1} flexDirection="column" gap={1}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.text.feedback.warning.base}>{icon("warning")}</text>
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
            Permission requise
          </text>
        </box>
        <text fg={theme.text.muted}>
          L'agent demande <span style={{ fg: theme.text.base }}>bash</span> sur{" "}
          <span style={{ fg: theme.text.base }}>bun run typecheck</span>.
        </text>
        <box flexDirection="row" gap={1}>
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={theme.background.action.primary.base}
            onMouseUp={props.onAllow}
          >
            <text fg={theme.text.action.primary.base}>{icon("check")} Autoriser</text>
          </box>
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={theme.background.raised.high}
            onMouseUp={props.onReject}
          >
            <text fg={theme.text.base}>{icon("cross")} Refuser</text>
          </box>
        </box>
      </box>
    </MessageCard>
  )
}

export function TasksSessionDiffStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const config = useConfig()
  const themes = useThemes()
  const design = useDesign()
  const [selected, setSelected] = createSignal(TASKS[0]!.id)
  const [statuses, setStatuses] = createSignal<Record<string, TaskStatus>>({ ...INITIAL_STATUSES })
  const [activeFile, setActiveFile] = createSignal(0)
  const [showRail, setShowRail] = createSignal(true)
  const [showDiff, setShowDiff] = createSignal(true)
  const [lastEvent, setLastEvent] = createSignal("fixture prête · permissions à valider")
  const anchors = createTimelineAnchors()

  const currentTask = createMemo(() => TASKS.find((task) => task.id === selected()) ?? TASKS[0]!)
  const status = (id: string) => statuses()[id] ?? "done"
  const currentStatus = () => status(currentTask().id)
  const counts = createMemo(() => ({
    run: TASKS.filter((task) => status(task.id) === "run").length,
    wait: TASKS.filter((task) => status(task.id) === "wait").length,
    done: TASKS.filter((task) => status(task.id) === "done").length,
  }))
  const compact = () => dimensions().height < 48
  const short = () => dimensions().height < 32
  const railWidth = () => (dimensions().width >= 140 ? 38 : 34)
  const diffWidth = () => Math.min(50, Math.max(44, Math.floor(dimensions().width * 0.36)))
  const railVisible = () => showRail() && dimensions().width >= 78
  const diffVisible = () => showDiff() && dimensions().width >= 116
  const contentWidth = () =>
    Math.max(20, dimensions().width - (railVisible() ? railWidth() : 0) - (diffVisible() ? diffWidth() : 0) - 4)
  const currentFile = () => DIFF[activeFile()] ?? DIFF[0]!
  const permissionOpen = () => currentStatus() === "wait"

  const select = (id: string) => {
    batch(() => {
      setSelected(id)
      setActiveFile(0)
      setLastEvent(`${TASKS.find((task) => task.id === id)?.title ?? id} sélectionnée`)
    })
  }

  const controller: SessionTabsController = {
    tabs: () => TASKS.map((task) => ({ sessionID: task.id, title: task.title })),
    current: selected,
    select,
    close() {},
    move() {},
    detail: (id) => TASKS.find((task) => task.id === id)?.project,
    status: (id): SessionTabsStatus => {
      const value = status(id)
      return {
        ...EMPTY_SESSION_TAB_STATUS,
        busy: value === "run",
        attention: value === "wait" ? "permission" : false,
        unread: value === "done" ? "activity" : undefined,
      }
    },
  }

  const decide = (decision: "once" | "reject") => {
    if (!permissionOpen()) return
    setStatuses((current) => ({ ...current, [currentTask().id]: decision === "once" ? "run" : "done" }))
    setLastEvent(decision === "once" ? "permission autorisée · le run continue" : "permission refusée")
  }

  const reset = () => {
    batch(() => {
      setSelected(TASKS[0]!.id)
      setStatuses({ ...INITIAL_STATUSES })
      setActiveFile(0)
      setShowRail(true)
      setShowDiff(true)
      setLastEvent("fixture prête · permissions à valider")
    })
  }

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      ...TASKS.map((task, index) => ({
        bind: String(index + 1),
        title: `Select ${task.title}`,
        group: "Storybook",
        run: () => select(task.id),
      })),
      { bind: "a", title: "Allow permission", group: "Storybook", run: () => decide("once") },
      { bind: "x", title: "Reject permission", group: "Storybook", run: () => decide("reject") },
      { bind: "d", title: "Toggle diff pane", group: "Storybook", run: () => setShowDiff((value) => !value) },
      { bind: "b", title: "Toggle task rail", group: "Storybook", run: () => setShowRail((value) => !value) },
      { bind: "r", title: "Reset fixture", group: "Storybook", run: reset },
    ],
  }))

  return (
    <context.Provider
      value={{
        get width() {
          return contentWidth()
        },
        get terminal() {
          return dimensions()
        },
        sessionID: currentTask().id,
        anchors,
        groupExpanded: () => true,
        setGroupExpanded: () => {},
        thinkingMode: () => "show",
        markdownMode: () => "rendered",
        groupExploration: () => false,
        diffWrapMode: () => "word",
        models: () => [],
        messageIndex: () => undefined,
        legacyTurns: () => false,
        config: config.data,
        mutatePending: async () => false,
        pendingDelivery: () => undefined,
      }}
    >
      <box
        width={dimensions().width}
        height={dimensions().height}
        flexDirection="column"
        backgroundColor={theme.background.base}
      >
        <box
          height={1}
          flexShrink={0}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="row"
          backgroundColor={theme.background.raised.base}
        >
          <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
            opencode
          </text>
          <text fg={theme.text.muted}> / atelier</text>
          <box flexGrow={1} />
          <text fg={theme.text.muted}>
            {icon("folder")} {currentTask().project} {icon("branchMark")} {currentTask().branch}
          </text>
        </box>

        <box flexGrow={1} minHeight={0} flexDirection="row">
          <Show when={railVisible()}>
            <box
              width={railWidth()}
              flexShrink={0}
              flexDirection="column"
              backgroundColor={theme.background.raised.base}
            >
              <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1} flexDirection="column">
                <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                  Tâches
                </text>
                <text fg={theme.text.muted}>
                  {counts().run} en cours · {counts().wait} en attente
                </text>
                <text fg={theme.text.faint}>
                  {counts().done} terminées · {TASKS.length} sessions
                </text>
              </box>
              <box flexGrow={1} minHeight={0}>
                <SessionTabs
                  controller={controller}
                  orientation="vertical"
                  width={railWidth()}
                  animations={false}
                  indicators="status"
                />
              </box>
            </box>
          </Show>

          <box flexGrow={1} minWidth={0} flexDirection="column">
            <box
              flexShrink={0}
              paddingLeft={2}
              paddingRight={2}
              paddingTop={compact() ? 0 : 1}
              paddingBottom={compact() ? 0 : 1}
              border={["bottom"]}
              borderColor={theme.border.base}
              flexDirection="column"
              gap={compact() ? 0 : 1}
            >
              <box flexDirection="row" gap={1}>
                <text fg={statusColor(theme, currentStatus())}>{statusIcon(currentStatus())}</text>
                <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                  {currentTask().title}
                </text>
                <box flexGrow={1} />
                <text fg={theme.text.muted}>{currentTask().model}</text>
              </box>
              <box flexDirection="row" gap={1}>
                <text fg={theme.text.muted}>
                  {statusLabel(currentStatus())} · {currentTask().project} · {currentTask().branch}
                </text>
                <box flexGrow={1} />
                <text fg={theme.text.feedback.success.base}>+{currentTask().additions}</text>
                <text fg={theme.text.feedback.error.base}>−{currentTask().deletions}</text>
              </box>
            </box>

            <scrollbox flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
              <box flexDirection="column" gap={1} paddingBottom={1}>
                <MessageCard
                  style={design.style()}
                  borderColor={theme.border.base}
                  backgroundColor={theme.background.raised.base}
                >
                  <box padding={1} flexDirection="column" gap={1}>
                    <text fg={theme.text.muted}>toi</text>
                    <text fg={theme.text.base}>
                      Reprends la maquette Tâches / Session / Diff dans la TUI, avec des données de test.
                    </text>
                  </box>
                </MessageCard>

                <MessageCard
                  style={design.style()}
                  borderColor={theme.border.base}
                  backgroundColor={theme.background.raised.base}
                >
                  <box paddingTop={1} paddingRight={1} paddingBottom={1}>
                    <TextPart part={ASSISTANT_PART} message={ASSISTANT} last />
                  </box>
                </MessageCard>

                <box flexDirection="column">
                  <InlineToolRow icon={icon("search")} color={theme.text.muted} complete pending="Lecture">
                    {`Lire packages/tui/src/routes/session/index.tsx`}
                  </InlineToolRow>
                  <InlineToolRow icon={icon("terminal")} color={theme.text.muted} complete pending="Exécution">
                    {`bash  bun run typecheck`}
                  </InlineToolRow>
                  <InlineToolRow icon={icon("edit")} color={theme.text.muted} complete pending="Édition">
                    {`Éditer packages/tui/src/feature-plugins/system/storybook`}
                  </InlineToolRow>
                </box>

                <Show when={!permissionOpen() && status(currentTask().id) === "done"}>
                  <text fg={theme.text.feedback.success.base}>
                    {icon("check")} Permission traitée · la session peut continuer.
                  </text>
                </Show>

                <box
                  flexDirection="column"
                  gap={1}
                  paddingLeft={2}
                  paddingTop={1}
                  paddingBottom={1}
                  border={["left"]}
                  borderColor={theme.border.base}
                >
                  <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                    Plan
                  </text>
                  <For each={TODOS}>{(todo) => <TodoItem theme={theme} todo={todo} />}</For>
                </box>
              </box>
            </scrollbox>

            <Show when={permissionOpen() && !short()}>
              <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
                <PermissionCard
                  theme={theme}
                  style={design.style()}
                  onAllow={() => decide("once")}
                  onReject={() => decide("reject")}
                />
              </box>
            </Show>

            <Show when={permissionOpen() && short()}>
              <box
                flexShrink={0}
                paddingLeft={2}
                paddingRight={2}
                border={["top"]}
                borderColor={theme.text.feedback.warning.base}
                flexDirection="column"
              >
                <box flexDirection="row" gap={1}>
                  <text fg={theme.text.feedback.warning.base}>{icon("warning")} Permission</text>
                  <text fg={theme.text.muted}>bash bun run typecheck</text>
                </box>
                <box flexDirection="row" gap={2}>
                  <text fg={theme.text.action.primary.base}>a autoriser</text>
                  <text fg={theme.text.base}>x refuser</text>
                </box>
              </box>
            </Show>

            <box
              flexShrink={0}
              paddingLeft={2}
              paddingRight={2}
              paddingBottom={compact() ? 0 : 1}
              paddingTop={compact() ? 0 : 1}
              border={["top"]}
              borderColor={theme.border.base}
            >
              <box
                paddingLeft={1}
                paddingRight={1}
                paddingTop={compact() ? 0 : 1}
                paddingBottom={compact() ? 0 : 1}
                backgroundColor={theme.background.raised.base}
                border={compact() ? [] : ["top", "right", "bottom", "left"]}
                borderColor={theme.border.base}
                flexDirection="column"
                gap={compact() ? 0 : 1}
              >
                <box flexDirection="row" gap={1}>
                  <text fg={theme.text.faint}>Décris ce que l'agent doit faire…</text>
                  <box flexGrow={1} />
                  <Show when={compact()}>
                    <text fg={theme.text.muted}>{icon("enter")} envoyer</text>
                  </Show>
                </box>
                <Show when={!compact()}>
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.text.muted}>
                      {icon("folder")} {currentTask().project}
                    </text>
                    <box flexGrow={1} />
                    <text fg={theme.text.muted}>{icon("enter")} envoyer</text>
                  </box>
                </Show>
              </box>
            </box>
          </box>

          <Show when={diffVisible()}>
            <box
              width={diffWidth()}
              flexShrink={0}
              flexDirection="column"
              backgroundColor={theme.background.raised.base}
              border={["left"]}
              borderColor={theme.border.base}
            >
              <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1} flexDirection="column" gap={1}>
                <box flexDirection="row">
                  <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                    Modifications
                  </text>
                  <box flexGrow={1} />
                  <text fg={theme.text.muted}>
                    {DIFF.length} fichier{DIFF.length > 1 ? "s" : ""}
                  </text>
                </box>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.text.feedback.success.base}>
                    +{DIFF.reduce((total, file) => total + file.additions, 0)}
                  </text>
                  <text fg={theme.text.feedback.error.base}>
                    −{DIFF.reduce((total, file) => total + file.deletions, 0)}
                  </text>
                  <text fg={theme.text.faint}>depuis le début du tour</text>
                </box>
              </box>

              <box flexShrink={0} flexDirection="column" paddingTop={1}>
                <For each={DIFF}>
                  {(file, index) => (
                    <box
                      flexDirection="row"
                      gap={1}
                      paddingLeft={2}
                      paddingRight={2}
                      backgroundColor={index() === activeFile() ? theme.background.raised.high : undefined}
                      onMouseUp={() => setActiveFile(index())}
                    >
                      <text fg={theme.text.muted}>{icon("file")}</text>
                      <text fg={index() === activeFile() ? theme.text.base : theme.text.muted} flexGrow={1}>
                        {file.file}
                      </text>
                      <text fg={theme.text.feedback.success.base}>+{file.additions}</text>
                      <text fg={theme.text.feedback.error.base}>−{file.deletions}</text>
                    </box>
                  )}
                </For>
              </box>

              <scrollbox flexGrow={1} minHeight={0} paddingTop={1}>
                <PatchDiff
                  diff={currentFile().patch}
                  hunkFg={theme.diff.text.hunkHeader}
                  view="unified"
                  filetype="typescript"
                  syntaxStyle={themes.currentSyntax()}
                  showLineNumbers={true}
                  width="100%"
                  wrapMode="none"
                  fg={theme.text.base}
                  addedBg={theme.diff.background.added}
                  removedBg={theme.diff.background.removed}
                  contextBg={theme.diff.background.context}
                  addedSignColor={theme.diff.highlight.added}
                  removedSignColor={theme.diff.highlight.removed}
                  lineNumberFg={theme.diff.lineNumber.text}
                  lineNumberBg={theme.diff.background.context}
                  addedLineNumberBg={theme.diff.lineNumber.background.added}
                  removedLineNumberBg={theme.diff.lineNumber.background.removed}
                />
              </scrollbox>
            </box>
          </Show>
        </box>

        <StoryFooter
          context={props.context}
          title="storybook / tâches · session · diff"
          details={[
            `${dimensions().width}×${dimensions().height}`,
            railVisible() ? "rail" : "rail masqué",
            diffVisible() ? "diff" : "diff masqué",
            ...(dimensions().width >= 100 ? [currentTask().model] : []),
          ]}
          status={`${counts().run} run · ${counts().wait} wait · ${counts().done} done`}
          message={lastEvent()}
          controls={[
            { shortcut: "1-4", label: "tâche" },
            { shortcut: "a", label: "autoriser" },
            { shortcut: "x", label: "refuser" },
            { shortcut: "b", label: "rail" },
            { shortcut: "d", label: "diff" },
            { shortcut: "r", label: "reset" },
            { shortcut: "esc", label: "back" },
          ]}
        />
      </box>
    </context.Provider>
  )
}

export const tasksSessionDiffStory: Story = {
  id: "tasks-session-diff",
  title: "Tâches / Session / Diff",
  render: (context) => <TasksSessionDiffStory context={context} />,
}
