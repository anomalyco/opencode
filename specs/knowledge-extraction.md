---
created: 2025-12-04
source_sessions:
  - ses_51767658fffeSfJP0Ef3OZ3gyo
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
| `src/session/export.ts`                      | `SessionExport.toMarkdown()` and `writeToFile()` for transcript export                                                     |
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
