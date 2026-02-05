import { TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useDialog } from "@tui/ui/dialog"
import type { PromptInfo } from "@tui/component/prompt/history"
import { Locale } from "@/util/locale"

export interface DialogHistorySearchProps {
    onSelect: (item: PromptInfo) => void
    searchHistory: (query: string) => PromptInfo[]
}

export function DialogHistorySearch(props: DialogHistorySearchProps) {
    const dialog = useDialog()
    const { theme } = useTheme()
    const [store, setStore] = createStore({
        selected: 0,
        filter: "",
    })

    const filtered = createMemo(() => props.searchHistory(store.filter))

    const dimensions = useTerminalDimensions()
    const height = createMemo(() => Math.min(filtered().length, Math.floor(dimensions().height / 2) - 6))

    const selected = createMemo(() => filtered()[store.selected])

    function move(direction: number) {
        if (filtered().length === 0) return
        let next = store.selected + direction
        if (next < 0) next = filtered().length - 1
        if (next >= filtered().length) next = 0
        setStore("selected", next)
    }

    useKeyboard((evt) => {
        if (evt.name === "up" || (evt.ctrl && evt.name === "p") || (evt.ctrl && evt.name === "r")) move(-1)
        if (evt.name === "down" || (evt.ctrl && evt.name === "n")) move(1)
        if (evt.name === "pageup") move(-10)
        if (evt.name === "pagedown") move(10)

        if (evt.name === "return") {
            const item = selected()
            if (item) {
                evt.preventDefault()
                evt.stopPropagation()
                dialog.clear()
                props.onSelect(item)
            }
        }
    })

    return (
        <box gap={1} paddingBottom={1}>
            <box paddingLeft={4} paddingRight={4}>
                <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.text} attributes={TextAttributes.BOLD}>
                        Search History
                    </text>
                    <text fg={theme.textMuted}>esc</text>
                </box>
                <box paddingTop={1}>
                    <input
                        onInput={(e) => {
                            setStore("filter", e)
                            setStore("selected", 0)
                        }}
                        focusedBackgroundColor={theme.backgroundPanel}
                        cursorColor={theme.primary}
                        focusedTextColor={theme.textMuted}
                        ref={(r) => {
                            setTimeout(() => {
                                if (!r || r.isDestroyed) return
                                r.focus()
                            }, 1)
                        }}
                        placeholder="(reverse-i-search)"
                    />
                </box>
            </box>
            <Show
                when={filtered().length > 0}
                fallback={
                    <box paddingLeft={4} paddingRight={4} paddingTop={1}>
                        <text fg={theme.textMuted}>No history found</text>
                    </box>
                }
            >
                <scrollbox
                    paddingLeft={1}
                    paddingRight={1}
                    scrollbarOptions={{ visible: false }}
                    maxHeight={height()}
                >
                    <For each={filtered()}>
                        {(item, index) => {
                            const active = createMemo(() => index() === store.selected)
                            const fg = selectedForeground(theme)
                            return (
                                <box
                                    flexDirection="row"
                                    backgroundColor={active() ? theme.primary : undefined}
                                    paddingLeft={3}
                                    paddingRight={3}
                                    onMouseUp={() => {
                                        dialog.clear()
                                        props.onSelect(item)
                                    }}
                                    onMouseOver={() => setStore("selected", index())}
                                >
                                    <text
                                        flexGrow={1}
                                        fg={active() ? fg : theme.text}
                                        attributes={active() ? TextAttributes.BOLD : undefined}
                                        overflow="hidden"
                                        wrapMode="none"
                                    >
                                        {Locale.truncate(item.input.replace(/\n/g, " "), 70)}
                                    </text>
                                </box>
                            )
                        }}
                    </For>
                </scrollbox>
            </Show>
            <box paddingRight={2} paddingLeft={4} flexDirection="row" gap={2} flexShrink={0} paddingTop={1}>
                <text>
                    <span style={{ fg: theme.text }}>
                        <b>Select</b>{" "}
                    </span>
                    <span style={{ fg: theme.textMuted }}>Enter</span>
                </text>
                <text>
                    <span style={{ fg: theme.text }}>
                        <b>Next</b>{" "}
                    </span>
                    <span style={{ fg: theme.textMuted }}>Ctrl+R</span>
                </text>
            </box>
        </box>
    )
}
