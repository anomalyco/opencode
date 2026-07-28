import { createMemo, For, Show } from "solid-js"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { getScrollAcceleration } from "../../util/scroll"
import { Prompt, type PromptRef } from "../../component/prompt"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { SubagentFooter } from "./subagent-footer"
import { usePluginRuntime } from "../../plugin/runtime"

export function SessionSplitView(props: {
  sessionID: string
  messages: any[]
  scrollRef?: (r: any) => void
  planScrollRef?: (r: any) => void
  promptRef?: (r: PromptRef | undefined) => void
  disabled?: boolean
  visible?: boolean
  onPromptSubmit?: () => void
  permissions?: any[]
  questions?: any[]
  renderMessage: (message: any, index: () => number) => any
}) {
  const sync = useSync()
  const { theme } = useTheme()
  const pluginRuntime = usePluginRuntime()
  const tuiConfig = useTuiConfig()
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  const session = () => sync.session.get(props.sessionID)

  const split = createMemo(() => {
    let currentAgent = "build"
    const plan: any[] = []
    const build: any[] = []

    for (const msg of props.messages) {
      const type = msg.type ?? msg.role
      const agent = msg.agent ?? msg.agents?.[0]?.name

      if (type === "agent-switched") {
        currentAgent = agent
        if (currentAgent === "plan") plan.push(msg)
        else build.push(msg)
      } else if (type === "assistant") {
        if (agent === "plan") {
          plan.push(msg)
          currentAgent = "plan"
        } else {
          build.push(msg)
          currentAgent = "build"
        }
      } else if (type === "user") {
        if (agent) {
          if (agent === "plan") {
            plan.push(msg)
            currentAgent = "plan"
          } else {
            build.push(msg)
            currentAgent = "build"
          }
        } else if (currentAgent === "plan") plan.push(msg)
        else build.push(msg)
      } else {
        if (currentAgent === "plan") plan.push(msg)
        else build.push(msg)
      }
    }

    return { planMessages: plan, buildMessages: build }
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
          <scrollbox
            ref={props.planScrollRef}
            viewportOptions={{
              paddingRight: 1,
            }}
            verticalScrollbarOptions={{
              paddingLeft: 1,
              visible: true,
              trackOptions: {
                backgroundColor: theme.backgroundElement,
                foregroundColor: theme.border,
              },
            }}
            flexGrow={1}
            minHeight={0}
            stickyScroll={true}
            stickyStart="bottom"
            scrollAcceleration={scrollAcceleration()}
          >
            <box height={1} />
            <For each={split().planMessages}>
              {(message, index) => props.renderMessage(message, index)}
            </For>
          </scrollbox>
        </box>

        {/* Right Pane: Build Session */}
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
            viewportOptions={{
              paddingRight: 1,
            }}
            verticalScrollbarOptions={{
              paddingLeft: 1,
              visible: true,
              trackOptions: {
                backgroundColor: theme.backgroundElement,
                foregroundColor: theme.border,
              },
            }}
            flexGrow={1}
            minHeight={0}
            stickyScroll={true}
            stickyStart="bottom"
            scrollAcceleration={scrollAcceleration()}
          >
            <box height={1} />
            <For each={split().buildMessages}>
              {(message, index) => props.renderMessage(message, index)}
            </For>
          </scrollbox>
        </box>
      </box>

      {/* Bottom Prompt & Footer Area */}
      <box flexShrink={0}>
        <Show when={props.permissions && props.permissions.length > 0}>
          {(() => {
            const p = props.permissions?.[0]
            return p ? (
              <PermissionPrompt
                request={p}
                directory={sync.session.get(p.sessionID)?.directory}
              />
            ) : null
          })()}
        </Show>
        <Show when={props.permissions && props.permissions.length === 0 && props.questions && props.questions.length > 0}>
          {(() => {
            const q = props.questions?.[0]
            return q ? (
              <QuestionPrompt
                request={q}
                directory={sync.session.get(q.sessionID)?.directory}
              />
            ) : null
          })()}
        </Show>
        <Show when={session()?.parentID}>
          <SubagentFooter />
        </Show>
        <Show when={props.visible}>
          <pluginRuntime.Slot
            name="session_prompt"
            mode="replace"
            session_id={props.sessionID}
            visible={props.visible}
            disabled={props.disabled}
            on_submit={props.onPromptSubmit}
            ref={props.promptRef}
          >
            <Prompt
              visible={props.visible}
              ref={props.promptRef}
              disabled={props.disabled}
              onSubmit={props.onPromptSubmit}
              sessionID={props.sessionID}
              right={<pluginRuntime.Slot name="session_prompt_right" session_id={props.sessionID} />}
            />
          </pluginRuntime.Slot>
        </Show>
      </box>
    </box>
  )
}
