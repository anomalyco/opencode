import { Hono } from "hono"
import { cors } from "hono/cors"

// ---- 設定（すべて環境変数）----
const GCP_PROJECT = process.env.GCP_PROJECT
const FIRESTORE_COLLECTION = process.env.FIRESTORE_COLLECTION ?? "waitlist"
const FIRESTORE_DATABASE = process.env.FIRESTORE_DATABASE ?? "(default)"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
const PORT = Number(process.env.PORT) || 8080

if (!GCP_PROJECT) throw new Error("GCP_PROJECT is required")

const DEFAULT_STATUS = "未案内"
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const FIRESTORE_BASE =
  `https://firestore.googleapis.com/v1/projects/${GCP_PROJECT}` +
  `/databases/${encodeURIComponent(FIRESTORE_DATABASE)}/documents`

// ---- アクセストークン取得 ----
// Cloud Run 上ではメタデータサーバから SA トークンを取得（gRPC SDK 不要）。
// ローカルでは GOOGLE_ACCESS_TOKEN（`gcloud auth print-access-token`）で上書き。
let cachedToken: { value: string; expiresAt: number } | null = null
async function getAccessToken(): Promise<string> {
  const local = process.env.GOOGLE_ACCESS_TOKEN
  if (local) return local

  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.value

  const res = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  )
  if (!res.ok) throw new Error(`metadata token fetch failed: ${res.status}`)
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = { value: json.access_token, expiresAt: now + json.expires_in * 1000 }
  return cachedToken.value
}

// email の SHA-256 hex を doc ID にする。doc ID 制約の回避＋簡易な擬似匿名化。
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// Firestore createDocument。documentId 指定の作成は既存なら 409 を返すので
// それを重複として扱う（原子的な重複排除）。
async function createWaitlistDoc(
  email: string,
  source: string,
): Promise<"created" | "duplicate"> {
  const id = await sha256Hex(email)
  const token = await getAccessToken()
  const url = `${FIRESTORE_BASE}/${FIRESTORE_COLLECTION}?documentId=${id}`
  const body = {
    fields: {
      email: { stringValue: email },
      registeredAt: { timestampValue: new Date().toISOString() },
      status: { stringValue: DEFAULT_STATUS },
      ...(source ? { source: { stringValue: source } } : {}),
    },
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (res.status === 409) return "duplicate" // ALREADY_EXISTS
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`firestore create failed: ${res.status} ${text}`)
  }
  return "created"
}

const app = new Hono()

app.use(
  "/*",
  cors({
    // 本番では LP のオリジンのみ許可（未設定時のみ * にフォールバック）
    origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : "*",
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  }),
)

app.get("/healthz", (c) => c.json({ ok: true }))

app.post("/waitlist", async (c) => {
  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400)
  }

  // honeypot: bot が隠しフィールドを埋めたら成功扱いで黙って捨てる
  const honeypot = typeof body.website === "string" ? body.website.trim() : ""
  if (honeypot) return c.json({ ok: true })

  const email = (typeof body.email === "string" ? body.email : "")
    .trim()
    .toLowerCase()
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return c.json({ ok: false, error: "invalid_email" }, 400)
  }

  const source = typeof body.source === "string" ? body.source.slice(0, 200) : ""

  try {
    const result = await createWaitlistDoc(email, source)
    return c.json({ ok: true, duplicate: result === "duplicate" })
  } catch (err) {
    console.error("waitlist 登録に失敗", err)
    return c.json({ ok: false, error: "internal_error" }, 500)
  }
})

export default { port: PORT, fetch: app.fetch }
