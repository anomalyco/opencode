import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { createSignal, For, Show } from "solid-js"
import type { IntegrationInfo } from "@opencode/client/promise"
import { useIntegrations } from "@/providers/catalog/integrations"
import { CONSOLE_INTEGRATION } from "@/providers/connect/controller"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerProvider } from "@/runtime/server/current"
import { activeProviderAccount, providerAccounts, type ProviderAccount } from "@/settings/providers/accounts"
import { useProviderAccountActions } from "@/settings/providers/account-actions"
import { useSettingsSurface } from "@/settings/surface"
import "./titlebar.css"

/** Switches the accounts the selected server signs in with. Only renders once that server is selected. */
export function AccountSwitcher(props: { vertical?: boolean }) {
  const surface = useSettingsSurface()

  return (
    <Show when={surface.server()?.connection} keyed>
      {(connection) => (
        <ServerProvider conn={connection}>
          <AccountMenu vertical={props.vertical} />
        </ServerProvider>
      )}
    </Show>
  )
}

function AccountMenu(props: { vertical?: boolean }) {
  const language = useLanguage()
  const dialog = useDialog()
  const surface = useSettingsSurface()
  // Accounts belong to the server, so they come from its default Location rather than a route's directory.
  const integrations = useIntegrations(() => undefined)
  const accountActions = useProviderAccountActions(() => undefined)
  const [pending, setPending] = createSignal<string>()

  const groups = () =>
    integrations
      .list()
      .map((integration) => ({ integration, accounts: providerAccounts(integration) }))
      .filter((group) => group.accounts.length > 0)

  // Console is the sign-in account, so it names the button; other integrations only label their own rows.
  const named = () => {
    const group = groups().find((item) => item.integration.id === CONSOLE_INTEGRATION) ?? groups()[0]

    return group ? activeProviderAccount(group.integration) : undefined
  }

  const activate = (integration: IntegrationInfo, account: ProviderAccount) => {
    if (activeProviderAccount(integration)?.id === account.id) return
    setPending(account.id)
    void accountActions
      .activate({ integrationID: integration.id, provider: integration.name, account })
      .finally(() => setPending(undefined))
  }

  const connect = () => {
    void import("@/providers/connect/dialog").then(({ DialogConnectProvider }) =>
      dialog.show(
        () => <DialogConnectProvider defaultLocation />,
        () => void accountActions.refresh().catch(() => undefined),
      ),
    )
  }

  const label = () => language.t("settings.providers.account.group")

  return (
    <Menu placement={props.vertical ? "top-start" : "bottom-end"} gutter={6} modal={false}>
      <Show
        when={props.vertical}
        fallback={
          <Tooltip placement="bottom" value={label()} class="shrink-0">
            <Menu.Trigger
              as={IconButton}
              variant="ghost-muted"
              size="large"
              class="!w-9 shrink-0"
              icon={<Icon name="outline-user" />}
              aria-label={label()}
            />
          </Tooltip>
        }
      >
        <Menu.Trigger as={Button} variant="ghost-muted" class="titlebar-account-switcher" aria-label={label()}>
          <Icon name="outline-user" class="shrink-0" />
          <span class="titlebar-account-switcher-label">{named()?.label ?? label()}</span>
          <Icon name="chevron-down" size="small" class="shrink-0" />
        </Menu.Trigger>
      </Show>
      <Menu.Portal>
        <Menu.Content class="titlebar-account-switcher-menu">
          <For each={groups()}>
            {(group, index) => (
              <>
                <Show when={index() > 0}>
                  <Menu.Separator />
                </Show>
                <Menu.Group>
                  <Menu.GroupLabel>{group.integration.name}</Menu.GroupLabel>
                  <Menu.RadioGroup
                    value={activeProviderAccount(group.integration)?.id}
                    onChange={(credentialID) => {
                      const account = group.accounts.find((item) => item.id === credentialID)

                      if (account) activate(group.integration, account)
                    }}
                  >
                    <For each={group.accounts}>
                      {(account) => (
                        <Menu.RadioItem value={account.id} closeOnSelect disabled={pending() !== undefined}>
                          <span class="titlebar-account-switcher-option">{account.label}</span>
                        </Menu.RadioItem>
                      )}
                    </For>
                  </Menu.RadioGroup>
                </Menu.Group>
              </>
            )}
          </For>
          <Show when={groups().length > 0}>
            <Menu.Separator />
          </Show>
          <Show when={groups().length === 0}>
            <Menu.Item disabled>{language.t("account.switcher.empty")}</Menu.Item>
            <Menu.Separator />
          </Show>
          <Menu.Item disabled={pending() !== undefined} onSelect={connect}>
            <Icon name="plus" size="small" class="shrink-0" />
            {language.t("settings.providers.account.add")}
          </Menu.Item>
          <Menu.Item onSelect={() => surface.open("providers")}>
            <Icon name="providers" size="small" class="shrink-0" />
            {language.t("account.switcher.manage")}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}
