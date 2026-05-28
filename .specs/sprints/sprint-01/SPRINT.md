---
sprint: sprint-01
status: doing
---

# Sprint 01 — SimplicioCode Migration & Toolchain

> Active sprint tracking the R1–R7 roadmap from `docs/EVOLUTION.md`.
> Each item maps to a GitHub issue (#3–#9) under master roadmap #2.

## Goal

Establish the SimplicioCode identity (rebranded from OpenCode) and wire the
mandatory Simplicio toolchain: `simplicio-mapper`, `simplicio-cli`,
`simplicio-sprint`, plus the local AI **Simplicio1** (Qwen 2.5 Coder 3B).

## Board

| Status | Issue | Title | Progress |
|---|---|---|---|
| 🟢 in progress | [#3](https://github.com/wesleysimplicio/Simplicio-code/issues/3) | R1 Mapper before programming | ~80% |
| 🟢 in progress | [#4](https://github.com/wesleysimplicio/Simplicio-code/issues/4) | R2 simplicio-cli mandatory | ~70% |
| 🟡 todo       | [#5](https://github.com/wesleysimplicio/Simplicio-code/issues/5) | R3 Sprints menu (native TUI) | ~40% |
| 🟢 in progress | [#6](https://github.com/wesleysimplicio/Simplicio-code/issues/6) | R4 Simplicio1 provider | ~60% |
| 🟢 in progress | [#7](https://github.com/wesleysimplicio/Simplicio-code/issues/7) | R5 Rename OpenCode→SimplicioCode | ~40% (Phases 1+2 done) |
| 🟢 in progress | [#8](https://github.com/wesleysimplicio/Simplicio-code/issues/8) | R6 Daily cron 10:00 / 17:30 BRT | ~80% |
| 🟢 in progress | [#9](https://github.com/wesleysimplicio/Simplicio-code/issues/9) | R7 CLI canonical pipeline | ~70% |

## Cards in this sprint

Tasks live as `<id>-<slug>.task.md` siblings of this file. The mapper seeded
`01-example.task.md` as a template; real cards are tracked as GitHub issues.

## Definition of Done (per card)

- Code merged behind a draft PR with a green CI checklist.
- Acceptance criteria in the issue all ticked.
- `docs/EVOLUTION.md` updated with a dated entry.
- A `Refs #N` or `Closes #N` in the merge commit.
