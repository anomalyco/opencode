import { createEffect, createSignal } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { formatKeybindParts } from "@/shell/commands/command"
import { reviewGlyphFill, SessionHeaderActions } from "./session-header-actions"

type Args = { opened: boolean; visible: boolean; label: string; keybind: string; panelGlyph: boolean }

export default {
  title: "App/Session/Header actions",
  id: "app-session-header-actions",
  component: SessionHeaderActions,
  args: { opened: false, visible: true, label: "Toggle review", keybind: "", panelGlyph: false },
  render: (args: Args) => {
    const language = useLanguage()

    const [opened, setOpened] = createSignal(args.opened)
    createEffect(() => setOpened(args.opened))

    const glyph = (fill: SVGPathElement) =>
      createEffect(() => fill.setAttribute("transform", reviewGlyphFill(Number(opened()))))

    return (
      <div class="flex h-12 items-center justify-end bg-v2-background-bg-base pe-3">
        <SessionHeaderActions
          state={{
            reviewLabel: args.label,
            reviewKeybind: formatKeybindParts(args.keybind, language.t),
            reviewVisible: args.visible,
            reviewOpened: opened(),
            reviewGlyph: args.panelGlyph ? glyph : undefined,
            onReviewToggle: () => setOpened(!opened()),
          }}
        />
      </div>
    )
  },
}

export const ReviewToggle = {}

export const Opened = { args: { opened: true } }

export const PanelGlyph = { args: { panelGlyph: true, keybind: "mod+shift+r" } }

export const Hidden = { args: { visible: false } }
