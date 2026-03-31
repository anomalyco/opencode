import Langfuse from "langfuse"
import { Log } from "../util/log"

const log = Log.create({ service: "langfuse" })

let client: Langfuse | undefined
let initFailed = false

export function getLangfuse(): Langfuse | undefined {
  if (client) return client
  if (initFailed) return undefined

  const secretKey = process.env.LANGFUSE_SECRET_KEY
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const baseUrl = process.env.LANGFUSE_BASE_URL

  if (!secretKey || !publicKey) {
    log.info("langfuse disabled: missing LANGFUSE_SECRET_KEY or LANGFUSE_PUBLIC_KEY")
    initFailed = true
    return undefined
  }

  try {
    client = new Langfuse({
      secretKey,
      publicKey,
      baseUrl: baseUrl ?? "https://cloud.langfuse.com",
    })
    log.info("langfuse initialized", { baseUrl })
    return client
  } catch (e) {
    log.error("langfuse init failed", { error: e })
    initFailed = true
    return undefined
  }
}

export async function flushLangfuse() {
  if (client) {
    await client.flushAsync()
  }
}
