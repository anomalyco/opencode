import { showToast } from "@/shell/notifications/toast"
import { consoleProviderGroup } from "@/providers/catalog/console"
import { useIntegrations } from "@/providers/catalog/integrations"
import { useProviders } from "@/providers/catalog/providers"
import { CONSOLE_INTEGRATION } from "@/providers/connect/controller"
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

  // The server loads a Console workspace's providers after the credential changes, so the first
  // refresh can still show only the free catalog. Poll briefly before reporting the new account.
  // A Zen API key shares the Console integration but has no workspace to wait for.
  const settle = async (integrationID: string) => {
    const account = activeProviderAccount(integrations.list().find((integration) => integration.id === integrationID))

    if (integrationID !== CONSOLE_INTEGRATION || account?.method !== "oauth") return
    const deadline = Date.now() + 10_000

    while (!consoleProviderGroup(providers.connected()) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      data.location.provider.invalidate(location())
      data.location.model.invalidate(location())
      await Promise.all([data.location.provider.sync(location()), data.location.model.sync(location())])
    }
  }

  const fail = (message: string) => showToast({ title: language.t("common.requestFailed"), description: message })

  const activate = (input: { integrationID: string; provider: string; account: ProviderAccount }) =>
    sdk.api.credential
      .activate({ credentialID: input.account.id })
      .then(refresh)
      .then(() => settle(input.integrationID))
      .then(() =>
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.providers.account.switched.title", { provider: input.provider }),
          description: language.t("settings.providers.account.switched.description", { account: input.account.label }),
        }),
      )
      .catch((error) => fail(formatServerError(error, language.t)))

  const remove = (input: { integrationID: string; provider: string; account: ProviderAccount; final: boolean }) =>
    sdk.api.credential
      .remove({ credentialID: input.account.id })
      .then(refresh)
      .then(() => (input.final ? undefined : settle(input.integrationID)))
      .then(() =>
        showToast({
          variant: "success",
          icon: "circle-check",
          title: input.final
            ? language.t("provider.disconnect.toast.disconnected.title", { provider: input.provider })
            : language.t("settings.providers.account.removed.title", { account: input.account.label }),
          description: input.final
            ? language.t("provider.disconnect.toast.disconnected.description", { provider: input.provider })
            : language.t("settings.providers.account.removed.description", { provider: input.provider }),
        }),
      )
      .catch((error) => fail(formatServerError(error, language.t)))

  const rename = (account: ProviderAccount, label: string) =>
    sdk.api.credential
      .update({ credentialID: account.id, label })
      .then(refresh)
      .then(() => true)
      .catch((error) => {
        fail(formatServerError(error, language.t))

        return false
      })

  return { refresh, activate, remove, rename }
}
