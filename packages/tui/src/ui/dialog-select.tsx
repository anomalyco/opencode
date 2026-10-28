import { CliRenderEvents, InputRenderable, RGBA, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { Keymap, type KeymapCommand } from "../context/keymap"
import { useTheme } from "../context/theme"
import { entries, filter, flatMap, groupBy, pipe } from "remeda"
import { batch, createEffect, createMemo, createSignal, For, Show, type JSX, on, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import * as fuzzysort from "fuzzysort"
import { isDeepEqual } from "remeda"
import {
  DIALOG_INSET,
  DIALOG_LIST_INSET,
  DialogBleed,
  DialogFooter,
  DialogHeader,
  DialogLayout,
  dialogWidth,
  useDialog,
  type DialogContext,
} from "./dialog"
import { Locale } from "../util/locale"
import { getScrollAcceleration } from "../util/scroll"
import { useConfig, useNewDesigns } from "../config"
import { moveSelection, reconcileSelection } from "./select-controller"

export interface DialogSelectProps<T> {
  title: string
  titleView?: JSX.Element
  /** Faint line below the title, under the "new-designs" experiment. Not shown with `searchInTitle`. */
  description?: string
  /** Blank rows above the footer under the "new-designs" experiment. Defaults to 1. */
  footerGap?: number
  placeholder?: string
  footer?: JSX.Element
  emptyView?: JSX.Element
  noMatchView?: JSX.Element
  options: DialogSelectOption<T>[]
  flat?: boolean
  filterThreshold?: number
  ref?: (ref: DialogSelectRef<T>) => void
  onMove?: (option: DialogSelectOption<T>) => void
  onFilter?: (query: string) => void
  onSelect?: (option: DialogSelectOption<T>) => void
  onCancel?: () => void
  skipFilter?: boolean
  search?: (query: string) => readonly DialogSelectOption<T>[]
  renderFilter?: boolean
  locked?: boolean
  preserveSelection?: boolean
  actions?: DialogSelectAction<T>[]
  footerHints?: {
    title: string
    label: string
    /** Footer placement while the "new-designs" experiment is off. */
    side?: "left" | "right"
    /** Footer group under the "new-designs" experiment. Defaults to `secondary`. */
    group?: "primary" | "secondary"
  }[]
  bindings?: readonly KeymapCommand[]
  current?: T
  focusTarget?: T
  focusCurrent?: boolean
  sectionNavigation?: boolean
  /** Under the "new-designs" experiment, puts the search input in the header row in place of the title. */
  searchInTitle?: boolean
  /** Placeholder for the search input while it replaces the title, e.g. "Search models". */
  titlePlaceholder?: string
}

type DialogSelectActionBase<T> = {
  command: string
  /** A function title follows the selected option, e.g. "favorite" / "unfavorite". */
  title: string | ((option: DialogSelectOption<T> | undefined) => string)
  bind?: string
  /** Footer placement while the "new-designs" experiment is off. */
  side?: "left" | "right"
  /**
   * Footer group under the "new-designs" experiment. Defaults to `primary` for actions on the selected
   * option and `secondary` for dialog-level actions (`selection: "none"`).
   */
  group?: "primary" | "secondary"
  hidden?: boolean
  disabled?: boolean | ((option: DialogSelectOption<T> | undefined) => boolean)
}

type DialogSelectAction<T> =
  | (DialogSelectActionBase<T> & {
      selection?: "required"
      onTrigger: (option: DialogSelectOption<T>) => void
    })
  | (DialogSelectActionBase<T> & {
      selection: "none"
      onTrigger: () => void
    })

export interface DialogSelectOption<T = any> {
  title: string
  titleView?: JSX.Element
  value: T
  description?: string
  searchText?: string
  searchFooter?: JSX.Element | string
  details?: string[]
  footer?: JSX.Element | string
  footerColor?: RGBA
  /** Cells the footer extends into the row's right padding, e.g. 2 for a `DialogSelectChoice` so its value lines up with plain footers. */
  footerOverhang?: number
  titleWidth?: number
  truncateTitle?: boolean | "left"
  category?: string
  disabled?: boolean
  bg?: RGBA
  fg?: RGBA
  gutter?: (color: RGBA) => JSX.Element
  margin?: JSX.Element
  /**
   * Shown below the list while this option is selected, under the "new-designs" experiment. A string is shown in muted
   * text. A function is called each time the option becomes selected, because a rendered element cannot be shown again
   * once it is removed.
   */
  detail?: string | (() => JSX.Element)
  onSelect?: (ctx: DialogContext) => void
}

export function dialogSelectContentWidth(dialogWidth: number) {
  // Scroll padding, row padding, the gutter, title padding, and the separating gap.
  return dialogWidth - DIALOG_LIST_INSET * 2 - 4
}

export type DialogSelectRef<T> = {
  filter: string
  filtered: DialogSelectOption<T>[]
  selected: DialogSelectOption<T> | undefined
  setFilter(value: string): void
  moveTo(value: T): void
}

export function DialogSelect<T>(props: DialogSelectProps<T>) {
  type Action = NonNullable<DialogSelectProps<T>["actions"]>[number]
  type FooterHint = NonNullable<DialogSelectProps<T>["footerHints"]>[number]
  type VisibleAction = (Action & { label: string }) | FooterHint

  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const config = useConfig().data
  const newDesigns = useNewDesigns()
  const scrollAcceleration = createMemo(() => getScrollAcceleration(config))
  const renderer = useRenderer()

  const [store, setStore] = createStore({
    selected: 0,
    filter: "",
  })
  let selection: { value: T; category?: string } | undefined
  let resetSelection = false
  let pendingScroll: (() => void) | undefined

  function scrollAfterLayout(center: boolean, value: T) {
    if (pendingScroll) renderer.off(CliRenderEvents.FRAME, pendingScroll)
    pendingScroll = () => {
      pendingScroll = undefined
      if (!isDeepEqual(selected()?.value, value)) return
      scrollToSelection(center)
    }
    renderer.once(CliRenderEvents.FRAME, pendingScroll)
    renderer.requestRender()
  }

  createEffect(
    on(
      [() => props.focusTarget ?? props.current, () => (props.focusTarget === undefined ? undefined : flat())],
      ([current]) => {
        if (props.search || props.focusCurrent === false) return
        if (props.focusTarget !== undefined && (props.preserveSelection || store.filter.length > 0)) return
        if (current !== undefined) {
          const currentIndex = flat().findIndex((opt) => isDeepEqual(opt.value, current))
          if (currentIndex >= 0) {
            setStore("selected", currentIndex)
            selection = flat()[currentIndex]
            scrollAfterLayout(true, current)
          }
        }
      },
    ),
  )

  let input: InputRenderable | undefined

  const actions = createMemo(() => props.actions ?? [])
  const shownActions = createMemo(() => actions().filter((item) => !item.hidden))
  const shortcuts = Keymap.useShortcuts()

  const actionLabels = createMemo(() => {
    const labels = new Map<string, string>()

    for (const action of shownActions()) {
      const label = shortcuts.all(action.command)
      if (label) labels.set(action.command, label)
    }

    return labels
  })
  const visibleActions = createMemo(() => [
    ...shownActions()
      .map((item) => ({ ...item, label: actionLabels().get(item.command) ?? "" }))
      .filter((item) => item.label),
    ...(props.footerHints ?? []),
  ])

  const filtered = createMemo(() => {
    if (props.search) return props.search(store.filter).filter((x) => x.disabled !== true)
    if (props.skipFilter || props.renderFilter === false) return props.options.filter((x) => x.disabled !== true)
    const needle = store.filter.toLowerCase()
    const options = pipe(
      props.options,
      filter((x) => x.disabled !== true),
    )
    if (!needle) return options

    // prioritize title matches (weight: 2) over category and supplemental search text matches (weight: 1).
    // users typically search by the item name, and not its category.
    const result = fuzzysort
      .go(needle, options, {
        keys: ["title", "category", "searchText"],
        scoreFn: (r) => r[0].score * 2 + r[1].score + r[2].score,
        threshold: props.filterThreshold,
      })
      .map((x) => x.obj)

    return result
  })

  const flatten = createMemo(() => props.search !== undefined || (props.flat && store.filter.length > 0))

  const grouped = createMemo<[string, DialogSelectOption<T>[]][]>(() => {
    if (flatten()) return filtered().length ? [["", filtered()]] : []
    const result = pipe(
      filtered(),
      groupBy((x) => x.category ?? ""),
      // mapValues((x) => x.sort((a, b) => a.title.localeCompare(b.title))),
      entries(),
    )
    return result
  })

  const flat = createMemo(() => {
    return pipe(
      grouped(),
      flatMap(([_, options]) => options),
    )
  })

  const rows = createMemo(() => {
    const headers = grouped().reduce((acc, [category], i) => {
      if (!category) return acc
      return acc + (i > 0 ? 2 : 1)
    }, 0)
    return flat().reduce((acc, option) => acc + 1 + (option.details?.length ?? 0), headers)
  })

  const dimensions = useTerminalDimensions()
  const limit = createMemo(() => Math.floor(dimensions().height / 2) - 6)
  // Under new designs an overflowing list gives its last row to a "…" indicator.
  const overflows = createMemo(() => newDesigns() && rows() > limit())
  // Computed once here so per-row details do not each call useTerminalDimensions(),
  // which registers one renderer resize listener per mounted row.
  const detailsWidth = createMemo(() =>
    dialogSelectContentWidth(Math.min(dialogWidth(dialog.size), dimensions().width)),
  )
  const [moreBelow, setMoreBelow] = createSignal(false)
  // At the bottom of the list the "…" row hands its row back to the list, so the dialog keeps its height.
  const ellipsis = () => overflows() && moreBelow()
  const height = createMemo(() => Math.min(rows(), limit()) - (ellipsis() ? 1 : 0))
  function updateMoreBelow() {
    if (!scroll || scroll.isDestroyed) return
    setMoreBelow(scroll.scrollTop + scroll.viewport.height < scroll.scrollHeight)
  }

  const selected = createMemo(() => flat()[store.selected])
  const detailView = () => {
    const detail = selected()?.detail
    return typeof detail === "function" ? detail : undefined
  }
  const detailText = () => {
    const detail = selected()?.detail
    return typeof detail === "string" ? detail : undefined
  }

  createEffect(
    on(
      () => props.options,
      () => {
        if (props.search) return
        if (
          !props.preserveSelection &&
          ((props.focusTarget ?? props.current) === undefined || props.focusCurrent === false)
        ) {
          const count = flat().length
          if (count === 0) return
          const next = reconcileSelection(store.selected, count)
          if (next !== store.selected) setStore("selected", next)
          return
        }
        if (resetSelection && store.filter.length > 0) {
          const option = flat()[0]
          if (!option) return
          setStore("selected", 0)
          selection = option
          return
        }
        if (!selection) {
          if (props.focusCurrent !== false && (props.focusTarget ?? props.current) !== undefined) {
            const index = flat().findIndex((option) => isDeepEqual(option.value, props.focusTarget ?? props.current))
            if (index >= 0) {
              setStore("selected", index)
              selection = flat()[index]
              return
            }
          }
          const option = selected()
          if (!option) return
          selection = option
          return
        }
        const previous = selection
        const index = flat().findIndex((option) => isDeepEqual(option.value, previous.value))
        if (index >= 0) {
          const option = flat()[index]
          const moved = index !== store.selected || option.category !== previous.category
          setStore("selected", index)
          selection = option
          if (!moved) return
          if (
            !props.preserveSelection &&
            ((props.focusTarget ?? props.current) === undefined ||
              props.focusCurrent === false ||
              store.filter.length > 0)
          )
            return
          scrollAfterLayout(false, option.value)
          return
        }
        const next = reconcileSelection(store.selected, flat().length)
        if (flat().length === 0) return
        setStore("selected", next)
        selection = flat()[next]
      },
    ),
  )
  createEffect(
    on(
      [
        flat,
        () => store.filter,
        () => (props.focusCurrent === false ? undefined : (props.focusTarget ?? props.current)),
      ],
      ([options, query, current], previous) => {
        if (!props.search) return
        const queryChanged = previous !== undefined && query !== previous[1]
        const currentChanged = current !== undefined && (previous === undefined || !isDeepEqual(current, previous[2]))
        selection = intent()
        const intended = selection
        const index = intended ? options.findIndex((option) => isDeepEqual(option.value, intended.value)) : -1
        const next = index >= 0 ? index : reconcileSelection(store.selected, options.length)
        const option = options[next]
        if (!option) return
        setStore("selected", next)
        selection = option
        scrollAfterLayout(queryChanged || currentChanged, option.value)

        function intent() {
          if (queryChanged && query) return options[0]
          if ((queryChanged || currentChanged) && current !== undefined) return { value: current }
          if (queryChanged) return options[reconcileSelection(store.selected, options.length)]
          return selection
        }
      },
    ),
  )
  onCleanup(() => {
    if (!pendingScroll) return
    renderer.off(CliRenderEvents.FRAME, pendingScroll)
    pendingScroll = undefined
  })

  createEffect(
    on([() => store.filter, () => props.focusTarget ?? props.current], ([filter, current]) => {
      if (props.search) return
      if (filter.length > 0) resetSelection = true
      if (filter.length > 0) {
        const option = flat()[0]
        if (!option) return
        moveTo(0, true, false)
        scrollAfterLayout(true, option.value)
        return
      }
      if (current === undefined || props.focusCurrent === false) return
      const currentIndex = flat().findIndex((opt) => isDeepEqual(opt.value, current))
      if (currentIndex < 0) return
      moveTo(currentIndex, true)
      scrollAfterLayout(true, current)
    }),
  )

  function move(direction: number) {
    if (props.locked) return
    if (flat().length === 0) return
    moveTo(moveSelection(store.selected, { count: flat().length, delta: direction, policy: "wrap" }), true)
  }

  function moveSection(direction: 1 | -1) {
    if (props.locked) return
    const sections = grouped().filter(([_, options]) => options.length > 0)
    if (sections.length === 0) return
    const current = sections.findIndex(([category]) => category === selected()?.category)
    const section = sections[(current + direction + sections.length) % sections.length]
    moveTo(flat().indexOf(section[1][0]), true)
  }

  function moveTo(next: number, center = false, preserve = true) {
    setStore("selected", next)
    const option = selected()
    if (option) {
      selection = option
      resetSelection = !preserve
    }
    if (option) props.onMove?.(option)
    scrollToSelection(center)
  }

  function scrollToSelection(center: boolean) {
    if (!scroll) return
    let remaining = store.selected
    let index = 0
    // Locate the row by position because a unique renderable ID cannot currently be ensured.
    for (const [category, options] of grouped()) {
      if (category) index++
      if (remaining < options.length) {
        index += remaining
        break
      }
      index += options.length
      remaining -= options.length
    }
    const target = scroll.getChildren()[index]
    if (!target) return
    const y = target.y - scroll.y
    if (center) {
      const centerOffset = Math.floor(scroll.height / 2)
      scroll.scrollBy(y - centerOffset)
    } else {
      if (y >= scroll.height) {
        scroll.scrollBy(y - scroll.height + 1)
      }
      if (y < 0) {
        scroll.scrollBy(y)
        if (isDeepEqual(flat()[0].value, selected()?.value)) {
          scroll.scrollTo(0)
        }
      }
    }
  }

  function submit() {
    if (props.locked) return
    const option = selected()
    if (!option) return
    option.onSelect?.(dialog)
    props.onSelect?.(option)
  }

  Keymap.createLayer(() => {
    const visible = shownActions()

    return {
      mode: "modal",
      commands: [
        {
          id: "dialog.select.prev",
          title: "Previous item",
          group: "Dialog",
          run() {
            move(-1)
          },
        },
        {
          id: "dialog.select.next",
          title: "Next item",
          group: "Dialog",
          run() {
            move(1)
          },
        },
        {
          id: "dialog.select.page_up",
          title: "Page up",
          group: "Dialog",
          run() {
            move(-10)
          },
        },
        {
          id: "dialog.select.page_down",
          title: "Page down",
          group: "Dialog",
          run() {
            move(10)
          },
        },
        {
          id: "dialog.select.home",
          title: "First item",
          group: "Dialog",
          run() {
            if (props.locked) return
            moveTo(0)
          },
        },
        {
          id: "dialog.select.end",
          title: "Last item",
          group: "Dialog",
          run() {
            if (props.locked) return
            moveTo(flat().length - 1)
          },
        },
        {
          id: "dialog.select.submit",
          title: "Select item",
          group: "Dialog",
          run: submit,
        },
        ...visible.map((item) => ({
          id: item.command,
          // Resolved without a selection so moving through the list does not rebuild the layer.
          title: typeof item.title === "function" ? item.title(undefined) : item.title,
          group: "Dialog",
          bind: item.bind,
          run: () => trigger(item),
        })),
        ...(props.bindings ?? []),
        ...(props.onCancel
          ? [
              {
                bind: "escape",
                title: "Back",
                group: "Dialog",
                run: () => {
                  if (renderer.getSelection()) {
                    renderer.clearSelection()
                    return
                  }
                  props.onCancel?.()
                },
              },
            ]
          : []),
        ...(props.sectionNavigation
          ? [
              {
                bind: "alt+up",
                title: "Previous section",
                group: "Dialog",
                run: () => moveSection(-1),
              },
              {
                bind: "alt+down",
                title: "Next section",
                group: "Dialog",
                run: () => moveSection(1),
              },
            ]
          : []),
      ],
    }
  })

  let scroll: ScrollBoxRenderable | undefined
  const ref: DialogSelectRef<T> = {
    get filter() {
      return store.filter
    },
    get filtered() {
      return filtered()
    },
    get selected() {
      return selected()
    },
    setFilter(value) {
      if (input) {
        input.value = value
        return
      }
      if (value === store.filter) return
      batch(() => {
        setStore("filter", value)
        props.onFilter?.(value)
      })
    },
    moveTo(value) {
      const index = flat().findIndex((option) => isDeepEqual(option.value, value))
      if (index >= 0) moveTo(index, true)
    },
  }
  onMount(() => props.ref?.(ref))

  const footerActions = createMemo(() =>
    visibleActions().map((item) => {
      if (!isActionItem(item))
        return { side: item.side, group: item.group ?? "secondary", action: { title: item.title, key: item.label } }
      return {
        side: item.side,
        group: item.group ?? (item.selection === "none" ? "secondary" : "primary"),
        action: {
          title: actionTitle(item),
          key: item.label,
          disabled: isActionDisabled(item),
          onTrigger: () => trigger(item),
        },
      }
    }),
  )
  const footerGroup = (match: (item: ReturnType<typeof footerActions>[number]) => boolean) =>
    footerActions()
      .filter(match)
      .map((item) => item.action)

  function trigger(item: Action | undefined) {
    if (props.locked || !item || isActionDisabled(item)) return
    if (item.selection === "none") {
      item.onTrigger()
      return
    }
    const option = selected()
    if (!option) return
    item.onTrigger(option)
  }

  function actionTitle(item: Action) {
    return typeof item.title === "function" ? item.title(selected()) : item.title
  }

  function isActionItem(item: VisibleAction): item is Action & { label: string } {
    return "onTrigger" in item
  }

  function isActionDisabled(item: Action) {
    const option = selected()
    if (item.selection !== "none" && !option) return true
    return typeof item.disabled === "function" ? item.disabled(option) : item.disabled
  }

  const searchInTitle = () => newDesigns() && props.searchInTitle === true && props.renderFilter !== false

  const searchInput = () => (
    <input
      flexGrow={1}
      onInput={(e) => {
        if (props.locked) return
        batch(() => {
          setStore("filter", e)
          props.onFilter?.(e)
        })
      }}
      focusedBackgroundColor={theme.background.formfield.focused}
      cursorColor={newDesigns() ? theme.text.base : theme.text.formfield.focused}
      cursorStyle={config.cursor}
      focusedTextColor={newDesigns() ? theme.text.formfield.base : theme.text.formfield.focused}
      ref={(r) => {
        input = r
        input.traits = { status: "FILTER" }
        setTimeout(() => {
          if (!input) return
          if (r.isDestroyed) return
          r.focus()
        }, 1)
      }}
      placeholder={(searchInTitle() ? props.titlePlaceholder : undefined) ?? props.placeholder ?? "Search"}
      placeholderColor={newDesigns() ? theme.text.faint : theme.text.muted}
    />
  )

  return (
    <DialogLayout
      footerGap={props.footerGap}
      header={
        // Rows reserve a gutter, so the header and footer line up with the list's inset rather than the layout's.
        <box paddingLeft={DIALOG_LIST_INSET - DIALOG_INSET} paddingRight={DIALOG_LIST_INSET - DIALOG_INSET}>
          <Show
            when={searchInTitle()}
            fallback={
              <>
                <DialogHeader
                  title={props.title}
                  titleView={props.titleView}
                  description={props.description}
                  onClose={props.onCancel}
                />
                <Show when={props.renderFilter !== false}>
                  <box paddingTop={1}>{searchInput()}</box>
                </Show>
              </>
            }
          >
            <DialogHeader titleView={searchInput()} gap={2} onClose={props.onCancel} />
          </Show>
        </box>
      }
      footer={{
        inset: DIALOG_LIST_INSET - DIALOG_INSET,
        actions: {
          secondary: footerGroup((item) => item.group === "secondary"),
          primary: footerGroup((item) => item.group === "primary"),
        },
        get children() {
          return props.footer
        },
      }}
      legacyFooter={
        <Show when={props.footer || visibleActions().length} fallback={<box flexShrink={0} />}>
          <DialogFooter
            inset={DIALOG_LIST_INSET - DIALOG_INSET}
            actions={{
              secondary: footerGroup((item) => item.side !== "right"),
              primary: footerGroup((item) => item.side === "right"),
            }}
          >
            {props.footer}
          </DialogFooter>
        </Show>
      }
    >
      <DialogBleed>
        <Show
          when={grouped().length > 0}
          fallback={
            <Show
              when={props.renderFilter !== false && store.filter.length > 0}
              fallback={
                props.emptyView ?? (
                  <box paddingLeft={DIALOG_LIST_INSET} paddingRight={DIALOG_LIST_INSET}>
                    <text fg={theme.text.muted}>No items available</text>
                  </box>
                )
              }
            >
              {props.noMatchView ?? (
                <box paddingLeft={DIALOG_LIST_INSET} paddingRight={DIALOG_LIST_INSET}>
                  <text fg={theme.text.muted}>No results found</text>
                </box>
              )}
            </Show>
          }
        >
          {/* The 1-cell inset keeps the row highlight off the panel edge; rows add the rest of DIALOG_LIST_INSET. */}
          <scrollbox
            // Under new designs rows run edge to edge: a 1-cell gutter holds the selection bar on the left.
            paddingLeft={newDesigns() ? 0 : 1}
            paddingRight={newDesigns() ? 0 : 1}
            scrollbarOptions={{ visible: false }}
            scrollAcceleration={scrollAcceleration()}
            ref={(r: ScrollBoxRenderable) => {
              scroll = r
              r.verticalScrollBar.on("change", updateMoreBelow)
              r.content.on("resize", updateMoreBelow)
              r.viewport.on("resize", updateMoreBelow)
            }}
            maxHeight={height()}
          >
            <For each={grouped()}>
              {([category, options], index) => (
                <>
                  <Show when={category}>
                    <DialogSelectCategory title={category} first={index() === 0} />
                  </Show>
                  <For each={options}>
                    {(option) => {
                      const active = createMemo(() => !props.locked && isDeepEqual(option.value, selected()?.value))
                      const current = createMemo(() => isDeepEqual(option.value, props.current))
                      return (
                        <box
                          flexDirection="column"
                          position="relative"
                          onMouseMove={() => {
                            if (props.locked) return
                            const index = flat().findIndex((x) => isDeepEqual(x.value, option.value))
                            if (index === -1 || index === store.selected) return
                            moveTo(index)
                          }}
                          onMouseUp={() => {
                            if (props.locked) return
                            option.onSelect?.(dialog)
                            props.onSelect?.(option)
                          }}
                          onMouseDown={() => {
                            if (props.locked) return
                            const index = flat().findIndex((x) => isDeepEqual(x.value, option.value))
                            if (index === -1) return
                            moveTo(index)
                          }}
                        >
                          <DialogSelectRow
                            title={option.title}
                            titleView={option.titleView}
                            footer={
                              flatten() ? (option.searchFooter ?? option.category ?? option.footer) : option.footer
                            }
                            footerColor={option.footerColor}
                            footerOverhang={option.footerOverhang}
                            titleWidth={option.titleWidth}
                            truncateTitle={option.truncateTitle}
                            description={option.description !== category ? option.description : undefined}
                            active={active()}
                            current={current()}
                            activeBackground={option.bg}
                            activeColor={option.fg}
                            gutter={option.gutter}
                            margin={option.margin}
                          />
                          <DialogSelectDetails details={option.details} width={detailsWidth()} />
                        </box>
                      )
                    }}
                  </For>
                </>
              )}
            </For>
          </scrollbox>
          <Show when={ellipsis()}>
            <box paddingLeft={DIALOG_LIST_INSET} flexShrink={0}>
              <text fg={theme.text.faint}>…</text>
            </box>
          </Show>
          {/* Reserved whenever any option has a detail, so the dialog does not resize as the selection moves. */}
          <Show when={newDesigns() && flat().some((option) => option.detail !== undefined)}>
            <box paddingTop={1} paddingLeft={DIALOG_LIST_INSET} paddingRight={DIALOG_LIST_INSET} flexShrink={0}>
              <Show
                when={detailView()}
                keyed
                fallback={
                  <text fg={theme.text.muted} wrapMode="word">
                    {detailText() || " "}
                  </text>
                }
              >
                {(render) => render()}
              </Show>
            </box>
          </Show>
        </Show>
      </DialogBleed>
    </DialogLayout>
  )
}

/**
 * Trailing value of a row that can be changed, under the "new-designs" experiment. The selected row shows how:
 * `‹ dark ›` cycles with ←/→, `opencode ↵` opens a picker. Other rows pad the value to the same width so it does
 * not shift as the selection moves. Pass it with `footerOverhang: 2` so the value itself ends where plain footers do.
 */
export function DialogSelectChoice(props: { value: string; active: boolean; open?: boolean }) {
  const theme = useTheme().surface("dialog")
  const text = () => {
    if (!props.active) return `  ${props.value}  `
    return props.open ? `  ${props.value} ↵` : `‹ ${props.value} ›`
  }
  return <span style={{ fg: props.active ? theme.text.action.primary.focused : theme.text.faint }}>{text()}</span>
}

function DialogSelectCategory(props: { title: string; first: boolean }) {
  const theme = useTheme().surface("dialog")
  const newDesigns = useNewDesigns()
  return (
    <box paddingTop={props.first ? 0 : 1} paddingLeft={DIALOG_LIST_INSET - (newDesigns() ? 0 : 1)}>
      <text fg={newDesigns() ? theme.text.faint : theme.hue.accent[200]} attributes={TextAttributes.BOLD}>
        {props.title}
      </text>
    </box>
  )
}

function DialogSelectRow(props: {
  title: string
  titleView?: JSX.Element
  description?: string
  active: boolean
  current: boolean
  footer?: JSX.Element | string
  footerColor?: RGBA
  footerOverhang?: number
  titleWidth?: number
  truncateTitle?: boolean | "left"
  gutter?: (color: RGBA) => JSX.Element
  margin?: JSX.Element
  activeBackground?: RGBA
  activeColor?: RGBA
}) {
  const theme = useTheme().surface("dialog")
  const newDesigns = useNewDesigns()
  const text = createMemo(() => {
    if (props.active) return props.activeColor ?? theme.text.action.primary.focused
    if (props.current && !newDesigns()) return theme.text.formfield.selected
    return theme.text.base
  })
  // Secondary text (description and footer).
  const secondary = () => {
    if (!newDesigns()) return props.active ? text() : theme.text.muted
    return props.active ? theme.text.action.secondary.focused : theme.text.faint
  }

  const row = () => (
    // A marker or gutter takes its cell plus the row gap out of the left padding,
    // so titles line up with unmarked rows: scroll pad (1) + marker (1) + gap (1).
    <box
      flexDirection="row"
      flexGrow={newDesigns() ? 1 : undefined}
      paddingLeft={props.current || props.gutter ? DIALOG_LIST_INSET - 3 : DIALOG_LIST_INSET - 1}
      paddingRight={DIALOG_LIST_INSET - (newDesigns() ? 0 : 1)}
      gap={1}
      backgroundColor={
        props.active ? (props.activeBackground ?? theme.background.action.primary.focused) : RGBA.fromInts(0, 0, 0, 0)
      }
    >
      <Show when={!props.current && props.margin}>
        <box position="absolute" left={DIALOG_LIST_INSET - 3} flexShrink={0}>
          {props.margin}
        </box>
      </Show>
      <Show when={props.current && !props.gutter}>
        <text flexShrink={0} fg={newDesigns() ? theme.text.formfield.selected : text()}>
          {newDesigns() ? "▪" : "●"}
        </text>
      </Show>
      <Show when={props.gutter}>
        <box flexShrink={0}>{props.gutter?.(text())}</box>
      </Show>
      <text
        flexGrow={1}
        fg={text()}
        attributes={props.active && !newDesigns() ? TextAttributes.BOLD : undefined}
        overflow="hidden"
        wrapMode="none"
        paddingLeft={3}
      >
        {props.titleView ??
          (props.truncateTitle === false
            ? props.title
            : props.truncateTitle === "left"
              ? Locale.truncateLeft(props.title, props.titleWidth ?? 61)
              : Locale.truncate(props.title, props.titleWidth ?? 61))}
        <Show when={props.description}>
          <span style={{ fg: secondary() }}>{" " + props.description}</span>
        </Show>
      </text>
      <Show when={props.footer}>
        <box flexShrink={0} marginRight={props.footerOverhang ? -props.footerOverhang : undefined}>
          <text fg={props.active || !props.footerColor ? secondary() : props.footerColor}>{props.footer}</text>
        </box>
      </Show>
    </box>
  )

  return (
    <Show when={newDesigns()} fallback={row()}>
      <box flexDirection="row">
        <text width={1} flexShrink={0} fg={theme.text.formfield.focused}>
          {props.active ? "┃" : " "}
        </text>
        {row()}
      </box>
    </Show>
  )
}

function DialogSelectDetails(props: { details?: string[]; width: number }) {
  const theme = useTheme().surface("dialog")
  const newDesigns = useNewDesigns()
  return (
    <For each={props.details}>
      {(detail) => (
        <box
          paddingLeft={DIALOG_LIST_INSET - (newDesigns() ? 0 : 1)}
          paddingRight={DIALOG_LIST_INSET - (newDesigns() ? 0 : 1)}
        >
          <text fg={theme.text.muted} wrapMode="none">
            {Locale.truncateMiddle(detail, Math.max(1, props.width))}
          </text>
        </box>
      )}
    </For>
  )
}
