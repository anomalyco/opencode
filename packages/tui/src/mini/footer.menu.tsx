/** @jsxImportSource @opentui/solid */
import { TextAttributes, type ColorInput } from "@opentui/core"
import { useTerminalDimensions, type JSX } from "@opentui/solid"
import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import { transparent, type RunFooterTheme } from "./theme"
import { Locale } from "../util/locale"
import { stringWidth } from "../util/string-width"
import { moveSelection, moveSelectionOffset, reconcileSelection, revealSelectionOffset } from "../ui/select-controller"

export const FOOTER_MENU_ROWS = 8
export const FOOTER_COMPACT_WIDTH = 40

export function footerMenuText(text: string, width: number, mono = false) {
  if (!mono) return Locale.truncateWidth(text, width)
  if (stringWidth(text) <= width) return text
  const suffix = ".".repeat(Math.min(3, Math.max(0, width)))
  return Locale.takeWidth(text, width - suffix.length) + suffix
}

export type RunFooterMenuItem = {
  display: string
  icon?: (color: ColorInput) => JSX.Element
  current?: boolean
  description?: string
  category?: string
  footer?: string
  footerTone?: "selection" | "running" | "error" | "success"
}

type RunFooterMenuRow =
  | { type: "header"; label: string }
  | { type: "item"; item: RunFooterMenuItem; index: number }
  | { type: "spacer" }

export function createFooterMenuState(input: { count: Accessor<number>; limit?: number | Accessor<number> }) {
  const [selected, setSelected] = createSignal(0)
  const [offset, setOffset] = createSignal(0)
  const limit = () => Math.max(1, typeof input.limit === "function" ? input.limit() : (input.limit ?? FOOTER_MENU_ROWS))
  const rows = createMemo(() => Math.max(1, Math.min(limit(), input.count())))

  const reveal = (index: number) => {
    const count = input.count()
    const next = reconcileSelection(index, count)
    setSelected(next)
    setOffset((value) => revealSelectionOffset(value, { count, limit: limit(), selected: next }))
  }

  const reset = () => {
    setSelected(0)
    setOffset(0)
  }

  createEffect(() => {
    const count = input.count()
    const next = reconcileSelection(selected(), count)
    setSelected(next)
    setOffset((value) => revealSelectionOffset(value, { count, limit: limit(), selected: next }))
  })

  const move = (dir: -1 | 1) => {
    const count = input.count()
    const next = moveSelection(selected(), { count, delta: dir, policy: "clamp" })
    setSelected(next)
    setOffset((value) => moveSelectionOffset(value, { count, limit: limit(), selected: next, direction: dir }))
  }

  return {
    selected,
    offset,
    rows,
    limit,
    reveal,
    reset,
    move,
  }
}

export function RunFooterMenu(props: {
  theme: Accessor<RunFooterTheme>
  items: Accessor<RunFooterMenuItem[]>
  selected: Accessor<number>
  offset: Accessor<number>
  rows: Accessor<number>
  limit?: number
  empty?: string
  border?: boolean
  paddingLeft?: number
  paddingRight?: number
  grouped?: boolean
  compact?: boolean
  background?: boolean
  headerColor?: ColorInput
  mono?: boolean
}) {
  const term = useTerminalDimensions()
  const limit = () => Math.max(1, Math.min(props.rows(), props.limit ?? FOOTER_MENU_ROWS))
  const border = () => props.border ?? true
  const paddingLeft = () => Math.min(props.paddingLeft ?? 1, term().width < FOOTER_COMPACT_WIDTH ? 1 : Infinity)
  const paddingRight = () => Math.min(props.paddingRight ?? 0, term().width < FOOTER_COMPACT_WIDTH ? 1 : Infinity)
  const width = () => Math.max(0, term().width - (border() ? 1 : 0) - paddingLeft() - paddingRight())
  const [groupOffset, setGroupOffset] = createSignal(0)
  let previous = -1
  const groupedRows = createMemo<RunFooterMenuRow[]>(() => {
    const all: RunFooterMenuRow[] = []
    let category = ""
    props.items().forEach((item, index) => {
      if (item.category && item.category !== category) {
        if (all.length > 0 && !props.compact) {
          all.push({ type: "spacer" })
        }

        category = item.category
        if (!props.compact) all.push({ type: "header", label: item.category })
      }

      all.push({ type: "item", item, index })
    })
    return all
  })

  createEffect(() => {
    if (!props.grouped) {
      return
    }

    const all = groupedRows()
    const selected = all.findIndex((item) => item.type === "item" && item.index === props.selected())
    if (all.length === 0 || selected === -1) {
      setGroupOffset(0)
      previous = props.selected()
      return
    }

    const dir = props.selected() === previous + 1 ? 1 : props.selected() === previous - 1 ? -1 : undefined
    setGroupOffset((value) =>
      dir
        ? moveSelectionOffset(value, { count: all.length, limit: limit(), selected, direction: dir })
        : revealSelectionOffset(value, { count: all.length, limit: limit(), selected }),
    )
    previous = props.selected()
  })

  const rows = createMemo<RunFooterMenuRow[]>(() => {
    if (!props.grouped) {
      return props
        .items()
        .slice(props.offset(), props.offset() + limit())
        .map((item, index) => ({
          type: "item",
          item,
          index: index + props.offset(),
        }))
    }

    const all = groupedRows()
    const start = Math.max(0, Math.min(groupOffset(), all.length - limit()))
    return all.slice(start, start + limit())
  })
  const descriptionColumn = createMemo(() => {
    const width = Math.max(
      0,
      ...props
        .items()
        .filter((item) => item.description)
        .map((item) => stringWidth(item.display)),
    )
    return width === 0 ? 0 : width + 2
  })
  return (
    <box
      width="100%"
      height={props.rows()}
      flexShrink={0}
      backgroundColor={props.background ? props.theme().shade : transparent}
      flexDirection="column"
    >
      {rows().length === 0 ? (
        <box
          paddingRight={0}
          flexDirection="row"
          backgroundColor={props.background ? props.theme().shade : transparent}
        >
          {border() ? (
            <text fg={props.theme().border} wrapMode="none">
              {props.mono ? "|" : "┃"}
            </text>
          ) : undefined}
          <box
            flexGrow={1}
            flexShrink={1}
            paddingLeft={paddingLeft()}
            paddingRight={paddingRight()}
            backgroundColor={props.background ? props.theme().shade : transparent}
          >
            <text fg={props.theme().muted} wrapMode="none" truncate>
              {props.empty ?? "No matching items"}
            </text>
          </box>
        </box>
      ) : (
        rows().map((row) => {
          if (row.type === "spacer") {
            return <box height={1} flexShrink={0} />
          }

          if (row.type === "header") {
            return (
              <box height={1} flexShrink={0} paddingLeft={paddingLeft()} paddingRight={paddingRight()}>
                <text
                  fg={props.headerColor ?? props.theme().muted}
                  attributes={TextAttributes.BOLD}
                  wrapMode="none"
                  truncate
                >
                  {row.label}
                </text>
              </box>
            )
          }

          const active = () => row.index === props.selected()
          const available = () => Math.max(0, width() - (row.item.icon ? 2 : 0))
          const attributes = () =>
            active() ? TextAttributes.BOLD | (props.mono ? TextAttributes.INVERSE : 0) : undefined
          const background = () =>
            active() ? props.theme().actionFocusedBg : props.background ? props.theme().shade : transparent
          const footer = () => {
            if (!row.item.footer) return
            const title = stringWidth(row.item.display)
            const primary = row.item.footerTone && !(row.item.current && row.item.footerTone === "selection")
            return (primary ? Math.min(row.item.icon ? 4 : 8, title) : title) + 1 + stringWidth(row.item.footer) <=
              available()
              ? row.item.footer
              : undefined
          }
          const description = () => {
            if (!row.item.description) return
            const remaining = available() - descriptionColumn() - (footer() ? stringWidth(footer()!) + 1 : 0)
            if (remaining < Math.min(12, stringWidth(row.item.description))) return
            return footerMenuText(row.item.description, remaining, props.mono)
          }
          return (
            <box height={1} flexShrink={0} paddingRight={0} flexDirection="row" backgroundColor={background()}>
              {border() ? (
                <text fg={props.theme().actionFocusedText} bg={background()} wrapMode="none">
                  {active() ? (props.mono ? ">" : "▌") : " "}
                </text>
              ) : undefined}
              <box
                flexGrow={1}
                flexShrink={1}
                paddingLeft={paddingLeft()}
                paddingRight={paddingRight()}
                backgroundColor={background()}
              >
                <box width="100%" flexDirection="row" justifyContent="space-between" gap={1}>
                  <box flexDirection="row" gap={0} flexGrow={1} flexShrink={1}>
                    {row.item.icon ? (
                      <box width={2} flexShrink={0}>
                        {row.item.icon(active() ? props.theme().actionFocusedText : props.theme().formfieldText)}
                      </box>
                    ) : undefined}
                    <text
                      fg={active() ? props.theme().actionFocusedText : props.theme().formfieldText}
                      attributes={attributes()}
                      wrapMode="none"
                      flexShrink={0}
                    >
                      {footerMenuText(
                        row.item.display,
                        available() - (footer() ? stringWidth(footer()!) + 1 : 0),
                        props.mono,
                      )}
                    </text>
                    {description() ? (
                      <>
                        <text
                          fg={active() ? props.theme().actionFocusedText : props.theme().muted}
                          wrapMode="none"
                          flexShrink={0}
                        >
                          {" ".repeat(Math.max(1, descriptionColumn() - stringWidth(row.item.display)))}
                        </text>
                        <text
                          fg={active() ? props.theme().actionFocusedText : props.theme().muted}
                          wrapMode="none"
                          flexGrow={1}
                          flexShrink={1}
                        >
                          {description()}
                        </text>
                      </>
                    ) : undefined}
                  </box>
                  {footer() ? (
                    <text
                      fg={active() ? props.theme().actionFocusedText : props.theme()[row.item.footerTone ?? "muted"]}
                      attributes={attributes()}
                      wrapMode="none"
                      flexShrink={0}
                    >
                      {footer()}
                    </text>
                  ) : undefined}
                </box>
              </box>
            </box>
          )
        })
      )}
    </box>
  )
}
