# Evolution Layer

## Tujuan

Evolution Layer adalah intelligence layer yang mengubah OpenCode dari coding
assistant menjadi AI software engineer yang mampu memahami project secara
mendalam, memiliki project memory, memahami keputusan arsitektur, dan
mempertahankan konteks jangka panjang.

## Architecture Overview

```
User Request
    |
    v
OpenCode Core (existing)
    |
    v
Evolution Layer (optional)
    |
    +-- Brain
    |     +-- Memory Service     (lessons, experiences, patterns)
    |     +-- Project Understanding (frameworks, deps, structure)
    |     +-- ADR Decision Storage (architecture decisions)
    |
    +-- Context Intelligence      (future)
    +-- Decision Engine           (future)
    +-- Agent Orchestration       (future)
    +-- Evolution System          (future)
```

## Storage Location

Data Evolution Layer disimpan di dalam project directory:

```
<project-root>/.opencode/evolution/
├── memory.json           # Lessons, experiences, patterns
├── project.json          # Cached project profile
└── adr/
    ├── ADR-XXXXXXXX-XXXX.json   # Machine-readable ADR
    ├── ADR-XXXXXXXX-XXXX.md     # Human-readable ADR
    ├── ADR-YYYYYYYY-YYYY.json
    └── ADR-YYYYYYYY-YYYY.md
```

## Evolution Modes

| Mode          | Description |
|---------------|-------------|
| **observe**   | AI membaca project context tanpa mengubah workflow. Aman untuk testing. |
| **assist**    | AI memberikan plan/architecture/review suggestions tanpa auto-execute. |
| **autonomous**| AI dapat menjalankan planning, review, dan testing workflow secara otomatis. |

## Configuration

```jsonc
// opencode.jsonc
{
  "evolution": {
    "enabled": false,    // default: false
    "mode": "observe"    // "observe" | "assist" | "autonomous"
  }
}
```

## CLI

```bash
# Lihat status Evolution Layer
opencode evolution status
```

## Services

### Memory Service (`brain/memory.ts`)
- `save(entry)` — simpan memory entry
- `retrieve(query)` — ambil memory berdasarkan tags/type
- `search(query)` — cari memory berdasarkan teks
- `summarize()` — ringkasan memory (count, types)
- `compact()` — prune memory (max 500 entries)

### Project Understanding (`brain/project.ts`)
- `profile()` — dapatkan project profile
- `detectFrameworks()` — deteksi framework
- `getStructure()` — deteksi struktur (single/monorepo)
- `hasDependency(name)` — cek dependency
- `refresh()` — refresh project profile

### Decision Records (`brain/decisions.ts`)
- `save(adr)` — simpan ADR, generate JSON + Markdown
- `get(id)` — ambil ADR by ID
- `list(status?)` — daftar ADR (filter by status)
- `search(query)` — cari ADR
- `summarize()` — ringkasan ADR
- `supersede(id, newADR)` — supersede ADR

## Data Schema Examples

### Memory Entry
```json
{
  "id": "k3x8m2p9q1r5",
  "type": "lesson",
  "content": "Always verify database migration rollback strategy before applying",
  "tags": ["database", "migration", "rollback"],
  "sessionID": "abc123",
  "created": 1718000000000,
  "updated": 1718000000000
}
```

### Lesson (type field = "lesson")
```json
{
  "id": "l7w4n1b2c3d6",
  "type": "lesson",
  "content": "Monorepo package manager: use --filter flag for targeted installs",
  "tags": ["monorepo", "package-manager"],
  "created": 1718000000000,
  "updated": 1718000000000
}
```

### Decision Record (stored as ADR-*.json + ADR-*.md)
```json
{
  "id": "ADR-X3K8M2P9-Q1R5",
  "title": "Use Drizzle ORM for database access",
  "status": "accepted",
  "context": "Need type-safe SQL with migration support across PostgreSQL and SQLite",
  "decision": "Adopt Drizzle ORM over Prisma for lighter bundle and Effect compatibility",
  "consequences": "Simpler migration files, direct SQL access when needed",
  "tags": ["database", "orm", "drizzle"],
  "sessionID": "abc123",
  "createdAt": 1718000000000,
  "updatedAt": 1718000000000
}
```

### Markdown ADR output (auto-generated)
```markdown
# ADR-X3K8M2P9-Q1R5: Use Drizzle ORM for database access

**Status:** accepted
**Created:** 2024-06-10T12:00:00.000Z
**Tags:** database, orm, drizzle

## Context

Need type-safe SQL with migration support across PostgreSQL and SQLite

## Decision

Adopt Drizzle ORM over Prisma for lighter bundle and Effect compatibility

## Consequences

Simpler migration files, direct SQL access when needed
```

## Future CLI Commands (Planned)

```bash
opencode evolution memory list        # List memory entries
opencode evolution memory search <q>   # Search memory
opencode evolution adr list            # List architecture decisions
opencode evolution adr show <id>       # Show ADR details
opencode evolution project show        # Show detailed project profile
opencode evolution refresh             # Force refresh project profile
```

## Future Phases

| Phase | Component | Status |
|-------|-----------|--------|
| **1** | Foundation Brain — Memory, Project, ADR | ✅ Complete |
| **2** | Context Intelligence — Indexer, Retriever | 🔜 Planned |
| **3** | Decision Engine — Classifier, Risk, Strategy | 🔜 Planned |
| **4** | Agent Orchestration — Architect, Reviewer, Tester | 🔜 Planned |
| **5** | Evolution System — Analyzer, Improver | 🔜 Planned |
