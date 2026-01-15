# OpenCode App Package Guide

> **Package**: `packages/app`
> **Purpose**: Web application frontend components
> **Framework**: SolidJS
> **Entry Point**: `src/index.tsx`

## Overview

This package contains the web-based user interface for OpenCode. It's a SolidJS application that provides a browser-based development environment with:
- Real-time message display with streaming
- Interactive file tree with git status
- Syntax-highlighted code blocks
- Terminal emulator integration
- Responsive layout system
- Dark/light theme support

The app package is used by:
- Standalone web application (`bun dev`)
- Desktop application (via Tauri wrapper)
- Future mobile clients

## Directory Structure

```
packages/app/
├── public/                # Static assets
├── src/
│   ├── index.tsx         # App entry point
│   ├── app.tsx           # Root app component
│   │
│   ├── component/        # UI Components
│   │   ├── message/      # Message display components
│   │   ├── file-tree/    # File browser components
│   │   ├── terminal/     # Terminal emulator
│   │   ├── editor/       # Code editor components
│   │   └── ...
│   │
│   ├── page/             # Page/view components
│   │   ├── session.tsx   # Session view
│   │   ├── settings.tsx  # Settings page
│   │   └── ...
│   │
│   ├── lib/              # Utilities & Hooks
│   │   ├── api.ts        # API client wrapper
│   │   ├── hooks.ts      # Custom Solid hooks
│   │   ├── websocket.ts  # WebSocket connection
│   │   └── ...
│   │
│   ├── store/            # State Management
│   │   ├── session.ts    # Session state
│   │   ├── ui.ts         # UI state
│   │   └── ...
│   │
│   └── asset/            # Images, icons, fonts
│
├── vite.js               # Vite plugin export
├── package.json
└── tsconfig.json
```

## Key Components

### 1. Entry Point (`src/index.tsx`)

Application initialization:
```typescript
import { render } from 'solid-js/web'
import { App } from './app'

const root = document.getElementById('root')
render(() => <App />, root)
```

### 2. Root Component (`src/app.tsx`)

Main app shell with:
- Router setup
- WebSocket connection
- Global state providers
- Theme provider
- Error boundaries

### 3. Message Components (`src/component/message/`)

Display AI conversation:
- **MessageList**: Virtualized message list
- **MessageItem**: Individual message display
- **StreamingText**: Real-time text streaming
- **CodeBlock**: Syntax-highlighted code
- **ToolCall**: Tool execution display
- **ToolResult**: Tool result display

**Key Features:**
- Markdown rendering with `marked`
- Syntax highlighting with `shiki`
- LaTeX support
- Diff rendering
- Copy to clipboard
- Message actions (fork, edit, delete)

### 4. File Tree (`src/component/file-tree/`)

Git-aware file browser:
- **FileTree**: Root tree component
- **FileNode**: Individual file/directory node
- **FileIcon**: File type icons
- **GitStatus**: Git status indicators

**Features:**
- Lazy loading
- Search/filter
- Git status badges
- Keyboard navigation
- Drag & drop (future)

### 5. Terminal Emulator (`src/component/terminal/`)

Embedded terminal using `ghostty-web`:
- PTY connection to server
- Full terminal emulation
- Resize support
- Copy/paste
- Keyboard shortcuts

### 6. API Client (`src/lib/api.ts`)

Wrapper around OpenCode SDK:
```typescript
import { createOpencodeClient } from '@opencode-ai/sdk'

const client = createOpencodeClient({
  baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:4096'
})

// Usage
const sessions = await client.listSessions()
const message = await client.sendMessage(sessionId, content)
```

### 7. WebSocket Connection (`src/lib/websocket.ts`)

Real-time updates:
- Auto-reconnection
- Event handling
- Message streaming
- Connection state management

```typescript
import { createWebSocket } from './lib/websocket'

const ws = createWebSocket('ws://localhost:4096/event')
ws.on('message', (data) => {
  // Handle real-time message
})
```

### 8. State Management (`src/store/`)

Reactive state with SolidJS stores:

**Session Store** (`session.ts`):
```typescript
const [session, setSession] = createStore({
  current: null,
  messages: [],
  files: []
})
```

**UI Store** (`ui.ts`):
```typescript
const [ui, setUI] = createStore({
  theme: 'dark',
  sidebarOpen: true,
  activePanel: 'messages'
})
```

## UI Architecture

### Layout System

```
┌─────────────────────────────────────────────────────┐
│                   Header / Nav                      │
├──────────────┬──────────────────────────────────────┤
│              │                              │       │
│   Sidebar    │      Main Content            │ Panel │
│              │                              │       │
│  - Sessions  │   ┌──────────────────────┐  │ Files │
│  - Files     │   │   Message List       │  │ Tree  │
│  - History   │   │   - User messages    │  │       │
│              │   │   - AI responses     │  │       │
│              │   │   - Tool calls       │  │       │
│              │   └──────────────────────┘  │       │
│              │                              │       │
│              │   Input Area                 │       │
│              │   > Type message...          │       │
│              │                              │       │
└──────────────┴──────────────────────────────┴───────┘
```

### Responsive Design

- Desktop: Multi-pane layout
- Tablet: Collapsible sidebar
- Mobile: Single pane with navigation

### Theme System

Using CSS variables for theme customization:
```css
:root {
  --color-bg: #1a1a1a;
  --color-text: #e0e0e0;
  --color-accent: #4a9eff;
  /* ... */
}
```

Themes can be customized in `.opencode/themes/`.

## State Management Patterns

### 1. Local Component State

```typescript
import { createSignal } from 'solid-js'

function MyComponent() {
  const [count, setCount] = createSignal(0)

  return <button onClick={() => setCount(count() + 1)}>
    Count: {count()}
  </button>
}
```

### 2. Global Store

```typescript
import { createStore } from 'solid-js/store'

const [state, setState] = createStore({
  sessions: []
})

// Update
setState('sessions', [...state.sessions, newSession])
```

### 3. Context API

```typescript
import { createContext, useContext } from 'solid-js'

const SessionContext = createContext()

export function SessionProvider(props) {
  const [session, setSession] = createSignal(null)

  return (
    <SessionContext.Provider value={[session, setSession]}>
      {props.children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  return useContext(SessionContext)
}
```

## Real-time Features

### Message Streaming

```typescript
import { createSignal } from 'solid-js'

function StreamingMessage(props) {
  const [content, setContent] = createSignal('')

  // Stream updates
  createEffect(() => {
    props.stream.on('chunk', (chunk) => {
      setContent(prev => prev + chunk)
    })
  })

  return <div>{content()}</div>
}
```

### WebSocket Events

```typescript
// Listen for real-time events
ws.on('session.updated', (session) => {
  setSession(session)
})

ws.on('message.created', (message) => {
  setMessages([...messages(), message])
})

ws.on('file.changed', (file) => {
  updateFileTree(file)
})
```

## Styling

### TailwindCSS

Primary styling approach:
```tsx
<div class="flex flex-col gap-4 p-6 bg-gray-900 text-white">
  <h1 class="text-2xl font-bold">Title</h1>
  <p class="text-sm text-gray-400">Description</p>
</div>
```

### Custom Components (@opencode-ai/ui)

Shared component library:
```tsx
import { Button, Input, Card } from '@opencode-ai/ui'

<Card>
  <Input placeholder="Enter message..." />
  <Button onClick={handleSubmit}>Send</Button>
</Card>
```

### Kobalte Components

Accessible UI primitives:
```tsx
import { Dialog, Menu, Tabs } from '@kobalte/core'

<Dialog.Root>
  <Dialog.Trigger>Open</Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Content>
      Dialog content
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
```

## Performance Optimization

### 1. Virtualization

For long lists (messages, files):
```tsx
import { VirtualContainer } from 'virtua/solid'

<VirtualContainer>
  <For each={messages()}>
    {(message) => <MessageItem message={message} />}
  </For>
</VirtualContainer>
```

### 2. Lazy Loading

```tsx
import { lazy } from 'solid-js'

const Settings = lazy(() => import('./page/settings'))

<Route path="/settings" component={Settings} />
```

### 3. Memo/Computed

```tsx
import { createMemo } from 'solid-js'

const filteredMessages = createMemo(() => {
  return messages().filter(m => m.role === 'user')
})
```

### 4. Batch Updates

```tsx
import { batch } from 'solid-js'

batch(() => {
  setMessages([...messages(), newMessage])
  setUnreadCount(unreadCount() + 1)
  setLastUpdate(Date.now())
})
```

## Development

### Running the App

```bash
# Development server
bun run --cwd packages/app dev

# Production build
bun run --cwd packages/app build

# Preview production
bun run --cwd packages/app serve
```

### Environment Variables

```env
# .env.local
VITE_API_URL=http://localhost:4096
VITE_WS_URL=ws://localhost:4096
```

### Vite Configuration

The app uses Vite for building and development:
- Hot Module Replacement (HMR)
- SolidJS plugin
- TailwindCSS
- Icon spritesheet generation

## Testing

### Component Testing

```typescript
import { render } from '@solidjs/testing-library'
import { MessageItem } from './component/message/message-item'

test('renders message content', () => {
  const { getByText } = render(() =>
    <MessageItem message={{ content: 'Hello' }} />
  )

  expect(getByText('Hello')).toBeInTheDocument()
})
```

### Integration Testing

```typescript
import { createClient } from '@opencode-ai/sdk'

test('sends message to session', async () => {
  const client = createClient()
  const session = await client.createSession()
  const message = await client.sendMessage(session.id, 'test')

  expect(message.content).toBe('test')
})
```

## Common Patterns

### 1. Form Handling

```tsx
function MessageInput() {
  const [value, setValue] = createSignal('')

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    sendMessage(value())
    setValue('')
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={value()}
        onInput={(e) => setValue(e.currentTarget.value)}
      />
      <button type="submit">Send</button>
    </form>
  )
}
```

### 2. Data Fetching

```tsx
import { createResource } from 'solid-js'

function SessionList() {
  const [sessions] = createResource(fetchSessions)

  return (
    <Show when={!sessions.loading} fallback={<Spinner />}>
      <For each={sessions()}>
        {(session) => <SessionItem session={session} />}
      </For>
    </Show>
  )
}
```

### 3. Error Handling

```tsx
import { ErrorBoundary } from 'solid-js'

<ErrorBoundary
  fallback={(err) => <ErrorDisplay error={err} />}
>
  <MyComponent />
</ErrorBoundary>
```

## Accessibility

- Semantic HTML elements
- ARIA labels and roles
- Keyboard navigation
- Focus management
- Screen reader support
- Color contrast compliance

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Modern mobile browsers

## Dependencies

Key dependencies:
- **solid-js**: Reactive UI framework
- **@solidjs/router**: Routing
- **@solidjs/meta**: Meta tags
- **@kobalte/core**: Accessible components
- **marked**: Markdown parsing
- **shiki**: Syntax highlighting
- **ghostty-web**: Terminal emulator
- **virtua**: Virtualization
- **tailwindcss**: Styling

## Integration with Desktop App

This app is wrapped by the desktop package (Tauri):
- Shared codebase
- Native window controls
- File system access
- System notifications
- Auto-updates

## Common Tasks

### Adding a New Page

1. Create `src/page/my-page.tsx`
2. Add route in `src/app.tsx`
3. Add navigation link

### Adding a New Component

1. Create `src/component/my-component.tsx`
2. Export from `src/component/index.ts`
3. Use in pages/other components

### Modifying Theme

1. Edit CSS variables in theme file
2. Update component classes
3. Test in both dark/light modes

## Troubleshooting

### HMR Not Working
- Check Vite config
- Restart dev server
- Clear browser cache

### WebSocket Connection Failed
- Verify server is running
- Check CORS settings
- Inspect network tab

### Styles Not Applied
- Rebuild Tailwind
- Check class names
- Verify CSS import order

## Related Documentation

- Root guide: `../../CLAUDE.md`
- UI components: `../ui/CLAUDE.md`
- SDK: `../sdk/js/CLAUDE.md`
- Desktop app: `../desktop/CLAUDE.md`

---

This package provides the primary user interface for OpenCode. Understanding SolidJS reactivity and the component architecture is key to working on the frontend.
