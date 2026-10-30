// Conexión con el "Motor" de trading: un proceso Python local (IBKR) que
// publica HTTP en 127.0.0.1:8735 y MCP stdio para el agente. El plugin solo
// LEE por HTTP; las escrituras (arrancar/parar bots) pasan por el Motor y así
// quedas cubiertas por el flujo de permisos de OpenCode cuando las pida el
// agente por MCP.

export interface CuentaInfo {
  readonly id: string
  readonly tipo: string
  readonly efectivo: number
  readonly patrimonio: number
  readonly pnl_dia: number
  readonly pnl_realizado: number
}

export interface BotInfo {
  readonly id: string
  readonly nombre: string
  readonly activo: boolean
  readonly simbolo: string
  readonly temporalidad: string
  readonly pnl_dia: number
}

export interface PosicionInfo {
  readonly simbolo: string
  readonly lado: "largo" | "corto"
  readonly tamano: number
  readonly entrada: number
  readonly actual: number
  readonly pnl: number
  readonly pnl_pct: number
}

export interface RegistroInfo {
  readonly ts: number
  readonly nivel: "info" | "aviso" | "error"
  readonly bot: string
  readonly mensaje: string
}

export interface SnapshotMotor {
  /** true cuando el Motor responde por HTTP. */
  enlace: boolean
  /** true mientras solo haya datos de muestra (Motor nunca conectado). */
  demo: boolean
  motor: { version: string }
  cuenta: CuentaInfo
  bots: BotInfo[]
  posiciones: PosicionInfo[]
  registros: RegistroInfo[]
}

/** URL local del Motor (v1 fija). */
export const MOTOR_URL = "http://127.0.0.1:8735"

// ----------------------------- datos de muestra -----------------------------
// Pool real del usuario: cuenta DUT141214 (paper), posición MNQZ6, 15 sistemas
// en la cuenta demo. Se muestran hasta que el Motor responde una primera vez.

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
  bots: [
    { id: "01", nombre: "01_nasdaq_apertura_alcista", activo: true, simbolo: "NQ", temporalidad: "5m", pnl_dia: 12.5 },
    { id: "02", nombre: "02_nasdaq_ruptura_media_hora", activo: false, simbolo: "NQ", temporalidad: "30m", pnl_dia: 0 },
    { id: "03", nombre: "03_nasdaq_impulso_con_tendencia", activo: false, simbolo: "NQ", temporalidad: "15m", pnl_dia: 0 },
    { id: "04", nombre: "04_oro_rebote_del_viernes", activo: false, simbolo: "GC", temporalidad: "30m", pnl_dia: 0 },
    { id: "05", nombre: "05_oro_fuerza_de_madrugada", activo: false, simbolo: "GC", temporalidad: "15m", pnl_dia: 0 },
    { id: "06", nombre: "06_nasdaq_pullback", activo: true, simbolo: "NQ", temporalidad: "1h", pnl_dia: -40 },
    { id: "07", nombre: "07_oro_nube_ichimoku", activo: false, simbolo: "GC", temporalidad: "1h", pnl_dia: 0 },
    { id: "08", nombre: "08_russell_estocastico_h2", activo: false, simbolo: "RTY", temporalidad: "2h", pnl_dia: 0 },
    { id: "09", nombre: "09_russell_cci_tendencia", activo: false, simbolo: "RTY", temporalidad: "1h", pnl_dia: 0 },
    { id: "10", nombre: "10_russell_estocastico_h4", activo: false, simbolo: "RTY", temporalidad: "4h", pnl_dia: 0 },
    { id: "11", nombre: "11_usdjpy_ruptura_bollinger", activo: false, simbolo: "JPY", temporalidad: "1h", pnl_dia: 0 },
    { id: "12", nombre: "12_usdjpy_ruptura_keltner", activo: false, simbolo: "JPY", temporalidad: "1h", pnl_dia: 0 },
    { id: "13", nombre: "13_usdjpy_ruptura_donchian", activo: false, simbolo: "JPY", temporalidad: "1h", pnl_dia: 0 },
    { id: "14", nombre: "14_usdjpy_cruce_ema_10_40", activo: false, simbolo: "JPY", temporalidad: "1h", pnl_dia: 0 },
    { id: "15", nombre: "15_usdjpy_precio_ema30_h3", activo: false, simbolo: "JPY", temporalidad: "3h", pnl_dia: 0 },
  ],
  posiciones: [
    { simbolo: "MNQZ6", lado: "corto", tamano: 1, entrada: 25_150.75, actual: 25_191.3, pnl: -81.11, pnl_pct: -0.16 },
  ],
  registros: [],
}

DEMO.registros = [
  { ts: horaDemo(-90), nivel: "info", bot: "motor", mensaje: "Conexión con IBKR demo (127.0.0.1:7497)" },
  { ts: horaDemo(-80), nivel: "info", bot: "01_nasdaq_apertura_alcista", mensaje: "Arrancado · espera la apertura de Nasdaq" },
  { ts: horaDemo(-40), nivel: "info", bot: "06_nasdaq_pullback", mensaje: "Señal encontrada · espera confirmación" },
  { ts: horaDemo(-20), nivel: "aviso", bot: "10_russell_estocastico_h4", mensaje: "Mercado fuera de sesión · sin señales" },
  { ts: horaDemo(-1), nivel: "info", bot: "motor", mensaje: "Snapshot listo · 15 sistemas, 3 activos" },
]

function horaDemo(minutosAtrás: number) {
  return Date.now() - minutosAtrás * 60_000
}

// ------------------------------ ciclo de lectura ------------------------------

export type Refrescador = () => Promise<void>

const refrescoManual: { ahora: Refrescador } = { ahora: async () => undefined }

/** Coloca el refresco manual que la UI usa tras una acción de escritura. */
export function enlazarRefresco(ahora: Refrescador) {
  refrescoManual.ahora = ahora
}

/** Refresco extra fuera del temporizador (tras arrancar/parar un bot). */
export function refrescarAhora() {
  void refrescoManual.ahora()
}

/** Comprueba que el JSON del Motor trae la forma mínima que la UI consume. */
function esSnapshot(raw: unknown): raw is Omit<SnapshotMotor, "enlace" | "demo"> {
  const value = raw as SnapshotMotor
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray(value.bots) &&
    Array.isArray(value.posiciones) &&
    typeof value.cuenta === "object" &&
    value.cuenta !== null &&
    typeof value.cuenta.id === "string"
  )
}

/** Pide el snapshot al Motor. undefined cuando el Motor no está. */
export async function pedirSnapshot(): Promise<Omit<SnapshotMotor, "enlace" | "demo"> | undefined> {
  const respuesta = await fetch(`${MOTOR_URL}/snapshot`, { signal: AbortSignal.timeout(1_200) }).catch(() => undefined)
  if (respuesta === undefined || !respuesta.ok) return undefined
  const cuerpo: unknown = await respuesta.json().catch(() => undefined)
  if (!esSnapshot(cuerpo)) return undefined
  return cuerpo
}

const REFRESCO_MS = 3_000

/** Ciclo de refresco (3 s). Devuelve la parada. */
export function iniciarRefresco(setSnapshot: (mutación: (borrador: SnapshotMotor) => void) => void): () => void {
  let huboReal = false
  const refrescar: Refrescador = async () => {
    const real = await pedirSnapshot()
    if (real !== undefined) {
      huboReal = true
      setSnapshot((borrador) => {
        borrador.enlace = true
        borrador.demo = false
        borrador.motor = real.motor
        borrador.cuenta = real.cuenta
        borrador.bots = real.bots
        borrador.posiciones = real.posiciones
        borrador.registros = real.registros
      })
      return
    }
    if (huboReal) setSnapshot((borrador) => { borrador.enlace = false })
  }
  refrescoManual.ahora = refrescar
  void refrescar()
  const temporizador = setInterval(() => { void refrescar() }, REFRESCO_MS)
  return () => clearInterval(temporizador)
}

// ------------------------------ ciclo de escritura ------------------------------

/** Ordena al Motor arrancar o parar un sistema. Requiere enlace real. */
export async function ordenBot(id: string, acción: "arrancar" | "parar"): Promise<boolean> {
  const respuesta = await fetch(`${MOTOR_URL}/bots/${id}/${acción}`, {
    method: "POST",
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined)
  return respuesta !== undefined && respuesta.ok
}
