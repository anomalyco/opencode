# Session Synthesis

**Agent:** {workspace-name}
**Issue:** {beads-id}
**Duration:** {start-time} → {end-time}
**Outcome:** {success | partial | blocked | failed}

---

## TLDR

[1-2 sentence summary. What was the goal? What was achieved?]

---

## Delta (What Changed)

### Files Created
- `path/to/file.go` - Brief description

### Files Modified
- `path/to/existing.go` - What was changed

### Commits
- `abc1234` - Commit message summary

---

## Evidence (What Was Observed)

- Observation 1 with source reference (file:line or command output)
- Observation 2 with source reference
- Key finding that informed decisions

### Tests Run
```bash
# Command and result
go test ./... 
# PASS: all tests passing
```

---

## Knowledge (What Was Learned)

### New Artifacts
- `.kb/investigations/YYYY-MM-DD-*.md` - Brief description

### Decisions Made
- Decision 1: [choice] because [rationale]

### Constraints Discovered
- Constraint 1 - Why it matters

### Externalized via `kn`
- `kn decide "X" --reason "Y"` - [if applicable]
- `kn constraint "X" --reason "Y"` - [if applicable]
- `kn tried "X" --failed "Y"` - [if applicable]

---

## Next (What Should Happen)

**Recommendation:** {close | spawn-follow-up | escalate | resume}

### If Close
- [ ] All deliverables complete
- [ ] Tests passing
- [ ] Investigation file has `**Phase:** Complete`
- [ ] Ready for `orch complete {issue-id}`

### If Spawn Follow-up
**Issue:** {new-issue-title}
**Skill:** {recommended-skill}
**Context:**
```
{Brief context for next agent - 2-3 sentences max}
```

### If Escalate
**Question:** {what needs decision from orchestrator}
**Options:**
1. {option A} - pros/cons
2. {option B} - pros/cons

**Recommendation:** {which option and why}

### If Resume
**Next Step:** {what to do when resuming}
**Blocker:** {what prevented completion}
**Context to Reload:**
- {key file to re-read}
- {state to remember}

---

## Unexplored Questions

**Questions that emerged during this session that weren't directly in scope:**
- [Question 1 - why it's interesting]
- [Question 2 - why it's interesting]

**Areas worth exploring further:**
- [Area 1]
- [Area 2]

**What remains unclear:**
- [Uncertainty 1]
- [Uncertainty 2]

*(If nothing emerged, note: "Straightforward session, no unexplored territory")*

---

## Session Metadata

**Skill:** {skill-name}
**Model:** {model-used}
**Workspace:** `.orch/workspace/{workspace-name}/`
**Investigation:** `.kb/investigations/YYYY-MM-DD-*.md`
**Beads:** `bd show {issue-id}`
