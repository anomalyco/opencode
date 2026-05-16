import { Schema } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import * as Log from "@opencode-ai/core/util/log"
import { TuiEvent } from "@/cli/cmd/tui/event"

const log = Log.create({ service: "credential-manager" })
const DEFAULT_FAILOVER_TOAST_MS = 8000

export namespace CredentialManager {
  export const Event = {
    Failover: BusEvent.define(
      "credential.failover",
      Schema.Struct({
        providerID: Schema.String,
        fromRecordID: Schema.String,
        toRecordID: Schema.optional(Schema.String),
        statusCode: Schema.Number,
        message: Schema.String,
      }),
    ),
  }

  export async function notifyFailover(input: {
    providerID: string
    fromRecordID: string
    toRecordID?: string
    statusCode: number
    toastDurationMs?: number
  }): Promise<void> {
    const isRateLimit = input.statusCode === 429
    const message = isRateLimit
      ? `Rate limited on "${input.providerID}". Switching OAuth credential...`
      : input.statusCode === 0
        ? `Request failed on "${input.providerID}". Switching OAuth credential...`
        : `Auth error on "${input.providerID}". Switching OAuth credential...`
    const duration = Math.max(0, input.toastDurationMs ?? DEFAULT_FAILOVER_TOAST_MS)

    log.info("oauth credential failover", {
      providerID: input.providerID,
      fromRecordID: input.fromRecordID,
      toRecordID: input.toRecordID,
      statusCode: input.statusCode,
    })

    await Bus.publish(Event.Failover, {
      providerID: input.providerID,
      fromRecordID: input.fromRecordID,
      toRecordID: input.toRecordID,
      statusCode: input.statusCode,
      message,
    }).catch((error) => log.debug("failed to publish credential failover event", { error }))

    await Bus.publish(TuiEvent.ToastShow, {
      title: "OAuth Credential Failover",
      message,
      variant: "warning",
      duration,
    }).catch((error) => log.debug("failed to show failover toast", { error }))
  }
}
