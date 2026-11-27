import { Badge } from "@opencode/ui/badge"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { ProviderAccount } from "@/settings/providers/accounts"

/**
 * The OpenCode group's header in the model picker: the active Console account and its plan, and the menu that switches,
 * adds and manages accounts. Without a signed-in account to show, it names the workspace instead.
 */
export function WorkspaceHeader(props: {
  /** The workspace's name, for a workspace whose account the integration does not list. */
  workspace: string
  /** The OpenCode sign-in accounts, the active one first, as the server lists them. */
  accounts: readonly ProviderAccount[]
  /** The workspace has Go. Go's team plans read the same, and other accounts' plans are unknown. */
  go: boolean
  onActivate: (account: ProviderAccount) => void
  onAdd: () => void
  onManage: () => void
}) {
  const language = useLanguage()
  const provider = () => language.t("provider.connect.opencode.name")
  const active = () => props.accounts[0]

  return (
    <span data-slot="model-dialog-header-line" class="flex min-w-0 items-center gap-1.5">
      <span class="shrink-0">{provider()}</span>
      <Show
        when={active()}
        fallback={
          <span data-slot="model-dialog-account">
            <span class="min-w-0 truncate">{props.workspace}</span>
            <PlanBadge show={props.go} class="mx-0.5" />
          </span>
        }
      >
        {(current) => (
          <Menu gutter={6} modal={false} placement="bottom-start">
            <Menu.Trigger
              as="button"
              type="button"
              data-slot="model-dialog-account"
              aria-label={language.t("dialog.model.account.title", { provider: provider(), account: current().label })}
              onFocus={(event: FocusEvent & { currentTarget: HTMLButtonElement }) => {
                // Later headers slide over this one as the list scrolls, so Tab scrolls its models back under it.
                if (!event.currentTarget.matches(":focus-visible")) return
                event.currentTarget
                  .closest('[data-slot="search-list-header"]')
                  ?.nextElementSibling?.scrollIntoView({ block: "nearest" })
              }}
            >
              <span class="min-w-0 truncate">{current().label}</span>
              {/* 2px more room on each side than the trigger's gap. */}
              <PlanBadge show={props.go} class="mx-0.5" />
              <Icon name="chevron-down" size="small" />
            </Menu.Trigger>
            <Menu.Portal>
              {/* Escape closes the menu, not the picker under it. */}
              <Menu.Content data-owns-escape="">
                <Menu.Group>
                  <Menu.GroupLabel>{language.t("settings.providers.account.group")}</Menu.GroupLabel>
                  <Menu.RadioGroup
                    value={active()?.id}
                    onChange={(id) => {
                      const account = props.accounts.find((item) => item.id === id)

                      if (account && account !== active()) props.onActivate(account)
                    }}
                  >
                    {/* Sorted by name, so rows stay put when the server moves the active account first. */}
                    <For
                      each={props.accounts.toSorted(
                        (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
                      )}
                    >
                      {(account) => (
                        <Menu.RadioItem value={account.id} closeOnSelect>
                          <span class="flex min-w-0 items-center gap-1.5">
                            <span class="min-w-0 truncate">{account.label}</span>
                            <PlanBadge show={props.go && account === active()} />
                          </span>
                        </Menu.RadioItem>
                      )}
                    </For>
                  </Menu.RadioGroup>
                </Menu.Group>
                <Menu.Separator />
                <Menu.Item onSelect={props.onAdd}>{language.t("settings.providers.account.add")}</Menu.Item>
                <Menu.Item onSelect={props.onManage}>{language.t("dialog.model.account.manage")}</Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        )}
      </Show>
    </span>
  )
}

function PlanBadge(props: { show: boolean; class?: string }) {
  const language = useLanguage()

  return (
    <Show when={props.show}>
      <Badge class={`shrink-0 ${props.class ?? ""}`}>{language.t("dialog.model.plan.go")}</Badge>
    </Show>
  )
}
