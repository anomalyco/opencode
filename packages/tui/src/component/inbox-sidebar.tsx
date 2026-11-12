import { MouseButton, TextAttributes } from "@opentui/core"
import path from "node:path"
import { createMemo, createSignal, Index, Show } from "solid-js"
import { useConfig } from "../config"
import { Keymap } from "../context/keymap"
import { useRoute } from "../context/route"
import { useSessionTabs } from "../context/session-tabs"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { getScrollAcceleration } from "../util/scroll"
import { useInbox } from "./inbox-data"

export function InboxSidebar() {
  const inbox = useInbox()
  const theme = useTheme()
  const config = useConfig().data
  const tabs = useSessionTabs()
  const route = useRoute()
  const dialog = useDialog()
  const sections = createMemo(() =>
    inbox.loading() ? [] : inbox.sections().filter((section) => section.rows.length > 0),
  )
  const empty = () => (inbox.loading() ? "Loading sessions…" : "No inbox sessions")

  function open(id: string) {
    if (tabs.enabled()) return tabs.select(id)
    route.navigate({ type: "session", sessionID: id })
  }

  Keymap.createLayer(() => ({
    mode: "global",
    commands: [
      {
        id: "inbox.session.open",
        title: "Open inbox session",
        group: "Session",
        palette: true,
        run: () =>
          dialog.replace(() => (
            <DialogSelect
              title="Inbox"
              placeholder="Search inbox sessions…"
              emptyView={<text fg={theme.text.muted}>{empty()}</text>}
              options={sections().flatMap((section) =>
                section.rows.map((row) => ({
                  title: row.title,
                  value: row.id,
                  category: section.title,
                  footer: path.basename(row.directory) || row.directory,
                  detail: row.directory,
                  searchText: `${row.directory} ${row.detail}`,
                })),
              )}
              current={tabs.current()}
              onSelect={(option) => {
                open(option.value)
                dialog.clear()
              }}
            />
          )),
      },
    ],
  }))

  return (
    <box width="100%" height="100%" minHeight={0} backgroundColor={theme.background.raised.base}>
      <text marginLeft={2} marginTop={1} fg={theme.text.base} attributes={TextAttributes.BOLD}>
        Inbox
      </text>
      <scrollbox
        flexGrow={1}
        minHeight={0}
        scrollAcceleration={getScrollAcceleration(config)}
        horizontalScrollbarOptions={{ visible: false }}
        verticalScrollbarOptions={{
          width: 1,
          trackOptions: { backgroundColor: theme.background.raised.base, foregroundColor: theme.scrollbar.base },
        }}
      >
        <Show
          when={sections().length}
          fallback={
            <text marginTop={1} marginLeft={2} fg={theme.text.muted}>
              {empty()}
            </text>
          }
        >
          <Index each={sections()}>
            {(section) => (
              <box flexShrink={0} marginTop={1}>
                <text marginLeft={2} fg={theme.text.muted} wrapMode="none" truncate>
                  {section().title} · {section().rows.length}
                </text>
                <Index each={section().rows}>
                  {(row) => {
                    const [hover, setHover] = createSignal(false)
                    const current = () => tabs.current() === row().id
                    return (
                      <box
                        height={2}
                        flexShrink={0}
                        paddingLeft={1}
                        paddingRight={1}
                        backgroundColor={hover() || current() ? theme.background.raised.high : undefined}
                        onMouseOver={() => setHover(true)}
                        onMouseOut={() => setHover(false)}
                        onMouseUp={(event) => {
                          if (event.button !== MouseButton.LEFT) return
                          event.stopPropagation()
                          open(row().id)
                        }}
                      >
                        <text fg={theme.text.base} selectable={false} wrapMode="none" truncate>
                          <span style={{ fg: theme.text.formfield.selected }}>{current() ? "▸ " : "  "}</span>
                          {row().title}
                        </text>
                        <text marginLeft={2} fg={theme.text.muted} selectable={false} wrapMode="none" truncate>
                          {[path.basename(row().directory) || row().directory, row().detail]
                            .filter(Boolean)
                            .join(" · ")}
                        </text>
                      </box>
                    )
                  }}
                </Index>
              </box>
            )}
          </Index>
        </Show>
      </scrollbox>
    </box>
  )
}
