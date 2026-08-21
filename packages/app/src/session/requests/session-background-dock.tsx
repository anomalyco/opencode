import { useLanguage } from "@/runtime/i18n/language"
import { useCommand } from "@/shell/commands/command"
import { Keybind } from "@opencode-ai/ui/keybind"
import { For, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { SessionBackgroundPullout } from "./session-background-pullout"

export function SessionBackgroundDock(props: {
  blocking: { type: "shell" | "subagent"; id?: string; label?: string }[]
  tasks: { id: string; type: "shell" | "subagent"; label: string }[]
  onBackground: () => void
}) {
  const language = useLanguage()
  const command = useCommand()
  const [store, setStore] = createStore({ collapsed: true })
  const describe = (shells: number, subagents: number) => {
    const shell = shells ? language.plural("session.background.shell", shells, { count: shells }) : undefined
    const subagent = subagents
      ? language.plural("session.background.subagent", subagents, { count: subagents })
      : undefined
    if (shell && subagent) return language.t("session.background.combine", { first: shell, second: subagent })
    return shell ?? subagent ?? ""
  }
  const summary = createMemo(() => {
    const shells = props.tasks.filter((task) => task.type === "shell").length
    return describe(shells, props.tasks.length - shells)
  })
  const moving = createMemo(() => {
    const shells = props.blocking.filter((task) => task.type === "shell").length
    const subagents = props.blocking.length - shells
    const tasks = describe(shells, subagents)
    return tasks ? language.t("session.background.moveTasks", { tasks }) : ""
  })
  const background = createMemo(() =>
    summary() ? language.t("session.background.inBackground", { tasks: summary() }) : "",
  )
  const blocking = () => props.blocking.length > 0
  const toggle = () => {
    if (blocking()) {
      props.onBackground()
      return
    }
    setStore("collapsed", (value) => !value)
  }

  return (
    <SessionBackgroundPullout
      label={
        <span class="flex flex-col items-start">
          {blocking() && (
            <span>
              <span class="text-v2-text-text-muted">{moving()}</span>
              <span class="pl-2">
                <Keybind keys={command.keybindParts("session.background")} variant="neutral" />
              </span>
            </span>
          )}
          {!!props.tasks.length && <span class="text-v2-text-text-faint">{background()}</span>}
        </span>
      }
      ariaLabel={[moving(), background()].filter(Boolean).join(". ")}
      multiline={blocking() && props.tasks.length > 0}
      collapsed={blocking() || store.collapsed}
      collapsible={!blocking()}
      onToggle={toggle}
      collapseLabel={language.t("session.todo.collapse")}
      expandLabel={language.t("session.todo.expand")}
    >
      <div class="px-4 pb-11 flex flex-col gap-1.5">
        <For each={props.tasks}>
          {(task) => (
            <div class="flex min-w-0 items-baseline gap-2 text-13-regular">
              <span class="shrink-0 text-13-medium text-text-strong">
                {language.t(task.type === "shell" ? "ui.tool.shell" : "ui.tool.agent.default")}
              </span>
              <span class="truncate text-text-weak">{task.label}</span>
            </div>
          )}
        </For>
      </div>
    </SessionBackgroundPullout>
  )
}
