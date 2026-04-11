import { randomUUID } from "node:crypto"
import { and, desc, eq, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"
import { send } from "./apns"
import { db } from "./db"
import { env } from "./env"
import { hash } from "./hash"
import { delivery_log, device_registration } from "./schema.sql"
import { setup } from "./setup"

function bad(input?: string) {
  if (!input) return false
  return input.includes("BadEnvironmentKeyInToken")
}

function flip(input: "sandbox" | "production") {
  if (input === "sandbox") return "production"
  return "sandbox"
}

function tail(input: string) {
  return input.slice(-8)
}

function esc(input: unknown) {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function fmt(input: number) {
  return new Date(input).toISOString()
}

const reg = z.object({
  secret: z.string().min(1),
  deviceToken: z.string().min(1),
  bundleId: z.string().min(1).optional(),
  apnsEnv: z.enum(["sandbox", "production"]).default("production"),
})

const unreg = z.object({
  secret: z.string().min(1),
  deviceToken: z.string().min(1),
})

const evt = z.object({
  secret: z.string().min(1),
  serverID: z.string().min(1).optional(),
  eventType: z.enum(["complete", "permission", "error"]),
  sessionID: z.string().min(1),
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
})

function title(input: z.infer<typeof evt>["eventType"]) {
  if (input === "complete") return "Session complete"
  if (input === "permission") return "Action needed"
  return "Session error"
}

function body(input: z.infer<typeof evt>["eventType"]) {
  if (input === "complete") return "OpenCode finished your session."
  if (input === "permission") return "OpenCode needs your permission decision."
  return "OpenCode reported an error for your session."
}

const app = new Hono()

app.onError((err, c) => {
  return c.json(
    {
      ok: false,
      error: err.message,
    },
    500,
  )
})

app.notFound((c) => {
  return c.json(
    {
      ok: false,
      error: "Not found",
    },
    404,
  )
})

app.get("/health", async (c) => {
  const [a] = await db.select({ value: sql<number>`count(*)` }).from(device_registration)
  const [b] = await db.select({ value: sql<number>`count(*)` }).from(delivery_log)
  return c.json({
    ok: true,
    devices: Number(a?.value ?? 0),
    deliveries: Number(b?.value ?? 0),
  })
})

app.get("/", async (c) => {
  const [a] = await db.select({ value: sql<number>`count(*)` }).from(device_registration)
  const [b] = await db.select({ value: sql<number>`count(*)` }).from(delivery_log)
  const devices = await db.select().from(device_registration).orderBy(desc(device_registration.updated_at)).limit(100)
  const byBundle = await db
    .select({
      bundle: device_registration.bundle_id,
      env: device_registration.apns_env,
      value: sql<number>`count(*)`,
    })
    .from(device_registration)
    .groupBy(device_registration.bundle_id, device_registration.apns_env)
    .orderBy(desc(sql<number>`count(*)`))
  const rows = await db.select().from(delivery_log).orderBy(desc(delivery_log.created_at)).limit(20)

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>APN Relay</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; color: #111827; }
      h1 { margin: 0 0 12px 0; }
      h2 { margin: 22px 0 10px 0; font-size: 16px; }
      .stats { display: flex; gap: 16px; margin: 0 0 18px 0; }
      .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; min-width: 160px; }
      .muted { color: #6b7280; font-size: 12px; }
      .small { font-size: 11px; color: #6b7280; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #e5e7eb; text-align: left; padding: 8px; font-size: 12px; }
      th { background: #f9fafb; }
    </style>
  </head>
  <body>
    <h1>APN Relay</h1>
    <p class="muted">MVP dashboard</p>
    <div class="stats">
      <div class="card">
        <div class="muted">Registered devices</div>
        <div>${Number(a?.value ?? 0)}</div>
      </div>
      <div class="card">
        <div class="muted">Delivery log rows</div>
        <div>${Number(b?.value ?? 0)}</div>
      </div>
    </div>
    <h2>Registered devices</h2>
    <p class="small">Most recent 100 registrations. Token values are masked to suffix only.</p>
    <table>
      <thead>
        <tr>
          <th>updated</th>
          <th>created</th>
          <th>token suffix</th>
          <th>env</th>
          <th>bundle</th>
          <th>secret hash</th>
        </tr>
      </thead>
      <tbody>
        ${
          devices.length
            ? devices
                .map(
                  (row) => `<tr>
          <td>${esc(fmt(row.updated_at))}</td>
          <td>${esc(fmt(row.created_at))}</td>
          <td>${esc(tail(row.device_token))}</td>
          <td>${esc(row.apns_env)}</td>
          <td>${esc(row.bundle_id)}</td>
          <td>${esc(`${row.secret_hash.slice(0, 12)}…`)}</td>
        </tr>`,
                )
                .join("")
            : `<tr><td colspan="6" class="muted">No devices registered.</td></tr>`
        }
      </tbody>
    </table>
    <h2>Bundle breakdown</h2>
    <table>
      <thead>
        <tr>
          <th>bundle</th>
          <th>env</th>
          <th>count</th>
        </tr>
      </thead>
      <tbody>
        ${
          byBundle.length
            ? byBundle
                .map(
                  (row) => `<tr>
          <td>${esc(row.bundle)}</td>
          <td>${esc(row.env)}</td>
          <td>${esc(Number(row.value ?? 0))}</td>
        </tr>`,
                )
                .join("")
            : `<tr><td colspan="3" class="muted">No device data.</td></tr>`
        }
      </tbody>
    </table>
    <h2>Recent deliveries</h2>
    <table>
      <thead>
        <tr>
          <th>time</th>
          <th>event</th>
          <th>session</th>
          <th>status</th>
          <th>error</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `<tr>
          <td>${esc(fmt(row.created_at))}</td>
          <td>${esc(row.event_type)}</td>
          <td>${esc(row.session_id)}</td>
          <td>${esc(row.status)}</td>
          <td>${esc(row.error ?? "")}</td>
        </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </body>
</html>`

  return c.html(html)
})

app.post("/v1/device/register", async (c) => {
  const raw = await c.req.json().catch(() => undefined)
  const check = reg.safeParse(raw)
  if (!check.success) {
    return c.json(
      {
        ok: false,
        error: "Invalid request body",
      },
      400,
    )
  }

  const now = Date.now()
  const key = hash(check.data.secret)
  const row = {
    id: randomUUID(),
    secret_hash: key,
    device_token: check.data.deviceToken,
    bundle_id: check.data.bundleId ?? env.APNS_DEFAULT_BUNDLE_ID,
    apns_env: check.data.apnsEnv,
    created_at: now,
    updated_at: now,
  }

  console.log("[relay] register", {
    token: tail(row.device_token),
    env: row.apns_env,
    bundle: row.bundle_id,
    secretHash: `${key.slice(0, 12)}...`,
  })

  await db
    .insert(device_registration)
    .values(row)
    .onDuplicateKeyUpdate({
      set: {
        bundle_id: row.bundle_id,
        apns_env: row.apns_env,
        updated_at: now,
      },
    })

  return c.json({ ok: true })
})

app.post("/v1/device/unregister", async (c) => {
  const raw = await c.req.json().catch(() => undefined)
  const check = unreg.safeParse(raw)
  if (!check.success) {
    return c.json(
      {
        ok: false,
        error: "Invalid request body",
      },
      400,
    )
  }

  const key = hash(check.data.secret)

  console.log("[relay] unregister", {
    token: tail(check.data.deviceToken),
    secretHash: `${key.slice(0, 12)}...`,
  })

  await db
    .delete(device_registration)
    .where(and(eq(device_registration.secret_hash, key), eq(device_registration.device_token, check.data.deviceToken)))

  return c.json({ ok: true })
})

app.post("/v1/event", async (c) => {
  const raw = await c.req.json().catch(() => undefined)
  const check = evt.safeParse(raw)
  if (!check.success) {
    return c.json(
      {
        ok: false,
        error: "Invalid request body",
      },
      400,
    )
  }

  const key = hash(check.data.secret)
  const list = await db.select().from(device_registration).where(eq(device_registration.secret_hash, key))
  console.log("[relay] event", {
    type: check.data.eventType,
    serverID: check.data.serverID,
    session: check.data.sessionID,
    secretHash: `${key.slice(0, 12)}...`,
    devices: list.length,
  })
  if (!list.length) {
    const [total] = await db.select({ value: sql<number>`count(*)` }).from(device_registration)
    console.log("[relay] event:no-matching-devices", {
      type: check.data.eventType,
      serverID: check.data.serverID,
      session: check.data.sessionID,
      secretHash: `${key.slice(0, 12)}...`,
      totalDevices: Number(total?.value ?? 0),
    })

    return c.json({
      ok: true,
      sent: 0,
      failed: 0,
    })
  }

  const out = await Promise.all(
    list.map(async (row) => {
      const env = row.apns_env === "sandbox" ? "sandbox" : "production"
      const payload = {
        token: row.device_token,
        bundle: row.bundle_id,
        title: check.data.title ?? title(check.data.eventType),
        body: check.data.body ?? body(check.data.eventType),
        data: {
          serverID: check.data.serverID,
          eventType: check.data.eventType,
          sessionID: check.data.sessionID,
        },
      }
      const first = await send({ ...payload, env })
      if (first.ok || !bad(first.error)) {
        if (!first.ok) {
          console.log("[relay] send:error", {
            token: tail(row.device_token),
            env,
            error: first.error,
          })
        }
        return first
      }

      const alt = flip(env)
      console.log("[relay] send:retry-env", {
        token: tail(row.device_token),
        from: env,
        to: alt,
      })
      const second = await send({ ...payload, env: alt })
      if (!second.ok) {
        console.log("[relay] send:error", {
          token: tail(row.device_token),
          env: alt,
          error: second.error,
        })
        return second
      }

      await db
        .update(device_registration)
        .set({ apns_env: alt, updated_at: Date.now() })
        .where(
          and(
            eq(device_registration.secret_hash, row.secret_hash),
            eq(device_registration.device_token, row.device_token),
          ),
        )

      console.log("[relay] send:env-updated", {
        token: tail(row.device_token),
        env: alt,
      })
      return second
    }),
  )

  const now = Date.now()
  await db.insert(delivery_log).values(
    out.map((item) => ({
      id: randomUUID(),
      secret_hash: key,
      event_type: check.data.eventType,
      session_id: check.data.sessionID,
      status: item.ok ? "sent" : "failed",
      error: item.error,
      created_at: now,
    })),
  )

  const sent = out.filter((item) => item.ok).length
  console.log("[relay] event:done", {
    type: check.data.eventType,
    session: check.data.sessionID,
    sent,
    failed: out.length - sent,
  })
  return c.json({
    ok: true,
    sent,
    failed: out.length - sent,
  })
})

await setup()

if (import.meta.main) {
  Bun.serve({
    port: env.PORT,
    fetch: app.fetch,
  })
  console.log(`apn-relay listening on http://0.0.0.0:${env.PORT}`)
}

export { app }
