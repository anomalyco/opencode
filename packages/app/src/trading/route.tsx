// The trading dashboard: a fullscreen app view (like Home) fed by the Engine's
// local HTTP snapshot, falling back to sample data until the Engine answers,
// sitting side by side with its own dedicated chat session so the Agent can
// manage the systems while its dashboard stays visible. The dedicated chat
// starts at `/trading/<server>/new` on every app or window restart and owns no
// tab: Home's sidebar and command search exclude it via its metadata mark.
// Theme via the app's v2 tokens only; copy via i18n keys only.

import { For, Show, Suspense, createEffect, createMemo, createSignal, lazy, on, onCleanup, onMount, type Accessor, type JSX } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { Schema } from "effect"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createMediaQuery } from "@solid-primitives/media"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useData, useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout } from "@/shell/state/layout"
import { createPanelMotion, holdLandingWidth, panelOpacity } from "@/shell/panel-motion"
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
import { SessionPanelFrame } from "@/session/session-frame"
import {
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
import type { SessionInfo } from "@opencode/client/promise"
import { DEMO, REFRESCO_MS, arrancarSistema, cancelarTarea, cerrarPosicion, cerrarTotal, conectarCuenta, desconectarCuenta, panicoTotal, pararSistema, pedirSnapshot, programarTarea, type BotInfo, type CurvaInfo, type RegistroInfo, type SnapshotMotor, type TareaInfo, type TradeInfo } from "./motor"
import { tradingSectionKey } from "./nav"

// Same currency rendering as the TUI's trading panel: `$12.50` / `-$81.11`.
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" })

const reloj = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })

const formatoUSD = (número: number | null) => (número === null || !Number.isFinite(número) ? "—" : usd.format(número))

/** `-0.16%`-style signed percentage, or a dash when the engine received no value. */
const formatoPct = (valor: number | null) => (valor === null || !Number.isFinite(valor) ? "—" : `${Number(valor.toFixed(2))}%`)

const formatoHora = (ts: number) => (!Number.isFinite(ts) ? "—" : reloj.format(ts))

/** Record rows: today's entries read as plain clock time, older ones name their day — the
 * ring keeps several days of history, so a bare clock time would make yesterday read as
 * today. The dossier's tooltip always carries the full stamp. */
const formatoDíaHora = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })

const formatoCompleto = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" })

function esHoy(momento: Date) {
  const ahora = new Date()
  return ahora.getFullYear() === momento.getFullYear() && ahora.getMonth() === momento.getMonth() && ahora.getDate() === momento.getDate()
}

function formatoMomento(ts: number) {
  if (!Number.isFinite(ts)) return "—"

  const momento = new Date(ts)
  return esHoy(momento) ? reloj.format(momento) : formatoDíaHora.format(momento)
}

function títuloMomento(ts: number) {
  return Number.isFinite(ts) ? formatoCompleto.format(new Date(ts)) : undefined
}

const LINEA = { "line-height": "var(--line-height-compact)" } as const

// The session screen's own default panel width stays private to its layout, so the trading
// chat keeps the same literal — the width the chat uses until the user drags its divider.
const CHAT_WIDTH_DEFAULT = 600

const ChatLayout = Persistence.struct({
  chatWidth: Persistence.optional(Schema.Finite),
  // The chat panel's collapse state, like the app's right-side panel toggles. Absent means open.
  chatOpen: Persistence.optional(Schema.Boolean),
  // Where this window's dedicated chat lives per server, so the next start finds and deletes it.
  chats: Persistence.record(Schema.String),
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

const NÚMERO = "text-[13px] tabular-nums"

function MetaCuenta(props: { etiqueta: string; children: JSX.Element; mono?: boolean; tono?: string }) {
  return (
    <div class="flex min-h-6 items-center justify-between gap-6">
      <dt class="shrink-0 text-[13px] text-v2-text-text-faint" style={LINEA}>
        {props.etiqueta}
      </dt>
      <dd
        class={`min-w-0 shrink-0 truncate text-[13px] text-v2-text-text-base ${props.mono ? "font-mono" : ""} ${props.tono ?? ""} tabular-nums`}
        style={LINEA}
      >
        {props.children}
      </dd>
    </div>
  )
}

/** `/trading` with no routed chat yet: it redirects to its dedicated chat's start on Home's server. */
export function TradingRouter() {
  const layout = useLayout()
  const servers = useServers()
  const navigate = useNavigate()

  createEffect(() => {
    // Home's own server choice: the remembered connection while it is visible, else the first visible one.
    const connection =
      servers.visible.find((item) => ServerConnection.key(item) === layout.home.selection().server) ??
      servers.visible[0]

    if (!connection) return

    navigate(tradingNewHref(ServerConnection.key(connection)), { replace: true })
  })

  // Route side only: nothing exists to render while the redirect settles.
  return null
}

// Dedicated chats already resolved in this app run, per server. Re-entry inside the run
// (switching back to the section, another trading tab) must resolve to the same chat again
// instead of deleting it; the map resets on app restart, so the run's first boot deletes
// whatever the last run left behind (dotted pointer or restored trading tab).
const vivos = new Map<string, string>()

// The system prompt of the trading chat: the standing instructions entry (`trading.desk`).
// Unlike the chat's messages, which the next start deletes with the dedicated session, this
// survives app restarts in the server-global store and re-seeds every fresh chat.
const PromptoSchema = Persistence.struct({
  value: Persistence.optional(Schema.String),
})

// The dashboard's own manual-close permission, one server-global preference the panel
// reads back on every window. It defaults OFF — the user opts in each time they want
// the close actions (per-position and close-all) — and writes stay behind the
// confirmation dialog either way.
const CierreManualSchema = Persistence.struct({
  permitido: Persistence.optional(Schema.Boolean),
})

export function TradingWithSession() {
  const params = useParams<{ serverKey: string; id: string }>()
  const language = useLanguage()
  const sdk = useServerSDK()
  // The route owns this persisted store on its own so the chat width, collapse state and the
  // dedicated-chat pointer never desync between instances over the same window target.
  const [layout, setLayout] = persisted(Persist.window("trading.chat"), ChatLayout, { chats: {} })
  const [prompto, setPrompto] = persisted(Persist.serverGlobal(sdk.scope, "trading.system-prompt"), PromptoSchema, {})
  const serverKey = () => requireServerKey(params.serverKey)

  // The welcome note is purely informational: it shows while the resolved chat holds neither
  // delivered messages nor pending prompts, and both turn it off the instant they exist —
  // prompt admission is optimistic at Enter, so the note leaves on the send itself. During
  // boot it stays hidden: the boot states render their own centered content.
  const data = useData()

  const sinMensajes = createMemo(() => {
    const id = params.id
    if (id === PENDING || vivos.get(serverKey()) !== id) return false
    return data.session.message.list(id).length === 0 && data.session.pending.list(id).length === 0
  })

  // The data layer may not have synced this chat yet when it resolves; seed it so the memo
  // reads real contents instead of an empty store.
  createEffect(
    on(
      () => params.id,
      (id) => {
        if (id === PENDING || vivos.get(serverKey()) !== id) return
        void data.session.message.sync(id).catch(() => undefined)
      },
    ),
  )


  // Saves an edited prompt: written to the server-global store first (it survives every restart),
  // then synced into the current chat's instructions entry so the running conversation picks it up.
  // A chat that has not resolved yet only gets the store; its boot reads it when it seeds.
  const guardarPrompto = async (valor: string) => {
    try {
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
    } catch {
      showToast({
        variant: "error",
        title: language.t("trading.prompt.failed"),
      })
    }
  }

  return (
    <TradingShell
      // Read verbatim like the native session's: the stored width stands (or the 600
      // default while unset), with `resizada` mirroring the native's derived flag — a
      // stored width means the user dragged the divider. No floor here: the contract's
      // clamp and CSS own the minimum.
      anchuraChat={() => layout.chatWidth ?? CHAT_WIDTH_DEFAULT}
      resizada={() => layout.chatWidth !== undefined}
      fijarAnchura={(anchura) => setLayout("chatWidth", anchura)}
      abierto={() => layout.chatOpen ?? true}
      fijarAbierto={(abierto) => setLayout("chatOpen", abierto)}
      prompto={() => prompto.value}
      guardarPrompto={guardarPrompto}
      sinMensajes={() => sinMensajes()}
      chat={
        <Show
          // Resolved means this run's own chat: anything else (pending or a session id
          // restored from a previous run's tab) boots, which resolves, reuses or replaces it.
          when={params.id !== PENDING && vivos.get(serverKey()) === params.id}
          fallback={
            // Boot state only: every state of the resolved session route brings its own panel
            // frame, so it renders bare like the session route and a second frame never stacks.
            <div class="flex min-h-0 flex-1 px-[var(--shell-inline-inset,8px)] pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]">
              <SessionPanelFrame raised>
                <ChatBoot
                  semilla={() => prompto.value ?? TRADING_DESK_CONTEXT}
                  previa={() => layout.chats?.[serverKey()]}
                  recordar={(id) => setLayout("chats", serverKey(), id)}
                />
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
  )
}

/**
 * Boots the trading section's dedicated route: reuses this run's own chat when it exists,
 * otherwise deletes the last run's ones (the stored pointer first, verified by its metadata
 * mark, then the complete root index scan), creates the session with the mark, and routes to
 * it. A marked session never holds user chat work, so the chat restarts empty without a
 * confirmation dialog. The seeded instructions come from the stored prompt when the user
 * edited it, or the default desk context otherwise.
 */
function ChatBoot(props: { semilla: () => string; previa: () => string | undefined; recordar: (id: string) => void }) {
  const language = useLanguage()
  const data = useData()
  const server = useServer()
  const sdk = useServerSDK()
  const navigate = useNavigate()
  const [estado, setEstado] = createStore<{ tipo: "iniciando" | "fallo" }>({ tipo: "iniciando" })
  let vigente = true

  onCleanup(() => {
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

  const arrancarDedicado = async () => {
    // Re-entry inside this run (coming back to the section, another trading tab): the chat
    // created during this run resolves again as is and nothing is deleted. Live sessions are
    // verified before reuse; anything stale falls through to the replace-with-fresh path.
    const viva = vivos.get(server.key)

    if (viva) {
      const conocida = await sdk.api.session.get({ sessionID: viva }).catch(() => undefined)

      if (conocida && isTradingSession(conocida)) {
        props.recordar(viva)
        navigate(tradingHref(server.key, viva), { replace: true })
        return
      }
    }

    // The stored pointer may predate the metadata mark, so only a session that really is a trading
    // chat is removed: user sessions can never be a pointer here.
    // The verified pointer is the fast path: it names exactly the chat to clean up, so the
    // dashboard's first open skips the complete root index scan. The scan only runs when the
    // pointer is missing or stale (cleared storage, restored tab) — the recovery path it exists for.
    const previa = props.previa()

    const candidatas: SessionInfo[] = []

    if (previa) {
      const conocida = await sdk.api.session.get({ sessionID: previa }).catch(() => undefined)

      if (conocida && isTradingSession(conocida)) candidatas.push(conocida)
    }

    if (candidatas.length === 0) {
      const escaneadas = await scanTradingSessions((input, options) => sdk.api.session.list(input, options))

      candidatas.push(...escaneadas)
    }

    const marcadas = [...new Map(candidatas.map((session) => [session.id, session] as const)).values()]

    // Best effort and off the route's critical path: a removal that fails (a session gone in the
    // meantime, a recovering server) must not block the fresh chat; the next start would retry
    // the cleanup. The new chat is created while the old ones go out.
    void Promise.allSettled(marcadas.map((session) => data.session.remove(session.id)))

    if (!vigente) return

    const info = await sdk.api.session.create({
      title: language.t("trading.title"),
      metadata: { [TRADING_METADATA_MARK]: true },
    })

    data.session.remember(info)
    props.recordar(info.id)
    vivos.set(server.key, info.id)
    navigate(tradingHref(server.key, info.id), { replace: true })

    // One per-session context entry keeps the chat on-topic for every step (see
    // TRADING_DESK_CONTEXT). The user-editable prompt (stored server-side) replaces the
    // default when present. Best effort, after the route has already switched: a server
    // without the experimental endpoint still started the chat; a later boot retries the seeding.
    void sdk.api.experimental.session.instructions.entry
      .put({ sessionID: info.id, key: "trading.desk", value: props.semilla() })
      .catch(() => undefined)
  }

  return (
    <Show
      when={estado.tipo === "iniciando"}
      fallback={
        <div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p class="max-w-[420px] text-[13px] text-v2-text-text-muted" style={LINEA}>
            {language.t("trading.chat.failed")}
          </p>
          <button
            type="button"
            class="rounded-[6px] border border-v2-border-border-muted px-3 py-1.5 text-[13px] text-v2-text-text-base hover:bg-v2-background-bg-layer-02 focus-visible:bg-v2-background-bg-layer-02"
            style={LINEA}
            onClick={arrancar}
          >
            {language.t("trading.chat.retry")}
          </button>
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
  guardarPrompto: (valor: string) => Promise<void>
  /** True while the resolved chat holds no messages: the welcome note shows (informational). */
  sinMensajes: Accessor<boolean>
  chat: JSX.Element
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useServerSDK()
  const layout = useLayout()
  const [snapshot, setSnapshot] = createStore<SnapshotMotor>(structuredClone(DEMO))
  const activos = () => snapshot.bots.filter((bot) => bot.activo).length
  // The product's section: the sidebar rows and this panel read the same layout store.
  const sección = () => layout.producto.section()

  // One record, no per-system tabs: log lines and closed trades merge into a single
  // chronological list whose close rows ARE the trades (each close already logs itself,
  // so the trades carry the P/L and the log's own close rows drop out) — nothing repeats.
  const registroUnido = () => reunirRegistro(snapshot.registros, snapshot.trades)

  // The manual-close permission read strictly: the switch is an opt-in, so until the
  // user turns it on (stored server-global; fresh installs read the off default) every
  // close action (per-position and close-all) stays hidden.
  const [cierreManual, setCierreManual] = persisted(
    Persist.serverGlobal(sdk.scope, "trading.cierre-manual"),
    CierreManualSchema,
    { permitido: false },
  )
  const cierrePermitido = () => cierreManual.permitido === true
  const fijarCierreManual = (permitido: boolean) => setCierreManual("permitido", permitido)

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

  // The exact derivation the session's own layout uses (`screen-layout.ts`): the row less
  // its 8px gap, undefined until the row first measures — width consumers keep the stored
  // value untouched until then so nothing snaps on the first frame.
  const disponible = createMemo<number | undefined>(() => {
    const width = filaSize.width

    if (width === undefined) return undefined

    return width - 8
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

  // The content box's width at rest: whatever the chat last landed at while open, or full
  // width before the row measures (and on the stacked layout, where the chat spans it all).
  const chatAnchoContenido = createMemo<string>((previous) => {
    const width = chatAncho()

    return width === undefined ? previous : `${width}px`
  }, "100%")

  // The chat's resting width in CSS against the row — the native formula, so it follows the
  // row on the frame it resizes — builds the dashboard's open width below.
  const chatWidthCss = createMemo(() => sessionPanelWidthCss({ width: props.anchuraChat(), split: false, resized: props.resizada() }))

  // The dashboard keeps its open width as the far end of a close's travel — the native
  // flight's sticky open width, mirrored one seam over: the row less the 8px gap and the
  // chat's resting width, what that split leaves the dashboard.
  const dashAbierta = createMemo<string>((previous) => (chatVisible() ? `calc(100% - 8px - ${chatWidthCss()})` : previous), "100%")

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

  createEffect(() => {
    if (chatVisible()) fijarChatMontada(true)
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
        aria-expanded={props.abierto()}
        aria-controls="trading-chat-panel"
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

  const refrescar = async () => {
    const real = await pedirSnapshot(sdk.api)

    if (real === undefined) {
      setSnapshot("enlace", false)

      return
    }

    setSnapshot({ ...real, demo: false })
  }

  // v0 flag toggle: it marks the system running/stopped inside the engine (local state,
  // no IBKR contact), then an immediate refresh shows the flip.
  const fijarSistema = (bot: { readonly id: string; readonly activo: boolean }) => {
    const operacion = bot.activo ? pararSistema(sdk.api, bot.id) : arrancarSistema(sdk.api, bot.id)

    void operacion.then(() => void refrescar())
  }

  // Batch toggles write every system's flag in one go and refresh once — the engine takes
  // the writes in parallel, so the pool costs one refresh instead of one per system.
  const lotearSistemas = async (operaciones: Array<Promise<unknown>>) => {
    await Promise.allSettled(operaciones)
    await refrescar()
  }

  const arrancarTodos = () =>
    lotearSistemas(snapshot.bots.filter((bot) => !bot.activo).map((bot) => arrancarSistema(sdk.api, bot.id)))

  const pararTodos = () =>
    lotearSistemas(snapshot.bots.filter((bot) => bot.activo).map((bot) => pararSistema(sdk.api, bot.id)))

  // Scheduling from a system's dossier: the scope is fixed by the card itself, so only the
  // action and the moment are picked. The same toast feedback as the dashboard writes.
  const programarSistema = async (systemID: string, entrada: { kind: "start-systems" | "stop-systems"; delayMinutes?: number; atTime?: string }) => {
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

  // Close semantics: real orders, so the confirmation is a dialog that states the full cycle
  // and warns when a running system trades the same contract family (it would reopen the
  // position). The engine's verdict comes back in the toast (its own message in the description).
  const sistemasSobreSímbolo = (símbolo: string) =>
    snapshot.bots.filter(
      (bot) =>
        bot.activo &&
        (símbolo.includes(bot.simbolo) ||
          // Micro futures name the underlying the full contract also trades: M2K is RTY's micro.
          (bot.simbolo === "RTY" && símbolo.includes("M2K"))),
    )

  const ejecutarCierre = async (símbolo: string) => {
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
        avisa={snapshot.bots.some((bot) => bot.activo)}
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
  // report), shown in the toast the same way the close actions report theirs.
  const ejecutarPanico = async () => {
    const resultado = await panicoTotal(sdk.api)

    if (resultado === undefined) {
      showToast({ variant: "error", title: language.t("trading.panic.failed") })
    } else {
      showToast({
        variant: resultado.close.ok ? "success" : "error",
        icon: resultado.close.ok ? "circle-check" : undefined,
        title: language.t("trading.panic.sent"),
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
  const cancelarPrograma = async (taskID: string) => {
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
              // Closed only: the chat toggle overlays the row's top-right corner, so the engine
              // pill reserves its spot; with the chat open the corner is the chat header's own
              // reserved panel space and the pill keeps the normal padding.
              classList={{ "pe-[44px]": !props.abierto(), "pe-6": props.abierto() }}
            >
              <h1 class="min-w-0 flex-1 text-[15px] text-v2-text-text-base font-medium" style={{ "line-height": "var(--line-height-base)" }}>
                {language.t(tradingSectionKey(sección()))}
              </h1>
              <Show when={!snapshot.demo}>
                <Button
                  type="button"
                  variant="danger"
                  size="small"
                  disabled={!snapshot.enlace}
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
              </Show>
              <span
                class="flex h-7 shrink-0 items-center gap-1.5 rounded-[12px] border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-layer-01 ps-2.5 pe-2.5 text-[13px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-base shadow-[var(--v2-elevation-raised)]"
                style={LINEA}
              >
                <span class={`size-1.5 shrink-0 rounded-full ${puntoMotor()}`} aria-hidden="true" />
                {etiquetaMotor()}
              </span>
            </header>

            {/* Plain wheel/drag scrolling: the shared bar would paint as a stray pill hugging the
                panel's edge — detached from the rows by their trailing cushion — and flash on and
                off while the window narrows, the way the app's own tab rail hides its scrollbar. */}
            <div data-scrollable class="min-h-0 flex-1 overflow-y-auto no-scrollbar">
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
                      <Tooltip class="shrink-0" placement="bottom" value={language.t("trading.systems.startAll")}>
                        <IconButton
                          type="button"
                          variant="ghost-muted"
                          size="small"
                          disabled={activos() >= snapshot.bots.length}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={arrancarTodos}
                          aria-label={language.t("trading.systems.startAll")}
                          icon={<Icon name="play" />}
                        />
                      </Tooltip>
                      <Tooltip class="shrink-0" placement="bottom" value={language.t("trading.systems.stopAll")}>
                        <IconButton
                          type="button"
                          variant="ghost-muted"
                          size="small"
                          disabled={activos() === 0}
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
                        const etiqueta = () => language.t(bot.activo ? "trading.system.stop" : "trading.system.start")

                        return (
                          <li class="flex min-h-6 items-center gap-2">
                            <span
                              class={`size-1.5 shrink-0 rounded-full ${bot.activo ? "bg-v2-state-fg-success" : "bg-v2-border-border-muted"}`}
                              aria-hidden="true"
                            />
                            <button
                              type="button"
                              class="min-w-0 flex-1 truncate text-start text-[13px] text-v2-text-text-base hover:text-v2-text-text-muted"
                              onClick={() => abrirFicha(bot)}
                            >
                              {bot.nombre}
                            </button>
                            <span class={`shrink-0 text-[11px] text-v2-text-text-faint ${bot.pid !== null ? "font-mono" : ""}`} style={LINEA}>
                              {bot.pid !== null ? `PID ${bot.pid} · ` : ""}
                              {bot.simbolo} · {bot.temporalidad}
                            </span>
                            <span class={`w-[72px] shrink-0 text-end ${NÚMERO} ${tonoPnl(bot.pnl_dia)}`}>{formatoUSD(bot.pnl_dia)}</span>
                            <Tooltip class="shrink-0" placement="bottom" value={etiqueta()}>
                              <IconButton
                                type="button"
                                variant="ghost-muted"
                                size="small"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => fijarSistema(bot)}
                                aria-label={etiqueta()}
                                aria-pressed={bot.activo}
                                icon={<Icon name={bot.activo ? "stop" : "play"} />}
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
                          disabled={snapshot.posiciones.length === 0}
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
                              {posición.lado}
                            </span>
                            <span class={`shrink-0 text-[13px] text-v2-text-text-muted ${NÚMERO}`} style={LINEA}>
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
                  <SecciónTareas tareas={snapshot.tareas} bots={snapshot.bots} cancelar={cancelarPrograma} />
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
                  the chat travels. On desktop the shell's bands live on the trading root
                  wrapper, so trading.css zeroes the shell inset variables that the chat's
                  session screen reads its padding from — that second round of insets would
                  otherwise stack inside the face; on the stacked layout the face is full-bleed
                  and the screen keeps its own insets. */}
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
                size={chatAnchoVivo()}
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

function SecciónTareas(props: { tareas: TareaInfo[]; bots: BotInfo[]; cancelar: (taskID: string) => void }) {
  const language = useLanguage()

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
                <Tooltip class="shrink-0" placement="bottom" value={language.t("trading.task.cancel")}>
                  <IconButton
                    type="button"
                    variant="ghost-muted"
                    size="small"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => props.cancelar(tarea.id)}
                    aria-label={language.t("trading.task.cancel")}
                    icon={<Icon name="circle-xmark" />}
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
  // behind it is always right.
  const confirmar = async () => {
    if (ejecutando()) return

    setEjecutando(true)
    await props.confirmar()
    dialog.close()
  }

  return (
    <Dialog size="large" preventBackdropDismiss>
      <DialogHeader>
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
        <Button type="button" variant="danger" disabled={ejecutando()} onClick={confirmar}>
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
  const language = useLanguage()
  const dialog = useDialog()

  // Each field reads the snapshot store once and decides its fallback itself, so the JSX
  // never needs narrowing across separate accessor calls and keeps updating with each poll.
  const pidFicha = () => {
    const valor = props.bot()?.pid
    return valor === null || valor === undefined ? "—" : `PID ${valor}`
  }
  const arranqueFicha = () => {
    const valor = props.bot()?.arrancada
    return valor === null || valor === undefined ? "—" : formatoHora(valor)
  }
  const enMarchaFicha = () => props.bot()?.enMarcha ?? false
  const pnlFicha = () => props.bot()?.pnl_dia ?? null
  const instrumentoFicha = () => {
    const valor = props.bot()
    return valor === undefined ? "—" : `${valor.simbolo} · ${valor.temporalidad}`
  }

  return (
    <Dialog size="large" preventBackdropDismiss>
      <DialogHeader>
        <DialogTitleGroup title={props.bot()?.nombre ?? ""} description={language.t("trading.ficha.description")} />
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

    if (formulario.modo === "minutos") return /^\d+$/.test(texto) && Number(texto) >= 1

    return /^([01]?\d|2[0-3]):[0-5]\d$/.test(texto)
  }

  const enviar = async () => {
    if (enviando()) return

    fijarEnviando(true)
    await props.programar({
      kind: formulario.accion === "arrancar" ? "start-systems" : "stop-systems",
      delayMinutes: formulario.modo === "minutos" ? Number(formulario.valor.trim()) : undefined,
      atTime: formulario.modo === "hora" ? formulario.valor.trim() : undefined,
    })
    fijarEnviando(false)
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
 * app restarts (server-global store) and re-seeds every fresh dedicated chat.
 */
function DialogPrompto(props: { contenido: string; guardar: (valor: string) => Promise<void> }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [borrador, setBorrador] = createSignal(props.contenido)
  const [guardando, setGuardando] = createSignal(false)

  // The parent's save shows its own success/failure toast and resolves either way, so closing
  // behind it is always right.
  const guardar = async () => {
    if (guardando()) return

    setGuardando(true)
    await props.guardar(borrador())
    dialog.close()
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
 * P/L the log lacks — and the log's own close rows drop out, keeping no duplicates. */
function reunirRegistro(registros: RegistroInfo[], trades: TradeInfo[]): EntradaRegistro[] {
  const lineas: EntradaRegistro[] = registros
    .filter((registro) => registro.evento !== "cierre")
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
 * accented messages right. The anchor-click pattern works in both the renderer and the web. */
function descargarRegistro(entradas: EntradaRegistro[], etiqueta: string) {
  const celda = (valor: string) => `"${valor.replaceAll('"', '""').replaceAll("\n", " ")}"`
  const filas = [
    "hora,nivel,sistema,evento,mensaje,pnl_usd",
    ...entradas.map((entrada) =>
      [
        new Date(entrada.ts).toISOString(),
        entrada.nivel,
        entrada.bot,
        entrada.evento ?? "",
        entrada.mensaje,
        entrada.pnl === null ? "" : entrada.pnl.toFixed(2),
      ]
        .map(celda)
        .join(","),
    ),
  ].join("\n")
  const enlace = document.createElement("a")
  enlace.href = URL.createObjectURL(new Blob(["\ufeff", filas], { type: "text/csv;charset=utf-8" }))
  enlace.download = `registro-trading-${etiqueta}.csv`
  enlace.click()
  URL.revokeObjectURL(enlace.href)
}

/** The record card's download button with its three time windows (today, this week, this
 * month — all local calendar boundaries). A fixed transparent layer closes the tiny menu
 * on any outside click, the same trade-off every popover makes without a ports layer. */
function MenuDescarga(props: { entradas: Accessor<EntradaRegistro[]> }) {
  const language = useLanguage()
  const [abierto, fijarAbierto] = createSignal(false)

  const bajar = (desde: number, etiqueta: string) => {
    fijarAbierto(false)
    descargarRegistro(props.entradas().filter((entrada) => entrada.ts >= desde), etiqueta)
  }
  // Evaluated when the user picks: today's midnight, this Monday and this month's 1st.
  const pedir = () => {
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const dia = hoy.toISOString().slice(0, 10)
    const semana = new Date(hoy)
    semana.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7))
    const mes = new Date(hoy)
    mes.setDate(1)
    return [
      { clave: "today" as const, desde: hoy.getTime(), etiqueta: dia },
      { clave: "week" as const, desde: semana.getTime(), etiqueta: `${dia}-semana` },
      { clave: "month" as const, desde: mes.getTime(), etiqueta: `${dia}-mes` },
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
        <menu class="absolute end-0 top-full z-50 mt-1 flex w-max flex-col whitespace-nowrap rounded-[8px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-1">
          <For each={pedir()}>
            {(opción) => (
              <button
                type="button"
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
  const language = useLanguage()
  const [extendido, fijarExtendido] = createSignal(false)
  const [filtro, fijarFiltro] = createSignal<FiltroRegistro>("todos")

  const conCoincidencia = () => CLASE_FILTRO.filter((clase) => props.registros.some((entrada) => enFiltro(entrada, clase)))
  const principales = () => props.registros.filter((entrada) => entrada.evento !== null || entrada.nivel !== "info")
  const resto = () => props.registros.filter((entrada) => entrada.evento === null && entrada.nivel === "info")
  const visibles = () => {
    const elegido = filtro()
    if (elegido === "todos") return extendido() ? props.registros : principales()
    return props.registros.filter((entrada) => enFiltro(entrada, elegido))
  }

  return (
    <>
      <Show when={conCoincidencia().length > 0}>
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
          <For each={conCoincidencia()}>
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
          {language.t(extendido() ? "trading.log.less" : "trading.log.more", { count: resto().length })}
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
          <svg viewBox="0 0 100 24" preserveAspectRatio="none" class="h-8 w-full">
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

