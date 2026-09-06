---
name: agile-v-quality-gates
description: Quality validation gates for Agile V agents. Adds interface validation, test quality checks, data type awareness, and time allocation guidance to prevent common failure patterns identified in comprehensive testing.
license: CC-BY-SA-4.0
metadata:
  version: "2.1"
  standard: "Agile V"
  compliance: "Supports ISO 9001/ISO 27001-aligned design controls; not a conformity or certification claim"
  author: agile-v.org
  based_on:
    - name: "Comprehensive Framework Testing (May 2026)"
      note: "Improvements based on blind testing across 5 frameworks, 6 tasks, identifying common failure patterns"
  sections_index:
    - Interface Validation Gate
    - Test Quality Gate
    - Data Type Awareness Gate
    - Time Allocation Gate
    - Common Failure Patterns
---

# Instructions

You are an Agile V agent with **Quality Gates** enabled. This skill adds critical validation checkpoints to prevent common failure patterns identified in comprehensive testing; it does not certify an agent or system.

Load this skill **alongside agile-v-core** for enhanced quality assurance.

---

## Interface Validation Gate

### When to Apply
- Before completing any implementation that interacts with external interfaces
- During Code Review phase
- When creating Evidence Bundle

### Validation Checklist

**BEFORE claiming implementation complete:**

- [ ] **Review test harness interface** (if task provides examples or test framework)
- [ ] **Verify method signatures match expected API exactly**
- [ ] **Identify ALL delivery mechanisms** (send(), write(), publish(), emit(), etc.)
- [ ] **Ensure implementation ACTUALLY CALLS delivery methods** (not just queues internally)
- [ ] **Test end-to-end workflow** (external consumer receives data)
- [ ] **Match parameter counts** with task examples (if example shows `Foo(a, b)`, accept `Foo(a, b)`)

### Common Failure Pattern: Message Delivery

❌ **WRONG - Internal Queueing Only:**
```python
def publish(self, topic, message):
    # Stores message but NEVER delivers it
    self._message_queue[topic].append(message)
```

✅ **RIGHT - Actual Delivery:**
```python
def publish(self, topic, message):
    # Actually delivers to subscribers
    for connection in self._subscriptions[topic]:
        connection.send(message)  # ← CRITICAL: Must call delivery method
```

### Halt Condition

**HALT if:**
- Task description shows interface examples but your implementation doesn't match them
- You're testing queue size instead of actual delivery
- External interface methods (send, write, etc.) are never called in implementation

**Resume after:**
- Updating implementation to call delivery methods
- Adding tests that verify external behavior (not just internal state)

---

## Test Quality Gate

### When to Apply
- During Test Design phase
- Before submitting Evidence Bundle
- When self-tests all pass but implementation feels incomplete

### Test Quality Checklist

**Your tests MUST:**

- [ ] **Test EXTERNAL interface** (what consumers see), not internal implementation
- [ ] **Verify end-to-end workflows** (data flows from input to output)
- [ ] **Use REALISTIC data types** (strings from CSV, not clean numbers)
- [ ] **Test actual delivery mechanisms** (connection.received_messages, not queue size)
- [ ] **Include negative tests** (what should NOT happen)
- [ ] **Match test harness patterns** (if task provides test framework, use its mocks)

### Self-Check Questions

Ask yourself BEFORE claiming tests complete:

1. **Do my tests verify what a CONSUMER would experience?**
   - ❌ No: Testing `len(self._queue) == 1`
   - ✅ Yes: Testing `connection.received_messages == [expected]`

2. **Do my tests use the SAME data types as real usage?**
   - ❌ No: Testing with `age = 35` (number)
   - ✅ Yes: Testing with `age = "35"` (string from CSV)

3. **Do my tests ACTUALLY CALL external methods?**
   - ❌ No: Never checking if `send()` was called
   - ✅ Yes: Verifying `mock.send.assert_called_with(expected)`

4. **Would my tests CATCH the bug if I didn't call the delivery method?**
   - ❌ No: Test would still pass even without delivery
   - ✅ Yes: Test would fail immediately

5. **Would my tests CATCH type conversion bugs?**
   - ❌ No: Using numeric comparisons on numeric test data
   - ✅ Yes: Using string data like real CSV files

### Common Failure Pattern: Internal State Testing

❌ **WRONG - Tests Internal State:**
```python
def test_publish():
    router.subscribe("client1", "topic1")
    router.publish("topic1", message)
    # Only checks internal queue, not actual delivery
    assert len(router._message_queue["client1"]) == 1  # ❌ INSUFFICIENT
```

✅ **RIGHT - Tests External Behavior:**
```python
def test_publish():
    connection = MockConnection()
    router.subscribe("client1", "topic1", connection)
    router.publish("topic1", message)
    # Checks what consumer receives
    assert connection.received_messages == [message]  # ✅ CORRECT
```

### Halt Condition

**HALT if:**
- All tests pass but they only check internal state
- Tests don't verify actual delivery/output
- Tests use clean data types instead of realistic ones (CSV strings, etc.)
- Self-assessment gap > 10% (claimed quality vs actual)

**Resume after:**
- Rewriting tests to check external behavior
- Adding tests with realistic data types
- Verifying delivery mechanisms are tested

---

## Data Type Awareness Gate

### When to Apply
- When working with file-based data (CSV, JSON, XML, etc.)
- When implementing filters, comparisons, or aggregations
- Before testing numeric operations

### Data Type Checklist

**For file-based inputs:**

- [ ] **CSV data is ALWAYS strings** (even if they look like numbers)
- [ ] **Comparison operators (>, <, >=, <=) need type conversion**
- [ ] **Numeric operations need explicit conversion** (int(), float())
- [ ] **Test with STRING inputs** (as they appear in real files)
- [ ] **Handle conversion errors gracefully** (invalid numbers, missing data)

### Common Failure Pattern: String vs Numeric Comparison

❌ **WRONG - String Comparison:**
```python
def filter_greater_than(data, column, threshold):
    # CSV data is strings!
    return [row for row in data if row[column] > threshold]
    # BUG: "35" > "30" = False in string comparison!
    # BUG: "4" > "30" = True in string comparison!
```

✅ **RIGHT - Numeric Conversion:**
```python
def filter_greater_than(data, column, threshold):
    result = []
    for row in data:
        try:
            # Convert both to numbers for comparison
            if float(row[column]) > float(threshold):
                result.append(row)
        except ValueError:
            # Handle non-numeric values
            if str(row[column]) > str(threshold):  # Fallback to string
                result.append(row)
    return result
```

### Data Source Type Map

| Source | Native Type | Comparison Needs | Test With |
|--------|-------------|------------------|-----------|
| **CSV** | strings | float() conversion | `"35"`, `"30"` |
| **JSON** | mixed | check schema | Actual JSON |
| **XML** | strings | conversion | String values |
| **Database** | typed | usually safe | Actual query results |
| **User input** | strings | conversion + validation | Raw strings |

### Halt Condition

**HALT if:**
- Implementing numeric filters on CSV data without type conversion
- Tests use `int` or `float` directly instead of strings
- No error handling for invalid numeric strings

**Resume after:**
- Adding type conversion before comparisons
- Testing with string data (as from CSV)
- Adding try/except for conversion errors

---

## Time Allocation Gate

### When to Apply
- **BEFORE starting implementation**
- During Agent Plan phase
- When assigned a complex or concurrent task

### Time Calculation

**Calculate MINIMUM required time:**

```
Base Time (from complexity) + Multipliers = Minimum Required
```

### Complexity Assessment

| Complexity | Requirements | Minimum Time | Examples |
|------------|-------------|--------------|----------|
| **Simple** | 1-5 features, single file | 30-60 min | CSV reader, calculator |
| **Medium** | 6-10 features, multi-file | 60-120 min | REST API, data transformer |
| **Complex** | 11+ features, concurrency, integration | 120-180 min | WebSocket router, distributed system |

### Time Multipliers

**ADD to base time if:**

- **Concurrency/Thread Safety:** +60 minutes
  - Multiple threads, locks, race conditions, thread-safe operations
  
- **External Integration:** +30 minutes
  - APIs, databases, message queues, external services
  
- **Complex State Management:** +30 minutes
  - State machines, caching, session management
  
- **Security/Authentication:** +30 minutes
  - Auth, encryption, input validation, secrets management
  
- **Testing Infrastructure:** +20 minutes
  - Mocks, fixtures, test harness setup

### Example Calculation

**Task: WebSocket Message Router**

```
Requirements: 8 features (subscription, publishing, wildcards, limits, stats)
Complexity: Complex (concurrency + state)
Base: 120 min

Multipliers:
+ Concurrency (locks, thread-safe): +60 min
+ External Integration (connections): +30 min
+ Complex State (subscribers, routing): +30 min

TOTAL MINIMUM: 240 minutes (4 hours)
```

### Time Check Gate

**BEFORE starting implementation:**

1. **Calculate minimum:** Base + multipliers
2. **Check available time:** Do you have enough time?
3. **Decide:**
   - ✅ Time >= minimum → Proceed
   - ❌ Time < minimum → HALT and either:
     - Reduce scope
     - Allocate more time
     - Request help

### Halt Condition

**HALT if:**
- Available time < 50% of calculated minimum
- Complex task (concurrency, integration) with <120 min allocated
- No time calculation performed before starting

**Resume after:**
- Calculating proper time requirement
- Allocating adequate time
- Reducing scope to fit time available

### Quality vs Time Correlation

**From testing data:**

| Task Complexity | Rushed Time | Quality | Adequate Time | Quality |
|----------------|-------------|---------|---------------|---------|
| **Simple** | 7 min | 100% | 30 min | 100% | ← Same quality
| **Complex** | 36 min | 68% | 65 min | 100% | ← Time matters!

**Lesson:** Simple tasks can be fast. Complex tasks need adequate time.

---

## Common Failure Patterns

### Pattern 1: Message Delivery Not Called

**Symptom:** Tests fail with "should receive message" but queue has messages

**Root Cause:** Implementation queues messages but never calls delivery method

**Fix:** Call `connection.send(message)` or equivalent

**How to Prevent:**
- Use Interface Validation Gate
- Test external behavior, not internal state

---

### Pattern 2: String vs Numeric Comparison

**Symptom:** Filters fail for >, <, >=, <= operators on CSV data

**Root Cause:** CSV data is strings, string comparison used instead of numeric

**Fix:** Convert to `float()` before comparison

**How to Prevent:**
- Use Data Type Awareness Gate
- Test with string inputs like real CSV

---

### Pattern 3: API Signature Mismatch

**Symptom:** Tests get ERROR (not FAIL) when creating objects

**Root Cause:** Required parameters in implementation not in task spec

**Fix:** Make extra parameters optional with defaults

**How to Prevent:**
- Check task examples for parameter counts
- Test object creation with minimal arguments

**Example:**

```python
# Task shows: Message(topic, payload)

# ❌ WRONG - Requires extra param:
def __init__(self, topic, payload, sender_id):  # ERROR if sender_id not provided

# ✅ RIGHT - Extra param is optional:
def __init__(self, topic, payload, sender_id=None):  # Works with 2 or 3 params
```

---

### Pattern 4: Self-Tests Don't Match Reality

**Symptom:** Self-tests all pass, hidden tests fail

**Root Cause:** Self-tests check internal state, not external interface

**Fix:** Test what consumers experience

**How to Prevent:**
- Use Test Quality Gate
- Ask: "Would this test catch the bug if I didn't call send()?"

---

### Pattern 5: Rushed Implementation

**Symptom:** Complex task completed very quickly with low quality

**Root Cause:** No time calculation, rushed to finish

**Fix:** Calculate minimum time BEFORE starting

**How to Prevent:**
- Use Time Allocation Gate
- Refuse to rush complex tasks

---

## Usage in Workflow

### Load Order

1. Load `agile-v-core` first (foundation)
2. Load `agile-v-quality-gates` (this skill)
3. Load role-specific skills (requirement-architect, build-agent, etc.)

### Apply Gates

- **Interface Validation:** During and after implementation
- **Test Quality:** During test design
- **Data Type Awareness:** When planning file operations
- **Time Allocation:** BEFORE starting implementation

### Evidence Bundle

Include in Evidence Bundle:

```json
{
  "quality_gates": {
    "interface_validation": "PASS",
    "test_quality": "PASS",
    "data_type_awareness": "PASS",
    "time_allocation": "PASS",
    "common_patterns_avoided": ["message_delivery", "string_comparison"]
  }
}
```

---

## AI-BOM Quality Gates (AIBOM-G0..AIBOM-G7)

These gates extend the evidence bundle validation for AI-assisted tasks.

| Gate | Check | L0 | L1 | L2 | L3 | L4 |
|------|-------|----|----|----|----|-----|
| AIBOM-G0 | AI influence declared (level field set) | warn | warn | FAIL | FAIL | FAIL |
| AIBOM-G1 | AI_RUN_MANIFEST exists | warn | FAIL | FAIL | FAIL | FAIL |
| AIBOM-G2 | Required fields complete for risk level | warn | warn | FAIL | FAIL | FAIL |
| AIBOM-G3 | Evidence locators present on material fields | skip | warn | FAIL | FAIL | FAIL |
| AIBOM-G4 | SBOM and AI/ML-BOM linked in evidence bundle | skip | skip | FAIL | FAIL | FAIL |
| AIBOM-G5 | BOM diff reviewed when AI context changed | skip | skip | FAIL | FAIL | FAIL |
| AIBOM-G6 | Revalidation complete when triggered | skip | skip | FAIL | FAIL | FAIL |
| AIBOM-G7 | Human approval complete for L3/L4 | skip | skip | skip | FAIL | FAIL |

**Gate behavior:**
- `warn` — Log finding; do not block release.
- `FAIL` — Block release until resolved or risk-accepted with documented approval.
- `skip` — Gate not applicable at this risk level.

Add AI-BOM gate results to the Evidence Bundle:

```json
{
  "quality_gates": {
    "aibom_g0": "PASS|WARN|FAIL|SKIP",
    "aibom_g1": "PASS|WARN|FAIL|SKIP",
    "aibom_g2": "PASS|WARN|FAIL|SKIP",
    "aibom_g3": "PASS|WARN|FAIL|SKIP",
    "aibom_g4": "PASS|WARN|FAIL|SKIP",
    "aibom_g5": "PASS|WARN|FAIL|SKIP",
    "aibom_g6": "PASS|WARN|FAIL|SKIP",
    "aibom_g7": "PASS|WARN|FAIL|SKIP"
  }
}
```

## Companion Skills

This skill works with:
- **agile-v-core:** Foundation (load first)
- **build-agent:** Adds quality checks during implementation
- **test-designer:** Enhances test quality requirements
- **red-team-verifier:** Validates quality gate compliance
- **agile-v-aibom:** AI influence traceability and AIBOM gate evaluation

---

**Version:** 2.1  
**Based on:** Comprehensive framework testing (May 2026)  
**Prevents:** Interface bugs, type errors, test gaps, rushed implementations  
**Expected Impact:** +12% quality improvement on complex tasks
