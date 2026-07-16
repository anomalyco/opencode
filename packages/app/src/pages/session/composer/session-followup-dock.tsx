import { For, Show, createMemo, createSignal, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { DockTray } from "@opencode-ai/ui/dock-surface"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import type { FollowupTarget } from "@/components/prompt-input/submit"

const TARGETS: FollowupTarget[] = ["steer", "current-stream", "followup", "sub-session"]

function FollowupItem(props: {
  item: { id: string; text: string; target: FollowupTarget }
  index: Accessor<number>
  itemsLength: Accessor<number>
  sending?: boolean
  draggedIndex: Accessor<number | undefined>
  dropIndex: Accessor<number | undefined>
  onDragStart: (index: number) => void
  onDragOver: (index: number) => void
  onDragEnd: () => void
  onSend: (id: string) => void
  onEdit: (id: string) => void
  onChangeTarget: (id: string, target: FollowupTarget) => void
}) {
  const language = useLanguage()

  const isDragged = createMemo(() => props.draggedIndex() === props.index())
  const showTopLine = createMemo(
    () => !isDragged() && props.dropIndex() === props.index(),
  )
  const showBottomLine = createMemo(
    () => !isDragged() && props.index() === props.itemsLength() - 1 && props.dropIndex() === props.itemsLength(),
  )

  return (
    <div
      draggable={!props.sending}
      class="relative flex items-center gap-2 min-w-0 py-1 cursor-grab active:cursor-grabbing"
      classList={{
        "opacity-30": isDragged(),
        "pointer-events-none": !!props.sending,
      }}
      onDragStart={() => props.onDragStart(props.index())}
      onDragOver={(e) => {
        e.preventDefault()
        props.onDragOver(props.index())
      }}
      onDragEnd={() => props.onDragEnd()}
    >
      <Show when={showTopLine()}>
        <div
          class="absolute -top-px left-0 right-0 h-0.5 pointer-events-none z-10 rounded-full"
          style={{ "background-color": "var(--v2-icon-icon-accent, #58f)" }}
        />
      </Show>
      <Show when={showBottomLine()}>
        <div
          class="absolute -bottom-px left-0 right-0 h-0.5 pointer-events-none z-10 rounded-full"
          style={{ "background-color": "var(--v2-icon-icon-accent, #58f)" }}
        />
      </Show>
      <span class="min-w-0 flex-1 truncate text-13-regular text-text-strong">{props.item.text}</span>
      <MenuV2 gutter={6} modal={false} placement="bottom-start">
        <MenuV2.Trigger
          as={Button}
          size="small"
          variant="ghost"
          class="shrink-0"
          disabled={!!props.sending}
        >
          <span class="truncate text-13-regular">
            {language.t(`session.followupDock.target.${props.item.target}`)}
          </span>
          <Icon name="chevron-down" size="small" />
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content>
            <MenuV2.RadioGroup
              value={props.item.target}
              onChange={(value) => props.onChangeTarget(props.item.id, value as FollowupTarget)}
            >
              {TARGETS.map((value) => (
                <TooltipV2
                  placement="right"
                  value={language.t(`prompt.queue.target.${value}.description`)}
                >
                  <MenuV2.RadioItem value={value}>
                    {language.t(`session.followupDock.target.${value}`)}
                  </MenuV2.RadioItem>
                </TooltipV2>
              ))}
            </MenuV2.RadioGroup>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
      <Button
        size="small"
        variant="secondary"
        class="shrink-0"
        disabled={!!props.sending}
        onClick={() => props.onSend(props.item.id)}
      >
        {language.t("session.followupDock.sendNow")}
      </Button>
      <Button
        size="small"
        variant="ghost"
        class="shrink-0"
        disabled={!!props.sending}
        onClick={() => props.onEdit(props.item.id)}
      >
        {language.t("session.followupDock.edit")}
      </Button>
    </div>
  )
}

export function SessionFollowupDock(props: {
  items: { id: string; text: string; target: FollowupTarget }[]
  sending?: string
  onSend: (id: string) => void
  onEdit: (id: string) => void
  onChangeTarget: (id: string, target: FollowupTarget) => void
  onReorder: (fromIndex: number, toIndex: number) => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({
    collapsed: false,
  })
  const [draggedIndex, setDraggedIndex] = createSignal<number | undefined>(undefined)
  const [dropIndex, setDropIndex] = createSignal<number | undefined>(undefined)

  const toggle = () => setStore("collapsed", (value) => !value)
  const total = createMemo(() => props.items.length)
  const label = createMemo(() =>
    language.t(total() === 1 ? "session.followupDock.summary.one" : "session.followupDock.summary.other", {
      count: total(),
    }),
  )
  const preview = createMemo(() => props.items[0]?.text ?? "")
  const itemsLength = createMemo(() => props.items.length)

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
    setDropIndex(undefined)
  }

  const handleDragOver = (index: number) => {
    const from = draggedIndex()
    if (from === undefined || from === index) {
      setDropIndex(undefined)
      return
    }
    setDropIndex(from < index ? index + 1 : index)
  }

  const handleDragEnd = () => {
    const from = draggedIndex()
    const to = dropIndex()
    if (from !== undefined && to !== undefined) {
      props.onReorder(from, to)
    }
    setDraggedIndex(undefined)
    setDropIndex(undefined)
  }

  return (
    <DockTray
      data-component="session-followup-dock"
      style={{
        "margin-bottom": "-0.875rem",
        "border-bottom-left-radius": 0,
        "border-bottom-right-radius": 0,
      }}
    >
      <div
        class="pl-3 pr-2 py-2 flex items-center gap-2"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          toggle()
        }}
      >
        <span class="shrink-0 text-13-medium text-text-strong cursor-default">{label()}</span>
        <Show when={store.collapsed && preview()}>
          <span class="min-w-0 flex-1 truncate text-13-regular text-text-base cursor-default">{preview()}</span>
        </Show>
        <div class="ml-auto shrink-0">
          <IconButton
            data-collapsed={store.collapsed ? "true" : "false"}
            icon="chevron-down"
            size="normal"
            variant="ghost"
            style={{ transform: `rotate(${store.collapsed ? 180 : 0}deg)` }}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              toggle()
            }}
            aria-label={
              store.collapsed ? language.t("session.followupDock.expand") : language.t("session.followupDock.collapse")
            }
          />
        </div>
      </div>

      <Show when={store.collapsed}>
        <div class="h-5" aria-hidden="true" />
      </Show>

      <Show when={!store.collapsed}>
        <div
          class="px-3 pb-7 flex flex-col gap-1.5 max-h-42 overflow-y-auto no-scrollbar"
          onDragOver={(e) => e.preventDefault()}
        >
          <For each={props.items}>
            {(item, index) => (
              <FollowupItem
                item={item}
                index={index}
                itemsLength={itemsLength}
                sending={!!props.sending}
                draggedIndex={draggedIndex}
                dropIndex={dropIndex}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                onSend={props.onSend}
                onEdit={props.onEdit}
                onChangeTarget={props.onChangeTarget}
              />
            )}
          </For>
        </div>
      </Show>
    </DockTray>
  )
}
