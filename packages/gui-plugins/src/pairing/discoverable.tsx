import { createSignal, onCleanup, Show } from "solid-js"
import { createKeyed, usePlugin, type IpcClient } from "@opencode/plugin/gui"
import type { Pairing } from "./contract"
import type definition from "./index"

/**
 * Settings › Pairing › Discoverable nearby. Main answers null while the `nearby_pairing` flag is off, and then the row
 * does not show. Each provider generation reads the setting again.
 */
export default function DiscoverableRow(props: { client: IpcClient<typeof Pairing.spec> | undefined }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui

  const [state, setState] = createSignal<{ value: boolean | null; busy: boolean; error: boolean }>({
    value: null,
    busy: false,
    error: false,
  })

  createKeyed(
    () => props.client,
    (client) => {
      const controller = new AbortController()

      void client.discoverable({ signal: controller.signal }).then(
        (value) => setState({ value, busy: false, error: false }),
        () => undefined,
      )

      onCleanup(() => controller.abort())
    },
  )

  const change = (enabled: boolean) => {
    const client = props.client

    if (!client) return
    setState((current) => ({ ...current, value: enabled, busy: true, error: false }))
    void client.setDiscoverable(enabled).then(
      () => setState((current) => ({ ...current, busy: false })),
      () => setState({ value: !enabled, busy: false, error: true }),
    )
  }

  return (
    <Show when={state().value !== null}>
      <ui.SettingsRow
        id="settings-discoverable"
        title={ctx.t("discoverable.title")}
        description={state().error ? ctx.t("discoverable.error") : ctx.t("discoverable.description")}
      >
        <ui.Switch
          label={ctx.t("discoverable.title")}
          hideLabel
          checked={state().value === true}
          disabled={state().busy}
          onChange={change}
        />
      </ui.SettingsRow>
    </Show>
  )
}
