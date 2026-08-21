import { Content, List, Root, Trigger } from "@kobalte/core/tabs"
import { createContext, Show, splitProps, useContext, type JSX } from "solid-js"
import type { Component, ComponentProps, ParentProps } from "solid-js"
import { useI18n } from "../../context/i18n"
import "./tabs-current.css"

export type TabsVariant = "panel" | "underline" | "surface" | "line" | "pill" | "settings"

export interface TabsProps extends ComponentProps<typeof Root> {
  variant?: TabsVariant
  orientation?: "horizontal" | "vertical"
}
export interface TabsListProps extends ComponentProps<typeof List> {}
export interface TabsTriggerProps extends ComponentProps<typeof Trigger> {
  classes?: { button?: string }
  closeButton?: JSX.Element
  hideCloseButton?: boolean
  onMiddleClick?: () => void
  subtext?: JSX.Element | string
}
export interface TabsCloseButtonProps extends ComponentProps<"button"> {}
export interface TabsContentProps extends ComponentProps<typeof Content> {}

const TabsContext = createContext<{ current: () => boolean }>({ current: () => false })

function TabsRoot(props: TabsProps) {
  const [local, rest] = splitProps(props, ["class", "classList", "variant", "orientation", "children"])
  const variant = () => local.variant ?? "panel"
  const current = () => variant() === "line" || variant() === "pill" || variant() === "settings"
  const dataVariant = () => {
    if (variant() === "panel" || variant() === "line") return "normal"
    if (variant() === "underline") return "alt"
    if (variant() === "surface") return "pill"
    return variant()
  }
  return (
    <TabsContext.Provider value={{ current }}>
      <Root
        {...rest}
        orientation={local.orientation}
        data-component={current() ? "tabs-v2" : "tabs"}
        data-variant={dataVariant()}
        data-orientation={local.orientation || "horizontal"}
        classList={{
          ...local.classList,
          [local.class ?? ""]: !!local.class,
        }}
      >
        {local.children}
      </Root>
    </TabsContext.Provider>
  )
}

function TabsList(props: TabsListProps) {
  const ctx = useContext(TabsContext)
  const [local, rest] = splitProps(props, ["class", "classList"])
  return (
    <List
      {...rest}
      data-slot={ctx.current() ? "tabs-v2-list" : "tabs-list"}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    />
  )
}

function TabsTrigger(props: ParentProps<TabsTriggerProps>) {
  const ctx = useContext(TabsContext)
  const [local, rest] = splitProps(props, [
    "class",
    "classList",
    "classes",
    "children",
    "closeButton",
    "hideCloseButton",
    "onMiddleClick",
    "subtext",
    "dir",
  ])
  const wrapperSlot = () => (ctx.current() ? "tabs-v2-trigger-wrapper" : "tabs-trigger-wrapper")
  const triggerSlot = () => (ctx.current() ? "tabs-v2-trigger" : "tabs-trigger")
  const closeSlot = () => (ctx.current() ? "tabs-v2-trigger-close-button" : "tabs-trigger-close-button")
  return (
    <div
      data-slot={wrapperSlot()}
      data-value={props.value}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      onMouseDown={(event) => {
        if (event.button !== 1 || !local.onMiddleClick) return
        event.preventDefault()
      }}
      onAuxClick={(event) => {
        if (event.button !== 1 || !local.onMiddleClick) return
        event.preventDefault()
        local.onMiddleClick()
      }}
    >
      <Trigger
        {...rest}
        dir={local.dir ?? "auto"}
        data-slot={triggerSlot()}
        data-value={props.value}
        classList={{ [local.classes?.button ?? ""]: !!local.classes?.button }}
      >
        <Show when={ctx.current()} fallback={local.children}>
          <span class="inline-flex items-center gap-2" data-slot="tabs-v2-trigger-content">
            {local.children}
            <Show when={local.subtext}>
              {(subtext) => (
                <span data-slot="tabs-v2-subtext" class="ms-2 text-xs text-text-weak">
                  {subtext()}
                </span>
              )}
            </Show>
          </span>
        </Show>
      </Trigger>
      <Show when={local.closeButton}>
        {(closeButton) => (
          <div data-slot={closeSlot()} data-hidden={local.hideCloseButton ? "" : undefined}>
            {closeButton()}
          </div>
        )}
      </Show>
    </div>
  )
}

function TabsCloseButton(props: TabsCloseButtonProps) {
  const i18n = useI18n()
  const [local, rest] = splitProps(props, ["class", "classList", "onClick", "onPointerDown", "aria-label"])
  return (
    <button
      type="button"
      {...rest}
      aria-label={local["aria-label"] ?? i18n.t("ui.tabs.close")}
      data-slot="tabs-close-button"
      classList={{
        [local.class ?? ""]: !!local.class,
        ...local.classList,
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (typeof local.onPointerDown === "function") local.onPointerDown(event)
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (typeof local.onClick === "function") local.onClick(event)
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M10.8889 3.11108L3.11108 10.8889" stroke="currentColor" stroke-linejoin="round" />
        <path d="M3.11108 3.11108L10.8889 10.8889" stroke="currentColor" stroke-linejoin="round" />
      </svg>
    </button>
  )
}

function TabsContent(props: ParentProps<TabsContentProps>) {
  const ctx = useContext(TabsContext)
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Content
      {...rest}
      data-slot={ctx.current() ? "tabs-v2-content" : "tabs-content"}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Content>
  )
}

const TabsSectionTitle: Component<ParentProps> = (props) => {
  const ctx = useContext(TabsContext)
  return <div data-slot={ctx.current() ? "tabs-v2-section-title" : "tabs-section-title"}>{props.children}</div>
}

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Trigger: TabsTrigger,
  CloseButton: TabsCloseButton,
  Content: TabsContent,
  SectionTitle: TabsSectionTitle,
})
