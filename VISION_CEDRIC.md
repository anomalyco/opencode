# Cedric - Platform Vision & UX Strategy

## The Vision

**Cedric is not a chat app. Cedric is an LLM Operating System.**

A platform-agnostic desktop environment where any LLM (local or cloud) can operate with full tool access, multi-modal capabilities, and extensible workspaces. The goal: everything Codex/Claude apps offer, but unlocked from vendor ecosystems.

---

## Core Architecture Philosophy

### Left Panel: The Conversation Stream
- **Primary chat** - Main conversation thread
- **Threaded conversations** - Side chats for sub-tasks
- **Agent channels** - Spawned by agents for parallel work

### Right Panel: The Tool Workspace (Multi-Tab)
This is the critical insight. The right panel should be a **tabbed workspace** where users can open unlimited instances of:
- **Browser tabs** - Multiple webviews, each independent
- **File tabs** - Code files, markdown, any document
- **Tool tabs** - Terminal, image viewer, PDF viewer, etc.
- **Side chat tabs** - Secondary conversations
- **Review tabs** - Git diff, code review
- **Context tabs** - File tree, search results

### The "+" Tab Button
Clicking "+" opens a palette:
```
+ New Tab
  ├── Browse Web (opens new browser instance)
  ├── Open File... (opens file picker)
  ├── New Terminal
  ├── New Side Chat
  ├── Open Image/PDF...
  └── Open Tool (MCP server, plugin)
```

---

## Feature Matrix (Cedric vs Competition)

| Feature | Codex App | Claude App | Cedric (Target) |
|---------|-----------|------------|-----------------|
| Multi-model support | ❌ (OpenAI only) | ❌ (Anthropic only) | ✅ Any LLM |
| Local model support | ❌ | ❌ | ✅ Ollama, LM Studio |
| Multiple browser tabs | ❌ | ❌ | ✅ Unlimited |
| File workspace | ✅ | ✅ | ✅ Multi-tab |
| Agent swarms | ❌ | ❌ | ✅ Background task |
| Side chats | ❌ | ❌ | ✅ Threaded |
| MCP tools | ❌ | ❌ | ✅ Native |
| Computer use | ❌ | ❌ | ✅ Native |
| Browser annotation | ❌ | ❌ | ✅ Planned |
| Vendor lock-in | 🔒 | 🔒 | 🔓 Open |

---

## Swarm Redesign: Background Agent System

**Not a tab. Not a UI feature. An agent capability.**

### How It Works:
1. User asks complex task: "Refactor the auth system"
2. Main agent spawns background tasks:
   - Agent A: "Analyze current auth implementation"
   - Agent B: "Research best practices for auth"
   - Agent C: "Draft refactored code"
3. Each agent opens a **side chat channel** (visible in left panel)
4. Results converge back to main chat
5. User can click into any agent channel to see progress

### UI Implementation:
- Left panel shows: Main Chat > Agent channels (collapsible)
- Agent channels show: Status indicator, progress, quick actions
- No "Swarm" tab needed - it's implicit in the chat architecture

---

## Right Panel: The Workspace (Critical Redesign)

### Current Problem:
- Only one browser OR one markdown file at a time
- No way to have multiple tools open simultaneously
- Tabs are hardcoded (Review/Browser/Markdown/Swarm)

### Proposed Solution:
Dynamic multi-tab workspace with a **+ button**:

```
[Review] [Browser: Google] [Browser: GitHub] [README.md] [+] [Open File]
```

**Tab Types:**
- **Review** - Git changes (pinned, always available)
- **Browser** - Webview with URL bar, multiple instances allowed
- **File** - Any file type with appropriate viewer
- **Terminal** - Integrated terminal
- **Side Chat** - Secondary conversation
- **Context** - File tree, search, references

**Each tab is independent and closable.**

---

## Left Panel: Conversation Architecture

### Threaded Conversations
```
Main Chat
├── Thread: Auth Refactor (agent spawned)
├── Thread: API Documentation (user created)
└── Thread: Bug Investigation (agent spawned)
```

### Agent Channels
When agent spawns background work:
- New channel appears in left panel
- Shows live status: "Researching...", "Coding..."
- User can switch to channel to see details
- Results merge back to main chat when complete

---

## Skills & Plugins System

Instead of hardcoded tabs, Cedric should have a **skills system**:

### Built-in Skills:
- `browser` - Web browsing
- `file-viewer` - File preview
- `terminal` - Command line
- `git-review` - Code review
- `image-editor` - Image annotation
- `pdf-viewer` - PDF reading

### Agent-Initiated Skills:
When agent needs a tool, it opens the appropriate skill tab automatically.

### User-Initiated Skills:
User clicks "+" and selects skill from palette.

---

## Implementation Priorities

### Phase 1: Foundation (This Week)
1. **Rename to Cedric** - Update all branding
2. **Multi-tab workspace** - Implement dynamic tab system
3. **+ Button palette** - New tab creation menu
4. **Multiple browser instances** - Support unlimited webviews

### Phase 2: Workspace (Next 2 Weeks)
5. **File multi-open** - Open multiple files in tabs
6. **Side chat system** - Threaded conversations
7. **Remove Swarm tab** - Reimplement as agent capability
8. **Context awareness** - File tree, recent files

### Phase 3: Agentic Layer (Next Month)
9. **Background agent tasks** - Spawn agent channels
10. **Skill registry** - Plugin system for tools
11. **Proactive suggestions** - Agent-initiated actions
12. **Tool integration** - MCP, computer use, browser automation

### Phase 4: Ecosystem (Next Quarter)
13. **Multi-model support** - Beyond Kimi (Claude, GPT, local)
14. **Skill marketplace** - Community plugins
15. **Workspace templates** - Pre-configured layouts
16. **Collaboration** - Multi-user sessions

---

## UX Principles for Cedric

1. **Chat is the anchor** - Everything revolves around conversation
2. **Tools are elevating** - Right panel enhances the chat experience
3. **Context is king** - Agents always know the full workspace state
4. **Multiplicity** - Multiple browsers, files, chats can coexist
5. **Agent-initiated** - Agents can open tools, spawn threads, suggest actions
6. **User in control** - User can always override, redirect, or close agent actions

---

## Technical Architecture Notes

### Workspace State:
```typescript
interface Workspace {
  leftPanel: {
    mainChat: ChatSession
    threads: Thread[]
    agentChannels: AgentChannel[]
  }
  rightPanel: {
    tabs: WorkspaceTab[]
    activeTab: string
  }
}

interface WorkspaceTab {
  id: string
  type: 'browser' | 'file' | 'terminal' | 'chat' | 'review' | 'context'
  title: string
  state: any // Type-specific state
  isPinned?: boolean
}
```

### Agent Channel:
```typescript
interface AgentChannel {
  id: string
  name: string
  status: 'working' | 'waiting' | 'completed' | 'error'
  parentMessage: string // ID of message that spawned this
  messages: Message[]
  tools: ToolCall[]
}
```

---

## Competitive Advantage

**Why Cedric wins:**
1. **No vendor lock-in** - Use any model, local or cloud
2. **True multi-tasking** - Multiple browsers, files, chats simultaneously
3. **Agent-native** - Built for agent workflows, not retrofitted
4. **Extensible** - Plugin system for any tool
5. **Local-first** - Works offline with local models
6. **Open** - Open source, community-driven

**The dream:** A developer opens Cedric, starts a chat with their local LLM, asks it to "Build a React app with auth". The agent spawns 3 background tasks, opens a browser to check React docs, opens files to write code, opens a terminal to run commands, all while the main chat shows progress. This is what Codex/Claude apps do - but Cedric does it with ANY model.

---

## Next Steps

1. **Immediate**: Implement multi-tab workspace with + button
2. **This week**: Refactor right panel to support dynamic tabs
3. **Next week**: Implement agent channels (side chats)
4. **Ongoing**: Add model providers (Claude, GPT, local)

Let's build the LLM OS the world needs.
