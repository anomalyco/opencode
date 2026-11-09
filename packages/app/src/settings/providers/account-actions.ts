import { showToast } from "@/shell/notifications/toast"
import { consoleCatalogLoaded } from "@/providers/catalog/console"
import { createConsoleCatalogSettler } from "@/providers/catalog/console-settle"
import { useIntegrations } from "@/providers/catalog/integrations"
import { useProviders } from "@/providers/catalog/providers"
import { CONSOLE_INTEGRATION } from "@/providers/connect/dialog-machine"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { formatServerError } from "@/runtime/server/errors"
import { activeProviderAccount, type ProviderAccount } from "./accounts"

// Shared by the connect dialog and Settings so both switch, rename and remove accounts the same way.
export function useProviderAccountActions(directory: () => string | undefined) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const data = useData()
  const providers = useProviders(directory)
  const integrations = useIntegrations(directory)

  const location = () => {
    const value = directory()

    return value ? { directory: value } : undefined
  }

  const refresh = async () => {
    const ref = location()
    data.location.integration.invalidate(ref)
    data.location.provider.invalidate(ref)
    data.location.model.invalidate(ref)
    await Promise.all([
      data.location.integration.sync(ref),
      data.location.provider.sync(ref),
      data.location.model.sync(ref),
    ])
  }

  // Stops polling when the caller (Settings or the connect dialog) goes away.
  const settler = createConsoleCatalogSettler({
    isLoaded: () => consoleCatalogLoaded(providers.connected()),
    sync: () => {
      const ref = location()
      data.location.provider.invalidate(ref)
      data.location.model.invalidate(ref)

      return Promise.all([data.location.provider.sync(ref), data.location.model.sync(ref)]).then(() => undefined)
    },
  })

  // The server already changed the credential, so a failed catalog read only delays the new account's catalog; it
  // does not undo the change. A Zen API key shares the Console integration but has no workspace to wait for.
  const settle = async (integrationID: string, wait: boolean) => {
    await refresh().catch(() => undefined)

    if (!wait || integrationID !== CONSOLE_INTEGRATION) return true
    const account = activeProviderAccount(integrations.list().find((integration) => integration.id === integrationID))

    if (account?.method !== "oauth") return true

    return (await settler.settle()) !== "cancelled"
  }

  const fail = (message: string) => showToast({ title: language.t("common.requestFailed"), description: message })

  const activate = (input: { integrationID: string; provider: string; account: ProviderAccount }) =>
    sdk.api.credential.activate({ credentialID: input.account.id }).then(
      async () => {
        if (!(await settle(input.integrationID, true))) return
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.providers.account.switched.title", { provider: input.provider }),
          description: language.t("settings.providers.account.switched.description", { account: input.account.label }),
        })
      },
      (error) => fail(formatServerError(error, language.t)),
    )

  const remove = (input: { integrationID: string; provider: string; account: ProviderAccount; final: boolean }) =>
    sdk.api.credential.remove({ credentialID: input.account.id }).then(
      async () => {
        if (!(await settle(input.integrationID, !input.final))) return
        showToast({
          variant: "success",
          icon: "circle-check",
          title: input.final
            ? language.t("provider.disconnect.toast.disconnected.title", { provider: input.provider })
            : language.t("settings.providers.account.removed.title", { account: input.account.label }),
          description: input.final
            ? language.t("provider.disconnect.toast.disconnected.description", { provider: input.provider })
            : language.t("settings.providers.account.removed.description", { provider: input.provider }),
        })
      },
      (error) => fail(formatServerError(error, language.t)),
    )

  const rename = (account: ProviderAccount, label: string) =>
    sdk.api.credential.update({ credentialID: account.id, label }).then(
      () =>
        refresh()
          .catch(() => undefined)
          .then(() => true),
      (error) => {
        fail(formatServerError(error, language.t))

        return false
      },
    )

  return { refresh, activate, remove, rename }
}
