import { A, action, createAsync, query, redirect, useParams } from "@solidjs/router"
import { Title } from "@solidjs/meta"
import { createEffect, createSignal, For, Show } from "solid-js"
import { type Stripe, type PaymentMethod, loadStripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useStripe, useElements, AddressElement } from "solid-stripe"
import { PlanIcon, plans } from "../common"
import { getActor, useAuthSession } from "~/context/auth"
import { withActor } from "~/context/auth.withActor"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { and, Database, eq, isNull } from "@opencode-ai/console-core/drizzle/index.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { createList } from "solid-list"
import { Modal } from "~/component/modal"
import { BillingTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { Billing } from "@opencode-ai/console-core/billing.js"

const plansMap = Object.fromEntries(plans.map((p) => [p.id, p])) as Record<string, (typeof plans)[number]>
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY!)

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
          billing: {
            customerID: BillingTable.customerID,
            paymentMethodID: BillingTable.paymentMethodID,
            paymentMethodType: BillingTable.paymentMethodType,
            paymentMethodLast4: BillingTable.paymentMethodLast4,
          },
        })
        .from(UserTable)
        .innerJoin(WorkspaceTable, eq(UserTable.workspaceID, WorkspaceTable.id))
        .innerJoin(BillingTable, eq(WorkspaceTable.id, BillingTable.workspaceID))
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

const createSetupIntent = action(async (input: { plan: string; workspaceID: string }) => {
  "use server"
  const { plan, workspaceID } = input

  if (!plan || !["20", "100", "200"].includes(plan)) {
    return { error: "Invalid plan" }
  }

  if (!workspaceID) {
    return { error: "Workspace ID is required" }
  }

  const actor = await getActor()
  if (actor.type === "public") {
    return { error: "Unauthorized" }
  }

  const session = await useAuthSession()
  const account = session.data.account?.[session.data.current ?? ""]
  const email = account?.email

  const stripe = Billing.stripe()

  let customerID = await Database.use((tx) =>
    tx
      .select({ customerID: BillingTable.customerID })
      .from(BillingTable)
      .where(eq(BillingTable.workspaceID, workspaceID))
      .then((rows) => rows[0].customerID),
  )
  if (!customerID) {
    const customer = await stripe.customers.create({
      email,
      metadata: {
        workspaceID,
      },
    })
    customerID = customer.id
  }

  const intent = await stripe.setupIntents.create({
    customer: customerID,
    payment_method_types: ["card"],
    metadata: {
      workspaceID,
    },
  })

  return { clientSecret: intent.client_secret }
})

const bookSubscription = action(
  async (input: {
    workspaceID: string
    paymentMethodID: string
    paymentMethodType: string
    paymentMethodLast4?: string
  }) => {
    "use server"
    const actor = await getActor()
    if (actor.type === "public") {
      return { error: "Unauthorized" }
    }

    await Database.use((tx) =>
      tx
        .update(BillingTable)
        .set({
          paymentMethodID: input.paymentMethodID,
          paymentMethodType: input.paymentMethodType,
          paymentMethodLast4: input.paymentMethodLast4,
          timeSubscriptionBooked: new Date(),
        })
        .where(eq(BillingTable.workspaceID, input.workspaceID)),
    )

    return { success: true }
  },
)

interface SuccessData {
  plan: string
  paymentMethodType: string
  paymentMethodLast4?: string
}

function PaymentSuccess(props: SuccessData) {
  return (
    <div data-slot="success">
      <p data-slot="title">You're on the OpenCode Black waitlist</p>
      <dl data-slot="details">
        <div>
          <dt>Subscription plan</dt>
          <dd>OpenCode Black {props.plan}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>${props.plan} per month</dd>
        </div>
        <div>
          <dt>Payment method</dt>
          <dd>
            <Show when={props.paymentMethodLast4} fallback={<span>{props.paymentMethodType}</span>}>
              <span>
                {props.paymentMethodType} - {props.paymentMethodLast4}
              </span>
            </Show>
          </dd>
        </div>
        <div>
          <dt>Date joined</dt>
          <dd>{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</dd>
        </div>
      </dl>
      <p data-slot="charge-notice">Your card will be charged when your subscription is activated</p>
    </div>
  )
}

function PaymentForm(props: { plan: string; workspaceID: string; onSuccess: (data: SuccessData) => void }) {
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

    const { error: confirmError, setupIntent } = await stripe()!.confirmSetup({
      elements: elements()!,
      confirmParams: {
        expand: ["setup_intent.payment_method"],
        payment_method_data: {
          allow_redisplay: "always",
        },
      },
      redirect: "if_required",
    })

    if (confirmError) {
      setError(confirmError.message ?? "An error occurred")
      setLoading(false)
      return
    }

    if (setupIntent?.status === "succeeded") {
      const pm = setupIntent.payment_method as PaymentMethod

      await bookSubscription({
        workspaceID: props.workspaceID,
        paymentMethodID: pm.id,
        paymentMethodType: pm.type,
        paymentMethodLast4: pm.card?.last4,
      })

      props.onSuccess({
        plan: props.plan,
        paymentMethodType: pm.type,
        paymentMethodLast4: pm.card?.last4,
      })
    }

    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} data-slot="checkout-form">
      <PaymentElement />
      <AddressElement options={{ mode: "billing" }} />
      <Show when={error()}>
        <p data-slot="error">{error()}</p>
      </Show>
      <button type="submit" disabled={loading() || !stripe() || !elements()} data-slot="submit-button">
        {loading() ? "Processing..." : `Subscribe $${props.plan}`}
      </button>
      <p data-slot="charge-notice">You will only be charged when your subscription is activated</p>
    </form>
  )
}

export default function BlackSubscribe() {
  const workspaces = createAsync(() => getWorkspaces())
  const [selectedWorkspace, setSelectedWorkspace] = createSignal<string | null>(null)
  const [success, setSuccess] = createSignal<SuccessData | null>(null)

  const params = useParams()
  const plan = params.plan || "200"
  const planData = plansMap[plan] || plansMap["200"]

  const [clientSecret, setClientSecret] = createSignal<string | null>(null)
  const [setupError, setSetupError] = createSignal<string | null>(null)
  const [stripe, setStripe] = createSignal<Stripe | null>(null)

  // Resolve stripe promise once
  createEffect(() => {
    stripePromise.then((s) => {
      if (s) setStripe(s)
    })
  })

  // Auto-select if only one workspace
  createEffect(() => {
    const ws = workspaces()
    if (ws?.length === 1 && !selectedWorkspace()) {
      setSelectedWorkspace(ws[0].id)
    }
  })

  // Fetch setup intent when workspace is selected (unless workspace already has payment method)
  createEffect(() => {
    const id = selectedWorkspace()
    if (!id) return

    const ws = workspaces()?.find((w) => w.id === id)
    if (ws?.billing.paymentMethodID) {
      setSuccess({
        plan,
        paymentMethodType: ws.billing.paymentMethodType!,
        paymentMethodLast4: ws.billing.paymentMethodLast4 ?? undefined,
      })
      return
    }

    setClientSecret(null)
    setSetupError(null)

    createSetupIntent({ plan, workspaceID: id })
      .then((data) => {
        if (data.clientSecret) {
          setClientSecret(data.clientSecret)
        } else if (data.error) {
          setSetupError(data.error)
        }
      })
      .catch(() => setSetupError("Failed to initialize payment"))
  })

  // Keyboard navigation for workspace picker
  const { active, setActive, onKeyDown } = createList({
    items: () => workspaces()?.map((w) => w.id) ?? [],
    initialActive: null,
  })

  const handleSelectWorkspace = (id: string) => {
    setSelectedWorkspace(id)
  }

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
          <Show
            when={success()}
            fallback={
              <>
                <div data-slot="plan-header">
                  <p data-slot="title">Subscribe to OpenCode Black</p>
                  <div data-slot="icon">
                    <PlanIcon plan={plan} />
                  </div>
                  <p data-slot="price">
                    <span data-slot="amount">${planData.id}</span> <span data-slot="period">per month</span>
                    <Show when={planData.multiplier}>
                      <span data-slot="multiplier">{planData.multiplier}</span>
                    </Show>
                  </p>
                </div>
                <div data-slot="divider" />
                <p data-slot="section-title">Payment method</p>

                <Show when={setupError()}>
                  <p data-slot="error">{setupError()}</p>
                </Show>

                <Show
                  when={clientSecret() && selectedWorkspace() && stripe()}
                  fallback={
                    <div data-slot="loading">
                      <p>{selectedWorkspace() ? "Loading payment form..." : "Select a workspace to continue"}</p>
                    </div>
                  }
                >
                  <Elements
                    stripe={stripe()!}
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
                    <PaymentForm plan={plan} workspaceID={selectedWorkspace()!} onSuccess={setSuccess} />
                  </Elements>
                </Show>
              </>
            }
          >
            {(data) => <PaymentSuccess {...data()} />}
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
