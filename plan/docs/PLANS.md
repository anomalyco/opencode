# Execution Backlog

## How To Use This File

- Pick the next unowned `todo` item whose dependencies are satisfied.
- Fetch the latest `xiaokang/cyzh/eco-agent`, then create one dedicated feature branch for that claimed plan.
- Read the owning phase file under `plan/docs/exec-plans/`.
- Update status before and after execution.
- Use `ready` when the feature branch passed its benchmark gate but is not merged into `cyzh/eco-agent` yet.
- Do not mark `done` without the benchmark gate recorded and the change merged into `cyzh/eco-agent`.

## Phase Order

1. Benchmark foundation
2. Platform foundation
3. Tool runtime
4. Design stage
5. Function ECO
6. Physical ECO
7. Signoff
8. Ops and productization

## Phase 0: Benchmark Foundation

| ID | Status | Title | Depends On | Benchmark Gate |
| --- | --- | --- | --- | --- |
| BMK-001 | blocked | Build repo-local benchmark catalog | none | catalog self-check |
| BMK-002 | done | Define benchmark manifest schema | BMK-001 | catalog self-check |
| BMK-003 | ready | Create timestamped benchmark workspace | BMK-002 | catalog self-check |
| BMK-004 | todo | Run `smic110-adder` dry-run smoke | BMK-003 | adder smoke |
| BMK-005 | todo | Load fullflow suite from repo-local jobs | BMK-004 | fullflow smoke |
| BMK-006 | todo | Load design and stage-specific suites | BMK-005 | design/function/physical/signoff smoke |
| BMK-007 | todo | Normalize results and summaries | BMK-006 | fullflow smoke |
| BMK-008 | todo | Wire benchmark into plan completion gate | BMK-007 | fullflow smoke |

## Phase 1: Platform Foundation

### Latest Runs

- `BMK-001`: benchmark `pass` at `/workspaces/Github/opencode/benchmark/26-03-20/18-18-08`; commit: `458ac87ff15137e88ae13adff546ac4526bc629c`; push to `xiaokang/cyzh/eco-agent` failed with SSH access error

| ID | Status | Title | Depends On | Benchmark Gate |
| --- | --- | --- | --- | --- |
| PLT-001 | todo | Add EDA job config parser | BMK-004 | adder smoke |
| PLT-002 | todo | Add typed EDA state schema | PLT-001 | adder smoke |
| PLT-003 | todo | Add plan claim and status persistence | PLT-002 | catalog self-check |
| PLT-004 | todo | Add workspace and artifact manager | PLT-002 | adder smoke |
| PLT-005 | todo | Add EDA prompt pack and mode | PLT-002 | adder smoke |
| PLT-006 | todo | Add stage router and prerequisite guards | PLT-005 | fullflow smoke |
| PLT-007 | todo | Add benchmark-aware completion policy | BMK-008, PLT-006 | fullflow smoke |
| PLT-008 | todo | Add operator CLI entrypoints | PLT-004, PLT-006 | adder smoke |

## Phase 2: Tool Runtime

| ID | Status | Title | Depends On | Benchmark Gate |
| --- | --- | --- | --- | --- |
| RTM-001 | todo | Define EDA tool adapter interface | PLT-002 | catalog self-check |
| RTM-002 | todo | Add host tool discovery and probes | RTM-001 | catalog self-check |
| RTM-003 | todo | Add isolated tool runner | RTM-001 | adder smoke |
| RTM-004 | todo | Add hardcoded Tcl asset registry | RTM-003 | adder smoke |
| RTM-005 | todo | Add path and manifest validator | RTM-001 | adder smoke |
| RTM-006 | todo | Add log and artifact capture layer | RTM-003 | adder smoke |
| RTM-007 | todo | Add `genus` adapter | RTM-002, RTM-003, RTM-004 | function smoke |
| RTM-008 | todo | Add `conformal_eco` adapter | RTM-007 | function smoke |
| RTM-009 | todo | Add `eden` adapter | RTM-002, RTM-003, RTM-004 | physical smoke |
| RTM-010 | todo | Add `qrc` adapter | RTM-002, RTM-003, RTM-004 | signoff smoke |
| RTM-011 | todo | Add `innovus_drc_ant` adapter | RTM-002, RTM-003, RTM-004 | signoff smoke |
| RTM-012 | todo | Add `pt` or `tempus` timing adapter | RTM-002, RTM-003, RTM-004 | signoff smoke |

## Phase 3: Design Stage

| ID | Status | Title | Depends On | Benchmark Gate |
| --- | --- | --- | --- | --- |
| DSN-001 | todo | Add design-stage context builder | PLT-006 | design smoke |
| DSN-002 | todo | Port req2rtl task splitting pattern | DSN-001 | design smoke |
| DSN-003 | todo | Add flist and include validation | DSN-001 | design smoke |
| DSN-004 | todo | Add subagent writeback flow for RTL edits | DSN-002, PLT-005 | design smoke |
| DSN-005 | todo | Add design verifier hooks and artifacts | DSN-003, DSN-004 | design smoke |
| DSN-006 | todo | Add design benchmark suite | DSN-005, BMK-006 | design suite |
| DSN-007 | todo | Add downstream fallback to design | DSN-006, PLT-006 | design suite + fullflow smoke |

## Phase 4: Function ECO

| ID | Status | Title | Depends On | Benchmark Gate |
| --- | --- | --- | --- | --- |
| FEC-001 | todo | Add function ECO context and guards | RTM-007, RTM-008, DSN-005 | function smoke |
| FEC-002 | todo | Add revised RTL synthesis runner | FEC-001 | function smoke |
| FEC-003 | todo | Add conformal post-mask runner | FEC-002 | function smoke |
| FEC-004 | todo | Add function ECO artifact package | FEC-003 | function smoke |
| FEC-005 | todo | Add function ECO benchmark suite | FEC-004, BMK-006 | function suite |
| FEC-006 | todo | Add retry and handoff to physical ECO | FEC-005 | function suite + physical smoke |

## Phase 5: Physical ECO

| ID | Status | Title | Depends On | Benchmark Gate |
| --- | --- | --- | --- | --- |
| PEC-001 | todo | Add physical ECO orchestrator | RTM-009, FEC-006, PLT-005 | physical smoke |
| PEC-002 | todo | Add `eco_place` flow | PEC-001 | physical smoke |
| PEC-003 | todo | Add `auto_drc` flow | PEC-002 | physical smoke |
| PEC-004 | todo | Add `auto_timing` flow | PEC-003, RTM-012 | physical smoke |
| PEC-005 | todo | Add `auto_ant` flow | PEC-003 | physical smoke |
| PEC-006 | todo | Add pre-signoff package from physical stage | PEC-004, PEC-005 | physical smoke |
| PEC-007 | todo | Add physical ECO benchmark suite | PEC-006, BMK-006 | physical suite |

## Phase 6: Signoff

| ID | Status | Title | Depends On | Benchmark Gate |
| --- | --- | --- | --- | --- |
| SGF-001 | todo | Add signoff context and artifact contract | PEC-006, PLT-006 | signoff smoke |
| SGF-002 | todo | Add LEC plus DRC/antenna composite | SGF-001, RTM-011 | signoff smoke |
| SGF-003 | todo | Add extraction plus STA composite | SGF-001, RTM-010, RTM-012 | signoff smoke |
| SGF-004 | todo | Add final verdict schema and package | SGF-002, SGF-003 | signoff smoke |
| SGF-005 | todo | Add signoff benchmark suite and completion hook | SGF-004, BMK-006 | signoff suite |

## Phase 7: Ops And Productization

| ID | Status | Title | Depends On | Benchmark Gate |
| --- | --- | --- | --- | --- |
| OPS-001 | todo | Write subagent playbook for execution work | PLT-003 | catalog self-check |
| OPS-002 | todo | Add benchmark trend history | BMK-007 | fullflow smoke |
| OPS-003 | todo | Add failure triage summaries | PLT-006, BMK-007 | fullflow smoke |
| OPS-004 | todo | Add feature-branch merge workflow to `cyzh/eco-agent` | PLT-007 | fullflow smoke |
| OPS-005 | todo | Add CLI or TUI run status surfaces | PLT-008, BMK-007 | fullflow smoke |
| OPS-006 | todo | Add docs and done-checklist automation | OPS-001, OPS-004 | fullflow smoke |
