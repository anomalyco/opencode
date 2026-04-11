import { connect } from "node:http2"
import { SignJWT, importPKCS8 } from "jose"
import { env } from "./env"

export type PushEnv = "sandbox" | "production"

type PushInput = {
  token: string
  bundle: string
  env: PushEnv
  title: string
  body: string
  data: Record<string, unknown>
}

type PushResult = {
  ok: boolean
  code: number
  error?: string
}

function tokenSuffix(input: string) {
  return input.length > 8 ? input.slice(-8) : input
}

let jwt = ""
let exp = 0
let pk: Awaited<ReturnType<typeof importPKCS8>> | undefined

function host(input: PushEnv) {
  if (input === "sandbox") return "api.sandbox.push.apple.com"
  return "api.push.apple.com"
}

function key() {
  if (env.APNS_PRIVATE_KEY.includes("\\n")) return env.APNS_PRIVATE_KEY.replace(/\\n/g, "\n")
  return env.APNS_PRIVATE_KEY
}

async function sign() {
  if (!pk) pk = await importPKCS8(key(), "ES256")
  const now = Math.floor(Date.now() / 1000)
  if (jwt && now < exp) return jwt
  jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.APNS_KEY_ID })
    .setIssuer(env.APNS_TEAM_ID)
    .setIssuedAt(now)
    .sign(pk)
  exp = now + 50 * 60
  return jwt
}

function post(input: {
  host: string
  token: string
  auth: string
  bundle: string
  payload: string
}): Promise<{ code: number; body: string }> {
  return new Promise((resolve, reject) => {
    const cli = connect(`https://${input.host}`)
    let done = false
    let code = 0
    let body = ""

    const stop = (fn: () => void) => {
      if (done) return
      done = true
      fn()
    }

    cli.on("error", (err) => {
      stop(() => reject(err))
      cli.close()
    })

    const req = cli.request({
      ":method": "POST",
      ":path": `/3/device/${input.token}`,
      authorization: `bearer ${input.auth}`,
      "apns-topic": input.bundle,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    })

    req.setEncoding("utf8")
    req.on("response", (headers) => {
      code = Number(headers[":status"] ?? 0)
    })
    req.on("data", (chunk) => {
      body += chunk
    })
    req.on("end", () => {
      stop(() => resolve({ code, body }))
      cli.close()
    })
    req.on("error", (err) => {
      stop(() => reject(err))
      cli.close()
    })
    req.end(input.payload)
  })
}

export async function send(input: PushInput): Promise<PushResult> {
  const apnsHost = host(input.env)
  const suffix = tokenSuffix(input.token)

  console.log("[ APN RELAY ] push:start", {
    env: input.env,
    host: apnsHost,
    bundle: input.bundle,
    tokenSuffix: suffix,
  })

  const auth = await sign().catch((err) => {
    return `error:${String(err)}`
  })
  if (auth.startsWith("error:")) {
    console.log("[ APN RELAY ] push:auth-failed", {
      env: input.env,
      host: apnsHost,
      bundle: input.bundle,
      tokenSuffix: suffix,
      error: auth,
    })
    return {
      ok: false,
      code: 0,
      error: auth,
    }
  }

  const payload = JSON.stringify({
    aps: {
      alert: {
        title: input.title,
        body: input.body,
      },
      sound: "alert.wav",
    },
    ...input.data,
  })

  const out = await post({
    host: apnsHost,
    token: input.token,
    auth,
    bundle: input.bundle,
    payload,
  }).catch((err) => ({
    code: 0,
    body: String(err),
  }))

  if (out.code === 200) {
    console.log("[ APN RELAY ] push:sent", {
      env: input.env,
      host: apnsHost,
      bundle: input.bundle,
      tokenSuffix: suffix,
      code: out.code,
    })
    return {
      ok: true,
      code: 200,
    }
  }

  console.log("[ APN RELAY ] push:failed", {
    env: input.env,
    host: apnsHost,
    bundle: input.bundle,
    tokenSuffix: suffix,
    code: out.code,
    error: out.body,
  })

  return {
    ok: false,
    code: out.code,
    error: out.body,
  }
}
