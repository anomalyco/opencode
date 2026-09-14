import { createMemo, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { Spark } from "./Spark"
import { latText, money, pctText, rateText, tok } from "../lib/format"
import type { FleetRowData, FleetSeverity } from "../fleetTypes"

const SEVERITY_COLOR: Record<FleetSeverity, string> = {
  cyan: "rgba(122,209,255,.92)",
  mid: "rgba(255,255,255,.72)",
  green: "rgba(107,230,140,.95)",
  amber: "rgba(255,194,82,.95)",
  bright: "rgba(255,255,255,.95)",
  dim: "rgba(255,255,255,.42)",
  red: "rgba(255,107,102,.95)",
}

const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"
const BRIGHT = "rgba(255,255,255,.95)"
const DIM = "rgba(255,255,255,.42)"
const GREEN = "rgba(107,230,140,.95)"
const AMBER = "rgba(255,194,82,.95)"
const CYAN = "rgba(122,209,255,.92)"

const num = (width: number) => ({
  width: `${width}px`,
  "text-align": "right" as const,
  "flex-shrink": 0,
})

export default function FleetTable(props: {
  rows: FleetRowData[]
  selectedID: string | null
  onSelect: (sessionID: string) => void
  totalSpark: number[]
  anyLive: boolean
  window: "5m" | "1h" | "24h"
}): JSX.Element {
  const language = useLanguage()
  const labels = createMemo(() => ({
    agent: language.t("agents.col.agent"),
    stage: language.t("agents.col.stage"),
    in: language.t("agents.col.in"),
    out: language.t("agents.col.out"),
    rate: language.t("agents.col.rate"),
    cache: language.t("agents.col.cache"),
    cost: language.t("agents.col.cost"),
    lat: language.t("agents.col.lat"),
    graph: `${language.t("agents.col.graph")}/${props.window}`,
    total: language.t("agents.total"),
  }))

  const head = (w: number, label: string) => (
    <span style={{ ...num(w), "text-align": "right", color: DIM, "font-size": "12px" }}>{label}</span>
  )

  return (
    <div
      role="table"
      style={{
        display: "flex",
        "flex-direction": "column",
        "min-width": "0",
        "font-family": MONO,
        "font-size": "14px",
        "font-variant-numeric": "tabular-nums",
      }}
    >
      <div
        role="row"
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "2px 8px",
          "white-space": "nowrap",
        }}
      >
        <span style={{ flex: "1 1 auto", "min-width": "0", overflow: "hidden", "text-overflow": "ellipsis", "text-align": "left", color: DIM, "font-size": "12px" }}>
          {labels().agent}
        </span>
        <span style={{ ...num(64), color: DIM, "font-size": "12px" }}>{labels().stage}</span>
        {head(56, labels().in)}
        {head(56, labels().out)}
        {head(64, labels().rate)}
        {head(56, labels().cache)}
        {head(72, labels().cost)}
        {head(64, labels().lat)}
        <span style={{ width: "96px", "flex-shrink": 0, "text-align": "left", color: DIM, "font-size": "12px" }}>{labels().graph}</span>
      </div>
      <div style={{ "overflow-y": "auto", "min-height": "0", "flex": "1 1 auto" }}>
        <For each={props.rows}>
          {(row) => (
            <div
              role="row"
              tabindex={0}
              data-session-id={row.sessionID}
              aria-selected={props.selectedID === row.sessionID}
              title={`${row.directory} · ${row.agent} · ${row.model} · ${row.stage.state}`}
              onClick={() => props.onSelect(row.sessionID)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") props.onSelect(row.sessionID)
              }}
              style={{
                display: "flex",
                "align-items": "center",
                gap: "8px",
                padding: "2px 8px",
                "white-space": "nowrap",
                cursor: "pointer",
                overflow: "hidden",
                background: props.selectedID === row.sessionID ? "rgba(122,209,255,.12)" : "transparent",
              }}
            >
              <span style={{ flex: "1 1 auto", "min-width": "0", overflow: "hidden", "text-overflow": "ellipsis", "text-align": "left", color: row.live ? GREEN : SEVERITY_COLOR.mid }}>
                {`${row.agent || "—"}/${row.directory.split("/").pop() || row.directory} · ${row.title}`}
              </span>
              <span style={{ ...num(64), "font-size": "12px", "font-weight": 700, color: SEVERITY_COLOR[row.stage.severity] }}>{row.stage.state}</span>
              <span style={{ ...num(56), color: BRIGHT }}>{tok(row.tin)}</span>
              <span style={{ ...num(56), color: BRIGHT }}>{tok(row.tout)}</span>
              <span style={{ ...num(64), color: row.tps > 0 ? GREEN : DIM }}>{rateText(row.tps)}</span>
              <span style={{ ...num(56), color: row.cachePct >= 70 ? GREEN : AMBER }}>{pctText(row.cachePct)}</span>
              <span style={{ ...num(72), color: row.priced ? CYAN : DIM }}>{row.priced ? money(row.cost) : "—"}</span>
              <span style={{ ...num(64), color: BRIGHT }}>{latText(row.lat)}</span>
              <span style={{ width: "96px", "flex-shrink": 0, "text-align": "left" }}>
                <Spark data={row.spark} live={row.live} />
              </span>
            </div>
          )}
        </For>
        <Show when={props.rows.length === 0}>
          <div style={{ padding: "4px 8px", color: DIM, "font-size": "12px" }}>—</div>
        </Show>
      </div>
      <div
        role="row"
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "2px 8px",
          "white-space": "nowrap",
          "border-top": "1px solid rgba(255,255,255,.08)",
          color: BRIGHT,
          "font-weight": 700,
        }}
      >
        <span style={{ flex: "1 1 auto", "min-width": "0", "text-align": "left" }}>{labels().total}</span>
        <span style={{ width: "96px", "flex-shrink": 0, "text-align": "left", opacity: props.anyLive ? 1 : 0.55 }}>
          <Spark data={props.totalSpark} live={props.anyLive} title={labels().graph} />
        </span>
      </div>
    </div>
  )
}
