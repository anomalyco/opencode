import type { Plugin } from "@opencode-ai/plugin/tui"
import { createMermaidCodeBlockRenderer } from "@opencode-ai/merman/markdown"
import { resolveOpenCodeDiagramPalette } from "@opencode-ai/merman/palette"
import { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useTheme, useThemes } from "../../../context/theme"
import { usePlugin } from "../../../plugin/context"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

const fixtures = [
  {
    id: "deployment",
    title: "Deployment architecture",
    source: `flowchart LR
  Client[OpenCode client]

  subgraph CF[Cloudflare]
    DNS[opencode.ai]
    Web[Console frontend Worker]
    Proxy[Console API proxy Worker]
    Infer[inference-next Worker]
    KV[Model registry KV]
    Redis[Upstash Redis]
    Logs[Axiom / Cloudflare logs]
    Lake[Pipeline to R2 data lake]
  end

  subgraph AWS[AWS]
    direction TB
    EKS[EKS cluster]
    API[Console API pod<br/>1 replica]
    OTEL[OTel collector]
    ECR[ECR]
  end

  DB[(PlanetScale)]
  Models[Anthropic / OpenAI / other providers]

  Client -->|/inference/*| DNS --> Infer
  Client -->|/console/*| DNS --> Web
  Web -->|/console/api, /auth, etc.| Proxy
  Proxy -->|Cloudflare VPC service| API
  Infer -->|public DATABASE_URL| DB
  Infer --> KV
  Infer --> Redis
  Infer --> Models
  Infer --> Logs
  Infer --> Lake
  API -->|private DATABASE_AWS_URL| DB
  API --> OTEL
  ECR --> API`,
  },
  {
    id: "grouped-flow",
    title: "Grouped request pipeline",
    source: `flowchart LR
  Input([Input]) --> Gateway[API gateway]
  subgraph Platform[Platform]
    Gateway --> Auth[Authenticate]
    Auth -->|accepted| Queue[(Work queue)]
    Queue --> Worker[Worker] --> Store[(Result store)]
  end
  Store --> Output([Output])`,
  },
  {
    id: "state-lifecycle",
    title: "Review lifecycle",
    source: `stateDiagram-v2
  direction TB
  [*] --> Ready
  Ready --> Running: start
  Running --> Review: submit
  Review --> Done: approve
  Done --> [*]: finish
  note right of Review
    Review preserves the original request
    and records the final decision
  end note`,
  },
  {
    id: "state-composite",
    title: "Nested composite lifecycle",
    source: `stateDiagram-v2
  direction LR
  state Session {
    [*] --> Open
    state Open {
      [*] --> Clean
      Clean --> Dirty: edit
      Dirty --> Clean: save
      Dirty --> [*]
    }
    Open --> Closing: request close
    Closing --> Open: cancel
    Closing --> [*]: closed
    note right of Dirty: unsaved changes
  }
  [*] --> Session: hydrate
  Session --> [*]: release`,
  },
  {
    id: "flow-fanout",
    title: "Fan-out and reconvergence",
    source: `flowchart LR
  Request([Request]) --> Gateway[API gateway]
  Gateway -->|authenticate| Auth[Authentication]
  Gateway -->|rate limit| Limit[Rate limiter]
  Gateway -->|cache lookup| Cache[(Response cache)]
  Auth --> Worker[Request worker]
  Limit --> Worker
  Cache --> Worker
  Worker --> Response([Response])`,
  },
  {
    id: "flow-feedback",
    title: "Retry and failure routes",
    source: `flowchart TD
  Start([Incoming job]) --> Validate{Valid?}
  Validate -->|yes| Queue[(Job queue)]
  Validate -->|no| Reject[Reject request]
  Queue --> Execute[Execute job]
  Execute -->|retry| Queue
  Execute -->|failed| Failed[Dead letter queue]
  Execute -->|complete| Complete([Complete])`,
  },
  {
    id: "flow-nested-groups",
    title: "Nested deployment groups",
    source: `flowchart LR
  Browser([Browser]) --> Gateway[Gateway]
  subgraph Cloud[Cloud platform]
    direction TB
    subgraph Compute[Compute]
      API[API service] --> Worker[Background worker]
    end
    subgraph Storage[Storage]
      Database[(Database)]
      Cache[(Cache)]
    end
    API --> Database
    Worker --> Cache
  end
  Gateway --> API
  Worker --> Result([Result])`,
  },
  {
    id: "flow-long-labels",
    title: "Long route labels",
    source: `flowchart LR
  Client[Desktop client] -->|exchange authorization code| Auth[Authorization service]
  Auth -->|validate signed access token| API[Application API]
  API -->|read tenant configuration| Database[(Tenant database)]
  API -->|publish background work item| Queue[(Work queue)]
  Queue --> Worker[Background worker]
  Worker -->|notify subscribed clients| Client`,
  },
  {
    id: "state-choice",
    title: "Choice and recovery",
    source: `stateDiagram-v2
  direction TB
  [*] --> Pending
  Pending --> Decision: review
  state Decision <<choice>>
  Decision --> Approved: accept
  Decision --> Rejected: reject
  Rejected --> Pending: retry
  Approved --> [*]: complete`,
  },
  {
    id: "state-parallel",
    title: "Parallel transitions",
    source: `stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Active: first request
  Idle --> Active: second request
  Idle --> Active: resumed request
  Active --> Idle: reset
  Active --> [*]: shutdown`,
  },
  {
    id: "state-notes",
    title: "Notes and feedback routes",
    source: `stateDiagram-v2
  direction LR
  [*] --> Draft
  Draft --> Review: submit
  Review --> Published: approve
  Published --> Draft: revise
  note left of Draft: Content is editable
  note right of Review: Requires two approvals
  note right of Published: Readers can subscribe`,
  },
  {
    id: "state-self-loops",
    title: "State self-transitions",
    source: `stateDiagram-v2
  direction TB
  [*] --> Listening
  Listening --> Listening: heartbeat
  Listening --> Listening: refresh token
  Listening --> Connected: client connected
  Connected --> Connected: received message
  Connected --> Listening: disconnected
  Connected --> [*]: shutdown`,
  },
] as const

const components = [
  { id: "lines", label: "lines", dimmable: true },
  { id: "boxes", label: "boxes", dimmable: true },
  { id: "boxText", label: "box text", dimmable: false },
  { id: "labels", label: "labels", dimmable: true },
  { id: "notes", label: "notes", dimmable: true },
  { id: "groups", label: "groups", dimmable: true },
  { id: "markers", label: "markers", dimmable: true },
] as const
const dimness = ["dim", "muted", "soft", "clear"] as const
type DiagramComponent = (typeof components)[number]["id"]
type DiagramComponentOption = (typeof components)[number]
type ComponentSettings = Readonly<Record<DiagramComponent, Readonly<{ color: number; tone: number }>>>

const neutralSettings = {
  lines: { color: 0, tone: 2 },
  boxes: { color: 0, tone: 1 },
  boxText: { color: 0, tone: 3 },
  labels: { color: 0, tone: 0 },
  notes: { color: 0, tone: 2 },
  groups: { color: 0, tone: 1 },
  markers: { color: 0, tone: 2 },
} as const satisfies ComponentSettings

const palettes = [
  {
    id: "neutral",
    title: "Monochrome",
    description: "Restrained neutral hierarchy",
    styles: neutralSettings,
  },
  {
    id: "routes",
    title: "Colored routes",
    description: "Neutral entities with a categorical signal color",
    styles: {
      ...neutralSettings,
      lines: { color: 1, tone: 2 },
      labels: { color: 1, tone: 0 },
    },
  },
  {
    id: "notes",
    title: "Colored notes",
    description: "Route and note accents with neutral structure",
    styles: {
      ...neutralSettings,
      lines: { color: 1, tone: 2 },
      labels: { color: 1, tone: 0 },
      notes: { color: 2, tone: 2 },
    },
  },
  {
    id: "cool-groups",
    title: "Cool groups",
    description: "Color 4 groups and notes with restrained neutral routes",
    styles: {
      ...neutralSettings,
      lines: { color: 0, tone: 0 },
      notes: { color: 4, tone: 2 },
      groups: { color: 4, tone: 2 },
    },
  },
] as const satisfies readonly {
  id: string
  title: string
  description: string
  styles: ComponentSettings
}[]

function MermanLayoutsStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const themes = useThemes()
  const plugins = usePlugin()
  const [selected, setSelected] = createSignal(0)
  const [selectedPalette, setSelectedPalette] = createSignal<number | undefined>(3)
  const [selectedComponent, setSelectedComponent] = createSignal(0)
  const [settings, setSettings] = createSignal<ComponentSettings>(palettes[3].styles)
  const [generation, setGeneration] = createSignal(0)
  const fixture = createMemo(() => fixtures[selected()]!)
  const component = createMemo(() => components[selectedComponent()]!)
  const componentSetting = createMemo(() => settings()[component().id])
  const paletteOption = createMemo(() => {
    const index = selectedPalette()
    if (index !== undefined) return palettes[index]!
    return {
      id: "custom",
      title: "Custom",
      description: `Editing ${component().label} · ${componentSetting().color === 0 ? "neutral" : `color ${componentSetting().color}`}${component().dimmable ? ` · ${dimness[componentSetting().tone]}` : " · full brightness"}`,
    }
  })
  const presentation = createMemo(() => {
    const base = resolveOpenCodeDiagramPalette(props.context.theme, props.context.themeMode)
    const neutral = [theme.text.subdued, base.muted, base.secondary, theme.text.default]
    const steps =
      props.context.themeMode === "light" ? ([400, 500, 700, 800] as const) : ([600, 500, 300, 200] as const)
    const color = (id: DiagramComponent, tone = settings()[id].tone) => {
      const value = settings()[id]
      if (value.color === 0) return neutral[tone] ?? neutral[2]!
      return theme.categorical[(value.color - 1) % theme.categorical.length]![steps[tone] ?? steps[2]]
    }
    const labelAccent = color("labels", 3)
    const labelAlpha = [0.08, 0.12, 0.18, 0.24][settings().labels.tone] ?? 0.12

    const colors = {
      ...base,
      text: theme.text.default,
      boxText: color("boxText", 3),
      boxBorder: color("boxes"),
      line: color("lines"),
      labelBackground: RGBA.fromValues(labelAccent.r, labelAccent.g, labelAccent.b, labelAlpha),
      group: color("groups"),
      groupText: color("groups"),
      marker: color("markers"),
      noteBorder: color("notes"),
      noteText: color("notes", 3),
      noteConnector: color("notes"),
    }
    return {
      colors,
      swatches: {
        lines: colors.line,
        boxes: colors.boxBorder,
        boxText: colors.boxText,
        labels: labelAccent,
        notes: colors.noteBorder,
        groups: colors.group,
        markers: colors.marker,
      },
    }
  })
  const rendered = createMemo(() => ({
    fixture: fixture(),
    colors: presentation().colors,
    generation: generation(),
    width: dimensions().width,
  }))
  const markdown = createMemo(() => `\`\`\`mermaid-story\n${fixture().source}\n\`\`\``)
  const moveFixture = (offset: number) =>
    setSelected((current) => (current + offset + fixtures.length) % fixtures.length)
  const applyPalette = (index: number) => {
    setSelectedPalette(index)
    setSettings(palettes[index]!.styles)
  }
  const movePalette = (offset: number) => {
    const current = selectedPalette() ?? (offset > 0 ? -1 : 0)
    applyPalette((current + offset + palettes.length) % palettes.length)
  }
  const cycleColor = () => {
    const selected = component().id
    setSettings((current) => ({
      ...current,
      [selected]: { ...current[selected], color: (current[selected].color + 1) % (theme.categorical.length + 1) },
    }))
    setSelectedPalette(undefined)
  }
  const cycleDimness = () => {
    if (!component().dimmable) return
    const selected = component().id
    setSettings((current) => ({
      ...current,
      [selected]: { ...current[selected], tone: (current[selected].tone + 1) % dimness.length },
    }))
    setSelectedPalette(undefined)
  }
  const settingDescription = (item: DiagramComponentOption, separator = "/") => {
    const value = settings()[item.id]
    const color = value.color === 0 ? "neutral" : `color ${value.color}`
    return item.dimmable ? `${color}${separator}${dimness[value.tone]}` : color
  }

  onCleanup(
    props.context.markdown.registerCodeBlockRenderer(
      "mermaid-story",
      createMermaidCodeBlockRenderer(props.context.renderer, () => ({
        colors: presentation().colors,
        layoutMaxWidth: Math.max(1, dimensions().width - 5),
      })),
    ),
  )

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      {
        bind: "up,k",
        title: "Previous fixture",
        group: "Storybook",
        run: () => moveFixture(-1),
      },
      {
        bind: "down,j",
        title: "Next fixture",
        group: "Storybook",
        run: () => moveFixture(1),
      },
      {
        bind: "left,h",
        title: "Previous palette",
        group: "Storybook",
        run: () => movePalette(-1),
      },
      {
        bind: "right,l",
        title: "Next palette",
        group: "Storybook",
        run: () => movePalette(1),
      },
      {
        bind: "tab",
        title: "Next diagram component",
        group: "Storybook",
        run: () => setSelectedComponent((current) => (current + 1) % components.length),
      },
      {
        bind: "shift+tab",
        title: "Previous diagram component",
        group: "Storybook",
        run: () => setSelectedComponent((current) => (current + components.length - 1) % components.length),
      },
      {
        bind: "c",
        title: "Cycle component color",
        group: "Storybook",
        run: cycleColor,
      },
      {
        bind: "d",
        title: "Cycle component dimness",
        group: "Storybook",
        run: cycleDimness,
      },
      ...palettes.map((item, index) => ({
        bind: String(index + 1),
        title: `Use ${item.title}`,
        group: "Storybook",
        run: () => applyPalette(index),
      })),
      {
        bind: "r",
        title: "Reset fixture",
        group: "Storybook",
        run: () => {
          setSelected(0)
          setSelectedComponent(0)
          applyPalette(3)
          setGeneration((current) => current + 1)
        },
      },
    ],
  }))

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background.default}
    >
      <scrollbox flexGrow={1} minHeight={0} viewportOptions={{ paddingRight: 1 }}>
        <Show when={rendered()} keyed>
          {(item) => (
            <box paddingLeft={2} paddingRight={2} paddingTop={1} flexDirection="column">
              <text fg={theme.text.default}>{item.fixture.title}</text>
              <text fg={theme.text.subdued}>{item.fixture.id}</text>
              <box height={1} />
              <text fg={theme.text.default}>{paletteOption().title}</text>
              <text fg={theme.text.subdued}>{paletteOption().description}</text>
              <For each={[components.slice(0, 4), components.slice(4)]}>
                {(row) => (
                  <text>
                    <For each={row}>
                      {(value, index) => (
                        <>
                          <Show when={index() > 0}>
                            <span style={{ fg: theme.text.subdued }}> · </span>
                          </Show>
                          <span style={{ fg: presentation().swatches[value.id] }}>
                            {value.id === component().id ? "›" : ""}
                            {value.label} {settingDescription(value)}
                          </span>
                        </>
                      )}
                    </For>
                  </text>
                )}
              </For>
              <box height={1} />
              <markdown
                width="100%"
                syntaxStyle={themes.currentSyntax()}
                content={markdown()}
                internalBlockMode="top-level"
                tableOptions={{ style: "grid", cellPaddingX: 1 }}
                conceal={true}
                fg={theme.markdown.text}
                bg={theme.background.default}
                renderNode={plugins.markdown()}
              />
            </box>
          )}
        </Show>
      </scrollbox>
      <StoryFooter
        context={props.context}
        title="storybook / Mermaid color lab"
        details={[
          `${selected() + 1}/${fixtures.length}`,
          fixture().id,
          selectedPalette() === undefined ? "custom" : `${selectedPalette()! + 1}/${palettes.length}`,
          paletteOption().id,
          `${dimensions().width}x${dimensions().height}`,
        ]}
        status={`Editing ${component().label}`}
        message={`${componentSetting().color === 0 ? "neutral" : `color ${componentSetting().color}`}${component().dimmable ? ` · ${dimness[componentSetting().tone]}` : " · full brightness"}`}
        controls={[
          { shortcut: "↑/↓", label: "fixture" },
          { shortcut: "←/→", label: "preset" },
          { shortcut: "tab", label: "component" },
          { shortcut: "c", label: "color" },
          ...(component().dimmable ? [{ shortcut: "d", label: "dim" }] : []),
          { shortcut: "drag", label: "pan" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const mermanLayoutsStory: Story = {
  id: "merman-layouts",
  title: "Mermaid color lab",
  render: (context) => <MermanLayoutsStory context={context} />,
}
