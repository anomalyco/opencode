# ZFlow - AI Agent Workstation Design Document

**Date**: 2025-01-26
**Status**: Design Phase
**Based on**: OpenCode (https://github.com/anomalyco/opencode)

---

## 1. Project Overview

### 1.1 Vision
ZFlow is an intelligent AI Agent workstation based on OpenCode, providing visualized task management, conversational interaction, and document processing capabilities. Like Manus, it helps users complete complex tasks such as writing PPTs, organizing documents, researching materials, and writing code.

### 1.2 Core Philosophy
- **Maximum Code Reuse**: Leverage existing OpenCode architecture and components
- **Visual First**: Task visualization and progress tracking
- **Ecosystem Integration**: Full support for Skills and MCP tools
- **Hybrid Architecture**: Local standalone + Remote server connection
- **Developer Friendly**: Based on proven Tauri + SolidJS stack

---

## 2. Architecture

### 2.1 Technology Stack

**Frontend Framework**:
- Tauri 2.x (Desktop shell)
- SolidJS (UI framework)
- Vite (Build tool)

**Core Dependencies**:
- `@opencode-ai/app` - Reuse existing UI components and pages
- `@opencode-ai/ui` - Reuse UI component library
- `@opencode-ai/opencode` - OpenCode core logic

**Communication**:
- REST API (OpenCode Server)
- SSE (Server-Sent Events) for real-time updates
- WebSocket (optional for bidirectional communication)

### 2.2 Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                 ZFlow Desktop UI Layer                   │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ Skills Panel│  │ MCP Panel   │  │ Chat View   │    │
│  │ - Available │  │ - Connection│  │ - Messages  │    │
│  │   Skills    │  │   Status    │  │ - Tool Calls│    │
│  │ - Docs/Desc │  │ - Tool List │  │   Visualized│    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │Task Timeline│  │Project Files│  │Doc Workspace│    │
│  │ - Steps     │  │ - File Tree │  │ - Editor    │    │
│  │ - Progress  │  │ - Code View │  │ - PPT Builder│   │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
├─────────────────────────────────────────────────────────┤
│              OpenCode Core API Layer                     │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Agent Dispatcher │ Skills Loader │ MCP Manager  │   │
│  └─────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│              Local Mode  │  Remote Mode                  │
│     (Embedded OpenCode)    (Remote Server)              │
└─────────────────────────────────────────────────────────┘
```

### 2.3 Package Structure

```
packages/
├── desktop/           # Reuse existing Tauri shell
├── desktop-viz/       # NEW: Task visualization components
│   └── src/
│       ├── components/
│       │   ├── TaskTimeline.tsx      # Task timeline view
│       │   ├── StepVisualization.tsx # Step-by-step progress
│       │   ├── ToolCallMonitor.tsx   # Tool call tracking
│       │   └── ProgressIndicator.tsx # Progress display
│       ├── pages/
│       │   ├── TaskView.tsx          # Task visualization page
│       │   ├── SkillsPanel.tsx       # Skills management panel
│       │   └── McpDashboard.tsx      # MCP dashboard
│       └── hooks/
│           └── useTaskProgress.ts    # Task progress hook
├── desktop-docs/      # NEW: Document workspace components
│   └── src/
│       ├── components/
│       │   ├── DocEditor.tsx         # Document editor
│       │   ├── PptBuilder.tsx        # PPT generator
│       │   └── KnowledgeBase.tsx     # Knowledge management
│       └── pages/
│           └── DocWorkspace.tsx      # Document workspace page
├── app/               # REUSE: Existing UI components
├── ui/                # REUSE: UI component library
└── opencode/          # REUSE: Core logic and server
```

---

## 3. Core Features

### 3.1 Conversational Interface (Priority 1)

**Reuse**: `@opencode-ai/app` Session page

**Features**:
- Multi-agent switching (Build/Plan agents)
- Real-time streaming responses
- Message history
- File attachments
- Permission management

**Extensions**:
- Enhanced tool call visualization
- Inline skill invocation
- Context-aware suggestions

### 3.2 Task Visualization (Priority 1)

**New Components**:

**TaskTimeline**
- Visual timeline of agent execution
- Collapsible step groups
- Status indicators (pending, running, completed, failed)
- Time estimates and actual duration

**StepVisualization**
- Detailed view of each step
- Tool calls with parameters and results
- File changes preview
- Error messages and stack traces

**ToolCallMonitor**
- Real-time tool call tracking
- Retry mechanism
- Parameter editing
- Result inspection

### 3.3 Skills Ecosystem (Priority 2)

**Reuse**: OpenCode Skills system
- Scan `.claude/skills/` and `.opencode/skill/` directories
- Parse `SKILL.md` files

**New UI**:

**SkillsPanel**
- List all available skills
- Search and filter
- Skill documentation viewer
- One-click invocation
- Enable/disable toggles

**Integration**:
- Invoke skills from chat
- Skill recommendations based on context
- Custom skill creation wizard

### 3.4 MCP Tools (Priority 2)

**Reuse**: OpenCode MCP system
- Local (stdio) and remote (HTTP/SSE) servers
- OAuth authentication
- Tool, prompt, and resource management

**New UI**:

**McpDashboard**
- Connection status monitor
- Server list with health indicators
- Tool browser with descriptions
- Authentication flow UI
- Real-time tool call visualization

**Features**:
- Connect/disconnect servers
- OAuth callback handling
- Tool testing interface
- Usage statistics

### 3.5 Document Workspace (Priority 3)

**New Components**:

**DocEditor**
- Markdown editor with live preview
- Code syntax highlighting
- Image embedding
- Table editing
- Export to PDF/Word

**PptBuilder**
- Template-based PPT generation
- Slide preview
- Layout customization
- Export to .pptx

**KnowledgeBase**
- Document organization
- Tag management
- Full-text search
- AI-powered summarization

### 3.6 Project Management (Reuse)

**Reuse**: `@opencode-ai/app` FileTree, Code, Terminal components

**Features**:
- Project file browser
- Code editor with syntax highlighting
- Integrated terminal
- Git integration

---

## 4. Skills & MCP Integration

### 4.1 Skills Architecture

OpenCode already has a complete Skills system:

```typescript
// From packages/opencode/src/skill/skill.ts
- Scans .claude/skills/ and .opencode/skill/ directories
- Parses SKILL.md frontmatter (name, description)
- Provides Skill.all() and Skill.get() APIs
```

**ZFlow Integration**:
- Display available skills in UI panel
- Allow skill invocation from chat
- Show skill documentation inline
- Create custom skills through UI

### 4.2 MCP Architecture

OpenCode has complete MCP support:

```typescript
// From packages/opencode/src/mcp/index.ts
- Supports local (stdio) and remote (HTTP/SSE) servers
- OAuth authentication flow
- Provides tools, prompts, and resources
- Status monitoring and error handling
```

**ZFlow Integration**:
- Visual MCP server management
- Real-time connection status
- Tool browser with search
- OAuth authentication UI
- Tool call visualization in chat

---

## 5. Data Flow

### 5.1 Agent Execution Flow

```
User Input
    ↓
Chat UI
    ↓
OpenCode API (POST /session/:id/message)
    ↓
Agent processes message
    ↓
Agent invokes tools (Skills, MCP, File ops, etc.)
    ↓
Events streamed via SSE (/event)
    ↓
UI updates in real-time
    ↓
Task visualization components render progress
```

### 5.2 Event Types

Key events from OpenCode Server:

```typescript
- "session.message"        - New message
- "session.tool_call"      - Tool invocation
- "session.step"           - Step completion
- "session.error"          - Error occurrence
- "mcp.tools.changed"      - MCP tools updated
- "server.heartbeat"       - Keepalive
```

---

## 6. UI/UX Design

### 6.1 Layout

```
┌──────────────────────────────────────────────────────────┐
│  Menu Bar  │  ZFlow Logo  │  [Skills] [MCP] [Settings]  │
├──────┬─────┴──────┬─────────────────┴──────────┬───────┤
│      │             │                          │        │
│ File │   Chat      │    Task Timeline         │  Docs  │
│ Tree │   View      │    - Step 1: ✓           │  Panel │
│      │   - Msg 1   │    - Step 2: 🔄 Running  │        │
│ 📁   │   - Msg 2   │    - Step 3: ⏳ Pending  │  Editor│
│ 📁   │   - ...     │                         │        │
│      │             │    Tool Calls:          │  PPT   │
│ 📁   │   [Input]   │    - grep: ✓            │  Gen   │
│      │             │    - write: 🔄          │        │
└──────┴─────────────┴──────────────────────────┴───────┘
```

### 6.2 Color Scheme

**Primary**: Blue/Purple gradient (modern, tech-focused)
**Success**: Green (completed tasks)
**Warning**: Yellow (running tasks)
**Error**: Red (failed tasks)
**Neutral**: Grays (background, text)

### 6.3 Typography

**Font**: Inter or system fonts
**Sizes**: 12px (body), 14px (headers), 16px (titles)
**Weights**: Regular (400), Medium (500), Semibold (600)

---

## 7. Packaging & Distribution

### 7.1 Build Configuration

**Tauri Configuration** (`tauri.conf.json`):
```json
{
  "productName": "ZFlow",
  "identifier": "ai.zflow.desktop",
  "bundle": {
    "targets": ["nsis", "dmg", "deb", "rpm"],
    "icon": ["icons/zflow/32x32.png", "..."],
    "windows": {
      "nsis": {
        "installerIcon": "icons/zflow/icon.ico",
        "headerImage": "assets/nsis-header.bmp",
        "sidebarImage": "assets/nsis-sidebar.bmp"
      }
    }
  }
}
```

### 7.2 Build Commands

```bash
# Development
bun run tauri dev

# Build for current platform
bun run tauri build

# Output
# Windows: packages/desktop/src-tauri/target/release/bundle/nsis/ZFlow_x64-setup.exe
# macOS: packages/desktop/src-tauri/target/release/bundle/dmg/ZFlow.dmg
# Linux: packages/desktop/src-tauri/target/release/bundle/deb/zflow_amd64.deb
```

### 7.3 Branding

**Customizable Assets**:
- Application icon (all platforms)
- Installer images (NSIS header/sidebar)
- Splash screen
- About dialog
- Metadata (name, version, description)

---

## 8. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
1. Set up development environment (git worktree)
2. Create new packages (`desktop-viz`, `desktop-docs`)
3. Integrate with existing `@opencode-ai/app`
4. Basic routing and layout

### Phase 2: Core Features (Week 3-4)
1. Implement TaskTimeline component
2. Implement StepVisualization component
3. Implement ToolCallMonitor component
4. Integrate SSE event handling
5. Add Skills panel
6. Add MCP dashboard

### Phase 3: Document Workspace (Week 5-6)
1. Implement DocEditor component
2. Implement PptBuilder component
3. Implement KnowledgeBase component
4. Integrate with agent workflows

### Phase 4: Polish & Testing (Week 7-8)
1. UI/UX refinement
2. Performance optimization
3. Cross-platform testing
4. Documentation
5. Beta release

---

## 9. Success Criteria

- ✅ Can invoke Skills and MCP tools through UI
- ✅ Can visualize agent task execution in real-time
- ✅ Can create and edit documents
- ✅ Can generate PPT from templates
- ✅ Can package as .exe/.dmg/.deb
- ✅ Can run standalone (local mode)
- ✅ Can connect to remote OpenCode server
- ✅ Performance comparable to OpenCode TUI
- ✅ Positive user feedback (beta testers)

---

## 10. Future Enhancements

**v2.0+**:
- Mobile companion app (React Native)
- Cloud sync and collaboration
- Custom agent builder
- Plugin marketplace
- Voice interaction
- Screen sharing and remote control
- Advanced analytics and insights

---

## Appendix

### A. References

- OpenCode: https://github.com/anomalyco/opencode
- Tauri: https://tauri.app/
- SolidJS: https://solidjs.com/
- MCP: https://modelcontextprotocol.io/

### B. Design Decisions

**Why Tauri over Electron?**
- Smaller bundle size (~10MB vs ~150MB)
- Better performance (Rust backend)
- Lower memory footprint
- Better security

**Why SolidJS over React?**
- Consistent with OpenCode
- Better performance (fine-grained reactivity)
- Smaller bundle size
- Simpler mental model

**Why maximum reuse?**
- Faster development
- Proven stability
- Easier maintenance
- Leverage OpenCode improvements

### C. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| OpenCode API changes | Version pinning, abstract API layer |
| Performance issues | Lazy loading, virtualization |
| Cross-platform bugs | Early testing, CI/CD |
| Limited resources | Prioritize features, community contributions |

---

**Document Version**: 1.0
**Last Updated**: 2025-01-26
**Next Review**: After Phase 1 completion
