import { MouseButton, TextAttributes, type Renderable } from "@opentui/core"
import { createMemo, createSignal, Index, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useConfig } from "../config"
import { Keymap } from "../context/keymap"
import { useRoute } from "../context/route"
import { useSessionTabs } from "../context/session-tabs"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { getScrollAcceleration } from "../util/scroll"
import { useInbox, type InboxRow } from "./inbox-data"

export function InboxSidebar() {
  const inbox = useInbox()
  const theme = useTheme()
  const config = useConfig().data
  const tabs = useSessionTabs()
  const route = useRoute()
  const dialog = useDialog()
  const [collapsed, setCollapsed] = createStore<Record<string, boolean>>({})
  const [hovered, setHovered] = createSignal<{ section: () => string; target: Renderable }>()
  const sections = createMemo(() =>
    inbox.loading() ? [] : inbox.sections().filter((section) => section.rows.length > 0),
  )
  const empty = () => (inbox.loading() ? "Loading sessions…" : "No inbox sessions")

  function color(detail: InboxRow["detail"], surface = theme) {
    if (detail === "Review permission") return surface.text.feedback.warning.base
    if (detail === "Answer question" || detail === "Working") return surface.text.feedback.info.base
    if (detail === "Failed") return surface.text.feedback.error.base
    if (detail === "Done") return surface.text.feedback.success.base
    return surface.text.muted
  }

  Keymap.createLayer(() => ({
    // Folding a row under the pointer destroys the mouse target without a mouse-out event.
    enabled: () => hovered()?.target.isDestroyed === false,
    priority: 10,
    commands: [
      { bind: "left", title: "Collapse section", run: () => setCollapsed(hovered()!.section(), true) },
      { bind: "right", title: "Expand section", run: () => setCollapsed(hovered()!.section(), false) },
    ],
  }))

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
              preserveSelection
              sectionNavigation
              emptyView={<text fg={theme.text.muted}>{empty()}</text>}
              options={sections().flatMap((section) =>
                section.rows.map((row) => ({
                  title: row.title,
                  value: row.id,
                  category: section.title,
                  footer: row.detail,
                  footerColor: color(row.detail, theme.surface("dialog")),
                  truncateTitle: true,
                  detail: `Location: ${row.directory}`,
                  searchText: `${row.directory} ${row.detail}`,
                })),
              )}
              current={tabs.current()}
              footer={<text fg={theme.text.muted}>↑↓ move · enter open · esc close</text>}
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
              <box
                flexShrink={0}
                marginTop={1}
                onMouseOver={(event) =>
                  event.target && setHovered({ section: () => section().title, target: event.target })
                }
                onMouseOut={() => setHovered(undefined)}
              >
                <text
                  marginLeft={2}
                  fg={theme.text.base}
                  selectable={false}
                  wrapMode="none"
                  truncate
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseUp={(event) => {
                    if (event.button !== MouseButton.LEFT) return
                    event.stopPropagation()
                    setCollapsed(section().title, (value) => !value)
                  }}
                >
                  <span style={{ fg: theme.text.muted }}>{collapsed[section().title] ? "▸ " : "▾ "}</span>
                  <b>{section().title}</b>
                  <span style={{ fg: theme.text.muted }}> {section().rows.length}</span>
                </text>
                <Show when={!collapsed[section().title]}>
                  <Index each={section().rows}>
                    {(row) => {
                      const [hover, setHover] = createSignal(false)
                      const current = () => tabs.current() === row().id
                      return (
                        <box
                          height={1}
                          flexDirection="row"
                          flexShrink={0}
                          paddingLeft={2}
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
                          <text
                            flexGrow={1}
                            flexBasis={0}
                            minWidth={0}
                            fg={theme.text.base}
                            selectable={false}
                            wrapMode="none"
                            truncate
                          >
                            <span style={{ fg: theme.text.formfield.selected }}>{current() ? "▸ " : "  "}</span>
                            {row().title}
                          </text>
                          <Show when={row().detail}>
                            <text
                              flexShrink={0}
                              marginLeft={1}
                              fg={color(row().detail)}
                              selectable={false}
                              wrapMode="none"
                            >
                              {row().detail}
                            </text>
                          </Show>
                        </box>
                      )
                    }}
                  </Index>
                </Show>
              </box>
            )}
          </Index>
        </Show>
      </scrollbox>
    </box>
  )
}
