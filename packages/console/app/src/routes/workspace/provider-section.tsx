import { json, query, action, useParams, createAsync, useSubmission } from "@solidjs/router"
import { createEffect, For, Show } from "solid-js"
import { Provider } from "@opencode-ai/console-core/provider.js"
import { withActor } from "~/context/auth.withActor"
import { createStore } from "solid-js/store"
import styles from "./provider-section.module.css"

const PROVIDERS = [
  { name: "OpenAI", key: "openai", prefix: "sk-" },
  { name: "Anthropic", key: "anthropic", prefix: "sk-ant-" },
] as const

type Provider = (typeof PROVIDERS)[number]

const removeProvider = action(async (form: FormData) => {
  "use server"
  const provider = form.get("provider")?.toString()
  if (!provider) return { error: "Provider is required" }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  return json(await withActor(() => Provider.remove({ provider }), workspaceID), { revalidate: listProviders.key })
}, "provider.remove")

const saveProvider = action(async (form: FormData) => {
  "use server"
  const provider = form.get("provider")?.toString()
  const credentials = form.get("credentials")?.toString()
  if (!provider) return { error: "Provider is required" }
  if (!credentials) return { error: "API key is required" }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  return json(
    await withActor(
      () =>
        Provider.create({ provider, credentials })
          .then(() => ({ error: undefined }))
          .catch((e) => ({ error: e.message as string })),
      workspaceID,
    ),
    { revalidate: listProviders.key },
  )
}, "provider.save")

const listProviders = query(async (workspaceID: string) => {
  "use server"
  return withActor(() => Provider.list(), workspaceID)
}, "provider.list")

function ProviderRow(props: { provider: Provider }) {
  const params = useParams()
  const providers = createAsync(() => listProviders(params.id))
  const saveSubmission = useSubmission(saveProvider, ([fd]) => fd.get("provider")?.toString() === props.provider.key)
  const removeSubmission = useSubmission(
    removeProvider,
    ([fd]) => fd.get("provider")?.toString() === props.provider.key,
  )
  const [store, setStore] = createStore({ editing: false })

  let input: HTMLInputElement

  const isEnabled = () => providers()?.some((p) => p.provider === props.provider.key)

  createEffect(() => {
    if (!saveSubmission.pending && saveSubmission.result && !saveSubmission.result.error) {
      hide()
    }
  })

  function show() {
    while (true) {
      saveSubmission.clear()
      if (!saveSubmission.result) break
    }
    setStore("editing", true)
    setTimeout(() => input?.focus(), 0)
  }

  function hide() {
    setStore("editing", false)
  }

  return (
    <tr data-slot="provider-row" data-enabled={isEnabled()}>
      <td data-slot="provider-name">{props.provider.name}</td>
      <td data-slot="provider-status">{isEnabled() ? "Configured" : "Not Configured"}</td>
      <td data-slot="provider-toggle">
        <Show
          when={store.editing}
          fallback={
            <Show
              when={isEnabled()}
              fallback={
                <button data-color="ghost" onClick={() => show()}>
                  Configure
                </button>
              }
            >
              <form action={removeProvider} method="post">
                <input type="hidden" name="provider" value={props.provider.key} />
                <input type="hidden" name="workspaceID" value={params.id} />
                <button data-color="ghost" type="submit" disabled={removeSubmission.pending}>
                  Disable
                </button>
              </form>
            </Show>
          }
        >
          <form action={saveProvider} method="post" data-slot="edit-form">
            <div data-slot="input-wrapper">
              <input
                ref={(r) => (input = r)}
                name="credentials"
                type="text"
                placeholder={`Enter ${props.provider.name} API key (${props.provider.prefix}...)`}
                autocomplete="off"
                data-form-type="other"
                data-lpignore="true"
              />
              <Show when={saveSubmission.result && saveSubmission.result.error}>
                {(err) => <div data-slot="form-error">{err()}</div>}
              </Show>
            </div>
            <input type="hidden" name="provider" value={props.provider.key} />
            <input type="hidden" name="workspaceID" value={params.id} />
            <div data-slot="form-actions">
              <button type="reset" data-color="ghost" onClick={() => hide()}>
                Cancel
              </button>
              <button type="submit" data-color="ghost" disabled={saveSubmission.pending}>
                {saveSubmission.pending ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </Show>
      </td>
    </tr>
  )
}

export function ProviderSection() {
  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Bring Your Own Key</h2>
        <p>Configure your own API keys from AI providers.</p>
      </div>
      <div data-slot="providers-table">
        <table data-slot="providers-table-element">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <For each={PROVIDERS}>{(provider) => <ProviderRow provider={provider} />}</For>
          </tbody>
        </table>
      </div>
    </section>
  )
}
