---
name: agile-v-behavioral
description: Anti-pattern prevention guidelines for Agile V agents. Prevents common LLM coding mistakes while maintaining Agile V traceability. Use when implementing requirements to avoid overcomplication, silent assumptions, scope creep, and verification failures.
license: CC-BY-SA-4.0
metadata:
  version: "1.1"
  standard: "Agile V"
  author: agile-v.org
  adapted_from:
    - name: "Karpathy Skills"
      url: "https://github.com/forrestchang/andrej-karpathy-skills"
      license: "MIT"
      sections: "Behavioral Guidelines"
      note: "Four behavioral principles adapted under the MIT License and integrated with Agile V traceability framework."
---

# Instructions

Anti-pattern prevention for Agile V agents. Combines proven behavioral guidelines with Agile V traceability to prevent common LLM failures.

**Companion skill:** Load `agile-v-core` first. This skill extends core directives with behavioral safeguards.

**Tradeoff:** These guidelines bias toward caution and clarity over speed. For trivial single-REQ implementations, use judgment.

---

## 1. Think Before Coding (Enhanced for Agile V)

**Don't assume. Don't hide confusion. Surface tradeoffs. Document decisions.**

### Before REQ Synthesis
- **State assumptions explicitly** in Decision Log before implementation
- **If REQ has multiple interpretations**, halt and present options (don't pick silently)
- **If simpler approach exists**, document trade-off in Decision Log
- **If REQ is unclear**, invoke Requirement Architect or Logic Gatekeeper (don't improvise)

### Integration with Agile V
- **Halt Condition (Directive #6)**: If requirement is ambiguous, **stop**. Name what's confusing. Ask.
- **Decision Log**: Every interpretation choice → `DECISION_LOG.md` entry with timestamp, rationale, alternatives considered
- **REQ Clarification Protocol**: Don't implement vague requirements; send back for refinement

**Example:**
```
REQ-0042: "Improve error handling"

❌ Don't: Silently add try/catch blocks everywhere
✅ Do: Halt and ask:
  - "Improve" how? (user-facing messages? logging? retry logic?)
  - Which error scenarios? (network? validation? unexpected data?)
  - What's acceptable error UX? (fail silently? show message? redirect?)

Then log decision:
DECISION: Add validation error handling with user-facing messages
RATIONALE: User reported confusing silent failures on form submission
LINKED_REQ: REQ-0042 (refined to REQ-0042a: validation error UX)
```

---

## 2. Simplicity First (Enhanced for Agile V)

**Minimum code that satisfies REQ acceptance criteria. Nothing speculative.**

### No Features Beyond REQ Scope
- **No features beyond baselined REQ-XXXX** acceptance criteria
- **No abstractions for single-use code** unless REQ explicitly requires extensibility
- **No "flexibility" or "configurability"** that wasn't in REQ acceptance criteria
- **No error handling for impossible scenarios** (stay within REQ constraints)
- **If you write 200 lines and it could be 50, rewrite it**

Ask yourself: "Would a senior engineer call this overcomplicated?" If yes, simplify.

### Integration with Agile V
- **Artifact Traceability**: Every `ART-XXXX` links to exactly one REQ-XXXX. If code doesn't map to REQ acceptance criteria, it's out of scope.
- **Speculative Features**: If you think a feature might be useful but it's not in a REQ, **document as CR proposal**, don't implement.
- **Multi-Cycle Discipline**: Don't add "nice-to-haves" during implementation. Flag for next cycle.

**Example:**
```python
# ❌ Over-engineered for single REQ
# REQ-0010: Calculate 10% discount on orders over $100

class DiscountStrategy(ABC):
    @abstractmethod
    def calculate(self, amount: float) -> float: pass

class PercentageDiscount(DiscountStrategy): ...
class TieredDiscount(DiscountStrategy): ...
class ConfigurableDiscountEngine: ...

# ✅ Simple, traceable to REQ-0010
# ART-0010: Discount calculation
# Implements: REQ-0010 (10% discount on orders >$100)

def calculate_discount(order_total):
    """REQ-0010: 10% discount for orders over $100."""
    if order_total > 100:
        return order_total * 0.10
    return 0.0
```

**When abstraction IS warranted:**
- **≥2 distinct REQs** require the same pattern → justify abstraction with REQ-IDs
- **Example**: `REQ-0010` (discount), `REQ-0015` (shipping calc), `REQ-0020` (tax calc) all need pricing rules → abstraction justified. Document in Decision Log.

---

## 3. Surgical Changes (Enhanced for Multi-Cycle)

**Touch only what changed REQs require. Clean up only your own mess.**

### When Editing Existing Artifacts
- **Don't "improve" adjacent code** unless it's linked to a changed REQ or CR
- **Don't refactor things that aren't broken** (no drive-by optimizations)
- **Match existing style**, even if you'd do it differently (consistency > preference)
- **If you notice unrelated dead code**, log as **OBS-XXXX** (observation), don't delete

### When Your Changes Create Orphans
- **Remove imports/variables/functions that YOUR CR made unused** (document in CR)
- **Don't remove pre-existing dead code** unless CR explicitly scopes it

### Integration with Agile V
- **Multi-Cycle Discipline**: In Cycle 2+, only modify artifacts linked to `new` or `modified` REQs or active CRs
- **Change Request Scope**: Every line changed should trace to a CR-XXXX. If it doesn't, it's out of scope.
- **Regression Prevention**: Surgical changes → fewer unexpected regressions → faster Red Team verification

**The Test:** Every changed line should trace directly to a REQ-XXXX or CR-XXXX. If not, revert it.

**Example:**
```
Cycle 2: CR-0005 requires changing password validation (REQ-0002)

# ❌ Scope creep
def validate_password(password):
    # Changed per CR-0005
    if len(password) > 128:
        return False, "Max 128 chars"
    
    # UNRELATED: Reformatted entire function, fixed typo in adjacent comment,
    # "improved" variable naming in unrelated login() function

# ✅ Surgical
def validate_password(password):
    # CR-0005: Add max length validation
    if len(password) > 128:
        return False, "Password must be 128 characters or less"
    
    # (rest of function unchanged)
```

---

## 4. Goal-Driven Execution (Enhanced for Red Team Protocol)

**Transform REQ acceptance criteria into TC-XXXX. Success = TC passes, not "code runs."**

### REQ → Verifiable Goals
Every REQ acceptance criterion becomes a test case:

- **"Add validation"** → `TC-XXXX: Invalid inputs rejected with specific error messages`
- **"Fix the bug"** → `TC-XXXX: Reproduce bug, verify fix, ensure no regression`
- **"Refactor X"** → `TC-XXXX: All existing tests pass before and after`

### Integration with Agile V
- **Red Team Protocol (Directive #4)**: Build Agent does **not** verify own work
- **Test Designer Parallel Execution**: TC-XXXX created from REQ-XXXX only (independent of ART-XXXX)
- **Auto-Fix Loop**: If Red Team finds failures, max 3 attempts, then escalate to Human Gate

**For Multi-Step Synthesis:**
State a brief plan with verification checkpoints:
```
REQ-0025: User profile update with avatar upload

Build Plan:
1. Create upload endpoint → verify: TC-0025-01 (accepts valid image)
2. Add image validation → verify: TC-0025-02 (rejects invalid files)
3. Save to storage → verify: TC-0025-03 (file persisted, URL returned)
4. Update user record → verify: TC-0025-04 (DB reflects new avatar)
5. Integration test → verify: TC-0025-05 (end-to-end flow)
```

**Weak vs Strong Success Criteria:**

| Weak (avoid) | Strong (use) |
|---|---|
| "Make it work" | "TC-0025-01 passes: Valid JPEG upload returns 200 + URL" |
| "Add tests" | "TC-0025-02: Rejects files >5MB with 413 error" |
| "Improve performance" | "TC-0025-06: Upload completes in <2s for 1MB file" |

Strong criteria enable **independent Red Team verification** and **auto-fix loops** without constant clarification.

---

## Behavioral Checklist (Use Before Committing ART-XXXX)

Before marking artifact complete, verify:

- [ ] **No silent assumptions** — all REQ interpretations documented in Decision Log
- [ ] **No speculative features** — every line maps to REQ acceptance criteria or CR scope
- [ ] **Surgical changes only** — unchanged REQs → unchanged artifacts (multi-cycle)
- [ ] **Verifiable success** — TC-XXXX exists for every REQ acceptance criterion
- [ ] **Traceability intact** — `# ART-XXXX: ... | Implements: REQ-XXXX` present and REQ revision is baselined
- [ ] **Halt conditions respected** — no improvisation on ambiguous REQs

---

## Load Conditions

Always load alongside `agile-v-core` and any build agent skill. This skill adds behavioral guardrails that prevent the four most common agent failure modes: silent assumptions, overengineering, scope creep, and weak test criteria.

**License:** CC-BY-SA-4.0 | **Author:** Agile V™  
**Adapted from:** Karpathy Skills (MIT License) | **Homepage:** https://github.com/Agile-V/agile_v_skills
