import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useConfig } from "../config"
import { Keymap } from "../context/keymap"
import type { TuiReleaseHighlights } from "../context/runtime"
import { useTheme } from "../context/theme"
import { DIALOG_INSET, DialogBleed, DialogFooter, DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { getScrollAcceleration } from "../util/scroll"

/** Shows one embedded release's highlights at a time, starting at the newest. */
export function DialogHighlights(props: { releases: ReadonlyArray<TuiReleaseHighlights> }) {
  const dialog = useDialog()
  const overlay = useTheme()
  const config = useConfig().data
  const dimensions = useTerminalDimensions()
  // Leaves room for the version row above the scrolling highlights.
  const maxHeight = createMemo(() => Math.max(6, Math.floor(dimensions().height * 0.6) - 4))
  let scroll: ScrollBoxRenderable | undefined
  const [index, setIndex] = createSignal(0)
  const release = () => props.releases[index()]
  const hasOlder = () => index() < props.releases.length - 1
  const hasNewer = () => index() > 0
  const select = (next: number) => {
    if (next < 0 || next >= props.releases.length) return
    setIndex(next)
    scroll?.scrollTo(0)
  }
  const older = () => select(index() + 1)
  const newer = () => select(index() - 1)

  dialog.setCentered(true)

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", title: "Close highlights", group: "Dialog", run: () => dialog.clear() },
      ...["up", "k"].map((bind) => ({ bind, title: "Scroll up", group: "Dialog", run: () => scroll?.scrollBy(-1) })),
      ...["down", "j"].map((bind) => ({ bind, title: "Scroll down", group: "Dialog", run: () => scroll?.scrollBy(1) })),
      { bind: "pageup", title: "Previous page", group: "Dialog", run: () => scroll?.scrollBy(-maxHeight()) },
      { bind: "pagedown", title: "Next page", group: "Dialog", run: () => scroll?.scrollBy(maxHeight()) },
      { bind: "home", title: "Scroll to top", group: "Dialog", run: () => scroll?.scrollTo(0) },
      { bind: "end", title: "Scroll to bottom", group: "Dialog", run: () => scroll?.scrollTo(Infinity) },
      ...["left", "h"].map((bind) => ({ bind, title: "Newer release", group: "Dialog", run: newer })),
      ...["right", "l"].map((bind) => ({ bind, title: "Older release", group: "Dialog", run: older })),
    ],
  }))

  return (
    <DialogLayout
      header={<DialogHeader title="What's new" />}
      footer={{ actions: { primary: [{ title: "ok", key: "enter", onTrigger: () => dialog.clear() }] } }}
      legacyFooter={
        <box flexDirection="row" justifyContent="space-between" alignItems="center">
          <DialogFooter actions={{ secondary: [{ title: "scroll", key: "↑/↓" }] }} />
          <Button title="ok" onTrigger={() => dialog.clear()} />
        </box>
      }
    >
      {/* The band owns the vertical padding so it stays visible while the highlights scroll. */}
      <DialogBleed>
        <box backgroundColor={overlay.background.raised.high} paddingTop={1} paddingBottom={1} gap={1}>
          {/* The version stays centered and put while the highlights below it scroll; each arrow keeps its slot. */}
          <box flexDirection="row" justifyContent="center" gap={2}>
            <box width={3}>
              <Show when={hasNewer()}>
                <Button title="<" padding={1} onTrigger={newer} />
              </Show>
            </box>
            <text fg={overlay.text.base}>{release().version}</text>
            <box width={3}>
              <Show when={hasOlder()}>
                <Button title=">" padding={1} onTrigger={older} />
              </Show>
            </box>
          </box>
          <scrollbox
            ref={(element: ScrollBoxRenderable) => (scroll = element)}
            maxHeight={maxHeight()}
            contentOptions={{ minHeight: 0 }}
            backgroundColor={overlay.background.raised.high}
            scrollbarOptions={{ visible: false }}
            scrollAcceleration={getScrollAcceleration(config)}
          >
            <box gap={1} paddingLeft={DIALOG_INSET} paddingRight={DIALOG_INSET}>
              <For each={release().items}>
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

/** A filled dialog button, shared by ok and the release arrows so they look alike. */
function Button(props: { title: string; padding?: number; onTrigger: () => void }) {
  const theme = useTheme().surface("dialog")
  return (
    <box
      paddingLeft={props.padding ?? 3}
      paddingRight={props.padding ?? 3}
      backgroundColor={theme.background.action.primary.focused}
      onMouseUp={props.onTrigger}
    >
      <text fg={theme.text.action.primary.focused}>{props.title}</text>
    </box>
  )
}
