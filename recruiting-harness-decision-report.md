# Recruiting Harness — Decision Report & Implementation Brief

**Date:** 2026-08-13  
**Status:** Research complete · Recommendation locked  
**Audience:** Project agent / implementation agent  
**Owner context:** Technical recruiter building AI agent infrastructure for talent acquisition (future-of-work / agent economy focus)

---

## 1. Executive Summary

**Thesis:** Talent acquisition workflows can be mapped almost 1:1 onto the software engineering workflows that power modern coding agents. The product opportunity is to build the **recruiting harness** — a TUI-native agent runtime that treats requisitions as repositories, candidate status changes as commits, and ATS systems as the remote.

**Decision:** Hard-fork **OpenCode** (anomalyco/opencode, MIT license, ~197k stars). Do not greenfield. Do not primary-fork T3 Code or attempt to fork Grok Build.

**Why now:** Official MCP servers for Ashby and Greenhouse already expose the critical write actions (stage moves, notes, creates). The coding-agent harnesses of 2025–2026 solved the hard problems (TUI, agent loop, sessions, permissions/diffs, multi-provider, MCP client). The missing piece is the coherent vertical harness that makes “everything is code” real for recruiting.

**White space:** No mature open TUI recruiting harness exists that uses this isomorphism. Existing solutions are either closed SaaS agents (Juicebox, LinkedIn Hiring Assistant, etc.) or skills bolted onto coding agents.

---

## 2. Product Thesis

2025 and 2026 were the years of coding harnesses (OpenCode, Claude Code, Codex, Grok Build, Cursor agents, etc.). The next vertical is recruiting.

Core belief: **Everything is code.**

| Coding Agent Concept       | Recruiting Equivalent                          |
|---------------------------|------------------------------------------------|
| Repository / working dir  | Requisition (open role)                        |
| `AGENTS.md` / project rules | `HIRING.md` (rubric, scorecard, culture, process) |
| `/init`                   | Open / scaffold new requisition                |
| File / code change        | Candidate card, note, score, outreach draft    |
| Commit                    | Status / stage change + audit note             |
| Diff + approve            | Review proposed stage move or outreach before it hits ATS |
| Push                      | Sync approved change to ATS via MCP            |
| Plan mode                 | Sourcing strategy, pipeline design, outreach sequence |
| Build mode                | Execute approved actions                       |
| Subagents                 | Sourcer, screener, scheduler, outreach agent   |
| MCP tools                 | Ashby / Greenhouse / Juicebox / custom tools   |
| Local git history         | Audit trail of decisions                       |
| Remote                    | ATS (system of record)                         |

The product becomes the harness that sits *above* the fragmented ATS MCP servers and turns recruiting into a coherent, terminal-native, agent-driven operating system.

---

## 3. Research Findings

### 3.1 OpenCode (Primary Target)

- **Repo:** anomalyco/opencode  
- **License:** MIT (clean, full rights to modify/rebrand/sell; retain copyright notice)  
- **Stars / activity:** ~197k stars, highly active (near-daily releases), large community  
- **Stack:** TypeScript monorepo (Bun + Turbo)  
- **Key primitives already present:**
  - Native TUI
  - Agent loop + sessions + multi-session
  - `/init` → generates `AGENTS.md` (hierarchical loading)
  - Plan vs Build agents (Tab switch) with permission model (allow / ask / deny, wildcards)
  - First-class MCP client
  - Plugin system + custom tools (`.opencode/tools/` + `tool()` helper)
  - Multi-provider support
  - Diffs / approvals
- **Extensibility for recruiting is strong:**
  - Custom tools and plugins make it straightforward to add `update_candidate_stage`, `add_note`, `source_candidates`, `draft_outreach`, etc.
  - MCP tools from Ashby/Greenhouse appear namespaced and can be permission-gated
  - Workspace = working directory is flexible enough to treat a requisition folder (`HIRING.md` + `candidates/*.md` + local git) as the “repo”
  - Domain adaptations already exist in the community (academic, legal, ops, business agents)
- **Maintenance note:** Upstream moves fast. Prefer **hard fork + rebrand** over long-term soft-fork once domain primitives (candidates, stages, HIRING.md primacy) diverge from pure code-edit assumptions.

### 3.2 T3 Code (Secondary / Later Layer)

- Control surface (web / desktop / mobile) that *drives* other agents via adapters
- Already has an OpenCode driver
- Provider adapter model is designed so a new RecruitingAgent can be added later
- Strong for multi-agent orchestration, worktrees, remote access
- **Not** the primary fork target for a TUI recruiting harness

### 3.3 Grok Build (Inspiration Only)

- Closed-source (xAI)
- Excellent patterns to steal: plan → review/approve → execute, parallel subagents, skills, ACP
- Cannot be forked

### 3.4 ATS MCP Ecosystem (The “Push” Side)

- **Ashby official MCP** (open beta June 2026, all plans): search candidates/jobs/apps, details, notes, feedback, interviews, create candidate, add notes, **change application stage**, create applications, pipelines. User-level OAuth respecting recruiter permissions.
- **Greenhouse official MCP** (open beta ~May/June 2026): similar coverage including advance/move/reject applications.
- Juicebox is strong on autonomous *sourcing* agents; treat as high-value source/tool rather than primary system of record.
- Critical write actions required by the metaphor (stage moves as “commits”) are already available.

### 3.5 Competitive Landscape

- No mature open-source TUI “recruiting harness” that treats reqs as repos + stage changes as commits + ATS as remote.
- Closest: skills/plugins that bolt recruiting workflows onto coding agents (the inverse of this thesis), or closed SaaS agents living inside their own UIs.
- White space is real and timely.

---

## 4. Recommendation

**Hard-fork OpenCode. Rebrand completely. Specialize for recruiting.**

Do **not** greenfield the agent loop, TUI, session management, permission system, or MCP client. Those problems are solved. Specialize the domain model and tool surface instead.

**Name direction (examples only):** HireCode, Req, Pipeline, TalentHarness, Hire, or similar. Avoid including “opencode” in the product name without a clear non-affiliation note.

---

## 5. Implementation Path (Actionable for Project Agent)

### Phase 0 — Fork & Rebrand (Day 0–1)
- Fork `anomalyco/opencode`
- Full rebrand (package names, binary name, docs, TUI strings)
- Keep plugin system intact for future extensibility
- Establish basic CI (GitHub Actions already of interest)

### Phase 1 — MVP Vertical Slice (Target: working end-to-end loop)
1. Adapt `/init` → `/hiring-init` (or keep `/init` and specialize behavior)
2. Scaffold a requisition directory:
   - `HIRING.md` generated from JD + scorecard template
   - `candidates/` folder for structured markdown cards (frontmatter: stage, score, source, notes, etc.)
   - Local git initialized for audit history
3. Wire Ashby MCP (and/or Greenhouse) as primary tools
4. Permission model:
   - Plan-like modes: deny or ask on mutating tools
   - Build/execute: ask on stage moves and outreach; allow search freely
5. Core loop:
   - Load `HIRING.md` + candidate state
   - Propose actions (stage change, note, outreach draft) as diffs
   - Human approve
   - “Push” = execute via MCP + record local commit/audit
6. Demote pure coding tools (edit/write heavy code paths) via config/permissions
7. Elevate recruiting verbs and 2–3 subagents (sourcer, screener, outreach)

### Phase 2 — Harden Domain Model
- Decide how far to push first-class candidate entities vs pure file/git metaphor
- Stronger `HIRING.md` schema (must-haves, nice-to-haves, stage definitions, culture signals, compliance notes, outreach voice)
- Better local state + sync strategy with ATS as source of truth
- Multi-requisition / workspace support if needed

### Phase 3 — Distribution & Surfaces
- Expose as a T3 Code-compatible provider (multi-surface control plane)
- Slack surface (aligns with existing Slack Agentic ATS prototype direction)
- Optional headless / ACP mode for orchestration

### Explicit Non-Goals for MVP
- Full multi-tenant SaaS
- Replacing the ATS
- Perfect offline mode
- Heavy first-class database model (start with files + git + MCP)

---

## 6. Domain Model Sketch (Initial)

```
requisition-dir/
├── HIRING.md                 # Living source of truth for the role
├── candidates/
│   ├── candidate-id-1.md     # Frontmatter + notes + history
│   └── ...
├── .git/                     # Local audit / “commits”
├── opencode.json / config    # MCP servers, permissions, agents
└── .opencode/
    ├── agents/               # Specialized recruiting agents
    └── tools/                # Custom recruiting tools if needed
```

- **HIRING.md** ≈ `AGENTS.md` (hierarchical rules, rubric, process)
- Candidate markdown cards carry stage, scores, source, notes
- Local git commit message / body records the decision + rationale
- MCP call is the actual mutation against the system of record

---

## 7. Key Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Upstream OpenCode velocity makes soft-fork painful | Hard fork + rebrand early; cherry-pick selectively |
| File/git metaphor eventually limits complex pipeline state | Start simple; evolve to richer model only if needed |
| ATS MCP write surface or auth limitations | Ashby/Greenhouse already support critical actions; fall back to custom tools if gaps appear |
| Permission / approval UX friction | Steal Grok Build plan-review-approve patterns aggressively |
| Scope creep into full ATS replacement | Explicitly stay a harness/control plane above the ATS |

---

## 8. Alignment with Broader Bets

This harness sits naturally alongside:
- X Careers / Grok-powered job platform prototypes
- Agent identity / KYA (Know Your Agent) + verifiable credentials
- Slack Agentic ATS direction
- Signal Resume / living professional profile work
- General agent economy / future-of-work infrastructure

It is the terminal-native control plane for talent work in an agent-native world.

---

## 9. Immediate Next Actions for Project Agent

1. Fork `anomalyco/opencode` and complete a clean rebrand.
2. Inventory current tool registry, permission system, MCP client, and `/init` + `AGENTS.md` loading logic.
3. Prototype the minimal requisition directory layout + `HIRING.md` schema.
4. Configure Ashby MCP (or Greenhouse) and verify stage-move + note tools work under the permission model.
5. Implement the first vertical slice: load HIRING.md → list candidates → propose stage change as diff → approve → push via MCP + local audit commit.
6. Report back with the working loop and any architectural friction discovered.

---

## 10. Reference Notes

- OpenCode: MIT, TypeScript, first-class MCP, plugin/custom-tool system, hierarchical AGENTS.md, plan/build agents.
- Ashby MCP and Greenhouse MCP: official servers with stage-change and note capabilities already live in beta.
- T3 Code: valuable later as multi-surface control plane; already drives OpenCode.
- Grok Build: closed; replicate UX patterns only.
- No direct open TUI competitor using the req-as-repo / status-as-commit isomorphism.

**End of report.**  
Ready for hand-off to implementation agent.
