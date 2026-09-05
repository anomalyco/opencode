import { createSignal, For, Show, type ParentProps } from "solid-js"
import { AppIcon } from "@opencode-ai/ui/app-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Menu } from "@opencode-ai/ui/menu"
import { SplitButton, SplitButtonAction, SplitButtonMenuTrigger } from "@opencode-ai/ui/split-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { type OpenApp, useOpenInApp } from "@/session/files/open-in-app"

export function OpenInAppButton(props: { directory: () => string }) {
  const language = useLanguage()
  const state = useOpenInApp({ path: props.directory })

  return (
    <Show when={props.directory() && state.canOpen()}>
      <SplitButton class="session-review-v2-open-in-app" onPointerDown={(event) => event.stopPropagation()}>
        <Tooltip
          placement="bottom"
          value={language.t("session.header.open.ariaLabel", { app: state.current().label })}
          class="flex items-center"
        >
          <SplitButtonAction
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
          </SplitButtonAction>
        </Tooltip>
        <Menu
          gutter={4}
          modal={false}
          placement="bottom-end"
          open={state.menu.open}
          onOpenChange={(open) => state.setMenu("open", open)}
        >
          <Menu.Trigger
            as={SplitButtonMenuTrigger}
            disabled={state.opening()}
            aria-label={language.t("session.header.open.menu")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Icon name="chevron-down" size="small" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content class="open-in-app-v2-menu">
              <OpenInAppMenuItemsV2 state={state} close={() => state.setMenu("open", false)} />
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      </SplitButton>
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
      <Menu.Group>
        <Menu.GroupLabel>{language.t("session.header.openIn")}</Menu.GroupLabel>
        <Show
          when={props.selection !== false}
          fallback={
            <For each={props.state.options()}>
              {(option) => (
                <Menu.Item
                  disabled={props.state.opening()}
                  onSelect={() => {
                    props.state.selectApp(option.id)
                    props.close?.()
                    props.state.openPath(option.id, path(), props.reveal)
                  }}
                >
                  <AppIcon id={option.icon} />
                  {option.label}
                </Menu.Item>
              )}
            </For>
          }
        >
          <Menu.RadioGroup
            value={props.state.current().id}
            onChange={(value) => {
              props.state.selectApp(value as OpenApp)
            }}
          >
            <For each={props.state.options()}>
              {(option) => (
                <Menu.RadioItem
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
                </Menu.RadioItem>
              )}
            </For>
          </Menu.RadioGroup>
        </Show>
      </Menu.Group>
      <Menu.Separator />
      <Menu.Item
        onSelect={() => {
          props.close?.()
          props.state.copyPath(path())
        }}
      >
        <Icon name="copy" size="small" class="text-icon-weak" />
        {language.t("session.header.open.copyPath")}
      </Menu.Item>
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
      <Menu.Context modal={false} onOpenChange={setOpen}>
        <Menu.Context.Trigger
          as="div"
          class="h-full w-full min-w-max"
          data-slot="file-tree-v2-context-trigger"
          data-context-menu-open={open() ? "" : undefined}
        >
          {props.children}
        </Menu.Context.Trigger>
        <Menu.Context.Portal>
          <Menu.Context.Content class="open-in-app-v2-menu">
            <OpenInAppMenuItemsV2
              state={state}
              path={props.path}
              reveal
              selection={false}
              close={() => setOpen(false)}
            />
          </Menu.Context.Content>
        </Menu.Context.Portal>
      </Menu.Context>
    </Show>
  )
}
