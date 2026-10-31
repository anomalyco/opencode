export * as TradingEngine from "./trading.js"

import { and, desc, eq, lte } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { open, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Trading } from "@opencode/schema/trading"
import {
  IBApiNext,
  ConnectionState,
  OrderAction,
  OrderType,
  TimeInForce,
  type AccountSummaryValues,
  type Contract,
  type OpenOrder,
  type Order,
} from "@stoqey/ib"
import { Database } from "./database/database.js"
import { TradingRiskTable, TradingTaskTable, TradingTradeTable } from "./trading/sql.js"

export class SystemNotFoundError extends Schema.TaggedError<SystemNotFoundError>()("TradingEngine.SystemNotFound", {
  systemID: Schema.String,
}) {}

/** The engine starts one bot process per system, so its name/id must also tell the pool folder. */
export class InvalidTaskError extends Schema.TaggedError<InvalidTaskError>()("TradingEngine.InvalidTask", {
  message: Schema.String,
}) {}

export class TaskNotFoundError extends Schema.TaggedError<TaskNotFoundError>()("TradingEngine.TaskNotFound", {
  taskID: Schema.String,
}) {}

export interface TaskAddInput {
  readonly kind: Trading.TaskKind
  /** System IDs to act on; empty or omitted means every system in the pool. */
  readonly systemIDs?: readonly string[]
  /** Minutes from now on the server machine's local (PC) clock; mutually exclusive with `atTime`. */
  readonly delayMinutes?: number
  /** The next local wall-clock time "HH:MM" (PC clock; tomorrow when it is past today already); mutually exclusive with `delayMinutes`. */
  readonly atTime?: string
}

export interface Interface {
  /** The engine's whole state; a synchronous read of the last values received from IBKR. */
  readonly snapshot: () => Trading.Snapshot
  /** Marks a system of the pool as running. Local flag only; v0 never contacts IBKR. */
  readonly activate: (systemID: string) => Effect.Effect<Trading.System, SystemNotFoundError>
  /** Marks a system of the pool as stopped. Local flag only; v0 never contacts IBKR. */
  readonly pause: (systemID: string) => Effect.Effect<Trading.System, SystemNotFoundError>
  /**
   * Runs the full close cycle for one position: cancels the contract's open orders, sends the
   * opposite market order, and when it cannot execute falls back to two OCA GTC limit orders
   * ±1 point. Returns the flow's verdict; `ok: false` is a normal outcome (the message carries
   * the reason), never a defect. The caller must have confirmed with the user first.
   */
  readonly closePosition: (symbol: string) => Effect.Effect<Trading.PositionCloseResult>
  /** The emergency version of `closePosition`: runs the same full cycle over every open
   * position, keeps going past individual failures and lists each verdict in the message. */
  readonly closeAllPositions: () => Effect.Effect<Trading.PositionCloseResult>
  /** The engine's scheduled tasks, newest first. */
  readonly taskList: () => Effect.Effect<Trading.Task[]>
  /** Schedules a systems task and persists it; it fires only while the service runs. */
  readonly taskAdd: (input: TaskAddInput) => Effect.Effect<Trading.Task, InvalidTaskError | SystemNotFoundError>
  /** Withdraws a pending task so it never fires. */
  readonly taskCancel: (id: Trading.TaskID) => Effect.Effect<Trading.Task, InvalidTaskError | TaskNotFoundError>
  /** Links the TWS socket up (the user's own click); the 5 s reconnect loop starts chasing until TWS accepts. Nothing connects at boot. Returns the current account (null until the balances arrive). */
  readonly connect: () => Effect.Effect<Trading.Account | null>
  /** Drops the TWS socket and stops the reconnect chase until the next `connect`. */
  readonly disconnect: () => Effect.Effect<Trading.Account | null>
  /**
   * Stops every running bot (same pid-guarded kill path as the user's stop) and then runs the
   * emergency close-all over the open positions. Nothing is re-armed afterwards; the systems'
   * flags stay off until reactivated. The caller must have confirmed with the user first.
   */
  readonly panic: () => Effect.Effect<Trading.PanicResult>
  /** Sets the daily-loss limit; 0 disables the guard. Persisted. */
  readonly riskUpdate: (input: RiskUpdateInput) => Effect.Effect<Trading.Risk, InvalidTaskError>
  /** The expiry loop; forked once from `process.ts`, like the Schedule loop. */
  readonly run: Effect.Effect<never>
}

/** When an engine stop was ordered; the record names the caller honestly. */
export type StopOrigin = "user" | "task" | "riesgo" | "panic"

/** The record's verdict line for each stop origin. */
const STOP_ORIGIN_MESSAGE: Record<StopOrigin, string> = {
  user: "Bot parado por el usuario",
  task: "Bot parado por tarea programada",
  riesgo: "Bot parado por límite de pérdida diaria",
  panic: "Bot parado por pánico",
}

export interface RiskUpdateInput {
  /** USD; 0 disables the guard. */
  readonly loss_day_limit: number
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TradingEngine") {}

export interface Options {
  readonly host?: string
  readonly port?: number
  /** The pool folder: one `NN_name` subfolder with `bot.py` per system. Defaults to the demo folder. */
  readonly systemsDir?: string
  /** Folder put on the bots' PYTHONPATH so ib_async and the Python 3.14 sitecustomize load. */
  readonly botPythonPath?: string
}

/** The user's real system pool folder and the ib_async folder the bots import from. */
const SISTEMAS_DIR_DEFECTO = "C:\\Users\\iker\\Desktop\\trading-algoritmico-main\\demo"
const PYTHONPATH_BOTS_DEFECTO = "D:\\.more\\.windows_old\\dash"

/** The daily-loss guard's default limit (USD) for a first run without a persisted row. */
const DEFAULT_LOSS_DAY_LIMIT = 250

/** Display metadata per known pool folder; a folder without an entry still works and reads as unknown. */
const META: Record<string, { symbol: string; timeframe: string }> = {
  "01_nasdaq_apertura_alcista": { symbol: "NQ", timeframe: "5m" },
  "02_nasdaq_ruptura_media_hora": { symbol: "NQ", timeframe: "30m" },
  "03_nasdaq_impulso_con_tendencia": { symbol: "NQ", timeframe: "15m" },
  "04_oro_rebote_del_viernes": { symbol: "GC", timeframe: "30m" },
  "05_oro_fuerza_de_madrugada": { symbol: "GC", timeframe: "15m" },
  "06_nasdaq_pullback": { symbol: "NQ", timeframe: "1h" },
  "07_oro_nube_ichimoku": { symbol: "GC", timeframe: "1h" },
  "08_russell_estocastico_h2": { symbol: "RTY", timeframe: "2h" },
  "09_russell_cci_tendencia": { symbol: "RTY", timeframe: "1h" },
  "10_russell_estocastico_h4": { symbol: "RTY", timeframe: "4h" },
  "11_usdjpy_ruptura_bollinger": { symbol: "JPY", timeframe: "1h" },
  "12_usdjpy_ruptura_keltner": { symbol: "JPY", timeframe: "1h" },
  "13_usdjpy_ruptura_donchian": { symbol: "JPY", timeframe: "1h" },
  "14_usdjpy_cruce_ema_10_40": { symbol: "JPY", timeframe: "1h" },
  "15_usdjpy_precio_ema30_h3": { symbol: "JPY", timeframe: "3h" },
}

/** One pool system: a folder with its bot.py, the dossier facts its own files state, and the
 * display metadata the folder's name maps to. */
interface Definicion {
  readonly id: string
  readonly name: string
  readonly dir: string | null
  readonly clientId: number | null
  /** The "HOST:PUERTO" the bot's config.py points at; null when either line is missing.
   * A config that points elsewhere runs outside the engine's own watch. */
  readonly servidor: string | null
  /** The config's HORA_CIERRE as "HH:MM:SS" (New York's close); null when the line is absent. */
  readonly horaCierre: string | null
  /** The system's one-paragraph idea from its own reglas.json. */
  readonly descripcion: string | null
  /** The system's rules, key→text in file order; null when reglas.json is absent. */
  readonly reglas: Readonly<Record<string, string>> | null
  readonly meta: { symbol: string; timeframe: string } | null
}

interface Runtime {
  /** Where the live pid came from, for honest reports: the folder's panel.pid or a TWS probe hit. */
  source: "panel" | "external" | null
  pid: number | null
  startedAt: number | null
  /** The child handle for an engine-launched bot; null for adopted-external bots. */
  child: ChildProcess | null
  /** A stop (or task kill) already accounted for; its exit must not report a fallen bot. */
  planeado: boolean
  registroOffset: number
  consolaOffset: number
  /** Epoch ms of the bot's newest own row today; null when it has not logged today. */
  ultimaActividad: number | null
}

/** The pool's folder names: directories `NN_name` (bot.py checked later, per definition). */
const escanearCarpetas = async (dir: string): Promise<string[]> => {
  try {
    const entradas = await readdir(dir, { withFileTypes: true })
    return entradas.filter((entry) => entry.isDirectory() && /^\d\d_/.test(entry.name)).map((entry) => entry.name).sort()
  } catch {
    return []
  }
}

/** Reads the bot's config.py and reglas.json into the system's dossier facts: its CLIENT_ID
 * (the TWS probe matches on it), the HOST:PUERTO the config points at, the close hour, and
 * the written idea/rules. Unreadable or malformed files null their own facts only — the bot
 * itself boots fine without them, and only the engine's dossier and probe miss out. */
const definicion = async (name: string, dir: string): Promise<Definicion> => {
  const folder = `${dir}\\${name}`
  const config = await readFile(`${folder}\\config.py`, "utf8").catch(() => "")
  const clientId = Number(/^CLIENT_ID\s*=\s*(\d+)/m.exec(config)?.[1]) || null
  const servidorHost = /^HOST\s*=\s*"([^"]+)"/m.exec(config)?.[1]
  const servidorPuerto = Number(/^PUERTO\s*=\s*(\d+)/m.exec(config)?.[1]) || null
  const tupla = /^\s*HORA_CIERRE\s*=\s*\((\d+),\s*(\d+)(?:,\s*(\d+))?\)/m.exec(config)
  const horaCierre =
    tupla === null
      ? null
      : `${tupla[1].padStart(2, "0")}:${tupla[2].padStart(2, "0")}${tupla[3] === undefined ? "" : `:${tupla[3].padStart(2, "0")}`}`
  const escrito = (await readFile(`${folder}\\reglas.json`, "utf8")
    .then((texto) => JSON.parse(texto) as { idea?: unknown; reglas?: unknown })
    .catch(() => null)) ?? null
  const descripcion = typeof escrito?.idea === "string" ? escrito.idea : null
  const reglas =
    escrito === null || typeof escrito.reglas !== "object" || escrito.reglas === null
      ? null
      : Object.fromEntries(Object.entries(escrito.reglas).filter((entrada) => typeof entrada[1] === "string"))
  return {
    id: name.slice(0, 2),
    name,
    dir: folder,
    clientId,
    servidor: servidorHost !== undefined && servidorPuerto !== null ? `${servidorHost}:${servidorPuerto}` : null,
    horaCierre,
    descripcion,
    reglas,
    meta: META[name] ?? null,
  }
}

/** Whether a pid still belongs to a live process; callers that may kill always add the bot.py command-line check. */
const pidVivo = async (pid: number): Promise<boolean> => {
  const salida = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"], {
    timeout: 5_000,
    windowsHide: true,
  })
  return (salida.stdout?.toString() ?? "").includes(`"${pid}"`)
}

/** The pid-kill safeguard: only a process whose own command line is a bot.py is ever terminated. */
const pidEsBot = async (pid: number): Promise<boolean> => {
  const salida = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
    { timeout: 8_000, windowsHide: true },
  )
  return (salida.stdout?.toString() ?? "").toLowerCase().includes("bot.py")
}

/** Whether a TWS client id is already in use (the engine's boot probe; 326 means a bot runs with it). */
const clientIdEnUso = async (host: string, port: number, clientId: number): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const ib = new IBApiNext({ host, port })
    const listo = (vivo: boolean) => {
      ib.disconnect()
      resolve(vivo)
    }
    const timer = setTimeout(() => listo(false), 2_500)
    ib.errorSubject.subscribe((error) => {
      if (Number(error.code) === 326 || /already in use/i.test(String(error.error))) {
        clearTimeout(timer)
        listo(true)
      }
    })
    ib.connect(clientId)
  })

/** The pool as the engine sees it: every known system, folder and its live runtime (empty when never started). */
let sistemas: Definicion[] = []
const bots = new Map<string, Runtime>()
/** Each bot's last portfolio PnL from its own registro.log; the bots log it only while running. */
const pnlBots = new Map<string, number>()

const toSchemaSystem = (system: Definicion): Trading.System => {
  const runtime = bots.get(system.id)
  const enMarcha = runtime !== undefined && runtime.startedAt !== null
  return {
    id: system.id,
    name: system.name,
    running: enMarcha,
    active: enMarcha,
    pid: enMarcha ? runtime.pid : null,
    started_at: enMarcha ? runtime.startedAt : null,
    symbol: system.meta?.symbol ?? "?",
    timeframe: system.meta?.timeframe ?? "?",
    pnl_day: pnlBots.get(system.id) ?? null,
    client_id: system.clientId,
    close_hour: system.horaCierre,
    last_activity_at: runtime === undefined ? null : runtime.ultimaActividad,
    description: system.descripcion,
    rules: system.reglas === null ? null : { ...system.reglas },
  }
}

/** Engine version reported in snapshots. */
const VERSION = "nativo-1"

/** IBKR client ID. Must be unique across clients connected to the same TWS session. */
const CLIENT_ID = 30

/** IBKR TWS API port. 7497 is TWS's default demo port (7496 would be live). */
const ACCOUNT_SUMMARY_TAGS =
  "NetLiquidation,TotalCashBalance,CashBalance,UnrealizedPnL,RealizedPnL,AccountType,Currency"

const parseValue = (value: string | undefined) => {
  if (value === undefined || value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** The engine never invents numbers: whatever IB sends broken (NaN, Infinity) is null, the
 * same bridge the dashboard's render already draws as "—" downstream. */
const safeNumber = (value: number | undefined | null) =>
  value !== undefined && value !== null && Number.isFinite(value) ? value : null

const firstTagValue = (tagValues: AccountSummaryValues | undefined) => {
  if (!tagValues) return undefined
  return (tagValues.get("USD") ?? [...tagValues.values()][0])?.value
}

const layer = (options: Options = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const host = options.host ?? "127.0.0.1"
      const port = options.port ?? 7497
      const sistemasDir = options.systemsDir ?? SISTEMAS_DIR_DEFECTO
      const botPythonPath = options.botPythonPath ?? PYTHONPATH_BOTS_DEFECTO
      /** Resolved once at boot ("where pythonw"); a PATH miss degrades to the bare command. */
      let pythonwEjecutable = "pythonw"

      type TaskRow = typeof TradingTaskTable.$inferSelect

      const toSchemaTask = (row: TaskRow): Trading.Task => ({
        id: row.id,
        kind: row.kind,
        system_ids: [...row.system_ids],
        run_at: row.run_at,
        status: row.status,
        resolved_at: row.resolved_at,
        time_created: row.time_created,
        time_updated: row.time_updated,
      })

      const connected = { value: false }
      const accountId = { value: null as string | null }
      const accountType = { value: null as string | null }
      const balances = { value: { cash: null as number | null, equity: null as number | null } }
      const pnl = { value: { day: null as number | null, realized: null as number | null } }
      const positions = { value: [] as Trading.Position[] }
      // The IB contracts behind the tracked positions (keyed by local symbol), stored as they
      // arrive so a close operates on the real contract instead of rebuilding one.
      const contratos = { value: new Map<string, Contract>() }
      // The engine's own orders' latest known status (the reqOpenOrders stream, client ID 30):
      // the close cycle reads it to tell an accepted order from a rejected or cancelled one.
      const ordenesIds = new Map<number, NonNullable<OpenOrder["orderStatus"]>>()
      const logs = { value: [] as Trading.Log[] }
      // Recent tasks held in memory so the synchronous snapshot can include them without a DB read.
      const tasks = { value: [] as Trading.Task[] }
      // Recent closed trades (newest first), harvested from the bots' logs; written to the
      // trading_trade table as well, so they survive restarts. Capped to 200.
      const trades = { value: [] as Trading.Trade[] }
      // The equity curve (oldest first), sampled every 15 s while the tick runs. Memory only;
      // Capped to 1000 points (~4 hours at 15 s).
      const equity = { value: [] as Trading.EquityPoint[] }
      // The daily-loss guard, persisted in the trading_risk single row.
      const risk = { value: null as Trading.Risk | null }
      const pnlSubscribed = new Set<string>()
      let positionKey = ""

      // Boot state from the DB: the daily-loss guard row (defaulting on a first run) and the
      // recent-trades ring, so both survive restarts.
      const guardRow = (yield* db.select().from(TradingRiskTable).where(eq(TradingRiskTable.id, "default")).all().pipe(Effect.orDie))[0]
      risk.value =
        guardRow !== undefined
          ? { loss_day_limit: guardRow.loss_day_limit, triggered_at: guardRow.triggered_at }
          : { loss_day_limit: DEFAULT_LOSS_DAY_LIMIT, triggered_at: null }
      trades.value = (yield* db.select().from(TradingTradeTable).orderBy(desc(TradingTradeTable.ts)).limit(200).all().pipe(Effect.orDie)).map(
        (row) => ({ system: row.system, ts: row.ts, pnl: row.pnl, message: row.message }),
      )

      interface LogExtra {
        readonly ts?: number
        readonly event?: "open" | "close" | "signal"
      }

      /** Debounce for engine-owned messages (no bot timestamp): a connection flap storm keeps
       * repeating "conexión establecida/perdida" every 5 s, and echoing them all would bury
       * the record's ring. Everything else stays verbatim: bot rows are never debounced. */
      const echoReciente = new Map<string, number>()

      const pushLog = (level: Trading.LogLevel, system: string, message: string, extra?: LogExtra) => {
        if (extra === undefined) {
          const clave = `${level}\u0001${system}\u0001${message}`
          const visito = echoReciente.get(clave)
          if (visito !== undefined && Date.now() - visito < 60_000) return
          echoReciente.set(clave, Date.now())
        }
        const entry: Trading.Log =
          extra?.event !== undefined
            ? { ts: extra?.ts ?? Date.now(), level, system, message, event: extra.event }
            : { ts: extra?.ts ?? Date.now(), level, system, message }
        logs.value = logs.value.length >= 800 ? [...logs.value.slice(-799), entry] : [...logs.value, entry]
      }
      pushLog("info", "motor", `Motor nativo arrancado · sin conexión con TWS; pulsa Conectar para enlazar ${host}:${port} (demo)`)

      const ib = new IBApiNext({ host, port, reconnectInterval: 5_000, connectionWatchdogInterval: 15 })

      // Subscriber callbacks run on IB socket threads outside the Effect runtime; the only
      // failure surface there is the callback itself, so guarding is the real boundary.
      const guard = (where: string, run: () => void) => {
        try {
          run()
        } catch (cause) {
          pushLog("error", "motor", `Fallo interno en ${where}: ${String(cause)}`)
        }
      }

      yield* Effect.addFinalizer(() => Effect.sync(() => ib.disconnect()))

      ib.connectionState.subscribe((state) =>
        guard("connectionState", () => {
          if (state === ConnectionState.Connected && !connected.value) {
            connected.value = true
            pushLog("info", "motor", `Conexión con IBKR establecida (${host}:${port} demo)`)
            return
          }
          if (state === ConnectionState.Disconnected && connected.value) {
            connected.value = false
            accountId.value = null
            accountType.value = null
            balances.value = { cash: null, equity: null }
            positions.value = []
            positionKey = ""
            pushLog("warning", "motor", "Conexión con IBKR perdida · reintentando cada 5 s")
          }
        }),
      )

      ib.getAccountSummary("All", ACCOUNT_SUMMARY_TAGS).subscribe((update) =>
        guard("accountSummary", () => {
          const [id, tags] = [...update.all][0]
          if (id === undefined || !tags) return
          if (update.all.size > 1) pushLog("warning", "motor", `${update.all.size} cuentas en el resumen · usando ${id}`)
          accountId.value = id
          accountType.value = firstTagValue(tags.get("AccountType")) ?? null
          // Same tag repeats per currency; balances come from the USD row, else the first row.
          balances.value = {
            cash: parseValue(firstTagValue(tags.get("TotalCashBalance") ?? tags.get("CashBalance"))),
            equity: parseValue(firstTagValue(tags.get("NetLiquidation"))),
          }
          if (!pnlSubscribed.has(id)) {
            pnlSubscribed.add(id)
            ib.getPnL(id).subscribe((updatePnl) =>
              guard("pnl", () => {
                pnl.value = {
                  day: safeNumber(updatePnl.dailyPnL),
                  realized: safeNumber(updatePnl.realizedPnL),
                }
              }),
            )
          }
        }),
      )

      // TWS serves only a subset of the requested tags on the account-summary stream; the
      // account-updates stream (the Account Window ledger) carries the cash balances, so it
      // fills them in once it arrives. The ledger refreshes at most every 3 minutes.
      ib.getAccountUpdates().subscribe((update) =>
        guard("accountUpdates", () => {
          const summaries = update.all.value
          if (!summaries) return
          const [id, tags] = [...summaries][0]
          if (id === undefined || !tags) return
          if (summaries.size > 1)
            pushLog("warning", "motor", `${summaries.size} cuentas en el ledger · usando ${id}`)
          accountType.value = accountType.value ?? (firstTagValue(tags.get("AccountType")) ?? null)
          // Same ledger row repeats per currency; cash comes from the USD row, else the first row.
          balances.value = {
            ...balances.value,
            cash: parseValue(
              firstTagValue(
                tags.get("$LEDGER-TotalCashBalance") ??
                  tags.get("TotalCashBalance") ??
                  tags.get("CashBalance") ??
                  tags.get("TotalCashValue"),
              ),
            ),
          }
        }),
      )

      ib.getPositions().subscribe((update) =>
        guard("positions", () => {
          const todas = [...update.all.values()].flat()
          // Store the contract behind every reported position (even ones already closed) at
          // the earliest moment, so a close never has to guess its shape later.
          for (const position of todas) {
            const local = position.contract.localSymbol ?? position.contract.symbol
            if (position.contract.conId !== undefined && local) contratos.value.set(local, position.contract)
          }
          const mapped = todas
            .flatMap((position): Trading.Position[] => {
              const size = position.pos
              // A broken size would poison every derived number: the row is dropped instead.
              if (!Number.isFinite(size) || size === 0) return []
              const entry = safeNumber(position.avgCost)
              const denom = entry !== null ? Math.abs(entry * Math.abs(size)) : null
              const pct =
                position.unrealizedPNL !== undefined && position.unrealizedPNL !== null && denom
                  ? (position.unrealizedPNL / denom) * 100
                  : null
              return [
                {
                  symbol: position.contract.localSymbol ?? position.contract.symbol ?? `${position.contract.conId ?? "?"}`,
                  side: size > 0 ? ("long" as const) : ("short" as const),
                  size: Math.abs(size),
                  entry,
                  current: safeNumber(position.marketPrice),
                  pnl: safeNumber(position.unrealizedPNL),
                  pnl_pct: pct !== null && Number.isFinite(pct) ? pct : null,
                },
              ]
            })
          positions.value = mapped
          const key = mapped.map((p) => `${p.symbol}:${p.side}${p.size}`).join(", ") || "sin posiciones"
          if (key !== positionKey) {
            positionKey = key
            pushLog("info", "motor", `Posiciones: ${key}`)
          }
        }),
      )

        // A permanent subscription: the first observer makes the request and the updates must
        // keep flowing while the engine runs, or a close could never tell an accepted order
        // from a rejected or cancelled one.
        ib.getOpenOrders().subscribe((update) =>
          guard("openOrders", () => {
            for (const orden of update.all) {
              if (orden.orderStatus) ordenesIds.set(orden.orderId, orden.orderStatus)
            }
          }),
        )

      // The socket is NOT connected at boot: it links up only through the user's Conectar
      // action. Once linked, the 5 s reconnect interval keeps chasing a flapping TWS; the
      // user's Desconectar fully stops that chase until the next Conectar.
      const connect = Effect.gen(function* () {
        if (connected.value) return toSchemaAccount()
        pushLog("info", "motor", `Conectando con TWS en ${host}:${port} (demo)… reintento cada 5 s hasta que acepte`)
        yield* Effect.sync(() => ib.connect(CLIENT_ID))
        return toSchemaAccount()
      })
      const disconnect = Effect.gen(function* () {
        yield* Effect.sync(() => ib.disconnect())
        return null
      })

      // ---------------------------------------------------------- bots ----------
      // One real bot process per system. The truth about a bot is its folder's panel.pid plus
      // the process list; the bots' own registro.log / consola.log are the dashboard's record
      // of reference, tailed into the shared log with the system's name so every entry makes
      // plain which system did what and when it went into or out of a position.

      /** End-of-file position (0 when the file does not exist yet). */
      const cola = async (path: string) => {
        try {
          const { size } = await stat(path)
          return size
        } catch {
          return 0
        }
      }

      /** Reads a bot's file from an offset; null when it has not grown (the common case every tick). */
      const leerCola = async (path: string, offset: number) => {
        const handle = await open(path, "r").catch(() => null)
        if (handle === null) return null
        try {
          const { size } = await handle.stat()
          if (size <= offset) return null
          const length = Math.min(size - offset, 1_000_000)
          const buffer = Buffer.alloc(length)
          const { bytesRead } = await handle.read(buffer, 0, length, offset)
          return { chunk: buffer.toString("utf8", 0, bytesRead), size }
        } finally {
          await handle.close()
        }
      }

      /** A bot's registro.log row: local PC clock "YYYY-MM-DD hh:mm:ss,mmm" plus the message. */
      const LINEA_BOT = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}),(\d{3}) (.+)$/
      /** Bot rows that would bury the record: portfolio dumps, data-farm heartbeats and
       * ib_async's own connection/position chatter (the bot asserts those in its own
       * lifecycle lines anyway). */
      const SORRO =
        /^(updatePortfolio:|Warning \d|Disconnecting|position: |Connecting|Connected|Logged on|API connection|Synchronization|connectRequest)/
      /** Untagged rows worth keeping: the bot's own lifecycle notes and TWS error messages. */
      const CICLO = /^(conectado a|contrato:|contexto:|la estrategia ha terminado|desconectado|el bot ha arrancado|Error \d)/

      interface Latido {
        ts: number | null
        level: Trading.LogLevel
        message: string
        event?: "open" | "close" | "signal"
      }

      /** One close row harvested as a trade: the bot's own timestamp, message and optional gross figure. */
      interface CosechaCierre {
        ts: number | null
        pnl: number | null
        message: string
      }

      const tsDe = (match: RegExpExecArray) =>
        new Date(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
          Number(match[7]),
        ).getTime()

      const nivelError = (texto: string): Trading.LogLevel => {
        if (!/^Error /.test(texto)) return /Traceback|Exception/.test(texto) ? "error" : "info"
        // IB connection notes (1100 gone, 1101 reconnecting, 1102 reconnected) are routine
        // during TWS flaps; any other API error is a real fault.
        return /^(1100|1101|1102)/.test(texto.slice(6)) ? "warning" : "error"
      }

      /** Splits a bot's chunk into lifecycle beats in order, harvesting the bot's unrealized
       * PnL from the portfolio dumps (live bots only, so dead systems keep their own session
       * result) and its closed-trade result from FUERA rows. Timestamp-less rows are either
       * indented traceback continuations (they glue to the beat above) or plain lifecycle
       * notes that timestamp on arrival. */
      const parsearChunk = (systemID: string, chunk: string, cosecha = true): { latidos: Latido[]; cierres: CosechaCierre[]; ultima: number | null } => {
        const latidos: Latido[] = []
        const cierres: CosechaCierre[] = []
        let ultimaTs: number | null = null
        for (const raw of chunk.split("\n")) {
          const texto = raw.trimEnd()
          if (texto === "") continue
          const match = LINEA_BOT.exec(texto)
          if (match !== null) {
            const msg = match[8]
            const ts = tsDe(match)
            ultimaTs = ts
            if (SORRO.test(msg)) {
              // These rows never reach the record, but they carry a live bot's own pnl.
              if (cosecha) {
                const cosechaPnl = /unrealizedPNL=([-+0-9.eE]+)/.exec(msg)
                const valor = cosechaPnl === null ? NaN : Number(cosechaPnl[1])
                if (Number.isFinite(valor)) pnlBots.set(systemID, valor)
              }
              continue
            }
            const sinTag = msg.replace(/^\[[^\]]+\] /, "")
            let event: Latido["event"]
            if (/DENTRO a |PROMEDIA a /.test(sinTag)) event = "open"
            else if (/FUERA|posicion cerrada/.test(sinTag)) event = "close"
            else if (/senal (COMPRA|VENTA)/.test(sinTag)) event = "signal"
            if (event === "close") {
              // The bot's own words state what the trade made; that stays its last shown pnl.
              const brutos = /\(([-+0-9.]+) USD brutos\)/.exec(sinTag)
              if (brutos !== null) pnlBots.set(systemID, Number(brutos[1]))
              // Every close row is one trade for the trade record, timestamped by the bot.
              cierres.push({ ts, pnl: brutos === null ? null : Number(brutos[1]), message: sinTag })
            }
            latidos.push({ ts, level: nivelError(sinTag), message: sinTag, event })
            continue
          }
          if (/^\s/.test(raw)) {
            // A traceback continuation: append to the beat above so an error reads whole.
            const previo = latidos[latidos.length - 1]
            if (previo !== undefined) previo.message = `${previo.message}\n${texto.trim()}`
            continue
          }
          if (CICLO.test(texto)) latidos.push({ ts: null, level: nivelError(texto), message: texto })
          else if (/Traceback|Exception/.test(texto))
            // In registro.log a traceback head follows the timestamped error row that caused
            // it; inherit that row's hour so the record keeps the fault in its true place.
            latidos.push({ ts: ultimaTs, level: "error", message: texto })
        }
        return { latidos, cierres, ultima: ultimaTs }
      }

      const runtimeNuevo = (): Runtime => ({
        source: null,
        pid: null,
        startedAt: null,
        child: null,
        planeado: false,
        registroOffset: 0,
        consolaOffset: 0,
        ultimaActividad: null,
      })

      /** The bot's latest own row: its line's own timestamp when it carries one, the arrival
       * time otherwise. Today only — the tail offsets start at today's first row, so a stopped
       * bot's activity is its latest line of the day, not its last session ever. */
      const notaActividad = (runtime: Runtime, ultima: number | null) => {
        const ts = ultima ?? Date.now()
        runtime.ultimaActividad = runtime.ultimaActividad === null ? ts : Math.max(runtime.ultimaActividad, ts)
      }

      /** The record owes itself to the current day only: the tail offset starts at today's
       * first registro.log row, so a restart never replays older sessions. */
      const offsetDeHoy = async (path: string) => {
        const contenido = await readFile(path, "utf8").catch(() => "")
        const hoy = new Date()
        const prefijo = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")} `
        const corte = contenido.indexOf(prefijo)
        return corte === -1 ? Buffer.byteLength(contenido) : Buffer.byteLength(contenido.slice(0, corte))
      }

      /** Attributes a detected bot to its system (idempotent); a fresh attach resets the day pnl. */
      const adjuntar = (def: Definicion, source: "panel" | "external", pid: number | null, nota: string) => {
        const runtime = bots.get(def.id)
        if (runtime === undefined) return
        runtime.source = source
        runtime.pid = pid
        runtime.planeado = false
        if (runtime.startedAt !== null) return
        runtime.startedAt = Date.now()
        pnlBots.delete(def.id)
        pushLog("info", def.name, nota)
      }

      /** One tick's tail: new registro.log rows become record beats, new consola.log rows
       * capture what the bot cannot say itself (tracebacks, unhandled errors). Live bots
       * also keep harvesting their unrealized pnl; dead ones no longer need it. */
      const ingestaUna = async (def: Definicion, enMarchaSolo = true) => {
        if (def.dir === null) return
        const runtime = bots.get(def.id)
        if (runtime === undefined) return
        if (enMarchaSolo && runtime.startedAt === null) return
        const cosecha = runtime.startedAt !== null
        const registro = await leerCola(`${def.dir}\\registro.log`, runtime.registroOffset)
        if (registro !== null) {
          runtime.registroOffset = registro.size
          const salida = parsearChunk(def.id, registro.chunk, cosecha)
          for (const latido of salida.latidos) {
            pushLog(latido.level, def.name, latido.message, { ts: latido.ts ?? undefined, event: latido.event })
          }
          if (salida.cierres.length > 0) registrarTrades(def.id, salida.cierres)
          if (salida.latidos.length > 0) notaActividad(runtime, salida.ultima)
        }
        const consola = await leerCola(`${def.dir}\\consola.log`, runtime.consolaOffset)
        if (consola !== null) {
          runtime.consolaOffset = consola.size
          const salida = parsearChunk(def.id, consola.chunk, cosecha)
          for (const latido of salida.latidos) {
            pushLog(latido.level, def.name, latido.message, { ts: latido.ts ?? undefined, event: latido.event })
          }
          if (salida.latidos.length > 0) notaActividad(runtime, salida.ultima)
        }
      }

      /** Records a bot's closed trades: insert-if-new into the trading_trade table (the
       * (system, ts) primary key makes a replayed log tail a no-op) and newest-first into
       * the snapshot ring, capped to the most recent 200. */
      const registrarTrades = (systemID: string, cierres: readonly CosechaCierre[]) => {
        const ahora = Date.now()
        let nueva = [...trades.value]
        for (const cierre of cierres) {
          const trade: Trading.Trade = {
            system: systemID,
            ts: cierre.ts ?? ahora,
            pnl: cierre.pnl ?? null,
            message: cierre.message,
          }
          db
            .insert(TradingTradeTable)
            .values({
              system: trade.system,
              ts: trade.ts,
              pnl: trade.pnl,
              message: trade.message,
              time_created: trade.ts,
              time_updated: trade.ts,
            })
            .onConflictDoNothing()
            .run()
          if (!nueva.some((previo) => previo.system === trade.system && previo.ts === trade.ts)) nueva.unshift(trade)
        }
        nueva = nueva.sort((a, b) => b.ts - a.ts).slice(0, 200)
        trades.value = nueva
      }

      let ultimoSondeo = 0

      /** The 45 s sweep, port of the old panel's sondeo: keeps honest state for adopted
       * (pid-less) bots, retires stale panel.pid files, and adopts bots started outside
       * the engine via their folder's panel.pid or a TWS probe with their CLIENT_ID. */
      const sondear = async (forzar = false) => {
        const ahora = Date.now()
        if (!forzar && ahora - ultimoSondeo < 45_000) return
        ultimoSondeo = ahora
        for (const def of sistemas) {
          if (def.dir === null) continue
          const runtime = bots.get(def.id)
          if (runtime !== undefined && runtime.startedAt !== null) {
            // The engine's own children watch themselves; only adopted bots need a pid check.
            if (runtime.child !== null) continue
            if (runtime.pid !== null && (await pidVivo(runtime.pid))) continue
            runtime.source = null
            runtime.pid = null
            runtime.startedAt = null
            // An adopted bot died without an exit event: wash its log tail once before the
            // record marks the fall, so its beats are not orphaned by the running-only tick.
            await ingestaUna(def, false).catch(() => undefined)
            pushLog("warning", def.name, "Bot caído · el sondeo comprobó que el proceso ya no está")
            continue
          }
          const pid = Number((await readFile(`${def.dir}\\panel.pid`, "utf8").catch(() => "")).trim()) || 0
          if (pid > 0 && (await pidVivo(pid))) {
            adjuntar(def, "panel", pid, `Bot ya en marcha · PID ${pid} (panel.pid)`)
            continue
          }
          if (pid > 0) await unlink(`${def.dir}\\panel.pid`).catch(() => undefined)
          if (def.clientId !== null && (await clientIdEnUso(host, port, def.clientId))) {
            adjuntar(def, "external", null, `Bot ya en marcha · detectado en TWS con su CLIENT_ID ${def.clientId}`)
          }
        }
      }

      /** Boot scan of the pool folder, then one forced sweep so bots already running when the
       * app opens (engine-restarted, old panel, or plain console) show up immediately. */
      const escanearArranque = async () => {
        const carpetas = await escanearCarpetas(sistemasDir)
        if (carpetas.length === 0) {
          pushLog("warning", "motor", `No encontré carpetas de sistemas en ${sistemasDir}`)
          return
        }
        sistemas = await Promise.all(carpetas.map((name) => definicion(name, sistemasDir)))
        // Config warnings at boot: a shared CLIENT_ID would have TWS reject the second bot,
        // and a config that points at another port runs outside the engine's own watch —
        // the sweep would neither see nor adopt a bot connecting over there.
        const porCliente = new Map<number, string[]>()
        for (const def of sistemas) {
          if (def.clientId === null) continue
          const lista = porCliente.get(def.clientId) ?? []
          lista.push(def.name)
          porCliente.set(def.clientId, lista)
        }
        for (const [clientId, names] of porCliente) {
          if (names.length > 1) pushLog("warning", "motor", `CLIENT_ID ${clientId} compartido por ${names.join(", ")} · TWS rechazaría al segundo`)
        }
        for (const def of sistemas) {
          if (def.servidor !== null && def.servidor !== `${host}:${port}`)
            pushLog("warning", def.name, `config.py apunta a ${def.servidor} · el motor vigila ${host}:${port}`)
        }
        const rutaPythonw = spawnSync("where", ["pythonw"], { timeout: 5_000, windowsHide: true })
        const primera = rutaPythonw.stdout?.toString().split(/\r?\n/)[0]?.trim() ?? ""
        if (primera !== "") pythonwEjecutable = primera
        pushLog("info", "motor", `Pool de sistemas cargado desde ${sistemasDir} (${sistemas.length} sistemas)`)
        await Promise.all(
          sistemas.map(async (def) => {
            if (def.dir === null) return
            const runtime = runtimeNuevo()
            runtime.registroOffset = await offsetDeHoy(`${def.dir}\\registro.log`)
            runtime.consolaOffset = await cola(`${def.dir}\\consola.log`)
            bots.set(def.id, runtime)
          }),
        )
        // Adopt anything already running first, then seed every bot's record with its full
        // day, even dead ones: a bot that closed its position and stopped at 10am must still
        // show its history after an app restart. The sweep reads one config ahead (attach
        // resets the day pnl), so the boot sweep refills live bots' pnl from their own logs.
        await sondear(true)
        await Promise.all(sistemas.map((def) => ingestaUna(def, false)))
      }

      const arrancar = Effect.fn("TradingEngine.arrancar")(function* (id: string, origin: "user" | "task") {
        const def = sistemas.find((candidata) => candidata.id === id)
        if (def === undefined) return yield* new SystemNotFoundError({ systemID: id })
        const previo = bots.get(id)
        if (previo !== undefined && previo.startedAt !== null) return toSchemaSystem(def)
        if (def.dir === null) {
          pushLog("error", def.name, "El bot no se puede arrancar: la carpeta del sistema no está disponible")
          return toSchemaSystem(def)
        }
        // TWS serves one session per client id: when a session already exists for this bot's
        // own id (an externally started process the sweep hasn't adopted yet), a second spawn
        // would be rejected. Adopt the live one instead of spawning a twin, exactly what the
        // sweep does on its own beat.
        const clientId = def.clientId
        if (connected.value && clientId !== null) {
          const ocupado = yield* Effect.promise(() => clientIdEnUso(host, port, clientId))
          if (ocupado) {
            adjuntar(def, "external", null, `Bot ya en marcha · detectado en TWS con su CLIENT_ID ${clientId}`)
            return toSchemaSystem(def)
          }
        }
        // Two bots over the same instrument may well duplicate each other's positions. The
        // start itself still proceeds; its warning lands in the record beside the launch note.
        const simbolo = def.meta?.symbol
        const gemelo =
          simbolo === undefined
            ? undefined
            : sistemas.find(
                (otro) =>
                  otro.id !== id && otro.meta?.symbol === simbolo && (bots.get(otro.id)?.startedAt ?? null) !== null,
              )
        if (gemelo !== undefined)
          pushLog(
            "warning",
            def.name,
            `Dos bots sobre el mismo símbolo · ${gemelo.name} ya corre sobre ${simbolo}: puede duplicar posiciones`,
          )
        const runtime = previo ?? runtimeNuevo()
        if (previo === undefined) {
          // Tail offsets are seeded at the current day's first row, so the record keeps the
          // whole session even after a mid-day restart.
          runtime.registroOffset = yield* Effect.promise(() => offsetDeHoy(`${def.dir}\\registro.log`))
          runtime.consolaOffset = yield* Effect.promise(() => cola(`${def.dir}\\consola.log`))
        }
        const consola = yield* Effect.tryPromise({ try: () => open(`${def.dir}\\consola.log`, "a"), catch: (error) => String(error) }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              pushLog("error", def.name, `No pude abrir ${def.dir}\\consola.log: ${error}`)
              return null
            }),
          ),
        )
        if (consola === null) return toSchemaSystem(def)
        const child = spawn(pythonwEjecutable, ["bot.py"], {
          cwd: def.dir,
          env: { ...process.env, PYTHONPATH: botPythonPath },
          windowsHide: true,
          stdio: ["ignore", "ignore", consola.fd],
        })
        void consola.close().catch(() => undefined)
        child.on("error", (error) => pushLog("error", def.name, `No se pudo arrancar el bot: ${String(error)}`))
        child.on("exit", (code) => {
          const actual = bots.get(id)
          if (actual === undefined || actual.child !== child) return
          actual.child = null
          if (actual.planeado) return
          actual.source = null
          actual.pid = null
          actual.startedAt = null
          // The final tail is on disk by the time the process exits; harvest it now before
          // the tick ingests it, so the bot's closing beats reach the record in their place.
          void ingestaUna(def, false)
            .catch(() => undefined)
            .finally(() =>
              pushLog("warning", def.name, `Bot caído · el proceso terminó con código ${code ?? "desconocido"}`),
            )
        })
        runtime.child = child
        runtime.source = "panel"
        runtime.pid = child.pid ?? null
        runtime.startedAt = Date.now()
        runtime.planeado = false
        bots.set(id, runtime)
        if (child.pid !== undefined) {
          yield* Effect.promise(() => writeFile(`${def.dir}\\panel.pid`, String(child.pid)).catch(() => undefined))
        }
        pushLog(
          "info",
          def.name,
          origin === "user"
            ? `Bot arrancado por el usuario · PID ${child.pid ?? "?"} (errores en consola.log)`
            : `Bot arrancado por tarea programada · PID ${child.pid ?? "?"}`,
        )
        return toSchemaSystem(def)
      })

      const detener = Effect.fn("TradingEngine.detener")(function* (id: string, origin: StopOrigin) {
        const def = sistemas.find((candidata) => candidata.id === id)
        if (def === undefined) return yield* new SystemNotFoundError({ systemID: id })
        const runtime = bots.get(id)
        if (runtime === undefined || runtime.startedAt === null) return toSchemaSystem(def)
        if (runtime.child === null && runtime.pid === null) {
          pushLog("warning", def.name, "Bot detectado en marcha pero sin PID (externo): el panel no puede pararlo")
          return toSchemaSystem(def)
        }
        const pid = runtime.pid
        if (runtime.child !== null) {
          runtime.child.kill()
        } else if (pid !== null) {
          // The process was adopted, so the safeguard applies: only a live process whose own
          // command line is a bot is ever terminated this way (Windows reuses pids).
          const vivo = yield* Effect.promise(() => pidVivo(pid))
          if (vivo && (yield* Effect.promise(() => pidEsBot(pid)))) {
            spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true })
            if (yield* Effect.promise(() => pidVivo(pid))) {
              pushLog("error", def.name, `No se pudo terminar el proceso ${pid} con taskkill; revisa el Administrador de tareas`)
            }
          }
        }
        // The child state is dropped here, so its later exit event finds no owner and never
        // reports a fallen bot for a stop we ordered ourselves.
        runtime.child = null
        runtime.source = null
        runtime.pid = null
        runtime.startedAt = null
        runtime.planeado = false
        if (def.dir !== null) {
          yield* Effect.promise(() => unlink(`${def.dir}\\panel.pid`).catch(() => undefined))
        }
        pushLog("info", def.name, STOP_ORIGIN_MESSAGE[origin])
        return toSchemaSystem(def)
      })

      /** Stops every running bot in turn; a stop failure never blocks the rest. */
      const detenerTodos = Effect.fn("TradingEngine.detenerTodos")(function* (origin: StopOrigin) {
        const detenidos: string[] = []
        for (const def of sistemas) {
          if ((bots.get(def.id)?.startedAt ?? null) === null) continue
          yield* detener(def.id, origin).pipe(
            Effect.catch(() => Effect.succeed(toSchemaSystem(def))),
          )
          detenidos.push(def.name)
        }
        return detenidos
      })

      /** The daily-loss guard: fires once when the day P/L reaches the minus limit, stopping
       * every running bot, and stays latched until the day P/L recovers above the limit. */
      const aplicarRiesgo = Effect.gen(function* () {
        const riesgo = risk.value
        if (riesgo === null || riesgo.loss_day_limit <= 0) return
        const dia = pnl.value.day
        if (dia === null) return
        if (riesgo.triggered_at !== null) {
          if (dia > -riesgo.loss_day_limit) {
            const rearmado = { ...riesgo, triggered_at: null }
            yield* guardarRiesgo(rearmado)
            pushLog(
              "info",
              "motor",
              `Límite de pérdida rearmado · P/L del día ${dia.toFixed(2)} USD vuelve a estar por encima de -${riesgo.loss_day_limit} USD`,
            )
          }
          return
        }
        if (dia > -riesgo.loss_day_limit) return
        yield* detenerTodos("riesgo")
        const disparado = { ...riesgo, triggered_at: Date.now() }
        yield* guardarRiesgo(disparado)
        pushLog(
          "error",
          "motor",
          `Límite de pérdida diaria alcanzado · P/L del día ${dia.toFixed(2)} USD ≤ -${riesgo.loss_day_limit} USD · todo bot detenido`,
        )
      })

      const guardarRiesgo = Effect.fn("TradingEngine.guardarRiesgo")(function* (riesgo: Trading.Risk) {
        const stamp = Date.now()
        yield* db
          .insert(TradingRiskTable)
          .values({ id: "default", loss_day_limit: riesgo.loss_day_limit, triggered_at: riesgo.triggered_at, time_created: stamp, time_updated: stamp })
          .onConflictDoUpdate({
            target: TradingRiskTable.id,
            set: { loss_day_limit: riesgo.loss_day_limit, triggered_at: riesgo.triggered_at, time_updated: stamp },
          })
          .run()
          .pipe(Effect.orDie)
        risk.value = riesgo
      })

      /** One equity point every 15 s while the tick runs; only reported values are kept. */
      let equityUltima = 0
      const muestrearEquity = () => {
        const ahora = Date.now()
        if (ahora - equityUltima < 15_000) return
        equityUltima = ahora
        const punto: Trading.EquityPoint = { ts: ahora, equity: balances.value.equity, pnl_day: pnl.value.day }
        if (punto.equity === null && punto.pnl_day === null) return
        equity.value = [...equity.value, punto].slice(-1000)
      }

      /** Orders the task list newest first; the snapshot shows this exact slice. */
      const refreshTasks = Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(TradingTaskTable)
          .orderBy(desc(TradingTaskTable.time_created), desc(TradingTaskTable.run_at))
          .limit(50)
          .all()
          .pipe(Effect.orDie)
        tasks.value = rows.map(toSchemaTask)
      })

      const fmtHora = (ts: number) => {
        const fecha = new Date(ts)
        return `${String(fecha.getHours()).padStart(2, "0")}:${String(fecha.getMinutes()).padStart(2, "0")}:${String(
          fecha.getSeconds(),
        ).padStart(2, "0")}`
      }

      /** The next local wall-clock occurrence of "HH:MM" (PC clock), or null when the input lacks that shape. */
      const nextAtTime = (atTime: string | undefined, now: number) => {
        const match = atTime === undefined ? undefined : /^(\d{1,2}):(\d{2})$/.exec(atTime)
        if (!match) return null
        const hour = Number(match[1])
        const minute = Number(match[2])
        if (hour > 23 || minute > 59) return null
        const today = new Date(now)
        const due = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute).getTime()
        return due > now ? due : due + 24 * 60 * 60_000
      }

      const taskAdd = Effect.fn("TradingEngine.taskAdd")(function* (input: TaskAddInput) {
        if (input.delayMinutes !== undefined && input.atTime !== undefined)
          return yield* new InvalidTaskError({ message: "Give either delayMinutes or atTime, not both." })
        if (input.delayMinutes === undefined && input.atTime === undefined)
          return yield* new InvalidTaskError({ message: "Give delayMinutes or atTime." })
        if (input.delayMinutes !== undefined && (!Number.isFinite(input.delayMinutes) || input.delayMinutes <= 0))
          return yield* new InvalidTaskError({ message: "delayMinutes must be a positive number of minutes." })

        const now = Date.now()
        const runAt =
          input.delayMinutes !== undefined
            ? now + input.delayMinutes * 60_000
            : nextAtTime(input.atTime, now)
        if (runAt === null) return yield* new InvalidTaskError({ message: 'atTime must be a local "HH:MM" time.' })

        // Empty (or omitted) means every system; explicit IDs must all belong to the pool.
        const ids = [...new Set(input.systemIDs ?? [])]
        for (const id of ids) {
          if (!sistemas.some((candidate) => candidate.id === id)) return yield* new SystemNotFoundError({ systemID: id })
        }

        const task: Trading.Task = {
          id: Trading.TaskID.create(),
          kind: input.kind,
          system_ids: ids,
          run_at: runAt,
          status: "pending",
          resolved_at: null,
          time_created: now,
          time_updated: now,
        }
        yield* db
          .insert(TradingTaskTable)
          .values({
            id: task.id,
            kind: task.kind,
            system_ids: [...task.system_ids],
            run_at: task.run_at,
            status: task.status,
            resolved_at: null,
            time_created: task.time_created,
            time_updated: task.time_updated,
          })
          .run()
          .pipe(Effect.orDie)
        const alcance = ids.length === 0 ? "todos los sistemas" : ids.join(", ")
        pushLog(
          "info",
          "motor",
          `Tarea programada · ${input.kind === "start-systems" ? "arrancar" : "parar"} ${alcance} a las ${fmtHora(runAt)}`,
        )
        yield* refreshTasks
        return task
      })

      const taskCancel = Effect.fn("TradingEngine.taskCancel")(function* (id: Trading.TaskID) {
        const rows = yield* db.select().from(TradingTaskTable).where(eq(TradingTaskTable.id, id)).all().pipe(Effect.orDie)
        const row = rows[0]
        if (!row) return yield* new TaskNotFoundError({ taskID: id })
        if (row.status !== "pending") return yield* new InvalidTaskError({ message: "Only pending tasks can be cancelled." })
        const stamp = Date.now()
        yield* db
          .update(TradingTaskTable)
          .set({ status: "cancelled", resolved_at: stamp, time_updated: stamp })
          .where(eq(TradingTaskTable.id, id))
          .run()
          .pipe(Effect.orDie)
        pushLog("info", "motor", `Tarea cancelada · quedaba para las ${fmtHora(row.run_at)}`)
        yield* refreshTasks
        return toSchemaTask({ ...row, status: "cancelled", resolved_at: stamp, time_updated: stamp })
      })

      /** The expiry loop: marks overdue-at-boot tasks missed honestly, then fires due tasks forever. */
      const reconcileAtBoot = Effect.gen(function* () {
        const now = Date.now()
        const overdue = yield* db
          .select({ id: TradingTaskTable.id })
          .from(TradingTaskTable)
          .where(and(eq(TradingTaskTable.status, "pending"), lte(TradingTaskTable.run_at, now)))
          .all()
          .pipe(Effect.orDie)

        if (overdue.length === 0) return
        // A task that fell due while the app was closed is skipped, never fired late in a burst.
        const stamp = Date.now()
        yield* db
          .update(TradingTaskTable)
          .set({ status: "missed", resolved_at: stamp, time_updated: stamp })
          .where(and(eq(TradingTaskTable.status, "pending"), lte(TradingTaskTable.run_at, now)))
          .run()
          .pipe(Effect.orDie)
        pushLog(
          "warning",
          "motor",
          `${overdue.length} tarea(s) programada(s) vencida(s) con la app cerrada · marcada(s) no ejecutada(s)`,
        )
        yield* refreshTasks
      })

      const tick = Effect.fn("TradingEngine.tick")(function* () {
        // Bots first: one tail pass of every running bot's record, plus the 45 s state sweep.
        yield* Effect.promise(() => Promise.all(sistemas.filter((def) => def.dir !== null).map((def) => ingestaUna(def))))
        yield* Effect.promise(() => sondear())
        yield* Effect.sync(muestrearEquity)
        yield* aplicarRiesgo
        const due = yield* db
          .select()
          .from(TradingTaskTable)
          .where(and(eq(TradingTaskTable.status, "pending"), lte(TradingTaskTable.run_at, Date.now())))
          .all()
          .pipe(Effect.orDie)
        if (due.length === 0) return
        for (const row of due) {
          for (const id of row.system_ids.length === 0 ? sistemas.map((system) => system.id) : row.system_ids) {
            // IDs are validated at creation, so a fault here can only mean a drifted pool; the task still finishes.
            yield* (row.kind === "start-systems" ? arrancar(id, "task") : detener(id, "task")).pipe(
              Effect.catch((error) =>
                Effect.sync(() =>
                  error._tag === "TradingEngine.SystemNotFound"
                    ? pushLog("error", "motor", `Tarea con sistema desconocido (${error.systemID})`)
                    : pushLog("error", "motor", `Tarea fallida en el sistema ${id}: ${error.message}`),
                ),
              ),
            )
          }
          const stamp = Date.now()
          yield* db
            .update(TradingTaskTable)
            .set({ status: "ran", resolved_at: stamp, time_updated: stamp })
            .where(eq(TradingTaskTable.id, row.id))
            .run()
            .pipe(Effect.orDie)
        }
        yield* refreshTasks
      })

      /** An IB request turned into an outcome; a transport failure is a result, not a defect. */
      type ResultadoIb<T> = { ok: true; value: T } | { ok: false; error: string }
      const pedirLe = <T>(run: () => Promise<T>): Effect.Effect<ResultadoIb<T>> =>
        Effect.tryPromise({ try: run, catch: (error) => String(error) }).pipe(
          Effect.map((value) => ({ ok: true as const, value })),
          Effect.catch((error) => Effect.succeed({ ok: false as const, error: String(error) })),
        )

      const TERMINACIONES: ReadonlySet<string> = new Set([
        "Filled",
        "Cancelled",
        "ApiCancelled",
        "Inactive",
      ])

      const estadoDeOrden = (orderId: number): string | undefined => ordenesIds.get(orderId)?.status

      const llenadoDeOrden = (orderId: number): number => {
        const estado = ordenesIds.get(orderId)
        return estado && Number.isFinite(estado.filled) ? estado.filled : 0
      }

      /** One full close cycle against one open position; the single close and the emergency
       * close-all both run this. Position contracts arrive lean — often without a real
       * exchange, which futures reject with error 200 — so before ordering, a definition
       * without a direct exchange is re-resolved by conId, the very repair the emergency
       * script (cierralotodo.py) proved live against TWS. */
      const cerrarUna = Effect.fn("TradingEngine.cerrarUna")(function* (posicion: Trading.Position) {
        const symbol = posicion.symbol
        if (!connected.value) {
          pushLog("warning", "motor", `Cierre de ${symbol} · sin conexión con TWS, no se envió el cierre`)
          return { ok: false, message: "Sin conexión con TWS: no se envió el cierre." }
        }
        const cuenta = accountId.value
        if (!(posicion.size > 0)) return { ok: false, message: `La posición ${symbol} no tiene cantidad que cerrar.` }
        let contrato = contratos.value.get(symbol)
        if (!contrato || contrato.conId === undefined) {
          return { ok: false, message: `No tengo el contrato completo de ${symbol}: refresca la posición y reintenta.` }
        }
        const conId = contrato.conId
        if (!contrato.exchange || contrato.exchange === "SMART") {
          const base = contrato
          const resuelto = yield* pedirLe(async () => {
            const detalles = await ib.getContractDetails({
              conId: base.conId,
              symbol: base.symbol,
              secType: base.secType,
              lastTradeDateOrContractMonth: base.lastTradeDateOrContractMonth,
              strike: base.strike,
              right: base.right,
              multiplier: base.multiplier,
              currency: base.currency,
              exchange: "",
            })
            return detalles.find((detalle) => detalle.contract.conId === base.conId)?.contract
          })
          if (!resuelto.ok) {
            return { ok: false, message: `No se pudo completar la definición de ${symbol}: ${resuelto.error}` }
          }
          if (!resuelto.value || resuelto.value.conId === undefined) {
            return { ok: false, message: `TWS no devolvió la definición completa de ${symbol}: ciérrala desde TWS.` }
          }
          contrato = resuelto.value
        }
        const accion = posicion.side === "long" ? OrderAction.SELL : OrderAction.BUY
        const cantidad = posicion.size

        // A stray stop or target could fill after the close and reopen the opposite position,
        // so the contract's own open orders go first — the old dashboard's same rule. Orders
        // owned by other API clients cannot be cancelled from here; leftovers abort the close.
        const activasDeEste = (orden: OpenOrder) =>
          orden.contract.conId === conId && !TERMINACIONES.has(orden.orderStatus?.status ?? orden.orderState.status)
        const leidas = yield* pedirLe(() => ib.getAllOpenOrders())
        if (!leidas.ok) return { ok: false, message: `No se pudieron leer las órdenes abiertas: ${leidas.error}` }
        const pendientes = leidas.value.filter(activasDeEste)
        let canceladas = 0
        if (pendientes.length > 0) {
          for (const orden of pendientes) ib.cancelOrder(orden.orderId)
          yield* Effect.sleep(500)
          const releidas = yield* pedirLe(() => ib.getAllOpenOrders())
          if (!releidas.ok) {
            return { ok: false, message: `No se pudo verificar la cancelación: ${releidas.error}` }
          }
          const restantes = releidas.value.filter(activasDeEste)
          if (restantes.length > 0) {
            pushLog(
              "error",
              "motor",
              `Cierre de ${symbol} · quedan ${restantes.length} orden(es) abiertas del contrato, no se envió orden alguna`,
            )
            return {
              ok: false,
              message: `No se cerró: quedan ${restantes.length} orden(es) abiertas en ${symbol}. Cancélalas en TWS y reintenta.`,
            }
          }
          canceladas = pendientes.length
        }
        const extra = canceladas > 0 ? ` · ${canceladas} orden(es) cancelada(s)` : ""

        // The close itself: the opposite side, full size, allowed outside regular hours.
        const ordenMercado: Order = {
          action: accion,
          totalQuantity: cantidad,
          orderType: OrderType.MKT,
          tif: TimeInForce.DAY,
          orderRef: "escritorio-cierre",
          outsideRth: true,
          account: cuenta ?? undefined,
        }

        let idMercado: number | undefined
        let errorMercado = ""
        const salida = yield* pedirLe(() => ib.placeNewOrder(contrato, ordenMercado))
        if (salida.ok) idMercado = salida.value
        else errorMercado = salida.error
        let estadoMercado: string | undefined = undefined

        // TWS usually judges an order instantly, but the margin lets a rejection or a fill arrive.
        for (let paso = 0; idMercado !== undefined && paso < 15; paso++) {
          estadoMercado = estadoDeOrden(idMercado)
          if (estadoMercado !== undefined && TERMINACIONES.has(estadoMercado)) break
          yield* Effect.sleep(100)
        }
        if (idMercado !== undefined) estadoMercado = estadoDeOrden(idMercado)

        const veredictoCierre = (mensaje: string, nivel: Trading.LogLevel) => {
          pushLog(nivel, "motor", `Cierre de ${symbol}${extra} · ${mensaje}`)
        }
        if (estadoMercado === "Filled") {
          veredictoCierre(`ejecutado · ${accion} ${cantidad} (orden ${idMercado})`, "info")
          return {
            ok: true,
            message: `Cierre ejecutado: ${accion} ${cantidad} ${symbol} (orden ${idMercado})${extra}.`,
          }
        }

        // The market order is still alive (typically the market is closed): the OCA limits can
        // only go out once the cancellation is confirmed, or both could fill and open an opposite
        // position.
        if (idMercado !== undefined && estadoMercado !== undefined && !TERMINACIONES.has(estadoMercado)) {
          ib.cancelOrder(idMercado)
          for (let paso = 0; paso < 20; paso++) {
            estadoMercado = estadoDeOrden(idMercado)
            if (estadoMercado === "Filled") {
              veredictoCierre(`la orden a mercado acabó cubriendo la posición (orden ${idMercado})`, "info")
              return {
                ok: true,
                message: `Cierre ejecutado: orden ${idMercado} de ${symbol}.`,
              }
            }
            if (estadoMercado !== undefined && TERMINACIONES.has(estadoMercado)) break
            yield* Effect.sleep(100)
          }
          estadoMercado = estadoDeOrden(idMercado)
          if (estadoMercado !== "Filled" && (estadoMercado === undefined || !TERMINACIONES.has(estadoMercado))) {
            veredictoCierre(
              `la orden a mercado ${idMercado} no se ejecutó y no se pudo cancelar (estado ${estadoMercado ?? "desconocido"}) · sin límites para evitar un doble cierre`,
              "error",
            )
            return {
              ok: false,
              message: `La orden a mercado de ${symbol} no se ejecutó y no se pudo cancelar (estado ${estadoMercado ?? "desconocido"}). No se enviaron límites para evitar un doble cierre; revisa Órdenes y TWS.`,
            }
          }
        }

        // The market order is done. Whatever it left open goes into two OCA limits ±1 point
        // around the last known price: one fills, the other cancels (OCA) and nothing reopens.
        const llenado = idMercado !== undefined ? llenadoDeOrden(idMercado) : 0
        const restante = cantidad - Math.min(cantidad, llenado)
        if (restante <= 0) {
          veredictoCierre("la posición quedó cerrada durante el envío", "info")
          return { ok: true, message: `La posición de ${symbol} quedó cerrada durante el envío${extra}.` }
        }
        if (posicion.current === null) {
          const motivo = errorMercado !== "" ? ` (${errorMercado})` : ` (estado ${estadoMercado ?? "desconocido"})`
          veredictoCierre(`TWS no aceptó el cierre a mercado${motivo}, sin precio actual para los límites`, "error")
          return {
            ok: false,
            message: `TWS no aceptó el cierre a mercado de ${symbol}${motivo} y no hay precio actual para calcular los límites. Reintenta cuando llegue una cotización o ciérrala en TWS.`,
          }
        }
        // One point either side of the last price, quantized to cents: every contract of the
        // pool (MNQ/M2K/MGC micros, USDJPY) ticks at a cent or more, so a ±1 point offset on
        // the real tick grid survives rounding (the old dashboard's same fallback).
        const arriba = Math.round((posicion.current + 1.0) * 100) / 100
        const abajo = Math.round((posicion.current - 1.0) * 100) / 100
        if (!(abajo > 0) || !(arriba > abajo)) {
          return {
            ok: false,
            message: `No puedo calcular dos límites válidos para ${symbol} alrededor de ${posicion.current.toFixed(2)}.`,
          }
        }
        const grupo = `cierre-${conId}-${Date.now()}`
        const salidaLimites: { price: number; id: number | undefined; error: string }[] = []
        for (const precio of [arriba, abajo]) {
          const limite: Order = {
            action: accion,
            totalQuantity: restante,
            orderType: OrderType.LMT,
            lmtPrice: precio,
            tif: TimeInForce.GTC,
            orderRef: "escritorio-cierre-limite",
            outsideRth: true,
            ocaGroup: grupo,
            ocaType: 1,
            account: cuenta ?? undefined,
          }
          const salio = yield* pedirLe(() => ib.placeNewOrder(contrato, limite))
          if (salio.ok) salidaLimites.push({ price: precio, id: salio.value, error: "" })
          else {
            salidaLimites.push({ price: precio, id: undefined, error: salio.error })
            pushLog("error", "motor", `Cierre de ${symbol} · TWS rechazó el límite ${precio.toFixed(2)}: ${salio.error}`)
          }
        }
        yield* Effect.sleep(500)
        const destinoMercado = errorMercado !== "" ? ` (${errorMercado})` : ` (estado ${estadoMercado ?? "desconocido"})`
        const aceptados = salidaLimites.filter(
          (intento) => intento.id !== undefined && !(estadoDeOrden(intento.id) !== undefined && TERMINACIONES.has(estadoDeOrden(intento.id) as string)),
        )
        const rechazados = salidaLimites.filter((intento) => !aceptados.includes(intento))
        if (aceptados.length === 0 && !rechazados.some((intento) => intento.id !== undefined)) {
          veredictoCierre(`el cierre a mercado falló${destinoMercado} y TWS tampoco aceptó los límites`, "error")
          return { ok: false, message: `El cierre a mercado de ${symbol} falló${destinoMercado} y TWS tampoco aceptó los límites. Revisa Órdenes y TWS.` }
        }
        if (aceptados.length === 0) {
          const estados = rechazados
            .map((intento) => `${intento.price.toFixed(2)}: ${intento.error !== "" ? intento.error : estadoDeOrden(intento.id as number)}`)
            .join(", ")
          veredictoCierre(`el cierre a mercado falló${destinoMercado}; límites rechazados (${estados})`, "error")
          return { ok: false, message: `El cierre a mercado de ${symbol} falló${destinoMercado} y TWS tampoco aceptó los límites (${estados}). Revisa Órdenes y TWS.` }
        }
        const precios = aceptados.map((intento) => intento.price.toFixed(2)).join(" y ")
        const ids = aceptados.map((intento) => String(intento.id)).join(", ")
        if (aceptados.length === 1) {
          veredictoCierre(
            `el cierre a mercado falló${destinoMercado}; enviado un límite ${accion} ${restante} a ${precios} GTC (orden ${ids})`,
            "warning",
          )
          return {
            ok: true,
            message: `El cierre a mercado falló${destinoMercado}; enviado un límite ${accion} ${restante} ${symbol} a ${precios} GTC (orden ${ids}). Revisa Órdenes.`,
          }
        }
        veredictoCierre(
          `el cierre a mercado falló${destinoMercado}; enviados 2 límites OCA ${accion} ${restante} a ${precios} (${ids}), uno cancela al otro`,
          "warning",
        )
        return {
          ok: true,
          message: `El cierre a mercado falló${destinoMercado}; enviados 2 límites OCA ${accion} ${restante} ${symbol} a ${precios} GTC (órdenes ${ids}). Uno cancela al otro. Revisa Órdenes.`,
        }
      })

      const closePosition = Effect.fn("TradingEngine.closePosition")(function* (symbol: string) {
        const posicion = positions.value.find((candidata) => candidata.symbol === symbol)
        if (!posicion) return { ok: false, message: `La posición ${symbol} ya no está abierta.` }
        return yield* cerrarUna(posicion)
      })

      /** The emergency close-all, ported from the script that rescued a stuck position: every
       * open position runs the full cycle in turn, one failure never stops the rest, and the
       * verdict lists each symbol's outcome for manual follow-up. */
      const closeAllPositions = Effect.fn("TradingEngine.closeAllPositions")(function* () {
        if (!connected.value) {
          pushLog("warning", "motor", "Cierre total · sin conexión con TWS, no se envió el cierre")
          return { ok: false, message: "Sin conexión con TWS: no se envió el cierre." }
        }
        const objetivo = positions.value.filter((pos) => pos.size > 0)
        if (objetivo.length === 0) {
          pushLog("info", "motor", "Cierre total · no hay posiciones abiertas")
          return { ok: true, message: "No hay posiciones abiertas: nada que cerrar." }
        }
        const nombres = objetivo.map((pos) => pos.symbol).join(", ")
        pushLog("warning", "motor", `Cierre total · procesando ${objetivo.length} posición(es): ${nombres}`)
        const veredictos: { symbol: string; ok: boolean; message: string }[] = []
        for (const posicion of objetivo) {
          const salida = yield* cerrarUna(posicion)
          veredictos.push({ symbol: posicion.symbol, ok: salida.ok, message: salida.message })
        }
        const planos = veredictos.map((veredicto) => veredicto.message).join(" ")
        const fallos = veredictos.filter((veredicto) => !veredicto.ok)
        if (fallos.length === 0) {
          pushLog("info", "motor", `Cierre total · ${objetivo.length} posición(es) transmitida(s) a TWS`)
          return { ok: true, message: `Cierre total de ${objetivo.length} posición(es): ${planos}` }
        }
        pushLog(
          "error",
          "motor",
          `Cierre total · ${fallos.length} de ${objetivo.length} posición(es) quedaron sin cerrar: ${fallos.map((veredicto) => veredicto.symbol).join(", ")}`,
        )
        return {
          ok: false,
          message: `Cierre total: ${fallos.length} de ${objetivo.length} posición(es) quedaron sin cerrar (${
            fallos.map((veredicto) => veredicto.symbol).join(", ")
          }). ${planos}`,
        }
      })

      /** The panic button: every running bot stops (the same pid-guarded kill path the user's
       * stop takes) and then the emergency close-all runs over the open positions. The
       * systems' active flags stay off; re-arming is the user's own reactivation. */
      const panic = Effect.fn("TradingEngine.panic")(function* () {
        pushLog("warning", "motor", "Pánico · deteniendo todo bot en marcha y limpiando las posiciones abiertas")
        const detenidos = yield* detenerTodos("panic")
        const guarda = risk.value
        if (guarda !== null && guarda.triggered_at === null) {
          // A manual panic pins the guard's same stop state, so a bot restarted by a pending
          // task cannot quietly re-open the day's wound.
          yield* guardarRiesgo({ ...guarda, triggered_at: Date.now() })
          pushLog("info", "motor", "Pánico · límite de pérdida marcado como disparado hasta que el P/L del día recupere")
        }
        const cierre = yield* closeAllPositions()
        const resumen = `Pánico: ${detenidos.length} bot(s) detenido(s). ${cierre.message}`
        pushLog("warning", "motor", resumen)
        return { stopped: detenidos, close: cierre, message: resumen }
      })

      const riskUpdate = Effect.fn("TradingEngine.riskUpdate")(function* (input: RiskUpdateInput) {
        if (!Number.isFinite(input.loss_day_limit) || input.loss_day_limit < 0)
          return yield* new InvalidTaskError({ message: "lossDayLimit must be a non-negative number of USD." })
        const guarda = risk.value
        const riesgo: Trading.Risk = {
          loss_day_limit: input.loss_day_limit,
          triggered_at: guarda === null ? null : guarda.triggered_at,
        }
        yield* guardarRiesgo(riesgo)
        pushLog(
          "info",
          "motor",
          riesgo.loss_day_limit === 0
            ? "Límite de pérdida diaria desactivado"
            : `Límite de pérdida diaria fijado a ${riesgo.loss_day_limit} USD`,
        )
        return riesgo
      })

      yield* Effect.promise(() => escanearArranque())

      const run: Effect.Effect<never> = reconcileAtBoot.pipe(
        Effect.andThen(Effect.forever(tick().pipe(Effect.andThen(Effect.sleep("5 seconds"))))),
      )

      /** The account view of the last received IBKR values (null until an account id arrives). */
      const toSchemaAccount = (): Trading.Account | null =>
        accountId.value === null
          ? null
          : {
              id: accountId.value,
              type: `${accountType.value ?? "cuenta"} · IBKR demo (${port})`,
              cash: balances.value.cash,
              equity: balances.value.equity,
              pnl_day: pnl.value.day,
              pnl_realized: pnl.value.realized,
            }

      return {
        snapshot: () => ({
          version: VERSION,
          connected: connected.value,
          account: toSchemaAccount(),
          systems: sistemas.map(toSchemaSystem),
          positions: [...positions.value],
          logs: [...logs.value],
          tasks: [...tasks.value],
          trades: [...trades.value],
          equity: [...equity.value],
          risk: risk.value === null ? { loss_day_limit: DEFAULT_LOSS_DAY_LIMIT, triggered_at: null } : { ...risk.value },
        }),
        activate: (systemID) => arrancar(systemID, "user"),
        pause: (systemID) => detener(systemID, "user"),
        closePosition,
        closeAllPositions,
        connect: () => connect,
        disconnect: () => disconnect,
        panic,
        riskUpdate,
        taskList: () => Effect.gen(function* () { if (tasks.value.length === 0) yield* refreshTasks; return [...tasks.value] }),
        taskAdd,
        taskCancel,
        run,
      } satisfies Interface
    }),
  )

export const engineLayer = layer()

export const node = makeGlobalNode({ service: Service, layer: engineLayer, deps: [Database.node] })
