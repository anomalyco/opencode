# Module Technical Design: synapse-coder-reporter

See parent [technical-design.md](../../technical-design.md) for full architecture.

## Plugin structure

```typescript
// synapse-coder-reporter.ts
import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export default function plugin(input: PluginInput): Promise<Hooks> {
  // Per-session model map: sessionID → "providerID/modelID"
  const modelMap = new Map<string, string>()
  // Offline queue
  const queue = []

  return {
    async chat.message(event) {
      // Track model ID per session
      if (event.model) {
        modelMap.set(event.sessionID, `${event.model.providerID}/${event.model.modelID}`)
      }
    },

    async "tool.execute.after"(event, output) {
      // Detect LSP diagnostics after edit/write/apply_patch
      if (["edit", "write", "apply_patch"].includes(event.tool)) {
        const diagnostics = output.metadata?.diagnostics
        if (diagnostics && diagnostics.length > 0) {
          await reportCorrection({
            original: extractOriginal(event.tool, event.args),
            corrected: "",
            category: "lsp-typecheck",
            language: deriveLanguage(event.args.filePath),
            reason: formatDiagnostics(diagnostics),
            reporterModel: modelMap.get(event.sessionID) ?? "unknown",
          }, input, queue)
        }
      }
    },

    async event(event) {
      // Detect permission rejections
      if (event.type === "Permission.Event.Replied" && event.status === "rejected") {
        await reportCorrection({
          original: "",
          corrected: "",
          category: "user-rejection",
          language: deriveLanguage(event.filePath),
          reason: event.feedback ?? "user rejected",
          reporterModel: modelMap.get(event.sessionID) ?? "unknown",
        }, input, queue)
      }
    },
  }
}
```

## Hook evidence (file:line)

| Hook | File:Line | Usage |
|------|-----------|-------|
| `chat.message` | `packages/plugin/src/index.ts:234-243` | Model ID tracking |
| `tool.execute.after` | `packages/plugin/src/index.ts:274-281` | LSP diagnostics detection |
| `event` | `packages/plugin/src/index.ts:224` | Permission rejection detection |

## Report payload builder

| Field | Source | Evidence |
|-------|--------|----------|
| `original` | `input.args.newString` (edit), `input.args.content` (write), `input.args.patchText` (apply_patch) | `packages/plugin/src/index.ts:275` — `input.args` |
| `corrected` | `""` (one-sided) | N/A — next-turn fix not available in hook |
| `category` | `"lsp-typecheck"` or `"user-rejection"` | N/A |
| `language` | File extension → language map | `input.args.filePath` |
| `reason` | Formatted diagnostics or user feedback | `output.metadata.diagnostics` or `event.feedback` |
| `reporterModel` | Per-session model map | `packages/plugin/src/index.ts:237-240` — `model: { providerID, modelID }` |
