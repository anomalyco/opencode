import { type Component, createResource, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"
import { SettingsList } from "./settings-list"

type PairResult = { enabled: false } | { enabled: true; hosts: string[]; link: string; qr: string }

export const SettingsPair: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()

  const [data] = createResource(async () => {
    const f = platform.fetch ?? fetch
    const res = await f(`${globalSDK.url}/experimental/push/pair`)
    if (!res.ok) return { enabled: false as const }
    return (await res.json()) as PairResult
  })

  return (
    <div class="flex flex-col gap-6 py-4 px-5">
      <div class="flex flex-col gap-1">
        <h2 class="text-16-semibold text-text-strong">{language.t("settings.pair.title")}</h2>
        <p class="text-13-regular text-text-weak">{language.t("settings.pair.description")}</p>
      </div>

      <Show when={data.loading}>
        <SettingsList>
          <div class="flex items-center justify-center py-12">
            <span class="text-14-regular text-text-weak">{language.t("settings.pair.loading")}</span>
          </div>
        </SettingsList>
      </Show>

      <Show when={data.error}>
        <SettingsList>
          <div class="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <Icon name="warning" size="large" />
            <div class="flex flex-col gap-1">
              <span class="text-14-medium text-text-strong">{language.t("settings.pair.error.title")}</span>
              <span class="text-13-regular text-text-weak max-w-md">
                {language.t("settings.pair.error.description")}
              </span>
            </div>
          </div>
        </SettingsList>
      </Show>

      <Show when={!data.loading && !data.error && data()}>
        {(result) => (
          <Show
            when={result().enabled && result()}
            fallback={
              <SettingsList>
                <div class="flex flex-col items-center justify-center py-12 gap-3 text-center">
                  <Icon name="link" size="large" />
                  <div class="flex flex-col gap-1">
                    <span class="text-14-medium text-text-strong">{language.t("settings.pair.disabled.title")}</span>
                    <span class="text-13-regular text-text-weak max-w-md">
                      {language.t("settings.pair.disabled.description")}
                    </span>
                  </div>
                  <code class="text-12-regular text-text-weak bg-surface-inset px-3 py-1.5 rounded mt-1">
                    opencode serve --relay-url &lt;url&gt; --relay-secret &lt;secret&gt;
                  </code>
                </div>
              </SettingsList>
            }
          >
            {(pair) => (
              <SettingsList>
                <div class="flex flex-col items-center py-8 gap-4">
                  <img src={(pair() as PairResult & { enabled: true }).qr} alt="Pairing QR code" class="w-64 h-64" />
                  <div class="flex flex-col gap-1 text-center max-w-sm">
                    <span class="text-14-medium text-text-strong">
                      {language.t("settings.pair.instructions.title")}
                    </span>
                    <span class="text-13-regular text-text-weak">
                      {language.t("settings.pair.instructions.description")}
                    </span>
                  </div>
                </div>
              </SettingsList>
            )}
          </Show>
        )}
      </Show>
    </div>
  )
}
