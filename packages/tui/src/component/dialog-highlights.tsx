import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, For } from "solid-js"
import { useConfig } from "../config"
import { Keymap } from "../context/keymap"
import type { TuiHighlight } from "../context/runtime"
import { useTheme } from "../context/theme"
import { DIALOG_INSET, DialogBleed, DialogFooter, DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { getScrollAcceleration } from "../util/scroll"
import { useLanguage } from "../context/language"

export function DialogHighlights(props: { version: string; items: ReadonlyArray<TuiHighlight> }) {
  const language = useLanguage()
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const overlay = useTheme()
  const config = useConfig().data
  const dimensions = useTerminalDimensions()
  const maxHeight = createMemo(() => Math.max(6, Math.floor(dimensions().height * 0.6) - 2))
  let scroll: ScrollBoxRenderable | undefined

  dialog.setCentered(true)

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: language.t("tui.interface.closeHighlights"),
        group: "Dialog",
        run: () => dialog.clear(),
      },
      ...["up", "k"].map((bind) => ({
        bind,
        title: language.t("tui.interface.scrollUp"),
        group: "Dialog",
        run: () => scroll?.scrollBy(-1),
      })),
      ...["down", "j"].map((bind) => ({
        bind,
        title: language.t("tui.interface.scrollDown"),
        group: "Dialog",
        run: () => scroll?.scrollBy(1),
      })),
      {
        bind: "pageup",
        title: language.t("tui.interface.previousPage"),
        group: "Dialog",
        run: () => scroll?.scrollBy(-maxHeight()),
      },
      {
        bind: "pagedown",
        title: language.t("tui.interface.nextPage"),
        group: "Dialog",
        run: () => scroll?.scrollBy(maxHeight()),
      },
      { bind: "home", title: language.t("tui.interface.scrollToTop"), group: "Dialog", run: () => scroll?.scrollTo(0) },
      {
        bind: "end",
        title: language.t("tui.interface.scrollToBottom"),
        group: "Dialog",
        run: () => scroll?.scrollTo(Infinity),
      },
    ],
  }))

  return (
    <DialogLayout
      header={<DialogHeader title={`What's new in ${props.version}`} />}
      footer={{
        actions: { primary: [{ title: language.t("tui.dialogs.ok"), key: "enter", onTrigger: () => dialog.clear() }] },
      }}
      legacyFooter={
        <box flexDirection="row" justifyContent="space-between" alignItems="center">
          <DialogFooter actions={{ secondary: [{ title: language.t("tui.session.scroll"), key: "↑/↓" }] }} />
          <box
            paddingLeft={3}
            paddingRight={3}
            backgroundColor={theme.background.action.primary.focused}
            onMouseUp={() => dialog.clear()}
          >
            <text fg={theme.text.action.primary.focused}>{language.t("tui.dialogs.ok")}</text>
          </box>
        </box>
      }
    >
      {/* The band owns the vertical padding so it stays visible while the highlights scroll. */}
      <DialogBleed>
        <box backgroundColor={overlay.background.raised.high} paddingTop={1} paddingBottom={1}>
          <scrollbox
            ref={(element: ScrollBoxRenderable) => (scroll = element)}
            maxHeight={maxHeight()}
            contentOptions={{ minHeight: 0 }}
            backgroundColor={overlay.background.raised.high}
            scrollbarOptions={{ visible: false }}
            scrollAcceleration={getScrollAcceleration(config)}
          >
            <box gap={1} paddingLeft={DIALOG_INSET} paddingRight={DIALOG_INSET}>
              <For each={props.items}>
                {(item) => (
                  <box>
                    <text attributes={TextAttributes.BOLD} fg={overlay.text.base}>
                      {item.title}
                    </text>
                    {/* Backticks mark code spans, which stand out from the muted description. */}
                    <text fg={overlay.text.muted} wrapMode="word">
                      <For each={item.body.split("`")}>
                        {(part, index) =>
                          index() % 2 === 1 ? <span style={{ fg: overlay.text.base }}>{part}</span> : part
                        }
                      </For>
                    </text>
                  </box>
                )}
              </For>
            </box>
          </scrollbox>
        </box>
      </DialogBleed>
    </DialogLayout>
  )
}
