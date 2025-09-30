import { json, query, action, useParams, createAsync, useSubmission } from "@solidjs/router"
import { createEffect, createSignal, For, Show } from "solid-js"
import { IconCopy, IconCheck } from "~/component/icon"
import { Key } from "@opencode/console-core/key.js"
import { withActor } from "~/context/auth.withActor"
import { createStore } from "solid-js/store"
import { formatDateUTC, formatDateForTable } from "./common"
import styles from "./key-section.module.css"

const removeKey = action(async (form: FormData) => {
  "use server"
  const id = form.get("id")?.toString()
  if (!id) return { error: "ID is required" }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  return json(await withActor(() => Key.remove({ id }), workspaceID), { revalidate: listKeys.key })
}, "key.remove")

const createKey = action(async (form: FormData) => {
  "use server"
  const name = form.get("name")?.toString().trim()
  if (!name) return { error: "Name is required" }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  return json(
    await withActor(
      () =>
        Key.create({ name })
          .then((data) => ({ error: undefined, data }))
          .catch((e) => ({ error: e.message as string })),
      workspaceID,
    ),
    { revalidate: listKeys.key },
  )
}, "key.create")

const listKeys = query(async (workspaceID: string) => {
  "use server"
  return withActor(() => Key.list(), workspaceID)
}, "key.list")

export function KeyCreateForm() {
  const params = useParams()
  const submission = useSubmission(createKey)
  const [store, setStore] = createStore({ show: false })

  let input: HTMLInputElement

  createEffect(() => {
    if (!submission.pending && submission.result && !submission.result.error) {
      hide()
    }
  })

  function show() {
    // submission.clear() does not clear the result in some cases, ie.
    //  1. Create key with empty name => error shows
    //  2. Put in a key name and creates the key => form hides
    //  3. Click add key button again => form shows with the same error if
    //     submission.clear() is called only once
    while (true) {
      submission.clear()
      if (!submission.result) break
    }
    setStore("show", true)
    input.focus()
  }

  function hide() {
    setStore("show", false)
  }

  return (
    <Show
      when={store.show}
      fallback={
        <button data-color="primary" onClick={() => show()}>
          Create API Key
        </button>
      }
    >
      <form action={createKey} method="post" data-slot="create-form">
        <div data-slot="input-container">
          <input ref={(r) => (input = r)} data-component="input" name="name" type="text" placeholder="Enter key name" />
          <Show when={submission.result && submission.result.error}>
            {(err) => <div data-slot="form-error">{err()}</div>}
          </Show>
        </div>
        <input type="hidden" name="workspaceID" value={params.id} />
        <div data-slot="form-actions">
          <button type="reset" data-color="ghost" onClick={() => hide()}>
            Cancel
          </button>
          <button type="submit" data-color="primary" disabled={submission.pending}>
            {submission.pending ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </Show>
  )
}

export function KeySection() {
  const params = useParams()
  const keys = createAsync(() => listKeys(params.id))

  function formatKey(key: string) {
    if (key.length <= 11) return key
    return `${key.slice(0, 7)}...${key.slice(-4)}`
  }

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>API Keys</h2>
        <p>Manage your API keys for accessing opencode services.</p>
      </div>
      <KeyCreateForm />
      <div data-slot="api-keys-table">
        <Show
          when={keys()?.length}
          fallback={
            <div data-component="empty-state">
              <p>Create an opencode Gateway API key</p>
            </div>
          }
        >
          <table data-slot="api-keys-table-element">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <For each={keys()!}>
                {(key) => {
                  const [copied, setCopied] = createSignal(false)
                  // const submission = useSubmission(removeKey, ([fd]) => fd.get("id")?.toString() === key.id)
                  return (
                    <tr>
                      <td data-slot="key-name">{key.name}</td>
                      <td data-slot="key-value">
                        <button
                          data-color="ghost"
                          disabled={copied()}
                          onClick={async () => {
                            await navigator.clipboard.writeText(key.key)
                            setCopied(true)
                            setTimeout(() => setCopied(false), 1000)
                          }}
                          title="Copy API key"
                        >
                          <span>{formatKey(key.key)}</span>
                          <Show when={copied()} fallback={<IconCopy style={{ width: "14px", height: "14px" }} />}>
                            <IconCheck style={{ width: "14px", height: "14px" }} />
                          </Show>
                        </button>
                      </td>
                      <td data-slot="key-date" title={formatDateUTC(key.timeCreated)}>
                        {formatDateForTable(key.timeCreated)}
                      </td>
                      <td data-slot="key-actions">
                        <form action={removeKey} method="post">
                          <input type="hidden" name="id" value={key.id} />
                          <input type="hidden" name="workspaceID" value={params.id} />
                          <button data-color="ghost">Delete</button>
                        </form>
                      </td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </section>
  )
}
