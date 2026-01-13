import { A, createAsync, query, redirect, useSearchParams } from "@solidjs/router"
import { Title } from "@solidjs/meta"
import { createEffect, createSignal, For, onMount, Show } from "solid-js"
import { loadStripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useStripe, useElements } from "solid-stripe"
import { config } from "~/config"
import { PlanIcon, plans } from "./common"
import { getActor } from "~/context/auth"
import { withActor } from "~/context/auth.withActor"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { and, Database, eq, isNull } from "@opencode-ai/console-core/drizzle/index.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { createList } from "solid-list"
import { Modal } from "~/component/modal"

const plansMap = Object.fromEntries(plans.map((p) => [p.id, p])) as Record<string, (typeof plans)[number]>

const getWorkspaces = query(async () => {
  "use server"
  const actor = await getActor()
  if (actor.type === "public") throw redirect("/auth/authorize?continue=/black/subscribe")
  return withActor(async () => {
    return Database.use((tx) =>
      tx
        .select({
          id: WorkspaceTable.id,
          name: WorkspaceTable.name,
          slug: WorkspaceTable.slug,
        })
        .from(UserTable)
        .innerJoin(WorkspaceTable, eq(UserTable.workspaceID, WorkspaceTable.id))
        .where(
          and(
            eq(UserTable.accountID, Actor.account()),
            isNull(WorkspaceTable.timeDeleted),
            isNull(UserTable.timeDeleted),
          ),
        ),
    )
  })
}, "black.subscribe.workspaces")

function CheckoutForm(props: { plan: string; amount: number }) {
  const stripe = useStripe()
  const elements = useElements()
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    if (!stripe() || !elements()) return

    setLoading(true)
    setError(null)

    const result = await elements()!.submit()
    if (result.error) {
      setError(result.error.message ?? "An error occurred")
      setLoading(false)
      return
    }

    const { error: confirmError } = await stripe()!.confirmSetup({
      elements: elements()!,
      confirmParams: {
        return_url: `${window.location.origin}/black/success?plan=${props.plan}`,
      },
    })

    if (confirmError) {
      setError(confirmError.message ?? "An error occurred")
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} data-slot="checkout-form">
      <PaymentElement />
      <Show when={error()}>
        <p data-slot="error">{error()}</p>
      </Show>
      <button type="submit" disabled={loading() || !stripe() || !elements()} data-slot="submit-button">
        {loading() ? "Processing..." : `Subscribe $${props.amount}`}
      </button>
      <p data-slot="charge-notice">You will only be charged when your subscription is activated</p>
    </form>
  )
}

export default function BlackSubscribe() {
  const workspaces = createAsync(() => getWorkspaces())
  const [selectedWorkspace, setSelectedWorkspace] = createSignal<string | null>(null)

  const [params] = useSearchParams()
  const plan = (params.plan as string) || "200"
  const planData = plansMap[plan] || plansMap["200"]

  const [clientSecret, setClientSecret] = createSignal<string | null>(null)
  const [stripePromise] = createSignal(loadStripe(config.stripe.publishableKey))

  // Auto-select if only one workspace
  createEffect(() => {
    const ws = workspaces()
    if (ws?.length === 1 && !selectedWorkspace()) {
      setSelectedWorkspace(ws[0].id)
    }
  })

  // Keyboard navigation for workspace picker
  const { active, setActive, onKeyDown } = createList({
    items: () => workspaces()?.map((w) => w.id) ?? [],
    initialActive: null,
  })

  const handleSelectWorkspace = (id: string) => {
    setSelectedWorkspace(id)
  }

  onMount(async () => {
    const response = await fetch("/api/black/setup-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    })
    const data = await response.json()
    if (data.clientSecret) {
      setClientSecret(data.clientSecret)
    }
  })

  let listRef: HTMLUListElement | undefined

  // Show workspace picker if multiple workspaces and none selected
  const showWorkspacePicker = () => {
    const ws = workspaces()
    return ws && ws.length > 1 && !selectedWorkspace()
  }

  return (
    <>
      <Title>Subscribe to OpenCode Black</Title>
      <section data-slot="subscribe-form">
        <div data-slot="form-card">
          <div data-slot="plan-header">
            <p data-slot="title">Subscribe to OpenCode Black</p>
            <div data-slot="icon">
              <PlanIcon plan={plan} />
            </div>
            <p data-slot="price">
              <span data-slot="amount">${planData.amount}</span> <span data-slot="period">per month</span>
              <Show when={planData.multiplier}>
                <span data-slot="multiplier">{planData.multiplier}</span>
              </Show>
            </p>
          </div>
          <div data-slot="divider" />
          <p data-slot="section-title">Add payment method</p>
          <Show
            when={clientSecret()}
            fallback={
              <div data-slot="loading">
                <p>Loading payment form...</p>
              </div>
            }
          >
            <Elements
              stripe={stripePromise()}
              options={{
                clientSecret: clientSecret()!,
                appearance: {
                  theme: "night",
                  variables: {
                    colorPrimary: "#ffffff",
                    colorBackground: "#1a1a1a",
                    colorText: "#ffffff",
                    colorTextSecondary: "#999999",
                    colorDanger: "#ff6b6b",
                    fontFamily: "JetBrains Mono, monospace",
                    borderRadius: "4px",
                    spacingUnit: "4px",
                  },
                  rules: {
                    ".Input": {
                      backgroundColor: "#1a1a1a",
                      border: "1px solid rgba(255, 255, 255, 0.17)",
                      color: "#ffffff",
                    },
                    ".Input:focus": {
                      borderColor: "rgba(255, 255, 255, 0.35)",
                      boxShadow: "none",
                    },
                    ".Label": {
                      color: "rgba(255, 255, 255, 0.59)",
                      fontSize: "14px",
                      marginBottom: "8px",
                    },
                  },
                },
              }}
            >
              <CheckoutForm plan={plan} amount={planData.amount} />
            </Elements>
          </Show>
        </div>

        {/* Workspace picker modal */}
        <Modal open={showWorkspacePicker() ?? false} onClose={() => {}} title="Select a workspace for this plan">
          <div data-slot="workspace-picker">
            <ul
              ref={listRef}
              data-slot="workspace-list"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" && active()) {
                  handleSelectWorkspace(active()!)
                } else {
                  onKeyDown(e)
                }
              }}
            >
              <For each={workspaces()}>
                {(workspace) => (
                  <li
                    data-slot="workspace-item"
                    data-active={active() === workspace.id}
                    onMouseEnter={() => setActive(workspace.id)}
                    onClick={() => handleSelectWorkspace(workspace.id)}
                  >
                    <span data-slot="selected-icon">[*]</span>
                    <span>{workspace.name || workspace.slug}</span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Modal>
        <p data-slot="fine-print">
          Prices shown don't include applicable tax · <A href="/legal/terms-of-service">Terms of Service</A>
        </p>
      </section>
    </>
  )
}
