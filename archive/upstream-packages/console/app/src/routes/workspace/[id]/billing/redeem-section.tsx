import { json, action, useParams, useSubmission } from "@solidjs/router"
import { Show } from "solid-js"
import { withActor } from "~/context/auth.withActor"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { User } from "@opencode-ai/console-core/user.js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { CouponType } from "@opencode-ai/console-core/schema/billing.sql.js"
import styles from "./redeem-section.module.css"
import { queryBillingInfo } from "../../common"
import { useI18n } from "~/context/i18n"
import { formError, localizeError } from "~/lib/form-error"

const redeem = action(async (form: FormData) => {
  "use server"
  const workspaceID = form.get("workspaceID") as string | null
  if (!workspaceID) return { error: formError.workspaceRequired }
  const code = (form.get("code") as string | null)?.trim().toUpperCase()
  if (!code) return { error: "Coupon code is required." }
  if (!(CouponType as readonly string[]).includes(code)) return { error: "Invalid coupon code." }

  return json(
    await withActor(async () => {
      const actor = Actor.assert("user")
      const email = await User.getAuthEmail(actor.properties.userID)
      if (!email) return { error: "No email on account." }
      return Billing.redeemCoupon(email, code as (typeof CouponType)[number])
        .then(() => ({ error: undefined, data: true }))
        .catch((e) => ({ error: e.message as string }))
    }, workspaceID),
    { revalidate: queryBillingInfo.key },
  )
}, "billing.redeemCoupon")

export function RedeemSection() {
  const params = useParams()
  const i18n = useI18n()
  const submission = useSubmission(redeem)

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>{i18n.t("workspace.redeem.title")}</h2>
        <p>{i18n.t("workspace.redeem.subtitle")}</p>
      </div>
      <div data-slot="redeem-container">
        <form action={redeem} method="post" data-slot="redeem-form">
          <div data-slot="input-row">
            <input
              required
              data-component="input"
              name="code"
              type="text"
              autocomplete="off"
              placeholder={i18n.t("workspace.redeem.placeholder")}
            />
            <button type="submit" data-color="primary" disabled={submission.pending}>
              {submission.pending ? i18n.t("workspace.redeem.redeeming") : i18n.t("workspace.redeem.redeem")}
            </button>
          </div>
          <Show when={submission.result && (submission.result as any).error}>
            {(err: any) => <div data-slot="form-error">{localizeError(i18n.t, err())}</div>}
          </Show>
          <Show when={submission.result && !(submission.result as any).error && (submission.result as any).data}>
            <div data-slot="form-success">{i18n.t("workspace.redeem.success")}</div>
          </Show>
          <input type="hidden" name="workspaceID" value={params.id} />
        </form>
      </div>
    </section>
  )
}
