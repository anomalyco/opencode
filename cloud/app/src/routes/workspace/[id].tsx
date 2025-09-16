import "./[id].css"
import { Billing } from "@opencode/cloud-core/billing.js"
import { Key } from "@opencode/cloud-core/key.js"
import { json, query, action, useParams, useAction, createAsync, useSubmission } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { withActor } from "~/context/auth.withActor"
import { IconCopy, IconCheck, IconCreditCard } from "~/component/icon"
import { createStore } from "solid-js/store"

function formatDateForTable(date: Date) {
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }
  return date.toLocaleDateString("en-GB", options).replace(",", ",")
}

function formatDateUTC(date: Date) {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
    timeZone: "UTC",
  }
  return date.toLocaleDateString("en-US", options)
}

/////////////////////////////////////
// Keys related queries and actions
/////////////////////////////////////

const listKeys = query(async (workspaceID: string) => {
  "use server"
  return withActor(() => Key.list(), workspaceID)
}, "key.list")

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

const removeKey = action(async (form: FormData) => {
  "use server"
  const id = form.get("id")?.toString()
  if (!id) return { error: "ID is required" }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  return json(await withActor(() => Key.remove({ id }), workspaceID), { revalidate: listKeys.key })
}, "key.remove")

/////////////////////////////////////
// Billing related queries and actions
/////////////////////////////////////

const getBillingInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    return await Billing.get()
  }, workspaceID)
}, "billing.get")

const getUsageInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    return await Billing.usages()
  }, workspaceID)
}, "usage.list")

const getPaymentsInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    return await Billing.payments()
  }, workspaceID)
}, "payment.list")

const setMonthlyLimit = action(async (form: FormData) => {
  "use server"
  const limit = form.get("limit")?.toString()
  if (!limit) return { error: "Limit is required" }
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  return json(
    await withActor(
      () =>
        Billing.setMonthlyLimit(parseInt(limit))
          .then((data) => ({ error: undefined, data }))
          .catch((e) => ({ error: e.message as string })),
      workspaceID,
    ),
    { revalidate: getBillingInfo.key },
  )
}, "billing.setMonthlyLimit")

const reload = action(async (form: FormData) => {
  "use server"
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  return json(await withActor(() => Billing.reload(), workspaceID), { revalidate: getBillingInfo.key })
}, "billing.reload")

const disableReload = action(async (form: FormData) => {
  "use server"
  const workspaceID = form.get("workspaceID")?.toString()
  if (!workspaceID) return { error: "Workspace ID is required" }
  return json(await withActor(() => Billing.disableReload(), workspaceID), { revalidate: getBillingInfo.key })
}, "billing.disableReload")

const createCheckoutUrl = action(async (workspaceID: string, successUrl: string, cancelUrl: string) => {
  "use server"
  return withActor(() => Billing.generateCheckoutUrl({ successUrl, cancelUrl }), workspaceID)
}, "checkoutUrl")

const createSessionUrl = action(async (workspaceID: string, returnUrl: string) => {
  "use server"
  return withActor(() => Billing.generateSessionUrl({ returnUrl }), workspaceID)
}, "sessionUrl")

function KeySection() {
  const params = useParams()
  const keys = createAsync(() => listKeys(params.id))

  function formatKey(key: string) {
    if (key.length <= 11) return key
    return `${key.slice(0, 7)}...${key.slice(-4)}`
  }

  return (
    <section data-component="api-keys-section">
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

function KeyCreateForm() {
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

function BillingSection() {
  const params = useParams()
  const balanceInfo = createAsync(() => getBillingInfo(params.id))
  const createCheckoutUrlAction = useAction(createCheckoutUrl)
  const createCheckoutUrlSubmission = useSubmission(createCheckoutUrl)
  const createSessionUrlAction = useAction(createSessionUrl)
  const createSessionUrlSubmission = useSubmission(createSessionUrl)
  const disableReloadSubmission = useSubmission(disableReload)
  const reloadSubmission = useSubmission(reload)

  const balanceAmount = createMemo(() => {
    return ((balanceInfo()?.balance ?? 0) / 100000000).toFixed(2)
  })

  return (
    <section data-component="billing-section">
      <div data-slot="section-title">
        <h2>Billing</h2>
        <p>
          Manage payments methods. <a href="mailto:contact@anoma.ly">Contact us</a> if you have any questions.
        </p>
      </div>
      <div data-slot="section-content">
        <Show when={balanceInfo()?.reloadError}>
          <div data-slot="reload-error">
            <p>
              Reload failed at{" "}
              {balanceInfo()?.timeReloadError!.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
              })}
              . Reason: {balanceInfo()?.reloadError?.replace(/\.$/, "")}. Please update your payment method and try
              again.
            </p>
            <form action={reload} method="post" data-slot="create-form">
              <input type="hidden" name="workspaceID" value={params.id} />
              <button data-color="primary" type="submit" disabled={reloadSubmission.pending}>
                {reloadSubmission.pending ? "Reloading..." : "Reload"}
              </button>
            </form>
          </div>
        </Show>
        <div data-slot="payment">
          <div data-slot="credit-card">
            <div data-slot="card-icon">
              <IconCreditCard style={{ width: "32px", height: "32px" }} />
            </div>
            <div data-slot="card-details">
              <Show when={balanceInfo()?.paymentMethodLast4} fallback={<span data-slot="number">----</span>}>
                <span data-slot="secret">••••</span>
                <span data-slot="number">{balanceInfo()?.paymentMethodLast4}</span>
              </Show>
            </div>
          </div>
          <div data-slot="button-row">
            <Show
              when={balanceInfo()?.reload}
              fallback={
                <button
                  data-color="primary"
                  disabled={createCheckoutUrlSubmission.pending}
                  onClick={async () => {
                    const baseUrl = window.location.href
                    const checkoutUrl = await createCheckoutUrlAction(params.id, baseUrl, baseUrl)
                    if (checkoutUrl) {
                      window.location.href = checkoutUrl
                    }
                  }}
                >
                  {createCheckoutUrlSubmission.pending ? "Loading..." : "Enable Billing"}
                </button>
              }
            >
              <button
                data-color="primary"
                disabled={createSessionUrlSubmission.pending}
                onClick={async () => {
                  const baseUrl = window.location.href
                  const sessionUrl = await createSessionUrlAction(params.id, baseUrl)
                  if (sessionUrl) {
                    window.location.href = sessionUrl
                  }
                }}
              >
                {createSessionUrlSubmission.pending ? "Loading..." : "Manage Payment Methods"}
              </button>
              <form action={disableReload} method="post" data-slot="create-form">
                <input type="hidden" name="workspaceID" value={params.id} />
                <button data-color="ghost" type="submit" disabled={disableReloadSubmission.pending}>
                  {disableReloadSubmission.pending ? "Disabling..." : "Disable"}
                </button>
              </form>
            </Show>
          </div>
        </div>
        <div data-slot="usage">
          <Show when={!balanceInfo()?.reload && !(balanceAmount() === "0.00" || balanceAmount() === "-0.00")}>
            <p>
              You have <b data-slot="value">${balanceAmount() === "-0.00" ? "0.00" : balanceAmount()}</b> remaining in
              your account. You can continue using the API with your remaining balance.
            </p>
          </Show>
          <Show when={balanceInfo()?.reload && !balanceInfo()?.reloadError}>
            <p>
              Your current balance is <b data-slot="value">${balanceAmount() === "-0.00" ? "0.00" : balanceAmount()}</b>
              . We'll automatically reload <b>$20</b> (+$1.23 processing fee) when it reaches <b>$5</b>.
            </p>
          </Show>
        </div>
      </div>
    </section>
  )
}

function MonthlyLimitSection() {
  const params = useParams()
  const submission = useSubmission(setMonthlyLimit)
  const [store, setStore] = createStore({ show: false })
  const balanceInfo = createAsync(() => getBillingInfo(params.id))

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
    <section data-component="monthly-limit-section">
      <div data-slot="section-title">
        <h2>Monthly Limit</h2>
        <p>Set a monthly spending limit for your account.</p>
      </div>
      <div data-slot="section-content">
        <div data-slot="balance">
          <div data-slot="amount">
            {balanceInfo()?.monthlyLimit ? <span data-slot="currency">$</span> : null}
            <span data-slot="value">{balanceInfo()?.monthlyLimit ?? "-"}</span>
          </div>
          <Show
            when={!store.show}
            fallback={
              <form action={setMonthlyLimit} method="post" data-slot="create-form">
                <div data-slot="input-container">
                  <input ref={(r) => (input = r)} data-component="input" name="limit" type="number" placeholder="50" />
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
                    {submission.pending ? "Setting..." : "Set"}
                  </button>
                </div>
              </form>
            }
          >
            <button data-color="primary" onClick={() => show()}>
              {balanceInfo()?.monthlyLimit ? "Edit Limit" : "Set Limit"}
            </button>
          </Show>
        </div>
        <Show when={balanceInfo()?.monthlyLimit} fallback={<p data-slot="usage-status">No spending limit set.</p>}>
          <p data-slot="usage-status">
            Current usage for {new Date().toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} is $
            {(() => {
              const dateLastUsed = balanceInfo()?.timeMonthlyUsageUpdated
              if (!dateLastUsed) return "0"

              const current = new Date().toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                timeZone: "UTC",
              })
              const lastUsed = dateLastUsed.toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                timeZone: "UTC",
              })
              if (current !== lastUsed) return "0"
              return ((balanceInfo()?.monthlyUsage ?? 0) / 100000000).toFixed(2)
            })()}
            .
          </p>
        </Show>
      </div>
    </section>
  )
}

function UsageSection() {
  const params = useParams()
  const usage = createAsync(() => getUsageInfo(params.id))

  return (
    <section data-component="usage-section">
      <div data-slot="section-title">
        <h2>Usage History</h2>
        <p>Recent API usage and costs.</p>
      </div>
      <div data-slot="usage-table">
        <Show
          when={usage() && usage()!.length > 0}
          fallback={
            <div data-component="empty-state">
              <p>Make your first API call to get started.</p>
            </div>
          }
        >
          <table data-slot="usage-table-element">
            <thead>
              <tr>
                <th>Date</th>
                <th>Model</th>
                <th>Input</th>
                <th>Output</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              <For each={usage()!}>
                {(usage) => {
                  const date = createMemo(() => new Date(usage.timeCreated))
                  return (
                    <tr>
                      <td data-slot="usage-date" title={formatDateUTC(date())}>
                        {formatDateForTable(date())}
                      </td>
                      <td data-slot="usage-model">{usage.model}</td>
                      <td data-slot="usage-tokens">{usage.inputTokens}</td>
                      <td data-slot="usage-tokens">{usage.outputTokens}</td>
                      <td data-slot="usage-cost">${((usage.cost ?? 0) / 100000000).toFixed(4)}</td>
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

function PaymentSection() {
  const params = useParams()
  const payments = createAsync(() => getPaymentsInfo(params.id))

  return (
    payments() &&
    payments()!.length > 0 && (
      <section data-component="payments-section">
        <div data-slot="section-title">
          <h2>Payments History</h2>
          <p>Recent payment transactions.</p>
        </div>
        <div data-slot="payments-table">
          <table data-slot="payments-table-element">
            <thead>
              <tr>
                <th>Date</th>
                <th>Payment ID</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              <For each={payments()!}>
                {(payment) => {
                  const date = new Date(payment.timeCreated)
                  return (
                    <tr>
                      <td data-slot="payment-date" title={formatDateUTC(date)}>
                        {formatDateForTable(date)}
                      </td>
                      <td data-slot="payment-id">{payment.id}</td>
                      <td data-slot="payment-amount">${((payment.amount ?? 0) / 100000000).toFixed(2)}</td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </div>
      </section>
    )
  )
}

function NewUserSection() {
  const params = useParams()
  const [copiedKey, setCopiedKey] = createSignal(false)
  const keys = createAsync(() => listKeys(params.id))
  const usage = createAsync(() => getUsageInfo(params.id))
  const isNew = createMemo(() => {
    const keysList = keys()
    const usageList = usage()
    return keysList?.length === 1 && (!usageList || usageList.length === 0)
  })
  const defaultKey = createMemo(() => keys()?.at(-1)?.key)

  return (
    <Show when={isNew()}>
      <div data-slot="new-user-sections">
        <div data-component="feature-grid">
          <div data-slot="feature">
            <h3>Tested & Verified Models</h3>
            <p>We've benchmarked and tested models specifically for coding agents to ensure the best performance.</p>
          </div>
          <div data-slot="feature">
            <h3>Highest Quality</h3>
            <p>Access models configured for optimal performance - no downgrades or routing to cheaper providers.</p>
          </div>
          <div data-slot="feature">
            <h3>No Lock-in</h3>
            <p>Use Zen with any coding agent, and continue using other providers with opencode whenever you want.</p>
          </div>
        </div>

        <div data-component="api-key-highlight">
          <Show when={defaultKey()}>
            <div data-slot="key-display">
              <div data-slot="key-container">
                <code data-slot="key-value">{defaultKey()}</code>
                <button
                  data-color="primary"
                  disabled={copiedKey()}
                  onClick={async () => {
                    await navigator.clipboard.writeText(defaultKey() ?? "")
                    setCopiedKey(true)
                    setTimeout(() => setCopiedKey(false), 2000)
                  }}
                  title="Copy API key"
                >
                  <Show
                    when={copiedKey()}
                    fallback={
                      <>
                        <IconCopy style={{ width: "16px", height: "16px" }} /> Copy Key
                      </>
                    }
                  >
                    <IconCheck style={{ width: "16px", height: "16px" }} /> Copied!
                  </Show>
                </button>
              </div>
            </div>
          </Show>
        </div>

        <div data-component="next-steps">
          <ol>
            <li>Enable billing</li>
            <li>
              Run <code>opencode auth login</code> and select opencode
            </li>
            <li>Paste your API key</li>
            <li>
              Start opencode and run <code>/models</code> to select a model
            </li>
          </ol>
        </div>
      </div>
    </Show>
  )
}

export default function () {
  const params = useParams()
  const balanceInfo = createAsync(() => getBillingInfo(params.id))

  return (
    <div data-page="workspace-[id]">
      <section data-component="title-section">
        <h1>Zen</h1>
        <p>
          Curated list of models provided by opencode.{" "}
          <a target="_blank" href="/docs/zen">
            Learn more
          </a>
          .
        </p>
      </section>

      <div data-slot="sections">
        <NewUserSection />
        <KeySection />
        <BillingSection />
        <Show when={balanceInfo()?.reload}>
          <MonthlyLimitSection />
        </Show>
        <UsageSection />
        <PaymentSection />
      </div>
    </div>
  )
}
