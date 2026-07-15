import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { incrementSkillUsage, rankSkills, sanitizeSkillUsage, type SkillUsage } from "./skill-usage"

const id = "internal:sidebar-skills"
const key = "sidebar_skill_usage"

function View(props: { api: TuiPluginApi; sessionID: string; usage: () => SkillUsage }) {
  const [open, setOpen] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  const theme = () => props.api.theme.current
  const skills = createMemo(() => props.api.state.skill.list(props.sessionID))
  const ranked = createMemo(() => rankSkills(skills().map((item) => item.name), props.usage(), now()))

  onMount(() => {
    void props.api.state.skill.refresh(props.sessionID).catch(() => {})
    const timer = setInterval(() => setNow(Date.now()), 3_600_000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => skills().length > 0 && setOpen((value) => !value)}>
        <Show when={skills().length > 0}>
          <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
        </Show>
        <text fg={theme().text}>
          <b>Skills</b> <span style={{ fg: theme().textMuted }}>({skills().length})</span>
        </text>
      </box>
      <Show when={open()}>
        <Show when={skills().length === 0}>
          <text fg={theme().textMuted}>No skills registered</text>
        </Show>
        <For each={ranked()}>
          {(item) => (
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} fg={theme().textMuted}>
                •
              </text>
              <text fg={theme().text} wrapMode="word">
                {item.name}
                <Show when={item.count > 0}>
                  <span style={{ fg: theme().textMuted }}> {item.count}</span>
                </Show>
              </text>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  const [usage, setUsage] = createSignal(sanitizeSkillUsage(api.kv.get(key), Date.now()))
  const completed = new Set<string>()

  const record = (name: unknown, eventID: string) => {
    if (typeof name !== "string" || name.length === 0 || completed.has(eventID)) return
    completed.add(eventID)
    const next = incrementSkillUsage(usage(), name, Date.now())
    setUsage(next)
    api.kv.set(key, next)
  }

  api.lifecycle.onDispose(
    api.event.on("message.part.updated", (event) => {
      const part = event.properties.part
      if (part.type !== "tool" || part.tool !== "skill" || part.state.status !== "completed") return
      record(Reflect.get(part.state.input, "name"), part.id)
    }),
  )

  api.lifecycle.onDispose(
    api.event.on("command.executed", (event) => {
      const session = api.state.session.get(event.properties.sessionID)
      if (!session) return
      const skills = api.state.skill.list(event.properties.sessionID)
      if (!skills.some((item) => item.name === event.properties.name)) return
      record(event.properties.name, event.id)
    }),
  )

  api.slots.register({
    order: 250,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} sessionID={props.session_id} usage={usage} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
