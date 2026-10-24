import type { ServerApi } from "@/runtime/server/api"
import type { validateCustomProvider } from "./form"

type CustomProvider = NonNullable<ReturnType<typeof validateCustomProvider>["result"]>

/**
 * Persists a custom OpenAI-compatible provider: its definition goes to the global config document and
 * its API key becomes the provider integration's credential, never config file content.
 *
 * The credential is stored first because the integration only exists once the server reloads the
 * config. A rejected config write removes it again so a retry starts from a clean state.
 */
export async function saveCustomProvider(api: ServerApi, provider: CustomProvider) {
  const credential = provider.key
    ? await api.credential.create({
        integrationID: provider.providerID,
        label: provider.name,
        value: { type: "key", key: provider.key },
      })
    : undefined

  await api.config.update({ providers: { [provider.providerID]: provider.config } }).catch(async (error: unknown) => {
    if (credential) await api.credential.remove({ credentialID: credential.id }).catch(() => undefined)

    throw error
  })
}
