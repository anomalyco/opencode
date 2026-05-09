// FORK: 飞书账号编辑弹窗 — 选 per-account model
// [feat: feishu-bridge] 2026-05-09

import { type Component, createSignal, For, onMount, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
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

  // ⚠️ 用 createSignal + 手动 fetch(避开 createResource 触发外层 Suspense fallback 导致整屏闪)
  // 同 file-tabs.tsx:1179 / settings-feishu.tsx 处理方式
  const [providersData, setProvidersData] = createSignal<ProvidersResponse | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [loadError, setLoadError] = createSignal<string | null>(null)

  onMount(async () => {
    try {
      const data = await feishuListProviders()
      setProvidersData(data)
    } catch (err) {
      setLoadError((err as Error).message ?? String(err))
    } finally {
      setLoading(false)
    }
  })

  const providers = () => providersData()?.providers ?? []
  const currentProvider = () => providers().find((p) => p.id === providerID())
  const currentProviderModels = () => {
    const p = currentProvider()
    if (!p) return []
    return Object.values(p.models)
  }

  // 全局默认 model — opencode config providers 返 { default: { build: "providerID/modelID" } }
  // 取 build agent 的 default(飞书 plugin 固定用 build agent)
  const defaultModelLabel = () => {
    const data = providersData()
    if (!data) return ""
    const buildDefault = data.default?.build
    if (!buildDefault) return language.t("settings.feishu.edit.defaultUnset")
    return buildDefault
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

  const canSave = () => !saving() && (useDefault() || (!!providerID() && !!modelID()))

  return (
    <Dialog title={language.t("settings.feishu.edit.title")}>
      <div class="flex flex-col gap-4 p-4 min-w-md max-w-lg">
        <Show
          when={!loading()}
          fallback={
            <p class="text-13-regular text-text-weak text-center py-8">
              {language.t("settings.feishu.bind.qrLoading")}
            </p>
          }
        >
          <Show when={loadError()}>
            <p class="text-13-regular text-text-warning">
              {language.t("settings.feishu.edit.loadFailed", { msg: loadError() ?? "" })}
            </p>
          </Show>

          <Show when={!loadError() && providers().length === 0}>
            <p class="text-13-regular text-text-warning">
              {language.t("settings.feishu.edit.noProviders")}
            </p>
          </Show>

          <Show when={!loadError() && providers().length > 0}>
            {/* 模式选择 — checkbox + 动态 hint */}
            <div class="flex flex-col gap-1">
              <label class="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useDefault()}
                  onChange={(e) => setUseDefault(e.currentTarget.checked)}
                />
                <span class="text-13-medium">
                  {language.t("settings.feishu.edit.useDefault")}
                </span>
              </label>
              <p class="text-12-regular text-text-weak pl-6">
                <Show
                  when={useDefault()}
                  fallback={language.t("settings.feishu.edit.useDefault.hintCustom")}
                >
                  {language.t("settings.feishu.edit.useDefault.hintFollow", {
                    model: defaultModelLabel(),
                  })}
                </Show>
              </p>
            </div>

            {/* provider + model — 始终显示,useDefault=true 时整体 disabled */}
            <fieldset
              class="flex flex-col gap-2.5 transition-opacity"
              classList={{ "opacity-50": useDefault() }}
              disabled={useDefault()}
            >
              <label class="flex flex-col gap-1">
                <span class="text-12-regular text-text-weak">
                  {language.t("settings.feishu.edit.providerLabel")}
                </span>
                <select
                  class="px-3 py-1.5 rounded-md text-13-regular bg-surface-base border border-surface-strong disabled:cursor-not-allowed"
                  value={providerID()}
                  onChange={(e) => handleProviderChange(e.currentTarget.value)}
                >
                  <option value="">{language.t("settings.feishu.edit.providerPlaceholder")}</option>
                  <For each={providers()}>
                    {(p) => <option value={p.id}>{p.name || p.id}</option>}
                  </For>
                </select>
              </label>

              <label class="flex flex-col gap-1">
                <span class="text-12-regular text-text-weak">
                  {language.t("settings.feishu.edit.modelLabel")}
                </span>
                <select
                  class="px-3 py-1.5 rounded-md text-13-regular bg-surface-base border border-surface-strong disabled:cursor-not-allowed"
                  value={modelID()}
                  onChange={(e) => setModelID(e.currentTarget.value)}
                  disabled={!providerID()}
                >
                  <option value="">{language.t("settings.feishu.edit.modelPlaceholder")}</option>
                  <For each={currentProviderModels()}>
                    {(m) => <option value={m.id}>{m.name || m.id}</option>}
                  </For>
                </select>
              </label>
            </fieldset>

            {/* error */}
            <Show when={saveError()}>
              <p class="text-13-regular text-text-warning">{saveError()}</p>
            </Show>

            {/* actions — primary 保存(强对比)+ ghost 取消(弱) */}
            <div class="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => dialog.close()} disabled={saving()}>
                {language.t("settings.feishu.edit.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleSave()}
                disabled={!canSave()}
              >
                {language.t("settings.feishu.edit.save")}
              </Button>
            </div>
          </Show>
        </Show>
      </div>
    </Dialog>
  )
}
