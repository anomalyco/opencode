# TUI Component

The Terminal User Interface (TUI) provides an interactive, real-time interface for OpenCode sessions within the terminal. It combines modern UI patterns with terminal efficiency.

## Architecture Overview

```
┌─────────────────┐
│   TUI App       │ ← SolidJS + OpenTUI
└─────────────────┘
          │
          ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Routes        │    │   Components    │    │   Context       │
│   (Router)      │    │   (UI)          │    │   (State)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
          │                     │                     │
          ▼                     ▼                     ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Session       │    │   Dialogs       │    │   Themes        │
│   Management    │    │   System        │    │   System        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Core Files

### TUI Application (`packages/opencode/src/cli/cmd/tui/app.tsx`)

- **Framework**: SolidJS with OpenTUI components
- **Entry Point**: Main TUI application component
- **State Management**: SolidJS reactivity with context

### Routes (`packages/opencode/src/cli/cmd/tui/routes/`)

- **Home Screen** (`home.tsx`) - Session selection and management
- **Session View** (`session/index.tsx`) - Main chat interface
- **Dialogs** - Modal dialogs for various actions

### Components (`packages/opencode/src/cli/cmd/tui/component/`)

- **Prompt** (`prompt/`) - Input handling and autocomplete
- **Dialogs** - Modal system for configuration
- **UI Elements** - Reusable terminal UI components

## Main Application Structure

### App Component

```typescript
// packages/opencode/src/cli/cmd/tui/app.tsx
export default function App() {
  const [theme, setTheme] = createSignal(Theme.load())
  const [route, setRoute] = createSignal("home")

  return (
    <OpenTUI theme={theme()}>
      <Router>
        <Routes>
          <Route path="/" component={Home} />
          <Route path="/session/:id" component={Session} />
        </Routes>
      </Router>
    </OpenTUI>
  )
}
```

### Context Management

```typescript
// packages/opencode/src/cli/cmd/tui/context/
export const ThemeContext = createContext<ThemeSignal>()
export const SDKContext = createContext<OpencodeClient>()
export const SessionContext = createContext<SessionSignal>()
```

## Session Interface

### Session View (`packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`)

```typescript
export default function Session() {
  const params = useParams()
  const sdk = useContext(SDKContext)
  const [messages, setMessages] = createSignal<MessageV2.WithParts[]>([])
  const [input, setInput] = createSignal("")

  // Real-time event subscription
  createEffect(async () => {
    const events = await sdk.event.subscribe()
    for await (const event of events.stream) {
      handleEvent(event)
    }
  })

  return (
    <Box flexDirection="column" height="100%">
      <Header sessionID={params.id} />
      <Sidebar sessionID={params.id} />
      <MessageList messages={messages()} />
      <PromptInput
        value={input()}
        onInput={setInput}
        onSubmit={handleSubmit}
      />
    </Box>
  )
}
```

### Message Display

```typescript
// Message rendering with syntax highlighting
function MessagePart(props: { part: MessageV2.Part }) {
  switch (props.part.type) {
    case "text":
      return <Text text={props.part.text} />
    case "tool":
      return <ToolExecution part={props.part} />
    case "file":
      return <FileAttachment part={props.part} />
    default:
      return null
  }
}
```

## Input System

### Prompt Component (`packages/opencode/src/cli/cmd/tui/component/prompt/`)

```typescript
// packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx
export default function PromptInput(props: PromptProps) {
  const [value, setValue] = createSignal(props.value || "")
  const [suggestions, setSuggestions] = createSignal<string[]>([])

  return (
    <Box flexDirection="column" borderStyle="single">
      <TextInput
        value={value()}
        onChange={setValue}
        onSubmit={props.onSubmit}
        placeholder="Type your message..."
      />
      {suggestions().length > 0 && (
        <Autocomplete
          suggestions={suggestions()}
          onSelect={handleSuggestionSelect}
        />
      )}
    </Box>
  )
}
```

### Autocomplete (`packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx`)

```typescript
export default function Autocomplete(props: AutocompleteProps) {
  return (
    <Box flexDirection="column" borderStyle="single">
      {props.suggestions.map((suggestion, index) => (
        <Text
          key={suggestion}
          inverse={index === props.selectedIndex}
          onClick={() => props.onSelect(suggestion)}
        >
          {suggestion}
        </Text>
      ))}
    </Box>
  )
}
```

### History Navigation

```typescript
// packages/opencode/src/cli/cmd/tui/component/prompt/history.tsx
export function useHistory() {
  const [history, setHistory] = createSignal<string[]>([])
  const [index, setIndex] = createSignal(-1)

  const navigate = (direction: "up" | "down") => {
    const newIndex = direction === "up" ? Math.max(index() - 1, 0) : Math.min(index() + 1, history().length - 1)

    setIndex(newIndex)
    return history()[newIndex]
  }

  return { history, navigate }
}
```

## Dialog System

### Dialog Base (`packages/opencode/src/cli/cmd/tui/ui/dialog.tsx`)

```typescript
export function Dialog(props: DialogProps) {
  return (
    <Overlay>
      <Box
        flexDirection="column"
        borderStyle="single"
        padding={1}
        width={props.width || 50}
        height={props.height || 20}
      >
        <Text bold>{props.title}</Text>
        <Box flexGrow={1}>
          {props.children}
        </Box>
        <DialogActions>
          <Button onClick={props.onCancel}>Cancel</Button>
          <Button onClick={props.onConfirm}>Confirm</Button>
        </DialogActions>
      </Box>
    </Overlay>
  )
}
```

### Session List Dialog (`packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx`)

```typescript
export default function SessionListDialog() {
  const [sessions, setSessions] = createSignal<Session.Info[]>([])
  const [selected, setSelected] = createSignal<string | null>(null)

  createEffect(async () => {
    const list = await sdk.session.list()
    setSessions(list.data || [])
  })

  return (
    <Dialog title="Sessions" width={80} height={25}>
      <Box flexDirection="column" height="100%">
        <SessionList
          sessions={sessions()}
          selected={selected()}
          onSelect={setSelected}
        />
      </Box>
    </Dialog>
  )
}
```

### Agent Selection Dialog (`packages/opencode/src/cli/cmd/tui/component/dialog-agent.tsx`)

```typescript
export default function AgentDialog() {
  const [agents, setAgents] = createSignal<Agent.Info[]>([])
  const [selected, setSelected] = createSignal<string>("build")

  return (
    <Dialog title="Select Agent" width={60} height={15}>
      <Box flexDirection="column">
        {agents().map(agent => (
          <RadioButton
            key={agent.name}
            label={agent.name}
            description={agent.description}
            checked={selected() === agent.name}
            onChange={() => setSelected(agent.name)}
          />
        ))}
      </Box>
    </Dialog>
  )
}
```

## Theme System

### Theme Structure (`packages/opencode/src/cli/cmd/tui/context/theme/`)

```json
{
  "name": "theme-name",
  "colors": {
    "primary": "#ffffff",
    "secondary": "#888888",
    "success": "#00ff00",
    "warning": "#ffff00",
    "error": "#ff0000",
    "background": "#000000",
    "surface": "#111111",
    "border": "#333333"
  },
  "styles": {
    "text": { "color": "$primary" },
    "dim": { "color": "$secondary" },
    "success": { "color": "$success" },
    "warning": { "color": "$warning" },
    "error": { "color": "$error" },
    "inverse": { "color": "$background", "backgroundColor": "$primary" }
  }
}
```

### Built-in Themes

- **GitHub** - GitHub-style colors
- **Dracula** - Dracula theme
- **Nord** - Nord color palette
- **Catppuccin** - Catppuccin flavors
- **Material** - Material Design colors
- **Custom** - User-defined themes

### Theme Application

```typescript
// packages/opencode/src/cli/cmd/tui/context/theme.tsx
export function ThemeProvider(props: { children: JSX.Element }) {
  const [theme, setTheme] = createSignal(Theme.load())

  return (
    <ThemeContext.Provider value={theme}>
      <OpenTUI theme={theme()}>
        {props.children}
      </OpenTUI>
    </ThemeContext.Provider>
  )
}
```

## Key Bindings

### Key System (`packages/opencode/src/cli/cmd/tui/keybind.tsx`)

```typescript
export const KeyBindings = {
  // Navigation
  "ctrl+c": "interrupt",
  "ctrl+d": "exit",
  "ctrl+l": "clear",

  // Session management
  "ctrl+n": "new-session",
  "ctrl+s": "save-session",
  "ctrl+o": "open-session",

  // Agent switching
  tab: "cycle-agent",
  "ctrl+1": "agent-build",
  "ctrl+2": "agent-plan",

  // Message navigation
  "ctrl+u": "scroll-up",
  "ctrl+d": "scroll-down",
  "ctrl+home": "scroll-top",
  "ctrl+end": "scroll-bottom",

  // Dialogs
  "ctrl+p": "model-dialog",
  "ctrl+t": "theme-dialog",
  "ctrl+h": "help-dialog",
  "ctrl+?": "help-dialog",
}
```

### Key Handler

```typescript
// packages/opencode/src/cli/cmd/tui/helper.tsx
export function useKeyBindings() {
  return (key: string) => {
    const action = KeyBindings[key]
    if (action) {
      handleAction(action)
      return true
    }
    return false
  }
}
```

## Real-time Features

### Event Streaming

```typescript
// Real-time message updates
createEffect(async () => {
  const events = await sdk.event.subscribe()
  for await (const event of events.stream) {
    switch (event.type) {
      case "message.part.updated":
        updateMessagePart(event.properties.part)
        break
      case "session.error":
        showError(event.properties.error)
        break
      case "permission.updated":
        showPermissionDialog(event.properties)
        break
    }
  }
})
```

### Tool Execution Display

```typescript
// Live tool execution updates
function ToolExecution(props: { part: MessageV2.ToolPart }) {
  const [status, setStatus] = createSignal(props.part.state.status)

  createEffect(() => {
    // Subscribe to tool updates
    const unsubscribe = subscribeToToolUpdates(props.part.callID, (update) => {
      setStatus(update.status)
    })

    return unsubscribe
  })

  return (
    <Box borderStyle="single" padding={1}>
      <Text bold>{props.part.tool}</Text>
      <Text color={status() === 'running' ? 'yellow' : 'green'}>
        {status()}
      </Text>
      {props.part.state.output && (
        <Text>{props.part.state.output}</Text>
      )}
    </Box>
  )
}
```

## Performance Optimizations

### Virtual Scrolling

```typescript
// Efficient message list rendering
function MessageList(props: { messages: MessageV2.WithParts[] }) {
  const [visibleRange, setVisibleRange] = createSignal({ start: 0, end: 20 })

  return (
    <VirtualList
      items={props.messages}
      itemHeight={3}
      visibleRange={visibleRange()}
      onVisibleRangeChange={setVisibleRange}
      renderItem={(message) => <MessageItem message={message} />}
    />
  )
}
```

### Lazy Loading

```typescript
// Load session history on demand
export function useSessionHistory(sessionID: string) {
  const [messages, setMessages] = createSignal<MessageV2.WithParts[]>([])
  const [loading, setLoading] = createSignal(false)

  const loadMore = async () => {
    setLoading(true)
    const more = await sdk.session.message({
      id: sessionID,
      limit: messages().length + 50,
    })
    setMessages(more.data || [])
    setLoading(false)
  }

  return { messages, loading, loadMore }
}
```

## Accessibility Features

### Screen Reader Support

```typescript
// Accessible text output
function AccessibleText(props: { children: string }) {
  return (
    <Text
      accessible={true}
      aria-label={props.children}
    >
      {props.children}
    </Text>
  )
}
```

### High Contrast Mode

```typescript
// High contrast theme variant
export const HighContrastTheme = {
  ...BaseTheme,
  colors: {
    ...BaseTheme.colors,
    primary: "#ffffff",
    background: "#000000",
    border: "#ffffff",
  },
}
```

## Integration Points

### Server Communication

```typescript
// SDK integration
const sdk = createOpencodeClient({ baseUrl: serverUrl })

// Session operations
await sdk.session.prompt({
  sessionID,
  parts: [{ type: "text", text: input }],
})
```

### Event Bus Integration

```typescript
// TUI event publishing
await Bus.publish(TuiEvent.CommandExecute, {
  command: "session.new",
})

// Event handling
Bus.subscribe(TuiEvent.ToastShow, (event) => {
  showToast(event.properties)
})
```

### Plugin System

```typescript
// TUI plugin hooks
await Plugin.trigger("tui.init", {
  theme: currentTheme,
  keybindings: KeyBindings,
})

await Plugin.trigger("tui.render", {
  component: "message",
  props: message,
})
```

## Development Tools

### Debug Mode

```bash
# Enable debug logging
opencode --log-level DEBUG attach <server-url>

# TUI debug mode
DEBUG=tui opencode attach <server-url>
```

### Component Testing

```typescript
// TUI component testing
describe('PromptInput', () => {
  it('should handle input changes', async () => {
    const { getByPlaceholderText } = render(<PromptInput />)
    const input = getByPlaceholderText('Type your message...')

    fireEvent.change(input, { target: { value: 'test' }})

    expect(input.value).toBe('test')
  })
})
```

The TUI component provides a rich, terminal-native interface that combines the efficiency of CLI with the interactivity of GUI, making it ideal for developers who prefer working in the terminal.
