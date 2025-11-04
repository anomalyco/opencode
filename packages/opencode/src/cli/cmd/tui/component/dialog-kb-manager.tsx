import { createMemo, createSignal, onMount } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { useToast } from "@tui/ui/toast"
import { TextAttributes } from "@opentui/core"
import { loadRaidConfig, validateRaidConfig } from "@/raid/raid-config"
import { RaidKnowledgeBase } from "@/raid/raid-kb"
import type { RaidDocument } from "@/raid/raid-types"

export function DialogKbManager() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const toast = useToast()

  // Load synchronously on init
  let initialDocs: RaidDocument[] = []
  let initialStats = { total: 0, project: 0, global: 0, totalTokens: 0 }

  try {
    const config = loadRaidConfig()
    const validation = validateRaidConfig(config)
    if (validation.valid) {
      const kb = new RaidKnowledgeBase(config)
      initialDocs = kb.listDocuments({ limit: 100 })
      const kbStats = kb.getStats()
      initialStats = {
        total: kbStats.totalDocuments,
        project: kbStats.projectDocuments,
        global: kbStats.globalDocuments,
        totalTokens: kbStats.totalTokens,
      }
      kb.close()
    }
  } catch (error) {
    console.error("[DialogKbManager] Initial load failed:", error)
  }

  const [documents, setDocuments] = createSignal<RaidDocument[]>(initialDocs)
  const [stats, setStats] = createSignal(initialStats)

  onMount(() => {
    dialog.setSize("large")
  })

  function loadDocuments() {
    try {
      console.log("[DialogKbManager] Loading config...")

      const config = loadRaidConfig()
      console.log("[DialogKbManager] Config loaded, validating...")
      const validation = validateRaidConfig(config)
      console.log("[DialogKbManager] Validation result:", validation)

      if (!validation.valid) {
        toast.show({
          message: `KB config error: ${validation.errors[0]}`,
          variant: "error",
        })
        return
      }

      console.log("[DialogKbManager] Opening KB...")
      const kb = new RaidKnowledgeBase(config)
      console.log("[DialogKbManager] Listing documents...")
      const docs = kb.listDocuments({ limit: 100 })
      console.log("[DialogKbManager] Getting stats...")
      const kbStats = kb.getStats()
      kb.close()
      console.log("[DialogKbManager] Loaded", docs.length, "documents")

      setDocuments(docs)
      setStats({
        total: kbStats.totalDocuments,
        project: kbStats.projectDocuments,
        global: kbStats.globalDocuments,
        totalTokens: kbStats.totalTokens,
      })

      if (docs.length > 0) {
        toast.show({
          message: `Loaded ${docs.length} documents`,
          variant: "success",
        })
      }
    } catch (error) {
      console.error("[DialogKbManager] Failed to load documents:", error)
      toast.show({
        message: `Failed to load KB: ${error}`,
        variant: "error",
      })
    }
  }

  const options = createMemo(() => {
    return documents().map((doc) => {
      const sourceEmoji = doc.source === "project" ? "📁" : "🌍"
      const typeEmoji = {
        markdown: "📄",
        code: "💻",
        text: "📝",
        other: "📦",
      }[doc.metadata.contentType]

      return {
        value: doc.id,
        title: `${sourceEmoji} ${typeEmoji} ${doc.title}`,
        footer: `${doc.tokenCount.toLocaleString()} tokens • ${doc.tags.join(", ") || "no tags"} • ${doc.createdAt.toLocaleDateString()}`,
        category: doc.source === "project" ? "Project" : "Global",
      }
    })
  })

  async function showDocumentDetails(docId: string) {
    const doc = documents().find((d) => d.id === docId)
    if (!doc) return

    const details = `
${doc.title}

Type: ${doc.metadata.contentType}
Source: ${doc.source}
Tokens: ${doc.tokenCount.toLocaleString()}
Shards: ${doc.shardIds.length}
Tags: ${doc.tags.join(", ") || "none"}
${doc.filePath ? `File: ${doc.filePath}` : ""}

Summary:
${doc.metadata.summary || "No summary available"}

Keywords:
${doc.metadata.extractedKeywords.join(", ") || "none"}

Created: ${doc.createdAt.toLocaleString()}
Updated: ${doc.updatedAt.toLocaleString()}
    `.trim()

    toast.show({
      message: details,
      variant: "info",
    })
  }

  async function deleteDocument(docId: string) {
    const doc = documents().find((d) => d.id === docId)
    if (!doc) return

    try {
      const config = loadRaidConfig()
      const kb = new RaidKnowledgeBase(config)
      kb.deleteDocument(docId)
      kb.close()

      setDocuments((prev) => prev.filter((d) => d.id !== docId))
      toast.show({
        message: `Deleted: ${doc.title}`,
        variant: "success",
      })
    } catch (error) {
      toast.show({
        message: `Failed to delete: ${error}`,
        variant: "error",
      })
    }
  }

  async function searchDocuments(query: string) {
    if (!query.trim()) {
      await loadDocuments()
      return
    }

    try {
      const config = loadRaidConfig()
      const kb = new RaidKnowledgeBase(config)
      const results = kb.search(query, { maxResults: 50 })
      kb.close()

      setDocuments(results.map((r) => r.document))
      toast.show({
        message: `Found ${results.length} documents`,
        variant: "success",
      })
    } catch (error) {
      toast.show({
        message: `Search failed: ${error}`,
        variant: "error",
      })
    }
  }

  async function showStats() {
    const s = stats()
    const details = `
Knowledge Base Statistics

Total Documents: ${s.total}
• Project: ${s.project}
• Global: ${s.global}

Total Tokens: ${s.totalTokens.toLocaleString()}
Average: ${s.total > 0 ? Math.round(s.totalTokens / s.total).toLocaleString() : 0} tokens/doc
    `.trim()

    toast.show({
      message: details,
      variant: "info",
    })
  }

  async function clearKb(source?: "project" | "global") {
    try {
      const config = loadRaidConfig()
      const kb = new RaidKnowledgeBase(config)

      const deleted = kb.deleteAllDocuments(source)
      setDocuments((prev) => (source ? prev.filter((d) => d.source !== source) : []))

      toast.show({
        message: source ? `Cleared ${deleted} ${source} documents` : `Cleared ${deleted} documents`,
        variant: "success",
      })

      kb.close()
      await loadDocuments()
    } catch (error) {
      toast.show({
        message: `Clear failed: ${error}`,
        variant: "error",
      })
    }
  }

  if (documents().length === 0) {
    return (
      <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD}>Knowledge Base Manager</text>
          <text fg={theme.textMuted}>esc</text>
        </box>
        <box gap={1}>
          <text>No documents in knowledge base</text>
          <text fg={theme.textMuted}>Use kb-ingest tool to add documents</text>
          <box marginTop={1}>
            <text attributes={TextAttributes.BOLD}>Example:</text>
            <text fg={theme.textMuted}>kb-ingest --filePath ./docs/README.md --source project</text>
          </box>
        </box>
      </box>
    )
  }

  return (
    <DialogSelect
      title={`KB Manager (${documents().length} docs • ${stats().totalTokens.toLocaleString()} tokens)`}
      options={options()}
      limit={50}
      onSelect={(option) => {
        showDocumentDetails(option.value)
      }}
      onFilter={(query) => {
        searchDocuments(query)
      }}
      keybind={[
        {
          keybind: Keybind.parse("ctrl+i")[0],
          title: "info",
          onTrigger: async (option) => {
            await showDocumentDetails(option.value)
          },
        },
        {
          keybind: Keybind.parse("ctrl+d")[0],
          title: "delete",
          onTrigger: async (option) => {
            await deleteDocument(option.value)
          },
        },
        {
          keybind: Keybind.parse("ctrl+s")[0],
          title: "stats",
          onTrigger: async () => {
            await showStats()
          },
        },
        {
          keybind: Keybind.parse("ctrl+r")[0],
          title: "reload",
          onTrigger: async () => {
            await loadDocuments()
          },
        },
        {
          keybind: Keybind.parse("ctrl+c")[0],
          title: "clear all",
          onTrigger: async () => {
            await clearKb()
          },
        },
        {
          keybind: Keybind.parse("ctrl+p")[0],
          title: "clear project",
          onTrigger: async () => {
            await clearKb("project")
          },
        },
        {
          keybind: Keybind.parse("ctrl+g")[0],
          title: "clear global",
          onTrigger: async () => {
            await clearKb("global")
          },
        },
      ]}
    />
  )
}
