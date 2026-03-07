import { For, Match, Show, Switch } from "solid-js"
import { useI18n } from "../../context/i18n"
import { Icon } from "../icon"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import type { AtOption, SlashCommand } from "./types"

interface Props {
  kind: "at" | "slash" | null
  bottom: number
  atFlat: AtOption[]
  atActive: string | null
  atKey: (item: AtOption) => string
  onAtHover: (key: string) => void
  onAtPick: (item: AtOption) => void
  slashFlat: SlashCommand[]
  slashActive: string | null
  onSlashHover: (key: string) => void
  onSlashPick: (item: SlashCommand) => void
}

export function ComposerPopover(props: Props) {
  const i18n = useI18n()
  return (
    <Show when={props.kind}>
      <div
        class="absolute left-0 right-0 max-h-80 min-h-10 overflow-auto no-scrollbar flex flex-col p-2 rounded-[12px] bg-surface-raised-stronger-non-alpha shadow-[var(--shadow-lg-border-base)]"
        style={{
          bottom: `${props.bottom}px`,
          "z-index": 100,
        }}
        onMouseDown={(event) => event.preventDefault()}
      >
        <Switch>
          <Match when={props.kind === "at"}>
            <Show
              when={props.atFlat.length > 0}
              fallback={<div class="text-text-weak px-2 py-1">{i18n.t("ui.list.empty")}</div>}
            >
              <For each={props.atFlat.slice(0, 10)}>
                {(item) => {
                  const key = props.atKey(item)
                  const isDir = item.type === "file" && item.path.endsWith("/")
                  const dir = item.type === "file" ? (isDir ? item.path : getDirectory(item.path)) : ""
                  const file = item.type === "file" && !isDir ? getFilename(item.path) : ""
                  return (
                    <button
                      class="w-full flex items-center gap-x-2 rounded-md px-2 py-0.5"
                      classList={{ "bg-surface-raised-base-hover": props.atActive === key }}
                      onClick={() => props.onAtPick(item)}
                      onMouseEnter={() => props.onAtHover(key)}
                    >
                      <Icon
                        name={item.type === "agent" ? "brain" : "file-tree"}
                        size="small"
                        class={item.type === "agent" ? "text-icon-info-active shrink-0" : "text-icon-base shrink-0"}
                      />
                      {item.type === "agent" ? (
                        <span class="text-14-regular text-text-strong whitespace-nowrap">@{item.name}</span>
                      ) : (
                        <div class="flex items-center text-14-regular min-w-0">
                          <span class="text-text-weak whitespace-nowrap truncate min-w-0">{dir}</span>
                          <Show when={!isDir}>
                            <span class="text-text-strong whitespace-nowrap">{file}</span>
                          </Show>
                        </div>
                      )}
                    </button>
                  )
                }}
              </For>
            </Show>
          </Match>
          <Match when={props.kind === "slash"}>
            <Show
              when={props.slashFlat.length > 0}
              fallback={<div class="text-text-weak px-2 py-1">{i18n.t("ui.prompt.list.noCommands")}</div>}
            >
              <For each={props.slashFlat}>
                {(cmd) => (
                  <button
                    classList={{
                      "w-full flex items-center justify-between gap-4 rounded-md px-2 py-1": true,
                      "bg-surface-raised-base-hover": props.slashActive === cmd.id,
                    }}
                    onClick={() => props.onSlashPick(cmd)}
                    onMouseEnter={() => props.onSlashHover(cmd.id)}
                  >
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="text-14-regular text-text-strong whitespace-nowrap">/{cmd.trigger}</span>
                      <Show when={cmd.description}>
                        <span class="text-14-regular text-text-weak truncate">{cmd.description}</span>
                      </Show>
                    </div>
                    <Show when={cmd.type === "custom" && cmd.source !== "command"}>
                      <span class="text-11-regular text-text-subtle px-1.5 py-0.5 bg-surface-base rounded">
                        {cmd.source === "skill" ? "skill" : cmd.source === "mcp" ? "mcp" : "custom"}
                      </span>
                    </Show>
                    <Show when={cmd.keybind}>
                      <span class="text-12-regular text-text-subtle">{cmd.keybind}</span>
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </Match>
        </Switch>
      </div>
    </Show>
  )
}
