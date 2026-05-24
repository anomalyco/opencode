// FORK: 飞书账号编辑弹窗 — 选 per-account model
// [feat: feishu-bridge] 2026-05-09

import { type Component, createMemo, createSignal, onMount, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Select } from "@opencode-ai/ui/select"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import "./feishu-edit-account-dialog.css"
import { useLanguage } from "@/context/language"
import {
  feishuListProviders,
  feishuUpdateAccountSettings,
  type ModelRef,
  type ProvidersResponse,
} from "@/utils/feishu-config"

export const FeishuEditAccountDialog: Component<{
  accountId: string
  currentModel: ModelRef | null | undefined
  /** [feat: feishu-create-group-toggle-gui] 2026-05-24 */
  currentEnableAutoGroupCreate?: boolean
  onSaved?: () => void
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [useDefault, setUseDefault] = createSignal(!props.currentModel)
  const [providerID, setProviderID] = createSignal(props.currentModel?.provider_id ?? "")
  const [modelID, setModelID] = createSignal(props.currentModel?.model_id ?? "")
  // [feat: feishu-create-group-toggle-gui] 2026-05-24
  const [enableGroupCreate, setEnableGroupCreate] = createSignal(
    props.currentEnableAutoGroupCreate ?? false,
  )
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
  const providerOptions = createMemo(() =>
    providers().map((p) => ({ value: p.id, label: p.name || p.id })),
  )
  const modelOptions = createMemo(() =>
    currentProviderModels().map((m) => ({ value: m.id, label: m.name || m.id })),
  )

  // 全局默认 model — opencode config providers 返 { default: { <providerID>: <modelID> } }
  // 飞书桥接 v3 起绑账号默认 agent = "imbot"(setup hook 注入,同 build 能力但收紧危险工具)
  // 注:data.default?.build latent bug — default key 是 provider id 不是 agent name,本字段值实际永远是 undefined
  //     此组件目前不依赖该结果阻塞功能,留 FUTURE 顺手修(同 settings-feishu.tsx 修法)
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
      // [feat: feishu-create-group-toggle-gui] 2026-05-24
      // 一次 partial update 提交 model + flag(只发生变化的字段)
      const modelPayload: ModelRef | null = useDefault()
        ? null
        : { provider_id: providerID(), model_id: modelID() }
      await feishuUpdateAccountSettings(props.accountId, {
        model: modelPayload,
        enableAutoGroupCreate: enableGroupCreate(),
      })
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
    <Dialog
      title={language.t("settings.feishu.edit.title")}
      description={language.t("settings.feishu.edit.description", { account: props.accountId })}
    >
      <div class="flex flex-col gap-6 px-5 pb-5">
        <Show
          when={!loading()}
          fallback={
            <p class="text-14-regular text-text-weak py-4">
              {language.t("settings.feishu.bind.qrLoading")}
            </p>
          }
        >
          <Show when={loadError()}>
            <p class="text-14-regular text-text-warning">
              {language.t("settings.feishu.edit.loadFailed", { msg: loadError() ?? "" })}
            </p>
          </Show>

          <Show when={!loadError() && providers().length === 0}>
            <p class="text-14-regular text-text-warning">
              {language.t("settings.feishu.edit.noProviders")}
            </p>
          </Show>

          <Show when={!loadError() && providers().length > 0}>
            <form
              class="flex flex-col items-start gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                void handleSave()
              }}
            >
              {/* 模型 分隔块标题 [feat: feishu-create-group-toggle-gui] 2026-05-24 */}
              <div class="flex items-center gap-2 self-stretch">
                <span class="text-13-medium text-text-weak">
                  {language.t("settings.feishu.edit.modelSectionTitle")}
                </span>
                <div class="flex-1 h-px bg-border-weak" />
              </div>

              {/* 模式选择 — checkbox + 动态 hint */}
              <div class="flex flex-col gap-1 self-stretch">
                <label class="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={useDefault()}
                    onChange={(e) => setUseDefault(e.currentTarget.checked)}
                  />
                  <span class="text-14-medium">
                    {language.t("settings.feishu.edit.useDefault")}
                  </span>
                </label>
                <p class="text-13-regular text-text-weak pl-6">
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

              {/* provider + model — 始终显示,disabled 时由 Select 自身处理(scoped CSS 保留 bg+border,字灰) */}
              <div class="flex flex-col gap-3 self-stretch">
                <div class="flex flex-col gap-1.5">
                  <span
                    class="text-13-regular"
                    classList={{
                      "text-text-weak": !useDefault(),
                      "text-text-weaker": useDefault(),
                    }}
                  >
                    {language.t("settings.feishu.edit.providerLabel")}
                  </span>
                  <Select
                    class="feishu-edit-select"
                    options={providerOptions()}
                    current={providerOptions().find((o) => o.value === providerID())}
                    value={(o) => o.value}
                    label={(o) => o.label}
                    onSelect={(o) => o && handleProviderChange(o.value)}
                    placeholder={language.t("settings.feishu.edit.providerPlaceholder")}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                    triggerStyle={{ width: "100%" }}
                    disabled={useDefault()}
                  />
                </div>

                <div class="flex flex-col gap-1.5">
                  <span
                    class="text-13-regular"
                    classList={{
                      "text-text-weak": !useDefault() && !!providerID(),
                      "text-text-weaker": useDefault() || !providerID(),
                    }}
                  >
                    {language.t("settings.feishu.edit.modelLabel")}
                  </span>
                  <Select
                    class="feishu-edit-select"
                    options={modelOptions()}
                    current={modelOptions().find((o) => o.value === modelID())}
                    value={(o) => o.value}
                    label={(o) => o.label}
                    onSelect={(o) => o && setModelID(o.value)}
                    placeholder={language.t("settings.feishu.edit.modelPlaceholder")}
                    variant="secondary"
                    size="small"
                    triggerVariant="settings"
                    triggerStyle={{ width: "100%" }}
                    disabled={useDefault() || !providerID()}
                  />
                </div>
              </div>

              {/* 高级能力 分隔块 [feat: feishu-create-group-toggle-gui] 2026-05-24 */}
              <div class="flex items-center gap-2 self-stretch">
                <span class="text-13-medium text-text-weak">
                  {language.t("settings.feishu.edit.advancedSectionTitle")}
                </span>
                <div class="flex-1 h-px bg-border-weak" />
              </div>

              <div class="flex flex-col gap-1 self-stretch">
                <label class="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={enableGroupCreate()}
                    onChange={(e) => setEnableGroupCreate(e.currentTarget.checked)}
                  />
                  <span class="text-14-medium">
                    {language.t("settings.feishu.edit.enableAutoGroupCreate.label")}
                  </span>
                </label>
                <p class="text-13-regular text-text-weak pl-6">
                  {language.t("settings.feishu.edit.enableAutoGroupCreate.hint")}
                </p>
              </div>

              {/* error */}
              <Show when={saveError()}>
                <p class="text-14-regular text-text-warning">{saveError()}</p>
              </Show>

              {/* primary action — 左对齐,跟 dialog-connect-provider 一致 */}
              <Button
                class="w-auto"
                type="submit"
                size="large"
                variant="primary"
                disabled={!canSave()}
              >
                {saving()
                  ? language.t("settings.feishu.edit.saving")
                  : language.t("settings.feishu.edit.save")}
              </Button>
            </form>
          </Show>
        </Show>
      </div>
    </Dialog>
  )
}
