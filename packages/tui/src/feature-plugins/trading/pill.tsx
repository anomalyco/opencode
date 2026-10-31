/** @jsxImportSource @opentui/solid */
// Pastilla de estado en el pie del prompt: punto del Motor + X/Y sistemas.
// Misma escala que las demás pastillas nativas; nada de contenedores nuevos.

import type { Context } from "@opencode/plugin/tui/context"
import type { SnapshotMotor } from "./motor"
import { estadoMotor } from "./estilo"

export function PastillaMotor(props: { context: Context; snapshot: SnapshotMotor }) {
  const estado = () => estadoMotor(props.context, props.snapshot)
  const activos = () => props.snapshot.bots.filter((bot) => bot.activo).length
  return (
    <box flexDirection="row">
      <text fg={estado().color}>●</text>
      <text fg={props.context.theme.text.muted}> {activos()}/{props.snapshot.bots.length} ▶</text>
    </box>
  )
}
