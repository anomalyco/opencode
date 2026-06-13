# Cedric UX Strategy: From Chat App to LLM Operating System

## User Feedback Integration

### 1. Branding: Cedric ✅
**Action:** Rename everything from OpenKimi/OpenCode to Cedric

### 2. Dev Environment: Keep It ✅
**Action:** Performance panel and DEV badge stay - this is a developer tool

### 3. Browser: Working ✅
**Action:** Browser is functional, my testing was incorrect

### 4. Multi-Tab Workspace: CRITICAL INSIGHT 🔴
**User Quote:** *"right now we can only have one browser, or .md at a time. What we should have is the + tab open and give us the option to choose what we want to open"*

**This changes everything.**

### 5. Empty States: Study Required 🟡
**Action:** Design proper empty states with user testing

### 6. Swarm: Background Agent System 🔴
**User Quote:** *"Swarm should've not been a tab from the start, but a feature which allows the agent to initiate multiple chats to support with a task"*

**Insight:** Swarm = Agent channels, not UI tabs

### 7. Chat Composer: Mostly OK 🟢
**Action:** Browser button might be redundant (already have Open Browser)

### 8. Visual Design: Subjective 🟡
**Action:** Gather user feedback before major visual changes

### 9. Agentic Behaviors: Infrastructure First 🔴
**User Quote:** *"We need to have the proper tools first and the proper ecosystem, tools and harness to have agentic behaviors"*

**Insight:** Build tool ecosystem before fancy AI features

---

## The Cedric Workspace Model

### Current Mental Model (Wrong):
```
[Chat] + [Side Panel with Tabs]
```
User thinks: "I have one chat and some tools"

### Correct Mental Model:
```
[Conversation Stream] + [Dynamic Workspace]
```
User thinks: "I'm having a conversation and opening tools as needed"

---

## Right Panel: Dynamic Workspace (The Big Redesign)

### Problem Statement:
Users need to:
- Compare multiple web pages side-by-side
- Reference multiple files while coding
- Have secondary conversations (side chats)
- View terminal output while browsing
- All simultaneously

### Solution: Tabbed Workspace with + Button

**Tab Bar Design:**
```
[Review] [Browser: Google] [Browser: React Docs] [auth.ts] [terminal] [Side Chat] [+] [Open File]
```

**Each tab is:**
- Independent (own state, own URL, own content)
- Closable (x on tab)
- Reorderable (drag to reorder)
- Type-indicated (icon shows what type of tab)

**Tab Types:**
1. **Review** (pinned, git changes)
2. **Browser** (multiple instances, each with URL bar)
3. **File** (code, markdown, any document)
4. **Terminal** (integrated shell)
5. **Side Chat** (secondary conversation thread)
6. **Image/PDF** (media viewer)
7. **Context** (file tree, search results)

### + Button Menu:
```
New Tab:
├── Browse Web
│   └── [URL input field]
├── Open File...
│   └── [File picker dialog]
├── New Terminal
├── New Side Chat
├── Open Image/PDF...
└── Recent:
    ├── google.com
    ├── auth.ts
    └── README.md
```

---

## Left Panel: Conversation Architecture

### Main Chat (Always Present)
- Primary conversation thread
- Full tool access (browser, files, terminal)
- Agent can spawn background tasks

### Agent Channels (Collapsible Section)
When agent spawns background work:
```
Main Chat
▼ Background Tasks (3)
  ● Researching auth best practices...
  ● Analyzing current implementation...
  ○ Waiting for results...
```

Clicking an agent channel:
- Opens the agent's conversation thread
- Shows tool calls and progress
- Allows user to intervene or redirect

### Side Chats (User-Created)
```
Main Chat
▼ Side Chats (2)
  💬 Database Schema Discussion
  💬 API Design Brainstorm
```

---

## Agent-Initiated Workspace Actions

### Example Flow:
1. User: "Build a React app with auth"
2. Agent (in main chat): "I'll set up the workspace for this"
3. Agent opens tabs:
   - Browser → React docs (for reference)
   - Terminal → Running create-react-app
   - File → src/App.tsx (being created)
4. Agent spawns channels:
   - Channel 1: "Researching auth libraries"
   - Channel 2: "Setting up project structure"
5. User sees tabs appear in right panel
6. User sees channels appear in left panel
7. Agent reports progress in main chat

### User Controls:
- **Pin tab** - Keep tab open even when agent closes it
- **Dismiss channel** - Close agent background task
- **Take over** - Convert agent channel to side chat
- **Merge back** - Bring agent results into main chat

---

## Skills System (Plugin Architecture)

### What is a Skill?
A skill is a workspace tab type that agents and users can open.

### Built-in Skills:
```typescript
const skills = {
  browser: {
    name: 'Web Browser',
    icon: 'globe',
    component: BrowserTab,
    canOpenMultiple: true,
    agentCanOpen: true,
  },
  file: {
    name: 'File Viewer',
    icon: 'file',
    component: FileTab,
    canOpenMultiple: true,
    agentCanOpen: true,
  },
  terminal: {
    name: 'Terminal',
    icon: 'terminal',
    component: TerminalTab,
    canOpenMultiple: true,
    agentCanOpen: true,
  },
  review: {
    name: 'Code Review',
    icon: 'git-compare',
    component: ReviewTab,
    canOpenMultiple: false,
    agentCanOpen: true,
  },
  chat: {
    name: 'Side Chat',
    icon: 'message-square',
    component: ChatTab,
    canOpenMultiple: true,
    agentCanOpen: false, // User creates, agent joins
  },
}
```

### MCP Server as Skills:
MCP servers register as skills:
```typescript
{
  name: 'PostgreSQL',
  icon: 'database',
  component: DatabaseTab,
  mcpServer: 'postgres-mcp',
}
```

---

## Multi-Model Support Architecture

### Provider Registry:
```typescript
interface LLMProvider {
  id: string
  name: string
  type: 'cloud' | 'local'
  models: Model[]
  connect: () => Promise<void>
  chat: (messages: Message[]) => AsyncIterable<Chunk>
}

const providers = [
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    type: 'cloud',
    models: ['kimi-k2', 'kimi-k1.5'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'cloud',
    models: ['claude-3-opus', 'claude-3-sonnet'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'cloud',
    models: ['gpt-4o', 'gpt-4-turbo'],
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    type: 'local',
    models: ['llama3', 'mistral', 'codellama'],
  },
]
```

### Per-Chat Model Selection:
Each chat can use a different model:
- Main chat: Kimi K2
- Side chat 1: Local Llama3
- Agent channel: Claude (for coding tasks)

---

## Feature Roadmap (Priority Order)

### P0: Foundation (This Week)
1. ✅ Rename to Cedric
2. 🔴 Multi-tab workspace (dynamic tabs)
3. 🔴 + Button with tab creation palette
4. 🔴 Multiple browser instances
5. 🔴 Multiple file tabs

### P1: Agent System (Next 2 Weeks)
6. 🔴 Agent channels (background tasks)
7. 🔴 Side chat system
8. 🟡 Agent can open workspace tabs
9. 🟡 Agent progress indicators

### P2: Tool Ecosystem (Next Month)
10. 🔴 MCP server integration
11. 🟡 Skill registry system
12. 🟡 Plugin architecture
13. 🟡 Terminal integration

### P3: Model Agnostic (Next Month)
14. 🔴 Anthropic provider
15. 🔴 OpenAI provider
16. 🔴 Ollama/local provider
17. 🟡 Model switching per chat

### P4: Advanced Features (Next Quarter)
18. 🟡 Browser annotation tools
19. 🟡 Image editing/annotation
20. 🟡 PDF annotation
21. 🟡 Workspace templates
22. 🟡 Collaboration mode

---

## UX Flow Examples

### Flow 1: Research Task
```
User: "Research React state management"

Agent Actions:
1. Opens Browser tab → Google search
2. Opens Browser tab → Redux docs
3. Opens Browser tab → Zustand docs
4. Opens Side Chat → "Compare options"

User Sees:
Left Panel:
  Main Chat: "Researching..."
  ▼ Background Tasks (1)
    ● Comparing state management...

Right Panel:
  [Browser: Google] [Browser: Redux] [Browser: Zustand] [Side Chat]

Result:
Agent returns summary in main chat
User has all reference tabs open
```

### Flow 2: Coding Task
```
User: "Add authentication to this project"

Agent Actions:
1. Opens File tab → src/auth.ts (creates)
2. Opens File tab → src/App.tsx (edits)
3. Opens Terminal → npm install auth-library
4. Spawns Agent Channel → "Research auth patterns"
5. Opens Browser → Auth library docs

User Sees:
Left Panel:
  Main Chat: "Setting up auth..."
  ▼ Background Tasks (2)
    ● Researching auth patterns...
    ● Installing dependencies...

Right Panel:
  [auth.ts] [App.tsx] [terminal] [Browser: Auth Docs]

Result:
Code written, dependencies installed
User can review changes in file tabs
```

### Flow 3: Multi-File Refactor
```
User: "Refactor all API calls to use fetch"

Agent Actions:
1. Opens multiple File tabs → api.ts, user.ts, posts.ts
2. Edits each file
3. Opens Review tab → Shows diff
4. Opens Terminal → Runs tests

User Sees:
Right Panel:
  [api.ts] [user.ts] [posts.ts] [Review] [terminal]

Result:
All files refactored, diff visible
User reviews and approves
```

---

## Why This Beats Codex/Claude Apps

### Cedric Advantages:
1. **Multi-model** - Not locked to one provider
2. **Local models** - Works offline
3. **Multi-tab** - Multiple browsers, files, terminals
4. **Agent channels** - True parallel processing
5. **Open ecosystem** - MCP servers, plugins
6. **User control** - Always see what agent is doing
7. **Side chats** - Multiple conversation threads
8. **No subscription** - Use local models for free

### Cedric is the "VS Code" of LLM apps:
- VS Code: Multi-file, multi-terminal, extensions
- Cedric: Multi-chat, multi-browser, skills/plugins

---

## Implementation Strategy

### Step 1: Workspace Refactor
- Replace static tabs with dynamic tab system
- Implement TabBar component with + button
- Create TabRegistry for tab types
- Allow multiple instances of same tab type

### Step 2: Tab Types
- BrowserTab (with URL bar, multiple instances)
- FileTab (code viewer, multiple instances)
- TerminalTab (integrated shell)
- ChatTab (side conversations)
- ReviewTab (git diff)

### Step 3: Agent Integration
- Agent can open tabs via API
- Agent can spawn channels
- Agent reports progress to channels
- User can view/intervene in channels

### Step 4: Model Providers
- Abstract provider interface
- Implement Kimi provider
- Implement Anthropic provider
- Implement Ollama provider
- Allow per-chat model selection

---

## Success Metrics

1. **Tabs per session** - Average 3+ tabs open
2. **Agent channels** - Users spawn background tasks
3. **Side chats** - Users create parallel conversations
4. **Model switching** - Users try multiple models
5. **Skill usage** - Users install/use plugins
6. **Session duration** - Longer than typical chat apps

---

## The Dream

A developer opens Cedric:
- Main chat with Kimi K2
- Right panel: 3 browser tabs, 2 file tabs, 1 terminal
- Agent is refactoring code in background
- Side chat with local Llama3 for quick questions
- No vendor lock-in, full control, unlimited tools

**This is the LLM OS the world needs.**
