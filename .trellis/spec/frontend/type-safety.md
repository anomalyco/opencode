# Type Safety Guidelines

> Type safety, import paths, and module constants for frontend development.

---

## Import Types from Shared Types

Always import types from a shared types location instead of redefining them:

```typescript
// Good
import type { User } from '../shared/types/user';
import type { TodoState, TodoPriority } from '../shared/types/entity';

// Bad - don't redefine
interface User {
  id: string;
  name: string;
}
```

---

## Use Zod Schema for Enum Values

When you need to iterate over enum values (e.g., for dropdowns, filters), use Zod schemas and `.options`:

```typescript
// Good - Use schema.options for enum values
import { todoPrioritySchema, todoStateSchema } from "../shared/types/entity";

// Get all valid priority values
const PRIORITY_OPTIONS = todoPrioritySchema.options; // ['low', 'medium', 'high']

// Use in dropdowns/filters
{todoPrioritySchema.options.map((priority) => (
  <option key={priority} value={priority}>{priority}</option>
))}

// Bad - Hardcoding enum values leads to errors
const PRIORITIES = ['low', 'medium', 'high', 'urgent']; // 'urgent' doesn't exist!
```

**Why use Zod schemas?**

- **Type safety**: TypeScript will catch invalid values at compile time
- **Single source of truth**: Schema defines valid values in one place
- **Auto-sync**: When backend adds/removes values, frontend automatically updates

---

## Module-Level UI Constants

When multiple components within a module need the same display labels, colors, or options, create a `constants.ts` file in the module root:

```
modules/
├── todos/
│   ├── constants.ts      # Shared UI constants for todo module
│   ├── components/
│   │   ├── TodoCreateDialog.tsx
│   │   └── TodoFilterDropdown.tsx
│   └── ...
```

**Pattern**:

```typescript
// src/renderer/src/modules/todos/constants.ts
import type { TodoPriority, TodoState } from '../shared/types/entity';
import { todoPrioritySchema } from '../shared/types/entity';

/**
 * Priority display labels
 */
export const PRIORITY_LABELS: Record<TodoPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/**
 * Priority options for dropdowns - derived from Zod schema
 */
export const PRIORITY_OPTIONS: {
  value: TodoPriority | 'none';
  label: string;
}[] = [
  { value: 'none', label: 'No priority' },
  ...todoPrioritySchema.options.map((value) => ({
    value,
    label: PRIORITY_LABELS[value],
  })),
];

/**
 * State display labels
 */
export const STATE_LABELS: Record<TodoState, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  done: 'Done',
  canceled: 'Canceled',
};
```

**Usage in components**:

```typescript
// TodoCreateDialog.tsx
import { PRIORITY_OPTIONS } from '../constants';

// TodoFilterDropdown.tsx
import { PRIORITY_FILTER_OPTIONS } from '../constants';

// From another module (e.g., docs)
import { PRIORITY_OPTIONS } from '../../todos/constants';
```

**Why this pattern?**

- **DRY**: Avoid duplicating labels across components
- **Consistency**: Single source of truth for display text
- **Type-safe**: Derived from Zod schemas, TypeScript catches mismatches
- **Maintainable**: Change label in one place, updates everywhere

---

## Import Path Conventions

### Recommended Path Alias Setup

Configure TypeScript path aliases for cleaner imports:

```json
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/renderer/src/*"],
      "@shared/*": ["src/shared/*"]
    }
  }
}
```

**Correct import patterns:**

```typescript
// Use alias for shared types/constants
import type { TodoState } from '@shared/types/entity';
import { CONFIG } from '@shared/constants/config';

// Use alias for renderer-internal imports
import { TODO_STATE_CONFIG } from '@/constants/todo';
import { useAuth } from '@/features/auth/hooks/useAuth';

// Or use relative paths if alias not configured
import { TODO_STATE_CONFIG } from '../../../constants/todo';
import { useAuth } from '../../auth/hooks/useAuth';
```

### Vite Configuration

For Vite projects, also configure the alias in `vite.config.ts`:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
```

---

## Importing Workspace Packages in Renderer

### Vite optimizeDeps Configuration

When importing workspace packages (e.g., `@your-app/shared`, `@your-app/icons`) in the renderer process, you may encounter issues where exported values are `undefined` or missing.

**Root Cause**: Vite pre-bundles dependencies for performance. If a workspace package's exports change during development, Vite's cached pre-bundled version may be stale.

**Solution**: Add workspace packages to `optimizeDeps.exclude` in your Vite config:

```typescript
// vite.renderer.config.ts
export default defineConfig({
  optimizeDeps: {
    // Workspace packages should be excluded from pre-bundling
    // so that HMR/reloads correctly pick up new exports
    exclude: ['@your-app/icons', '@your-app/shared'],
  },
});
```

**Symptoms of this issue**:

- `SOME_CONSTANT.VALUE` is `undefined` even though it's defined in the source
- Console error: `does not provide an export named 'X'`
- Exports work in main process but not in renderer

**When to add a package to exclude**:

- The package is a workspace package (`workspace:*` dependency)
- The package's exports may change during development
- You're seeing `undefined` values for exports that should exist

---

## Type Annotations Best Practices

### Explicit Return Types

Always use explicit return types for exported functions:

```typescript
// Good - explicit return type
export function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}

// Bad - inferred return type
export function calculateTotal(items: Item[]) {
  return items.reduce((sum, item) => sum + item.price, 0);
}
```

### Type Assertions

Avoid type assertions (`as`). If you need one, consider if the types are correct:

```typescript
// Bad - type assertion hides potential issues
const user = data as User;

// Good - type guard or validation
function isUser(data: unknown): data is User {
  return typeof data === 'object' && data !== null && 'id' in data && 'name' in data;
}

if (isUser(data)) {
  const user = data; // TypeScript knows this is User
}
```

### Non-null Assertion

Never use non-null assertions (`!`):

```typescript
// Bad - non-null assertion
const name = user!.name;

// Good - explicit null check
if (user) {
  const name = user.name;
}

// Also good - optional chaining with fallback
const name = user?.name ?? 'Unknown';
```

---

## Generic Type Patterns

### Hook with Generic Return Type

```typescript
interface UseDataResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useData<T>(fetcher: () => Promise<T>): UseDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await fetcher();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setIsLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}
```

### Utility Type Usage

```typescript
// Pick specific properties
type UserPreview = Pick<User, 'id' | 'name' | 'avatar'>;

// Omit specific properties
type UserWithoutPassword = Omit<User, 'password'>;

// Make all properties optional
type PartialUser = Partial<User>;

// Make all properties required
type RequiredUser = Required<User>;

// Record type for mappings
type UserRoles = Record<string, User[]>;
```

---

**Language**: All documentation must be written in **English**.
