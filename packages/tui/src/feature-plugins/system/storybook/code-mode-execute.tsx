import type { SessionMessageAssistantTool } from "@opencode-ai/client"
import type { Plugin } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { batch, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useConfig } from "../../../config"
import { Execute, SessionContext } from "../../../routes/session"
import { StoryFooter } from "./footer"
import type { Story } from "./index"

type FixtureCall = {
  tool: string
  status: "running" | "completed" | "error"
  input: Record<string, string | boolean>
}

const SCENARIOS: { title: string; calls: Omit<FixtureCall, "status">[] }[] = [
  {
    title: "coordinate background sessions",
    calls: [
      { tool: "anomaly.session_get", input: { sessionID: "ses_current" } },
      { tool: "anomaly.session_create", input: { title: "Investigate rendering" } },
      { tool: "anomaly.session_prompt", input: { text: "Review the execute tool output", notify: true } },
      { tool: "anomaly.session_notify", input: { sessionID: "ses_rendering" } },
    ],
  },
  {
    title: "review Stripe accounts",
    calls: [
      { tool: "stripe.list_available_accounts_or_orgs", input: {} },
      { tool: "stripe.stripe_api_details", input: { stripe_api_operation_id: "GetCustomers", livemode: false } },
      { tool: "stripe.stripe_api_read", input: { stripe_api_operation_id: "GetCustomers", livemode: false } },
    ],
  },
  {
    title: "inspect the nutrition library",
    calls: [
      { tool: "nutrition.list_foods", input: {} },
      { tool: "nutrition.list_meals", input: {} },
      { tool: "nutrition.list_recipes", input: {} },
      { tool: "nutrition.list_foods", input: {} },
    ],
  },
]

const VARIANTS = [
  { id: "status", title: "status marks" },
  { id: "circles", title: "hollow / filled circles" },
  { id: "bullets", title: "bullet points" },
  { id: "chevrons", title: "small chevrons" },
  { id: "dashes", title: "quiet dashes" },
  { id: "numbered", title: "numbered steps" },
  { id: "tree", title: "tree branches" },
  { id: "rail", title: "vertical rail" },
  { id: "dotted-rail", title: "dotted rail" },
  { id: "rounded-rail", title: "rounded rail" },
  { id: "minimal", title: "minimal indentation" },
  { id: "arrows", title: "original arrows" },
] as const

function CodeModeExecuteStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const config = useConfig().data
  const theme = props.context.theme
  const [calls, setCalls] = createStore<FixtureCall[]>([])
  const [parent, setParent] = createSignal<"running" | "completed" | "error">("running")
  const [message, setMessage] = createSignal("starting execution")
  const [variant, setVariant] = createSignal(VARIANTS.findIndex((item) => item.id === "chevrons"))
  const [flush, setFlush] = createSignal(true)
  const [scenario, setScenario] = createSignal(-1)
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const metadata = createMemo(() => ({ toolCalls: calls, ...(parent() === "error" ? { error: true } : {}) }))
  const output = () =>
    parent() === "error"
      ? "Execution failed: the requested operation was rejected\nCheck the selected session and try again."
      : "Execution completed"
  const part = createMemo<SessionMessageAssistantTool>(() => ({
    type: "tool",
    id: "fixture-execute",
    name: "execute",
    state:
      parent() === "running"
        ? { status: "running", input: {}, metadata: metadata() }
        : { status: "completed", input: {}, metadata: metadata(), content: [{ type: "text", text: output() }] },
    time: { created: 1 },
  }))

  const replay = (forceFailure = false) => {
    timers.forEach(clearTimeout)
    timers.clear()
    const next = (scenario() + 1 + Math.floor(Math.random() * (SCENARIOS.length - 1))) % SCENARIOS.length
    const selected = SCENARIOS[next]
    const failure = forceFailure || Math.random() < 0.35 ? Math.floor(Math.random() * selected.calls.length) : -1
    const runtimeError = failure >= 0 && (forceFailure || Math.random() < 0.45)
    const timing = selected.calls.map((_, index) => ({
      start: 450 + index * 700 + Math.floor(Math.random() * 250),
      duration: 500 + Math.floor(Math.random() * 1100),
    }))

    batch(() => {
      setCalls([])
      setParent("running")
      setScenario(next)
      setMessage(selected.title)
    })

    selected.calls.forEach((fixture, index) => {
      timers.add(
        setTimeout(() => {
          setCalls(index, { ...fixture, status: "running" })
          setMessage(`${fixture.tool} running`)
        }, timing[index].start),
      )
      timers.add(
        setTimeout(() => {
          const status = failure === index ? "error" : "completed"
          setCalls(index, "status", status)
          setMessage(`${fixture.tool} ${status === "error" ? "failed" : "completed"}`)
        }, timing[index].start + timing[index].duration),
      )
    })

    timers.add(
      setTimeout(
        () => {
          setParent(runtimeError ? "error" : "completed")
          setMessage(runtimeError ? "execution failed with runtime output" : `${selected.title} completed`)
        },
        Math.max(...timing.map((item) => item.start + item.duration)) + 400,
      ),
    )
  }

  onMount(replay)
  onCleanup(() => timers.forEach(clearTimeout))

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "left,h",
        title: "Previous rendering variant",
        group: "Storybook",
        run: () => setVariant((current) => (current + VARIANTS.length - 1) % VARIANTS.length),
      },
      {
        bind: "right,l",
        title: "Next rendering variant",
        group: "Storybook",
        run: () => setVariant((current) => (current + 1) % VARIANTS.length),
      },
      {
        bind: "r",
        title: "Replay randomized execution",
        group: "Storybook",
        run: () => replay(),
      },
      {
        bind: "f",
        title: "Replay failing execution",
        group: "Storybook",
        run: () => replay(true),
      },
      {
        bind: "i",
        title: "Toggle child indentation",
        group: "Storybook",
        run: () => setFlush((current) => !current),
      },
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.default}>
      <box paddingLeft={2} paddingRight={2} paddingTop={1} flexGrow={1}>
        <text fg={theme.text.default}>Code Mode execution</text>
        <text fg={theme.text.subdued}>Watch a realistic execution and compare nested tool-call renderings.</text>
        <box height={2} />
        <SessionContext.Provider
          value={{
            get width() {
              return Math.max(0, dimensions().width - 4)
            },
            terminal: {
              get width() {
                return dimensions().width
              },
              get height() {
                return dimensions().height
              },
            },
            sessionID: "fixture-code-mode-execute",
            thinkingMode: () => "hide",
            markdownMode: () => "rendered",
            groupExploration: () => false,
            diffWrapMode: () => "word",
            models: () => [],
            config,
            mutatePending: async () => false,
            pendingDelivery: () => undefined,
          }}
        >
          <Execute
            input={{}}
            metadata={metadata()}
            tool="execute"
            output={output()}
            part={part()}
            variant={VARIANTS[variant()].id}
            flush={flush()}
          />
        </SessionContext.Provider>
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / code mode execute"
        details={[`${variant() + 1}/${VARIANTS.length}`, VARIANTS[variant()].title, flush() ? "flush" : "nested"]}
        status={`${calls.length} calls  ·  ${calls.filter((call) => call.status === "running").length} running  ·  ${calls.filter((call) => call.status === "error").length} failed`}
        message={message()}
        controls={[
          { shortcut: "←/→", label: "variant" },
          { shortcut: "i", label: "indent" },
          { shortcut: "r", label: "replay" },
          { shortcut: "f", label: "failure" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const codeModeExecuteStory: Story = {
  id: "code-mode-execute",
  title: "Code Mode execute",
  render: (context) => <CodeModeExecuteStory context={context} />,
}
