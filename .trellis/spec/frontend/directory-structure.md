# Directory Structure

> Project structure conventions for Electron + React applications.

---

## Recommended Directory Structure

```
src/
├── main/                     # Electron main process
│   ├── main.ts               # Entry point
│   ├── ipc/                   # IPC handlers
│   │   ├── auth.handler.ts
│   │   ├── dialog.handler.ts
│   │   └── ...
│   ├── services/              # Business logic
│   │   ├── auth/
│   │   ├── database/
│   │   └── ...
│   └── utils/                 # Main process utilities
│
├── preload/                   # Preload scripts
│   └── preload.ts             # Context bridge setup
│
├── renderer/                  # React application
│   └── src/
│       ├── App.tsx            # Root component
│       ├── main.tsx           # React entry point
│       │
│       ├── components/        # Shared UI components
│       │   ├── ui/            # Base UI components (Button, Input, etc.)
│       │   └── layout/        # Layout components (Sidebar, Header, etc.)
│       │
│       ├── features/          # Feature-based modules (auth, settings)
│       │   └── auth/
│       │       ├── components/
│       │       ├── hooks/
│       │       ├── context/
│       │       └── index.ts
│       │
│       ├── modules/           # Domain modules
│       │   └── {feature}/
│       │       ├── components/
│       │       ├── hooks/
│       │       ├── context/
│       │       ├── constants.ts
│       │       └── types.ts
│       │
│       ├── hooks/             # Global hooks
│       ├── context/           # Global contexts
│       ├── lib/               # Utility functions
│       └── styles/            # CSS files
│
└── shared/                    # Shared between main and renderer
    ├── types/                 # Type definitions
    │   ├── auth.ts
    │   ├── entity.ts
    │   └── ...
    └── constants/             # Shared constants
        ├── channels.ts        # IPC channel names
        └── config.ts
```

---

## Module Structure

Each module follows a consistent internal structure:

```
modules/
├── {feature}/
│   ├── components/     # UI components specific to this module
│   │   ├── FeatureList.tsx
│   │   ├── FeatureItem.tsx
│   │   └── FeatureDialog.tsx
│   │
│   ├── hooks/          # Custom hooks for this module
│   │   ├── index.ts    # Re-exports
│   │   ├── useFeature.ts
│   │   └── useFeatureMutation.ts
│   │
│   ├── context/        # React context (if needed)
│   │   └── FeatureContext.tsx
│   │
│   ├── constants.ts    # Module-specific constants
│   ├── types.ts        # Module-specific types
│   └── index.ts        # Public exports
```

---

## CSS Location

Use **centralized CSS organization**:

```
src/renderer/src/styles/
├── index.css            # Entry point (imports all other files)
├── tokens.css           # CSS custom properties (:root variables)
├── base.css             # html/body/typography/focus/scrollbars
├── components/          # Component-scoped styles
│   ├── sidebar.css
│   ├── tabbar.css
│   └── ...
├── layout/              # Shell-level layout helpers
└── pages/               # Page-specific styles
```

**Rules**:

1. `index.css` is the single entrypoint imported by the renderer
2. When adding new styles, put them in the closest domain file
3. If a file grows beyond ~300-500 lines, split it

**Import in entry point**:

```typescript
// src/renderer/src/main.tsx
import './styles/index.css';
```

---

## Feature vs Module

| Type        | Purpose                                | Examples                                   |
| ----------- | -------------------------------------- | ------------------------------------------ |
| **Feature** | Cross-cutting concerns, infrastructure | `auth`, `settings`, `navigation`, `layout` |
| **Module**  | Domain-specific functionality          | `todos`, `documents`, `projects`, `users`  |

**Features** live in `features/`:

- Used across multiple modules
- Provide contexts, hooks for app-wide functionality
- Examples: authentication, theming, navigation

**Modules** live in `modules/`:

- Self-contained domain logic
- May depend on features but not other modules
- Examples: todo management, document editing

---

## Import Conventions

### From Within a Module

```typescript
// Inside modules/todos/components/TodoList.tsx
import { useTodos } from '../hooks';
import { TODO_STATES } from '../constants';
import type { Todo } from '../types';
```

### From Outside a Module

```typescript
// Inside modules/projects/components/ProjectDetail.tsx
import { useTodos } from '../../todos/hooks';
// Or if re-exported from module index:
import { useTodos } from '../../todos';
```

### From Shared

```typescript
// From anywhere in renderer
import type { User } from '@shared/types/user';
import { IPC_CHANNELS } from '@shared/constants/channels';
```

---

## File Naming Conventions

| Type       | Convention                       | Example                           |
| ---------- | -------------------------------- | --------------------------------- |
| Components | PascalCase                       | `TodoList.tsx`, `UserAvatar.tsx`  |
| Hooks      | camelCase with `use` prefix      | `useTodos.ts`, `useAuth.ts`       |
| Contexts   | PascalCase with `Context` suffix | `AuthContext.tsx`                 |
| Constants  | SCREAMING_SNAKE_CASE (values)    | `constants.ts` with `TODO_STATES` |
| Types      | PascalCase                       | `types.ts` with `TodoItem`        |
| Utilities  | camelCase                        | `formatDate.ts`, `parseQuery.ts`  |
| CSS        | kebab-case                       | `sidebar.css`, `todo-list.css`    |

---

## Index File Patterns

### Module Index (Public API)

```typescript
// modules/todos/index.ts
// Re-export only what should be public

// Components
export { TodoList } from './components/TodoList';
export { TodoItem } from './components/TodoItem';

// Hooks
export { useTodos, useCreateTodo, useUpdateTodo } from './hooks';

// Context
export { TodoProvider, useTodoContext } from './context/TodoContext';

// Types (re-export from types.ts)
export type { Todo, TodoState } from './types';

// Constants
export { TODO_STATES, PRIORITY_OPTIONS } from './constants';
```

### Hooks Index (Internal Organization)

```typescript
// modules/todos/hooks/index.ts
export { useTodos } from './useTodos';
export { useCreateTodo } from './useCreateTodo';
export { useUpdateTodo } from './useUpdateTodo';
export { useDeleteTodo } from './useDeleteTodo';
```

---

## Shared Types Organization

```
src/shared/types/
├── index.ts            # Re-exports all types
├── auth.ts             # Authentication types
├── entity.ts           # Domain entity types
├── api.ts              # API request/response types
└── common.ts           # Utility types
```

**Example entity types file**:

```typescript
// src/shared/types/entity.ts
import { z } from 'zod';

// Zod schemas
export const todoStateSchema = z.enum(['open', 'in_progress', 'done', 'canceled']);
export const todoPrioritySchema = z.enum(['low', 'medium', 'high']);

// TypeScript types derived from schemas
export type TodoState = z.infer<typeof todoStateSchema>;
export type TodoPriority = z.infer<typeof todoPrioritySchema>;

// Entity types
export interface Todo {
  id: string;
  title: string;
  description?: string;
  state: TodoState;
  priority: TodoPriority;
  createdAt: number;
  updatedAt: number;
}
```

---

## Quick Reference

| Question                      | Answer                                           |
| ----------------------------- | ------------------------------------------------ |
| Where do IPC handlers go?     | `src/main/ipc/`                                  |
| Where do shared types go?     | `src/shared/types/`                              |
| Where do component styles go? | `src/renderer/src/styles/components/`            |
| Where do hooks go?            | In `hooks/` folder of relevant module or feature |
| Where do global hooks go?     | `src/renderer/src/hooks/`                        |

---

**Language**: All documentation must be written in **English**.
