import { For, Match, Show, Switch as Branch, createMemo } from "solid-js"
import { Option, Schema } from "effect"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import type { FormAnswer, FormInfo, FormStringField, FormValue, LocationRef } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Checkbox } from "@opencode/ui/checkbox"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { showToast } from "@/shell/notifications/toast"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useData } from "@/runtime/server/current"
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
  const data = useData()
  const fields = createMemo(() => props.request.fields.filter((field) => !("hidden" in field && field.hidden)))

  const message = () => Option.getOrUndefined(decodeMessage(props.request.metadata?.message))

  // Number inputs keep their raw text so a half-typed value such as "-" is not discarded.
  const [values, setValues] = createStore<{
    text: Record<string, string>
    number: Record<string, string>
    flag: Record<string, boolean>
    list: Record<string, string[]>
  }>({
    text: Object.fromEntries(
      props.request.fields.flatMap((field) => (field.type === "string" ? [[field.key, field.default ?? ""]] : [])),
    ),
    number: Object.fromEntries(
      props.request.fields.flatMap((field) =>
        (field.type === "number" || field.type === "integer") && field.default !== undefined
          ? [[field.key, String(field.default)]]
          : [],
      ),
    ),
    flag: Object.fromEntries(
      props.request.fields.flatMap((field) => (field.type === "boolean" ? [[field.key, field.default ?? false]] : [])),
    ),
    list: Object.fromEntries(
      props.request.fields.flatMap((field) =>
        field.type === "multiselect" ? [[field.key, [...(field.default ?? [])]]] : [],
      ),
    ),
  })

  const fail = (error: Error) => showToast({ title: language.t("common.requestFailed"), description: error.message })

  const input = () => ({ sessionID: props.request.sessionID, formID: props.request.id })

  const reply = useMutation(() => ({
    mutationFn: (answer: FormAnswer) => data.session.form.reply({ ...input(), answer }, props.request.location),
    onMutate: props.onSubmit,
    onError: fail,
  }))

  const cancel = useMutation(() => ({
    mutationFn: () => data.session.form.cancel(input(), props.request.location),
    onMutate: props.onSubmit,
    onError: fail,
  }))

  const sending = () => reply.isPending || cancel.isPending

  const submit = () => {
    if (sending()) return
    reply.mutate(
      Object.fromEntries(
        fields().flatMap((field): Array<[string, FormValue]> => {
          if (field.type === "external") return [[field.key, true]]

          if (field.type === "boolean") return [[field.key, values.flag[field.key] ?? false]]

          if (field.type === "multiselect") {
            const list = values.list[field.key] ?? []

            return list.length ? [[field.key, list]] : []
          }

          const text = (field.type === "string" ? values.text[field.key] : values.number[field.key])?.trim()

          if (!text) return []

          return [[field.key, field.type === "string" ? text : Number(text)]]
        }),
      ),
    )
  }

  return (
    <div data-component="session-elicitation-dock">
      <DockPrompt
        kind="question"
        onKeyDown={(event) => {
          if (event.defaultPrevented) return

          if (event.key === "Escape") {
            event.preventDefault()

            if (!sending()) cancel.mutate()

            return
          }

          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.altKey) {
            event.preventDefault()
            submit()
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
                    <bdi>{text()}</bdi>
                  </div>
                </div>
              )}
            </Show>
          </>
        }
        footer={
          <>
            <Button variant="ghost" size="large" disabled={sending()} onClick={() => cancel.mutate()}>
              {language.t("ui.common.dismiss")}
            </Button>
            <div data-slot="question-footer-actions">
              <Button variant="submit" size="large" disabled={sending()} onClick={submit}>
                {language.t("ui.common.submit")}
              </Button>
            </div>
          </>
        }
      >
        <div data-slot="elicitation-fields">
          <For each={fields()}>
            {(field) => (
              <div data-slot="elicitation-field">
                <Branch>
                  <Match when={field.type === "boolean" && field}>
                    <Label field={field} />
                    <Switch
                      hideLabel
                      checked={values.flag[field.key] === true}
                      onChange={(checked) => setValues("flag", field.key, checked)}
                      disabled={sending()}
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
                      value={values.number[field.key] ?? ""}
                      disabled={sending()}
                      aria-label={field.title ?? field.key}
                      onInput={(event) => setValues("number", field.key, event.currentTarget.value)}
                    />
                  </Match>
                  <Match when={field.type === "string" && field.options?.length ? field : undefined}>
                    {(select) => (
                      <>
                        <Label field={select()} />
                        <Select
                          aria-label={select().title ?? select().key}
                          options={select().options ?? []}
                          current={select().options?.find((option) => option.value === values.text[select().key])}
                          value={(option) => option.value}
                          label={(option) => option.label}
                          onSelect={(option) => setValues("text", select().key, option?.value ?? "")}
                          placeholder={language.t("session.elicitation.selectPlaceholder")}
                          disabled={sending()}
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
                          value={values.text[text().key] ?? ""}
                          placeholder={text().placeholder}
                          disabled={sending()}
                          aria-label={text().title ?? text().key}
                          onInput={(event) => setValues("text", text().key, event.currentTarget.value)}
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
                              checked={(values.list[multi().key] ?? []).includes(option.value)}
                              disabled={sending()}
                              onChange={(checked) =>
                                setValues("list", multi().key, (current = []) =>
                                  checked
                                    ? [...current, option.value]
                                    : current.filter((value) => value !== option.value),
                                )
                              }
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
                            disabled={sending()}
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
          <span data-slot="elicitation-description">{props.field.description}</span>
        </Show>
      </div>
    </Show>
  )
}

function inputType(format: FormStringField["format"]) {
  return format ? inputTypes[format] : "text"
}
