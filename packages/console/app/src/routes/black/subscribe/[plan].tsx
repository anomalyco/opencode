import { A, createAsync, query, redirect, useParams } from "@solidjs/router"
import { Title } from "@solidjs/meta"
import { createEffect, createSignal, For, Match, Show, Switch } from "solid-js"
import { type Stripe, type PaymentMethod, loadStripe } from "@stripe/stripe-js"
import { Elements, PaymentElement, useStripe, useElements, AddressElement } from "solid-stripe"
import { PlanID, plans } from "../common"
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
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { formError } from "~/lib/form-error"
import { Resource } from "@opencode-ai/console-resource"

const getEnabled = query(async () => {
  "use server"
  return Resource.App.stage !== "production"
}, "black.subscribe.enabled")

const plansMap = Object.fromEntries(plans.map((p) => [p.id, p])) as Record<PlanID, (typeof plans)[number]>
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY!)

const getWorkspaces = query(async (plan: string) => {
  "use server"
  const actor = await getActor()
  if (actor.type === "public") throw redirect("/auth/authorize?continue=/black/subscribe/" + plan)
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
            subscriptionID: BillingTable.subscriptionID,
            timeSubscriptionBooked: BillingTable.timeSubscriptionBooked,
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

const createSetupIntent = async (input: { plan: string; workspaceID: string }) => {
  "use server"
  const { plan, workspaceID } = input

  if (!plan || !["20", "100", "200"].includes(plan)) return { error: formError.invalidPlan }
  if (!workspaceID) return { error: formError.workspaceRequired }

  return withActor(async () => {
    const session = await useAuthSession()
    const account = session.data.account?.[session.data.current ?? ""]
    const email = account?.email

    const customer = await Database.use((tx) =>
      tx
        .select({
          customerID: BillingTable.customerID,
          subscriptionID: BillingTable.subscriptionID,
        })
        .from(BillingTable)
        .where(eq(BillingTable.workspaceID, workspaceID))
        .then((rows) => rows[0]),
    )
    if (customer?.subscriptionID) {
      return { error: formError.alreadySubscribed }
    }

    let customerID = customer?.customerID
    if (!customerID) {
      const customer = await Billing.stripe().customers.create({
        email,
        metadata: {
          workspaceID,
        },
      })
      customerID = customer.id
      await Database.use((tx) =>
        tx
          .update(BillingTable)
          .set({
            customerID,
          })
          .where(eq(BillingTable.workspaceID, workspaceID)),
      )
    }

    const intent = await Billing.stripe().setupIntents.create({
      customer: customerID,
      payment_method_types: ["card"],
      metadata: {
        workspaceID,
      },
    })

    return { clientSecret: intent.client_secret ?? undefined }
  }, workspaceID)
}

const bookSubscription = async (input: {
  workspaceID: string
  plan: PlanID
  paymentMethodID: string
  paymentMethodType: string
  paymentMethodLast4?: string
}) => {
  "use server"
  return withActor(
    () =>
      Database.use((tx) =>
        tx
          .update(BillingTable)
          .set({
            paymentMethodID: input.paymentMethodID,
            paymentMethodType: input.paymentMethodType,
            paymentMethodLast4: input.paymentMethodLast4,
            subscriptionPlan: input.plan,
            timeSubscriptionBooked: new Date(),
          })
          .where(eq(BillingTable.workspaceID, input.workspaceID)),
      ),
    input.workspaceID,
  )
}

interface SuccessData {
  plan: string
  paymentMethodType: string
  paymentMethodLast4?: string
}

function Failure(props: { message: string }) {
  const i18n = useI18n()

  return (
    <div data-slot="failure">
      <p data-slot="message">
        {i18n.t("black.subscribe.failurePrefix")} {props.message}
      </p>
    </div>
  )
}

function Success(props: SuccessData) {
  const i18n = useI18n()

  return (
    <div data-slot="success">
      <p data-slot="title">{i18n.t("black.subscribe.success.title")}</p>
      <dl data-slot="details">
        <div>
          <dt>{i18n.t("black.subscribe.success.subscriptionPlan")}</dt>
          <dd>{i18n.t("black.subscribe.success.planName", { plan: props.plan })}</dd>
        </div>
        <div>
          <dt>{i18n.t("black.subscribe.success.amount")}</dt>
          <dd>{i18n.t("black.subscribe.success.amountValue", { plan: props.plan })}</dd>
        </div>
        <div>
          <dt>{i18n.t("black.subscribe.success.paymentMethod")}</dt>
          <dd>
            <Show when={props.paymentMethodLast4} fallback={<span>{props.paymentMethodType}</span>}>
              <span>
                {props.paymentMethodType} - {props.paymentMethodLast4}
              </span>
            </Show>
          </dd>
        </div>
        <div>
          <dt>{i18n.t("black.subscribe.success.dateJoined")}</dt>
          <dd>{new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</dd>
        </div>
      </dl>
      <p data-slot="charge-notice">{i18n.t("black.subscribe.success.chargeNotice")}</p>
    </div>
  )
}

function IntentForm(props: { plan: PlanID; workspaceID: string; onSuccess: (data: SuccessData) => void }) {
  const i18n = useI18n()
  const stripe = useStripe()
  const elements = useElements()
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [loading, setLoading] = createSignal(false)

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    if (!stripe() || !elements()) return

    setLoading(true)
    setError(undefined)

    const result = await elements()!.submit()
    if (result.error) {
      setError(result.error.message ?? i18n.t("black.subscribe.error.generic"))
      setLoading(false)
      return
    }

    const { error: confirmError, setupIntent } = await stripe()!.confirmSetup({
      elements: elements()!,
      confirmParams: {
        expand: ["payment_method"],
        payment_method_data: {
          allow_redisplay: "always",
        },
      },
      redirect: "if_required",
    })

    if (confirmError) {
      setError(confirmError.message ?? i18n.t("black.subscribe.error.generic"))
      setLoading(false)
      return
    }

    if (setupIntent?.status === "succeeded") {
      const pm = setupIntent.payment_method as PaymentMethod

      await bookSubscription({
        workspaceID: props.workspaceID,
        plan: props.plan,
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
        {loading() ? i18n.t("black.subscribe.processing") : i18n.t("black.subscribe.submit", { plan: props.plan })}
      </button>
      <p data-slot="charge-notice">{i18n.t("black.subscribe.form.chargeNotice")}</p>
    </form>
  )
}

export default function BlackSubscribe() {
  const params = useParams()
  const i18n = useI18n()
  const language = useLanguage()
  const enabled = createAsync(() => getEnabled())
  const planData = plansMap[(params.plan as PlanID) ?? "20"] ?? plansMap["20"]
  const plan = planData.id

  const workspaces = createAsync(() => getWorkspaces(plan))
  const [selectedWorkspace, setSelectedWorkspace] = createSignal<string | undefined>(undefined)
  const [success, setSuccess] = createSignal<SuccessData | undefined>(undefined)
  const [failure, setFailure] = createSignal<string | undefined>(undefined)
  const [clientSecret, setClientSecret] = createSignal<string | undefined>(undefined)
  const [stripe, setStripe] = createSignal<Stripe | undefined>(undefined)

  const formatError = (error: string) => {
    if (error === formError.invalidPlan) return i18n.t("black.subscribe.error.invalidPlan")
    if (error === formError.workspaceRequired) return i18n.t("black.subscribe.error.workspaceRequired")
    if (error === formError.alreadySubscribed) return i18n.t("black.subscribe.error.alreadySubscribed")
    if (error === "Invalid plan") return i18n.t("black.subscribe.error.invalidPlan")
    if (error === "Workspace ID is required") return i18n.t("black.subscribe.error.workspaceRequired")
    if (error === "This workspace already has a subscription") return i18n.t("black.subscribe.error.alreadySubscribed")
    return error
  }

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
  createEffect(async () => {
    const id = selectedWorkspace()
    if (!id) return

    const ws = workspaces()?.find((w) => w.id === id)
    if (ws?.billing?.subscriptionID) {
      setFailure(i18n.t("black.subscribe.error.alreadySubscribed"))
      return
    }
    if (ws?.billing?.paymentMethodID) {
      if (!ws?.billing?.timeSubscriptionBooked) {
        await bookSubscription({
          workspaceID: id,
          plan: planData.id,
          paymentMethodID: ws.billing.paymentMethodID!,
          paymentMethodType: ws.billing.paymentMethodType!,
          paymentMethodLast4: ws.billing.paymentMethodLast4 ?? undefined,
        })
      }
      setSuccess({
        plan: planData.id,
        paymentMethodType: ws.billing.paymentMethodType!,
        paymentMethodLast4: ws.billing.paymentMethodLast4 ?? undefined,
      })
      return
    }

    const result = await createSetupIntent({ plan, workspaceID: id })
    if (result.error) {
      setFailure(formatError(result.error))
    } else if ("clientSecret" in result) {
      setClientSecret(result.clientSecret)
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

  let listRef: HTMLUListElement | undefined

  // Show workspace picker if multiple workspaces and none selected
  const showWorkspacePicker = () => {
    const ws = workspaces()
    return ws && ws.length > 1 && !selectedWorkspace()
  }

  return (
    <Show when={enabled()}>
      <Title>{i18n.t("black.subscribe.title")}</Title>
      <section data-slot="subscribe-form">
        <div data-slot="form-card">
          <Switch>
            <Match when={success()}>{(data) => <Success {...data()} />}</Match>
            <Match when={failure()}>{(data) => <Failure message={data()} />}</Match>
            <Match when={true}>
              <>
                <div data-slot="plan-header">
                  <p data-slot="title">{i18n.t("black.subscribe.title")}</p>
                  <p data-slot="price">
                    <span data-slot="amount">${planData.id}</span>{" "}
                    <span data-slot="period">{i18n.t("black.price.perMonth")}</span>
                    <Show when={planData.multiplier}>
                      {(multiplier) => <span data-slot="multiplier">{i18n.t(multiplier())}</span>}
                    </Show>
                  </p>
                </div>
                <div data-slot="divider" />
                <p data-slot="section-title">{i18n.t("black.subscribe.paymentMethod")}</p>

                <Show
                  when={clientSecret() && selectedWorkspace() && stripe()}
                  fallback={
                    <div data-slot="loading">
                      <p>
                        {selectedWorkspace()
                          ? i18n.t("black.subscribe.loadingPaymentForm")
                          : i18n.t("black.subscribe.selectWorkspaceToContinue")}
                      </p>
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
                    <IntentForm plan={plan} workspaceID={selectedWorkspace()!} onSuccess={setSuccess} />
                  </Elements>
                </Show>
              </>
            </Match>
          </Switch>
        </div>

        {/* Workspace picker modal */}
        <Modal open={showWorkspacePicker() ?? false} onClose={() => {}} title={i18n.t("black.workspace.selectPlan")}>
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
          {i18n.t("black.finePrint.beforeTerms")} ·{" "}
          <A href={language.route("/legal/terms-of-service")}>{i18n.t("black.finePrint.terms")}</A>
        </p>
      </section>
    </Show>
  )
}
