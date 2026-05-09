// FORK: 飞书账号编辑弹窗 — 选 per-account model
// [feat: feishu-bridge] 2026-05-09

import { type Component, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import {
  feishuListProviders,
  feishuUpdateAccountModel,
  type ModelRef,
  type ProvidersResponse,
} from "@/utils/feishu-config"

export const FeishuEditAccountDialog: Component<{
  accountId: string
  currentModel: ModelRef | null | undefined
  onSaved?: () => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [useDefault, setUseDefault] = createSignal(!props.currentModel)
  const [providerID, setProviderID] = createSignal(props.currentModel?.provider_id ?? "")
  const [modelID, setModelID] = createSignal(props.currentModel?.model_id ?? "")
  const [saving, setSaving] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string | null>(null)

  const [providersData] = createResource<ProvidersResponse>(async () => {
    return await feishuListProviders()
  })

  const providers = () => providersData()?.providers ?? []
  const currentProvider = () => providers().find((p) => p.id === providerID())
  const currentProviderModels = () => {
    const p = currentProvider()
    if (!p) return []
    return Object.values(p.models)
  }

  const handleProviderChange = (newId: string) => {
    setProviderID(newId)
    // 选 provider 后默认选第一个 model
    const p = providers().find((pp) => pp.id === newId)
    if (p) {
      const firstModel = Object.values(p.models)[0]
      setModelID(firstModel?.id ?? "")
    } else {
      setModelID("")
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const payload: ModelRef | null = useDefault()
        ? null
        : { provider_id: providerID(), model_id: modelID() }
      await feishuUpdateAccountModel(props.accountId, payload)
      props.onSaved?.()
      dialog.close()
    } catch (err) {
      setSaveError((err as Error).message ?? String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title={language.t("settings.feishu.edit.title")}>
      <div class="flex flex-col gap-4 p-4 min-w-md max-w-lg">
        <Switch>
          <Match when={providersData.loading}>
            <p class="text-13-regular text-text-weak text-center py-6">
              {language.t("settings.feishu.bind.qrLoading")}
            </p>
          </Match>
          <Match when={providersData.error}>
            <p class="text-13-regular text-text-warning">
              {language.t("settings.feishu.edit.loadFailed", {
                msg: (providersData.error as Error)?.message ?? String(providersData.error),
              })}
            </p>
          </Match>
          <Match when={providers().length === 0}>
            <p class="text-13-regular text-text-warning">
              {language.t("settings.feishu.edit.noProviders")}
            </p>
          </Match>
          <Match when={true}>
            {/* "跟随默认" 选项 */}
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useDefault()}
                onChange={(e) => setUseDefault(e.currentTarget.checked)}
              />
              <span class="text-13-regular">
                {language.t("settings.feishu.edit.useDefault")}
              </span>
            </label>

            {/* provider + model 下拉(useDefault=false 时启用)*/}
            <Show when={!useDefault()}>
              <div class="flex flex-col gap-3">
                <label class="flex flex-col gap-1.5">
                  <span class="text-12-regular text-text-weak">
                    {language.t("settings.feishu.edit.providerLabel")}
                  </span>
                  <select
                    class="px-3 py-1.5 rounded-md text-13-regular bg-surface-base border border-surface-strong"
                    value={providerID()}
                    onChange={(e) => handleProviderChange(e.currentTarget.value)}
                  >
                    <option value="">— —</option>
                    <For each={providers()}>
                      {(p) => <option value={p.id}>{p.name || p.id}</option>}
                    </For>
                  </select>
                </label>

                <label class="flex flex-col gap-1.5">
                  <span class="text-12-regular text-text-weak">
                    {language.t("settings.feishu.edit.modelLabel")}
                  </span>
                  <select
                    class="px-3 py-1.5 rounded-md text-13-regular bg-surface-base border border-surface-strong disabled:opacity-50"
                    value={modelID()}
                    onChange={(e) => setModelID(e.currentTarget.value)}
                    disabled={!providerID()}
                  >
                    <option value="">— —</option>
                    <For each={currentProviderModels()}>
                      {(m) => <option value={m.id}>{m.name || m.id}</option>}
                    </For>
                  </select>
                </label>
              </div>
            </Show>

            {/* error */}
            <Show when={saveError()}>
              <p class="text-13-regular text-text-warning">{saveError()}</p>
            </Show>

            {/* actions */}
            <div class="flex justify-end gap-2 mt-2">
              <button
                type="button"
                class="px-3 py-1.5 rounded-md text-13-medium bg-surface-base hover:bg-surface-strong"
                onClick={() => dialog.close()}
                disabled={saving()}
              >
                {language.t("settings.feishu.edit.cancel")}
              </button>
              <button
                type="button"
                class="px-3 py-1.5 rounded-md text-13-medium bg-surface-strong hover:bg-surface-stronger disabled:opacity-50"
                onClick={() => void handleSave()}
                disabled={saving() || (!useDefault() && (!providerID() || !modelID()))}
              >
                {language.t("settings.feishu.edit.save")}
              </button>
            </div>
          </Match>
        </Switch>
      </div>
    </Dialog>
  )
}
