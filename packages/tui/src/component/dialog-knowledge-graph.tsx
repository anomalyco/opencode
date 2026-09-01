import { createMemo, createSignal, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { Glyphs } from "../ui/glyphs"

export function DialogKnowledgeGraph() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const [selectedTab, setSelectedTab] = createSignal<"memory" | "lineage" | "symbols">("memory")

  const memoryItems = [
    { id: "1", title: "Code Style: Strict Functional & Effect-TS", description: "Confidence: 98% · Synced across 12 sessions" },
    { id: "2", title: "Architecture: Clean Separation (Core → TUI → Server)", description: "Confidence: 95% · Active prior" },
    { id: "3", title: "Testing: Bun Native Test Runner (`bun test`)", description: "Confidence: 99% · 13 unit tests passed" },
    { id: "4", title: "Ergonomics: Monospace Solid Pill Badges", description: "Confidence: 100% · Flagship design token" },
  ]

  const lineageItems = [
    { id: "v1", title: "Domain General: V1 Initial Prompt", description: "Status: Base Prior · Pass rate: 84%" },
    { id: "v2", title: "Domain TypeScript/Bun: V2 Self-Evolved Prompt", description: "Status: Active Winning Prompt · Pass rate: 94%" },
    { id: "v3", title: "Domain Python: V1 Base Prior", description: "Status: Standby · Fallback ready" },
  ]

  const symbolItems = [
    { id: "s1", title: "@opencode-ai/core", description: "42 exported services & location algebra" },
    { id: "s2", title: "@opencode-ai/tui", description: "28 Solid-JS interactive views and glyphs" },
    { id: "s3", title: "@opencode-ai/personalization", description: "16 preference drift matrices and soft-attention heads" },
  ]

  const activeOptions = createMemo(() => {
    if (selectedTab() === "memory") return memoryItems.map((m) => ({ value: m.id, title: m.title, description: m.description }))
    if (selectedTab() === "lineage") return lineageItems.map((l) => ({ value: l.id, title: l.title, description: l.description }))
    return symbolItems.map((s) => ({ value: s.id, title: s.title, description: s.description }))
  })

  return (
    <DialogSelect
      title={`✦ Knowledge Graph Matrix [ Tab: ${selectedTab().toUpperCase()} ]`}
      options={activeOptions()}
      onSelect={(opt) => {
        // Switch tabs on selection or close
        if (selectedTab() === "memory") setSelectedTab("lineage")
        else if (selectedTab() === "lineage") setSelectedTab("symbols")
        else setSelectedTab("memory")
      }}
    />
  )
}
