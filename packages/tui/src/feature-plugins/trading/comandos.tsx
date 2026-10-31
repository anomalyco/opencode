/** @jsxImportSource @opentui/solid */
// Capa de comandos ("Trading" en la paleta con ctrl+p, slash /trading, /bots,
// /cuenta…) y atajos: ctrl+alt+t abre/cierra, alt+1..4 pestañas, alt+j/k
// selección y alt+s arranca/para con confirmación. Escrituras siempre piden
// confirmación al usuario antes de salir del TUI.

import type { Context } from "@opencode/plugin/tui/context"
import type { SnapshotMotor } from "./motor"
import { ordenBot, refrescarAhora } from "./motor"
import { formatoUSD, estadoMotor } from "./estilo"
import { type Controles, type Pestaña } from "./panel"

const RUTA = "trading"

interface Props {
  readonly context: Context
  readonly snapshot: SnapshotMotor
  readonly controles: Controles
}

export function Comandos(props: Props) {
  const panelAbierto = () => props.context.ui.panel.current()?.name === RUTA
  const enPágina = () => {
    const actual = props.context.ui.router.current()
    return actual.type === "plugin" && actual.name === RUTA
  }
  const visible = () => panelAbierto() || enPágina()

  const abrir = (pestaña?: Pestaña) => {
    if (pestaña !== undefined) void props.controles.fijarPestaña(pestaña)
    props.context.ui.dialog.clear()
    if (props.context.ui.panel.open(RUTA)) return
    props.context.ui.router.navigate({
      type: "plugin",
      name: RUTA,
      data: { retorno: props.context.ui.router.current() },
    })
  }

  const cerrar = () => {
    if (panelAbierto()) {
      props.context.ui.panel.close()
      return
    }
    if (!enPágina()) return
    props.context.ui.router.navigate({ type: "home" })
  }

  const sistemaSeleccionado = () => props.snapshot.bots[props.controles.cursor.sistema]

  const moverCursor = (paso: number) => {
    const total = props.snapshot.bots.length
    if (total === 0) return
    props.controles.cursor.sistema = (props.controles.cursor.sistema + paso + total) % total
  }

  const alternarSistema = async () => {
    const bot = sistemaSeleccionado()
    if (bot === undefined) {
      props.context.ui.toast.show({ title: "Trading", message: "Selecciona un sistema (alt+j / alt+k).", variant: "info" })
      return
    }
    if (!props.snapshot.enlace) {
      props.context.ui.toast.show({
        title: "Trading",
        message: `Motor sin enlace: no se puede ${bot.activo ? "parar" : "arrancar"} ${bot.nombre} ahora.`,
        variant: "warning",
      })
      return
    }
    const acción = bot.activo ? "parar" : "arrancar"
    const confirmó = await props.context.ui.dialog.confirm({
      title: acción === "parar" ? "Parar sistema" : "Arrancar sistema",
      message: `${bot.nombre} · ${bot.simbolo} ${bot.temporalidad}\n¿${acción === "parar" ? "Detener" : "Poner"} el sistema ahora en ${props.snapshot.cuenta.id}?`,
      label: { confirm: acción === "parar" ? "Parar" : "Arrancar", cancel: "Cancelar" },
    })
    if (confirmó !== true) return
    const enviado = await ordenBot(bot.id, acción)
    refrescarAhora()
    props.context.ui.toast.show({
      title: "Trading",
      message: enviado
        ? `${acción === "parar" ? "Orden de parada" : "Orden de arranque"} enviada a ${bot.nombre}.`
        : `El Motor no pudo atender la orden sobre ${bot.nombre}.`,
      variant: enviado ? "success" : "error",
    })
  }

  const resumen = () => {
    const estado = estadoMotor(props.context, props.snapshot)
    const activos = props.snapshot.bots.filter((bot) => bot.activo).length
    props.context.ui.toast.show({
      title: estado.texto,
      message: `${props.snapshot.cuenta.id} · P/L día ${formatoUSD.format(props.snapshot.cuenta.pnl_dia)} · sistemas ${activos}/${props.snapshot.bots.length} · ${props.snapshot.posiciones.length} posición(es)`,
      variant: props.snapshot.enlace ? "info" : "warning",
    })
  }

  props.context.keymap.layer(() => ({
    commands: [
      {
        id: "trading.abrir",
        title: "Trading: abrir panel",
        description: "Cuenta, sistemas, posiciones y registro del Desk Bot",
        group: "Trading",
        palette: true,
        suggested: () => !visible(),
        slash: { name: "trading" },
        bind: "ctrl+alt+t",
        run() { abrir() },
      },
      {
        id: "trading.cerrar",
        title: "Trading: cerrar panel",
        group: "Trading",
        palette: true,
        bind: false,
        enabled: () => visible(),
        run() { cerrar() },
      },
      {
        id: "trading.resumen",
        title: "Trading: resumen rápido",
        group: "Trading",
        palette: true,
        bind: false,
        run() { resumen() },
      },
      {
        id: "trading.pestaña.cuenta",
        title: "Trading: pestaña Cuenta",
        group: "Trading",
        palette: true,
        slash: { name: "cuenta" },
        bind: "alt+1",
        enabled: () => visible(),
        run() { abrir("cuenta") },
      },
      {
        id: "trading.pestaña.sistemas",
        title: "Trading: pestaña Sistemas",
        group: "Trading",
        palette: true,
        slash: { name: "bots" },
        bind: "alt+2",
        enabled: () => visible(),
        run() { abrir("sistemas") },
      },
      {
        id: "trading.pestaña.posiciones",
        title: "Trading: pestaña Posiciones",
        group: "Trading",
        palette: true,
        bind: "alt+3",
        enabled: () => visible(),
        run() { abrir("posiciones") },
      },
      {
        id: "trading.pestaña.registro",
        title: "Trading: pestaña Registro",
        group: "Trading",
        palette: true,
        bind: "alt+4",
        enabled: () => visible(),
        run() { abrir("registro") },
      },
      {
        id: "trading.sistema.abajo",
        title: "Sistemas: selección siguiente",
        group: "Trading",
        palette: true,
        bind: "alt+k",
        enabled: () => visible() && props.controles.pestaña.actual === "sistemas",
        run() { moverCursor(1) },
      },
      {
        id: "trading.sistema.arriba",
        title: "Sistemas: selección anterior",
        group: "Trading",
        palette: true,
        bind: "alt+j",
        enabled: () => visible() && props.controles.pestaña.actual === "sistemas",
        run() { moverCursor(-1) },
      },
      {
        id: "trading.sistema.alternar",
        title: "Sistemas: arrancar/parar selección",
        group: "Trading",
        palette: true,
        slash: { name: "sistema" },
        bind: "alt+s",
        enabled: () => visible() && props.controles.pestaña.actual === "sistemas",
        run() { void alternarSistema() },
      },
    ],
  }))

  return null
}
