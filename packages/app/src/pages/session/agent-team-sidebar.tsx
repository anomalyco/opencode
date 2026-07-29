import { For, Show, createResource, onCleanup, onMount } from "solid-js"
import type { SessionMessage, Team } from "@opencode-ai/schema"
import { useSDK } from "@/context/sdk"

type Snapshot = {
  team: Team.Info
  tasks: readonly Team.Task[]
  messages: readonly Team.Message[]
  activity: Readonly<Record<string, Activity>>
}

type Activity = {
  thinking?: string
  result?: string
  tool?: string
  error?: string
  tps?: number
  context?: number
}

const compact = (value: string | undefined, size = 180) => {
  if (!value) return undefined
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > size ? `${text.slice(0, size)}…` : text
}

const activity = (messages: readonly SessionMessage.Message[]): Activity => {
  const assistant = messages.find((message): message is SessionMessage.Assistant => message.type === "assistant")
  if (!assistant) return {}
  const reasoning = assistant.content.findLast((part) => part.type === "reasoning")
  const answer = assistant.content.findLast((part) => part.type === "text")
  const tool = assistant.content.findLast((part) => part.type === "tool")
  const seconds = assistant.time.completed
    ? Math.max(0.001, (Number(assistant.time.completed) - Number(assistant.time.created)) / 1000)
    : undefined
  const generated = (assistant.tokens?.output ?? 0) + (assistant.tokens?.reasoning ?? 0)
  const context = assistant.tokens
    ? assistant.tokens.input + assistant.tokens.output + assistant.tokens.reasoning + assistant.tokens.cache.read
    : undefined
  const toolError = tool?.state.status === "error" ? tool.state.error.message : undefined
  return {
    thinking: reasoning?.text,
    result: answer?.text,
    tool: tool ? `${tool.name} · ${tool.state.status}` : undefined,
    error: assistant.error?.message ?? toolError,
    tps: seconds && generated ? generated / seconds : undefined,
    context,
  }
}

export function AgentTeamSidebar(props: { sessionID: string }) {
  const sdk = useSDK()
  const [snapshot, { refetch }] = createResource(
    () => props.sessionID,
    async (sessionID): Promise<Snapshot | undefined> => {
      try {
        const api = sdk().teams
        const teams = await api.list()
      const team = teams.find(
        (candidate) =>
          candidate.leadSessionID === sessionID || candidate.members.some((member) => member.sessionID === sessionID),
      )
        if (!team) return
        const [tasks, messages, activities] = await Promise.all([
        api.tasks(team.id),
        api.messages(team.id),
        Promise.all(
          team.members.map(async (member) => {
            const messages = await api.sessionMessages(member.sessionID)
            return [member.sessionID, activity(messages)] as const
          }),
        ),
        ])
        return { team, tasks, messages, activity: Object.fromEntries(activities) }
      } catch {
        return undefined
      }
    },
  )

  onMount(() => {
    const timer = setInterval(() => void refetch(), 1_000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={snapshot()}>
      {(state) => (
        <aside
          aria-label="Agent team live status"
          class="w-80 min-w-72 h-full shrink-0 overflow-y-auto border-l border-border-weaker-base bg-background-base px-3 py-3"
        >
          <div class="flex items-center justify-between gap-2 mb-3">
            <div>
              <div class="text-14-medium text-text-strong">{state().team.name}</div>
              <div class="text-11-regular text-text-weak">Agent Team · live</div>
            </div>
            <div class="text-11-medium text-text-weak uppercase">{state().team.status}</div>
          </div>

          <div class="flex flex-col gap-2">
            <For each={state().team.members}>
              {(member) => {
                const live = () => state().activity[member.sessionID] ?? {}
                return (
                  <section class="rounded-md border border-border-weak-base bg-background-stronger px-3 py-2">
                    <div class="flex items-center justify-between gap-2">
                      <div class="text-13-medium text-text-strong">{member.name}</div>
                      <div class="text-11-medium text-text-weak uppercase">{member.status}</div>
                    </div>
                    <div class="text-11-regular text-text-weak mt-0.5">
                      {member.role} · {member.permission} · {member.model.providerID}/{member.model.id}
                    </div>
                    <div class="flex gap-3 mt-1 text-11-regular text-text-weak">
                      <Show when={live().tps !== undefined}>
                        <span>{live().tps!.toFixed(1)} tok/s</span>
                      </Show>
                      <Show when={live().context !== undefined}>
                        <span>{Math.round(live().context!).toLocaleString()} ctx</span>
                      </Show>
                    </div>
                    <Show when={live().thinking}>
                      <div class="mt-2 text-11-regular text-text-weak">
                        <span class="text-text-strong">Thinking: </span>
                        {compact(live().thinking)}
                      </div>
                    </Show>
                    <Show when={live().tool}>
                      <div class="mt-1 text-11-regular text-text-weak">
                        <span class="text-text-strong">Tool: </span>
                        {live().tool}
                      </div>
                    </Show>
                    <Show when={live().result}>
                      <div class="mt-1 text-11-regular text-text-weak">
                        <span class="text-text-strong">Result: </span>
                        {compact(live().result)}
                      </div>
                    </Show>
                    <Show when={live().error ?? member.error}>
                      <div class="mt-1 text-11-regular text-icon-critical-base">
                        Error: {compact(live().error ?? member.error)}
                      </div>
                    </Show>
                  </section>
                )
              }}
            </For>
          </div>

          <div class="mt-4 text-12-medium text-text-strong">Shared tasks</div>
          <div class="mt-1 flex flex-col gap-1">
            <Show when={state().tasks.length} fallback={<div class="text-11-regular text-text-weak">No shared tasks</div>}>
              <For each={state().tasks}>
                {(task) => (
                  <div class="rounded border border-border-weak-base px-2 py-1.5">
                    <div class="text-11-medium text-text-strong">{task.title}</div>
                    <div class="text-11-regular text-text-weak">
                      {task.status}
                      {task.assignee ? ` · ${task.assignee}` : ""}
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>

          <Show when={state().messages.length}>
            <div class="mt-4 text-12-medium text-text-strong">Team messages</div>
            <For each={state().messages.slice(-5).toReversed()}>
              {(message) => (
                <div class="mt-1 text-11-regular text-text-weak">
                  <span class="text-text-strong">{message.from} → {message.to}:</span> {compact(message.text, 120)}
                </div>
              )}
            </For>
          </Show>
        </aside>
      )}
    </Show>
  )
}
