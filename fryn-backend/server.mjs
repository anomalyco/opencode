import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { hostname } from "node:os"
import { join, resolve } from "node:path"

const PORT = integerEnv("PORT", 8787, 1, 65535)
const MAX_LICENSES = integerEnv("FRYN_MAX_LICENSES", 12, 1, 1000)
const REQUESTS_PER_MINUTE = integerEnv("FRYN_REQUESTS_PER_MINUTE", 30, 1, 10000)
const MAX_BODY_BYTES = integerEnv("FRYN_MAX_BODY_MB", 50, 1, 500) * 1024 * 1024
const DATA_DIR = resolve(process.env.FRYN_DATA_DIR || "./data")
const DB_PATH = join(DATA_DIR, "licenses.json")
const OPENROUTER_API_KEY = requiredEnv("OPENROUTER_API_KEY")
const ADMIN_TOKEN = requiredEnv("FRYN_ADMIN_TOKEN")
const UPSTREAM_BASE_URL = normalizeBaseUrl(process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1")
const FREE_MODELS = modelListEnv(
  "FRYN_FREE_MODELS",
  ["cohere/north-mini-code:free", "qwen/qwen3-coder:free", "openrouter/free"],
)
const ENABLE_PAID_FALLBACK = booleanEnv("FRYN_ENABLE_PAID_FALLBACK", true)
const PAID_FALLBACK_MODEL = process.env.FRYN_PAID_FALLBACK_MODEL?.trim() || "qwen/qwen3.7-flash"
const DATA_COLLECTION = enumEnv("FRYN_DATA_COLLECTION", "allow", ["allow", "deny"])
const REQUIRE_ZDR = booleanEnv("FRYN_REQUIRE_ZDR", false)
// OpenRouter currently accepts at most 3 entries in the `models` fallback array.
// Keep free models in batches of three and perform the optional paid fallback as
// a separate backend retry so employees still see one logical "Fryn AI" model.
const MAX_UPSTREAM_MODELS_PER_REQUEST = 3
const FREE_MODEL_BATCHES = []
for (let i = 0; i < FREE_MODELS.length; i += MAX_UPSTREAM_MODELS_PER_REQUEST) {
  FREE_MODEL_BATCHES.push(FREE_MODELS.slice(i, i + MAX_UPSTREAM_MODELS_PER_REQUEST))
}
const KNOWN_MODELS = [...FREE_MODELS, ...(ENABLE_PAID_FALLBACK ? [PAID_FALLBACK_MODEL] : [])]

const rateWindows = new Map()
let writeChain = Promise.resolve()
let state = await loadState()

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    console.error(`[Fryn] Variavel obrigatoria ausente: ${name}`)
    process.exit(1)
  }
  return value
}

function integerEnv(name, fallback, min, max) {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < min || value > max) {
    console.error(`[Fryn] ${name} deve ser um inteiro entre ${min} e ${max}.`)
    process.exit(1)
  }
  return value
}

function booleanEnv(name, fallback) {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  if (["1", "true", "yes", "on"].includes(raw)) return true
  if (["0", "false", "no", "off"].includes(raw)) return false
  console.error(`[Fryn] ${name} deve ser true ou false.`)
  process.exit(1)
}

function enumEnv(name, fallback, allowed) {
  const raw = process.env[name]?.trim().toLowerCase() || fallback
  if (!allowed.includes(raw)) {
    console.error(`[Fryn] ${name} deve ser um de: ${allowed.join(", ")}.`)
    process.exit(1)
  }
  return raw
}

function modelListEnv(name, fallback) {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const values = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  if (!values.length || values.some((item) => !/^[A-Za-z0-9_.~:-]+\/[A-Za-z0-9_.~:-]+$/.test(item))) {
    console.error(`[Fryn] ${name} contem um identificador de modelo invalido.`)
    process.exit(1)
  }
  return [...new Set(values)]
}

function normalizeBaseUrl(value) {
  const url = new URL(value)
  if (!/^https?:$/.test(url.protocol)) throw new Error("OPENROUTER_BASE_URL precisa usar http ou https")
  return url.toString().replace(/\/$/, "")
}

function cleanText(value, max = 160) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : ""
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex")
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  return aa.length === bb.length && timingSafeEqual(aa, bb)
}

function newLicenseToken() {
  return `fryn_${randomBytes(32).toString("base64url")}`
}

function activeLicenses() {
  return state.licenses.filter((license) => license.status === "active")
}

function nextSlot() {
  const used = new Set(activeLicenses().map((license) => license.slot))
  for (let slot = 1; slot <= MAX_LICENSES; slot++) if (!used.has(slot)) return slot
  return null
}

async function loadState() {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    const parsed = JSON.parse(await readFile(DB_PATH, "utf8"))
    if (parsed?.version === 1 && Array.isArray(parsed.licenses)) return parsed
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("[Fryn] Banco de licencas invalido; criando novo.")
  }
  const initial = { version: 1, licenses: [] }
  await persistState(initial)
  return initial
}

async function persistState(nextState = state) {
  const snapshot = JSON.stringify(nextState, null, 2)
  writeChain = writeChain.then(async () => {
    const temp = `${DB_PATH}.tmp`
    await writeFile(temp, snapshot, { mode: 0o600 })
    await rename(temp, DB_PATH)
  })
  return writeChain
}

function json(res, status, body, headers = {}) {
  const data = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": data.length,
    "cache-control": "no-store",
    ...headers,
  })
  res.end(data)
}

function text(res, status, body, type = "text/plain; charset=utf-8") {
  const data = Buffer.from(body)
  res.writeHead(status, {
    "content-type": type,
    "content-length": data.length,
    "cache-control": "no-store",
  })
  res.end(data)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error("request_too_large")
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(req) {
  const raw = await readBody(req)
  if (!raw.length) return {}
  try {
    return JSON.parse(raw.toString("utf8"))
  } catch {
    const error = new Error("invalid_json")
    error.status = 400
    throw error
  }
}

function bearer(req) {
  const value = req.headers.authorization || ""
  const match = /^Bearer\s+(.+)$/i.exec(value)
  return match?.[1]?.trim() || ""
}

function adminAuthorized(req) {
  const provided = req.headers["x-admin-token"] || bearer(req)
  return typeof provided === "string" && safeEqual(provided, ADMIN_TOKEN)
}

function licenseFromRequest(req) {
  const token = bearer(req)
  if (!token) return null
  const tokenHash = hashToken(token)
  const license = state.licenses.find((item) => item.tokenHash === tokenHash)
  if (!license || license.status !== "active") return null
  return license
}

function rateAllowed(license) {
  const now = Date.now()
  const key = license.id
  const recent = (rateWindows.get(key) || []).filter((time) => now - time < 60_000)
  if (recent.length >= REQUESTS_PER_MINUTE) {
    rateWindows.set(key, recent)
    return false
  }
  recent.push(now)
  rateWindows.set(key, recent)
  return true
}

function publicLicense(license) {
  return {
    id: license.id,
    slot: license.slot,
    status: license.status,
    deviceName: license.deviceName,
    platform: license.platform,
    appVersion: license.appVersion,
    createdAt: license.createdAt,
    lastSeenAt: license.lastSeenAt,
    revokedAt: license.revokedAt || null,
  }
}

async function activate(req, res) {
  const body = await readJson(req)
  const id = cleanText(body.installationId, 96)
  if (!/^[A-Za-z0-9_-]{16,96}$/.test(id)) return json(res, 400, { error: "invalid_installation" })

  let license = state.licenses.find((item) => item.id === id)
  if (license?.status === "revoked") return json(res, 403, { error: "license_revoked" })

  if (!license) {
    const slot = nextSlot()
    if (!slot) return json(res, 403, { error: "license_limit", max: MAX_LICENSES })
    license = {
      id,
      slot,
      status: "active",
      tokenHash: "",
      deviceName: cleanText(body.deviceName, 120) || `Fryn PC ${slot}`,
      platform: cleanText(body.platform, 80),
      appVersion: cleanText(body.appVersion, 40),
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    }
    state.licenses.push(license)
  }

  license.deviceName = cleanText(body.deviceName, 120) || license.deviceName
  license.platform = cleanText(body.platform, 80) || license.platform
  license.appVersion = cleanText(body.appVersion, 40) || license.appVersion
  license.lastSeenAt = new Date().toISOString()

  const token = newLicenseToken()
  license.tokenHash = hashToken(token)
  await persistState()
  return json(res, 200, { token, slot: license.slot, max: MAX_LICENSES })
}

async function status(req, res) {
  const license = licenseFromRequest(req)
  if (!license) return json(res, 401, { error: "not_authorized" })
  license.lastSeenAt = new Date().toISOString()
  await persistState()
  return json(res, 200, { active: true, slot: license.slot, max: MAX_LICENSES })
}

function sanitizeUpstream(value) {
  let text = String(value)
  for (const model of KNOWN_MODELS) text = text.replaceAll(model, "assistant")
  return text
    .replace(/cohere\/north-mini-code(?::free)?/gi, "assistant")
    .replace(/qwen\/[A-Za-z0-9_.:-]+/gi, "assistant")
    .replace(/openrouter\/free/gi, "assistant")
    .replace(/north[ -]?mini[ -]?code/gi, "Fryn AI")
    .replace(/qwen(?:3(?:\.[0-9]+)?(?:[ -]?(?:coder|flash|plus))?)?/gi, "Fryn AI")
    .replace(/cohere/gi, "Fryn")
    .replace(/openrouter(?:\.ai)?/gi, "Fryn AI")
}

async function proxyAI(req, res, path) {
  const license = licenseFromRequest(req)
  if (!license) return json(res, 401, { error: "Fryn nao autorizado." })
  if (!rateAllowed(license)) return json(res, 429, { error: "Fryn temporariamente ocupado. Tente novamente em instantes." })

  if (req.method === "GET" && path === "/v1/models") {
    return json(res, 200, { object: "list", data: [{ id: "assistant", object: "model", owned_by: "fryn" }] })
  }

  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" })
  const raw = await readBody(req)
  let body
  try {
    body = raw.length ? JSON.parse(raw.toString("utf8")) : {}
  } catch {
    return json(res, 400, { error: "invalid_request" })
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "invalid_request" })
  const upstreamPath = path.slice(3) || "/chat/completions"
  const target = `${UPSTREAM_BASE_URL}${upstreamPath}`
  const provider = {
    ...(body.provider && typeof body.provider === "object" && !Array.isArray(body.provider) ? body.provider : {}),
    data_collection: DATA_COLLECTION,
    ...(REQUIRE_ZDR ? { zdr: true } : {}),
  }

  // The desktop only knows the logical model `assistant`. OpenRouter currently
  // limits its `models` fallback array to 3 entries, so Fryn sends free models
  // in batches of up to three. If every free batch fails with a retryable
  // upstream error, Fryn makes one separate request to the optional paid model.
  const attempts = []
  if (upstreamPath === "/chat/completions") {
    for (const batch of FREE_MODEL_BATCHES) {
      const attempt = { ...body, provider }
      delete attempt.model
      attempt.models = batch
      attempts.push({ kind: "free", body: attempt })
    }
    if (ENABLE_PAID_FALLBACK) {
      const attempt = { ...body, provider, model: PAID_FALLBACK_MODEL }
      delete attempt.models
      attempts.push({ kind: "paid", body: attempt })
    }
  } else {
    const attempt = { ...body, provider, model: FREE_MODELS[0] }
    delete attempt.models
    attempts.push({ kind: "free", body: attempt })
  }

  function retryableStatus(status) {
    return status === 404 || status === 408 || status === 409 || status === 429 || status === 502 || status === 503 || status === 504
  }

  let upstream
  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index]
    try {
      upstream = await fetch(target, {
        method: "POST",
        headers: {
          authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "content-type": "application/json",
          "x-title": "Fryn",
          ...(process.env.FRYN_HTTP_REFERER ? { "http-referer": process.env.FRYN_HTTP_REFERER } : {}),
        },
        body: JSON.stringify(attempt.body),
        signal: AbortSignal.timeout(10 * 60_000),
      })
    } catch (error) {
      console.error(`[Fryn] Falha no upstream (${attempt.kind}):`, error?.message || error)
      if (index < attempts.length - 1) continue
      return json(res, 502, { error: "Fryn AI indisponivel no momento." })
    }

    if (upstream.ok || index === attempts.length - 1 || !retryableStatus(upstream.status)) break
    console.warn(`[Fryn] Rota ${attempt.kind} indisponivel (HTTP ${upstream.status}); tentando proxima rota.`)
    try {
      await upstream.body?.cancel()
    } catch {}
    upstream = undefined
  }

  if (!upstream) return json(res, 502, { error: "Fryn AI indisponivel no momento." })

  license.lastSeenAt = new Date().toISOString()
  void persistState()

  const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8"
  res.writeHead(upstream.status, {
    "content-type": contentType,
    "cache-control": "no-store",
    ...(contentType.includes("text/event-stream") ? { connection: "keep-alive", "x-accel-buffering": "no" } : {}),
  })

  if (!upstream.body) return res.end()

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  const keep = 128
  let carry = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const textChunk = carry + decoder.decode(value, { stream: true })
      if (textChunk.length <= keep) {
        carry = textChunk
        continue
      }
      const splitAt = textChunk.length - keep
      res.write(sanitizeUpstream(textChunk.slice(0, splitAt)))
      carry = textChunk.slice(splitAt)
    }
    res.end(sanitizeUpstream(carry + decoder.decode()))
  } catch (error) {
    console.error("[Fryn] Erro durante streaming:", error?.message || error)
    res.end()
  }
}

async function adminApi(req, res, url) {
  if (!adminAuthorized(req)) return json(res, 401, { error: "not_authorized" })

  if (req.method === "GET" && url.pathname === "/admin/api/licenses") {
    return json(res, 200, {
      max: MAX_LICENSES,
      active: activeLicenses().length,
      licenses: state.licenses.slice().sort((a, b) => a.slot - b.slot).map(publicLicense),
    })
  }

  const match = /^\/admin\/api\/licenses\/([^/]+)\/(revoke|restore|delete)$/.exec(url.pathname)
  if (!match || req.method !== "POST") return json(res, 404, { error: "not_found" })

  const id = decodeURIComponent(match[1])
  const action = match[2]
  const index = state.licenses.findIndex((item) => item.id === id)
  if (index === -1) return json(res, 404, { error: "license_not_found" })
  const license = state.licenses[index]

  if (action === "delete") {
    state.licenses.splice(index, 1)
    rateWindows.delete(id)
  } else if (action === "revoke") {
    license.status = "revoked"
    license.revokedAt = new Date().toISOString()
    license.tokenHash = ""
    rateWindows.delete(id)
  } else if (action === "restore") {
    if (license.status !== "active" && activeLicenses().length >= MAX_LICENSES) {
      return json(res, 409, { error: "license_limit", max: MAX_LICENSES })
    }
    license.status = "active"
    delete license.revokedAt
    license.tokenHash = ""
  }

  await persistState()
  return json(res, 200, { ok: true })
}

const ADMIN_HTML = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fryn Admin</title><style>
:root{font-family:Inter,system-ui,sans-serif;color-scheme:dark;background:#0d0b14;color:#f4f0ff}body{margin:0;padding:32px}.wrap{max-width:1050px;margin:auto}h1{margin:0 0 6px}.muted{color:#9b93ae}.card{background:#151220;border:1px solid #2b2540;border-radius:16px;padding:20px;margin-top:20px}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}input{background:#0e0c15;color:#fff;border:1px solid #39304f;border-radius:10px;padding:11px 12px;min-width:340px}button{background:#7548ff;color:#fff;border:0;border-radius:9px;padding:9px 12px;cursor:pointer}button.secondary{background:#29233a}button.danger{background:#8f3247}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{text-align:left;padding:11px;border-bottom:1px solid #2a2439;font-size:14px}.badge{padding:4px 8px;border-radius:999px;background:#28213d}.active{color:#8ff0b5}.revoked{color:#ff9eae}.actions{display:flex;gap:6px}.error{color:#ff9eae;white-space:pre-wrap}</style></head>
<body><div class="wrap"><h1>Fryn Admin</h1><div class="muted">Controle das 12 instalacoes autorizadas.</div>
<div class="card"><div class="row"><input id="token" type="password" placeholder="Token administrativo"><button id="save">Entrar</button><button class="secondary" id="refresh">Atualizar</button><span id="summary" class="muted"></span></div><div id="error" class="error"></div></div>
<div class="card"><table><thead><tr><th>Vaga</th><th>Computador</th><th>Status</th><th>Versao</th><th>Ultimo uso</th><th>Acoes</th></tr></thead><tbody id="rows"></tbody></table></div></div>
<script>
const token=document.querySelector('#token'),rows=document.querySelector('#rows'),summary=document.querySelector('#summary'),err=document.querySelector('#error');token.value=localStorage.getItem('frynAdminToken')||'';
async function call(path,opts={}){const r=await fetch(path,{...opts,headers:{...(opts.headers||{}),'X-Admin-Token':token.value}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j}
function td(text){const e=document.createElement('td');e.textContent=text??'';return e}
async function load(){err.textContent='';try{const d=await call('/admin/api/licenses');summary.textContent=d.active+' / '+d.max+' vagas em uso';rows.replaceChildren();for(const l of d.licenses){const tr=document.createElement('tr');tr.append(td('#'+l.slot),td(l.deviceName||l.id.slice(0,12)));const st=td(l.status);st.className=l.status;tr.append(st,td(l.appVersion||'-'),td(l.lastSeenAt?new Date(l.lastSeenAt).toLocaleString():'-'));const ac=td('');ac.className='actions';const rev=document.createElement('button');rev.textContent=l.status==='active'?'Revogar':'Restaurar';rev.className=l.status==='active'?'danger':'secondary';rev.onclick=()=>act(l.id,l.status==='active'?'revoke':'restore');const del=document.createElement('button');del.textContent='Excluir/liberar';del.className='secondary';del.onclick=()=>act(l.id,'delete');ac.append(rev,del);tr.append(ac);rows.append(tr)}}catch(e){err.textContent='Nao foi possivel carregar: '+e.message}}
async function act(id,action){if(action==='delete'&&!confirm('Excluir esta instalacao e liberar a vaga?'))return;try{await call('/admin/api/licenses/'+encodeURIComponent(id)+'/'+action,{method:'POST'});await load()}catch(e){err.textContent=e.message}}
document.querySelector('#save').onclick=()=>{localStorage.setItem('frynAdminToken',token.value);load()};document.querySelector('#refresh').onclick=load;if(token.value)load();
</script></body></html>`

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        service: "Fryn",
        activeLicenses: activeLicenses().length,
        maxLicenses: MAX_LICENSES,
        routing: {
          freeFirst: true,
          paidFallback: ENABLE_PAID_FALLBACK,
          privacy: REQUIRE_ZDR ? "zdr" : DATA_COLLECTION,
        },
      })
    }
    if (req.method === "GET" && url.pathname === "/admin") return text(res, 200, ADMIN_HTML, "text/html; charset=utf-8")
    if (url.pathname.startsWith("/admin/api/")) return await adminApi(req, res, url)
    if (req.method === "POST" && url.pathname === "/api/activate") return await activate(req, res)
    if (req.method === "GET" && url.pathname === "/api/license/status") return await status(req, res)
    if (url.pathname.startsWith("/v1/")) return await proxyAI(req, res, url.pathname)
    return json(res, 404, { error: "not_found" })
  } catch (error) {
    console.error("[Fryn] Erro:", error)
    return json(res, error?.status || 500, { error: error?.status ? error.message : "internal_error" })
  }
})

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Fryn] Backend ativo em http://0.0.0.0:${PORT}`)
  console.log(`[Fryn] ${activeLicenses().length}/${MAX_LICENSES} instalacoes ativas | host ${hostname()}`)
  console.log(
    `[Fryn] Roteamento free-first ativo | ${FREE_MODELS.length} rotas gratuitas | fallback pago ${ENABLE_PAID_FALLBACK ? "ativo" : "desativado"}`,
  )
  console.log(`[Fryn] Privacidade upstream: ${REQUIRE_ZDR ? "ZDR obrigatorio" : `data_collection=${DATA_COLLECTION}`}`)
})
