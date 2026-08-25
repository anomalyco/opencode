import type { Plugin } from "@opencode-ai/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, Show } from "solid-js"
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
    id: "nested-flow",
    title: "Nested directed groups",
    source: `flowchart LR
  Input([Input]) --> Parse
  subgraph Outer[Outer orchestration]
    direction RL
    subgraph Inner[Inner pipeline]
      direction TD
      Parse[Parse request] --> Validate{Valid?}
      Validate -->|yes| Cache[(Cache)]
      Cache -->|stale| Validate
    end
    Validate --> Dispatch[[Dispatch work]]
    Dispatch -->|requeue| Parse
  end
  Dispatch -. result .-> Output([Output])
  Output -->|audit| Cache`,
  },
  {
    id: "state-feedback",
    title: "Dense state feedback",
    source: `stateDiagram-v2
  direction TB
  [*] --> Root
  Root --> Alpha: dispatch alpha
  Root --> Beta: dispatch beta
  Alpha --> Merge: alpha complete
  Beta --> Merge: beta complete
  Merge --> Alpha: retry alpha
  Merge --> Beta: retry beta
  Merge --> [*]: finish
  note right of Merge
    Retries preserve the original request
    and remain visible after compaction
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
    }
    Open --> Closing: request close
    Closing --> Open: cancel
    Closing --> [*]: closed
    note right of Dirty: unsaved changes
  }
  [*] --> Session: hydrate
  Session --> [*]: release`,
  },
] as const

function MermanLayoutsStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const themes = useThemes()
  const plugins = usePlugin()
  const [selected, setSelected] = createSignal(0)
  const [generation, setGeneration] = createSignal(0)
  const fixture = createMemo(() => fixtures[selected()]!)
  const rendered = createMemo(() => ({ fixture: fixture(), generation: generation() }))
  const markdown = createMemo(() => `\`\`\`mermaid\n${fixture().source}\n\`\`\``)
  const move = (offset: number) => setSelected((current) => (current + offset + fixtures.length) % fixtures.length)

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      {
        bind: "left,k",
        title: "Previous fixture",
        group: "Storybook",
        run: () => move(-1),
      },
      {
        bind: "right,j",
        title: "Next fixture",
        group: "Storybook",
        run: () => move(1),
      },
      {
        bind: "r",
        title: "Reset fixture",
        group: "Storybook",
        run: () => {
          setSelected(0)
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
      <Show when={rendered()} keyed>
        {(item) => (
          <scrollbox flexGrow={1} minHeight={0} viewportOptions={{ paddingRight: 1 }}>
            <box paddingLeft={2} paddingRight={2} paddingTop={1} flexDirection="column">
              <text fg={theme.text.default}>{item.fixture.title}</text>
              <text fg={theme.text.subdued}>{item.fixture.id}</text>
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
          </scrollbox>
        )}
      </Show>
      <StoryFooter
        context={props.context}
        title="storybook / Mermaid layouts"
        details={[`${selected() + 1}/${fixtures.length}`, fixture().id, `${dimensions().width}x${dimensions().height}`]}
        controls={[
          { shortcut: "j/k or ←/→", label: "fixture" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const mermanLayoutsStory: Story = {
  id: "merman-layouts",
  title: "Mermaid layouts",
  render: (context) => <MermanLayoutsStory context={context} />,
}
