---
created: 2025-12-04
source_sessions:
  - ses_51767658fffeSfJP0Ef3OZ3gyo
  - ses_5175a57d2ffee9T8UI4JggxmLK
  - ses_5171dd23fffeJ0jrI7X5oRpEpR
  - ses_5170b6561ffetGAnOMJWVHx595
last_updated: 2025-12-04
---

# Knowledge Extraction Feature Architecture

## Overview

The knowledge extraction feature is triggered during session compaction (when context exceeds model limits). It extracts valuable, reusable information from sessions and persists it for future use.

## Configuration

Located in `packages/opencode/src/config/config.ts`, the compaction config schema includes:

| Option                | Type    | Default | Description                                               |
| --------------------- | ------- | ------- | --------------------------------------------------------- |
| `extract_knowledge`   | boolean | false   | Extract and persist knowledge when compacting sessions    |
| `cleanup_transcripts` | boolean | true    | Remove transcript files after extraction                  |
| `auto_load_knowledge` | boolean | false   | Automatically load all knowledge files into system prompt |

## Directory Structure

```
.opencode/
  sess/           # Session transcripts (exported before extraction)
  knowledge/      # Extracted knowledge files (*.md with frontmatter)
```

## Core Files

| File                                         | Purpose                                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/session/knowledge.ts`                   | Main orchestration - `SessionKnowledge.extract()`, `list()`, `load()`, `ensureDirectories()`, `parseKnowledgeReferences()` |
| `src/session/prompt/knowledge-extractor.txt` | System prompt defining what to extract and output format                                                                   |
| `src/session/transcript.ts`                  | `SessionTranscript.toMarkdown()` and `writeToFile()` for transcript export                                                 |
| `src/session/compaction.ts`                  | Integration point - calls knowledge extraction during compaction                                                           |
| `src/session/system.ts`                      | `SystemPrompt.knowledge()` - loads knowledge files into context                                                            |
| `src/session/prompt.ts`                      | `extractKnowledgeReferences()` - parses `<knowledge_references>` blocks from summaries                                     |
| `src/agent/agent.ts`                         | Built-in `knowledge-extractor` agent definition                                                                            |

## Flow

1. Session transcript exported to `.opencode/sess/<session-id>.md`
2. `knowledge-extractor` agent analyzes transcript
3. Knowledge saved to `.opencode/knowledge/*.md` with frontmatter
4. Knowledge file paths included in compacted summary via `<knowledge_references>` blocks
5. On future prompts, referenced files loaded into system prompt

## Knowledge-Extractor Agent

Defined in `src/agent/agent.ts` with:

- **Tools**: read, write, edit, glob, grep (task, bash, webfetch disabled)
- **Permissions**: edit allowed, bash/webfetch denied
- **Prompt**: Loaded from `knowledge-extractor.txt`

## Knowledge File Format

```markdown
---
created: YYYY-MM-DD
source_sessions:
  - <session-id>
last_updated: YYYY-MM-DD
---

# Title

Content...
```

## What Gets Extracted

- Design decisions and architectural choices
- Technical specifications and schemas
- Bug resolutions and root causes
- Codebase learnings and patterns
- User preferences and coding style

## What is NOT Extracted

- Step-by-step debugging logs
- Raw tool outputs
- Verbose code dumps
- Transient discussion
- Routine operations

## Knowledge Pre-Check Optimization

Before running full extraction, a quick LLM call determines if the transcript contains new knowledge worth extracting:

### Implementation in `knowledge.ts`

```typescript
export async function check(input: {
  transcriptPath: string
  model: { providerID: string; modelID: string }
}): Promise<{ hasNewKnowledge: boolean }>
```

- Uses `Provider.getSmallModel()` for efficiency (prefers haiku/flash models)
- Compares transcript against existing knowledge files
- Returns `true` only if there's genuinely new information

### Compaction Flow with Pre-Check

1. Export transcript to `.opencode/sess/<session-id>.md`
2. **NEW**: Run quick check - "Is there new knowledge?"
3. If `false` → skip extraction, show "No new knowledge found"
4. If `true` → proceed with full extraction

## Extraction Status Schema

The `CompactionPart` in `message-v2.ts` tracks extraction progress:

```typescript
extraction: {
  status: "checking" | "extracting" | "skipped" | "completed"
  childSessionID?: string   // For navigating to subagent session
  files?: Array<{           // Extracted knowledge files with summaries
    path: string
    summary?: string        // One-line description of what was captured/changed
  }>
  summary?: Array<{         // Real-time tool progress during extraction
    tool: string
    title?: string
  }>
}
```

### Status Flow

| Status       | Description                                 |
| ------------ | ------------------------------------------- |
| `checking`   | Running pre-check for new knowledge         |
| `extracting` | Full extraction in progress                 |
| `skipped`    | Pre-check determined no new knowledge       |
| `completed`  | Extraction finished (with or without files) |

## TUI Display Updates

The compaction display in `src/cli/cmd/tui/routes/session/index.tsx` shows:

- **Checking**: Spinner + "Checking for new knowledge..."
- **Extracting**: Spinner + "Extracting knowledge..." + tool summary list
- **Skipped**: "No new knowledge found"
- **Completed**: "Extracted N knowledge file(s)" + file list with per-file summaries

File list shown as: `∟ filename: One-line summary of changes` (path cleaned up to show just filename without .opencode/knowledge/ prefix and .md suffix)

### Files Array Defensive Guard

The `files` array in extraction data may contain invalid entries (undefined items or items without `path` property) due to corrupted session data or edge cases in knowledge extraction parsing. The TUI applies a defensive filter:

```tsx
<For each={compaction()!.extraction!.files!.filter((f) => f?.path)}>
  {(file) => (
    <text fg={theme.textMuted}>
      ∟ {file.path.replace(/^\.opencode\/knowledge\//, "").replace(/\.md$/, "")}
      {file.summary ? `: ${file.summary}` : ""}
    </text>
  )}
</For>
```

This prevents "undefined is not an object (evaluating 'file.path.replace')" errors when rendering the file list.

## SDK Regeneration Pattern

When modifying schemas in `message-v2.ts`:

1. Update the Zod schema
2. Run `cd packages/sdk/js && bun run build` to regenerate SDK
3. SDK builds from OpenAPI spec generated by `bun dev generate`
4. Both `src/gen/` and `dist/` are updated
5. Type assertions (`as`) should be avoided - regenerate SDK instead
