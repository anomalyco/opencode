import { createMemo, Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Select } from "@opencode/ui/select"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsRow } from "@/settings/row"
import type { WebSearchRequestModel } from "./websearch"
import { selectWebSearchDockView } from "./websearch-machine"
import "./session-websearch-dock.css"

export function SessionWebSearchDock(props: { model: WebSearchRequestModel; onSubmit: () => void }) {
  const language = useLanguage()

  const options = createMemo(() => [
    ...(props.model.specific() ? [] : [{ value: "random", label: language.t("session.websearch.any") }]),
    ...props.model.options(),
  ])

  const current = createMemo(() => options().find((option) => option.value === props.model.selected()))

  const dock = createMemo(() =>
    selectWebSearchDockView({
      request: props.model.request(),
      connected: props.model.connected(),
      sending: props.model.sending(),
      loading: props.model.loading(),
      loadFailed: props.model.loadFailed(),
      failed: props.model.failed(),
      optionUnavailable: props.model.optionUnavailable(),
      specific: props.model.specific(),
      options: props.model.options(),
      hasSelection: !!current(),
    }),
  )

  const status = () => {
    const status = dock().status

    if (status === "loading") return language.t("common.loading")

    if (status === "failed") return language.t("session.websearch.failed")

    if (status === "loadFailed") return language.t("session.websearch.loadFailed")

    if (status === "empty") return language.t("session.websearch.empty")

    if (status === "unavailable") return language.t("session.websearch.unavailable")
  }

  const submit = (selection: string | false) => {
    if (dock().busy) return
    props.onSubmit()
    void props.model.submit(selection)
  }

  return (
    <section
      data-component="session-websearch-dock"
      aria-label={language.t("session.websearch.title")}
      aria-busy={props.model.sending()}
    >
      <div class="websearch-body">
        <div class="websearch-setting">
          <SettingsRow
            title={language.t("session.websearch.title")}
            description={language.t("session.websearch.description")}
          >
            <Select
              aria-label={language.t("session.websearch.provider")}
              options={options()}
              current={current()}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && props.model.select(option.value)}
              disabled={dock().selectDisabled}
              placeholder={language.t("session.websearch.provider")}
              contentClass="websearch-provider-menu"
            />
          </SettingsRow>
        </div>
      </div>
      <div class="websearch-footer">
        <div class="websearch-status" aria-live="polite">
          <Show when={status()}>{(text) => <span>{text()}</span>}</Show>
          <Show when={dock().showRetry}>
            <Button variant="ghost" size="small" onClick={props.model.retry} disabled={dock().busy}>
              {language.t("session.websearch.retry")}
            </Button>
          </Show>
        </div>
        <div class="websearch-actions">
          <Show when={dock().showDisable}>
            <Button variant="ghost" size="small" onClick={() => submit(false)} disabled={dock().busy}>
              {language.t("session.websearch.disable")}
            </Button>
          </Show>
          <Button
            variant="submit"
            size="small"
            onClick={() => {
              const selected = props.model.selected()

              if (selected) submit(selected)
            }}
            disabled={dock().enableDisabled}
          >
            {language.t("session.websearch.enable")}
          </Button>
        </div>
      </div>
    </section>
  )
}
