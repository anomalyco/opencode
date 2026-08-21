import { For, Show } from "solid-js"
import { AppIcon } from "@opencode-ai/ui/app-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Menu } from "@opencode-ai/ui/menu"
import { SplitButton, SplitButtonAction, SplitButtonMenuTrigger } from "@opencode-ai/ui/split-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"
import { type OpenApp, useOpenInApp } from "@/session/files/open-in-app"

export function OpenInAppButton(props: { directory: () => string }) {
  const language = useLanguage()
  const state = useOpenInApp(props)

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
              state.openDir(state.current().id)
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
              <Menu.Group>
                <Menu.GroupLabel>{language.t("session.header.openIn")}</Menu.GroupLabel>
                <Menu.RadioGroup
                  value={state.current().id}
                  onChange={(value) => {
                    state.selectApp(value as OpenApp)
                  }}
                >
                  <For each={state.options()}>
                    {(option) => (
                      <Menu.RadioItem
                        value={option.id}
                        disabled={state.opening()}
                        onSelect={() => {
                          state.selectApp(option.id)
                          state.setMenu("open", false)
                          state.openDir(option.id)
                        }}
                      >
                        <AppIcon id={option.icon} />
                        {option.label}
                      </Menu.RadioItem>
                    )}
                  </For>
                </Menu.RadioGroup>
              </Menu.Group>
              <Menu.Separator />
              <Menu.Item
                onSelect={() => {
                  state.setMenu("open", false)
                  state.copyPath()
                }}
              >
                <Icon name="copy" size="small" class="text-icon-weak" />
                {language.t("session.header.open.copyPath")}
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      </SplitButton>
    </Show>
  )
}
