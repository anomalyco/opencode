import { createEffect, Show, type JSX, splitProps, createSignal } from "solid-js"
import { Dialog, DialogProps } from "./dialog"
import { Icon } from "./icon"
import { Input } from "./input"
import { IconButton } from "./icon-button"
import { List, ListRef, ListProps } from "./list"

interface SelectDialogProps<T>
  extends Omit<ListProps<T>, "filter">,
    Pick<DialogProps, "trigger" | "onOpenChange" | "defaultOpen"> {
  title: string
  placeholder?: string
  actions?: JSX.Element
}

export function SelectDialog<T>(props: SelectDialogProps<T>) {
  const [dialog, others] = splitProps(props, ["trigger", "onOpenChange", "defaultOpen"])
  let closeButton!: HTMLButtonElement
  let inputRef: HTMLInputElement | undefined
  const [filter, setFilter] = createSignal("")
  let listRef: ListRef | undefined

  createEffect(() => {
    if (!props.current) return
    const key = props.key(props.current)
    requestAnimationFrame(() => {
      const element = document.querySelector(`[data-key="${key}"]`)
      element?.scrollIntoView({ block: "center" })
    })
  })

  const handleSelect = (item: T | undefined) => {
    others.onSelect?.(item)
    closeButton.click()
  }

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") return
    listRef?.onKeyDown(e)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) setFilter("")
    props.onOpenChange?.(open)
  }

  return (
    <Dialog modal {...dialog} onOpenChange={handleOpenChange}>
      <Dialog.Header>
        <Dialog.Title>{others.title}</Dialog.Title>
        <Show when={others.actions}>{others.actions}</Show>
        <Dialog.CloseButton ref={closeButton} tabIndex={-1} style={{ display: others.actions ? "none" : undefined }} />
      </Dialog.Header>
      <div data-slot="select-dialog-content">
        <div data-component="select-dialog-input">
          <div data-slot="select-dialog-input-container">
            <Icon name="magnifying-glass" />
            <Input
              ref={inputRef}
              autofocus
              data-slot="select-dialog-input"
              type="text"
              value={filter()}
              onChange={setFilter}
              onKeyDown={handleKey}
              placeholder={others.placeholder}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
            />
          </div>
          <Show when={filter()}>
            <IconButton icon="circle-x" variant="ghost" onClick={() => setFilter("")} />
          </Show>
        </div>
        <Dialog.Body>
          <List
            ref={(ref) => {
              listRef = ref
            }}
            items={others.items}
            key={others.key}
            filterKeys={others.filterKeys}
            current={others.current}
            groupBy={others.groupBy}
            sortBy={others.sortBy}
            sortGroupsBy={others.sortGroupsBy}
            emptyMessage={others.emptyMessage}
            activeIcon={others.activeIcon}
            filter={filter()}
            onSelect={handleSelect}
            onKeyEvent={others.onKeyEvent}
          >
            {others.children}
          </List>
        </Dialog.Body>
      </div>
    </Dialog>
  )
}
