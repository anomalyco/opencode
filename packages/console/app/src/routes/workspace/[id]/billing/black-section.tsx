import { action, useParams, useAction, useSubmission, json } from "@solidjs/router"
import { createStore } from "solid-js/store"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { withActor } from "~/context/auth.withActor"
import { queryBillingInfo } from "../../common"
import styles from "./black-section.module.css"

const createSessionUrl = action(async (workspaceID: string, returnUrl: string) => {
  "use server"
  return json(
    await withActor(
      () =>
        Billing.generateSessionUrl({ returnUrl })
          .then((data) => ({ error: undefined, data }))
          .catch((e) => ({
            error: e.message as string,
            data: undefined,
          })),
      workspaceID,
    ),
    { revalidate: queryBillingInfo.key },
  )
}, "sessionUrl")

export function BlackSection() {
  const params = useParams()
  const sessionAction = useAction(createSessionUrl)
  const sessionSubmission = useSubmission(createSessionUrl)
  const [store, setStore] = createStore({
    sessionRedirecting: false,
  })

  async function onClickSession() {
    const result = await sessionAction(params.id!, window.location.href)
    if (result.data) {
      setStore("sessionRedirecting", true)
      window.location.href = result.data
    }
  }

  return (
    <section class={styles.root}>
      <div data-slot="section-title">
        <h2>Subscription</h2>
        <div data-slot="title-row">
          <p>You are subscribed to OpenCode Black for $200 per month.</p>
          <button
            data-color="primary"
            disabled={sessionSubmission.pending || store.sessionRedirecting}
            onClick={onClickSession}
          >
            {sessionSubmission.pending || store.sessionRedirecting ? "Loading..." : "Manage Subscription"}
          </button>
        </div>
      </div>
    </section>
  )
}
