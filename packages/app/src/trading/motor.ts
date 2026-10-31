// Connection with the trading engine: the app's own background service (the v2 service that
// serves the dashboard), through the same SDK the rest of the app uses. Snapshot reads are
// read-only; writes stay behind the engine and the agent's permissioned flow.

import type { OpenCodeClient } from "@opencode/client/promise"

export interface CuentaInfo {
  readonly id: string
  readonly tipo: string
  readonly efectivo: number | null
  readonly patrimonio: number | null
  readonly pnl_dia: number | null
  readonly pnl_realizado: number | null
}

export interface BotInfo {
  readonly id: string
  readonly nombre: string
  readonly activo: boolean
  /** A live bot process exists for this system (the engine's running mirror). */
  readonly enMarcha: boolean
  /** The bot's process id while running; null otherwise. */
  readonly pid: number | null
  /** Epoch ms when the engine last saw the bot start; null otherwise. */
  readonly arrancada: number | null
  readonly simbolo: string
  readonly temporalidad: string
  readonly pnl_dia: number | null
  /** The bot's configured TWS CLIENT_ID; null when the engine drew a blank (older engine, unreadable config). */
  readonly cliente: number | null
  /** The config's session-close hour ("HH:MM:SS", New York's close); null when absent. */
  readonly horaCierre: string | null
  /** Epoch ms of the bot's newest own record row today; null until it logs. */
  readonly actividad: number | null
  /** The system's one-paragraph idea from its own reglas.json; null when absent. */
  readonly descripcion: string | null
  /** The system's rules as (name, rule) pairs in file order; null when reglas.json is absent. */
  readonly reglas: readonly (readonly [string, string])[] | null
}

export interface TareaInfo {
  readonly id: string
  readonly accion: "arrancar" | "parar"
  /** System IDs; empty means the task acts on every system in the pool. */
  readonly sistemas: string[]
  readonly hora: number
  readonly estado: "pendiente" | "ejecutada" | "no_ejecutada" | "cancelada"
  readonly resuelta: number | null
  readonly creada: number
}

export interface PosicionInfo {
  readonly simbolo: string
  readonly lado: "largo" | "corto"
  readonly tamano: number
  readonly entrada: number | null
  readonly actual: number | null
  readonly pnl: number | null
  readonly pnl_pct: number | null
}

export interface RegistroInfo {
  readonly ts: number
  readonly nivel: "info" | "aviso" | "error"
  readonly bot: string
  readonly mensaje: string
  /** The few entries that mark a position lifecycle beat: an open, an average-in ("apertura"),
   * a close ("cierre") or the first signal ("senal"); null for every other line. */
  readonly evento: "apertura" | "cierre" | "senal" | null
}

/** One closed trade as the bot itself reported it (its "FUERA … (±X USD brutos)" row). */
export interface TradeInfo {
  readonly bot: string
  readonly hora: number
  /** The bot's stated gross USD; null when the row carried no figure. */
  readonly pnl: number | null
  readonly mensaje: string
}

/** One equity-curve sample: account values as reported by IBKR (null until they arrive). */
export interface CurvaInfo {
  readonly hora: number
  readonly patrimonio: number | null
  readonly pnl_dia: number | null
}

/** The engine's daily-loss guard: stop every bot once the day P/L reaches -limite_dia. */
export interface RiesgoInfo {
  /** USD; 0 disables the guard. */
  readonly limite_dia: number
  /** Epoch ms when the guard fired; null while armed. */
  readonly disparada: number | null
}

export interface SnapshotMotor {
  /** true while the engine has an IBKR connection (TWS demo 7497). */
  enlace: boolean
  /** true while only sample data is available (the engine has never been read). */
  demo: boolean
  motor: { version: string }
  cuenta: CuentaInfo
  bots: BotInfo[]
  tareas: TareaInfo[]
  posiciones: PosicionInfo[]
  registros: RegistroInfo[]
  trades: TradeInfo[]
  curva: CurvaInfo[]
  /** Missing when the serving engine predates the risk fields (it has not restarted with the new engine). */
  riesgo: RiesgoInfo | null
}

// ----------------------------- sample data -----------------------------
// The user's real pool: DUT141214 demo account, one MNQZ6 position, 15 systems on
// the IG markets paper account. Shown until the engine answers a first time; the
// values mirror the TUI plugin's DEMO so both views read the same numbers.

/** One DEMO row: the dossier facts stay null on purpose — the engine fills them from each
 * bot's own files, and a sample row has no business inventing CLIENT_IDs or rules. */
function botDemo(nombre: string, activo: boolean, simbolo: string, temporalidad: string, pnl_dia: number): BotInfo {
  return {
    id: nombre.slice(0, 2),
    nombre,
    activo,
    enMarcha: false,
    pid: null,
    arrancada: null,
    simbolo,
    temporalidad,
    pnl_dia,
    cliente: null,
    horaCierre: null,
    actividad: null,
    descripcion: null,
    reglas: null,
  }
}

export const DEMO: SnapshotMotor = {
  enlace: false,
  demo: true,
  motor: { version: "muestra" },
  cuenta: {
    id: "DUT141214",
    tipo: "Demo (paper) · IBKR",
    efectivo: 24_870.35,
    patrimonio: 24_870.35,
    pnl_dia: -81.11,
    pnl_realizado: -124.5,
  },
  tareas: [],
  bots: [
    botDemo("01_nasdaq_apertura_alcista", true, "NQ", "5m", 12.5),
    botDemo("02_nasdaq_ruptura_media_hora", false, "NQ", "30m", 0),
    botDemo("03_nasdaq_impulso_con_tendencia", false, "NQ", "15m", 0),
    botDemo("04_oro_rebote_del_viernes", false, "GC", "30m", 0),
    botDemo("05_oro_fuerza_de_madrugada", false, "GC", "15m", 0),
    botDemo("06_nasdaq_pullback", true, "NQ", "1h", -40),
    botDemo("07_oro_nube_ichimoku", false, "GC", "1h", 0),
    botDemo("08_russell_estocastico_h2", false, "RTY", "2h", 0),
    botDemo("09_russell_cci_tendencia", false, "RTY", "1h", 0),
    botDemo("10_russell_estocastico_h4", false, "RTY", "4h", 0),
    botDemo("11_usdjpy_ruptura_bollinger", false, "JPY", "1h", 0),
    botDemo("12_usdjpy_ruptura_keltner", false, "JPY", "1h", 0),
    botDemo("13_usdjpy_ruptura_donchian", false, "JPY", "1h", 0),
    botDemo("14_usdjpy_cruce_ema_10_40", false, "JPY", "1h", 0),
    botDemo("15_usdjpy_precio_ema30_h3", false, "JPY", "3h", 0),
  ],
  posiciones: [
    { simbolo: "MNQZ6", lado: "corto", tamano: 1, entrada: 25_150.75, actual: 25_191.3, pnl: -81.11, pnl_pct: -0.16 },
  ],
  registros: [
    RegistroDemo(-90, "info", "motor", "Conexión con IBKR demo (127.0.0.1:7497)"),
    RegistroDemo(-80, "info", "01_nasdaq_apertura_alcista", "Arrancado · espera la apertura de Nasdaq"),
    RegistroDemo(-40, "info", "06_nasdaq_pullback", "Señal encontrada · espera confirmación"),
    RegistroDemo(-20, "aviso", "10_russell_estocastico_h4", "Mercado fuera de sesión · sin señales"),
    RegistroDemo(-1, "info", "motor", "Snapshot listo · 15 sistemas, 3 activos"),
  ],
  trades: [
    { bot: "01_nasdaq_apertura_alcista", hora: Date.now() - 75 * 60_000, pnl: 46.25, mensaje: "FUERA a 10:32:14 · +46.25 USD brutos" },
    { bot: "06_nasdaq_pullback", hora: Date.now() - 52 * 60_000, pnl: -38.5, mensaje: "FUERA a 10:48:02 · -38.5 USD brutos" },
  ],
  curva: [],
  riesgo: { limite_dia: 250, disparada: null },
}

function RegistroDemo(minutosAtras: number, nivel: RegistroInfo["nivel"], bot: string, mensaje: string): RegistroInfo {
  return { ts: Date.now() - minutosAtras * 60_000, nivel, bot, mensaje, evento: null }
}

// ------------------------------ read cycle ------------------------------

/** The engine's snapshot contract served by the app's own service (`experimental.trading.*`). */
type SnapshotNativo = Awaited<ReturnType<OpenCodeClient["experimental"]["trading"]["snapshot"]>>

/** The SDK keeps numbers JSON-safe: NaN and the infinities arrive as strings. Real values are
 * always finite (the engine runs everything through safeNumber), so anything else maps to null. */
type NumeroCru = number | "Infinity" | "-Infinity" | "NaN"

function numeroNulo(valor: NumeroCru | null): number | null {
  return typeof valor === "number" ? valor : null
}

function numero(valor: NumeroCru): number {
  return typeof valor === "number" ? valor : NaN
}

/** Maps the engine's native English contract onto the dashboard's existing Spanish views. */

// The engine maps its log levels ("warning") to the dashboard's Spanish ones ("aviso"); the
// warning→aviso mapping lives here so the view contract keeps its Spanish vocabulary.
function nivelDeMotor(level: "info" | "warning" | "error"): RegistroInfo["nivel"] {
  if (level === "warning") return "aviso"

  if (level === "error") return "error"

  return "info"
}

function eventoDeNativo(event: "open" | "close" | "signal" | undefined): RegistroInfo["evento"] {
  if (event === "open") return "apertura"

  if (event === "close") return "cierre"

  if (event === "signal") return "senal"

  return null
}

type TareaNativa = SnapshotNativo["tasks"][number]

function tareaDeNativo(nativa: TareaNativa): TareaInfo {
  return {
    id: nativa.id,
    accion: nativa.kind === "start-systems" ? "arrancar" : "parar",
    sistemas: [...nativa.system_ids],
    hora: numero(nativa.run_at),
    estado: estadoDeNativo(nativa.status),
    resuelta: numeroNulo(nativa.resolved_at),
    creada: numero(nativa.time_created),
  }
}

function estadoDeNativo(status: TareaNativa["status"]): TareaInfo["estado"] {
  if (status === "pending") return "pendiente"

  if (status === "ran") return "ejecutada"

  if (status === "missed") return "no_ejecutada"

  return "cancelada"
}

function desdeNativo(nativo: SnapshotNativo): Omit<SnapshotMotor, "demo"> {
  const cuenta: CuentaInfo = {
    id: nativo.account?.id ?? "",
    tipo: nativo.account?.type ?? "",
    efectivo: numeroNulo(nativo.account?.cash ?? null),
    patrimonio: numeroNulo(nativo.account?.equity ?? null),
    pnl_dia: numeroNulo(nativo.account?.pnl_day ?? null),
    pnl_realizado: numeroNulo(nativo.account?.pnl_realized ?? null),
  }

  return {
    enlace: nativo.connected,
    motor: { version: nativo.version },
    cuenta,
    bots: [...nativo.systems].map((system) => ({
      id: system.id,
      nombre: system.name,
      activo: system.active,
      enMarcha: system.running,
      pid: numeroNulo(system.pid),
      arrancada: numeroNulo(system.started_at),
      simbolo: system.symbol,
      temporalidad: system.timeframe,
      pnl_dia: numeroNulo(system.pnl_day),
      cliente: numeroNulo(system.client_id ?? null),
      horaCierre: system.close_hour ?? null,
      actividad: numeroNulo(system.last_activity_at ?? null),
      descripcion: system.description ?? null,
      reglas: system.rules ? Object.entries(system.rules) : null,
    })),
    tareas: [...nativo.tasks].map((task) => tareaDeNativo(task)),
    posiciones: [...nativo.positions].map((position) => ({
      simbolo: position.symbol,
      lado: position.side === "long" ? "largo" : "corto",
      tamano: numero(position.size),
      entrada: numeroNulo(position.entry),
      actual: numeroNulo(position.current),
      pnl: numeroNulo(position.pnl),
      pnl_pct: numeroNulo(position.pnl_pct),
    })),
    registros: [...nativo.logs].map((entry) => ({
      ts: numero(entry.ts),
      nivel: nivelDeMotor(entry.level),
      bot: entry.system,
      mensaje: entry.message,
      evento: eventoDeNativo(entry.event),
    })),
    // An engine predating these fields (the live sidecar until its engine restart) simply omits them.
    trades: (nativo.trades ?? []).map((trade) => ({
      bot: trade.system,
      hora: numero(trade.ts),
      pnl: numeroNulo(trade.pnl ?? null),
      mensaje: trade.message,
    })),
    curva: (nativo.equity ?? []).map((punto) => ({
      hora: numero(punto.ts),
      patrimonio: numeroNulo(punto.equity ?? null),
      pnl_dia: numeroNulo(punto.pnl_day ?? null),
    })),
    riesgo:
      nativo.risk === undefined
        ? null
        : { limite_dia: numero(nativo.risk.loss_day_limit), disparada: numeroNulo(nativo.risk.triggered_at ?? null) },
  }
}

/** Asks the engine (the app's own server) for its snapshot. undefined when the server does not answer. */
export async function pedirSnapshot(api: OpenCodeClient): Promise<Omit<SnapshotMotor, "demo"> | undefined> {
  const respuesta = await api.experimental.trading.snapshot().catch(() => undefined)

  if (respuesta === undefined) return undefined

  return desdeNativo(respuesta)
}

/** Marks one of the pool's systems as running (a local engine flag; v0 never contacts IBKR). */
export function arrancarSistema(api: OpenCodeClient, id: string) {
  return api.experimental.trading.system.activate({ systemID: id }).catch(() => undefined)
}

/** Marks one of the pool's systems as stopped (a local engine flag; v0 never contacts IBKR). */
export function pararSistema(api: OpenCodeClient, id: string) {
  return api.experimental.trading.system.pause({ systemID: id }).catch(() => undefined)
}

/**
 * Schedules one of the engine's tasks: start or stop systems at a run time on the PC's clock,
 * given as a wait in minutes or a local "HH:MM". Never contacts IBKR (local flags only).
 */
export function programarTarea(api: OpenCodeClient, input: { kind: "start-systems" | "stop-systems"; systemIDs?: string[]; delayMinutes?: number; atTime?: string }) {
  return api.experimental.trading.task
    .add({ kind: input.kind, systemIDs: input.systemIDs, delayMinutes: input.delayMinutes, atTime: input.atTime })
    .catch(() => undefined)
}

/** Withdraws a pending task so it never fires. */
export function cancelarTarea(api: OpenCodeClient, taskID: string) {
  return api.experimental.trading.task.cancel({ taskID }).catch(() => undefined)
}

/**
 * Runs the full close cycle for one position: the contract's open orders are cancelled, an
 * opposite market order goes out and, when it cannot execute, the engine falls back to two
 * OCA GTC limit orders ±1 point. The result is the engine's verdict (ok + plain message);
 * undefined when the server did not answer. A write: it only happens behind the
 * confirmation dialog, never directly.
 */
export function cerrarPosicion(api: OpenCodeClient, símbolo: string) {
  return api.experimental.trading.position.close({ symbol: símbolo }).catch(() => undefined)
}

/**
 * The emergency versions of the per-position close: the same full cycle over every open
 * position, one past the other; a failure never stops the rest. The result is the engine's
 * aggregated verdict (ok + plain message listing every symbol's outcome); undefined when the
 * server did not answer. A write: it only happens behind the confirmation dialog, never
 * directly.
 */
export function cerrarTotal(api: OpenCodeClient) {
  return api.experimental.trading.positions.closeAll().catch(() => undefined)
}

/** Links the engine's TWS socket up (the user's click; nothing connects on its own). */
export function conectarCuenta(api: OpenCodeClient) {
  return api.experimental.trading.connect().catch(() => undefined)
}

/** Drops the engine's TWS socket until the next connect (running bots are untouched). */
export function desconectarCuenta(api: OpenCodeClient) {
  return api.experimental.trading.disconnect().catch(() => undefined)
}

/**
 * The panic button: every running bot stops and the emergency close-all runs over the open
 * positions. The result lists the stopped systems plus the close verdict; undefined when the
 * server did not answer. A write: it only happens behind the confirmation dialog.
 */
export function panicoTotal(api: OpenCodeClient) {
  return api.experimental.trading.panic().catch(() => undefined)
}

/** Sets the daily-loss guard's limit in USD; 0 disables it (persisted in the engine). */
export function fijarLimiteDia(api: OpenCodeClient, limite: number) {
  return api.experimental.trading.risk.update({ lossDayLimit: limite }).catch(() => undefined)
}

/** How often the dashboard re-polls the engine. */
export const REFRESCO_MS = 3_000
