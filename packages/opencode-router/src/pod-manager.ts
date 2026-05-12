import crypto from "node:crypto"
import fs from "node:fs"
import * as k8s from "@kubernetes/client-node"
import { humanId as _humanId } from "human-id"
import { config } from "./config.js"
import * as devProxy from "./dev-proxy.js"
import { podSecretStore } from "./pod-secret-store.js"
import { messageStore } from "./message-store.js"
import { portStore } from "./port-store.js"
import { sessionsChangedBroadcaster as _sessionsChangedBroadcaster } from "./stream-broadcaster.js"

const kc = new k8s.KubeConfig()
// loadFromCluster() does not throw when not in a pod — it silently produces
// an invalid config with server=undefined. Check for the SA token file first.
if (fs.existsSync("/var/run/secrets/kubernetes.io/serviceaccount/token")) {
  kc.loadFromCluster()
} else {
  kc.loadFromDefault()
}
let k8sApi: k8s.CoreV1Api = kc.makeApiClient(k8s.CoreV1Api)
let humanId: typeof _humanId = _humanId
// Narrow function type — `typeof fetch` differs between Bun and DOM lib
// (Bun adds a `preconnect` property), which breaks `tsc` in the Docker build.
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>
let fetchImpl: FetchFn = (url, init) => globalThis.fetch(url, init)
let activityFetchImpl: FetchFn = (url, init) => globalThis.fetch(url, init)

/** For testing only: replace the k8s API client with a fake. */
export function _setApiClient(client: k8s.CoreV1Api) {
  k8sApi = client
}

/** For testing only: replace the humanId generator. */
export function _setHumanId(fn: typeof _humanId) {
  humanId = fn
}

/** For testing only: replace the fetch implementation used by remoteBranchExists. */
export function _setFetch(fn: FetchFn) {
  fetchImpl = fn
}

/** For testing only: replace the fetch implementation used to poll pod activity. */
export function _setActivityFetch(fn: FetchFn) {
  activityFetchImpl = fn
}

/** For testing only: replace the fetch implementation used for pod bootstrap calls. */
let bootstrapFetchImpl: FetchFn = (url, init) => globalThis.fetch(url, init)
export function _setBootstrapFetch(fn: FetchFn) {
  bootstrapFetchImpl = fn
}

/** For testing only: clear the in-flight/completed bootstrap cache. */
export function _clearBootstrappedSessions() {
  bootstrappedSessions.clear()
}

/** Emit a sessions-changed signal — injectable for testing. */
let emitSessionsChanged: () => void = () => _sessionsChangedBroadcaster.emit()
/** For testing only: replace the sessionsChanged emit function. */
export function _setEmitSessionsChanged(fn: () => void) {
  emitSessionsChanged = fn
}

/**
 * Tracks the in-flight or completed bootstrap for each pod hash.
 *
 * Value is a Promise that resolves to the opencode session ID (string) on success
 * or `null` on failure. All concurrent callers await the same Promise so only one
 * `POST /session` is ever sent per hash. Callers treat null as "still pending" and
 * keep the session URL as null until the next poll succeeds or a timeout fires.
 *
 * Key is absent if bootstrap has never been attempted for this hash.
 * Key is deleted on failure (so the next poll can retry) or on pod termination/idle-delete.
 */
const bootstrappedSessions = new Map<string, Promise<string | null>>()

const LABEL_SESSION_HASH = "opencode.ai/session-hash"
const LABEL_MANAGED_BY = "app.kubernetes.io/managed-by"
const MANAGED_BY_VALUE = "opencode-router"
const ANNOTATION_LAST_ACTIVITY = "opencode.ai/last-activity"
const ANNOTATION_USER_EMAIL = "opencode.ai/user-email"
const ANNOTATION_REPO_URL = "opencode.ai/repo-url"
const ANNOTATION_BRANCH = "opencode.ai/branch"
const ANNOTATION_SOURCE_BRANCH = "opencode.ai/source-branch"
const ANNOTATION_INITIAL_MESSAGE = "opencode.ai/initial-message"
const ANNOTATION_CREATED_AT = "opencode.ai/created-at"
const ANNOTATION_POD_SECRET = "opencode.ai/pod-secret"
const ANNOTATION_ATTACH_PASSWORD = "opencode.ai/attach-password"

/** In-memory throttle for annotation updates: hash → last update epoch ms */
const activityThrottle = new Map<string, number>()
const THROTTLE_MS = 60_000

/**
 * On router startup: re-populate podSecretStore from pod annotations so that
 * already-running pods can still push port events after a router restart.
 */
export async function restorePodSecrets(): Promise<void> {
  const pods = await k8sApi.listNamespacedPod({
    namespace: config.namespace,
    labelSelector: `${LABEL_MANAGED_BY}=${MANAGED_BY_VALUE}`,
  })
  let restored = 0
  for (const pod of pods.items) {
    const hash = pod.metadata?.labels?.[LABEL_SESSION_HASH]
    const secret = pod.metadata?.annotations?.[ANNOTATION_POD_SECRET]
    if (hash && secret) {
      podSecretStore.restore(hash, secret)
      restored++
    }
  }
  if (restored > 0) console.log(`Restored pod secrets for ${restored} running pod(s)`)
}

export interface SessionKey {
  email: string
  repoUrl: string
  /** Session branch — auto-generated unique name (e.g. "calm-snails-dream"). Forms part of the session identity hash. */
  branch: string
  /** Source branch the user starts from (e.g. "main"). Used by git-init to set the starting point. */
  sourceBranch: string
  initialMessage?: string
}

export interface SessionInfo {
  hash: string
  email: string
  repoUrl: string
  /** Session branch (auto-generated, e.g. "calm-snails-dream") */
  branch: string
  /** Source branch the session was created from (e.g. "main") */
  sourceBranch: string
  state: PodState
  /**
   * Deep link URL to the specific opencode session, e.g.
   *   https://<hash>-oc.<domain>/<workspace-b64>/session/<sessionId>
   *
   * null when:
   *   - pod is not running (stopped / creating)
   *   - pod is running but the session URL is not yet resolved (bootstrap in-flight)
   *   - pod is running but the activity endpoint is unreachable
   *
   * Never a bare pod root or a "new session" URL — consumers must wait for a non-null
   * value before opening the session, and surface an error if it never arrives.
   */
  url: string | null
  lastActivity: string
  createdAt: string
  idleTimeoutMinutes: number
  description?: string
  title?: string
  /** Attach URL for local client connections (e.g., https://attach-<hash>.<domain>) */
  attachUrl?: string
  /** Password for attach authentication (only included for session owner) */
  attachPassword?: string
}

/**
 * Derive the SessionInfo wire payload for a single (PVC, optional Pod) pair.
 *
 * Shared between getSessionInfo (single-hash lookup) and listUserSessions (per-user listing).
 * Both paths need identical state derivation, lastActivity merge, deep-link URL resolution,
 * and title merge from messageStore — keeping them in one place prevents the two from drifting.
 *
 * Caller responsibilities:
 *   - Resolve `pod` to undefined when terminating (deletionTimestamp set) or absent.
 *   - Pass `email` from the trusted source for the call (PVC annotation for single-hash,
 *     authenticated request email for the per-user path).
 */
async function buildSessionInfo(
  hash: string,
  pvc: k8s.V1PersistentVolumeClaim,
  pod: k8s.V1Pod | undefined,
  email: string,
): Promise<SessionInfo> {
  const ann = pvc.metadata?.annotations ?? {}
  const proto = config.routerProto

  let state: PodState
  if (!pod) {
    state = "stopped"
  } else if (pod.status?.conditions?.find((c) => c.type === "Ready" && c.status === "True") && pod.status?.podIP) {
    state = "running"
  } else {
    state = "creating"
  }

  const annotationActivity =
    pod?.metadata?.annotations?.[ANNOTATION_LAST_ACTIVITY] ?? ann[ANNOTATION_LAST_ACTIVITY] ?? new Date().toISOString()

  let lastActivity = annotationActivity
  const initialMessage = ann[ANNOTATION_INITIAL_MESSAGE]
  let sessionUrl: string | null = null

  if (state === "running" && pod?.status?.podIP) {
    const activity = await podActivityMs(pod.status.podIP, hash)
    if (activity !== null) {
      if (activity.ms > new Date(annotationActivity).getTime()) {
        lastActivity = new Date(activity.ms).toISOString()
      }
      if (activity.sessionId) {
        // Existing sessions on the pod — link to the most recently active one.
        // This is the resume case: the PVC has sessions in SQLite from a prior run.
        sessionUrl = deepLinkUrl(`${proto}://${hash}${config.routeSuffix}.${config.routerDomain}`, activity.sessionId)
      } else if (initialMessage) {
        // Fresh pod (no sessions yet) with an initialMessage — bootstrap a new session.
        // All concurrent callers await the same Promise — only one POST /session is ever sent.
        // Returns null while bootstrap is in-flight or if it has permanently failed.
        let base = `http://${pod.status.podIP}:${config.opencodePort}`
        if (devProxy.enabled) {
          const proxyTarget = await devProxy.target(hash)
          if (proxyTarget) base = proxyTarget
        }
        const bootstrappedId = await bootstrapPodSession(base, hash, initialMessage)
        sessionUrl = bootstrappedId
          ? deepLinkUrl(`${proto}://${hash}${config.routeSuffix}.${config.routerDomain}`, bootstrappedId)
          : null
      }
      // else: running pod with no sessions yet and no initialMessage → url stays null
      // (caller should keep waiting; this resolves once the user creates a session manually)
    }
    // else: pod unreachable → url stays null
  }

  // Build attach URL
  const attachUrl = getAttachUrl(hash)

  // Include attach password only for session owner (email match)
  const pvcEmail = ann[ANNOTATION_USER_EMAIL] ?? ""
  const attachPassword = pvcEmail === email ? ann[ANNOTATION_ATTACH_PASSWORD] : undefined

  return {
    hash,
    email,
    repoUrl: ann[ANNOTATION_REPO_URL] ?? "",
    branch: ann[ANNOTATION_BRANCH] ?? "",
    sourceBranch: ann[ANNOTATION_SOURCE_BRANCH] ?? "",
    state,
    url: sessionUrl,
    lastActivity,
    createdAt: ann[ANNOTATION_CREATED_AT] ?? lastActivity,
    idleTimeoutMinutes: config.idleTimeoutMinutes,
    description: initialMessage,
    title: messageStore.get(hash)?.title,
    attachUrl,
    attachPassword,
  }
}

/**
 * Get full session info for a single session by hash, including deep link URL.
 * Reusable for both the polling GET endpoint and the SSE events endpoint.
 * Returns null if the session's PVC is not found.
 */
export async function getSessionInfo(hash: string): Promise<SessionInfo | null> {
  let pvc: k8s.V1PersistentVolumeClaim
  try {
    pvc = await k8sApi.readNamespacedPersistentVolumeClaim({ name: pvcName(hash), namespace: config.namespace })
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }

  let pod: k8s.V1Pod | undefined
  try {
    const p = await k8sApi.readNamespacedPod({ name: podName(hash), namespace: config.namespace })
    if (!p.metadata?.deletionTimestamp) pod = p
  } catch (err) {
    if (!isNotFound(err)) throw err
  }

  const email = pvc.metadata?.annotations?.[ANNOTATION_USER_EMAIL] ?? ""
  return buildSessionInfo(hash, pvc, pod, email)
}

/**
 * Get current progress stage for a session during startup.
 * Uses K8s pod init container status to map to human-readable stages.
 *
 * Stages (in order):
 *   initializing  — PVC/Pod just created, pod not yet scheduled
 *   configuring   — Init container running config-seed phase
 *   cloning       — Init container running git clone/checkout phase
 *   starting      — Init container complete, main container starting
 *   readying      — Pod ready, resolving deep-link URL
 */
export async function getSessionProgress(hash: string): Promise<{ stage: string; message: string }> {
  const name = podName(hash)
  try {
    const pod = await k8sApi.readNamespacedPod({ name, namespace: config.namespace })

    // Pod is fully ready — deep link resolution stage
    if (pod.status?.conditions?.find((c) => c.type === "Ready" && c.status === "True") && pod.status?.podIP) {
      return { stage: "readying", message: "Finalizing session..." }
    }

    const initStatuses = pod.status?.initContainerStatuses ?? []
    const initState = initStatuses[0]

    // Init container is running — determine which phase based on its logs/state
    if (initState?.state?.running) {
      // We can't easily inspect script phase from K8s API alone, so use
      // timing heuristic: first ~10s = configuring, then = cloning
      const startedAt = initState.state.running.startedAt
      const elapsedMs = startedAt ? Date.now() - new Date(startedAt).getTime() : 0
      if (elapsedMs < 10_000) {
        return { stage: "configuring", message: "Configuring environment..." }
      }
      return { stage: "cloning", message: "Cloning repository..." }
    }

    // Init container completed, main container is starting
    if (initState?.state?.terminated?.reason === "Completed") {
      return { stage: "starting", message: "Starting OpenCode server..." }
    }

    // Pod scheduled but init not yet running, or no init status
    return { stage: "initializing", message: "Initializing session..." }
  } catch (err) {
    if (isNotFound(err)) return { stage: "initializing", message: "Initializing session..." }
    throw err
  }
}

/**
 * Compute a deterministic, DNS-safe 12-char hex hash for a (email, repoUrl, branch) triple.
 * This is the stable identity for a session — used for pod name, PVC name, and URL slug.
 */
export function getSessionHash(email: string, repoUrl: string, branch: string): string {
  const key = `${email.toLowerCase().trim()}:${repoUrl.trim()}:${branch.trim()}`
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 12)
}

/**
 * Generate a random 32-character hex password for attach authentication.
 */
export function generateAttachPassword(): string {
  return crypto.randomBytes(16).toString("hex")
}

/**
 * Get or create the attach password for a session.
 * Reads from PVC annotation, creates a new one if not present.
 */
export async function getOrCreateAttachPassword(hash: string): Promise<string> {
  const name = pvcName(hash)
  let pvc: k8s.V1PersistentVolumeClaim
  try {
    pvc = await k8sApi.readNamespacedPersistentVolumeClaim({ name, namespace: config.namespace })
  } catch (err) {
    if (isNotFound(err)) throw new Error("NotFound")
    throw err
  }

  const existingPassword = pvc.metadata?.annotations?.[ANNOTATION_ATTACH_PASSWORD]
  if (existingPassword) return existingPassword

  // Generate new password and store in annotation
  const password = generateAttachPassword()
  try {
    await k8sApi.patchNamespacedPersistentVolumeClaim({
      name,
      namespace: config.namespace,
      body: {
        metadata: {
          annotations: { [ANNOTATION_ATTACH_PASSWORD]: password },
        },
      },
    })
  } catch (err) {
    console.error(`Failed to store attach password for ${name}:`, err)
    // Return password anyway — caller can still use it for this request
  }
  return password
}

/**
 * Build the attach URL for a session.
 * Format: https://<attachRoutePrefix><hash><routeSuffix>.<routerDomain>
 */
export function getAttachUrl(hash: string): string {
  const proto = config.routerProto ?? "https"
  return `${proto}://${config.attachRoutePrefix}${hash}${config.routeSuffix}.${config.routerDomain}`
}

function podName(hash: string): string {
  return `opencode-session-${hash}`
}

function pvcName(hash: string): string {
  return `opencode-pvc-${hash}`
}

function sessionLabels(hash: string): Record<string, string> {
  return {
    [LABEL_SESSION_HASH]: hash,
    [LABEL_MANAGED_BY]: MANAGED_BY_VALUE,
  }
}

function githubSecretName(hash: string): string {
  return `opencode-github-${hash}`
}

const WORKSPACE_BASE64 = Buffer.from("/home/opencode/repo").toString("base64").replace(/=+$/, "")

function deepLinkUrl(podUrl: string, sessionId: string): string {
  return `${podUrl}/${WORKSPACE_BASE64}/session/${sessionId}`
}

/**
 * Create an opencode session on a running pod and fire the initial message via
 * prompt_async. Returns the opencode session ID on success, or null on failure.
 *
 * Concurrent callers all await the same in-flight Promise — only one POST /session
 * is ever sent per pod hash. On failure the entry is deleted so the next poll can
 * retry. On success the entry persists so future URL lookups always return the same
 * session ID (stable deep link even after activity on other sessions on the same pod).
 */
function bootstrapPodSession(base: string, hash: string, initialMessage: string): Promise<string | null> {
  const existing = bootstrappedSessions.get(hash)
  if (existing !== undefined) return existing

  const promise = (async () => {
    try {
      const createRes = await bootstrapFetchImpl(`${base}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!createRes.ok) {
        bootstrappedSessions.delete(hash)
        return null
      }
      const session = (await createRes.json()) as { id?: string }
      const sessionId = session.id
      if (!sessionId) {
        bootstrappedSessions.delete(hash)
        return null
      }
      const promptRes = await bootstrapFetchImpl(`${base}/session/${sessionId}/prompt_async`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts: [{ type: "text", text: initialMessage }] }),
      })
      if (!promptRes.ok) {
        bootstrappedSessions.delete(hash)
        return null
      }
      return sessionId
    } catch {
      // Remove on failure so a later poll can retry
      bootstrappedSessions.delete(hash)
      return null
    }
  })()

  // Store immediately so concurrent callers await the same promise
  bootstrappedSessions.set(hash, promise)
  return promise
}

async function ensureGithubTokenSecret(hash: string, token: string): Promise<void> {
  const name = githubSecretName(hash)
  const secret: k8s.V1Secret = {
    metadata: { name, namespace: config.namespace, labels: sessionLabels(hash) },
    type: "Opaque",
    stringData: { GITHUB_TOKEN: token },
  }
  try {
    await k8sApi.createNamespacedSecret({ namespace: config.namespace, body: secret })
  } catch (err) {
    if (!isConflict(err)) throw err
    // Secret exists (resume with a new token) — replace it with a PUT.
    await k8sApi.replaceNamespacedSecret({ name, namespace: config.namespace, body: secret })
  }
}

/**
 * Create PVC for a session if it doesn't exist. Idempotent.
 */
export async function ensurePVC(session: SessionKey): Promise<void> {
  const hash = getSessionHash(session.email, session.repoUrl, session.branch)
  const name = pvcName(hash)

  try {
    await k8sApi.readNamespacedPersistentVolumeClaim({ name, namespace: config.namespace })
    return // already exists
  } catch (err) {
    if (!isNotFound(err)) throw err
  }

  // Generate attach password for new sessions
  const attachPassword = generateAttachPassword()

  const pvc: k8s.V1PersistentVolumeClaim = {
    metadata: {
      name,
      namespace: config.namespace,
      labels: sessionLabels(hash),
      annotations: {
        [ANNOTATION_USER_EMAIL]: session.email,
        [ANNOTATION_REPO_URL]: session.repoUrl,
        [ANNOTATION_BRANCH]: session.branch,
        [ANNOTATION_SOURCE_BRANCH]: session.sourceBranch,
        [ANNOTATION_CREATED_AT]: new Date().toISOString(),
        [ANNOTATION_ATTACH_PASSWORD]: attachPassword,
        ...(session.initialMessage ? { [ANNOTATION_INITIAL_MESSAGE]: session.initialMessage } : {}),
      },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      ...(config.storageClass && { storageClassName: config.storageClass }),
      resources: {
        requests: { storage: config.storageSize },
      },
    },
  }

  try {
    await k8sApi.createNamespacedPersistentVolumeClaim({ namespace: config.namespace, body: pvc })
  } catch (err) {
    if (!isConflict(err)) throw err
  }
}

export type PodState = "none" | "creating" | "running" | "stopped"

/**
 * Return the current state of a session's pod by its hash.
 */
export async function getPodState(hash: string): Promise<PodState> {
  const name = podName(hash)
  try {
    const pod = await k8sApi.readNamespacedPod({ name, namespace: config.namespace })
    const ready = pod.status?.conditions?.find((c) => c.type === "Ready" && c.status === "True")
    if (ready && pod.status?.podIP) return "running"
    return "creating"
  } catch (err) {
    if (isNotFound(err)) return "none"
    throw err
  }
}

/**
 * Create pod for a session if it doesn't exist. Idempotent. Must call ensurePVC first.
 *
 * The git-init container:
 * - Clones repoUrl into /workspace if not already cloned
 * - Checks out `branch` if it exists remotely, otherwise creates it from the default branch
 *
 * @param image - Override the container image (defaults to config.opencodeImage). Used by prepullImage().
 */
export async function ensurePod(session: SessionKey, githubToken?: string, image?: string): Promise<string> {
  const containerImage = image ?? config.opencodeImage
  const hash = getSessionHash(session.email, session.repoUrl, session.branch)
  const name = podName(hash)

  const existingPods = await k8sApi.listNamespacedPod({
    namespace: config.namespace,
    labelSelector: `${LABEL_SESSION_HASH}=${hash}`,
  })
  if (existingPods.items.some((p: k8s.V1Pod) => !p.metadata?.deletionTimestamp)) return hash

  const podSecret = podSecretStore.generate(hash)

  if (githubToken) await ensureGithubTokenSecret(hash, githubToken)

  const now = new Date().toISOString()
  const { repoUrl, branch, sourceBranch, email } = session

  // The repo is cloned directly into /workspace (init container) which maps to <PVC>/repo/
  // via subPath "repo". The main container mounts the full PVC at /home/opencode (no subPath),
  // so the cloned repo is at /home/opencode/repo/ inside the main container. We set workingDir
  // accordingly so opencode serve starts in the git repo and correctly discovers the project.
  const workspacePath = `/home/opencode/repo`

  // Single init container using the opencode image (which already has git).
  // Phase 1 — config seed (idempotent): copy /etc/opencode-defaults → ~/.config/opencode on first start,
  //   then merge dynamic ConfigMap overrides, then run any *.sh scripts in init-scripts/ (e.g. skills install).
  //   Skipped on pod restart.
  // Phase 2 — git: clone repo + checkout session branch. Safe.directory avoids needing a writable HOME.
  const initScript = [
    `set -e`,
    // --- config phase (idempotent) ---
    `if [ ! -d /home/opencode/.config/opencode ]; then`,
    `  mkdir -p /home/opencode/.config/opencode`,
    // Copy baked config as base
    `  cp -r /etc/opencode-defaults/. /home/opencode/.config/opencode/`,
    // Merge dynamic ConfigMap overrides (if present) — deep merge, ConfigMap wins
    `  if [ -f /home/opencode/.opencode/opencode.json ]; then`,
    `    if command -v jq >/dev/null 2>&1; then`,
    `      merged=$(jq -s '.[0] * .[1]' /home/opencode/.config/opencode/opencode.json /home/opencode/.opencode/opencode.json)`,
    `      echo "$merged" > /home/opencode/.config/opencode/opencode.json`,
    `    else`,
    `      echo "Warning: jq not found, using baked config only" >&2`,
    `    fi`,
    `  fi`,
    `fi`,
    // --- always sync skill assets from image defaults (idempotent, runs every start) ---
    // Covers pod restarts after image updates that added new skills. New skill dirs are
    // copied in; existing ones are left untouched because cp -r won't overwrite files
    // that already exist unless -f is passed. We also sync skills-lock.json and the
    // .ade/ source tree so experimental_install picks up new entries.
    `cp -r /etc/opencode-defaults/.agentskills/. /home/opencode/.config/opencode/.agentskills/ 2>/dev/null || true`,
    `cp -r /etc/opencode-defaults/.ade/. /home/opencode/.config/opencode/.ade/ 2>/dev/null || true`,
    `cp /etc/opencode-defaults/skills-lock.json /home/opencode/.config/opencode/skills-lock.json 2>/dev/null || true`,
    // Re-run init-scripts every start (they must be idempotent). setup-skills.sh runs
    // experimental_install which is a no-op for already-registered skills and adds new ones.
    `for s in /etc/opencode-defaults/init-scripts/*.sh; do`,
    `  [ -f "$s" ] && sh "$s" || true`,
    `done`,
    // --- ensure router plugin is always in the plugin list (idempotent, runs every start) ---
    // This covers resumed pods whose opencode.json was written before the plugin was added.
    // Reference by TS source path so opencode loads it directly via bun (no npm needed).
    `if command -v jq >/dev/null 2>&1 && [ -f /home/opencode/.config/opencode/opencode.json ]; then`,
    `  cfg=/home/opencode/.config/opencode/opencode.json`,
    `  jq_filter='.plugin = ((.plugin // []) | map(select(. != "@opencode-ai/opencode-router-plugin")) | if any(. == "/etc/opencode-plugin/index.ts") then . else . + ["/etc/opencode-plugin/index.ts"] end)'`,
    `  tmp=$(jq "$jq_filter" "$cfg") && echo "$tmp" > "$cfg"`,
    `fi`,
    // --- stale lock cleanup (guards against ENOSPC or crash mid-write leaving a stale lock) ---
    `rm -f /home/opencode/.gitconfig.lock`,
    // --- git credentials (from per-session Secret mounted as GITHUB_TOKEN) ---
    `if [ -n "$GITHUB_TOKEN" ]; then`,
    `  git config --global credential.helper store`,
    `  printf 'https://oauth2:%s@github.com\\n' "$GITHUB_TOKEN" > /home/opencode/.git-credentials`,
    `  GH_USER=$(gh api /user 2>/dev/null)`,
    `  GH_NAME=$(printf '%s' "$GH_USER" | jq -r '.name // .login')`,
    `  GH_LOGIN=$(printf '%s' "$GH_USER" | jq -r '.login')`,
    `  GH_ID=$(printf '%s' "$GH_USER" | jq -r '.id')`,
    `  git config --global user.name "$GH_NAME"`,
    `  git config --global user.email "\${GH_ID}+\${GH_LOGIN}@users.noreply.github.com"`,
    `fi`,
    // --- git phase ---
    `GIT="git -c safe.directory=/workspace"`,
    `if [ ! -d /workspace/.git ]; then`,
    `  git clone "${repoUrl}" /workspace`,
    `fi`,
    `cd /workspace`,
    `$GIT fetch --all`,
    `if $GIT rev-parse --verify "${branch}" >/dev/null 2>&1; then`,
    `  $GIT checkout "${branch}"`,
    `else`,
    `  $GIT checkout -B "${sourceBranch}" "origin/${sourceBranch}"`,
    `  $GIT checkout -b "${branch}"`,
    `fi`,
  ].join("\n")

  const secCtx: k8s.V1SecurityContext = {
    runAsUser: 1000,
    runAsGroup: 1000,
    allowPrivilegeEscalation: false,
    runAsNonRoot: true,
    capabilities: { drop: ["ALL"] },
    seccompProfile: { type: "RuntimeDefault" },
  }

  const initContainers: k8s.V1Container[] = [
    {
      name: "init",
      securityContext: secCtx,
      image: containerImage,
      command: ["sh", "-c"],
      args: [initScript],
      ...(githubToken ? { envFrom: [{ secretRef: { name: githubSecretName(hash) } }] } : {}),
      volumeMounts: [
        { name: "user-data", mountPath: "/home/opencode" },
        { name: "user-data", mountPath: "/workspace", subPath: "repo" },
      ],
    },
  ]

  const pod: k8s.V1Pod = {
    metadata: {
      name,
      namespace: config.namespace,
      labels: sessionLabels(hash),
      annotations: {
        [ANNOTATION_LAST_ACTIVITY]: now,
        [ANNOTATION_USER_EMAIL]: email,
        [ANNOTATION_REPO_URL]: repoUrl,
        [ANNOTATION_BRANCH]: branch,
        [ANNOTATION_SOURCE_BRANCH]: sourceBranch,
        [ANNOTATION_POD_SECRET]: podSecret,
      },
    },
    spec: {
      restartPolicy: "Always",
      securityContext: {
        runAsUser: 1000,
        runAsGroup: 1000,
        fsGroup: 1000,
        runAsNonRoot: true,
        seccompProfile: { type: "RuntimeDefault" },
      },
      ...(config.imagePullSecretName ? { imagePullSecrets: [{ name: config.imagePullSecretName }] } : {}),
      initContainers,
      containers: [
        {
          name: "opencode",
          image: containerImage,
          // Start the process in the cloned repo directory so opencode discovers the git project.
          // The init container clones directly into /workspace (subPath "repo" on the PVC).
          // The main container mounts the full PVC at /home/opencode, so the repo is at
          // /home/opencode/repo/.
          workingDir: workspacePath,
          // Source /home/opencode/.opencode/.env if present — lets operators inject arbitrary
          // env vars (e.g. WORKFLOW_AGENTS) via the existing ConfigMap without touching router code.
          command: [
            "sh",
            "-c",
            [
              `git config --global --add safe.directory /home/opencode/repo`,
              `set -a; . /home/opencode/.opencode/.env 2>/dev/null || true; set +a`,
              `exec opencode serve --hostname 0.0.0.0 --port ${config.opencodePort}`,
            ].join("\n"),
          ],
          readinessProbe: {
            httpGet: { path: "/global/health", port: config.opencodePort },
            initialDelaySeconds: 5,
            periodSeconds: 3,
            failureThreshold: 20,
          },
          ports: [{ containerPort: config.opencodePort }],
          env: [
            // NODE_OPTIONS=--require=/etc/bind-all-interfaces.cjs is baked into the
            // container image via ENV in the Dockerfile — not set here to avoid
            // breaking pods running older images where the file doesn't exist.
            { name: "PLAYWRIGHT_MCP_CDP_ENDPOINT", value: "http://localhost:9222" },
            { name: "OPENCODE_POD_SECRET", value: podSecret },
            { name: "OPENCODE_SESSION_HASH", value: hash },
            ...(config.opencodeRouterUrl ? [{ name: "OPENCODE_ROUTER_URL", value: config.opencodeRouterUrl }] : []),
          ],
          envFrom: [
            { secretRef: { name: config.apiKeySecretName } },
            ...(githubToken ? [{ secretRef: { name: githubSecretName(hash) } }] : []),
          ],
          securityContext: {
            allowPrivilegeEscalation: false,
            runAsNonRoot: true,
            capabilities: { drop: ["ALL"] },
            seccompProfile: { type: "RuntimeDefault" },
          },
          volumeMounts: [
            { name: "user-data", mountPath: "/home/opencode" },
            { name: "opencode-config", mountPath: "/home/opencode/.opencode", readOnly: true },
          ],
        },
        {
          name: "chromium",
          image: config.chromiumImage,
          args: [
            "--remote-debugging-address=0.0.0.0",
            "--remote-debugging-port=9222",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--headless",
          ],
          ports: [{ containerPort: 9222 }],
          securityContext: {
            allowPrivilegeEscalation: false,
            runAsNonRoot: true,
            capabilities: { drop: ["ALL"] },
            seccompProfile: { type: "RuntimeDefault" },
          },
          resources: {
            requests: { cpu: "100m", memory: "256Mi" },
            limits: { cpu: "1000m", memory: "1Gi" },
          },
        },
      ],
      volumes: [
        {
          name: "user-data",
          persistentVolumeClaim: { claimName: pvcName(hash) },
        },
        {
          name: "opencode-config",
          configMap: { name: config.configMapName },
        },
      ],
    },
  }

  try {
    await k8sApi.createNamespacedPod({ namespace: config.namespace, body: pod })
  } catch (err) {
    if (!isConflict(err)) throw err
  }

  return hash
}

/**
 * Pre-pull a container image by creating a test session, waiting for it to be ready,
 * then terminating it. This ensures the image is cached on the node for faster cold starts.
 *
 * Uses the test session approach (see ADR-0003): create pod → wait for ready (smoke test)
 * → delete pod. The readiness probe on /global/health validates the image actually works.
 *
 * @param image - The container image to pre-pull (e.g. "ghcr.io/org/opencode:sha-1234567")
 * @param timeoutMs - Max time to wait for image pull + ready (default 5 minutes)
 * @returns true if image was successfully pulled and verified, false otherwise
 */
export async function prepullImage(image: string, timeoutMs = 300_000): Promise<boolean> {
  const testSession: SessionKey = {
    email: "admin@localhost",
    // Use a repo that definitely exists and is publicly accessible
    repoUrl: "https://github.com/mrsimpson/opencode.git",
    branch: `prepull-${Date.now()}`,
    sourceBranch: "main",
  }

  const hash = getSessionHash(testSession.email, testSession.repoUrl, testSession.branch)

  try {
    // Create PVC and pod with the new image
    await ensurePVC(testSession)
    await ensurePod(testSession, undefined, image)

    // Poll until pod is running or timeout
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const state = await getPodState(hash)
      if (state === "running") {
        // Image pulled and verified (readiness probe passed = smoke test passed)
        await terminateSession(hash, testSession.email)
        return true
      }
      if (state === "none") {
        // Pod was deleted or never created
        console.error(`prepullImage: pod ${hash} is gone (state=none)`)
        return false
      }
      // Log current state for debugging
      console.log(`prepullImage: pod ${hash} state=${state}, waiting...`)
      // Still creating, wait before next poll
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }

    // Timeout - get pod details for debugging
    try {
      const pod = await k8sApi.readNamespacedPod({ name: podName(hash), namespace: config.namespace })
      console.error(`prepullImage timeout: pod state=${pod.status?.phase}, conditions=`, pod.status?.conditions)
      console.error(`prepullImage timeout: container statuses=`, pod.status?.containerStatuses)
    } catch (err) {
      console.error(`prepullImage: failed to get pod details after timeout:`, err)
    }
    await terminateSession(hash, testSession.email).catch(() => {})
    return false
  } catch (err) {
    console.error("prepullImage failed:", err)
    // Clean up on error - terminateSession handles NotFound gracefully
    try {
      await terminateSession(hash, testSession.email)
    } catch {
      // PVC might not exist, clean up pod and PVC individually
      await k8sApi.deleteNamespacedPod({ name: podName(hash), namespace: config.namespace }).catch(() => {})
      await k8sApi
        .deleteNamespacedPersistentVolumeClaim({ name: pvcName(hash), namespace: config.namespace })
        .catch(() => {})
    }
    return false
  }
}

/**
 * Return the pod's IP if it is Running, or null otherwise. Looks up by session hash.
 */
export async function getPodIP(hash: string): Promise<string | null> {
  const name = podName(hash)
  try {
    const pod = await k8sApi.readNamespacedPod({ name, namespace: config.namespace })
    if (pod.status?.conditions?.find((c) => c.type === "Ready" && c.status === "True") && pod.status?.podIP)
      return pod.status.podIP
    return null
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/**
 * List all sessions belonging to a user (by email annotation).
 * Pass the incoming request so URLs can be built with the correct scheme.
 */
export async function listUserSessions(
  email: string,
  _req: import("node:http").IncomingMessage,
): Promise<SessionInfo[]> {
  const pvcList = await k8sApi.listNamespacedPersistentVolumeClaim({
    namespace: config.namespace,
    labelSelector: `${LABEL_MANAGED_BY}=${MANAGED_BY_VALUE}`,
  })

  const userPVCs = pvcList.items.filter(
    (pvc: k8s.V1PersistentVolumeClaim) =>
      pvc.metadata?.annotations?.[ANNOTATION_USER_EMAIL] === email && !pvc.metadata?.deletionTimestamp,
  )
  if (userPVCs.length === 0) return []

  const podList = await k8sApi.listNamespacedPod({
    namespace: config.namespace,
    labelSelector: `${LABEL_MANAGED_BY}=${MANAGED_BY_VALUE}`,
  })
  const podMap = new Map<string, k8s.V1Pod>()
  for (const pod of podList.items) {
    const h = pod.metadata?.labels?.[LABEL_SESSION_HASH]
    // Skip terminating pods — treat them as stopped so port-forward isn't attempted
    if (h && !pod.metadata?.deletionTimestamp) podMap.set(h, pod)
  }

  const results = await Promise.allSettled(
    userPVCs.map((pvc: k8s.V1PersistentVolumeClaim) => {
      const hash = pvc.metadata?.labels?.[LABEL_SESSION_HASH] ?? ""
      return buildSessionInfo(hash, pvc, podMap.get(hash), email)
    }),
  )
  return results.flatMap((r) => {
    if (r.status === "fulfilled") return [r.value]
    console.error("Failed to map session PVC:", r.reason)
    return []
  })
}

/**
 * Update the last-activity annotation on a session's pod.
 * Throttled to at most once per minute per session to reduce K8s API load.
 */
export function updateLastActivity(hash: string): void {
  const now = Date.now()
  const last = activityThrottle.get(hash) ?? 0
  if (now - last < THROTTLE_MS) return

  activityThrottle.set(hash, now)
  const name = podName(hash)

  k8sApi
    .patchNamespacedPod({
      name,
      namespace: config.namespace,
      body: [
        {
          op: "add",
          path: `/metadata/annotations/${ANNOTATION_LAST_ACTIVITY.replace(/~/g, "~0").replace(/\//g, "~1")}`,
          value: new Date(now).toISOString(),
        },
      ],
    })
    .catch((err) => {
      console.error(`Failed to update last-activity for ${name}:`, err)
    })
  // Notify SSE session-list subscribers that last-activity changed
  emitSessionsChanged()
}

/**
 * Delete pods that have been idle longer than the configured timeout.
 * Only deletes pods — PVCs are preserved.
 */
export async function deleteIdlePods(): Promise<void> {
  const cutoff = Date.now() - config.idleTimeoutMinutes * 60_000

  try {
    const response = await k8sApi.listNamespacedPod({
      namespace: config.namespace,
      labelSelector: `${LABEL_MANAGED_BY}=${MANAGED_BY_VALUE}`,
    })

    for (const pod of response.items) {
      const lastActivity = pod.metadata?.annotations?.[ANNOTATION_LAST_ACTIVITY]
      if (!lastActivity) continue

      const lastMs = new Date(lastActivity).getTime()
      if (lastMs < cutoff) {
        const name = pod.metadata?.name
        if (!name) continue

        // Before deleting, poll the instance for real activity (WS sessions don't update annotation)
        const ip = pod.status?.podIP
        const podHash = pod.metadata?.labels?.[LABEL_SESSION_HASH] ?? name.replace("opencode-session-", "")
        if (ip) {
          const instanceMs = await podActivityMs(ip, podHash)
          if (instanceMs !== null && instanceMs.ms >= cutoff) {
            // Instance has recent activity — refresh annotation and skip deletion
            await k8sApi
              .patchNamespacedPod({
                name,
                namespace: config.namespace,
                body: [
                  {
                    op: "add",
                    path: `/metadata/annotations/${ANNOTATION_LAST_ACTIVITY.replace(/~/g, "~0").replace(/\//g, "~1")}`,
                    value: new Date(instanceMs.ms).toISOString(),
                  },
                ],
              })
              .catch((err) => console.error(`Failed to patch activity for ${name}:`, err))
            continue
          }
        }

        console.log(`Deleting idle pod ${name} (last activity: ${lastActivity})`)
        await k8sApi
          .deleteNamespacedPod({ name, namespace: config.namespace })
          .catch((err) => console.error(`Failed to delete pod ${name}:`, err))

        const hash = pod.metadata?.labels?.[LABEL_SESSION_HASH]
        if (hash) {
          activityThrottle.delete(hash)
          bootstrappedSessions.delete(hash)
          podSecretStore.delete(hash)
          messageStore.delete(hash)
          portStore.delete(hash)
          emitSessionsChanged()
        }
      }
    }
  } catch (err) {
    console.error("Failed to list pods for idle cleanup:", err)
  }
}

/**
 * Terminate a session: delete pod (if present) + PVC. Irreversible.
 * Only the session owner (email matching PVC annotation) may terminate.
 */
export async function terminateSession(hash: string, email: string): Promise<void> {
  const name = pvcName(hash)
  let pvc: k8s.V1PersistentVolumeClaim
  try {
    pvc = await k8sApi.readNamespacedPersistentVolumeClaim({ name, namespace: config.namespace })
  } catch (err) {
    if (isNotFound(err)) throw new Error("NotFound")
    throw err
  }

  const owner = pvc.metadata?.annotations?.[ANNOTATION_USER_EMAIL]
  if (owner !== email) throw new Error("Forbidden")

  // Delete pod if it exists (ignore NotFound)
  await k8sApi.deleteNamespacedPod({ name: podName(hash), namespace: config.namespace }).catch((err) => {
    if (!isNotFound(err)) throw err
  })

  // Delete PVC
  await k8sApi.deleteNamespacedPersistentVolumeClaim({ name, namespace: config.namespace })

  // Delete per-session github token Secret (ignore NotFound)
  await k8sApi.deleteNamespacedSecret({ name: githubSecretName(hash), namespace: config.namespace }).catch((err) => {
    if (!isNotFound(err)) throw err
  })

  activityThrottle.delete(hash)
  bootstrappedSessions.delete(hash)
  podSecretStore.delete(hash)
  messageStore.delete(hash)
  portStore.delete(hash)
  emitSessionsChanged()
}

/**
 * Resume a stopped session: recreate the pod for an existing PVC.
 * Idempotent — safe to call when pod already exists.
 * Only the session owner may resume.
 */
export async function resumeSession(hash: string, email: string, githubToken?: string): Promise<void> {
  const name = pvcName(hash)
  let pvc: k8s.V1PersistentVolumeClaim
  try {
    pvc = await k8sApi.readNamespacedPersistentVolumeClaim({ name, namespace: config.namespace })
  } catch (err) {
    if (isNotFound(err)) throw new Error("NotFound")
    throw err
  }

  const ann = pvc.metadata?.annotations ?? {}
  if (ann[ANNOTATION_USER_EMAIL] !== email) throw new Error("Forbidden")

  const session: SessionKey = {
    email: ann[ANNOTATION_USER_EMAIL] ?? email,
    repoUrl: ann[ANNOTATION_REPO_URL] ?? "",
    branch: ann[ANNOTATION_BRANCH] ?? "",
    sourceBranch: ann[ANNOTATION_SOURCE_BRANCH] ?? "",
  }

  if (githubToken) await ensureGithubTokenSecret(hash, githubToken)
  await ensurePod(session, githubToken)
  emitSessionsChanged()
}

function hasCode(err: unknown): err is { code: number } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as Record<string, unknown>).code === "number"
  )
}

function isNotFound(err: unknown): boolean {
  return hasCode(err) && err.code === 404
}

function isConflict(err: unknown): boolean {
  return hasCode(err) && err.code === 409
}

/** Poll a running pod's /experimental/session endpoint. Returns time.updated ms or null. */
async function podActivityMs(ip: string, hash: string): Promise<{ ms: number; sessionId?: string } | null> {
  try {
    let base = `http://${ip}:${config.opencodePort}`
    if (devProxy.enabled) {
      const proxyTarget = await devProxy.target(hash)
      if (!proxyTarget) return null
      base = proxyTarget
    }
    const res = await activityFetchImpl(`${base}/session?limit=1&roots=true`)
    if (!res.ok) return null
    const data = (await res.json()) as { id: string; time: { updated: number } }[]
    // Empty sessions = fresh pod that is reachable but has no sessions yet.
    // Return non-null so the caller can bootstrap a session via bootstrapPodSession.
    if (!data[0]) return { ms: Date.now(), sessionId: undefined }
    return { ms: data[0].time?.updated ?? Date.now(), sessionId: data[0].id }
  } catch {
    return null
  }
}

/**
 * Error thrown when a remote ref lookup cannot be completed (network failure, non-OK HTTP status).
 * Distinct from "branch missing" (which returns false) so callers can respond with 502 vs 400.
 */
export class RemoteRefsUnreachableError extends Error {
  constructor(repoUrl: string, cause: string) {
    super(`Could not reach ${repoUrl}: ${cause}`)
    this.name = "RemoteRefsUnreachableError"
  }
}

/**
 * Check whether a branch exists on a remote git repository via the Smart HTTP protocol.
 * Queries `<repoUrl>/info/refs?service=git-upload-pack` and scans the advertised refs for
 * `refs/heads/<branch>`. Works without git installed in the runtime image.
 *
 * Returns true if the branch is advertised, false if it isn't.
 * Throws RemoteRefsUnreachableError if the remote can't be reached or returns non-OK.
 */
export async function remoteBranchExists(repoUrl: string, branch: string): Promise<boolean> {
  const base = repoUrl.trim().replace(/\/+$/, "")
  const url = `${base}/info/refs?service=git-upload-pack`
  let res: Response
  try {
    res = await fetchImpl(url, { headers: { "User-Agent": "git/opencode-router" } })
  } catch (err) {
    throw new RemoteRefsUnreachableError(repoUrl, err instanceof Error ? err.message : String(err))
  }
  if (!res.ok) {
    throw new RemoteRefsUnreachableError(repoUrl, `HTTP ${res.status}`)
  }
  const body = await res.text()
  // Smart HTTP protocol v1 advertises each ref as "<sha> refs/heads/<name>" terminated by
  // \0 (first ref, before capabilities) or \n (subsequent refs). Match with an explicit
  // terminator so a branch "foo" doesn't accidentally match "foo-bar".
  const marker = `refs/heads/${branch}`
  let idx = 0
  while ((idx = body.indexOf(marker, idx)) !== -1) {
    const next = body.charAt(idx + marker.length)
    if (next === "\0" || next === "\n") return true
    idx += marker.length
  }
  return false
}

/**
 * Generate a collision-safe human-readable branch name.
 * Checks existing PVCs to avoid reusing a name for the same (email, repoUrl) pair.
 * Caps at 10 iterations; returns last candidate if all collide.
 */
export async function suggestBranch(email: string, repoUrl: string): Promise<string> {
  let candidate = ""
  for (let i = 0; i < 10; i++) {
    candidate = humanId({ separator: "-", capitalize: false })
    const hash = getSessionHash(email, repoUrl, candidate)
    try {
      await k8sApi.readNamespacedPersistentVolumeClaim({ name: pvcName(hash), namespace: config.namespace })
      // PVC exists — collision, try next
    } catch (err) {
      if (isNotFound(err)) return candidate
      throw err
    }
  }
  return candidate
}
