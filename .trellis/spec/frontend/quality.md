# Code Quality Guidelines

> Performance and code quality standards.

---

## Package Manager

**Use pnpm** for monorepo projects:

```bash
# Good (from repo root)
pnpm install
pnpm lint
pnpm typecheck

# Also OK (with workspace filter)
pnpm --filter @your-app/desktop lint

# Avoid mixing package managers
npm install  # Don't
yarn install # Don't
```

---

## Before Every Commit

Run these checks before committing:

```bash
# 1. Type check
pnpm typecheck  # or: pnpm exec tsc --noEmit

# 2. Lint
pnpm lint

# 3. Manual testing
# Test the feature you changed
```

**Checklist**:

- [ ] `pnpm typecheck` - No type errors
- [ ] `pnpm lint` - 0 errors, 0 warnings
- [ ] Manual testing passes
- [ ] No console errors in DevTools

---

## Forbidden Patterns

| Pattern                             | Reason             | Fix                                 |
| ----------------------------------- | ------------------ | ----------------------------------- |
| Non-null assertions (`!`)           | Type unsafe        | Use local variable after null check |
| `any` type                          | Loses type safety  | Use proper types or `unknown`       |
| Unused imports/variables            | Dead code          | Remove or prefix with `_`           |
| Lexical declarations in bare `case` | ESLint error       | Wrap case body in `{}`              |
| Duplicate constant definitions      | Maintenance burden | Use shared constants                |

---

## Non-null Assertion Fix

```typescript
// Bad - non-null assertion
if (result.success && result.data) {
  doSomething(result.data!);
}

// Good - use local variable
if (result.success && result.data) {
  const data = result.data; // TypeScript knows this is defined
  doSomething(data);
}
```

---

## Switch Case with Lexical Declarations

When declaring variables (with `const`/`let`) inside a `case` block, you MUST wrap the block in braces `{}`:

```typescript
// Bad - ESLint error: "Unexpected lexical declaration in case block"
switch (value) {
  case 'today':
    const date = new Date(); // Error!
    break;
}

// Good - wrap in braces
switch (value) {
  case 'today': {
    const date = new Date(); // OK
    break;
  }
}
```

---

## Exhaustive Switch Check

Use `_exhaustive` pattern for exhaustive switch checks. The `_` prefix tells ESLint this variable is intentionally unused:

```typescript
type Status = "open" | "closed" | "pending";

function getIcon(status: Status) {
  switch (status) {
    case "open":
      return <OpenIcon />;
    case "closed":
      return <ClosedIcon />;
    case "pending":
      return <PendingIcon />;
    default: {
      // TypeScript will error if a case is missing
      const _exhaustive: never = status;
      return null;
    }
  }
}
```

---

## Clean Up Unused Imports

After refactoring, always check for and remove unused imports:

```typescript
// Bad - unused imports
import { todoStateSchema, todoPrioritySchema } from '../shared/types/entity';
// ... code that doesn't use these schemas

// Good - only import what you use
import type { TodoState, TodoPriority } from '../shared/types/entity';
```

**Tip**: Run `pnpm lint` before committing to catch unused imports.

---

## Avoid Duplicate Definitions

Before defining constants, mappings, or configuration values, **search the codebase first**:

```bash
# Search for existing definitions
grep -r "ALLOWED_TYPES\|allowedTypes" src/
grep -r "extension.*mime" src/
```

**Common locations for shared constants**:

| Type             | Location                              |
| ---------------- | ------------------------------------- |
| IPC channels     | `src/shared/constants/channels.ts`    |
| File type limits | `src/shared/constants/file-limits.ts` |
| App config       | `src/shared/constants/config.ts`      |

**Cross-process sharing**: Constants in `src/shared/` can be imported by both main process and renderer.

```typescript
// Bad - duplicate definition in renderer
const typeMap = { jpg: 'image/jpeg', png: 'image/png' };

// Good - import from shared
import { EXTENSION_TO_MIME } from '../shared/constants/file-limits';
```

---

## Performance Guidelines

### Avoid Unnecessary Re-renders

```tsx
// Bad - inline function creates new reference every render
<List items={items.filter((item) => item.active)} />;

// Good - memoize filtered list
const activeItems = useMemo(() => items.filter((item) => item.active), [items]);
<List items={activeItems} />;
```

### Lazy Loading

```tsx
// Lazy load heavy components
const HeavyComponent = lazy(() => import('./HeavyComponent'));

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <HeavyComponent />
    </Suspense>
  );
}
```

### Local Async Panels vs Suspense

For Solid UI, do not use `createResource` for a small panel whose loading state must stay local while the page remains visible. A pending resource can be captured by a parent `<Suspense>` boundary and replace the whole route with its fallback.

```tsx
// Bad: panel click can blank the whole route if a parent Suspense catches the pending resource.
const [items] = createResource(selectedRepo, loadRepoItems);

// Good: keep panel loading local; the surrounding page stays mounted.
const [items, setItems] = createSignal<Item[]>([]);
const [loading, setLoading] = createSignal(false);
```

Use `createResource` for page-level async data that should participate in Suspense. Use `createSignal` plus explicit loading/error state for click-driven side panels, tabs, drawers, and other local UI regions.

### Debounce Expensive Operations

```tsx
// Debounce search input
const [query, setQuery] = useState('');
const debouncedQuery = useDebounce(query, 300);

useEffect(() => {
  if (debouncedQuery) {
    performSearch(debouncedQuery);
  }
}, [debouncedQuery]);
```

---

## Code Organization

### File Length

- **Components**: Max ~300 lines. Split if larger.
- **Hooks**: Max ~150 lines. Extract helper functions.
- **CSS files**: Max ~500 lines. Split by component.

### Function Length

- Keep functions under 50 lines when possible
- Extract helper functions for complex logic
- Use descriptive names for extracted functions

### Comments

```typescript
// Good - explains WHY, not WHAT
// We use a ref here to avoid re-creating the WebSocket on every render
const wsRef = useRef<WebSocket | null>(null);

// Bad - explains obvious WHAT
// Create a new WebSocket
const ws = new WebSocket(url);
```

---

## Error Handling

### API Calls

```typescript
// Good - handle errors explicitly
try {
  const result = await window.api.data.fetch();
  if (!result.success) {
    toast.error(result.error || 'Failed to fetch data');
    return;
  }
  setData(result.data);
} catch (error) {
  console.error('Unexpected error:', error);
  toast.error('An unexpected error occurred');
}
```

### Type Guards

```typescript
// Good - type guard for error handling
function isApiError(error: unknown): error is { message: string; code: number } {
  return typeof error === 'object' && error !== null && 'message' in error && 'code' in error;
}

try {
  // ...
} catch (error) {
  if (isApiError(error)) {
    console.error(`API Error ${error.code}: ${error.message}`);
  } else {
    console.error('Unknown error:', error);
  }
}
```

---

## Quick Reference

| Rule                                    | Why                         |
| --------------------------------------- | --------------------------- |
| No `!` (non-null assertion)             | Hides potential null issues |
| No `any`                                | Loses type safety           |
| Wrap `case` with `const`/`let` in `{}`  | ESLint requirement          |
| Use `_` prefix for intentionally unused | ESLint won't complain       |
| Search before defining constants        | Avoid duplication           |
| Max 300 lines per component             | Maintainability             |
| Run lint + typecheck before commit      | Catch issues early          |

---

**Language**: All documentation must be written in **English**.
