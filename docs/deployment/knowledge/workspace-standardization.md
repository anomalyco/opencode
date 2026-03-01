# Workspace Standardization - DECISION_164

**Created**: 2026-02-26  
**Parent Decision**: DECISION_164  
**Purpose**: Document path standardization for nate-alma workspace

---

## Path Bases (Normative)

| Constant | Windows Pre-Deploy | Container Deploy |
|----------|-------------------|-----------------|
| `WORKSPACE_ROOT` | `C:/P4NTH30N/OP3NF1XER/nate-alma/dev/` | `/data/workspace/` |
| `ALMA_TEACHINGS_ROOT` | `<WORKSPACE_ROOT>/memory/alma-teachings/` | `<WORKSPACE_ROOT>/memory/alma-teachings/` |
| `INDEX_ROOT` | `<ALMA_TEACHINGS_ROOT>/bible/` | `<WORKSPACE_ROOT>/memory/alma-teachings/bible/` |
| `CORPUS_ROOT` | `<ALMA_TEACHINGS_ROOT>/substack/` | `<WORKSPACE_ROOT>/memory/alma-teachings/substack/` |

---

## Directory Structure (Post-Standardization)

```
alma-teachings/
├── bible/              # Index v4 contract root ✅ GENERATED
│   ├── _manifest/      # manifest.json (4 KB), build-state.json, build-report.json
│   ├── _schemas/      # 8 schema files
│   ├── corpus/        # doc records (340 substack, 0 bible)
│   ├── atoms/         # ALMA append-ready JSONL shards
│   ├── mappings/      # 62 canonical book sections
│   ├── ontology/      # weights.json
│   └── views/         # ready for generation
├── substack/          # Raw corpus (340 markdown files)
├── Book/
├── site/
├── legacy/             # Historical artifacts
│   ├── index-artifacts/
│   ├── collisions/
│   └── rename-backup-YYYYMMDD_HHMMSS/
└── README.md
```

---

## Rename Operations Performed

| Operation | Before | After | Files |
|-----------|--------|-------|-------|
| Corpus relocation | `alma-teachings/bible/` | `alma-teachings/substack/` | 341 |
| Index root | `alma-teachings/index/` | `alma-teachings/bible/` | 17 files |
| Deduplication | `dev/memory/substack/` | *(merged into substack/)* | 341 |

**Index v4 Generated**: ✅ 17 files, 4 KB manifest, 340 doc records, 62 sections

---

## Key Decisions

1. **No shims/symlinks** - Direct path changes, no compatibility layers
2. **Traversal-first** - Easier navigation for. **Legacy containment** - Large AI agents
3 artifacts moved to `legacy/`
4. **Deterministic paths** - No absolute paths in non-legacy artifacts

---

## Related Decisions

- DECISION_163: Index v4 schema definition
- DECISION_164: Workspace rename and standardization
- DECISION_164_REMEDIATION_001: Completion gaps fixed
- **Index v4 Generation**: ✅ Complete (340 doc records, 62 sections, 8 schemas)

---

## Usage

**For corpus access**:
- Use `alma-teachings/substack/` - contains 340 markdown articles

**For index access**:
- Entry point: `alma-teachings/bible/_manifest/manifest.json`
- Shim: `alma-teachings/bible/index.json` (legacy compatibility)
- Schemas: `alma-teachings/bible/_schemas/`

**For ALMA atom appending**:
- Write to: `alma-teachings/bible/atoms/teachings/YYYY-MM.jsonl`

**For book section mappings**:
- Reference: `alma-teachings/bible/mappings/book-sections.json` (62 sections)

**For historical artifacts**:
- Legacy: `alma-teachings/legacy/index-artifacts/`

---

*Last updated: 2026-02-26 (Index v4 generated)*
