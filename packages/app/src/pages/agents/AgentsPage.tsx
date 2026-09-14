import { createMemo, createSignal, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useFleet } from "./useFleet"
import { isEnabled, loadSplitOpen } from "./lib/persist"
import type { FleetFilterKind } from "./fleetTypes"
import FleetTable from "./components/FleetTable"
import SplitPane from "./components/SplitPane"
import DetailTabs from "./components/DetailTabs"

const WINDOWS = ["5m", "1h", "24h"] as const
const FILTERS: { key: FleetFilterKind; key_i18n: string }[] = [
  { key: "all", key_i18n: "agents.filter.all" },
  { key: "working", key_i18n: "agents.filter.working" },
  { key: "input", key_i18n: "agents.filter.input" },
  { key: "idle", key_i18n: "agents.filter.idle" },
  { key: "error", key_i18n: "agents.filter.error" },
]

export default function AgentsPage(props?: { force?: boolean }): JSX.Element {
  const language = useLanguage()
  const fleet = useFleet()
  const [enabled] = createSignal(isEnabled() || !!props?.force)
  const [splitOpen, setSplitOpen] = createSignal(loadSplitOpen())
  const [selectedID, setSelectedID] = createSignal<string | null>(null)

  const projects = createMemo(() => [...new Set(fleet.rows().map((row) => row.directory))].sort())

  const header = () => (
    <div style={{ display: "flex", "align-items": "center", gap: "12px", padding: "10px 12px", "font-family": "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace", "font-size": "14px", "white-space": "nowrap", "border-bottom": "1px solid rgba(255,255,255,.08)" }}>
      <span style={{ "font-weight": 700, color: "rgba(255,255,255,.95)" }}>{language.t("agents.title")}</span>
      <span style={{ color: fleet.anyLive() ? "rgba(107,230,140,.95)" : "rgba(255,255,255,.42)" }}>
        ●{fleet.rows().filter((row) => row.live).length} {language.t("agents.live")}
      </span>
      <span style={{ color: "rgba(255,255,255,.72)" }}>{`${fleet.out1mAll().toFixed(1)} tok/s`}</span>
      <span style={{ color: "rgba(255,255,255,.42)" }}>{`SSE ●`}</span>
      <span style={{ "margin-left": "auto", display: "inline-flex", gap: "4px" }}>
        <For each={[...WINDOWS]}>
          {(value) => (
            <button
              type="button"
              onClick={() => fleet.setWindow(value)}
              style={{
                padding: "2px 8px",
                "font-family": "inherit",
                "font-size": "12px",
                cursor: "pointer",
                "border-radius": "6px",
                border: "1px solid rgba(255,255,255,.12)",
                background: fleet.window() === value ? "rgba(255,255,255,.12)" : "transparent",
                color: fleet.window() === value ? "rgba(122,209,255,.92)" : "rgba(255,255,255,.42)",
              }}
            >
              {value}
            </button>
          )}
        </For>
      </span>
    </div>
  )

  const filters = () => (
    <div style={{ display: "flex", "align-items": "center", gap: "6px", padding: "8px 12px", "font-family": "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace", "font-size": "12px", "white-space": "nowrap" }}>
      <For each={FILTERS}>
        {(entry) => (
          <button
            type="button"
            onClick={() => fleet.setFilterKind(entry.key)}
            style={{
              padding: "2px 8px",
              "font-family": "inherit",
              cursor: "pointer",
              "border-radius": "999px",
              border: "1px solid rgba(255,255,255,.12)",
              background: fleet.filter().kind === entry.key ? "rgba(255,255,255,.12)" : "transparent",
              color: fleet.filter().kind === entry.key ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.42)",
            }}
          >
            {language.t(entry.key_i18n)}
          </button>
        )}
      </For>
      <select
        value={fleet.filter().project ?? ""}
        onChange={(event) => fleet.setProject(event.currentTarget.value || null)}
        aria-label={language.t("agents.project.all")}
        style={{ "margin-left": "auto", background: "transparent", color: "rgba(255,255,255,.72)", border: "1px solid rgba(255,255,255,.12)", "border-radius": "6px", "font-family": "inherit", "font-size": "12px", padding: "2px 6px" }}
      >
        <option value="">{language.t("agents.project.all")}</option>
        <For each={projects()}>
          {(directory) => <option value={directory}>{directory.split("/").pop() || directory}</option>}
        </For>
      </select>
    </div>
  )

  return (
    <Show
      when={enabled()}
      fallback={
        <div style={{ display: "flex", height: "100%", "align-items": "center", "justify-content": "center", color: "rgba(255,255,255,.42)", "font-family": "ui-monospace,Menlo,monospace" }}>
          {language.t("agents.disabled")}
        </div>
      }
    >
      <div style={{ display: "flex", "flex-direction": "column", height: "100%", "min-height": "0" }}>
        {header()}
        {filters()}
        <div style={{ flex: "1 1 auto", "min-height": "0" }}>
          <Show
            when={selectedID() && splitOpen()}
            fallback={<FleetTable rows={fleet.rows()} selectedID={selectedID()} onSelect={setSelectedID} totalSpark={fleet.totalSpark()} anyLive={fleet.anyLive()} window={fleet.window()} />}
          >
            <SplitPane
              selected
              table={<FleetTable rows={fleet.rows()} selectedID={selectedID()} onSelect={setSelectedID} totalSpark={fleet.totalSpark()} anyLive={fleet.anyLive()} window={fleet.window()} />}
              detail={<DetailTabs row={fleet.rows().find((row) => row.sessionID === selectedID()) ?? null} />}
            />
          </Show>
        </div>
      </div>
    </Show>
  )
}
