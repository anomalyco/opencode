import { Installation } from "@/installation"
import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { Theme } from "@tui/context/theme"

const LOGO_LEFT = [`                   `, `█▀▀█ █▀▀█ █▀▀█ █▀▀▄`, `█░░█ █░░█ █▀▀▀ █░░█`, `▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀`]

const LOGO_RIGHT = [`             ▄     `, `█▀▀▀ █▀▀█ █▀▀█ █▀▀█`, `█░░░ █░░█ █░░█ █▀▀▀`, `▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`]

export function Logo() {
  return (
    <box>
      <For each={LOGO_LEFT}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <text fg={Theme().textMuted}>{line}</text>
            <text fg={Theme().text} attributes={TextAttributes.BOLD}>
              {LOGO_RIGHT[index()]}
            </text>
          </box>
        )}
      </For>
      <box flexDirection="row" justifyContent="flex-end">
        <text fg={Theme().textMuted}>{Installation.VERSION}</text>
      </box>
    </box>
  )
}
