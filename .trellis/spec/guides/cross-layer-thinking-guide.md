# Cross-Layer Thinking Guide

> **Purpose**: Pre-implementation checklist for features that span multiple layers.
>
> **Core Principle**: 30 minutes of thinking saves 3 hours of debugging.

---

## When to Use This Guide

Use this guide when your feature:

- Touches 3+ layers (UI, State, IPC, Main Process, Database)
- Involves data transformation between layers
- Has real-time or event-driven components
- Receives data from external sources (files, APIs, other processes)

---

## Pre-Implementation Checklist

Before writing code, answer these questions:

### 1. Layer Identification

**Which layers does this feature touch?**

- [ ] UI Layer (React components, routes)
- [ ] State Layer (hooks, context, stores)
- [ ] IPC Layer (preload scripts, contextBridge)
- [ ] Main Process (Electron main, handlers)
- [ ] Database (SQLite queries, ORM)
- [ ] File System (reading/writing files)
- [ ] External (APIs, other processes)

### 2. Data Flow Direction

**How does data flow?**

```
Read Flow:  DB -> Main Process -> IPC -> Renderer -> Component -> UI
Write Flow: UI -> Component -> IPC -> Main Process -> DB
```

- [ ] Read-only (data flows from DB to UI)
- [ ] Write-only (data flows from UI to DB)
- [ ] Bidirectional (both directions)
- [ ] Event-driven (push from Main to Renderer)

### 3. Data Format at Each Layer

**What format is the data at each boundary?**

| Layer        | Format            | Example                                |
| ------------ | ----------------- | -------------------------------------- |
| Database     | SQL types         | `TEXT`, `INTEGER`, timestamps          |
| ORM          | TypeScript types  | `string`, `number`, `Date`             |
| Main Process | JS objects        | `{ id: string, createdAt: Date }`      |
| IPC          | Serializable JSON | `{ id: "abc", createdAt: 1234567890 }` |
| Renderer     | React state       | Component props, hooks                 |
| UI           | Rendered output   | HTML, custom components                |

### 3.1 Timestamp Format Convention (CRITICAL!)

**Design Principle**: Backend uses Unix milliseconds (number) everywhere. Frontend formats for display.

| Layer          | Format           | Code                            |
| -------------- | ---------------- | ------------------------------- |
| DB Schema      | `INTEGER`        | Store as Unix milliseconds      |
| Main Process   | Unix ms (number) | `date.getTime()`                |
| IPC Response   | Unix ms (number) | `date.getTime()`                |
| Renderer State | Unix ms (number) | Pass through                    |
| UI Display     | Formatted string | `new Date(ms).toLocaleString()` |

**Forbidden in IPC responses**:

```typescript
// BAD - returns ISO string, adds unnecessary parsing
createdAt: entity.createdAt.toISOString();

// GOOD - returns Unix milliseconds, consistent format
createdAt: entity.createdAt.getTime();
```

**Why Unix milliseconds?**

1. **Serializable** - Numbers serialize cleanly across IPC
2. **No parsing** - No timezone issues, no string parsing
3. **Math-friendly** - Easy to compare, sort, calculate durations
4. **Consistent** - Same format everywhere reduces bugs

### 4. Data Transformation Points

**Where does format change? Who is responsible?**

| From         | To             | Transformer     | Location              |
| ------------ | -------------- | --------------- | --------------------- |
| DB timestamp | Unix ms        | ORM/Handler     | Main process handlers |
| Unix ms      | Display string | React component | UI components         |
| User input   | Validated data | Form handler    | Renderer              |

### 5. Boundary Questions (Critical!)

For each layer boundary, ask:

**IPC Boundary (Main <-> Renderer):**

- What format does the main process return?
- How does the renderer parse it?
- What happens if the format is unexpected?
- Is the data serializable? (no functions, no circular refs)

**Database <-> Main Process:**

- Are timestamps in seconds or milliseconds?
- Are IDs strings or numbers?
- What about null vs undefined?
- Does the ORM transform types automatically?

**State <-> UI:**

- Does the component handle loading states?
- What if the data is stale?
- How are errors propagated?

### 6. Edge Cases

- [ ] What if the data is empty/null?
- [ ] What if the database operation fails?
- [ ] What if the IPC call times out?
- [ ] What if a referenced entity doesn't exist?
- [ ] What if the user closes the window mid-operation?

### 7. Third-Party Library Boundaries

When using external libraries:

**Before using a third-party library, ask:**

- [ ] **What does it export?** Check `.d.ts` files
- [ ] **Does it work in both processes?** Main vs Renderer
- [ ] **Does it require a Context Provider?** When is the context available?
- [ ] **What are the default behaviors?** (e.g., default values, fallbacks)
- [ ] **How does it handle errors?**

**Common Third-Party Library Issues:**

| Issue                     | Root Cause                                            | Solution                             |
| ------------------------- | ----------------------------------------------------- | ------------------------------------ |
| `useContext` returns null | Hook called before Provider mounts                    | Use `isMounted` pattern              |
| Duplicate UI elements     | Library has default behavior you're also implementing | Check defaults, use `disable*` props |
| Import errors             | Assumed API that doesn't exist                        | Always verify exports in `.d.ts`     |
| Type mismatches           | Library types don't match your types                  | Create adapter functions             |

---

## Common Patterns

### Pattern A: Data Read Flow

**Layers**: UI -> IPC -> Main Process -> Database

**Data Flow**:

```
1. Component: Calls IPC method via preload
2. IPC: Sends message to main process
3. Main: Queries database
4. Main: Transforms data (timestamps, relations)
5. IPC: Returns serialized JSON
6. Component: Updates state, renders
```

**Common Issues**:

- **Date serialization**: Dates become strings over IPC, need to parse
- **Large data**: Consider pagination for large result sets
- **Stale data**: Component may unmount before IPC returns

### Pattern B: Data Write Flow

**Layers**: UI -> Validation -> IPC -> Main Process -> Database

**Data Flow**:

```
1. User: Fills form, clicks submit
2. Component: Validates input
3. IPC: Sends write request
4. Main: Validates again (never trust renderer)
5. Main: Writes to database
6. Main: Returns result
7. Component: Updates UI, shows success/error
```

**Common Issues**:

- **Double validation**: Always validate in main process, renderer validation is UX only
- **Optimistic updates**: May need to rollback if write fails
- **Race conditions**: Multiple writes to same entity

### Pattern C: Event-Driven Updates

**Layers**: Database Change -> Main Process -> IPC Event -> Renderer

**Data Flow**:

```
1. Database: Data changes (insert/update/delete)
2. Main: Detects change
3. IPC: Sends event to renderer (webContents.send)
4. Renderer: Receives event (ipcRenderer.on)
5. Component: Updates state, re-renders
```

**Common Issues**:

- **Event ordering**: Events may arrive out of order
- **Memory leaks**: Listeners not removed on unmount
- **Missing events**: Renderer not ready when event sent

### Pattern D: File Operations

**Layers**: UI -> IPC -> Main Process -> File System

**Data Flow**:

```
1. User: Selects file or triggers save
2. IPC: Sends file operation request
3. Main: Performs file I/O
4. Main: Returns result
5. Component: Updates UI
```

**Common Issues**:

- **Path handling**: Use `path.join()`, handle different OS path separators
- **Permissions**: May not have read/write access
- **Large files**: Consider streaming for large files

### Pattern E: AI/Streaming Responses

**Layers**: AI Provider -> Main Process -> IPC Stream -> Renderer

**Data Flow**:

```
1. User: Sends prompt
2. IPC: Sends request to main
3. Main: Calls AI API with streaming
4. Main: Streams chunks via IPC events
5. Renderer: Accumulates chunks, updates UI
6. Main: Sends completion event
```

**CRITICAL: Streaming can be interrupted at any point!**

**Common Issues**:

- **Incomplete data**: Stream may stop mid-response
- **Error handling**: Need to handle partial results
- **State management**: UI must handle streaming state

**Checklist for streaming**:

- [ ] Do you handle stream interruption gracefully?
- [ ] Do you filter out incomplete data before saving?
- [ ] Do you show loading/streaming state in UI?
- [ ] Do you handle errors during streaming?

---

## Lessons from Common Bugs

| Bug                       | Root Cause                                          | Prevention                               |
| ------------------------- | --------------------------------------------------- | ---------------------------------------- |
| `Invalid Date` in UI      | Timestamp format mismatch (seconds vs milliseconds) | Always use milliseconds, validate format |
| Data not updating         | IPC returns stale data, component doesn't re-fetch  | Use proper cache invalidation            |
| Memory leak               | IPC listener not removed on unmount                 | Always remove listeners in cleanup       |
| Type error after IPC      | Assumed type that doesn't match actual data         | Validate/parse IPC responses             |
| Duplicate operations      | User clicks button multiple times                   | Disable button during operation          |
| `useContext` returns null | Hook called before Provider mounts                  | Use `isMounted` pattern                  |
| Path errors on Windows    | Using `/` instead of `path.join()`                  | Always use `path` module                 |

---

## Checklist Template

Copy this for your feature:

```markdown
## Feature: [Name]

### Layers Involved

- [ ] UI Layer
- [ ] State Layer
- [ ] IPC Layer
- [ ] Main Process
- [ ] Database
- [ ] File System
- [ ] External

### Data Flow

[Describe the flow]

### Format at Each Layer

| Layer | Format |
| ----- | ------ |
| ...   | ...    |

### Transformation Points

| From | To  | Who |
| ---- | --- | --- |
| ...  | ... | ... |

### Edge Cases Considered

- [ ] Empty/null data
- [ ] Invalid format
- [ ] Operation failure
- [ ] User cancellation
```

---

## Cross-Layer Review Mindset

### The Comparison Trap

**Wrong thinking**: "This line wasn't changed, so it must be correct."

```
Comparison thinking (surface level):
  Before: toISOString() -> After: toISOString() -> "No change, must be fine"

Global thinking (design level):
  Design intent: Unix milliseconds everywhere -> Current: ISO string -> "This is a bug"
```

**Key insight**: Review validates "system state is correct", not just "change is correct".

### Data Outlet Checklist

Every review must cover ALL data outlets:

```
Data Outlets:
|-- IPC Response (main -> renderer)
|-- IPC Events (pushed to renderer)
|-- File writes
|-- Log output
|-- Any external interface
```

Ask: **"Is the format correct at EACH outlet?"**

### Review Three Questions

Before finishing any cross-layer review:

1. **Outlet Question**: Have I checked ALL data outlets, not just the "core" one?
2. **Design Question**: Does existing code match design principles? (Not "is the change correct?")
3. **Checklist Question**: Could my checklist itself be wrong?

### Validation vs Verification

| Approach        | Focus                        | Risk                                 |
| --------------- | ---------------------------- | ------------------------------------ |
| **Incremental** | "Is this change correct?"    | Misses pre-existing bugs             |
| **Global**      | "Is the system correct now?" | More thorough, catches legacy issues |

Always prefer global verification for cross-layer features.

---

## When Things Go Wrong

If you encounter a cross-layer bug:

1. **Identify the boundary** - Where exactly does it fail?
2. **Log at boundaries** - Add logging before and after each transformation
3. **Check assumptions** - What format did you expect vs what you got?
4. **Test in isolation** - Can you reproduce with a simple test case?
5. **Document the fix** - Add to "Lessons from Common Bugs" table

---

**Language**: All documentation should be written in **English**.
