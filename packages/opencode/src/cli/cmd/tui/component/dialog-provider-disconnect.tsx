import { createMemo, createSignal } from "solid-js"
import { useProject } from "@tui/context/project"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { isConsoleManagedProvider } from "@tui/util/provider-origin"

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message
  return JSON.stringify(error)
}

export function DialogProviderDisconnect() {
  const sdk = useSDK()
  const sync = useSync()
  const project = useProject()
  const toast = useToast()
  const { theme } = useTheme()
  const [pending, setPending] = createSignal<string>()

  const options = createMemo(() => {
    if (sync.data.provider_next.connected.length === 0) {
      return [
        {
          title: "No connected providers",
          value: "",
          description: "Use /connect to add a provider",
          disabled: true,
        } satisfies DialogSelectOption<string>,
      ]
    }

    return sync.data.provider_next.connected.map((providerID) => {
      const provider =
        sync.data.provider_next.all.find((item) => item.id === providerID) ??
        sync.data.provider.find((item) => item.id === providerID)
      const consoleManaged = isConsoleManagedProvider(sync.data.console_state.consoleManagedProviders, providerID)
      const source = provider?.source ?? "api"
      const disabled = pending() !== undefined || consoleManaged

      return {
        title:
          pending() === providerID ? `Disconnecting ${provider?.name ?? providerID}` : (provider?.name ?? providerID),
        value: providerID,
        description: consoleManaged
          ? "Managed by OpenCode Console"
          : source === "api"
            ? "API key"
            : {
                config: "Configured provider",
                custom: "Custom provider",
                env: "Environment credentials",
              }[source],
        footer: consoleManaged
          ? `Managed by ${sync.data.console_state.activeOrgName ?? "OpenCode Console"}`
          : providerID,
        disabled,
        gutter: () => <text fg={disabled ? theme.textMuted : theme.error}>x</text>,
        async onSelect(dialog) {
          if (disabled) return
          setPending(providerID)
          const result = await sdk.client.auth.remove({ providerID }).catch((error: unknown) => ({ error }))
          if (result.error) {
            toast.show({
              variant: "error",
              message: errorMessage(result.error),
            })
            setPending(undefined)
            return
          }

          if (source !== "api") {
            const disabledProviders = sync.data.config.disabled_providers ?? []
            const update = await sdk.client.config
              .update({
                workspace: project.workspace.current(),
                config: {
                  ...sync.data.config,
                  disabled_providers: disabledProviders.includes(providerID)
                    ? disabledProviders
                    : [...disabledProviders, providerID],
                },
              })
              .catch((error: unknown) => ({ error }))
            if (update.error) {
              toast.show({
                variant: "error",
                message: errorMessage(update.error),
              })
              setPending(undefined)
              return
            }
          }

          await sdk.client.instance.dispose().catch((error) =>
            toast.show({
              variant: "warning",
              message: `Disconnected, but refresh failed: ${errorMessage(error)}`,
            }),
          )
          await sync.bootstrap({ fatal: false }).catch((error) =>
            toast.show({
              variant: "warning",
              message: `Disconnected, but refresh failed: ${errorMessage(error)}`,
            }),
          )
          toast.show({
            variant: "info",
            message: `${provider?.name ?? providerID} disconnected`,
          })
          setPending(undefined)
        },
      } satisfies DialogSelectOption<string>
    })
  })

  return <DialogSelect title="Disconnect provider" options={options()} />
}
