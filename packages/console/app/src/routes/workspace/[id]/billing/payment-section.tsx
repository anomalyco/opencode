import { Billing } from "@opencode-ai/console-core/billing.js"
import { query, action, useParams, createAsync, useAction } from "@solidjs/router"
import { For, Match, Show, Switch } from "solid-js"
import { withActor } from "~/context/auth.withActor"
import { formatDateUTC, formatDateForTable } from "../../common"
import styles from "./payment-section.module.css"

const getPaymentsInfo = query(async (workspaceID: string) => {
  "use server"
  return withActor(async () => {
    return await Billing.payments()
  }, workspaceID)
}, "payment.list")

const downloadReceipt = action(async (workspaceID: string, paymentID: string) => {
  "use server"
  return withActor(() => Billing.generateReceiptUrl({ paymentID }), workspaceID)
}, "receipt.download")

export function PaymentSection() {
  const params = useParams()
  const payments = createAsync(() => getPaymentsInfo(params.id!))
  const downloadReceiptAction = useAction(downloadReceipt)

  // DUMMY DATA FOR TESTING
  // const payments = () => [
  //   {
  //     id: "pi_3QK1x2FT9vXn4A6r1234567890",
  //     paymentID: "pi_3QK1x2FT9vXn4A6r1234567890",
  //     timeCreated: new Date(Date.now() - 86400000 * 1).toISOString(), // 1 day ago
  //     amount: 2100000000, // $21.00 ($20 + $1 fee)
  //   },
  //   {
  //     id: "pi_3QJ8k7FT9vXn4A6r0987654321",
  //     paymentID: "pi_3QJ8k7FT9vXn4A6r0987654321",
  //     timeCreated: new Date(Date.now() - 86400000 * 15).toISOString(), // 15 days ago
  //     amount: 2100000000, // $21.00
  //   },
  //   {
  //     id: "pi_3QI5m1FT9vXn4A6r5678901234",
  //     paymentID: "pi_3QI5m1FT9vXn4A6r5678901234",
  //     timeCreated: new Date(Date.now() - 86400000 * 32).toISOString(), // 32 days ago
  //     amount: 2100000000, // $21.00
  //   },
  //   {
  //     id: "pi_3QH2n9FT9vXn4A6r3456789012",
  //     paymentID: "pi_3QH2n9FT9vXn4A6r3456789012",
  //     timeCreated: new Date(Date.now() - 86400000 * 47).toISOString(), // 47 days ago
  //     amount: 2100000000, // $21.00
  //   },
  //   {
  //     id: "pi_3QG7p4FT9vXn4A6r7890123456",
  //     paymentID: "pi_3QG7p4FT9vXn4A6r7890123456",
  //     timeCreated: new Date(Date.now() - 86400000 * 63).toISOString(), // 63 days ago
  //     amount: 2100000000, // $21.00
  //   },
  // ]

  return (
    <Show when={payments() && payments()!.length > 0}>
      <section class={styles.root}>
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
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              <For each={payments()!}>
                {(payment) => {
                  const date = new Date(payment.timeCreated)
                  const amount =
                    payment.enrichment?.type === "subscription" && payment.enrichment.couponID ? 0 : payment.amount
                  return (
                    <tr>
                      <td data-slot="payment-date" title={formatDateUTC(date)}>
                        {formatDateForTable(date)}
                      </td>
                      <td data-slot="payment-id">{payment.id}</td>
                      <td data-slot="payment-amount" data-refunded={!!payment.timeRefunded}>
                        ${((amount ?? 0) / 100000000).toFixed(2)}
                        <Switch>
                          <Match when={payment.enrichment?.type === "credit"}> (credit)</Match>
                          <Match when={payment.enrichment?.type === "subscription"}> (subscription)</Match>
                        </Switch>
                      </td>
                      <td data-slot="payment-receipt">
                        {payment.paymentID ? (
                          <button
                            onClick={async () => {
                              const receiptUrl = await downloadReceiptAction(params.id!, payment.paymentID!)
                              if (receiptUrl) {
                                window.open(receiptUrl, "_blank")
                              }
                            }}
                            data-slot="receipt-button"
                          >
                            View
                          </button>
                        ) : (
                          <span>-</span>
                        )}
                      </td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </div>
      </section>
    </Show>
  )
}
