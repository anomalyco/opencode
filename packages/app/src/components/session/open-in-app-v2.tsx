import { createSignal, For, Show, type ParentProps } from "solid-js"
import { AppIcon } from "@opencode-ai/ui/app-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { SplitButtonV2, SplitButtonV2Action, SplitButtonV2MenuTrigger } from "@opencode-ai/ui/v2/split-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { useOpenInApp } from "@/components/session/open-in-app"

export function OpenInAppV2(props: { directory: () => string }) {
  const language = useLanguage()
  const state = useOpenInApp({ path: props.directory })

  return (
    <Show when={props.directory() && state.canOpen()}>
      <SplitButtonV2 class="session-review-v2-open-in-app" onPointerDown={(event) => event.stopPropagation()}>
        <TooltipV2
          placement="bottom"
          value={language.t("session.header.open.ariaLabel", { app: state.current().label })}
          class="flex items-center"
        >
          <SplitButtonV2Action
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              if (state.opening()) return
              state.openPath(state.current().id)
            }}
            disabled={state.opening()}
            aria-label={language.t("session.header.open.ariaLabel", { app: state.current().label })}
          >
            <Show when={state.opening()} fallback={<AppIcon id={state.current().icon} class="size-[18px]" />}>
              <Spinner class="size-3.5" />
            </Show>
          </SplitButtonV2Action>
        </TooltipV2>
        <MenuV2
          gutter={4}
          modal={false}
          placement="bottom-end"
          open={state.menu.open}
          onOpenChange={(open) => state.setMenu("open", open)}
        >
          <MenuV2.Trigger
            as={SplitButtonV2MenuTrigger}
            disabled={state.opening()}
            aria-label={language.t("session.header.open.menu")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <IconV2 name="chevron-down" size="small" />
          </MenuV2.Trigger>
          <MenuV2.Portal>
            <MenuV2.Content class="open-in-app-v2-menu">
              <OpenInAppMenuItemsV2 state={state} close={() => state.setMenu("open", false)} />
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </SplitButtonV2>
    </Show>
  )
}

type OpenInAppState = ReturnType<typeof useOpenInApp>

function OpenInAppMenuItemsV2(props: {
  state: OpenInAppState
  path?: () => string
  reveal?: boolean
  selection?: boolean
  close?: () => void
}) {
  const language = useLanguage()
  const path = () => props.path?.()

  return (
    <>
      <MenuV2.Group>
        <MenuV2.GroupLabel>{language.t("session.header.openIn")}</MenuV2.GroupLabel>
        <Show
          when={props.selection !== false}
          fallback={
            <For each={props.state.options()}>
              {(option) => (
                <MenuV2.Item
                  disabled={props.state.opening()}
                  onSelect={() => {
                    props.state.selectApp(option.id)
                    props.close?.()
                    props.state.openPath(option.id, path(), props.reveal)
                  }}
                >
                  <AppIcon id={option.icon} />
                  {option.label}
                </MenuV2.Item>
              )}
            </For>
          }
        >
          <MenuV2.RadioGroup
            value={props.state.current().id}
            onChange={(value) => {
              props.state.selectApp(value)
            }}
          >
            <For each={props.state.options()}>
              {(option) => (
                <MenuV2.RadioItem
                  value={option.id}
                  closeOnSelect
                  disabled={props.state.opening()}
                  onSelect={() => {
                    props.state.selectApp(option.id)
                    props.close?.()
                    props.state.openPath(option.id, path(), props.reveal)
                  }}
                >
                  <AppIcon id={option.icon} />
                  {option.label}
                </MenuV2.RadioItem>
              )}
            </For>
          </MenuV2.RadioGroup>
        </Show>
      </MenuV2.Group>
      <MenuV2.Separator />
      <MenuV2.Item
        onSelect={() => {
          props.close?.()
          props.state.copyPath(path())
        }}
      >
        <Icon name="copy" size="small" class="text-icon-weak" />
        {language.t("session.header.open.copyPath")}
      </MenuV2.Item>
    </>
  )
}

export function OpenInAppContextMenuV2(
  props: ParentProps<{
    state?: OpenInAppState
    path: () => string
  }>,
) {
  const state = props.state
  if (!state) return props.children
  const [open, setOpen] = createSignal(false)

  return (
    <Show when={state.canOpen() && props.path()} fallback={props.children}>
      <MenuV2.Context modal={false} onOpenChange={setOpen}>
        <MenuV2.Context.Trigger
          as="div"
          class="h-full w-full min-w-max"
          data-slot="file-tree-v2-context-trigger"
          data-context-menu-open={open() ? "" : undefined}
        >
          {props.children}
        </MenuV2.Context.Trigger>
        <MenuV2.Context.Portal>
          <MenuV2.Context.Content class="open-in-app-v2-menu">
            <OpenInAppMenuItemsV2
              state={state}
              path={props.path}
              reveal
              selection={false}
              close={() => setOpen(false)}
            />
          </MenuV2.Context.Content>
        </MenuV2.Context.Portal>
      </MenuV2.Context>
    </Show>
  )
}
