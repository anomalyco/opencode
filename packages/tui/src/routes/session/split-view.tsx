import { createSignal, onMount, onCleanup, For, Show } from "solid-js"
import path from "node:path"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { Prompt, type PromptRef } from "../../component/prompt"

export function SessionSplitView(props: {
  sessionID: string
  messages: any[]
  scrollRef?: (r: any) => void
  promptRef?: (r: PromptRef | undefined) => void
  disabled?: boolean
  visible?: boolean
  onPromptSubmit?: () => void
  permissions?: any[]
  questions?: any[]
  renderMessage: (message: any, index: number) => any
}) {
  const sync = useSync()
  const { theme } = useTheme()
  const [planContent, setPlanContent] = createSignal("Loading plan...")

  const session = () => sync.session.get(props.sessionID)

  onMount(async () => {
    const s = session()
    const dir = s?.directory ?? process.cwd()
    const planPath = path.join(dir, "PLAN.md")
    try {
      const content = await Bun.file(planPath).text()
      setPlanContent(content || "PLAN.md is empty.")
    } catch {
      setPlanContent("No PLAN.md found in session directory.")
    }

    const interval = setInterval(async () => {
      try {
        const content = await Bun.file(planPath).text()
        if (content) setPlanContent(content)
      } catch {
        // ignore
      }
    }, 2000)

    onCleanup(() => clearInterval(interval))
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} width="100%" height="100%">
      {/* Top Split Area */}
      <box flexDirection="row" flexGrow={1} minHeight={0} width="100%" gap={1}>
        {/* Left Pane: Plan */}
        <box
          flexGrow={1}
          minHeight={0}
          padding={1}
          border={["top", "bottom", "left", "right"]}
          borderColor={theme.border}
          backgroundColor={theme.backgroundPanel}
          title=" Plan "
          overflow="hidden"
        >
          <markdown content={planContent()} />
        </box>

        {/* Right Pane: Build Session Transcript */}
        <box
          flexGrow={1}
          minHeight={0}
          padding={1}
          border={["top", "bottom", "left", "right"]}
          borderColor={theme.border}
          backgroundColor={theme.backgroundPanel}
          title=" Build Session "
          overflow="hidden"
        >
          <scrollbox
            ref={props.scrollRef}
            flexGrow={1}
            minHeight={0}
            stickyScroll={true}
            stickyStart="bottom"
          >
            <box height={1} />
            <For each={props.messages}>
              {(message, index) => props.renderMessage(message, index())}
            </For>
          </scrollbox>
        </box>
      </box>

      {/* Bottom Prompt Area */}
      <box flexShrink={0}>
        <Show when={props.visible}>
          <Prompt
            visible={props.visible}
            ref={props.promptRef}
            disabled={props.disabled}
            onSubmit={props.onPromptSubmit}
            sessionID={props.sessionID}
          />
        </Show>
      </box>
    </box>
  )
}
