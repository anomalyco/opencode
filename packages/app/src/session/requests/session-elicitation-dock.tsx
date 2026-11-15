import { For, Match, Show, Switch as Branch } from "solid-js"
import { Option, Schema } from "effect"
import type { FormInfo, FormStringField, LocationRef } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Checkbox } from "@opencode/ui/checkbox"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { LinkedText } from "@opencode/session-ui/linked-text"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { createElicitationDock } from "./elicitation-controller"
import "./session-elicitation-dock.css"

type Field = FormInfo["fields"][number]

const decodeMessage = Schema.decodeUnknownOption(Schema.String)

const inputTypes = { email: "email", uri: "url", date: "text", "date-time": "text" } as const satisfies Record<
  NonNullable<FormStringField["format"]>,
  string
>

export function SessionElicitationDock(props: {
  request: FormInfo & { location?: LocationRef }
  onSubmit: () => void
}) {
  const language = useLanguage()
  const platform = usePlatform()

  const dock = createElicitationDock({
    sdk: useServerSDK(),
    forms: useData().session.form,
    language,
    request: () => props.request,
    onSubmit: props.onSubmit,
  })

  const message = () => Option.getOrUndefined(decodeMessage(props.request.metadata?.message))

  return (
    <div data-component="session-elicitation-dock">
      <DockPrompt
        kind="question"
        onKeyDown={(event) => {
          if (event.defaultPrevented) return

          if (event.key === "Escape") {
            event.preventDefault()
            dock.dismiss()

            return
          }

          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.altKey) {
            event.preventDefault()
            dock.reply()
          }
        }}
        header={
          <>
            <div data-slot="question-header-top">
              <div data-slot="question-header-title">
                <bdi>{props.request.title}</bdi>
              </div>
            </div>
            <Show when={message()}>
              {(text) => (
                <div data-slot="question-details">
                  <div data-slot="question-text">
                    <bdi>
                      <LinkedText text={text()} />
                    </bdi>
                  </div>
                </div>
              )}
            </Show>
          </>
        }
        footer={
          <>
            <Button variant="ghost" size="large" disabled={dock.busy()} onClick={dock.dismiss}>
              {language.t("ui.common.dismiss")}
            </Button>
            <div data-slot="question-footer-actions">
              <Button variant="submit" size="large" disabled={dock.busy()} onClick={dock.reply}>
                {language.t("ui.common.submit")}
              </Button>
            </div>
          </>
        }
      >
        <div data-slot="elicitation-fields">
          <For each={dock.fields()}>
            {(field) => (
              <div data-slot="elicitation-field">
                <Branch>
                  <Match when={field.type === "boolean" && field}>
                    <Label field={field} />
                    <Switch
                      hideLabel
                      checked={dock.draft().flag[field.key] === true}
                      onChange={(checked) => dock.setFlag(field.key, checked)}
                      disabled={dock.busy()}
                    >
                      {field.title ?? field.key}
                    </Switch>
                  </Match>
                  <Match when={(field.type === "number" || field.type === "integer") && field}>
                    <Label field={field} />
                    <TextInput
                      type="number"
                      numeric
                      step={field.type === "integer" ? 1 : "any"}
                      value={dock.draft().number[field.key] ?? ""}
                      disabled={dock.busy()}
                      aria-label={field.title ?? field.key}
                      onInput={(event) => dock.setNumber(field.key, event.currentTarget.value)}
                    />
                  </Match>
                  <Match when={field.type === "string" && field.options?.length ? field : undefined}>
                    {(select) => (
                      <>
                        <Label field={select()} />
                        <Select
                          aria-label={select().title ?? select().key}
                          options={select().options ?? []}
                          current={select().options?.find((option) => option.value === dock.draft().text[select().key])}
                          value={(option) => option.value}
                          label={(option) => option.label}
                          onSelect={(option) => dock.setText(select().key, option?.value ?? "")}
                          placeholder={language.t("session.elicitation.selectPlaceholder")}
                          disabled={dock.busy()}
                        />
                      </>
                    )}
                  </Match>
                  <Match when={field.type === "string" && field}>
                    {(text) => (
                      <>
                        <Label field={text()} />
                        <TextInput
                          type={inputType(text().format)}
                          value={dock.draft().text[text().key] ?? ""}
                          placeholder={text().placeholder}
                          disabled={dock.busy()}
                          aria-label={text().title ?? text().key}
                          onInput={(event) => dock.setText(text().key, event.currentTarget.value)}
                        />
                      </>
                    )}
                  </Match>
                  <Match when={field.type === "multiselect" && field}>
                    {(multi) => (
                      <>
                        <Label field={multi()} />
                        <For each={multi().options}>
                          {(option) => (
                            <Checkbox
                              checked={(dock.draft().list[multi().key] ?? []).includes(option.value)}
                              disabled={dock.busy()}
                              onChange={(checked) => dock.toggle(multi().key, option.value, checked)}
                            >
                              {option.label}
                            </Checkbox>
                          )}
                        </For>
                      </>
                    )}
                  </Match>
                  <Match when={field.type === "external" && field}>
                    {(external) => (
                      <>
                        <Label field={external()} />
                        <div data-slot="elicitation-external">
                          <span data-slot="elicitation-url">{external().url}</span>
                          <Button
                            variant="neutral"
                            size="small"
                            disabled={dock.busy()}
                            onClick={() => platform.openExternal(external().url)}
                          >
                            {language.t("common.open")}
                          </Button>
                        </div>
                      </>
                    )}
                  </Match>
                </Branch>
              </div>
            )}
          </For>
        </div>
      </DockPrompt>
    </div>
  )
}

function Label(props: { field: Field }) {
  return (
    <Show when={props.field.title || props.field.description}>
      <div data-slot="elicitation-label">
        <Show when={props.field.title}>
          <span data-slot="elicitation-title">{props.field.title}</span>
        </Show>
        <Show when={props.field.description}>
          {(description) => (
            <span data-slot="elicitation-description">
              <LinkedText text={description()} />
            </span>
          )}
        </Show>
      </div>
    </Show>
  )
}

function inputType(format: FormStringField["format"]) {
  return format ? inputTypes[format] : "text"
}
