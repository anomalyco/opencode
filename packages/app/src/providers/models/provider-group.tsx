import { Badge } from "@opencode/ui/badge"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { iconNames, type IconName } from "@opencode/ui/icons/provider"
import { Menu } from "@opencode/ui/menu"
import { ProviderIcon } from "@opencode/ui/provider-icon"
import type { JSX } from "solid-js"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { consoleProviderGroup, consoleProviderName } from "@/providers/catalog/console"
import { OpenCodeLogo } from "@/providers/opencode-logo"
import { useLanguage } from "@/runtime/i18n/language"
import customManagedProvider from "@/providers/custom-managed-provider.svg"
import "@/settings/settings.css"

type ModelProvider = { id: string; canonical?: string; name: string }
type ModelItem = { provider: ModelProvider & { integrationID?: string }; cost?: { input: number } }
type ModelGroup<T> = { category: string; items: T[] }

export const CONSOLE_GROUP_KEY = "console:opencode"

export function CustomManagedProviderIcon(props: { class?: string }) {
  return <img data-component="custom-managed-provider-icon" src={customManagedProvider} alt="" class={props.class} />
}

export function ProviderModelIcon(props: { provider: ModelProvider; class?: string }) {
  const icon = () =>
    [
      props.provider.canonical,
      props.provider.canonical?.replace(/-token-plan$/, ""),
      props.provider.id.replace(/^console-/, ""),
    ].find((id): id is IconName => !!id && id !== "synthetic" && iconNames.includes(id as IconName))

  return (
    <Switch>
      <Match when={props.provider.id === "opencode"}>
        <OpenCodeLogo class={`size-4 ${props.class ?? ""}`} />
      </Match>
      <Match when={icon()} keyed>
        {(id) => <ProviderIcon id={id} width={16} height={16} class={props.class} />}
      </Match>
      <Match when={true}>
        <CustomManagedProviderIcon class={`size-4 ${props.class ?? ""}`} />
      </Match>
    </Switch>
  )
}

/** Detects the Console workspace from every listed model, so a search that hides some providers keeps the group. */
export function consoleModelGroup<T extends ModelItem>(items: readonly T[]) {
  return consoleProviderGroup([...new Map(items.map((item) => [item.provider.id, item.provider])).values()])
}

/** Provider sections for a model list, with Console workspace providers nested under one OpenCode Console section. */
export function ProviderModelSections<T extends ModelItem>(props: {
  groups: ModelGroup<T>[]
  managed: ReturnType<typeof consoleModelGroup<T>>
  expanded: (key: string) => boolean
  disabled: boolean
  onExpandedChange: (key: string, expanded: boolean) => void
  rows: (items: T[]) => JSX.Element
  /** Trailing control in a direct provider's header. */
  action?: (group: ModelGroup<T>) => JSX.Element
  onSetVisibility?: (providerID: string, visible: boolean) => void
  ref?: (providerID: string, element: HTMLElement) => void
}) {
  type Section = {
    group?: ModelGroup<T>
    managed?: { group: NonNullable<ReturnType<typeof consoleModelGroup<T>>>; providers: ModelGroup<T>[] }
  }
  const language = useLanguage()
  const sections = createMemo<Section[]>(() => {
    const managed = props.managed
    const ids = new Set(managed?.providers.map((provider) => provider.id))
    const nested = props.groups.filter((group) => ids.has(group.category))
    if (!managed || nested.length === 0) return props.groups.map((group) => ({ group }))
    const first = props.groups.findIndex((group) => ids.has(group.category))
    return props.groups.flatMap<Section>((group, index) => {
      if (!ids.has(group.category)) return [{ group }]
      if (index !== first) return []
      return [{ managed: { group: managed, providers: nested } }]
    })
  })
  // Only the keyless catalog is free; a Zen key or Console account keeps the provider's own name.
  const name = (group: ModelGroup<T>) =>
    group.category === "opencode" && group.items.every((item) => !item.cost?.input)
      ? language.t("provider.connect.opencode.freeName")
      : group.items[0].provider.name

  function Header(input: { id: string; icon: JSX.Element; title: JSX.Element; badge?: string; action?: JSX.Element }) {
    return (
      <h3 class="settings-models-group-header" classList={{ "justify-between": !!input.action }}>
        <button
          type="button"
          class="settings-models-group-trigger"
          aria-expanded={props.expanded(input.id)}
          disabled={props.disabled}
          onClick={() => props.onExpandedChange(input.id, !props.expanded(input.id))}
        >
          <span class="settings-models-group-chevron">
            <Icon name="chevron-down" size="small" classList={{ collapsed: !props.expanded(input.id) }} />
          </span>
          <span class="settings-models-group-label">
            {input.icon}
            <bdi class="settings-models-group-title">{input.title}</bdi>
            <Show when={input.badge}>{(badge) => <Badge>{badge()}</Badge>}</Show>
          </span>
        </button>
        {input.action}
      </h3>
    )
  }

  return (
    <For each={sections()}>
      {(section) => (
        <Show
          when={section.managed}
          fallback={
            <Show when={section.group}>
              {(group) => (
                <section
                  ref={(element) => props.ref?.(group().category, element)}
                  class="settings-section"
                  data-component="settings-models-provider"
                  data-expanded={props.expanded(group().category) ? "" : undefined}
                >
                  <Header
                    id={group().category}
                    icon={<ProviderModelIcon provider={group().items[0].provider} class="shrink-0" />}
                    title={name(group())}
                    action={props.action?.(group())}
                  />
                  <Show when={props.expanded(group().category)}>{props.rows(group().items)}</Show>
                </section>
              )}
            </Show>
          }
        >
          {(managed) => (
            <section
              class="settings-section"
              data-component="settings-models-console"
              data-expanded={props.expanded(CONSOLE_GROUP_KEY) ? "" : undefined}
            >
              <Header
                id={CONSOLE_GROUP_KEY}
                icon={<OpenCodeLogo class="size-4 shrink-0" />}
                title={language.t("provider.connect.opencode.name")}
                badge={managed().group.workspace}
              />
              <Show when={props.expanded(CONSOLE_GROUP_KEY)}>
                <div class="provider-model-groups settings-models-console-groups">
                  <For each={managed().providers}>
                    {(group) => (
                      <ProviderModelGroup
                        ref={(element) => props.ref?.(group.category, element)}
                        provider={group.items[0].provider}
                        name={consoleProviderName(managed().group, group.items[0].provider.name)}
                        expanded={props.expanded(group.category)}
                        disabled={props.disabled}
                        onSetVisibility={
                          props.onSetVisibility
                            ? (visible) => props.onSetVisibility?.(group.category, visible)
                            : undefined
                        }
                        onExpandedChange={(value) => props.onExpandedChange(group.category, value)}
                      >
                        {props.rows(group.items)}
                      </ProviderModelGroup>
                    )}
                  </For>
                </div>
              </Show>
            </section>
          )}
        </Show>
      )}
    </For>
  )
}

export function ProviderModelGroup(props: {
  provider: ModelProvider
  name?: string
  expanded: boolean
  disabled?: boolean
  onSetVisibility?: (visible: boolean) => void
  children: JSX.Element
  ref?: (element: HTMLElement) => void
  onExpandedChange: (expanded: boolean) => void
}) {
  const language = useLanguage()
  return (
    <section
      ref={props.ref}
      class="provider-model-group"
      data-component="provider-model-group"
      data-provider={props.provider.id}
      data-expanded={props.expanded ? "" : undefined}
    >
      <h3 class="provider-model-group-header">
        <button
          type="button"
          class="provider-model-group-trigger"
          aria-expanded={props.expanded}
          disabled={props.disabled}
          onClick={() => props.onExpandedChange(!props.expanded)}
        >
          <span class="provider-model-group-label">
            <ProviderModelIcon provider={props.provider} class="shrink-0" />
            <bdi class="provider-model-group-title">{props.name ?? props.provider.name}</bdi>
            <Icon
              name="chevron-down"
              size="small"
              classList={{ "provider-model-group-chevron": true, collapsed: !props.expanded }}
            />
          </span>
        </button>
        <Show when={props.onSetVisibility} keyed>
          {(setVisibility) => (
            <div class="provider-model-group-actions">
              <Menu gutter={4} modal={false} placement="bottom-end">
                <Menu.Trigger
                  as={IconButton}
                  variant="ghost-muted"
                  size="small"
                  icon={<Icon name="outline-dots" />}
                  aria-label={language.t("common.moreOptions")}
                />
                <Menu.Portal>
                  <Menu.Content>
                    <Menu.Item onSelect={() => setVisibility(true)}>{language.t("settings.models.enableAll")}</Menu.Item>
                    <Menu.Item onSelect={() => setVisibility(false)}>
                      {language.t("settings.models.disableAll")}
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu>
            </div>
          )}
        </Show>
      </h3>
      <Show when={props.expanded}>
        <div class="provider-model-group-models">{props.children}</div>
      </Show>
    </section>
  )
}
