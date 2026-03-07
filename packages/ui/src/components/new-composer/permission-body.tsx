import { For, Show } from "solid-js"
import { useI18n } from "../../context/i18n"
import { Icon } from "../icon"

interface Props {
  tool?: string
  description?: string
  patterns?: string[]
}

export function PermissionBody(props: Props) {
  const i18n = useI18n()
  const hint = () => props.description ?? props.tool ?? ""

  return (
    <>
      <div data-slot="permission-row" data-variant="header">
        <span data-slot="permission-icon">
          <Icon name="warning" size="normal" />
        </span>
        <div data-slot="permission-header-title">{i18n.t("ui.permission.title")}</div>
      </div>
      <Show when={hint()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-hint">{hint()}</div>
        </div>
      </Show>
      <Show when={(props.patterns?.length ?? 0) > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.patterns}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>
    </>
  )
}
