import { Button } from "@opencode-ai/ui/button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Tag } from "@opencode-ai/ui/tag"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useLicense } from "@/context/license"

export function LicensePanel(props: { mode: "settings" | "gate" }) {
  const language = useLanguage()
  const license = useLicense()
  const [form, setForm] = createStore({
    value: "",
    error: undefined as string | undefined,
    saving: false,
    refreshing: false,
  })

  const status = createMemo(() => license.phase())
  const locked = createMemo(() => props.mode === "gate")
  const hasLicense = createMemo(() => !!license.maskedKey || !!license.plan || status() !== "missing")

  const detail = createMemo(() => {
    if (status() === "active") return language.t("settings.pricing.state.active")
    if (status() === "grace") return language.t("settings.pricing.state.grace")
    if (status() === "invalid") return language.t("settings.pricing.state.invalid")
    if (status() === "expired") return language.t("settings.pricing.state.expired")
    if (status() === "checking") return language.t("settings.pricing.state.checking")
    return language.t("settings.pricing.state.missing")
  })

  const label = createMemo(() => {
    if (status() === "active") return language.t("settings.pricing.status.active")
    if (status() === "grace") return language.t("settings.pricing.status.grace")
    if (status() === "invalid") return language.t("settings.pricing.status.invalid")
    if (status() === "expired") return language.t("settings.pricing.status.expired")
    if (status() === "checking") return language.t("settings.pricing.status.checking")
    return language.t("settings.pricing.status.missing")
  })

  const tone = createMemo(() => {
    if (status() === "active") return "bg-surface-success-base text-text-success-base"
    if (status() === "grace") return "bg-surface-warning-base text-text-warning-base"
    if (status() === "checking") return "bg-surface-secondary-base text-text-strong"
    return "bg-surface-critical-base text-text-critical-base"
  })

  const format = (value?: string) => {
    if (!value) return "-"
    const time = new Date(value)
    if (Number.isNaN(time.getTime())) return "-"
    return time.toLocaleString()
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (form.saving) return
    if (!form.value.trim()) {
      setForm("error", language.t("settings.pricing.form.key.required"))
      return
    }

    setForm("saving", true)
    setForm("error", undefined)

    const result = await license.activate(form.value)
    if (result.ok) {
      setForm("value", "")
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.pricing.toast.activated.title"),
        description: language.t("settings.pricing.toast.activated.description"),
      })
    }
    if (!result.ok) {
      setForm("error", result.message ?? language.t("settings.pricing.error.generic"))
    }

    setForm("saving", false)
  }

  const refresh = async () => {
    if (form.refreshing) return
    setForm("refreshing", true)
    const result = await license.refresh()
    if (result.ok) {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.pricing.toast.refreshed.title"),
        description: language.t("settings.pricing.toast.refreshed.description"),
      })
    }
    if (!result.ok) {
      showToast({
        title: language.t("common.requestFailed"),
        description: result.message ?? language.t("settings.pricing.error.generic"),
      })
    }
    setForm("refreshing", false)
  }

  const clear = () => {
    license.clear()
    setForm("value", "")
    setForm("error", undefined)
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("settings.pricing.toast.removed.title"),
      description: language.t("settings.pricing.toast.removed.description"),
    })
  }

  return (
    <div class="flex flex-col gap-6" data-component={locked() ? "license-gate-panel" : "license-settings-panel"}>
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-3 flex-wrap">
          <span class="text-16-medium text-text-strong">
            {locked() ? language.t("license.gate.title") : language.t("settings.pricing.title")}
          </span>
          <Tag class={tone()}>{label()}</Tag>
        </div>
        <span class="text-14-regular text-text-weak">
          {locked() ? language.t("license.gate.description") : language.t("settings.pricing.description")}
        </span>
      </div>

      <div class="rounded-lg bg-surface-raised-base px-4 py-4">
        <div class="flex flex-col gap-3">
          <div class="flex items-start justify-between gap-3">
            <div class="flex flex-col gap-1 min-w-0">
              <span class="text-14-medium text-text-strong">{language.t("settings.pricing.status.title")}</span>
              <span class="text-12-regular text-text-weak">{detail()}</span>
            </div>
            <Show when={license.busy()}>
              <Spinner />
            </Show>
          </div>

          <Show when={license.message()}>
            <div class="rounded-md bg-surface-base px-3 py-2 text-12-regular text-text-weak">{license.message()}</div>
          </Show>

          <div class="grid gap-3 sm:grid-cols-2">
            <MetaRow label={language.t("settings.pricing.row.license.title")} value={license.maskedKey ?? "-"} />
            <MetaRow label={language.t("settings.pricing.row.plan.title")} value={license.plan ?? "-"} />
            <MetaRow label={language.t("settings.pricing.row.validated.title")} value={format(license.lastValidatedAt)} />
            <MetaRow label={language.t("settings.pricing.row.expires.title")} value={format(license.expiresAt)} />
            <MetaRow label={language.t("settings.pricing.row.grace.title")} value={format(license.graceUntil)} />
          </div>
        </div>
      </div>

      <form class="flex flex-col gap-4" onSubmit={submit}>
        <TextField
          data-action={locked() ? "license-gate-key" : "settings-license-key"}
          type="text"
          label={language.t("settings.pricing.form.key.label")}
          description={language.t("settings.pricing.form.key.description")}
          placeholder={language.t("settings.pricing.form.key.placeholder")}
          value={form.value}
          onChange={(value: string) => {
            setForm("value", value)
            if (form.error) setForm("error", undefined)
          }}
          error={form.error}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />

        <div class="flex flex-wrap gap-3">
          <Button data-action={locked() ? "license-gate-submit" : "settings-license-submit"} type="submit" disabled={form.saving}>
            {form.saving
              ? `${language.t("common.loading")}${language.t("common.loading.ellipsis")}`
              : hasLicense()
                ? language.t("settings.pricing.action.update")
                : language.t("settings.pricing.action.activate")}
          </Button>
          <Show when={license.canRefresh() || hasLicense()}>
            <Button
              data-action={locked() ? "license-gate-refresh" : "settings-license-refresh"}
              type="button"
              variant="secondary"
              disabled={form.refreshing}
              onClick={() => void refresh()}
            >
              {form.refreshing
                ? `${language.t("common.loading")}${language.t("common.loading.ellipsis")}`
                : language.t("settings.pricing.action.refresh")}
            </Button>
          </Show>
          <Show when={!locked() && hasLicense()}>
            <Button data-action="settings-license-remove" type="button" variant="ghost" onClick={clear}>
              {language.t("settings.pricing.action.remove")}
            </Button>
          </Show>
        </div>
      </form>
    </div>
  )
}

function MetaRow(props: { label: string; value: string }) {
  return (
    <div class="min-w-0 rounded-md bg-surface-base px-3 py-2">
      <div class="text-11-medium text-text-weak">{props.label}</div>
      <div class="text-13-medium text-text-strong truncate">{props.value}</div>
    </div>
  )
}
