# Corpus Incident Redesign

## Goal

Publish every split incident as one stable canon record, preserve the established incident-family taxonomy, and make future additions collision-safe and index-consistent. All implementation tests use temporary corpus roots; no Hindsight write, merge, push, or live corpus migration is part of this work.

## Verified Context

The unmerged `redesign/per-incident-split` branch at `65ea7b6` originally had 116 incident files and links. Before implementation, three further X-family incidents were added, so the supplied baseline and current source contain 119 linked files. The conservation check covered 3,165 lines with none missing. `build_bundle.mjs` currently reads only root-level Markdown. A naive recursive reuse of its current ID logic would produce `??:overview` IDs for incident files without `##` headings.

The existing ID letters carry meaning. Current and historical families include `A`, `C`, `D`, `G`, `K`, `L`, `M`, `O`, `P`, `R`, `S`, `U`, and `X`; `C-01` and `O-01` are retained legacy references for Context Mode and the Orca hook. A split file's filename is authoritative: `X-111-...md` intentionally retains an older `X-92` heading.

## Design

### Bundle Generation

- Extract pure bundle-building logic that accepts an injected corpus root; importing it must not read or write the live corpus. Preserve root-document sectioning and IDs.
- Read root Markdown and sorted `incidents/*.md`. Validate incident filenames and reject duplicate incident IDs even when their slugs differ.
- Emit exactly one incident record per file with stable ID `env-canon:v1:15:<filename-stem>`, logical document number `15`, `surface: incidents`, and `metadata.source_file` equal to the normalized relative path `incidents/<filename>`.
- Make the corpus digest deterministic across creation order and include normalized paths, lengths, and content with unambiguous separators. Renames and content edits must each change it.
- Check that the ledger's linked incident IDs match the incident files. A legacy unmarked index can be checked before its first generated rewrite.

### Family-Preserving Addition

- `corpus-add.mjs` requires `--prefix`, `--title`, and `--body-file`; tests and maintenance commands accept an injected `--corpus` root. Known prefixes are `A`, `C`, `D`, `G`, `K`, `L`, `M`, `O`, `P`, `R`, `S`, `U`, and `X`. Unknown prefixes are rejected until the family catalog is deliberately extended.
- Allocate within the requested family, using at least two numeric digits (`G-07`, `G-100`) and accounting for IDs in incident filenames, reservations, and retained legacy ledger text (`C-01` must not be reissued). Existing gaps do not override the family's maximum.
- `X` is reserved for explicitly cross-cutting issues and requires `--cross-cutting`; the flag is rejected for other prefixes.
- Serialize by ID, not slug: create the reservation for `G-07` exclusively with `openSync(..., 'wx')`, so titles producing different slugs cannot both claim `G-07`.
- Validate title and body before reserving. Build the canonical `### <ID> — <title>` heading, normalize newlines, and prepare the complete file before exposing it at its final path. Publish it atomically with a same-volume hard link; never overwrite an existing incident.
- Create the narrow `incidents/.ids/.gitignore` (`*` and `!.gitignore`) so reservation tombstones and staging files are excluded from the corpus autocommit. Preserve an existing ignore file rather than overwriting it.
- Update the generated ledger index under an exclusive index-write lock and re-list/re-render until stable. Interrupted writes must leave no partial `.md` incident; stale reservations may burn an ID but cannot cause reuse.

### Generated Index

- Add `corpus-index.mjs` with `--check`, `--write`, and `--migrate` operations. `corpus-add.mjs` refreshes the index after creating an incident. `--write` requires an already marked generated region; the existing unmarked split index needs the one-time `--migrate` operation before the first add.
- Bound the generated link list with explicit begin/end markers. Generated H2 headings are count-free so each new entry does not change the Hindsight record ID. Counts belong in the region body.
- Preserve the retained non-incident tail byte-for-byte. `--migrate` converts the current unmarked split index; later `--write` operations are idempotent.
- Bundle validation detects missing, extra, duplicate, or malformed incident links. The filename ID is authoritative; enforce matching heading IDs for newly created entries only.

### `mk-canon-update` Workflow

- Replace the implied manual edit of `15-INCIDENT-AND-WORKAROUND-LEDGER.md` with a required `corpus-add.mjs --prefix ... --title ... --body-file ...` workflow.
- Explain the established prefix families, reserve `X` for cross-cutting items with the explicit flag, and direct agents to inspect existing entries before choosing a family.
- State that incident files are authoritative; the ledger's generated region is not hand-edited. Amend the incident file itself, then use `corpus-index.mjs --write` to repair/regenerate the index.
- Run the bundle tests and `corpus-index.mjs --check` before the existing bundle, scanner, retrieval, and publication gates.

## Tests and Smoke Gate

Use Node's built-in `node:test` and `mkdtempSync` fixtures. Tests must not read or write the live corpus, touch default `bundle.json`, call Hindsight, publish, or use network services. Write each test before its implementation and verify the expected RED failure.

Cover at least:

- Existing root-document IDs and hashes stay unchanged; one entire record per incident; all filenames map to unique `15`/`incidents` records with correct source paths, hashes, and index entries.
- Bad filenames; duplicate IDs with different slugs; filename/old-heading disagreement; empty files; missing/extra index links; unmarked-to-marked index migration; byte-exact retained tail; idempotent repeated index writes.
- Missing, lowercase, malformed, and unknown prefixes; `X` without `--cross-cutting`; rejection before reserving; all known families; no cross-family sequence bleed; `G-06 -> G-07`, `G-99 -> G-100`, `X-111 -> X-112`, and legacy-only `C-01 -> C-02` / `O-01 -> O-02`.
- `--cross-cutting` with a non-X prefix is rejected. A temporary Git fixture confirms reservation and staging files are ignored while `.ids/.gitignore` remains trackable.
- Same-ID/different-slug concurrent contenders, stale reservations, an existing reservation, an occupied final path, and eight concurrent adds with distinct IDs and matching bodies/index links.
- Empty and whitespace-only titles/bodies, title punctuation/path separators, Unicode-only and maximum-length titles, CRLF body input, injected heading handling, and missing body-file paths.
- Digest repeatability across creation orders, change on rename-only and content-only changes, and boundary separation (`a="x", b="yz"` differs from `a="xy", b="z"`).

Before claiming completion, run the full fixture suite and a read-only integration smoke build against the current 119-file split with output directed to a temporary path. Confirm every current incident record exactly once, unique IDs, exact root-record compatibility, correct digest behavior, unchanged default `bundle.json` hash, `scan_secrets.mjs <temp-bundle>` PASS, `rehearse_retrieval.mjs <temp-bundle>` PASS, and `corpus-index.mjs --check` PASS. Do not publish.

For the skill edit, run a baseline pressure scenario with at least three combined pressures before editing, then run the same scenario against the updated skill and confirm it chooses the explicit family and `corpus-add` path. No implementation-success claim before both the code smoke gate and skill pressure gate pass.

## Migration and Safety Boundary

`sync.mjs` reports old bundle-absent Hindsight IDs as orphans and does not delete them. This work does not publish, delete, or migrate Hindsight records. The live corpus remains on its unmerged branch and is not rewritten by tests; one-time live index migration, branch switching, merge, push, and commit remain separate owner-controlled operations.

Other stale duplicate-ID instructions in `CLAUDE.md`, `AGENTS.md`, and `memory-routing/SKILL.md` are outside this change and require separate approval.
