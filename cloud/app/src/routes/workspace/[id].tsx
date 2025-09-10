import "./[id].css"
import { Billing } from "@opencode/cloud-core/billing.js"
import { Key } from "@opencode/cloud-core/key.js"
import { json, query, action, useParams, useAction, createAsync, useSubmission } from "@solidjs/router"
import { createMemo, createSignal, For, Show } from "solid-js"
import { withActor } from "~/context/auth.withActor"
import { IconCopy, IconCheck } from "~/component/icon"

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

const createKey = action(async (workspaceID: string, name: string) => {
  "use server"
  return json(
    withActor(() => Key.create({ name }), workspaceID),
    { revalidate: listKeys.key },
  )
}, "key.create")

const removeKey = action(async (workspaceID: string, id: string) => {
  "use server"
  return json(
    withActor(() => Key.remove({ id }), workspaceID),
    { revalidate: listKeys.key },
  )
}, "key.remove")

/////////////////////////////////////
// Billing related queries and actions
/////////////////////////////////////

const getBalanceInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    return await Billing.get()
  }, workspaceID)
}, "balanceInfo")

const getUsageInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    return await Billing.usages()
  }, workspaceID)
}, "usageInfo")

const getPaymentsInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    return await Billing.payments()
  }, workspaceID)
}, "paymentsInfo")

const createCheckoutUrl = action(async (workspaceID: string, successUrl: string, cancelUrl: string) => {
  "use server"
  return withActor(() => Billing.generateCheckoutUrl({ successUrl, cancelUrl }), workspaceID)
}, "checkoutUrl")

// const createPortalUrl = action(async (workspaceID: string, returnUrl: string) => {
//   "use server"
//   return withActor(() => Billing.generatePortalUrl({ returnUrl }), workspaceID)
// }, "portalUrl")

function KeysSection() {
  // Dummy data for testing
  const dummyKeys = [
    {
      id: "key_1",
      name: "Development API Key",
      key: "oc_dev_1234567890abcdef1234567890abcdef12345678",
      timeCreated: new Date("2024-01-15T10:30:00Z"),
    },
    {
      id: "key_2",
      name: "Production API Key",
      key: "oc_prod_abcdef1234567890abcdef1234567890abcdef12",
      timeCreated: new Date("2024-02-01T14:22:00Z"),
    },
    {
      id: "key_3",
      name: "Testing Environment",
      key: "oc_test_9876543210fedcba9876543210fedcba98765432",
      timeCreated: new Date("2024-02-10T09:15:00Z"),
    },
  ]

  const params = useParams()
  const keys = createAsync(() => listKeys(params.id))
  // const keys = () => dummyKeys
  const [showForm, setShowForm] = createSignal(false)
  const [name, setName] = createSignal("")
  const removeAction = useAction(removeKey)
  const createAction = useAction(createKey)
  const createSubmission = useSubmission(createKey)
  const [copiedId, setCopiedId] = createSignal<string | null>(null)

  function formatKey(key: string) {
    if (key.length <= 11) return key
    return `${key.slice(0, 7)}...${key.slice(-4)}`
  }

  async function handleCreateKey() {
    if (!name().trim()) return

    try {
      await createAction(params.id, name().trim())
      setName("")
      setShowForm(false)
    } catch (error) {
      console.error("Failed to create API key:", error)
    }
  }

  async function copyKeyToClipboard(text: string, keyId: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(keyId)
      setTimeout(() => setCopiedId(null), 1500)
    } catch (error) {
      console.error("Failed to copy to clipboard:", error)
    }
  }

  async function handleDeleteKey(keyId: string) {
    if (!confirm("Are you sure you want to delete this API key?")) {
      return
    }

    try {
      await removeAction(params.id, keyId)
    } catch (error) {
      console.error("Failed to delete API key:", error)
    }
  }

  return (
    <section data-component="api-keys-section">
      <div data-slot="section-title">
        <h2>API Keys</h2>
        <p>Manage your API keys for accessing opencode services.</p>
      </div>
      <Show
        when={!showForm()}
        fallback={
          <div data-slot="create-form">
            <input
              data-component="input"
              type="text"
              placeholder="Enter key name"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              onKeyPress={(e) => e.key === "Enter" && handleCreateKey()}
            />
            <div data-slot="form-actions">
              <button
                data-color="ghost"
                onClick={() => {
                  setShowForm(false)
                  setName("")
                }}
              >
                Cancel
              </button>
              <button
                data-color="primary"
                disabled={createSubmission.pending || !name().trim()}
                onClick={handleCreateKey}
              >
                {createSubmission.pending ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        }
      >
        <button
          data-color="primary"
          onClick={() => {
            console.log("clicked")
            setShowForm(true)
          }}
        >
          Create API Key
        </button>
      </Show>
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
                {(key) => (
                  <tr>
                    <td data-slot="key-name">{key.name}</td>
                    <td data-slot="key-value">
                      <div onClick={() => copyKeyToClipboard(key.key, key.id)} title="Click to copy API key">
                        <span>{formatKey(key.key)}</span>
                        <Show
                          when={copiedId() === key.id}
                          fallback={<IconCopy style={{ width: "14px", height: "14px" }} />}
                        >
                          <IconCheck style={{ width: "14px", height: "14px" }} />
                        </Show>
                      </div>
                    </td>
                    <td data-slot="key-date" title={formatDateUTC(key.timeCreated)}>
                      {formatDateForTable(key.timeCreated)}
                    </td>
                    <td data-slot="key-actions">
                      <button data-color="ghost" onClick={() => handleDeleteKey(key.id)} title="Delete API key">
                        Delete
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </section>
  )
}

function BalanceSection() {
  const params = useParams()
  const dummyBalanceInfo = { balance: 2500000000 } // $25.00 in cents

  const balanceInfo = createAsync(() => getBalanceInfo(params.id))
  // const balanceInfo = () => dummyBalanceInfo
  const createCheckoutUrlAction = useAction(createCheckoutUrl)
  const createCheckoutUrlSubmission = useSubmission(createCheckoutUrl)

  async function handleBuyCredits() {
    try {
      const baseUrl = window.location.href
      const checkoutUrl = await createCheckoutUrlAction(params.id, baseUrl, baseUrl)
      if (checkoutUrl) {
        window.location.href = checkoutUrl
      }
    } catch (error) {
      console.error("Failed to get checkout URL:", error)
    }
  }

  return (
    <section data-component="balance-section">
      <div data-slot="section-title">
        <h2>Balance</h2>
        <p>Add credits to your account.</p>
      </div>
      <div data-slot="balance">
        <div
          data-slot="amount"
          data-state={(() => {
            const balanceStr = ((balanceInfo()?.balance ?? 0) / 100000000).toFixed(2)
            return balanceStr === "0.00" || balanceStr === "-0.00" ? "danger" : undefined
          })()}
        >
          <span data-slot="currency">$</span>
          <span data-slot="value">
            {(() => {
              const balanceStr = ((balanceInfo()?.balance ?? 0) / 100000000).toFixed(2)
              return balanceStr === "-0.00" ? "0.00" : balanceStr
            })()}
          </span>
        </div>
        <button data-color="primary" disabled={createCheckoutUrlSubmission.pending} onClick={handleBuyCredits}>
          {createCheckoutUrlSubmission.pending ? "Loading..." : "Buy Credits"}
        </button>
      </div>
    </section>
  )
}

function UsageSection() {
  const params = useParams()
  const dummyUsage = [
    {
      id: "usage_1",
      model: "claude-3-sonnet-20240229",
      inputTokens: 1250,
      outputTokens: 890,
      cost: 125000000, // $1.25 in cents
      timeCreated: "2024-02-10T15:30:00Z",
    },
    {
      id: "usage_2",
      model: "gpt-4-turbo-preview",
      inputTokens: 2100,
      outputTokens: 1456,
      cost: 340000000, // $3.40 in cents
      timeCreated: "2024-02-09T09:45:00Z",
    },
    {
      id: "usage_3",
      model: "claude-3-haiku-20240307",
      inputTokens: 850,
      outputTokens: 620,
      cost: 45000000, // $0.45 in cents
      timeCreated: "2024-02-08T13:22:00Z",
    },
    {
      id: "usage_4",
      model: "gpt-3.5-turbo",
      inputTokens: 1800,
      outputTokens: 1200,
      cost: 85000000, // $0.85 in cents
      timeCreated: "2024-02-07T11:15:00Z",
    },
  ]

  const usage = createAsync(() => getUsageInfo(params.id))
  // const usage = () => dummyUsage
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

function PaymentsSection() {
  const params = useParams()
  const dummyPayments = [
    {
      id: "pi_1234567890",
      amount: 5000000000, // $50.00 in cents
      timeCreated: "2024-02-01T10:00:00Z",
    },
    {
      id: "pi_0987654321",
      amount: 2500000000, // $25.00 in cents
      timeCreated: "2024-01-15T14:30:00Z",
    },
  ]

  const payments = createAsync(() => getPaymentsInfo(params.id))
  // const payments = () => dummyPayments

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

export default function () {
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
        <KeysSection />
        <BalanceSection />
        <UsageSection />
        <PaymentsSection />
      </div>
    </div>
  )
}
