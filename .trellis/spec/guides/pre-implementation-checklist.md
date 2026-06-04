# Pre-Implementation Checklist

> **Purpose**: Ask the right questions **before** writing code to avoid common architectural mistakes.

---

## Why This Checklist?

Most code quality issues aren't caught during implementation--they're **designed in** from the start:

| Problem                               | Root Cause                                | Cost                       |
| ------------------------------------- | ----------------------------------------- | -------------------------- |
| Constants duplicated across 5 files   | Didn't ask "will this be used elsewhere?" | Refactoring + testing      |
| Same logic repeated in multiple hooks | Didn't ask "does this pattern exist?"     | Creating abstraction later |
| Cross-layer type mismatches           | Didn't ask "who else consumes this?"      | Debugging + fixing         |

**This checklist catches these issues before they become code.**

---

## The Checklist

### 1. Constants & Configuration

Before adding any constant or config value:

- [ ] **Cross-layer usage?** Will this value be used in both main process and renderer?
  - If yes -> Put in `shared/constants/` or similar shared location
  - Example: `MAX_FILE_SIZE` used by both file picker UI and main process validation

- [ ] **Multiple consumers?** Will this value be used in 2+ files within the same layer?
  - If yes -> Put in a shared constants file for that layer
  - Example: Don't define `DEBOUNCE_MS = 2000` in each hook file

- [ ] **Magic number?** Is this a hardcoded value that could change?
  - If yes -> Extract to named constant with comment explaining why
  - Example: `MAX_BATCH_SIZE: 100  // SQLite query limit for performance`

### 2. Logic & Patterns

Before implementing any logic:

- [ ] **Pattern exists?** Search for similar patterns in the codebase first

  ```bash
  # Example: Before implementing debounced save
  rg "setTimeout.*save" src/
  rg "debounce" src/
  ```

- [ ] **Will repeat?** Will this exact logic be needed in 2+ places?
  - If yes -> Create a shared hook/utility **first**, then use it
  - Example: `useDebounce` instead of repeating debounce logic in 5 hooks

- [ ] **Callback pattern?** Does the logic need optional callbacks (onStart, onComplete, onError)?
  - If yes -> Design the abstraction with callback support from the start
  - Example: `useAutoSave({ onSaveStart, onSaveComplete, onSaveError })`

### 3. Types & Interfaces

Before defining types:

- [ ] **Cross-layer type?** Is this type used across IPC boundary?
  - If yes -> Define in shared types location
  - Never duplicate type definitions between main and renderer

- [ ] **Existing type?** Does a similar type already exist?
  - Search before creating: `rg "interface.*YourTypeName" src/`

### 4. UI Components

Before creating UI components:

- [ ] **Visual-logic consistency?** If there's already a visual distinction (icon, color, label) for a concept, does your logic match?
  - Example: If todos show priority icons in a specific order, sorting logic should use the same order

- [ ] **State lifecycle?** Will this component unmount during normal user flow?
  - If yes -> Consider where state should persist (parent, context, store)

---

## Quick Decision Tree

```
Adding a value/constant?
|-- Used in main AND renderer? -> shared/constants/
|-- Used in 2+ renderer files? -> renderer/shared/constants/
|-- Used in 2+ main files? -> main/shared/constants/
+-- Single file only? -> Local constant is fine

Adding logic/behavior?
|-- Similar pattern exists? -> Extend or reuse existing
|-- Will be used in 2+ places? -> Create shared hook/utility first
+-- Single use only? -> Implement directly (but document pattern)
```

---

## Anti-Patterns to Avoid

### Copy-Paste-Modify

```typescript
// DON'T: Same logic in 5 files
// useDocuments.ts, useNotes.ts, useSettings.ts, etc.
const DEBOUNCE_MS = 2000;
const triggerSave = useCallback(() => {
  // 20 lines of identical logic
}, []);
```

### Shared Abstraction

```typescript
// DO: Single source of truth
// hooks/useAutoSave.ts
import { AUTO_SAVE_DELAY } from '@shared/constants';
export function useAutoSave(options) {
  /* logic once */
}

// useDocuments.ts
const save = useAutoSave({ data: document });
```

### Local Constant Aliases

```typescript
// DON'T: Create local aliases for imported constants
import { CONFIG } from '@shared/constants';
const DEBOUNCE_MS = CONFIG.DEBOUNCE_MS; // Unnecessary!
const MAX_SIZE = CONFIG.MAX_SIZE; // Unnecessary!
```

### Direct Usage

```typescript
// DO: Use imported constants directly
import { CONFIG } from '@shared/constants';
setTimeout(fn, CONFIG.DEBOUNCE_MS);
if (size > CONFIG.MAX_SIZE) {
  /* ... */
}
```

---

## When to Use This Checklist

| Trigger                                    | Action                    |
| ------------------------------------------ | ------------------------- |
| About to add a constant                    | Run through Section 1     |
| About to implement logic                   | Run through Section 2     |
| About to define a type                     | Run through Section 3     |
| About to create a component                | Run through Section 4     |
| Feels like you've seen similar code before | **STOP** and search first |

---

## Relationship to Other Guides

| Guide                                                         | Focus                     | Timing                      |
| ------------------------------------------------------------- | ------------------------- | --------------------------- |
| **Pre-Implementation Checklist** (this)                       | Questions before coding   | Before writing code         |
| [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md)   | Patterns and abstractions | During/after implementation |
| [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) | Data flow across layers   | Complex feature planning    |

**Ideal workflow:**

1. Read this checklist before coding
2. Reference Code Reuse guide for abstraction patterns
3. Use Cross-Layer guide for features spanning multiple layers

---

## Lessons Learned

| Date | Issue                                  | Lesson                                                             |
| ---- | -------------------------------------- | ------------------------------------------------------------------ |
| -    | `DEBOUNCE_MS` duplicated in 5 hooks    | Always ask "will this constant be used elsewhere?" before defining |
| -    | Debounce + save logic copied 5 times   | If logic will repeat, create abstraction **before** first use      |
| -    | Created `const X = IMPORTED.X` aliases | Never create local aliases for imported constants--use directly    |
| -    | Type defined in both main and renderer | Cross-IPC types must be in shared location                         |

---

**Core Principle**: 5 minutes of checklist thinking saves 50 minutes of refactoring.
