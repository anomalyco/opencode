# Bug Root Cause Thinking Guide

> **Purpose**: Analyze bugs systematically to understand whether they could have been prevented.

---

## Why Analyze Root Causes?

**Not all bugs are created equal**:

- Some bugs come from third-party library issues -> Hard to prevent
- Some bugs come from implicit assumptions -> Preventable with better thinking
- Some bugs come from missing specifications -> Preventable with better process

Understanding the root cause helps you:

1. Fix the bug correctly (not just the symptom)
2. Prevent similar bugs in the future
3. Improve your development process

---

## Bug Classification Framework

When you encounter a bug, classify it into one of these categories:

### Category 1: Third-Party Library Issues

**Characteristics**:

- You used the API as documented
- The library behaves differently than expected/documented
- Often discovered through runtime errors, not compile-time

**Example**: ORM Timestamp Bug

```typescript
// Documentation says:
integer('createdAt', { mode: 'timestamp' });
// Expected: Writes Unix seconds (integer)
// Actual: Sometimes writes "YYYY-MM-DD HH:MM:SS" (text)
```

**Prevention**:

- Cannot be prevented by better specs or thinking
- Can only be discovered through experience and documented as workarounds
- Add integration tests for critical data paths

**Action**:

1. Create a workaround
2. Document the issue for future reference
3. Consider adding defensive code for similar patterns

---

### Category 2: Implicit Assumptions

**Characteristics**:

- Code assumes something that isn't explicitly guaranteed
- Often involves function reuse where the assumption doesn't hold
- "It works in context A, so it should work in context B"

**Example**: Function Responsibility Confusion

```typescript
// Implicit assumption:
const result = await findItem(db, id);
if (result) {
  /* exists */
} else {
  /* doesn't exist, safe to create */
}

// Reality: findItem's job is "id -> item", not "check if can create"
// Edge case: Soft-deleted items might not be found but still block creation
```

**Prevention**:

- **Can be prevented by explicit function contracts**
- Use dedicated functions for specific purposes
- Don't assume functions do more than their name suggests

**Action**:

1. Add the missing explicit check
2. Document the function's exact responsibility
3. Add to code reuse thinking guide if it's a pattern

---

### Category 3: Missing Specifications

**Characteristics**:

- No clear rule about how something should behave
- Different developers might implement it differently
- Often discovered when systems interact

**Example**: Uniqueness Constraints

```
Expected: Same parent cannot have two items with same name
Implementation: Didn't enforce this rule
Result: Duplicate items created
```

**Prevention**:

- **Can be prevented by explicit specifications**
- When simulating a system, list its core constraints first
- Add constraints to design docs before coding

**Action**:

1. Add the missing specification
2. Implement the constraint in code
3. Add to relevant thinking guide

---

## Decision Tree: Is This Bug Preventable?

```
Start: Bug discovered
|
|-- Is this a documented library behavior?
|   |-- Yes, but I misread docs -> Preventable (read more carefully)
|   +-- No, library bug/undocumented behavior -> Not easily preventable
|
|-- Did I assume a function does more than its name suggests?
|   |-- Yes -> Preventable (explicit contracts)
|   +-- No -> Continue
|
|-- Was there a clear specification for this behavior?
|   |-- Yes, but I didn't follow it -> Preventable (follow specs)
|   +-- No, spec was missing -> Preventable (add specs first)
|
|-- Is this a race condition / timing issue?
|   |-- Yes -> Often preventable (atomic operations, locks)
|   +-- No -> Continue
|
+-- Is this a React state timing issue?
    |-- Yes -> Preventable (understand async state updates, use refs)
    +-- No -> Analyze further
```

---

## Quick Classification Checklist

| Question                                                | If Yes -> Category                   |
| ------------------------------------------------------- | ------------------------------------ |
| Did a library behave unexpectedly?                      | Third-Party Library Issue            |
| Did I assume a function does X but it only does Y?      | Implicit Assumption                  |
| Was there no clear rule for how this should work?       | Missing Specification                |
| Did I copy code without understanding its constraints?  | Implicit Assumption                  |
| Did I skip reading the existing implementation?         | Missing Specification (self-imposed) |
| Did I use state immediately after setState?             | React State Timing Issue             |
| Did a third-party hook fallback to unexpected behavior? | Third-Party + Implicit Assumption    |

---

## Preventable Bug Patterns

### Pattern 1: Function Responsibility Confusion

**Symptom**: Using function A for purpose B

**Example**:

```typescript
// findItem: "id -> item"
// Used for: "check if safe to create"
// Problem: These are different responsibilities
```

**Prevention Rule**:

> Each function should have ONE clear responsibility.
> If you need a different check, use or create a different function.

**Checklist**:

- [ ] What is this function's exact responsibility?
- [ ] Am I using it for that exact purpose?
- [ ] If not, is there a function for my actual need?

---

### Pattern 2: Missing System Constraints

**Symptom**: Simulated system doesn't enforce original system's rules

**Example**:

```typescript
// File system: unique names per directory
// Implementation: didn't enforce this
// Result: duplicate names
```

**Prevention Rule**:

> When simulating a system, list its core constraints BEFORE coding.

**Checklist**:

- [ ] What system am I simulating?
- [ ] What are its 3-5 core constraints?
- [ ] Are all constraints implemented in my code?

---

### Pattern 3: React State Timing

**Symptom**: Code expects state to be updated immediately after `setState`

**Example**:

```typescript
// Bug: First operation fails, second works
const [currentItem, setCurrentItem] = useState(null);

const service = useMemo(() => {
  if (!currentItem?.id) return undefined;
  return createService({ itemId: currentItem.id });
}, [currentItem?.id]);

async function handleSubmit() {
  if (!currentItem) {
    const newItem = await createItem(); // calls setCurrentItem(newItem)
    // BUG: currentItem is still null here! React state is async
    // service is still undefined
  }
  await service.doSomething(); // service is undefined -> error
}
```

**Prevention Rule**:

> `setState` is async. Never rely on state value immediately after setting it.
> Use refs to pass data across async boundaries within the same function.

**Fix**:

```typescript
const pendingRef = useRef<string | null>(null);

async function handleSubmit() {
  if (!currentItem) {
    pendingRef.current = data; // Store in ref
    await createItem(); // This sets state
    return; // Don't continue yet
  }
  await service.doSomething();
}

// Process when service is ready
useEffect(() => {
  if (pendingRef.current && service) {
    const data = pendingRef.current;
    pendingRef.current = null;
    service.doSomething(data);
  }
}, [service]);
```

**Checklist**:

- [ ] Am I reading state immediately after `setState`?
- [ ] Does a `useMemo`/`useCallback` depend on state that just changed?
- [ ] Should I use a ref to pass data across render cycles?

---

### Pattern 4: Third-Party Hook Fallback Behavior

**Symptom**: Hook behaves unexpectedly when optional parameter is undefined

**Example**:

```typescript
// Library hook with optional transport
const { doAction } = useLibraryHook({
  transport, // When undefined, silently falls back to HTTP
});

// In Electron app, there's no HTTP endpoint -> error
```

**Prevention Rule**:

> When using third-party hooks with optional parameters, always check:
>
> 1. What happens when the parameter is undefined/null?
> 2. Is there a fallback behavior? Is it documented?
> 3. Does the fallback make sense in your environment?

**Checklist**:

- [ ] What is the default behavior when this parameter is omitted?
- [ ] Is there a silent fallback that might not work in my environment?
- [ ] Should I prevent the hook from being called until the parameter is ready?

---

### Pattern 5: Assuming Data Format

**Symptom**: Code assumes data is in format X, but sometimes it's format Y

**Example**:

```typescript
// Assumed: createdAt is always Unix timestamp (number)
// Reality: Sometimes it's "YYYY-MM-DD HH:MM:SS" (string)
// Result: Invalid Date errors
```

**Prevention Rule**:

> Never trust external data format. Always validate or normalize.

**Checklist**:

- [ ] Where does this data come from?
- [ ] Is the format guaranteed by a schema?
- [ ] What happens if format is unexpected?

---

## Post-Bug Analysis Template

When you fix a bug, document it:

```markdown
## Bug: [Short Description]

**Category**: Third-Party / Implicit Assumption / Missing Spec

**What happened**:
[Describe the symptom]

**Root cause**:
[Explain why it happened]

**Could it have been prevented?**

- [ ] Yes -> How?
- [ ] No -> Why not?

**Fix applied**:
[Describe the fix]

**Prevention for future**:
[What process/check would prevent similar bugs?]
```

---

## Adding to Existing Guides

After analyzing a bug, add lessons to the appropriate guide:

| Bug Category          | Add To                          |
| --------------------- | ------------------------------- |
| Code reuse issue      | `code-reuse-thinking-guide.md`  |
| Cross-layer issue     | `cross-layer-thinking-guide.md` |
| New third-party quirk | Project documentation           |
| Missing domain spec   | Relevant spec document          |
| Database/ORM issue    | `db-schema-change-guide.md`     |

---

## Summary

| Category                  | Preventable? | Prevention Method                                        |
| ------------------------- | ------------ | -------------------------------------------------------- |
| Third-Party Library       | Rarely       | Tests + documentation                                    |
| Implicit Assumption       | Yes          | Explicit function contracts                              |
| Missing Specification     | Yes          | Specs before coding                                      |
| React State Timing        | Yes          | Use refs for cross-render data, understand async updates |
| Third-Party Hook Fallback | Yes          | Check fallback behavior when params are undefined        |

**Core Principle**: Most preventable bugs come from **implicit assumptions**. Make assumptions explicit.
