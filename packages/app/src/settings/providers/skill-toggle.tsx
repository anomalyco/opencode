import { Switch } from "@opencode-ai/ui/switch"
import { useMutation } from "@tanstack/solid-query"
import { Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"

export function SkillToggle(props: { id: string; name: string }) {
  const language = useLanguage()
  const server = useServerSDK()
  const data = useData()
  const enabled = () =>
    !data.preferences
      .list()
      ?.some(
        (entry) =>
          entry.target.kind === "skill.activation" && entry.target.id === props.id && entry.value === "disabled",
      )
  const update = useMutation(() => ({
    mutationFn: async (checked: boolean) => {
      await server.api.preferences.set({
        kind: "skill.activation",
        id: props.id,
        value: checked ? "enabled" : "disabled",
      })
      data.preferences.invalidate()
      await data.preferences.sync()
    },
    onError: () =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: language.t("settings.extensions.skills.updateFailed", { name: props.name }),
      }),
  }))

  return (
    <div class="flex h-6 shrink-0 items-center gap-3">
      <Show when={data.preferences.list() !== undefined}>
        <span class="text-13-regular text-v2-text-text-muted">
          {enabled()
            ? language.t("settings.extensions.skills.enabled")
            : language.t("settings.extensions.skills.disabled")}
        </span>
      </Show>
      <Switch
        checked={enabled()}
        disabled={
          data.preferences.list() === undefined || server.connection.status() !== "connected" || update.isPending
        }
        hideLabel
        onChange={(checked) => {
          if (update.isPending || checked === enabled()) return
          update.mutate(checked)
        }}
      >
        {language.t("settings.extensions.skills.toggle", { name: props.name })}
      </Switch>
    </div>
  )
}
