import { Icon } from "@opencode/ui/icon"
import { iconNames, type IconName } from "@opencode/ui/icons/provider"
import { ProviderIcon } from "@opencode/ui/provider-icon"
import type { JSX } from "solid-js"
import { Show } from "solid-js"
import { OpenCodeLogo } from "@/providers/opencode-logo"
import "@/settings/settings.css"

type ModelProvider = { id: string; canonical?: string; name: string }

export function ProviderModelIcon(props: { provider: ModelProvider; class?: string }) {
  const icon = () =>
    [
      props.provider.canonical,
      props.provider.canonical?.replace(/-token-plan$/, ""),
      props.provider.id.replace(/^console-/, ""),
    ].find((id): id is IconName => !!id && iconNames.includes(id as IconName)) ?? props.provider.id

  return (
    <Show
      when={props.provider.id === "opencode"}
      fallback={<ProviderIcon id={icon()} width={16} height={16} class={props.class} />}
    >
      <OpenCodeLogo class={`size-4 ${props.class ?? ""}`} />
    </Show>
  )
}

export function ProviderModelGroup(props: {
  provider: ModelProvider
  name?: string
  expanded: boolean
  disabled?: boolean
  detail?: JSX.Element
  children: JSX.Element
  ref?: (element: HTMLElement) => void
  onExpandedChange: (expanded: boolean) => void
}) {
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
          <Show when={props.detail}>
            <span class="provider-model-group-detail">{props.detail}</span>
          </Show>
        </button>
      </h3>
      <Show when={props.expanded}>
        <div class="provider-model-group-models">{props.children}</div>
      </Show>
    </section>
  )
}
