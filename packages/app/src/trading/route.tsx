// The trading dashboard: a fullscreen app view (like Home) fed by the Engine's
// local HTTP snapshot, falling back to sample data until the Engine answers,
// sitting side by side with its own dedicated chat session so the Agent can
// manage the systems while its dashboard stays visible. The dedicated chat
// persists across restarts like the native session tabs: its route re-adopts
// it through this run's pointer, the routed id, the stored pointer or the root
// index, and a session that died under the pointers is replaced, never first
// deleted. It owns no tab: Home's sidebar and command search exclude it via
// its metadata mark. Theme via the app's v2 tokens only; copy via i18n keys.

import { For, Show, Suspense, createEffect, createMemo, createSignal, lazy, on, onCleanup, onMount, type Accessor, type JSX } from "solid-js"
import { Title } from "@solidjs/meta"
import { useNavigate, useParams } from "@solidjs/router"
import { Schema } from "effect"
import { createStore, reconcile } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createMediaQuery } from "@solid-primitives/media"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useData, useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout, sessionPanelWidthDefault } from "@/shell/state/layout"
import { createPanelMotion, guardClosingFocus, holdLandingWidth, panelOpacity } from "@/shell/panel-motion"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useDialog } from "@opencode/ui/context/dialog"
import { Loader } from "@opencode/ui/loader"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { Switch } from "@opencode/ui/switch"
import { Tooltip } from "@opencode/ui/tooltip"
import { requireServerKey, tradingHref, tradingNewHref } from "@/shell/routes/session"
import { showToast } from "@/shell/notifications/toast"
import { useSettings } from "@/settings/model"
import { SessionPanelFrame } from "@/session/session-frame"
import {
  PANE_GAP,
  SESSION_PANEL_WIDTH_MIN,
  clampSessionPanelWidth,
  sessionPanelWidthCss,
  sessionPanelWidthMax,
} from "@/session/session-panel-width"
// The session route itself stays out of the trading module graph: the dashboard's first open
// must not pay for the chat chunk (which also drags the File viewer). It loads on its own,
// behind a Suspense boundary, only once this run's dedicated chat resolves and takes the pane.
const TargetSessionRouteContent = lazy(() =>
  import("@/session/route").then((module) => ({ default: module.TargetSessionRouteContent })),
)
import { isTradingSession, scanTradingSessions, TRADING_DESK_CONTEXT, TRADING_METADATA_MARK } from "./session"
import "./trading.css"
import { DEMO, REFRESCO_MS, arrancarSistema, cancelarTarea, cerrarPosicion, cerrarTotal, conectarCuenta, desconectarCuenta, panicoTotal, pararSistema, pedirSnapshot, programarTarea, type BotInfo, type CurvaInfo, type RegistroInfo, type SnapshotMotor, type TareaInfo, type TradeInfo } from "./motor"
import { tradingSectionKey, TradingNavStrip } from "./nav"

/** The trading panel's Intl formatter set: one per interface locale, built once and cached.
 * Money keeps the USD narrow `$` (the engine's unit — the same rendering the TUI's trading
 * panel shows), stamps follow the locale. Components read `useFormatos()` once and replay
 * the closures in their rows without touching Intl again. */
interface ConjuntoFormateo {
  usd: Intl.NumberFormat
  reloj: Intl.DateTimeFormat
  díaHora: Intl.DateTimeFormat
  completo: Intl.DateTimeFormat
}

const CONJUNTOS = new Map<string, ConjuntoFormateo>()

function conjuntoDe(locale: string) {
  let conjunto = CONJUNTOS.get(locale)

  if (conjunto === undefined) {
    conjunto = {
      usd: new Intl.NumberFormat(locale, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" }),
      reloj: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
      díaHora: new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }),
      completo: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }),
    }
    CONJUNTOS.set(locale, conjunto)
  }

  return conjunto
}

function useFormatos() {
  const language = useLanguage()
  const conjunto = conjuntoDe(language.intl())
  return {
    formatoUSD: (número: number | null) => (número === null || !Number.isFinite(número) ? "—" : conjunto.usd.format(número)),
    formatoHora: (ts: number) => (!Number.isFinite(ts) ? "—" : conjunto.reloj.format(ts)),
    /** Record rows: today's entries read as plain clock time, older ones name their day — the
     * ring keeps several days of history, so a bare clock time would make yesterday read as
     * today. */
    formatoMomento: (ts: number) => {
      if (!Number.isFinite(ts)) return "—"

      const momento = new Date(ts)
      return esHoy(momento) ? conjunto.reloj.format(momento) : conjunto.díaHora.format(momento)
    },
    títuloMomento: (ts: number) => (Number.isFinite(ts) ? conjunto.completo.format(new Date(ts)) : undefined),
  }
}

/** `-0.16%`-style signed percentage, or a dash when the engine received no value. */
const formatoPct = (valor: number | null) => (valor === null || !Number.isFinite(valor) ? "—" : `${Number(valor.toFixed(2))}%`)

function esHoy(momento: Date) {
  const ahora = new Date()
  return ahora.getFullYear() === momento.getFullYear() && ahora.getMonth() === momento.getMonth() && ahora.getDate() === momento.getDate()
}

const LINEA = { "line-height": "var(--line-height-compact)" } as const

const ChatLayout = Persistence.struct({
  chatWidth: Persistence.optional(Schema.Finite),
  // The chat panel's collapse state, like the app's right-side panel toggles. Absent means open.
  chatOpen: Persistence.optional(Schema.Boolean),
  // Where this window's dedicated chat lives per server, so the next start resumes it.
  chats: Persistence.recordRecover(Schema.String),
})

// The URL id of the dedicated chat before it is resolved.
const PENDING = "new"

function tonoPnl(valor: number | null) {
  if (valor === null) return "text-v2-text-text-faint"

  if (valor > 0) return "text-v2-state-fg-success"

  if (valor < 0) return "text-v2-state-fg-danger"

  return "text-v2-text-text-base"
}

function tonoNivel(nivel: RegistroInfo["nivel"]) {
  if (nivel === "error") return "text-v2-state-fg-danger"

  if (nivel === "aviso") return "text-v2-state-fg-warning"

  return ""
}

/** A record entry's lifecycle beat: green when the bot went in, amber when it came out,
 * blue for the first signal. The colors carry (light/dark) state tokens. */
const CLASE_EVENTO: Record<Exclude<RegistroInfo["evento"], null>, string> = {
  apertura: "border-v2-state-border-success bg-v2-state-bg-success text-v2-state-fg-success",
  cierre: "border-v2-state-border-warning bg-v2-state-bg-warning text-v2-state-fg-warning",
  senal: "border-v2-state-border-info bg-v2-state-bg-info text-v2-text-text-base",
}

const CLAVE_EVENTO: Record<Exclude<RegistroInfo["evento"], null>, string> = {
  apertura: "trading.log.event.open",
  cierre: "trading.log.event.close",
  senal: "trading.log.event.signal",
}

// Mapping table for the engine's internal level tokens: copy language always comes from
// the i18n keys, never from the stored Spanish words.
const CLAVE_NIVEL: Record<RegistroInfo["nivel"], string> = {
  info: "trading.log.level.info",
  aviso: "trading.log.level.warning",
  error: "trading.log.level.error",
}

const NÚMERO = "text-[13px] tabular-nums"

function MetaCuenta(props: { etiqueta: string; children: JSX.Element; mono?: boolean; tono?: string }) {
  return (
    <div class="flex min-h-6 items-center justify-between gap-6">
      <dt class="shrink-0 text-[13px] text-v2-text-text-faint" style={LINEA}>
        {props.etiqueta}
      </dt>
      <dd
        class={`min-w-0 truncate text-[13px] text-v2-text-text-base ${props.mono ? "font-mono" : ""} ${props.tono ?? ""} tabular-nums`}
        style={LINEA}
      >
        {props.children}
      </dd>
    </div>
  )
}

/** `/trading` with no routed chat yet: it redirects to its dedicated chat's start on Home's
 * server. With no visible server there is nothing to redirect to, so the route states its
 * own empty state instead of a blank pane. */
export function TradingRouter() {
  const layout = useLayout()
  const servers = useServers()
  const navigate = useNavigate()
  const language = useLanguage()

  createEffect(() => {
    // Home's own server choice: the remembered connection while it is visible, else the first visible one.
    const connection =
      servers.visible.find((item) => ServerConnection.key(item) === layout.home.selection().server) ??
      servers.visible[0]

    if (!connection) return

    navigate(tradingNewHref(ServerConnection.key(connection)), { replace: true })
  })

  // Route side only: while the redirect settles nothing shows but an empty frame; with no
  // visible server the redirect has nowhere to go and the pane states its own empty state.
  return (
    <Show
      when={servers.visible.length > 0}
      fallback={
        <div class="flex h-full items-center justify-center px-6">
          <p class="max-w-[420px] text-center text-[13px] text-v2-text-text-faint" style={LINEA}>
            {language.t("trading.servers.empty")}
          </p>
        </div>
      }
    >
      <div class="flex h-full items-center justify-center">
        <Loader />
      </div>
    </Show>
  )
}

// Dedicated chats already resolved in this app run, per server. Re-entry inside the run
// (switching back to the section, another trading tab) must resolve to the same chat
// again; the record resets on app restart. A boot never trusts a pointer without checking
// it live (the session may have been deleted out from under it): a dead pointer falls
// through to the routed id, the stored one and the scan, so the chat re-adopts.
// Reactive on purpose: writing the pointer is what resolves the route's boot gate, and an
// adoption often navigates to the URL the route already carries (a restored tab), so the
// resolved `<Show>` would otherwise re-evaluate for nothing and the boot screen would sit
// there forever even though the chat came up.
const [vivos, setVivos] = createStore<Record<string, string>>({})

// The system prompt of the trading chat: the standing instructions entry (`trading.desk`).
// It survives app restarts in the server-global store, and every boot adoption also
// re-writes it — an idempotent overwrite that keeps the entry in step with the user's
// edits without touching the chat itself.
const PromptoSchema = Persistence.struct({
  value: Persistence.optional(Schema.String),
})

export function TradingWithSession() {
  const params = useParams<{ serverKey: string; id: string }>()
  const language = useLanguage()
  const sdk = useServerSDK()
  // The route owns this persisted store on its own so the chat width, collapse state and the
  // dedicated-chat pointer never desync between instances over the same window target.
  const [layout, setLayout, , layoutReady] = persisted(Persist.window("trading.chat"), ChatLayout, { chats: {} })
  const [prompto, setPrompto, , promptoReady] = persisted(
    Persist.serverGlobal(sdk.scope, "trading.system-prompt"),
    PromptoSchema,
    {},
  )
  const serverKey = () => requireServerKey(params.serverKey)

  // Hydration gate: desktop reads persist through an async IPC, so the first render can outrun
  // the stored value. Every layout write waits for that read: a setter that lands first marks
  // the store touched and skips hydrating exactly what the storage held (width, open state,
  // chat pointers).
  const escribirLayout = (escribe: () => void) => {
    if (layoutReady()) escribe()
    else void layoutReady.promise?.then(escribe)
  }

  // The welcome note is purely informational: it shows while the resolved chat holds neither
  // delivered messages nor pending prompts, and both turn it off the instant they exist —
  // prompt admission is optimistic at Enter, so the note leaves on the send itself. During
  // boot it stays hidden: the boot states render their own centered content.
  const data = useData()

  const sinMensajes = createMemo(() => {
    const id = params.id
    if (id === PENDING || vivos[serverKey()] !== id) return false
    return data.session.message.list(id).length === 0 && data.session.pending.list(id).length === 0
  })

  // The data layer may not have synced this chat yet when it resolves; seed it so the memo
  // reads real contents instead of an empty store.
  createEffect(
    on(
      () => params.id,
      (id) => {
        if (id === PENDING || vivos[serverKey()] !== id) return
        void Promise.all([data.session.message.sync(id), data.session.pending.sync(id)]).catch(() => undefined)
      },
    ),
  )


  // Save an edited prompt: written to the server-global store first (it survives every restart),
  // then synced into the current chat's instructions entry so the running conversation picks it up.
  // A chat that has not resolved yet only gets the store; its boot reads it when it seeds. The
  // verdict returns to the caller: only a saved prompt closes the editor — a failed one leaves
  // the text on screen with its error toast, so the user retries instead of losing it.
  const guardarPrompto = async (valor: string): Promise<boolean> => {
    try {
      await promptoReady.promise
      setPrompto({ value: valor })

      if (params.id !== PENDING) {
        await sdk.api.experimental.session.instructions.entry
          .put({ sessionID: params.id, key: "trading.desk", value: valor })
      }

      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("trading.prompt.saved"),
      })
      return true
    } catch {
      showToast({
        variant: "error",
        title: language.t("trading.prompt.failed"),
      })
      return false
    }
  }

  return (
    <>
      {/* The window title switches with the product, the same composition the session route
          drives (`<name> · OpenCode`), so switching to Trading does not trail it 1–2 s. */}
      <Title>{`${language.t("trading.title")} · OpenCode`}</Title>
      <TradingShell
        // Read verbatim like the native session's: the stored width stands (or the default
        // the session layout owns while unset), with `resizada` mirroring the native's
        // derived flag — a stored width means the user dragged the divider. No floor here:
        // the contract's clamp and CSS own the minimum.
        anchuraChat={() => layout.chatWidth ?? sessionPanelWidthDefault}
        resizada={() => layout.chatWidth !== undefined}
        fijarAnchura={(anchura) => escribirLayout(() => setLayout("chatWidth", anchura))}
        abierto={() => layout.chatOpen ?? true}
        fijarAbierto={(abierto) => escribirLayout(() => setLayout("chatOpen", abierto))}
        prompto={() => prompto.value}
        guardarPrompto={guardarPrompto}
        sinMensajes={() => sinMensajes()}
        chat={
        <Show
          // Resolved means this run's own chat. Anything else (pending or a session id
          // restored from a previous run's tab) boots, which re-adopts the chat the id
          // names or falls through to the stored pointer, the scan and a fresh chat.
          when={params.id !== PENDING && vivos[serverKey()] === params.id}
          fallback={
            // Boot state only: every state of the resolved session route brings its own panel
            // frame, so it renders bare like the session route and a second frame never stacks.
            // The store gate waits for hydration: desktop reads persist through async IPC (and
            // the prompt reads back from the server), so booting before `ready` would see the
            // defaults — a pointerless boot takes the full scan instead of adopting its chat,
            // and the seed could text in the default instead of the stored prompt.
            <div class="flex min-h-0 flex-1 px-[var(--shell-inline-inset,8px)] pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]">
              <SessionPanelFrame raised>
                <Show when={layoutReady() && promptoReady()} fallback={<div class="flex h-full items-center justify-center"><Loader /></div>}>
                  <ChatBoot
                    semilla={() => prompto.value ?? TRADING_DESK_CONTEXT}
                    previa={() => layout.chats?.[serverKey()]}
                    actual={() => (params.id === PENDING ? undefined : params.id)}
                    recordar={(id) => escribirLayout(() => setLayout("chats", serverKey(), id))}
                  />
                </Show>
              </SessionPanelFrame>
            </div>
          }
        >
          <Suspense
            // Purposeful suspension: the session route lands as a late chunk after the chat
            // resolves; the empty frame pins the chat pane's geometry until it arrives, the
            // same shape routes.tsx holds the session route behind.
            fallback={
              <div class="flex min-h-0 flex-1 px-[var(--shell-inline-inset,8px)] pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]">
                <SessionPanelFrame raised />
              </div>
            }
          >
            <TargetSessionRouteContent />
          </Suspense>
        </Show>
      }
    />
    </>
  )
}

/**
 * Boots the trading section's dedicated route. The chat persists across restarts like
 * the native session tabs, so this never deletes the chat it resumes: this run's
 * pointer is reused first, then the session id the route arrived with (restored tab,
 * last-active URL), then the stored pointer, then the first marked session the root
 * scan finds — a catch also the recovery path that re-adopts under dead pointers.
 * Every adoption re-seeds the desk instructions (an idempotent overwrite) and marked
 * leftovers further back in the scan go out (best effort) so a boot race between
 * windows cannot accumulate chats. Only when nothing marked exists anywhere is a
 * fresh session created with the mark. The seed text comes from the stored prompt
 * when the user edited it, or the default desk context otherwise.
 */
function ChatBoot(props: {
  semilla: () => string
  previa: () => string | undefined
  /** The session id the route arrived with (undefined at `/new`): a restored tab's own chat. */
  actual: () => string | undefined
  recordar: (id: string) => void
}) {
  const language = useLanguage()
  const data = useData()
  const server = useServer()
  const sdk = useServerSDK()
  const navigate = useNavigate()
  const [estado, setEstado] = createStore<{ tipo: "iniciando" | "fallo" }>({ tipo: "iniciando" })
  // The boot's own fetch channel: the route's unmount aborts an in-flight pointer check or
  // scan instead of letting it finish into a dead closure.
  const canal = new AbortController()
  let vigente = true

  onCleanup(() => {
    canal.abort()
    vigente = false
  })

  onMount(() => {
    arrancar()
  })

  const arrancar = () => {
    setEstado("tipo", "iniciando")

    void arrancarDedicado().catch(() => {
      if (vigente) setEstado("tipo", "fallo")
    })
  }

  // One shared adoption for every path: it re-points this run and the stored pointer,
  // routes to the chat and re-seeds the desk instructions. The re-seed is an idempotent
  // overwrite (see the PromptoSchema note) that keeps the entry in step with the user's
  // prompt edits — a fresh chat seeds before the route switches (A-8: the first prompt
  // must not escape without context), adoptions re-put after the switch, both best
  // effort: a server without the experimental endpoint still started the chat; a later
  // boot retries the seeding.
  const adoptar = (id: string, sembrar = true) => {
    // One per-session context entry keeps the chat on-topic for every step (see
    // TRADING_DESK_CONTEXT). The user-editable prompt (stored server-side) replaces the
    // default when present.
    props.recordar(id)
    setVivos(server.key, id)
    navigate(tradingHref(server.key, id), { replace: true })

    if (sembrar)
      void sdk.api.experimental.session.instructions.entry
        .put({ sessionID: id, key: "trading.desk", value: props.semilla() })
        .catch(() => undefined)
  }

  // A pointer only counts when the session is still there and really is a trading chat:
  // the mark is the only thing this route trusts, and the fetch rides the boot's channel,
  // aborted when the route unmounts.
  const prioridad = async (id: string) => {
    const conocida = await sdk.api.session.get({ sessionID: id }, { signal: canal.signal }).catch(() => undefined)

    if (!vigente) return undefined

    return conocida && isTradingSession(conocida) ? id : undefined
  }

  const arrancarDedicado = async () => {
    // (1) Re-entry inside this run (coming back to the section, another trading tab):
    // the chat this run created resolves again, verified live before reuse.
    const viva = vivos[server.key]

    // (2) The session id routed in (a restored tab on the window's last-active URL): the
    // strongest pointer outside the run. It is adopted only when it really is a trading
    // chat — never when it is a dead session or somebody else's chat.
    const routed = props.actual()

    // (3) The stored pointer may predate this window (a previous run's persistence) and
    // can be the same id the route carried, which reads no second fetch.
    const almacenada = props.previa()

    const adoptada =
      (viva ? await prioridad(viva) : undefined) ??
      (routed ? await prioridad(routed) : undefined) ??
      (almacenada && almacenada !== routed ? await prioridad(almacenada) : undefined)

    // Every candidate above already verified its mark through `prioridad`, so the boot
    // either adopts here or keeps going down the recovery path — it never creates while
    // a live chat exists.
    if (adoptada) return adoptar(adoptada)

    // (4) The pointers named nothing live: the root index scan (cleared storage, stale
    // pointer, a session deleted out from under the pointers). It rides the boot's abort
    // channel and only ever runs on this recovery path.
    const marcadas = [...(await scanTradingSessions((input, options) => sdk.api.session.list(input, { ...options, signal: canal.signal })))]

    if (!vigente) return

    // The scan comes back newest first, so the first is the chat of record; marked
    // leftovers behind it (a boot race between windows that created two) go out while
    // the route adopts the survivor. Best effort: a removal that fails (a session gone
    // in the meantime, a recovering server) must not block the adoption; the next start
    // would retry the cleanup.
    const [primera, ...sobrantes] = marcadas

    if (primera) {
      void Promise.allSettled(sobrantes.map((session) => data.session.remove(session.id)))

      return adoptar(primera.id)
    }

    // (5) Nothing marked exists anywhere: a fresh dedicated chat (first run ever, or the
    // pool was cleaned along the chats). Its standing instructions land before the route
    // switches, so the composer never opens by a round-trip in which a first prompt could
    // escape without context (A-8).
    const info = await sdk.api.session.create({
      title: language.t("trading.title"),
      metadata: { [TRADING_METADATA_MARK]: true },
    })

    data.session.remember(info)

    if (!vigente) return

    const sembrado = await sdk.api.experimental.session.instructions.entry
      .put({ sessionID: info.id, key: "trading.desk", value: props.semilla() })
      .catch(() => undefined)

    if (!vigente) return

    adoptar(info.id, sembrado === undefined)
  }

  return (
    <Show
      when={estado.tipo === "iniciando"}
      fallback={
        <div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p class="max-w-[420px] text-[13px] text-v2-text-text-muted" style={LINEA}>
            {language.t("trading.chat.failed")}
          </p>
          {/* The app's own outline button: the shared control carries the native focus ring
              and pressed states the raw element above lacked. */}
          <Button type="button" variant="outline" size="normal" onClick={arrancar}>
            {language.t("trading.chat.retry")}
          </Button>
        </div>
      }
    >
      <div class="flex h-full flex-col items-center justify-center gap-3 p-6">
        <Loader />
        <p class="text-[13px] text-v2-text-text-muted" style={LINEA}>
          {language.t("trading.chat.starting")}
        </p>
      </div>
    </Show>
  )
}

/** The two-pane row: dashboard, then the routed dedicated chat (or its boot state). */
function TradingShell(props: {
  anchuraChat: Accessor<number>
  /** The native derived flag: the stored width exists — the user resized the panel. */
  resizada: Accessor<boolean>
  fijarAnchura: (anchura: number) => void
  abierto: Accessor<boolean>
  fijarAbierto: (abierto: boolean) => void
  /** The stored chat prompt (the default desk context when the user has never edited it). */
  prompto: Accessor<string | undefined>
  guardarPrompto: (valor: string) => Promise<boolean>
  /** True while the resolved chat holds no messages: the welcome note shows (informational). */
  sinMensajes: Accessor<boolean>
  chat: JSX.Element
}) {
  const { formatoUSD, formatoHora } = useFormatos()
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useServerSDK()
  const layout = useLayout()
  const [snapshot, setSnapshot] = createStore<SnapshotMotor>(structuredClone(DEMO))
  // One system write at a time: while a toggle's or batch's round-trip runs, the pool's
  // controls ignore further clicks, so a rapid re-click cannot race its own flag.
  const [escrituras, fijarEscrituras] = createSignal(false)
  // One lost snapshot answer outlives the poll: the panel keeps the last real values it
  // got (the "stale" read below) and locks the writes until an answer lands again.
  const [caducado, fijarCaducado] = createSignal(false)
  // "Active" reads the union of the command flag and the running mirror: the flag leads
  // (a fresh flip lands before the poll's own mirror catches up) and the mirror can
  // outlive the flag (a bot process running through a flag edit) — either way the user
  // must see a running system and be able to stop it.
  const activos = () => snapshot.bots.filter((bot) => bot.activo || bot.enMarcha).length
  // The product's section: the sidebar rows and this panel read the same layout store.
  const sección = () => layout.producto.section()

  // One record, no per-system tabs: log lines and closed trades merge into a single
  // chronological list whose close rows ARE the trades (each close already logs itself,
  // so the trades carry the P/L and the log's own close rows drop out) — nothing repeats.
  const registroUnido = () => reunirRegistro(snapshot.registros, snapshot.trades)

  // The manual-close permission lives for this window's run only: the switch arms the
  // close actions (per-position and close-all) from the OFF default each start, so no
  // stale opt-in can stand in for orders the user never asked for — the shared global
  // store never holds the flag at all, and the confirmation dialog still guards both
  // close paths.
  const [cierreManual, fijarCierreManual] = createSignal(false)
  const cierrePermitido = cierreManual

  // The chat pane flies on the app's shared panel motion — the same system the session's side
  // panel uses, with the roles mirrored: the dashboard plays the session chat's own pane, and
  // the flight paints the dashboard's width, so the chat's presence takes the row's leftover
  // and follows its edge every frame without painting a width of its own. Only the dashboard
  // paints, and the chat's interior never shrinks its layout mid-flight: the landing hold
  // pins its contents to the width they arrive at while the flight runs.
  let chatPresencia: HTMLDivElement | undefined
  let chatContenido: HTMLDivElement | undefined
  let panelDashboard: HTMLDivElement | undefined

  const [filaSize, setFilaSize] = createStore<{ width?: number }>({})
  let filaPaneles: HTMLDivElement | undefined
  createResizeObserver(
    () => filaPaneles,
    ({ width }) => setFilaSize({ width }),
  )

  const escritorio = createMediaQuery("(min-width: 768px)")

  // Section reachability repeats the shell's rule (shell.tsx's verticalTabs): the product's
  // sidebar rows mount only on a non-horizontal tab layout at desktop width, so every other
  // layout — a horizontal tab strip, a stacked window, a phone — hosts the nav strip inside
  // the dashboard itself and the sections stay reachable everywhere.
  const settings = useSettings()
  const navStrip = () => settings.appearance.tabLayout() === "horizontal" || !escritorio()

  // The exact derivation the session's own layout uses (`screen-layout.ts`): the row less
  // its panel gap, undefined until the row first measures — width consumers keep the stored
  // value untouched until then so nothing snaps on the first frame.
  const disponible = createMemo<number | undefined>(() => {
    const width = filaSize.width

    if (width === undefined) return undefined

    return width - PANE_GAP
  })

  // The chat panel obeys the persisted toggle alone, like the native session panel: the
  // session panel never hides because the row no longer fits, and neither does this one —
  // the chat's minimum holds and the dashboard takes whatever the chat leaves behind.
  const chatVisible = () => props.abierto() && escritorio()
  const chatVisto = () => (escritorio() ? chatMotion.present() || chatMontada() : props.abierto())

  // The chat's present-tense clamp — `screen-layout.ts`'s own `resizedWidth`: the persisted
  // width rendered against whatever the row measures now, no travel history. An unmeasured
  // row renders the stored width untouched, so nothing snaps off the first frame.
  const chatAnchoVivo = createMemo(() =>
    clampSessionPanelWidth({
      width: props.anchuraChat(),
      available: disponible(),
      split: false,
      resized: props.resizada(),
    }),
  )

  // The chat's open width, kept through a close as the far end of its travel — the sticky
  // width the session side panel hands its content. It follows the live clamp only while the
  // chat shows on a measured row; before that, the content renders at its natural
  // full-presence width with no first-frame snap.
  const chatAncho = createMemo<number | undefined>((previous) => {
    return chatVisible() && disponible() !== undefined ? chatAnchoVivo() : previous
  })

  // The content box's width at rest: the chat's full span before the row measures, the
  // landed width on every desktop flight after, and 100% again stacked — the pane spans
  // the row there and holds no travel of its own, so a crossing between layouts never
  // pins a desktop width onto the full-width stacked chat.
  const chatAnchoContenido = createMemo<string>((previous) => {
    if (!escritorio()) return "100%"

    const width = chatAncho()

    return width === undefined ? previous : `${width}px`
  }, "100%")

  // The chat's resting width in CSS against the row — the native formula, so it follows the
  // row on the frame it resizes — builds the dashboard's open width below.
  const chatWidthCss = createMemo(() => sessionPanelWidthCss({ width: props.anchuraChat(), split: false, resized: props.resizada() }))

  // The dashboard keeps its open width as the far end of a close's travel — the native
  // flight's sticky open width, mirrored one seam over: the row less the panel gap and the
  // chat's resting width, what that split leaves the dashboard.
  const dashAbierta = createMemo<string>((previous) => (chatVisible() ? `calc(100% - ${PANE_GAP}px - ${chatWidthCss()})` : previous), "100%")

  // Once opened, the pane stays mounted whatever the collapse state does, so a flight reuses
  // the content and its layout instead of remounting the whole chat mid-air, and a close
  // settles into a parked state instead of an unmount.
  const [chatMontada, fijarChatMontada] = createSignal(false)

  // The content keeps the width it lands at through every flight, so the transcript never
  // rewraps per frame while its box moves, and centred blocks keep their place. The property
  // doesn't inherit, so setting and clearing it restyles only the card.
  holdLandingWidth(
    () => chatContenido,
    "blocks",
    () => chatContenido?.querySelector<HTMLElement>('[data-slot="trading-chat-panel"]'),
  )

  const chatMotion = createPanelMotion({
    open: chatVisible,
    paint: (cerrado) => {
      // Dims the contents as they leave and fades them in as they arrive — desktop only:
      // on the stacked layout the chat is shown by the persisted toggle at full width and
      // no flight owns a fade there (the mirrored native never shows the side panel
      // inline on the narrow layout either).
      if (escritorio() && chatContenido) chatContenido.style.opacity = panelOpacity(cerrado)

      if (!panelDashboard) return

      // The dashboard's width paints every state the way the native flight paints its
      // carrier: closed, the whole row, so the parked chat sits on nothing; open, the row
      // less the gap and the chat's resting width; between, the two ends interpolated on a
      // live `100%` — no measured pixels, so a flight's ends always agree with the formulas
      // they land at and the dashboard rides window and sidebar resizes mid-air.
      const abierta = dashAbierta()

      if (cerrado === 1) {
        panelDashboard.style.width = "100%"

        return
      }

      panelDashboard.style.width = cerrado === 0 ? abierta : `calc(${abierta} + (100% - ${abierta}) * ${cerrado})`
    },
    element: () => chatPresencia,
    distance: () => chatAncho(),
  })

  // The panel counts as mounted once it has shown in either layout. Stacked must mark it
  // too: on the narrow layout the persisted toggle shows the pane without flights and the
  // marker would otherwise stay false, so crossing up to desktop (present() still false
  // for the flight's first frames) would drop the Show for one frame and remount the
  // whole chat — the composer draft and the transcript scroll would land states late.
  createEffect(() => {
    if (chatVisible() || (!escritorio() && props.abierto())) fijarChatMontada(true)
  })

  // Close flight guard, the native side panel's own: focus inside the pane moves to the
  // control that reopens it the moment the close starts (the parked ChatShell's inert
  // only settles after the flight), and every later focusin while closed is evicted the
  // same way.
  guardClosingFocus({
    root: () => chatPresencia,
    closing: () => !chatVisible() && chatMotion.present(),
    target: () =>
      panelDashboard?.querySelector<HTMLElement>('[data-slot="trading-chat-toggle"] button') ?? undefined,
  })

  // A desktop flight that settles parked leaves the contents dimmed to nothing; when the
  // window crosses to the stacked layout the chat shows again by the persisted toggle, at
  // full width and with no flight of its own. Clear the stale dim once the layout flips,
  // so the presentation never rides a flight that never ran.
  createEffect(
    on(
      () => escritorio(),
      () => {
        if (!escritorio() && chatContenido) chatContenido.style.opacity = ""
      },
    ),
  )

  // One control for the chat, like the app's own panel toggles: it sits at the window's
  // top-right corner in both states, because that corner belongs to the dashboard when
  // the chat is hidden and to the chat when it is open. The control, the header's corner
  // reserve and the edit button read the persisted toggle — the native panel's own flag.
  const etiquetaChat = () => language.t(props.abierto() ? "trading.chat.hide" : "trading.chat.show")

  // The chat's effective visibility, the state `aria-expanded` must report: desktop owns
  // the parked state (a parked chat renders but is not visible), stacked rides the persisted
  // toggle alone. The control also targets the panel only while it exists in the DOM.
  const chatAbiertaActual = () => (escritorio() ? chatMotion.present() : props.abierto())

  const botónChat = () => (
    <Tooltip class="shrink-0" placement="bottom" value={etiquetaChat()}>
      <IconButton
        type="button"
        variant="ghost-muted"
        size="large"
        class="shrink-0"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => props.fijarAbierto(!props.abierto())}
        aria-label={etiquetaChat()}
        aria-expanded={chatAbiertaActual()}
        aria-controls={chatAbiertaActual() ? "trading-chat-panel" : undefined}
        icon={<Icon name={props.abierto() ? "layout-right-full" : "layout-right"} />}
      />
    </Tooltip>
  )

  const abrirPrompto = () => dialog.show(() => <DialogPrompto contenido={props.prompto() ?? TRADING_DESK_CONTEXT} guardar={props.guardarPrompto} />)

  // The system's dossier: the same registry rows the LOG card shows, filtered to this one
  // bot, plus the snapshot store's live flags (state, process, P/L) that each 3 s poll touches.
  const abrirFicha = (bot: BotInfo) => {
    dialog.show(() => (
      <DialogFicha
        bot={() => snapshot.bots.find((candidato) => candidato.id === bot.id)}
        registros={() => registroUnido().filter((entrada) => entrada.bot === bot.nombre)}
        programar={(entrada) => programarSistema(bot.id, entrada)}
      />
    ))
  }

  // The chat drags up to the native maximum, derived off the row exactly where the resting
  // formula caps it — `screen-layout.ts`'s `panel.max` (drag semantics: always `resized`),
  // with the session's 1000 default before the row ever measures.
  const chatWidthMax = () => {
    const width = disponible()

    if (width === undefined) return 1000

    return sessionPanelWidthMax({ available: width, split: false, resized: true })
  }

  // The size the handle sees is the same resting clamp the panel renders — never a raw
  // stored width — so the handle's size can never arrive past its own max and land mid-drag
  // on a first-frame jump.
  const chatAnchoManija = () => Math.min(chatAnchoVivo(), chatWidthMax())

  // Polls and user refreshes share one writer: every call takes the next generation slot
  // and only the newest applying answer lands, so a slow poll can never write over what a
  // fresher refresh already wrote. A call that gets no answer marks the snapshot stale —
  // unless a newer call already answered — and freezes the panel on its last real values.
  let generación = 0

  const refrescar = async () => {
    const propia = ++generación
    const real = await pedirSnapshot(sdk.api)

    // A newer call owns the snapshot now (the poll, a user refresh, a follow-up after an
    // action): this answer writes nothing.
    if (propia !== generación) return

    if (real === undefined) {
      setSnapshot("enlace", false)
      fijarCaducado(true)

      return
    }

    fijarCaducado(false)
    // reconcile instead of a wholesale replace: the poll rewrites the same values every
    // 3 s, and a fresh object identity would remount every row's DOM (and its focus) at
    // each tick — the diff keeps unchanged leaves (and their nodes) in place.
    setSnapshot(reconcile({ ...real, demo: false }))
  }

  // v0 flag toggle: it marks the system running/stopped inside the engine (local state,
  // no IBKR contact), then an immediate refresh shows the flip. The demo pool reuses real
  // ids, so a sample row's click never reaches the engine (a read-only showcase); one
  // write at a time keeps a click storm from interleaving its own flag; a no-answer
  // meets its toast instead of dying silent.
  const fijarSistema = async (bot: { readonly id: string; readonly activo: boolean; readonly enMarcha: boolean }) => {
    if (snapshot.demo || escrituras()) return

    fijarEscrituras(true)
    const respuesta = await (bot.activo || bot.enMarcha ? pararSistema(sdk.api, bot.id) : arrancarSistema(sdk.api, bot.id))
    fijarEscrituras(false)

    if (respuesta === undefined) showToast({ variant: "error", title: language.t("trading.systems.failed") })

    await refrescar()
  }

  // Batch toggles write every system's flag in one go and refresh once — the engine takes
  // the writes in parallel, so the pool costs one refresh instead of one per system. A
  // write the engine never answered fails the batch as one (a single toast, not one per
  // row); demo rows hold live ids, so the batch never runs on them either.
  const lotearSistemas = async (operaciones: Array<Promise<unknown>>) => {
    if (snapshot.demo || escrituras()) return

    fijarEscrituras(true)
    const respuestas = await Promise.all(operaciones)
    fijarEscrituras(false)

    if (respuestas.some((respuesta) => respuesta === undefined))
      showToast({ variant: "error", title: language.t("trading.systems.failed") })

    await refrescar()
  }

  const arrancarTodos = () =>
    lotearSistemas(
      snapshot.bots
        .filter((bot) => !(bot.activo || bot.enMarcha))
        .map((bot) => arrancarSistema(sdk.api, bot.id)),
    )

  const pararTodos = () =>
    lotearSistemas(snapshot.bots.filter((bot) => bot.activo || bot.enMarcha).map((bot) => pararSistema(sdk.api, bot.id)))

  // Scheduling from a system's dossier: the scope is fixed by the card itself, so only the
  // action and the moment are picked. The same toast feedback as the dashboard writes.
  // Sample rows carry fake ids, so their schedule write never reaches the engine.
  const programarSistema = async (systemID: string, entrada: { kind: "start-systems" | "stop-systems"; delayMinutes?: number; atTime?: string }) => {
    if (snapshot.demo) return

    const resultado = await programarTarea(sdk.api, {
      kind: entrada.kind,
      systemIDs: [systemID],
      delayMinutes: entrada.delayMinutes,
      atTime: entrada.atTime,
    })

    if (resultado === undefined) {
      showToast({ variant: "error", title: language.t("trading.tasks.failed") })
    } else {
      showToast({ variant: "success", icon: "circle-check", title: language.t("trading.tasks.saved") })
    }

    await refrescar()
  }

  // Stopping everything leaves open positions alone — they are not auto-closed — so the
  // dialog states that plainly before the flags flip.
  const abrirPararTodos = () =>
    dialog.show(() => (
      <DialogCierre
        avisa={false}
        confirmar={pararTodos}
        título={language.t("trading.systems.stopAll.title")}
        cuerpo={language.t("trading.systems.stopAll.body")}
        advertencia=""
        confirmarTexto={language.t("trading.systems.stopAll")}
      />
    ))

  // Starting everything arms every idle flag in one motion (the engine begins to trade):
  // a push this wide states what it does in its own confirmation, the same way the
  // close-all and the stop-all live behind. Its confirm reads as a primary action, not
  // a danger one.
  const abrirArrancarTodos = () =>
    dialog.show(() => (
      <DialogCierre
        avisa={false}
        tono="submit"
        confirmar={arrancarTodos}
        título={language.t("trading.systems.startAll.title")}
        cuerpo={language.t("trading.systems.startAll.body")}
        advertencia=""
        confirmarTexto={language.t("trading.systems.startAll")}
      />
    ))

  // Close semantics: real orders, so the confirmation is a dialog that states the full cycle
  // and warns when a running system trades the same contract family (it would reopen the
  // position). The engine's verdict comes back in the toast (its own message in the
  // description). Orders need the engine's TWS socket, so both the write and its door
  // (the buttons below) hold on `enlace`, and a sample account would close nothing.
  // Contract families carry alias nicknames across CME's reports (micro M2K under RTY, 6J
  // under JPY): an alias pair covers both spellings, so a running system warns its family's
  // close either way.
  const FAMILIAS: ReadonlyArray<readonly [string, string]> = [
    ["RTY", "M2K"],
    ["6J", "JPY"],
  ]

  const mismaFamilia = (papel: string, base: string) =>
    papel.includes(base) ||
    FAMILIAS.some(([una, otra]) => (base === una || base === otra) && (papel.includes(una) || papel.includes(otra)))

  const sistemasSobreSímbolo = (símbolo: string) =>
    snapshot.bots.filter((bot) => (bot.activo || bot.enMarcha) && mismaFamilia(símbolo, bot.simbolo))

  const ejecutarCierre = async (símbolo: string) => {
    if (snapshot.demo || !snapshot.enlace) return

    try {
      const respuesta = await cerrarPosicion(sdk.api, símbolo)
      if (respuesta === undefined) throw new Error("sin respuesta")
      const resultado = respuesta
      if (resultado.ok) {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("trading.position.dialog.sent"),
          description: resultado.message,
        })
      } else {
        showToast({
          variant: "error",
          title: language.t("trading.position.dialog.failed"),
          description: resultado.message,
        })
      }
    } catch {
      showToast({
        variant: "error",
        title: language.t("trading.position.dialog.failed"),
      })
    }
    void refrescar()
  }

  // The emergency close-all: same semantics as the single close, but the engine runs the
  // full cycle over every open position and reports per-symbol verdicts in one message.
  const ejecutarCierreTotal = async () => {
    if (snapshot.demo || !snapshot.enlace) return

    try {
      const resultado = await cerrarTotal(sdk.api)
      if (resultado === undefined) throw new Error("sin respuesta")
      if (resultado.ok) {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("trading.position.closeAll.sent"),
          description: resultado.message,
        })
      } else {
        showToast({
          variant: "error",
          title: language.t("trading.position.closeAll.failed"),
          description: resultado.message,
        })
      }
    } catch {
      showToast({
        variant: "error",
        title: language.t("trading.position.closeAll.failed"),
      })
    }
    void refrescar()
  }

  const abrirCierre = (posición: SnapshotMotor["posiciones"][number]) => {
    dialog.show(() => (
      <DialogCierre
        avisa={sistemasSobreSímbolo(posición.simbolo).length > 0}
        confirmar={() => ejecutarCierre(posición.simbolo)}
        título={language.t("trading.position.dialog.title")}
        cuerpo={language.t("trading.position.dialog.body")}
        advertencia={language.t("trading.position.dialog.warning")}
        confirmarTexto={language.t("trading.position.dialog.confirm")}
      />
    ))
  }

  // Any running system could reopen its position right after the close-all, so the warning
  // shows whenever the pool has an active flag.
  const abrirCierreTotal = () => {
    dialog.show(() => (
      <DialogCierre
        avisa={snapshot.bots.some((bot) => bot.activo || bot.enMarcha)}
        confirmar={ejecutarCierreTotal}
        título={language.t("trading.position.closeAll.title")}
        cuerpo={language.t("trading.position.closeAll.body")}
        advertencia={language.t("trading.position.closeAll.warning")}
        confirmarTexto={language.t("trading.position.closeAll.confirm")}
      />
    ))
  }

  // Conectar/Desconectar are the user's own clicks: the engine never links TWS by itself,
  // and each toggle refreshes right away so the pill and the account follow the socket.
  const [enlazando, fijarEnlazando] = createSignal(false)
  const enlazar = async () => {
    if (enlazando()) return
    fijarEnlazando(true)
    await conectarCuenta(sdk.api)
    fijarEnlazando(false)
    await refrescar()
  }

  const desenlazar = async () => {
    if (enlazando()) return
    fijarEnlazando(true)
    await desconectarCuenta(sdk.api)
    fijarEnlazando(false)
    await refrescar()
  }

  // The panic stop's verdict arrives as one message (the stopped systems plus the close-all
  // report), shown in the toast the same way the close actions report theirs. The close
  // half can fail without failing the stop half, so the verdict title follows the close's
  // own ok: executed over a failed half, never a green title over a broken panic.
  const ejecutarPanico = async () => {
    const resultado = await panicoTotal(sdk.api)

    if (resultado === undefined) {
      showToast({ variant: "error", title: language.t("trading.panic.failed") })
    } else {
      showToast({
        variant: resultado.close.ok ? "success" : "error",
        icon: resultado.close.ok ? "circle-check" : undefined,
        title: language.t(resultado.close.ok ? "trading.panic.sent" : "trading.panic.failed"),
        description: resultado.message,
      })
    }

    await refrescar()
  }

  const abrirPanico = () => {
    dialog.show(() => (
      <DialogCierre
        avisa={false}
        confirmar={ejecutarPanico}
        título={language.t("trading.panic.title")}
        cuerpo={language.t("trading.panic.body")}
        advertencia=""
        confirmarTexto={language.t("trading.panic.confirm")}
      />
    ))
  }

  // A withdrawal is a small write: its engine round-trip answers right away, so the
  // confirmation lives in the row's tooltip and the verdict comes back in the toast.
  // Sample tasks carry fake ids, so their cancel never reaches the engine.
  const cancelarPrograma = async (taskID: string) => {
    if (snapshot.demo) return

    const resultado = await cancelarTarea(sdk.api, taskID)

    if (resultado === undefined) {
      showToast({ variant: "error", title: language.t("trading.tasks.failed") })
    } else {
      showToast({ variant: "success", icon: "circle-check", title: language.t("trading.task.cancelled") })
    }

    await refrescar()
  }

  onMount(() => {
    void refrescar()

    const temporizador = setInterval(() => {
      void refrescar()
    }, REFRESCO_MS)

    onCleanup(() => clearInterval(temporizador))
  })

  const etiquetaMotor = () =>
    language.t(
      snapshot.demo ? "trading.engine.demo" : snapshot.enlace ? "trading.engine.linked" : "trading.engine.offline",
    )

  const puntoMotor = () => (snapshot.enlace ? "bg-v2-state-fg-success" : "bg-v2-state-fg-danger")

  // The day-loss guard read passively: its state is one account line, never an input here —
  // the limit itself is set through the chat.
  const guardiaDia = () => {
    const riesgo = snapshot.riesgo

    if (!riesgo) return { texto: "—", tono: "text-v2-text-text-faint" }

    if (riesgo.disparada !== null)
      return { texto: `${language.t("trading.risk.triggered")} · ${formatoHora(riesgo.disparada)}`, tono: "text-v2-state-fg-danger" }

    if (riesgo.limite_dia === 0) return { texto: language.t("trading.risk.off"), tono: "text-v2-text-text-faint" }

    return { texto: language.t("trading.risk.armed"), tono: "text-v2-state-fg-success" }
  }

  return (
    <div class="flex-1 min-h-0 flex flex-col gap-2 px-[var(--shell-inline-inset,8px)] pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]">
      <div ref={filaPaneles} data-slot="trading-panes" class="relative flex-1 min-h-0 flex flex-col md:flex-row gap-2">
        {/* The session's native screen wraps its row in a root wrapper that reaches the shell's
            bands (inline padding plus bottom/top insets) and rows its panes behind a single 8px
            gap. Trading mirrors both verbatim: on desktop that gap is the only seam between the
            dashboard's frame and the chat's face, and the resize handle floats its pill in the
            gap (class plus edge="start"), the way the session's handles float theirs with
            "-end-1" and "-start-1". */}
        <div ref={panelDashboard} data-slot="trading-panel" class="relative z-10 min-w-0 shrink-0 flex flex-col min-h-0 h-full flex-1 md:flex-none">
          {/* The dashboard's own raised frame, drawn the way the session panel draws its card;
              the header and scroller inside are the dashboard's alone. */}
          <SessionPanelFrame raised>
            <header
              class="flex shrink-0 items-center gap-3 border-b border-v2-border-border-muted ps-6 py-3"
              // The chat toggle sits at the row's top-right corner in every state: over the
              // chat's own sticky bar with the chat open on desktop (the header keeps normal
              // padding there), over this corner otherwise — stacked, the chat is a row
              // below this header, so the corner is always the dashboard's and reserves
              // the toggle's width in both of its states.
              classList={{
                "pe-[44px]": !props.abierto() || !escritorio(),
                "pe-6": props.abierto() && escritorio(),
              }}
            >
              <h1 class="min-w-0 flex-1 truncate text-[15px] text-v2-text-text-base font-medium" style={{ "line-height": "var(--line-height-base)" }}>
                {language.t(tradingSectionKey(sección()))}
              </h1>
              <Show when={!snapshot.demo}>
                <div class="flex min-w-0 items-center gap-3">
                  {/* Panic itself never needs TWS (the stop half is a local engine flag; the
                      close half reports its own verdict), so it stays clickable whenever the
                      engine answered once — the toast carries a failed half home (A-3). */}
                  <Button
                    type="button"
                    variant="danger"
                    size="small"
                    onClick={abrirPanico}
                    aria-label={language.t("trading.panic")}
                  >
                    {language.t("trading.panic")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="small"
                    disabled={enlazando()}
                    onClick={() => void (snapshot.enlace ? desenlazar() : enlazar())}
                    aria-label={language.t(snapshot.enlace ? "trading.engine.disconnect.aria" : "trading.engine.connect.aria")}
                  >
                    {language.t(snapshot.enlace ? "trading.engine.disconnect" : "trading.engine.connect")}
                  </Button>
                </div>
              </Show>
              <span
                class="flex h-7 min-w-0 items-center gap-1.5 rounded-[12px] border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-layer-01 ps-2.5 pe-2.5 text-[13px] text-v2-text-text-base shadow-[var(--v2-elevation-raised)]"
                style={LINEA}
              >
                <span class={`size-1.5 shrink-0 rounded-full ${puntoMotor()}`} aria-hidden="true" />
                <span class="min-w-0 truncate" title={etiquetaMotor()}>
                  {etiquetaMotor()}
                </span>
              </span>
            </header>
            <Show when={navStrip()}>
              <div class="flex shrink-0 items-center border-b border-v2-border-border-muted px-4 py-2">
                <TradingNavStrip />
              </div>
            </Show>

            {/* Plain wheel/drag scrolling: the shared bar would paint as a stray pill hugging the
                panel's edge — detached from the rows by their trailing cushion — and flash on and
                off while the window narrows, the way the app's own tab rail hides its scrollbar. */}
            <div data-scrollable class="min-h-0 flex-1 overflow-y-auto no-scrollbar">
              <Show
                // A lost engine answer with real values on screen: the sections below stand
                // still on the last values the engine sent, so the line says so — sample
                // data already says its own story in the pill.
                when={caducado() && !snapshot.demo}
              >
                <p
                  class="mx-4 mt-4 rounded-[8px] border border-v2-state-border-warning bg-v2-state-bg-warning px-3 py-2 text-[13px] text-v2-state-fg-warning"
                  style={LINEA}
                >
                  {language.t("trading.engine.stale")}
                </p>
              </Show>
              <Show when={sección() === "account"}>
                <div class="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 py-4">
                  <Show when={snapshot.enlace} fallback={<p class="px-1 text-[13px] text-v2-text-text-faint" style={LINEA}>{language.t("trading.account.offline")}</p>}>
                    <dl class="grid gap-x-10 md:grid-cols-2">
                      <MetaCuenta etiqueta={language.t("trading.account.id")} mono>
                        {snapshot.cuenta.id || "—"}
                      </MetaCuenta>
                      <MetaCuenta etiqueta={language.t("trading.account.type")}>{snapshot.cuenta.tipo || "—"}</MetaCuenta>
                      <MetaCuenta etiqueta={language.t("trading.account.netWorth")}>{formatoUSD(snapshot.cuenta.patrimonio)}</MetaCuenta>
                      <MetaCuenta etiqueta={language.t("trading.account.cash")}>{formatoUSD(snapshot.cuenta.efectivo)}</MetaCuenta>
                      <MetaCuenta etiqueta={language.t("trading.account.pnlToday")} tono={tonoPnl(snapshot.cuenta.pnl_dia)}>
                        {formatoUSD(snapshot.cuenta.pnl_dia)}
                      </MetaCuenta>
                      <MetaCuenta etiqueta={language.t("trading.account.pnlRealized")} tono={tonoPnl(snapshot.cuenta.pnl_realizado)}>
                        {formatoUSD(snapshot.cuenta.pnl_realizado)}
                      </MetaCuenta>
                    </dl>
                    <MiniCurva curva={snapshot.curva} />
                  </Show>
                  <dl class="border-t border-v2-border-border-muted pt-2">
                    <MetaCuenta etiqueta={language.t("trading.risk.limit")} tono={guardiaDia().tono}>
                      {guardiaDia().texto}
                    </MetaCuenta>
                  </dl>
                </div>
              </Show>

              <Show when={sección() === "systems"}>
                <div class="flex flex-col gap-2 px-4 py-4">
                  <div class="flex items-center justify-between gap-2">
                    <p class="px-1 text-[13px] text-v2-text-text-muted" style={LINEA}>
                      {language.plural("trading.bots.active", activos(), { total: snapshot.bots.length })}
                    </p>
                    <div class="flex items-center gap-1">
                      {/* The pool's gates: no writes on sample ids, while one write runs, or
                          with the engine stopped answering — read-only until it does again. */}
                      <Tooltip class="shrink-0" placement="bottom" value={language.t("trading.systems.startAll")}>
                        <IconButton
                          type="button"
                          variant="ghost-muted"
                          size="small"
                          disabled={activos() >= snapshot.bots.length || snapshot.demo || escrituras() || caducado()}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={abrirArrancarTodos}
                          aria-label={language.t("trading.systems.startAll")}
                          icon={<Icon name="play" />}
                        />
                      </Tooltip>
                      <Tooltip class="shrink-0" placement="bottom" value={language.t("trading.systems.stopAll")}>
                        <IconButton
                          type="button"
                          variant="ghost-muted"
                          size="small"
                          disabled={activos() === 0 || snapshot.demo || escrituras() || caducado()}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={abrirPararTodos}
                          aria-label={language.t("trading.systems.stopAll")}
                          icon={<Icon name="stop" />}
                        />
                      </Tooltip>
                    </div>
                  </div>
                  <ul class="flex flex-col">
                    <For each={snapshot.bots}>
                      {(bot) => {
                        // Running reads the flag-or-mirror union (see `activos`): a process
                        // outliving its stopped flag still reads Running here, with Stop.
                        const enMarcha = () => bot.activo || bot.enMarcha
                        const etiqueta = () => language.t(enMarcha() ? "trading.system.stop" : "trading.system.start")

                        return (
                          <li class="flex min-h-6 items-center gap-2">
                            <span
                              class={`size-1.5 shrink-0 rounded-full ${enMarcha() ? "bg-v2-state-fg-success" : "bg-v2-border-border-muted"}`}
                              aria-hidden="true"
                            />
                            <button
                              type="button"
                              class="min-w-0 flex-1 truncate text-start text-[13px] text-v2-text-text-base hover:text-v2-text-text-muted"
                              onClick={() => abrirFicha(bot)}
                            >
                              {bot.nombre}
                            </button>
                            <span class={`min-w-0 truncate text-[11px] text-v2-text-text-faint ${bot.pid !== null ? "font-mono" : ""}`} style={LINEA}>
                              {bot.pid !== null ? `PID ${bot.pid} · ` : ""}
                              {bot.simbolo} · {bot.temporalidad}
                            </span>
                            <span class={`w-[72px] shrink-0 text-end ${NÚMERO} ${tonoPnl(bot.pnl_dia)}`}>{formatoUSD(bot.pnl_dia)}</span>
                            <Tooltip class="shrink-0" placement="bottom" value={etiqueta()}>
                              <IconButton
                                type="button"
                                variant="ghost-muted"
                                size="small"
                                // The pool's gates (see the toolbar): a demo row flips nothing.
                                disabled={snapshot.demo || escrituras() || caducado()}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => fijarSistema(bot)}
                                aria-label={etiqueta()}
                                aria-pressed={enMarcha()}
                                icon={<Icon name={enMarcha() ? "stop" : "play"} />}
                              />
                            </Tooltip>
                          </li>
                        )
                      }}
                    </For>
                  </ul>
                </div>
              </Show>

              <Show when={sección() === "positions"}>
                <div class="flex flex-col gap-2 px-4 py-4">
                  <div class="flex items-center justify-end gap-2">
                    <Switch
                      appearance="compact"
                      checked={cierrePermitido()}
                      onChange={fijarCierreManual}
                    >
                      {language.t("trading.positions.closing")}
                    </Switch>
                    <Show when={cierrePermitido()}>
                      <Tooltip class="shrink-0" placement="bottom" value={language.t("trading.positions.closeAll")}>
                        <IconButton
                          type="button"
                          variant="ghost-muted"
                          size="small"
                          // Orders go through the engine's TWS socket: no write without it, and
                          // not until the engine answers again (the stale read above).
                          disabled={snapshot.posiciones.length === 0 || !snapshot.enlace || caducado()}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={abrirCierreTotal}
                          aria-label={language.t("trading.positions.closeAll")}
                          icon={<Icon name="close" />}
                        />
                      </Tooltip>
                    </Show>
                  </div>
                  <Show when={snapshot.posiciones.length > 0} fallback={<p class="px-1 text-[13px] text-v2-text-text-faint">{language.t("trading.positions.empty")}</p>}>
                    <div class="flex flex-col">
                      <For each={snapshot.posiciones}>
                        {(posición) => (
                          <div class="flex min-h-6 items-center gap-2">
                            <span class={`w-20 shrink-0 font-mono text-[13px] text-v2-text-text-base`}>{posición.simbolo}</span>
                            <span
                              class={`w-10 shrink-0 text-[11px] ${posición.lado === "corto" ? "text-v2-state-fg-danger" : "text-v2-state-fg-success"}`}
                              style={LINEA}
                            >
                              {language.t(posición.lado === "corto" ? "trading.position.side.short" : "trading.position.side.long")}
                            </span>
                            <span class={`min-w-0 truncate text-[13px] text-v2-text-text-muted ${NÚMERO}`} style={LINEA}>
                              {posición.tamano} @ {formatoUSD(posición.entrada)}
                              {posición.actual === null ? "" : ` → ${formatoUSD(posición.actual)}`}
                            </span>
                            <span class="min-w-0 flex-1" />
                            <span class={`shrink-0 ${NÚMERO} ${tonoPnl(posición.pnl)}`}>{formatoUSD(posición.pnl)}</span>
                            <span class={`w-16 shrink-0 text-end text-[11px] tabular-nums ${tonoPnl(posición.pnl_pct)}`} style={LINEA}>
                              {formatoPct(posición.pnl_pct)}
                            </span>
                            <Show when={cierrePermitido()}>
                              <Tooltip class="shrink-0" placement="bottom" value={language.t("trading.position.close")}>
                                <IconButton
                                  type="button"
                                  variant="ghost-muted"
                                  size="small"
                                  // Orders need the engine's TWS socket (see close-all).
                                  disabled={!snapshot.enlace || caducado()}
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => abrirCierre(posición)}
                                  aria-label={language.t("trading.position.close")}
                                  icon={<Icon name="close" />}
                                />
                              </Tooltip>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </Show>

              <Show when={sección() === "log"}>
                <div class="flex flex-col gap-2 px-4 py-4">
                  <div class="flex items-center justify-end">
                    <MenuDescarga entradas={registroUnido} />
                  </div>
                  <Show when={registroUnido().length > 0} fallback={<p class="px-1 text-[13px] text-v2-text-text-faint">{language.t("trading.log.empty")}</p>}>
                    <ListaRegistro registros={registroUnido()} />
                  </Show>
                </div>
              </Show>

              <Show when={sección() === "tasks"}>
                <div class="flex flex-col gap-2 px-4 py-4">
                  <SecciónTareas tareas={snapshot.tareas} bots={snapshot.bots} bloquear={snapshot.demo || caducado()} cancelar={cancelarPrograma} />
                </div>
              </Show>
            </div>
          </SessionPanelFrame>
        </div>

        <Show when={chatVisto()}>
          {/* The chat's header is the session's native sticky title bar, emptied to the same
              bare row the side panel's tabs bar shows: trading.css keeps the bar (opaque bg,
              fade, and the corner spacer for the floating buttons) and hides only its inner
              content — project location, title/menu, cost chip and header icon. The pane
              travels on the app's shared panel motion: the presence stays mounted through
              every flight while the dashboard's painted width carries it, then parks at the
              row's end with its contents skipped, and the content box holds its landing width
              so the chat never rewraps mid-flight (the session side panel's own trick). */}
          <div
            ref={chatPresencia}
            inert={(!chatMotion.present() && escritorio()) || undefined}
            class={
              escritorio() && !chatMotion.present()
                ? // Out of the row, so a closed panel takes no space.
                  "absolute inset-y-0 end-0 w-0 [content-visibility:hidden]"
                : "relative min-h-0 min-w-0 flex-1 flex flex-col"
            }
          >
            <div
              ref={chatContenido}
              data-slot="trading-chat-panel-content"
              class="absolute inset-y-0 start-0 size-full [contain:layout_style] will-change-[opacity]"
              style={{ "--trading-side-content-width": chatAnchoContenido() }}
            >
              {/* The chat's face: the same frame the native side panels draw — base bg, radius
                  and raised shadow — and like them it fills its presence and clips: the held
                  contents pinned at their landing width overflow past the row mid-flight and
                  the face cuts them off, so the shell's band beside the row stays clear while
                  the chat travels. The shell's bands live on the trading root wrapper in both
                  layouts, so trading.css zeroes the shell inset variables the chat's screen
                  reads its padding from — that second round would otherwise stack inside the
                  face (1px stacked, 8px desktop). */}
              <div
                data-slot="trading-chat-face"
                class="absolute top-0 bottom-0 start-0 end-0 flex overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
              >
                <div
                  data-slot="trading-chat-panel"
                  id="trading-chat-panel"
                  class="relative h-full min-w-0 flex shrink-0 contain-strict flex-col"
                  style={{ width: "var(--panel-hold-width, var(--trading-side-content-width, 100%))" }}
                >
                  {/* Informational welcome, centered in the timeline's free space (between the emptied
                      native row and the composer zone). It shows only while the chat is empty — TradingWithSession
                      polls and hides it after the first prompt — and is pointer-events-none. */}
                  <Show when={props.sinMensajes()}>
                    <div
                      data-slot="trading-chat-welcome"
                      class="pointer-events-none absolute inset-x-0 top-[48px] bottom-[112px] z-20 flex items-center justify-center"
                    >
                      <p class="px-6 text-center text-[13px] leading-5 text-v2-text-text-faint">{language.t("trading.chat.welcome")}</p>
                    </div>
                  </Show>
                  {props.chat}
                </div>
              </div>
            </div>
            {/* The resize handle rides outside the face — the face clips, and the session's
                own handle lives on its carrier outside the raised frame for the same
                reason. Desktop only: on the stacked layout the pane is full width with
                nothing to resize. */}
            <div classList={{ hidden: !escritorio() }} data-slot="trading-chat-resizer">
              <ResizeHandle
                class="-start-1"
                direction="horizontal"
                edge="start"
                size={chatAnchoManija()}
                min={SESSION_PANEL_WIDTH_MIN}
                max={chatWidthMax()}
                onResize={(anchura) => props.fijarAnchura(anchura)}
              />
            </div>
          </div>
        </Show>

        {/* Toggle at the row's top-right corner, always in the same pixels: over the chat when
            it is open, over the reserved dashboard-header slot when it is closed. The prompt
            editor is a chat control, so it stays with the open chat (and never covers the
            dashboard's engine pill). With the chat open the session's native sticky title bar
            (message-timeline, not hidden here) hosts the corner: these buttons land on it the
            same way the app's own review toggle does over regular sessions. */}
        <div class="absolute end-3 top-0 z-30 h-12 flex items-center gap-1" data-slot="trading-chat-toggle">
          <Show when={props.abierto()}>
            <Tooltip placement="bottom" value={language.t("trading.prompt.edit")}>
              <IconButton
                type="button"
                variant="ghost-muted"
                size="large"
                onMouseDown={(event) => event.preventDefault()}
                onClick={abrirPrompto}
                aria-label={language.t("trading.prompt.edit")}
                aria-haspopup="dialog"
                icon={<Icon name="edit" />}
              />
            </Tooltip>
          </Show>
          {botónChat()}
        </div>
      </div>
    </div>
  )
}

/** The tasks pane's list: one row per scheduled task with its status chip, its start/stop
 * action and scope (pool names, "All systems" when the task targets the whole pool), its
 * local run time and a withdrawal button while the engine still holds it pending. */
const CLASE_TAREA: Record<TareaInfo["estado"], string> = {
  pendiente: "text-v2-state-fg-warning",
  ejecutada: "text-v2-state-fg-success",
  no_ejecutada: "text-v2-text-text-faint",
  cancelada: "text-v2-text-text-faint",
}

const CLAVE_TAREA: Record<TareaInfo["estado"], string> = {
  pendiente: "trading.task.pending",
  ejecutada: "trading.task.ran",
  no_ejecutada: "trading.task.missed",
  cancelada: "trading.task.cancelled",
}

function SecciónTareas(props: { tareas: TareaInfo[]; bots: BotInfo[]; bloquear?: boolean; cancelar: (taskID: string) => void }) {
  const { formatoMomento, títuloMomento } = useFormatos()
  const language = useLanguage()
  // The row's withdrawal is a write like the closes, so it takes the same two beats: the
  // first press arms the row (the label asks again, in warning tones), the second actually
  // withdraws it — and after three idle seconds the row disarms, so one stray click never
  // eats a schedule silently.
  const [armado, fijarArmado] = createSignal<string | null>(null)
  let desarme: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => clearTimeout(desarme))

  const pedirCancelar = (taskID: string) => {
    if (armado() !== taskID) {
      fijarArmado(taskID)
      clearTimeout(desarme)
      desarme = setTimeout(() => fijarArmado(null), 3_000)
      return
    }

    fijarArmado(null)
    props.cancelar(taskID)
  }

  const alcance = (tarea: TareaInfo) =>
    tarea.sistemas.length === 0
      ? language.t("trading.tasks.all")
      : tarea.sistemas.map((id) => props.bots.find((bot) => bot.id === id)?.nombre ?? id).join(", ")

  return (
    <Show
      when={props.tareas.length > 0}
      fallback={<p class="px-1 text-[13px] text-v2-text-text-faint" style={LINEA}>{language.t("trading.tasks.empty")}</p>}
    >
      <div class="flex flex-col">
        <For each={props.tareas}>
          {(tarea) => (
            <div class="flex min-h-6 items-center gap-2">
              <span class={`w-20 shrink-0 text-[11px] uppercase tracking-[0.04em] ${CLASE_TAREA[tarea.estado]}`} style={LINEA}>
                {language.t(CLAVE_TAREA[tarea.estado])}
              </span>
              <Tooltip class="shrink-0" placement="bottom" value={language.t(tarea.accion === "arrancar" ? "trading.task.start" : "trading.task.stop")}>
                <Icon name={tarea.accion === "arrancar" ? "play" : "stop"} size="small" class="shrink-0 text-v2-text-text-faint" />
              </Tooltip>
              <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-base" style={LINEA}>
                {language.t(tarea.accion === "arrancar" ? "trading.task.start" : "trading.task.stop")} · {alcance(tarea)}
              </span>
              <time class="shrink-0 text-[11px] text-v2-text-text-faint tabular-nums" style={LINEA} title={títuloMomento(tarea.hora)}>
                {formatoMomento(tarea.hora)}
              </time>
              <Show when={tarea.estado === "pendiente"}>
                <Tooltip class="shrink-0" placement="bottom" value={language.t(armado() === tarea.id ? "trading.task.confirm" : "trading.task.cancel")}>
                  <IconButton
                    type="button"
                    variant="ghost-muted"
                    size="small"
                    // Armed, the row asks again in warning tones; blocked, the write's gates
                    // (sample ids, the engine not answering) hold it.
                    class={armado() === tarea.id ? "shrink-0 text-v2-state-fg-warning" : "shrink-0"}
                    disabled={props.bloquear}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pedirCancelar(tarea.id)}
                    aria-label={language.t(armado() === tarea.id ? "trading.task.confirm" : "trading.task.cancel")}
                    icon={<Icon name={armado() === tarea.id ? "circle-exclamation" : "circle-xmark"} />}
                  />
                </Tooltip>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}

/**
 * The close confirmation, shared by the single close and the emergency close-all: it states
 * that the cycle sends real orders and, when a running system trades the same contract
 * family, warns that it may reopen a position. Nothing is written until the confirm button —
 * the engine's close cycle only runs behind this dialog.
 */
function DialogCierre(props: {
  avisa: boolean
  /** Danger (stop/close semantics) by default; a benign wide action reads as primary. */
  tono?: "danger" | "submit"
  confirmar: () => Promise<void>
  título: string
  cuerpo: string
  advertencia: string
  confirmarTexto: string
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const [ejecutando, setEjecutando] = createSignal(false)

  // The parent's run shows its own success/failure toast and resolves either way, so closing
  // behind it is always right. While the write runs its two dismiss paths step aside: the
  // corner button leaves the header and the confirm button loses its click.
  const confirmar = async () => {
    if (ejecutando()) return

    setEjecutando(true)
    await props.confirmar()
    dialog.close()
  }

  return (
    // A confirmation's body is one paragraph (plus its warning line): the normal dialog
    // size — a 640px-wide editor crate would underline a close order.
    <Dialog preventBackdropDismiss>
      <DialogHeader hideClose={ejecutando()}>
        <DialogTitleGroup title={props.título} description={props.cuerpo} />
      </DialogHeader>
      <DialogBody class="px-4 pb-2 -mt-2">
        <Show when={props.avisa}>
          <p class="flex items-start gap-2 text-[13px] text-v2-state-fg-warning" style={LINEA}>
            <Icon name="circle-exclamation" class="mt-0.5 size-3.5 shrink-0" />
            {props.advertencia}
          </p>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost-muted" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button type="button" variant={props.tono ?? "danger"} disabled={ejecutando()} onClick={confirmar}>
          {props.confirmarTexto}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * The system's dossier: its live engine flags and the tail of its own record, the same rows
 * the record card draws filtered to this one system, live-updating with the dashboard's 3s poll.
 */
function DialogFicha(props: {
  bot: Accessor<BotInfo | undefined>
  registros: Accessor<EntradaRegistro[]>
  programar: (entrada: { kind: "start-systems" | "stop-systems"; delayMinutes?: number; atTime?: string }) => Promise<unknown>
}) {
  const { formatoUSD, formatoMomento } = useFormatos()
  const language = useLanguage()
  const dialog = useDialog()

  // Each field reads the snapshot store once and decides its fallback itself, so the JSX
  // never needs narrowing across separate accessor calls and keeps updating with each poll.
  // The dossier keeps the last row it opened on: a poll that finds the system removed (it
  // left the engine's pool mid-dialog) must not blank the title and flip the state row to
  // Stopped — it stays on the last known identity, with the missing fields reading "—".
  const vista = createMemo<BotInfo | undefined>((anterior) => props.bot() ?? anterior, undefined)
  const pidFicha = () => {
    const valor = vista()?.pid
    return valor === null || valor === undefined ? "—" : `PID ${valor}`
  }
  const arranqueFicha = () => {
    // Day-aware (today reads a bare clock, older days carry their date — see formatoMomento).
    const valor = vista()?.arrancada
    return valor === null || valor === undefined ? "—" : formatoMomento(valor)
  }
  const enMarchaFicha = () => vista()?.enMarcha === true || vista()?.activo === true
  const pnlFicha = () => vista()?.pnl_dia ?? null
  const instrumentoFicha = () => {
    const valor = vista()
    return valor === undefined ? "—" : `${valor.simbolo} · ${valor.temporalidad}`
  }

  return (
    <Dialog size="large" preventBackdropDismiss>
      <DialogHeader>
        <DialogTitleGroup title={vista()?.nombre ?? ""} description={language.t("trading.ficha.description")} />
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-1">
        <dl class="grid gap-x-8 md:grid-cols-2 px-1">
          <MetaCuenta etiqueta={language.t("trading.ficha.state")}>
            <span
              class={`me-1.5 inline-block size-1.5 rounded-full ${enMarchaFicha() ? "bg-v2-state-fg-success" : "bg-v2-border-border-muted"}`}
              aria-hidden="true"
            />
            {language.t(enMarchaFicha() ? "trading.ficha.state.running" : "trading.ficha.state.stopped")}
          </MetaCuenta>
          <MetaCuenta etiqueta={language.t("trading.ficha.process")} mono>
            {pidFicha()}
          </MetaCuenta>
          <MetaCuenta etiqueta={language.t("trading.ficha.started")} mono>
            {arranqueFicha()}
          </MetaCuenta>
          <MetaCuenta etiqueta={language.t("trading.ficha.instrument")}>
            {instrumentoFicha()}
          </MetaCuenta>
          <MetaCuenta etiqueta={language.t("trading.account.pnlToday")} tono={tonoPnl(pnlFicha())}>
            {formatoUSD(pnlFicha())}
          </MetaCuenta>
        </dl>
              <section class="flex min-h-0 flex-1 flex-col rounded-[8px] border border-v2-border-border-muted bg-v2-background-bg-deep p-3">
                <h3 class="mb-2 px-1 text-[11px] tracking-[0.08em] text-v2-text-text-faint uppercase" style={LINEA}>
                  {language.t("trading.ficha.record")}
                </h3>
                {/* Same as the panel: wheel/drag scrolling, no stray bar inside the card. */}
                <div data-scrollable class="min-h-0 flex-1 overflow-y-auto no-scrollbar">
                  <Show
                    when={props.registros().length > 0}
                    fallback={<p class="px-1 text-[13px] text-v2-text-text-faint" style={LINEA}>{language.t("trading.ficha.record.empty")}</p>}
                  >
                    <ListaRegistro registros={props.registros()} />
                  </Show>
                </div>
              </section>
              <ProgramaTarea programar={props.programar} />
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

// The styled native selects the scheduling row uses: no Select primitive exists in the app,
// and a native one keeps keyboard and accessibility behavior for free.
const SELECT = "h-7 shrink-0 rounded-[8px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-2 text-[13px] text-v2-text-text-base leading-[16px] outline-none"

/**
 * The dossier's scheduling row: one system's fixed scope, so only the action (start or stop)
 * and the moment are picked — whole minutes from now or the next HH:MM on the PC's clock.
 * Validation mirrors the engine's; an invalid value keeps Program disabled instead of
 * reaching the engine and vanishing there.
 */
function ProgramaTarea(props: {
  programar: (entrada: { kind: "start-systems" | "stop-systems"; delayMinutes?: number; atTime?: string }) => Promise<unknown>
}) {
  const language = useLanguage()
  const [enviando, fijarEnviando] = createSignal(false)
  const [formulario, fijarFormulario] = createStore({
    accion: "arrancar" as "arrancar" | "parar",
    modo: "minutos" as "minutos" | "hora",
    valor: "30",
  })

  const válido = () => {
    const texto = formulario.valor.trim()

    if (formulario.modo === "minutos") {
      // Whole positive minutes only, capped at one day out: the interval every plumbing
      // round or alike schedules by, and a stray 999999 could not hand the engine's clock
      // math an Infinity.
      return /^\d+$/.test(texto) && Number(texto) >= 1 && Number(texto) <= 1_440
    }

    return /^([01]?\d|2[0-3]):[0-5]\d$/.test(texto)
  }

  const enviar = async () => {
    if (enviando()) return

    fijarEnviando(true)
    // The parent reports its own success/failure toast and resolves either way — but if it
    // ever rejects, the send button still comes back (try: the write; finally: the button).
    try {
      await props.programar({
        kind: formulario.accion === "arrancar" ? "start-systems" : "stop-systems",
        delayMinutes: formulario.modo === "minutos" ? Number(formulario.valor.trim()) : undefined,
        atTime: formulario.modo === "hora" ? formulario.valor.trim() : undefined,
      })
    } finally {
      fijarEnviando(false)
    }
  }

  return (
    <div class="flex flex-wrap items-center gap-2 border-t border-v2-border-border-muted px-1 py-2">
      <select
        class={SELECT}
        aria-label={language.t("trading.tasks.new.action")}
        value={formulario.accion}
        onChange={(event) => fijarFormulario("accion", event.currentTarget.value as typeof formulario.accion)}
      >
        <option value="arrancar">{language.t("trading.task.start")}</option>
        <option value="parar">{language.t("trading.task.stop")}</option>
      </select>
      <select
        class={SELECT}
        aria-label={language.t("trading.tasks.new.when")}
        value={formulario.modo}
        onChange={(event) => fijarFormulario("modo", event.currentTarget.value as typeof formulario.modo)}
      >
        <option value="minutos">{language.t("trading.tasks.new.mode.minutes")}</option>
        <option value="hora">{language.t("trading.tasks.new.mode.time")}</option>
      </select>
      <TextInput
        class="w-24"
        appearance="small"
        value={formulario.valor}
        numeric={formulario.modo === "minutos"}
        aria-label={language.t("trading.tasks.new.value")}
        placeholder={formulario.modo === "minutos" ? "30" : "10:30"}
        onInput={(event) => fijarFormulario("valor", event.currentTarget.value)}
      />
      <Button type="button" variant="outline" size="small" disabled={enviando() || !válido()} onClick={() => void enviar()}>
        {language.t("trading.tasks.new.program")}
      </Button>
    </div>
  )
}

/**
 * The chat's system prompt editor: a controlled textarea over the stored prompt. "Restore"
 * only fills the textarea with the default desk context, so the change still needs "Save",
 * and nothing is written until then; Cancel discards every edit. The saved prompt survives
 * app restarts (server-global store) and each boot's adoption re-puts it into the chat.
 */
function DialogPrompto(props: { contenido: string; guardar: (valor: string) => Promise<boolean> }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [borrador, setBorrador] = createSignal(props.contenido)
  const [guardando, setGuardando] = createSignal(false)

  // The save's verdict comes back: a saved prompt closes the editor; a failed one stays
  // open with its error toast, so the text never leaves the screen on a failure.
  const guardar = async () => {
    if (guardando()) return

    setGuardando(true)
    const guardado = await props.guardar(borrador())
    setGuardando(false)

    if (guardado) dialog.close()
  }

  return (
    <Dialog size="large" preventBackdropDismiss>
      <DialogHeader>
        <DialogTitleGroup title={language.t("trading.prompt.title")} description={language.t("trading.prompt.description")} />
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-1 px-4 pt-1">
        <Textarea
          value={borrador()}
          rows={14}
          aria-label={language.t("trading.prompt.title")}
          class="!w-full !h-full [&_[data-slot=textarea-v2-textarea]]:h-full [&_[data-slot=textarea-v2-textarea]]:font-mono"
          spellcheck={false}
          onInput={(event) => setBorrador(event.currentTarget.value)}
        />
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost-muted" onClick={() => setBorrador(TRADING_DESK_CONTEXT)}>
          {language.t("trading.prompt.restore")}
        </Button>
        <Button type="button" variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button type="button" variant="submit" disabled={guardando() || borrador() === props.contenido} onClick={guardar}>
          {language.t("common.save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** One unified record row: a log line, or a closed trade carrying the gross P/L the trade
 * record kept. Log rows and trades share this shape so the record card and each system's
 * dossier render one list without per-source special cases. */
interface EntradaRegistro {
  readonly ts: number
  readonly nivel: RegistroInfo["nivel"]
  readonly bot: string
  readonly mensaje: string
  readonly evento: RegistroInfo["evento"]
  /** Gross USD for close rows; null elsewhere. */
  readonly pnl: number | null
}

/** Merges the log ring and the trade record into one chronological list. Every close is
 * already a log line (`event: "close"`), so the trades replace those rows — carrying the
 * P/L the log lacks — and the log's own close rows drop out, keeping no duplicates. The
 * replacement only exists when the trades arrived (an engine predating the trade record
 * sends none): then the log's close rows are the record of the closes and stay. */
function reunirRegistro(registros: RegistroInfo[], trades: TradeInfo[]): EntradaRegistro[] {
  const cambiaCierres = trades.length > 0
  const lineas: EntradaRegistro[] = registros
    .filter((registro) => !(cambiaCierres && registro.evento === "cierre"))
    .map((registro) => ({ ts: registro.ts, nivel: registro.nivel, bot: registro.bot, mensaje: registro.mensaje, evento: registro.evento, pnl: null }))
  const cierres: EntradaRegistro[] = trades.map((trade) => ({
    ts: trade.hora,
    nivel: "info",
    bot: trade.bot,
    mensaje: trade.mensaje,
    evento: "cierre",
    pnl: trade.pnl,
  }))
  return [...lineas, ...cierres].sort((a, b) => a.ts - b.ts)
}

/** Downloads the picked window's entries as a CSV file, with the BOM so Excel opens the
 * accented messages right and CR/LF rows Excel's reader expects. Both the header row and
 * the level tokens arrive translated (the engine's stored tokens are Spanish and never
 * leak to the user). The anchor-click pattern works in both the renderer and the web; the
 * object URL outlives the click so the download never races its own revocation. */
function descargarRegistro(entradas: EntradaRegistro[], archivo: { etiqueta: string; cabeceras: string; nivel: (valor: RegistroInfo["nivel"]) => string }) {
  const celda = (valor: string) => `"${valor.replaceAll('"', '""').replaceAll("\n", " ")}"`
  const filas = [
    archivo.cabeceras,
    ...entradas.map((entrada) =>
      [
        // A non-finite timestamp (the engine's no-value) would throw a RangeError on
        // toISOString; it leaves the cell empty instead of aborting the whole export.
        Number.isFinite(entrada.ts) ? new Date(entrada.ts).toISOString() : "",
        archivo.nivel(entrada.nivel),
        entrada.bot,
        entrada.evento ?? "",
        entrada.mensaje,
        entrada.pnl === null ? "" : entrada.pnl.toFixed(2),
      ]
        .map(celda)
        .join(","),
    ),
  ].join("\r\n")
  const href = URL.createObjectURL(new Blob(["\ufeff", filas], { type: "text/csv;charset=utf-8" }))
  const enlace = document.createElement("a")
  enlace.href = href
  enlace.download = `trading-record-${archivo.etiqueta}.csv`
  enlace.click()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
}

/** The record card's download button with its three time windows (today, this week, this
 * month — all local calendar boundaries). A fixed transparent layer closes the tiny menu
 * on any outside click, the same trade-off every popover makes without a ports layer. */
function MenuDescarga(props: { entradas: Accessor<EntradaRegistro[]> }) {
  const language = useLanguage()
  const [abierto, fijarAbierto] = createSignal(false)

  const bajar = (desde: number, etiqueta: string) => {
    fijarAbierto(false)
    descargarRegistro(props.entradas().filter((entrada) => entrada.ts >= desde), {
      etiqueta,
      cabeceras: language.t("trading.log.csv.headers"),
      nivel: (valor) => language.t(CLAVE_NIVEL[valor]),
    })
  }
  // Evaluated when the user picks: today's midnight, this Monday and this month's 1st.
  const pedir = () => {
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    // The filename stamp is the machine's local calendar day (an ISO slice was UTC and
    // named the windows a day off through the western hours of the local day).
    const día = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`
    const semana = new Date(hoy)
    semana.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7))
    const mes = new Date(hoy)
    mes.setDate(1)
    return [
      { clave: "today" as const, desde: hoy.getTime(), etiqueta: día },
      { clave: "week" as const, desde: semana.getTime(), etiqueta: `${día}-week` },
      { clave: "month" as const, desde: mes.getTime(), etiqueta: `${día}-month` },
    ]
  }

  return (
    <div class="relative">
      <IconButton
        type="button"
        variant="ghost-muted"
        size="small"
        class="shrink-0"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => fijarAbierto(!abierto())}
        aria-label={language.t("trading.log.download.title")}
        aria-expanded={abierto()}
        icon={<Icon name="download" />}
      />
      <Show when={abierto()}>
        <div class="fixed inset-0 z-40" onClick={() => fijarAbierto(false)} aria-hidden="true" />
        <menu
          role="menu"
          class="absolute end-0 top-full z-50 mt-1 flex w-max flex-col whitespace-nowrap rounded-[8px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-1"
          onKeyDown={(evento) => evento.key === "Escape" && fijarAbierto(false)}
        >
          <For each={pedir()}>
            {(opción) => (
              <button
                type="button"
                role="menuitem"
                class="rounded-[6px] px-2 py-1 text-start text-[13px] text-v2-text-text-base hover:bg-v2-background-bg-layer-02"
                style={LINEA}
                onClick={() => bajar(opción.desde, opción.etiqueta)}
              >
                {language.t(`trading.log.download.${opción.clave}`)}
              </button>
            )}
          </For>
        </menu>
      </Show>
    </div>
  )
}

/** One record row class the filter can show alone: the lifecycle beats (open, close,
 * first signal) and the loud levels (warning, error). "todos" shows the whole record. */
type FiltroRegistro = "todos" | "apertura" | "cierre" | "senal" | "aviso" | "error"

const CLASE_FILTRO: Array<Exclude<FiltroRegistro, "todos">> = ["apertura", "cierre", "senal", "aviso", "error"]

// The filter value doubles as the match key: the first three are event beats, the last two
// are log levels, so one comparison pair classifies every row.
function enFiltro(entrada: EntradaRegistro, filtro: Exclude<FiltroRegistro, "todos">) {
  return entrada.evento === filtro || entrada.nivel === filtro
}

/**
 * The record card's one list, shared with each system's dossier: a fixed system column makes the
 * beginner of every entry readable at a glance, the lifecycle beats (an event chip, a warning
 * or an error) always show, and every other line hides behind "Show the rest". The filter chips
 * list only the classes with rows; a chosen class shows all of its rows (no hiding), and the
 * order never changes.
 */
function ListaRegistro(props: { registros: EntradaRegistro[] }) {
  const { formatoUSD, formatoMomento, títuloMomento } = useFormatos()
  const language = useLanguage()
  const [extendido, fijarExtendido] = createSignal(false)
  const [filtro, fijarFiltro] = createSignal<FiltroRegistro>("todos")

  const conCoincidencia = () => CLASE_FILTRO.filter((clase) => props.registros.some((entrada) => enFiltro(entrada, clase)))
  // The bar shows every class with rows, plus the chosen one even when its rows have gone
  // (a poll can empty it): a stuck chip with no escape would strand the reader — the bar
  // stays until they pick All (hence the All chip) or another class.
  const clases = () => {
    const elegido = filtro()
    if (elegido === "todos") return conCoincidencia()
    return [elegido, ...conCoincidencia().filter((clase) => clase !== elegido)]
  }
  const principales = () => props.registros.filter((entrada) => entrada.evento !== null || entrada.nivel !== "info")
  const resto = () => props.registros.filter((entrada) => entrada.evento === null && entrada.nivel === "info")
  const visibles = () => {
    const elegido = filtro()
    if (elegido === "todos") return extendido() ? props.registros : principales()
    return props.registros.filter((entrada) => enFiltro(entrada, elegido))
  }

  return (
    <>
      <Show when={clases().length > 0}>
        <div class="mb-1.5 flex flex-wrap gap-1">
          <button
            type="button"
            class={`h-5 shrink-0 rounded-full border px-2 text-[11px] leading-[18px] text-v2-text-text-base ${
              filtro() === "todos"
                ? "border-v2-border-border-muted bg-v2-background-bg-layer-02"
                : "border-transparent hover:text-v2-text-text-muted text-v2-text-text-faint"
            }`}
            onClick={() => fijarFiltro("todos")}
            aria-pressed={filtro() === "todos"}
          >
            {language.t("trading.log.filter.all")}
          </button>
          <For each={clases()}>
            {(clase) => (
              <button
                type="button"
                class={`h-5 shrink-0 rounded-full border px-2 text-[11px] leading-[18px] text-v2-text-text-base ${
                  filtro() === clase
                    ? "border-v2-border-border-muted bg-v2-background-bg-layer-02"
                    : "border-transparent hover:text-v2-text-text-muted text-v2-text-text-faint"
                }`}
                onClick={() => fijarFiltro(clase)}
                aria-pressed={filtro() === clase}
              >
                {language.t(`trading.log.filter.${clase}`)}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="flex flex-col">
        <Show
          when={visibles().length > 0}
          fallback={
            filtro() === "todos" ? null : (
              <p class="px-1 text-[13px] text-v2-text-text-faint" style={LINEA}>
                {language.t("trading.log.filter.empty")}
              </p>
            )
          }
        >
          <For each={visibles()}>
            {(entrada) => (
              <div class="flex min-h-6 items-center gap-2">
                <time
                  class="w-[70px] shrink-0 text-[11px] text-v2-text-text-faint tabular-nums"
                  style={LINEA}
                  title={títuloMomento(entrada.ts)}
                >
                  {formatoMomento(entrada.ts)}
                </time>
                <span class="flex w-[72px] shrink-0 justify-start">
                  <Show
                    when={entrada.evento}
                    keyed
                    fallback={
                      <span class={`text-[11px] uppercase tracking-[0.04em] ${tonoNivel(entrada.nivel)}`} style={LINEA}>
                        {entrada.nivel === "info" ? "" : entrada.nivel}
                      </span>
                    }
                  >
                    {(evento) => (
                      <span class={`inline-block rounded-full border px-1.5 text-[10px] font-medium tracking-[0.04em] uppercase leading-[14px] ${CLASE_EVENTO[evento]}`}>
                        {language.t(CLAVE_EVENTO[evento])}
                      </span>
                    )}
                  </Show>
                </span>
                <span class="w-48 shrink-0 truncate font-mono text-[12px] text-v2-text-text-base" title={entrada.bot}>
                  {entrada.bot}
                </span>
                <span class="min-w-0 flex-1 truncate text-[13px] text-v2-text-text-muted" style={LINEA}>
                  {entrada.mensaje}
                </span>
                <Show when={entrada.evento === "cierre"}>
                  <span class={`w-[64px] shrink-0 text-end ${NÚMERO} ${tonoPnl(entrada.pnl)}`}>{formatoUSD(entrada.pnl)}</span>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
      <Show when={filtro() === "todos" && resto().length > 0}>
        <button
          type="button"
          class="mt-1 px-1 text-[11px] text-v2-text-text-faint hover:text-v2-text-text-muted"
          style={LINEA}
          onClick={() => fijarExtendido(!extendido())}
        >
          {extendido() ? language.t("trading.log.less") : language.plural("trading.log.more", resto().length)}
        </button>
      </Show>
    </>
  )
}

/**
 * The account card's equity sparkline: the day P/L series the engine samples every 15 s,
 * stroked by the newest sample's sign. Fewer than two numeric samples draw nothing — a
 * curve of one point says nothing the P/L number next to it doesn't already say.
 */
function MiniCurva(props: { curva: CurvaInfo[] }) {
  const language = useLanguage()
  // flatMap keeps the numbers' type without a cast: null samples just drop out of the path.
  const puntos = createMemo(() => {
    const serie = props.curva.flatMap((punto) => (punto.pnl_dia === null ? [] : [punto.pnl_dia]))

    if (serie.length < 2) return null

    const mínimo = Math.min(...serie)
    const rango = Math.max(...serie) - mínimo || 1
    // 2px margins inside the 100×24 viewBox for the stroke; the x spacing is even regardless
    // of uneven sample gaps, which keeps the line readable at 1000 points.
    return {
      último: serie[serie.length - 1],
      path: serie
        .map((valor, i) => `${((i * 100) / (serie.length - 1)).toFixed(2)},${(22 - ((valor - mínimo) / rango) * 20).toFixed(2)}`)
        .join(" "),
    }
  })

  return (
    <Show when={puntos()} keyed>
      {(vista) => (
        <div class="px-1 pt-2">
          <p class="mb-1 text-[11px] text-v2-text-text-faint" style={LINEA}>
            {language.t("trading.account.curve")}
          </p>
          <svg viewBox="0 0 100 24" preserveAspectRatio="none" class="h-8 w-full" role="img" aria-label={language.t("trading.account.curve.aria")}>
            <polyline
              fill="none"
              stroke={vista.último >= 0 ? "var(--v2-state-fg-success)" : "var(--v2-state-fg-danger)"}
              stroke-width="1"
              vector-effect="non-scaling-stroke"
              points={vista.path}
            />
          </svg>
        </div>
      )}
    </Show>
  )
}

