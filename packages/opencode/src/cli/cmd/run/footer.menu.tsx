/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import { transparent, type RunFooterTheme } from "./theme"

export const FOOTER_MENU_ROWS = 8

export type RunFooterMenuItem = {
  display: string
  description?: string
  category?: string
  footer?: string
}

type RunFooterMenuRow =
  | { type: "header"; label: string }
  | { type: "item"; item: RunFooterMenuItem; index: number }
  | { type: "spacer" }

function maxOffset(count: number, limit: number) {
  return Math.max(0, count - limit)
}

function previewMargin(limit: number) {
  return Math.max(0, Math.min(2, Math.floor((limit - 1) / 2)))
}

function revealOffset(value: number, input: { count: number; limit: number; selected: number }) {
  const max = maxOffset(input.count, input.limit)
  if (input.selected < value) {
    return Math.min(max, input.selected)
  }

  if (input.selected >= value + input.limit) {
    return Math.min(max, input.selected - input.limit + 1)
  }

  return Math.min(max, value)
}

function moveOffset(value: number, input: { count: number; limit: number; selected: number; dir: -1 | 1 }) {
  const max = maxOffset(input.count, input.limit)
  const margin = previewMargin(input.limit)
  if (input.dir < 0 && input.selected < value + margin) {
    return Math.max(0, Math.min(max, input.selected - margin))
  }

  if (input.dir > 0 && input.selected > value + input.limit - margin - 1) {
    return Math.min(max, input.selected - input.limit + margin + 1)
  }

  return Math.min(max, value)
}

export function createFooterMenuState(input: { count: Accessor<number>; limit?: number }) {
  const [selected, setSelected] = createSignal(0)
  const [offset, setOffset] = createSignal(0)
  const limit = () => input.limit ?? FOOTER_MENU_ROWS
  const rows = createMemo(() => Math.max(1, Math.min(limit(), input.count())))

  const reveal = (index: number) => {
    const count = input.count()
    if (count === 0) {
      setSelected(0)
      setOffset(0)
      return
    }

    const next = Math.max(0, Math.min(count - 1, index))
    setSelected(next)
    setOffset((value) => revealOffset(value, { count, limit: limit(), selected: next }))
  }

  const reset = () => {
    setSelected(0)
    setOffset(0)
  }

  createEffect(() => {
    const count = input.count()
    if (count === 0) {
      reset()
      return
    }

    if (selected() >= count) {
      setSelected(count - 1)
    }

    setOffset((value) => revealOffset(value, { count, limit: limit(), selected: selected() }))
  })

  const move = (dir: -1 | 1) => {
    const count = input.count()
    if (count === 0) {
      reset()
      return
    }

    const next = Math.max(0, Math.min(count - 1, selected() + dir))
    setSelected(next)
    setOffset((value) => moveOffset(value, { count, limit: limit(), selected: next, dir }))
  }

  return {
    selected,
    offset,
    rows,
    reveal,
    reset,
    move,
  }
}

export function RunFooterMenu(props: {
  id?: string
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
}) {
  const limit = () => props.limit ?? FOOTER_MENU_ROWS
  const border = () => props.border ?? true
  const [groupOffset, setGroupOffset] = createSignal(0)
  let previous = -1
  const groupedRows = createMemo<RunFooterMenuRow[]>(() => {
    const all: RunFooterMenuRow[] = []
    let category = ""
    props.items().forEach((item, index) => {
      if (item.category && item.category !== category) {
        if (all.length > 0) {
          all.push({ type: "spacer" })
        }

        category = item.category
        all.push({ type: "header", label: item.category })
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
        ? moveOffset(value, { count: all.length, limit: limit(), selected, dir })
        : revealOffset(value, { count: all.length, limit: limit(), selected }),
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
        .map((item) => Bun.stringWidth(item.display)),
    )
    return width === 0 ? 0 : width + 2
  })
  const descriptionPad = (item: RunFooterMenuItem) => {
    if (!item.description) {
      return ""
    }

    return " ".repeat(Math.max(1, descriptionColumn() - Bun.stringWidth(item.display)))
  }
  return (
    <box
      id={props.id ?? "run-direct-footer-menu"}
      width="100%"
      height={props.rows()}
      backgroundColor={transparent}
      flexDirection="column"
    >
      {rows().length === 0 ? (
        <box paddingRight={0} flexDirection="row" backgroundColor={transparent}>
          {border() ? (
            <text fg={props.theme().border} wrapMode="none">
              ┃
            </text>
          ) : undefined}
          <box
            flexGrow={1}
            flexShrink={1}
            paddingLeft={props.paddingLeft ?? 1}
            paddingRight={props.paddingRight ?? 0}
            backgroundColor={props.theme().surface}
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
              <box paddingLeft={props.paddingLeft ?? 1} paddingRight={props.paddingRight ?? 1}>
                <text fg={props.theme().highlight} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                  {row.label}
                </text>
              </box>
            )
          }

          const active = () => row.index === props.selected()
          const inset = () => (active() ? 1 : 0)
          return (
            <box paddingRight={0} flexDirection="row" backgroundColor={transparent}>
              {border() ? (
                <text fg={active() ? props.theme().highlight : props.theme().border} wrapMode="none">
                  ┃
                </text>
              ) : undefined}
              <box
                flexGrow={1}
                flexShrink={1}
                paddingLeft={inset()}
                paddingRight={inset()}
                backgroundColor={props.theme().surface}
              >
                <box
                  flexGrow={1}
                  flexShrink={1}
                  paddingLeft={Math.max(0, (props.paddingLeft ?? 1) - inset())}
                  paddingRight={Math.max(0, (props.paddingRight ?? 0) - inset())}
                  backgroundColor={active() ? props.theme().highlight : props.theme().surface}
                >
                  <box width="100%" flexDirection="row" justifyContent="space-between" gap={1}>
                    <text
                      fg={active() ? props.theme().surface : props.theme().text}
                      wrapMode="none"
                      truncate
                      flexGrow={1}
                    >
                      {row.item.display}
                      {row.item.description ? (
                        <span style={{ fg: active() ? props.theme().surface : props.theme().muted }}>
                          {descriptionPad(row.item)}
                          {row.item.description}
                        </span>
                      ) : undefined}
                    </text>
                    {row.item.footer ? (
                      <text
                        fg={active() ? props.theme().surface : props.theme().muted}
                        wrapMode="none"
                        truncate
                        flexShrink={0}
                      >
                        {row.item.footer}
                      </text>
                    ) : undefined}
                  </box>
                </box>
              </box>
            </box>
          )
        })
      )}
    </box>
  )
}
