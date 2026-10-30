/** @jsxImportSource @opentui/solid */
// Sección "Trading" para OpenCode: una sección nativa más del TUI.
//
// - session.panel  → panel con pestañas Cuenta / Sistemas / Posiciones / Registro
// - session page   → pantalla completa con /trading cuando no hay sesión abierta
// - app slot       → capa de comandos (paleta, slash, atajos)
// - prompt.footer.status → pastilla de estado: punto del Motor + X/Y sistemas
//
// Los datos salen del Motor Python (IBKR) por HTTP local con datos de muestra
// de respaldo; todo el color usa tokens del tema activo.

import { Plugin } from "@opencode/plugin/tui"
import { Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { DEMO, iniciarRefresco, type SnapshotMotor } from "./motor"
import { PanelTrading, PanelTradingPágina, type Controles, type Pestaña } from "./panel"
import { Comandos } from "./comandos"
import { PastillaMotor } from "./pill"
import type { Context } from "@opencode/plugin/tui/context"

const RUTA = "trading"

/** Página a pantalla completa (usa el ancho del terminal). */
function PáginaCompleta(props: {
  readonly context: Context
  readonly snapshot: SnapshotMotor
  readonly controles: Controles
}) {
  const dimensiones = useTerminalDimensions()
  return (
    <PanelTradingPágina
      context={props.context}
      snapshot={props.snapshot}
      controles={props.controles}
      anchoTerminal={dimensiones().width}
    />
  )
}

export default Plugin.define({
  id: "trading",
  setup(context) {
    // Snapshot del Motor: en store persistente (sobrevive a reinicios; el
    // refresco escribe encima cada 3 s). Partimos de datos de muestra.
    const [snapshot, setSnapshot] = context.storage.store("trading", { initial: structuredClone(DEMO) })
    // Pestaña persistente: cambia con alt+1..4 y sobrevive al reinicio del TUI.
    const [pestaña, setPestaña] = context.storage.store("trading.pestaña", {
      initial: { actual: "cuenta" as Pestaña },
    })
    const [cursor] = context.storage.store("trading.cursor", { initial: { sistema: 0 } })

    const controles: Controles = {
      pestaña,
      fijarPestaña: (nueva) => setPestaña((borrador) => { borrador.actual = nueva }),
      cursor,
    }

    // Página a pantalla completa para /trading fuera de sesión (vista home).
    context.ui.router.register({
      name: RUTA,
      render: () => <PáginaCompleta context={context} snapshot={snapshot} controles={controles} />,
    })

    // Panel lateral de la sesión.
    context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === RUTA}>
          <PanelTrading context={context} snapshot={snapshot} controles={controles} width={panel.width} />
        </Show>
      ),
    })

    // Comandos de la paleta/slash/atajos.
    context.ui.slot({
      append: "app",
      render: () => <Comandos context={context} snapshot={snapshot} controles={controles} />,
    })

    // Pastilla de estado junto al pie del prompt.
    context.ui.slot({
      append: "prompt.footer.status",
      render: () => <PastillaMotor context={context} snapshot={snapshot} />,
    })

    // Ciclo de refresco con el Motor (HTTP local, fallback a datos de muestra).
    const pararRefresco = iniciarRefresco((m) => { void setSnapshot(m) })
    return async () => pararRefresco()
  },
})
