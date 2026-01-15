import z from "zod"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { Log } from "../util/log"
import { TuiEvent } from "../cli/cmd/tui/event"

const log = Log.create({ service: "credential-manager" })

export namespace CredentialManager {
  export const Event = {
    Failover: BusEvent.define(
      "credential.failover",
      z.object({
        providerID: z.string(),
        fromRecordID: z.string(),
        toRecordID: z.string().optional(),
        statusCode: z.number(),
        message: z.string(),
      }),
    ),
  }

  export async function notifyFailover(input: {
    providerID: string
    fromRecordID: string
    toRecordID?: string
    statusCode: number
  }): Promise<void> {
    const isRateLimit = input.statusCode === 429
    const message = isRateLimit
      ? `Rate limited on "${input.providerID}". Switching OAuth credential...`
      : `Auth error on "${input.providerID}". Switching OAuth credential...`

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
      duration: 8000,
    }).catch((error) => log.debug("failed to show failover toast", { error }))
  }
}
