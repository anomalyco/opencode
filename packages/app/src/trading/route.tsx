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
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useData, useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout } from "@/shell/state/layout"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Button } from "@opencode/ui/button"
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
// The session route itself stays out of the trading module graph: the dashboard's first open
// must not pay for the chat chunk (which also drags the File viewer). It loads on its own,
// behind a Suspense boundary, only once this run's dedicated chat resolves and takes the pane.
const TargetSessionRouteContent = lazy(() =>
  import("@/session/route").then((module) => ({ default: module.TargetSessionRouteContent })),
)
import { isTradingSession, scanTradingSessions, TRADING_DESK_CONTEXT, TRADING_METADATA_MARK } from "./session"
import "./trading.css"
import type { SessionInfo } from "@opencode/client/promise"
import { DEMO, REFRESCO_MS, arrancarSistema, cancelarTarea, cerrarPosicion, cerrarTotal, pararSistema, pedirSnapshot, type BotInfo, type RegistroInfo, type SnapshotMotor, type TareaInfo } from "./motor"

// Same currency rendering as the TUI's trading panel: `$12.50` / `-$81.11`.
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" })

const reloj = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })

const formatoUSD = (número: number | null) => (número === null ? "—" : usd.format(número))

/** `-0.16%`-style signed percentage, or a dash when the engine received no value. */
const formatoPct = (valor: number | null) => (valor === null ? "—" : `${Number(valor.toFixed(2))}%`)

const formatoHora = (ts: number) => reloj.format(ts)

/** A task's due time: the weekday abbreviates to keep the row readable in the narrow card. */
const formatoFechaHora = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

const formatoTarea = (ts: number) => formatoFechaHora.format(new Date(ts))

const LINEA = { "line-height": "var(--line-height-compact)" } as const

// Same approach as the session row's panel width: reserve a fixed minimum for the dashboard and
// let the chat panel take everything else. The stored width is clamped in CSS against the row, so
// it can't squeeze the dashboard while dragging even before the stored value settles.
const CHAT_WIDTH_MIN = 320

const CHAT_WIDTH_DEFAULT = 640

const DASHBOARD_WIDTH_MIN = 460

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

/** A scheduled task's lifetime color: amber while it waits, green when it ran, red when it
 * was skipped (the app was closed at its due time) and gray once the user withdrew it. */
function puntoTarea(estado: TareaInfo["estado"]) {
  if (estado === "pendiente") return "bg-v2-state-fg-warning"

  if (estado === "ejecutada") return "bg-v2-state-fg-success"

  if (estado === "no_ejecutada") return "bg-v2-state-fg-danger"

  return "bg-v2-border-border-muted"
}

const ETIQUETA_TAREA: Record<TareaInfo["estado"], string> = {
  pendiente: "trading.task.pending",
  ejecutada: "trading.task.ran",
  no_ejecutada: "trading.task.missed",
  cancelada: "trading.task.cancelled",
}

function Tarjeta(props: { título: string; acción?: JSX.Element; children: JSX.Element }) {
  return (
    <section class="rounded-[8px] border border-v2-border-border-muted bg-v2-background-bg-deep p-3">
      <div class="mb-2 flex min-h-6 items-center justify-between gap-2 px-1">
        <h2 class="text-[11px] tracking-[0.08em] text-v2-text-text-faint uppercase" style={LINEA}>
          {props.título}
        </h2>
        <Show when={props.acción}>{props.acción}</Show>
      </div>
      {props.children}
    </section>
  )
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
      anchuraChat={() => layout.chatWidth ?? CHAT_WIDTH_DEFAULT}
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
  const [snapshot, setSnapshot] = createStore<SnapshotMotor>(structuredClone(DEMO))
  const activos = () => snapshot.bots.filter((bot) => bot.activo).length

  // The log is the systems' bible, so a chip per talking system plus "all" keeps the flow
  // readable; null shows everything.
  const [botEnVista, fijarBotEnVista] = createSignal<string | null>(null)
  const botsDelRegistro = () => [...new Set(snapshot.registros.map((registro) => registro.bot))]
  const registrosVistos = () =>
    botEnVista() === null ? snapshot.registros : snapshot.registros.filter((registro) => registro.bot === botEnVista())

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

  const etiquetaChat = () => language.t(props.abierto() ? "trading.chat.hide" : "trading.chat.show")

  // One control for the chat, like the app's own panel toggles: it sits at the window's
  // top-right corner in both states, because that corner belongs to the dashboard when
  // the chat is hidden and to the chat when it is open.
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
        registros={() => snapshot.registros.filter((registro) => registro.bot === bot.nombre)}
      />
    ))
  }

  const chatWidthMax = () => Math.max(CHAT_WIDTH_MIN, window.innerWidth - DASHBOARD_WIDTH_MIN - 24)

  // Task rows name the systems they act on; an unknown id (a renamed system) falls back to itself.
  const nombreSistema = (id: string) => snapshot.bots.find((bot) => bot.id === id)?.nombre ?? id

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

  // Withdrawing a pending task is a direct UI action (like the systems' own flags), so no
  // confirmation dialog: the task has not fired, and an immediate refresh shows the flip.
  const retirarTarea = (taskID: string) => {
    void cancelarTarea(sdk.api, taskID).then(() => void refrescar())
  }

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

  return (
    <div class="relative flex-1 min-h-0 flex flex-col md:flex-row" data-slot="trading-panes">
      <div
        data-slot="trading-panel"
        class="
          min-h-0 min-w-0 flex-1 mb-[var(--shell-bottom-inset,8px)] ms-[var(--shell-inline-inset,8px)]
          mt-[var(--shell-top-inset,8px)] flex flex-col overflow-hidden
          rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
        "
        // With the chat collapsed the dashboard reaches the shell's right edge, so it takes the
        // inline inset itself; while the chat is open the chat pane supplies that gap.
        classList={{ "me-[var(--shell-inline-inset,8px)]": !props.abierto() }}
      >
        <header
          class="flex shrink-0 items-center gap-3 border-b border-v2-border-border-muted ps-6 py-3"
          // Closed only: the chat toggle overlays the row's top-right corner, so the engine
          // pill reserves its spot; with the chat open the corner is the chat header's own
          // reserved panel space and the pill keeps the normal padding.
          classList={{ "pe-[44px]": !props.abierto(), "pe-6": props.abierto() }}
        >
          <h1 class="min-w-0 flex-1 text-[15px] text-v2-text-text-base font-medium" style={{ "line-height": "var(--line-height-base)" }}>
            {language.t("trading.title")}
          </h1>
          <span
            class="flex h-7 shrink-0 items-center gap-1.5 rounded-[12px] border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-layer-01 ps-2.5 pe-2.5 text-[13px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-base shadow-[var(--v2-elevation-raised)]"
            style={LINEA}
          >
            <span class={`size-1.5 shrink-0 rounded-full ${puntoMotor()}`} aria-hidden="true" />
            {etiquetaMotor()}
          </span>
        </header>

        <div data-scrollable class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div class="flex w-full flex-col gap-3">
            <div class="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)]">
              <Tarjeta título={language.t("trading.account")}>
                <dl>
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
              </Tarjeta>

              <Tarjeta título={language.t("trading.bots")}>
                <div class="mb-2 px-1 text-[13px] text-v2-text-text-muted" style={LINEA}>
                  {language.plural("trading.bots.active", activos(), { total: snapshot.bots.length })}
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
              </Tarjeta>
            </div>

            <div class="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)]">
              <Tarjeta
                título={language.t("trading.positions")}
                acción={
                  <div class="flex items-center gap-2">
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
                }
              >
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
              </Tarjeta>

              <Tarjeta título={language.t("trading.log")}>
                <Show when={snapshot.registros.length > 0} fallback={<p class="px-1 text-[13px] text-v2-text-text-faint">{language.t("trading.log.empty")}</p>}>
                  <Show when={botsDelRegistro().length > 1}>
                    <div class="mb-1.5 flex flex-wrap gap-1">
                      <button
                        type="button"
                        class={`h-5 shrink-0 rounded-full border px-2 text-[11px] leading-[18px] text-v2-text-text-base ${
                          botEnVista() === null
                            ? "border-v2-border-border-muted bg-v2-background-bg-layer-02"
                            : "border-transparent hover:text-v2-text-text-muted text-v2-text-text-faint"
                        }`}
                        onClick={() => fijarBotEnVista(null)}
                        aria-pressed={botEnVista() === null}
                      >
                        {language.t("trading.log.all")}
                      </button>
                      <For each={botsDelRegistro()}>
                        {(bot) => (
                          <button
                            type="button"
                            class={`h-5 max-w-[220px] shrink-0 truncate rounded-full border px-2 text-[11px] font-mono leading-[18px] text-v2-text-text-base ${
                              botEnVista() === bot
                                ? "border-v2-border-border-muted bg-v2-background-bg-layer-02"
                                : "border-transparent hover:text-v2-text-text-muted text-v2-text-text-faint"
                            }`}
                            onClick={() => fijarBotEnVista(bot)}
                            aria-pressed={botEnVista() === bot}
                          >
                            {bot}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                  <div class="flex flex-col">
                    <For each={registrosVistos()}>
                      {(registro) => (
                        <div class="flex min-h-6 items-start gap-2">
                          <time class="w-16 shrink-0 text-[11px] text-v2-text-text-faint tabular-nums" style={LINEA}>
                            {formatoHora(registro.ts)}
                          </time>
                          <span class={`w-10 shrink-0 text-[11px] ${tonoNivel(registro.nivel)}`} style={LINEA}>
                            {registro.nivel}
                          </span>
                          <span class="min-w-0 flex-1 text-[13px] break-words whitespace-pre-wrap text-v2-text-text-muted">
                            <Show when={registro.evento} keyed>
                              {(evento) => (
                                <span class={`me-1 inline-block rounded-full border px-1.5 text-[10px] font-medium tracking-[0.04em] uppercase leading-[14px] ${CLASE_EVENTO[evento]}`}>
                                  {language.t(CLAVE_EVENTO[evento])}
                                </span>
                              )}
                            </Show>
                            <span class="font-mono">{registro.bot}</span> {registro.mensaje}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Tarjeta>
            </div>

            <Tarjeta título={language.t("trading.tasks")}>
              <Show when={snapshot.tareas.length > 0} fallback={<p class="px-1 text-[13px] text-v2-text-text-faint" style={LINEA}>{language.t("trading.tasks.empty")}</p>}>
                <ul class="flex flex-col">
                  <For each={snapshot.tareas}>
                    {(tarea) => (
                      <li class="flex min-h-6 items-center gap-2">
                        <span class={`size-1.5 shrink-0 rounded-full ${puntoTarea(tarea.estado)}`} aria-hidden="true" />
                        <span class="shrink-0 text-[13px] text-v2-text-text-base" style={LINEA}>
                          {language.t(tarea.accion === "arrancar" ? "trading.task.start" : "trading.task.stop")}
                        </span>
                        <Show
                          when={tarea.sistemas.length > 0}
                          fallback={
                            <span class="min-w-0 flex-1 truncate text-[11px] text-v2-text-text-faint" style={LINEA}>
                              {language.t("trading.tasks.all")}
                            </span>
                          }
                        >
                          <span class="min-w-0 flex-1 truncate text-[11px] text-v2-text-text-faint" style={LINEA}>
                            {tarea.sistemas.map(nombreSistema).join(", ")}
                          </span>
                        </Show>
                        <span class="shrink-0 text-[11px] text-v2-text-text-muted tabular-nums" style={LINEA}>
                          {formatoTarea(tarea.hora)}
                        </span>
                        <span class="shrink-0 text-[11px] text-v2-text-text-faint" style={LINEA}>
                          {language.t(ETIQUETA_TAREA[tarea.estado])}
                        </span>
                        <Show when={tarea.estado === "pendiente"}>
                          <Tooltip
                            class="shrink-0"
                            placement="bottom"
                            value={language.t("trading.task.cancel")}
                          >
                            <IconButton
                              type="button"
                              variant="ghost-muted"
                              size="small"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => retirarTarea(tarea.id)}
                              aria-label={language.t("trading.task.cancel")}
                              icon={<Icon name="close" />}
                            />
                          </Tooltip>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Tarjeta>
          </div>
        </div>
      </div>

      <Show when={props.abierto()}>
        {/* The chat's header is the session's native sticky title bar, emptied to the same
            bare row the side panel's tabs bar shows: trading.css keeps the bar (opaque bg,
            fade, and the corner spacer for the floating buttons) and hides only its inner
            content — project location, title/menu, cost chip and header icon. */}
        <div
          data-slot="trading-chat-panel"
          id="trading-chat-panel"
          class="
            relative min-h-0 min-w-0 flex-1 flex flex-col
            md:flex-none
            md:w-[min(max(320px,calc(100%_-_468px)),var(--trading-chat-width,640px))]
          "
          style={{ "--trading-chat-width": `${props.anchuraChat()}px` }}
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
          {/* Desktop only: on the stacked layout the chat pane is full width and has nothing to resize. */}
          <div class="hidden md:block">
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={props.anchuraChat()}
              min={CHAT_WIDTH_MIN}
              max={chatWidthMax()}
              onResize={(anchura) => props.fijarAnchura(Math.min(anchura, chatWidthMax()))}
            />
          </div>

          {props.chat}
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
 * the LOG card draws filtered to this one system, live-updating with the dashboard's 3 s poll.
 */
function DialogFicha(props: { bot: Accessor<BotInfo | undefined>; registros: Accessor<RegistroInfo[]> }) {
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
                <div data-scrollable class="min-h-0 flex-1 overflow-y-auto">
                  <Show
                    when={props.registros().length > 0}
                    fallback={<p class="px-1 text-[13px] text-v2-text-text-faint" style={LINEA}>{language.t("trading.ficha.record.empty")}</p>}
                  >
                    <div class="flex flex-col">
                      <For each={props.registros()}>
                        {(registro) => (
                          <div class="flex min-h-6 items-start gap-2">
                            <time class="w-16 shrink-0 text-[11px] text-v2-text-text-faint tabular-nums" style={LINEA}>
                              {formatoHora(registro.ts)}
                            </time>
                            <span class={`w-10 shrink-0 text-[11px] ${tonoNivel(registro.nivel)}`} style={LINEA}>
                              {registro.nivel}
                            </span>
                            <span class="min-w-0 flex-1 text-[13px] break-words whitespace-pre-wrap text-v2-text-text-muted">
                              <Show when={registro.evento} keyed>
                                {(evento) => (
                                  <span class={`me-1 inline-block rounded-full border px-1.5 text-[10px] font-medium tracking-[0.04em] uppercase leading-[14px] ${CLASE_EVENTO[evento]}`}>
                                    {language.t(CLAVE_EVENTO[evento])}
                                  </span>
                                )}
                              </Show>
                              <span class="font-mono">{registro.bot}</span> {registro.mensaje}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </section>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </Button>
      </DialogFooter>
    </Dialog>
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
