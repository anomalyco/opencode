# Product Requirements Document: Cerebras Code

## Document Information

- **Product Name:** Cerebras Code (formerly OpenCode)
- **Version:** 1.0
- **Last Updated:** 2025-11-28
- **Document Owner:** Product Team
- **Status:** Active Development

---

## Executive Summary

Cerebras Code is an AI-powered coding assistant built specifically for terminal environments, offering blazing-fast inference powered by advanced language models. It combines a terminal-first user interface with comprehensive development tools including LSP support, code formatters, and multi-provider AI integration. The product empowers developers to build, analyze, and maintain codebases through an intelligent AI agent that can read, write, and execute code directly in the terminal.

---

## Product Vision & Mission

### Vision

To be the most powerful and flexible terminal-based AI coding assistant that seamlessly integrates into developer workflows, providing provider-agnostic AI capabilities with unmatched speed and user experience.

### Mission

Democratize AI-assisted development by providing an open-source, terminal-native coding agent that works with any AI provider, supports any programming language, and enhances developer productivity without vendor lock-in.

### Core Principles

1. **Terminal-First:** Built by terminal enthusiasts (neovim users) for terminal enthusiasts
2. **Provider Agnostic:** Not coupled to any single AI provider (Claude, OpenAI, Google, local models)
3. **Open Source:** 100% open source with MIT license
4. **Speed:** Blazing-fast performance using Bun runtime
5. **Flexibility:** Customizable through themes, keybinds, formatters, and plugins
6. **Intelligence:** Advanced features like LSP integration, code search, and multi-step planning

---

## Target Users

### Primary Users

#### 1. Terminal Power Users

- **Profile:** Developers who primarily work in terminal environments (vim/neovim, tmux users)
- **Needs:**
  - Keyboard-driven workflow
  - Fast, responsive terminal UI
  - Deep customization options
  - Integration with existing terminal setup
- **Pain Points:**
  - GUI-based AI tools slow down workflow
  - Context switching between editor and AI interface

#### 2. Full-Stack Developers

- **Profile:** Engineers working across multiple languages and frameworks
- **Needs:**
  - Multi-language support
  - Project-wide code understanding
  - Intelligent refactoring and feature implementation
- **Pain Points:**
  - Lack of context-aware AI assistance
  - Manual code navigation and understanding

#### 3. Platform Engineers & DevOps

- **Profile:** Engineers managing infrastructure, build systems, and deployment pipelines
- **Needs:**
  - Command execution capabilities
  - File system operations
  - Script generation and debugging
- **Pain Points:**
  - Complex multi-step operations
  - Documentation and script maintenance

#### 4. Open Source Contributors

- **Profile:** Developers contributing to unfamiliar codebases
- **Needs:**
  - Code exploration and understanding
  - Safe read-only analysis mode
  - Documentation generation
- **Pain Points:**
  - Steep learning curve for new projects
  - Fear of making unintended changes

### Secondary Users

#### 5. Enterprise Development Teams

- **Profile:** Organizations requiring secure, self-hosted AI solutions
- **Needs:**
  - Authentication and access control
  - Shared workspaces
  - Usage tracking and compliance
- **Pain Points:**
  - Data privacy concerns with cloud AI
  - Cost management and quota control

---

## Key Features & Functionality

### 1. AI Agent System

#### Build Agent (Default)

- **Purpose:** Full-access agent for active development work
- **Capabilities:**
  - Read and write files
  - Execute bash commands
  - Install dependencies
  - Run tests and builds
  - Commit changes
  - Create pull requests
- **Use Cases:**
  - Feature implementation
  - Bug fixes
  - Refactoring
  - Test writing

#### Plan Agent (Read-Only)

- **Purpose:** Analysis and code exploration without modifications
- **Capabilities:**
  - Read files and directories
  - Search codebase
  - Analyze architecture
  - Generate implementation plans
  - Requires permission for bash commands
- **Use Cases:**
  - Exploring unfamiliar codebases
  - Planning major changes
  - Code review and analysis
  - Learning project structure

#### General Sub-Agent

- **Purpose:** Complex searches and multi-step analytical tasks
- **Invocation:** `@general` in messages
- **Capabilities:**
  - Multi-file analysis
  - Pattern detection
  - Comprehensive code search
- **Use Cases:**
  - Cross-cutting concerns
  - Dependency analysis
  - Security audits

### 2. Developer Tools Integration

#### Language Server Protocol (LSP) Support

- **Out-of-the-box LSP integration**
- **Features:**
  - Code diagnostics (errors, warnings)
  - Hover information
  - Auto-completion context
  - Symbol navigation
- **Benefits:**
  - Real-time code intelligence
  - Reduced hallucinations
  - Better code suggestions
  - Language-specific awareness

#### Code Formatters

- **Configurable formatters per language**
- **Support for:**
  - Prettier (JavaScript/TypeScript)
  - Black (Python)
  - rustfmt (Rust)
  - gofmt (Go)
  - Custom formatters
- **Auto-formatting on save**

#### Code Search Tools

- **Grep:** Pattern-based content search
- **Glob:** File pattern matching
- **CodeSearch:** Intelligent semantic search
- **File Operations:** Read, Write, Edit, Batch operations

### 3. Terminal User Interface (TUI)

#### Visual Design

- **Technology:** Built with SolidJS and opentui framework
- **Responsive layout:** Adapts to terminal size
- **Split-pane design:** Code preview alongside chat
- **Status indicators:** Real-time agent status, mode indicators

#### Branding & Theming

##### Logo Implementation

- **ASCII Art Logo:**
  ```
  █▀▀▀ █▀▀ █▀▀█ █▀▀ █▀▀▄ █▀▀█ █▀▀█ █▀▀▀
  █    █▀▀ █▄▄▀ █▀▀ █▀▀▄ █▄▄▀ █▄▄█ ▀▀█
  ▀▀▀▀ ▀▀▀ ▀  ▀ ▀▀▀ ▀▀▀▀ ▀  ▀ ▀  ▀ ▀▀▀▀
  ```
- **Typewriter Animation:**
  - Characters reveal progressively at 25ms intervals
  - Reveals 2 characters per frame
  - Total animation duration: ~1 second
  - Creates engaging startup experience
- **Color Scheme:**
  - Primary brand color: `#f05a28` (Cerebras Orange)
  - Applied to logo text
  - Used in accent elements throughout UI
  - Consistent across all interfaces

##### Animation System

- **Typewriter Effect:**
  - Used for logo reveal on startup
  - Progressive character unveiling
  - Implemented in `/packages/cerebras/src/cli/cmd/tui/component/logo.tsx`
- **Breathing Animation:**
  - Pulse effect for loading states
  - 2-second ease-in-out cycle
  - Defined in `/packages/ui/src/styles/animations.css`
- **Fade Animations:**
  - Smooth element transitions
  - Staggered delays for sequential reveals
  - 0.4s duration with ease-out timing

##### Theme System

- **Built-in Themes:**
  - Solarized
  - Dracula
  - Monokai
  - Synthwave84
  - Palenight
  - Zenburn
  - Aura
  - Cobalt2
  - Flexoki
- **Custom Theme Support:** JSON-based theme definitions
- **Theme Switching:** Runtime theme changes without restart

#### Keyboard Navigation

- **Tab:** Switch between Build/Plan modes
- **@:** File fuzzy search
- **Ctrl+C:** Cancel operations
- **Custom Keybinds:** User-configurable shortcuts

#### Visual Feedback

- **Spinner Indicators:** Active operations
- **Progress Bars:** Long-running tasks
- **Status Messages:** Clear error and success states
- **Retry Notifications:** Graceful handling of rate limits

### 4. Multi-Provider AI Support

#### Supported Providers

1. **Cerebras Zen** (Recommended)
   - Curated, tested models
   - Optimized pricing
   - Managed by Cerebras team
   - Integrated billing

2. **Anthropic (Claude)**
   - Claude 3.5 Sonnet
   - Claude 3 Opus/Haiku
   - Best for complex reasoning

3. **OpenAI**
   - GPT-4/GPT-4 Turbo
   - GPT-3.5 Turbo
   - Code-specific models

4. **Google (Gemini)**
   - Gemini Pro
   - Gemini Flash
   - Multimodal capabilities

5. **Local Models**
   - llama.cpp integration
   - Ollama support
   - Self-hosted options

#### Provider Configuration

- **API Key Management:** Secure credential storage
- **Model Selection:** Per-provider model configuration
- **Token Limits:** Configurable context/output windows
- **Custom Endpoints:** Support for OpenAI-compatible APIs

### 5. Advanced Features

#### Session Management

- **Persistent Conversations:** Resume previous sessions
- **Session History:** Browse and restore past conversations
- **Undo/Redo:** Revert changes with `/undo` and `/redo` commands
- **Session Sharing:** Generate shareable links with `/share`

#### Git Integration

- **Commit Creation:** AI-assisted commit messages
- **PR Generation:** Automatic pull request creation
- **Branch Management:** Intelligent branch operations
- **Diff Analysis:** Understanding changes across commits

#### Workspace Features

- **Project Initialization:** Auto-generate `AGENTS.md` with `/init`
- **Multi-file Operations:** Batch edits across codebase
- **Dependency Management:** Install and update packages
- **Test Execution:** Run and debug test suites

#### Image Support

- **Drag-and-Drop:** Add images to prompts via terminal
- **Multimodal Context:** Reference UI designs, diagrams
- **Screenshot Analysis:** Debug visual issues

---

## Technical Requirements

### Architecture

#### Client-Server Design

```
┌─────────────────────────────────────────────┐
│           Terminal UI (TUI)                 │
│         (SolidJS + opentui)                 │
└──────────────┬──────────────────────────────┘
               │ WebSocket/IPC
┌──────────────▼──────────────────────────────┐
│         Cerebras Server                     │
│  • Session Management                       │
│  • Message Processing                       │
│  • Tool Execution                           │
│  • LSP Client                               │
└──────────────┬──────────────────────────────┘
               │
    ┌──────────┴──────────┬──────────────┐
    ▼                     ▼              ▼
┌─────────┐         ┌──────────┐    ┌────────┐
│AI Models│         │LSP Server│    │FS/Git  │
│(Various)│         │(Multiple)│    │        │
└─────────┘         └──────────┘    └────────┘
```

#### Technology Stack

- **Runtime:** Bun 1.3+ (for blazing-fast performance)
- **Language:** TypeScript 5.8+
- **UI Framework:** SolidJS 1.9+ with opentui
- **Package Manager:** Bun (with npm/pnpm/yarn compatibility)
- **Build System:** Turbo (monorepo management)
- **Type Checking:** Native TypeScript compiler

#### Package Structure

```
packages/
├── cerebras/          # Core CLI and server logic
├── ui/                # Reusable UI components
├── web/               # Documentation website (Astro)
├── console/           # Web console (Cerebras Zen)
├── desktop/           # Desktop application (Tauri)
├── enterprise/        # Enterprise features
├── sdk/               # SDKs (JavaScript, Python, Go)
├── slack/             # Slack integration
├── plugin/            # Plugin system (@cerebras-ai/plugin)
└── script/            # Build and utility scripts
```

#### Core Modules

##### Session Processing (`/src/session/`)

- **Message Handling:** MessageV2 protocol
- **Retry Logic:** Exponential backoff with jitter
- **Rate Limiting:** 429 detection and graceful degradation
- **Token Management:** Context window optimization

##### Tool System (`/src/tool/`)

- **Read/Write/Edit:** File operations
- **Bash:** Command execution
- **Grep/Glob:** File search
- **LSP Tools:** Diagnostics, hover, completion
- **WebSearch/WebFetch:** Internet access
- **Todo:** Task tracking
- **Batch:** Multi-operation efficiency

##### Configuration System (`/src/config/`)

- **Hierarchical Loading:**
  1. Global config (`~/.cerebras/`)
  2. Worktree config (`.cerebras/`)
  3. Project config (`cerebras.jsonc`)
  4. Environment variables
  5. CLI flags
- **JSON with Comments:** JSONC support
- **Schema Validation:** Zod-based validation
- **Dynamic Plugins:** Runtime plugin loading

##### Provider System (`/src/provider/`)

- **Provider Registry:** Dynamic provider loading
- **Model Configuration:** Per-model token limits
- **Custom Headers:** Client identification
- **Retry Optimization:** Provider-specific backoff
- **Caching:** Request deduplication

### Performance Requirements

#### Response Time

- **Initial Load:** < 2 seconds (cold start)
- **Agent Response:** < 500ms (initial token)
- **File Operations:** < 100ms (local files)
- **LSP Diagnostics:** < 200ms (real-time feedback)

#### Resource Usage

- **Memory:** < 200MB idle, < 1GB active
- **CPU:** Minimal background usage
- **Disk:** < 100MB installation size
- **Network:** Efficient token usage, request batching

#### Scalability

- **Large Codebases:** Support for 100k+ files
- **Long Sessions:** Handle hours-long conversations
- **Concurrent Operations:** Multiple file edits
- **Rate Limit Handling:** Graceful degradation under load

### Rate Limit & Retry System

#### Retry Budget

- **Maximum Attempts:** 5 retries per request
- **Budget Enforcement:** Session-level tracking
- **Fail-Fast:** Clear error after budget exhausted

#### Exponential Backoff

- **Initial Delay:** 2 seconds
- **Backoff Factor:** 2x multiplier
- **Maximum Delay:** 30 seconds (without headers)
- **Jitter:** 10% randomization to prevent thundering herd

#### 429 Rate Limit Handling

- **Detection:** Explicit status code checking
- **Aggressive Backoff:** Faster ramp-up for rate limits (4s, 8s, 16s)
- **Header Respect:** Honor `Retry-After` and `retry-after-ms` headers
- **User Messaging:** Clear, actionable error messages

#### Status Updates

```typescript
{
  type: "retry",
  attempt: 2,
  message: "Rate limit reached. Waiting before retry... (Attempt 2/5)",
  next: 1732800000000  // Timestamp of next attempt
}
```

### Security & Privacy

#### Credential Storage

- **Location:**
  - macOS/Linux: `~/.cerebras/session.json`
  - Windows: `%USERPROFILE%\.cerebras\session.json`
- **Permissions:** 0600 (user-only access)
- **Encryption:** Session tokens encrypted at rest
- **Auto-Refresh:** Token renewal before expiration

#### Data Handling

- **Local-First:** All code remains on user machine
- **Opt-In Sharing:** Sessions not shared by default
- **No Telemetry:** No tracking without consent
- **Audit Logs:** Track all file modifications

---

## UI/UX Requirements

### Branding Guidelines

#### Color Palette

- **Primary:** `#f05a28` (Cerebras Orange)
  - Logo accent
  - Active elements
  - Call-to-action buttons
- **Text:** Theme-dependent
  - Light themes: Dark text
  - Dark themes: Light text
- **Muted:** Theme-dependent secondary text
- **Background:** Theme-dependent

#### Typography

- **Monospace:** Required for terminal display
- **ASCII Art:** Block characters (█, ▀, ▄, etc.)
- **Consistent Spacing:** Aligned columns and borders

#### Logo Usage

1. **Startup Screen:**
   - Full ASCII logo with typewriter animation
   - Version number in bottom-right
   - Brand color (`#f05a28`) for main text

2. **Loading States:**
   - Spinner with brand color
   - "Cerebras" text indicator

3. **Documentation:**
   - SVG logos for web (`logo-ornate-light.svg`, `logo-ornate-dark.svg`)
   - Responsive to color scheme

#### Animation Guidelines

- **Purpose:** Enhance UX without slowing down
- **Duration:** Keep under 1 second for most animations
- **Interruption:** Allow users to cancel/skip
- **Performance:** No janky or dropped frames
- **Consistency:** Similar timing across features

### User Experience Flows

#### First-Time Setup

```
1. Install Cerebras
   ↓
2. Run `cerebras`
   ↓
3. Prompted to login
   ↓
4. Select AI provider (Cerebras Zen recommended)
   ↓
5. Enter API key
   ↓
6. Navigate to project
   ↓
7. Run `/init` to analyze project
   ↓
8. Start coding!
```

#### Typical Workflow

```
1. Open terminal in project
   ↓
2. Run `cerebras`
   ↓
3. Ask question or request change
   ↓
4. Review AI response and code changes
   ↓
5. Accept, reject, or refine
   ↓
6. Repeat until satisfied
   ↓
7. Share session if needed (`/share`)
```

#### Error Recovery

```
1. Error occurs (rate limit, network, etc.)
   ↓
2. Display clear error message
   ↓
3. Automatic retry with backoff
   ↓
4. Show countdown to next retry
   ↓
5. Provide manual alternatives
   ↓
6. Fail gracefully after max retries
```

### Accessibility

- **Keyboard-Only:** All features accessible via keyboard
- **Screen Readers:** Meaningful text output (no emoji-only indicators)
- **High Contrast:** Theme support for visibility
- **Status Announcements:** Clear progress indicators

---

## Authentication & Security

### Authentication Architecture

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│             │       │             │       │             │
│  CLI User   │──────▶│    Clerk    │──────▶│  Cerebras   │
│             │       │    OAuth    │       │   Backend   │
│             │       │             │       │   (AWS)     │
└─────────────┘       └─────────────┘       └─────────────┘
```

### Authentication Providers

#### 1. Clerk (Primary)

- **Purpose:** User authentication and session management
- **Flow:** Device authorization grant (OAuth 2.0)
- **Methods:**
  - Email/Password
  - Google OAuth
  - GitHub OAuth
- **Free Tier:** 10,000 MAU (sufficient for most users)

#### 2. Custom Providers

- **Extensible:** Plugin-based authentication
- **Interface:** Standard auth provider contract
- **Examples:** Custom OAuth, SAML, LDAP (enterprise)

### Authentication Flows

#### Device Flow (CLI)

```
1. User runs: cerebras
   ↓
2. CLI checks: authenticated?
   ↓ (if no)
3. Prompt: "Would you like to login?"
   ↓
4. CLI calls: Clerk device flow
   ↓
5. Display: verification URL + code
   ↓
6. User opens browser and logs in
   ↓
7. CLI polls for completion
   ↓
8. Session stored locally (encrypted)
   ↓
9. CLI starts normally
```

#### Commands

```bash
# Login to Cerebras
cerebras auth login

# Login to AI provider
cerebras auth login --provider

# Logout
cerebras auth logout

# Check status
cerebras auth list
```

### Session Management

- **Duration:** 30 days (configurable)
- **Auto-Refresh:** Before expiration
- **Device Tracking:** Multiple device support
- **Revocation:** Manual logout or server-side revoke

### Enterprise Features

- **SSO Integration:** SAML/OIDC support
- **Access Control:** Role-based permissions
- **Audit Logging:** Track all operations
- **Workspace Sharing:** Team collaboration
- **Usage Quotas:** Per-user limits
- **Billing Integration:** Usage tracking

### Security Best Practices

- **No Hardcoded Secrets:** Environment variables only
- **Least Privilege:** Minimal required permissions
- **Rate Limiting:** Prevent abuse
- **Input Validation:** Sanitize all user input
- **Secure Defaults:** Auth required by default
- **Dev Mode Override:** `CEREBRAS_SKIP_AUTH=true` (dev only)

---

## Release & Deployment Process

### Package Distribution

#### npm Registry

- **Package Name:** `cerebras-ai` (formerly `opencode-ai`)
- **Scoped Packages:**
  - `@cerebras-ai/sdk`
  - `@cerebras-ai/script`
  - `@cerebras-ai/plugin`
- **Registry:** https://www.npmjs.com/package/cerebras-ai

#### Installation Methods

##### Package Managers

```bash
# npm
npm install -g cerebras-ai

# Bun
bun install -g cerebras-ai

# pnpm
pnpm install -g cerebras-ai

# Yarn
yarn global add cerebras-ai
```

##### Homebrew (macOS/Linux)

```bash
brew tap arihantchoudhary/tap
brew install cerebras
```

##### Platform-Specific

```bash
# Arch Linux (AUR)
paru -S cerebras-bin

# Windows Chocolatey
choco install cerebras

# Windows Scoop
scoop bucket add extras
scoop install extras/cerebras
```

##### Install Script

```bash
# macOS/Linux
curl -fsSL https://opencode.ai/install | bash

# Windows PowerShell
irm https://opencode.ai/install | iex
```

##### Docker

```bash
docker pull ghcr.io/arihantchoudhary/opencode:latest
```

### Build System

#### Binary Targets

- **Linux:** x64, arm64, musl variants
- **macOS:** x64 (Intel), arm64 (Apple Silicon)
- **Windows:** x64

#### Build Pipeline

```bash
# Development build
bun run dev

# Production build
bun run build

# Type checking
bun run typecheck

# Tests
bun test
```

### Release Workflow

#### Version Bumping

- **Patch:** Bug fixes (1.0.0 → 1.0.1)
- **Minor:** New features (1.0.0 → 1.1.0)
- **Major:** Breaking changes (1.0.0 → 2.0.0)

#### GitHub Actions Workflow

```yaml
Trigger: Manual via GitHub UI or CLI
Inputs: bump type (patch/minor/major)

Steps:
1. Build binaries for all platforms
2. Run tests
3. Publish to npm
4. Create GitHub Release
5. Upload binaries
6. Build Docker image
7. Push to ghcr.io
8. Tag release in git
```

#### Automatic Snapshots

- **Trigger:** Every push to `dev` branch
- **Version:** `0.0.0-dev-YYYYMMDDHHMMSS`
- **Purpose:** Testing before official release

#### Release Commands

```bash
# Via GitHub CLI
gh workflow run publish.yml -f bump=patch

# Via GitHub Website
Actions → publish.yml → Run workflow → Select bump type
```

### Deployment Checklist

- [ ] All tests passing
- [ ] Version bumped in package.json
- [ ] CHANGELOG.md updated
- [ ] Breaking changes documented
- [ ] Migration guide (if needed)
- [ ] npm token configured
- [ ] GitHub token configured
- [ ] Docker registry access
- [ ] Homebrew formula updated

### Monitoring & Rollback

- **Health Checks:** Monitor npm downloads
- **Error Tracking:** GitHub Issues
- **User Feedback:** Discord, discussions
- **Rollback:** Publish previous version with higher patch number

---

## Success Metrics

### Key Performance Indicators (KPIs)

#### Adoption Metrics

- **Downloads:** npm/Homebrew install counts
- **Active Users:** Daily/Monthly active users
- **Retention:** 7-day, 30-day retention rates
- **Growth Rate:** Week-over-week user growth

#### Usage Metrics

- **Session Duration:** Average time per session
- **Messages per Session:** User engagement level
- **Tool Usage:** Which tools are most popular
- **Provider Mix:** Distribution across AI providers

#### Quality Metrics

- **Error Rate:** % of failed operations
- **Retry Success Rate:** % of successful retries after errors
- **Rate Limit Hits:** Frequency of 429 errors
- **Response Time:** P50, P95, P99 latencies

#### Community Metrics

- **GitHub Stars:** Repository popularity
- **Contributors:** Active contributor count
- **PR Velocity:** Time to merge pull requests
- **Issue Resolution:** Time to close issues

### Success Targets (Year 1)

| Metric                   | Target       |
| ------------------------ | ------------ |
| Total Downloads          | 100,000+     |
| Monthly Active Users     | 10,000+      |
| GitHub Stars             | 5,000+       |
| 30-Day Retention         | > 40%        |
| Average Session Duration | > 15 minutes |
| Error Rate               | < 2%         |
| Retry Success Rate       | > 70%        |
| Community Contributors   | 50+          |

### User Satisfaction

- **Net Promoter Score (NPS):** > 40
- **User Surveys:** Quarterly feedback
- **Feature Requests:** Track most-wanted features
- **Bug Reports:** Trend analysis

---

## Roadmap & Future Enhancements

### Q1 2025 (Current)

- [x] Rebranding from OpenCode to Cerebras
- [x] Clerk authentication integration
- [x] Rate limit handling improvements
- [x] GLM 4.6 provider optimization
- [ ] Logo animation refinements
- [ ] Performance optimizations
- [ ] Documentation expansion

### Q2 2025

- [ ] **Mobile Client**
  - iOS/Android app
  - Remote connection to desktop Cerebras server
  - Touch-optimized UI
  - Push notifications for long tasks

- [ ] **Enhanced LSP Features**
  - Go-to-definition integration
  - Find-all-references
  - Rename refactoring
  - Code lens actions

- [ ] **Advanced Collaboration**
  - Real-time session sharing
  - Team workspaces
  - Code review mode
  - Shared context/memory

- [ ] **Plugin Marketplace**
  - Community plugins
  - One-click installation
  - Plugin ratings/reviews
  - Plugin development SDK

### Q3 2025

- [ ] **Local Model Improvements**
  - Better llama.cpp integration
  - Model switching based on task
  - Hybrid cloud/local mode
  - Custom model fine-tuning

- [ ] **IDE Integrations**
  - VS Code extension (beyond current SDK)
  - JetBrains plugin
  - Neovim native integration
  - Emacs mode

- [ ] **Enterprise Features**
  - Self-hosted deployment
  - Advanced access controls
  - Compliance reporting
  - SLA guarantees

### Q4 2025

- [ ] **AI Improvements**
  - Dynamic model fallback
  - Multi-model consensus
  - Context caching
  - Prompt optimization

- [ ] **Workflow Automation**
  - Saved command sequences
  - Scheduled tasks
  - CI/CD integration
  - Automated PR reviews

- [ ] **Advanced Search**
  - Semantic code search
  - Cross-repository search
  - Historical code analysis
  - Dependency graph visualization

### Long-Term Vision (2026+)

#### Autonomous Development

- **Self-Healing Code:** Automatic bug detection and fixing
- **Test Generation:** Comprehensive test suite creation
- **Documentation:** Auto-generated, always up-to-date docs
- **Dependency Management:** Automatic updates and migrations

#### Multi-Agent Systems

- **Specialized Agents:** Security, performance, testing agents
- **Agent Collaboration:** Multi-agent problem solving
- **Agent Marketplace:** Community-created specialist agents

#### Advanced Context

- **Long-Term Memory:** Remember across sessions
- **Project Knowledge Graph:** Deep codebase understanding
- **Learning from History:** Improve from past interactions
- **Personalization:** Adapt to individual coding style

#### Platform Expansion

- **Web IDE:** Browser-based Cerebras
- **Cloud Workspaces:** Remote development environments
- **Educational Platform:** Interactive coding tutorials
- **Team Analytics:** Insights into team productivity

---

## Constraints & Limitations

### Technical Constraints

- **Terminal Dependency:** Requires modern terminal emulator
- **Bun Runtime:** Specific runtime requirement
- **API Keys:** Users must provide own AI provider keys
- **Network Required:** Authentication and AI calls need connectivity
- **File System Access:** Needs read/write permissions

### Provider Limitations

- **Rate Limits:** Dependent on provider quotas
- **Token Limits:** Model context window constraints
- **API Changes:** External API breaking changes
- **Cost Variability:** Provider pricing fluctuations

### User Environment

- **Terminal Compatibility:** Not all terminals support features
- **OS Differences:** Platform-specific quirks
- **Network Restrictions:** Corporate firewalls
- **Disk Space:** Limited on some systems

### Known Issues

- **Debugging TSX Files:** Breakpoints not fully supported in `*.tsx`
- **Windows Bun Support:** Installation via Bun in progress
- **Large File Performance:** Slower on massive files (>10k lines)
- **Memory Usage:** High memory usage in long sessions

---

## Dependencies & Integration

### Core Dependencies

- **Runtime:** Bun 1.3+
- **UI:** SolidJS 1.9+, opentui framework
- **Build:** Turbo 2.5+, Vite 7.1+
- **Validation:** Zod 4.1+
- **Utilities:** Remeda, Luxon, Fuzzysort

### AI SDK Integration

- **Vercel AI SDK:** Provider abstraction
- **OpenAI Compatible:** Standard API format
- **Custom Providers:** Plugin system

### External Services

- **Clerk:** Authentication (optional)
- **AWS:** Backend services (optional)
- **GitHub:** Code hosting, releases
- **npm:** Package distribution

### LSP Servers

- **TypeScript:** tsserver
- **Python:** Pyright, Pylance
- **Rust:** rust-analyzer
- **Go:** gopls
- **And many more...**

---

## Risk Assessment

### Technical Risks

| Risk                     | Probability | Impact   | Mitigation                               |
| ------------------------ | ----------- | -------- | ---------------------------------------- |
| AI Provider API Changes  | High        | High     | Multi-provider support, version pinning  |
| Rate Limit Issues        | Medium      | Medium   | Retry logic, backoff, user messaging     |
| Performance Degradation  | Medium      | High     | Profiling, optimization, resource limits |
| Security Vulnerabilities | Low         | Critical | Regular audits, dependency updates       |
| Data Loss                | Low         | High     | Auto-save, git integration, backups      |

### Business Risks

| Risk               | Probability | Impact | Mitigation                                             |
| ------------------ | ----------- | ------ | ------------------------------------------------------ |
| User Adoption      | Medium      | High   | Marketing, documentation, community building           |
| Competition        | High        | Medium | Focus on unique features (terminal-first, open source) |
| Provider Costs     | Medium      | Medium | Efficient token usage, local model support             |
| Maintenance Burden | Medium      | Medium | Community contributions, automated testing             |
| Reputation Damage  | Low         | High   | Quality assurance, responsive support                  |

### Legal & Compliance Risks

| Risk               | Probability | Impact   | Mitigation                                     |
| ------------------ | ----------- | -------- | ---------------------------------------------- |
| License Issues     | Low         | High     | Clear MIT license, dependency audits           |
| Privacy Violations | Low         | Critical | Local-first, explicit consent, GDPR compliance |
| Trademark Disputes | Low         | Medium   | Proper branding, legal review                  |
| Data Sovereignty   | Medium      | Medium   | Self-hosting options, regional compliance      |

---

## Appendix

### A. Configuration Example

```jsonc
{
  "$schema": "https://opencode.ai/config.json",

  // AI Provider Configuration
  "provider": {
    "cerebras": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Cerebras",
      "options": {
        "baseURL": "https://api.cerebras.ai/v1",
      },
      "models": {
        "glm-4-6b": {
          "name": "GLM 4.6",
          "limit": {
            "context": 128000,
            "output": 8192,
          },
        },
      },
    },
  },

  // Agent Configuration
  "agent": {
    "build": {
      "name": "Build Agent",
      "description": "Full-access development agent",
    },
    "plan": {
      "name": "Plan Agent",
      "description": "Read-only analysis agent",
      "readonly": true,
    },
  },

  // LSP Configuration
  "lsp": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
    },
  },

  // Formatter Configuration
  "formatter": {
    "*.ts": "prettier",
    "*.py": "black",
  },

  // Theme
  "theme": "dracula",

  // Plugins
  "plugin": ["@cerebras-ai/plugin-example"],
}
```

### B. Tool Reference

| Tool           | Purpose               | Example                 |
| -------------- | --------------------- | ----------------------- |
| Read           | Read file contents    | Read README.md          |
| Write          | Create new file       | Write new config        |
| Edit           | Modify existing file  | Update function logic   |
| Bash           | Execute command       | Run tests               |
| Glob           | Find files by pattern | `**/*.ts`               |
| Grep           | Search file contents  | Find TODO comments      |
| WebSearch      | Search internet       | Latest API docs         |
| WebFetch       | Fetch URL content     | Read documentation      |
| LSPDiagnostics | Get errors/warnings   | Check TypeScript errors |
| LSPHover       | Get symbol info       | Function signature      |
| Todo           | Track tasks           | Multi-step plan         |
| Batch          | Multiple operations   | Rename across files     |

### C. Environment Variables

| Variable                  | Purpose                   | Example                |
| ------------------------- | ------------------------- | ---------------------- |
| `CEREBRAS_CONFIG`         | Custom config path        | `/path/to/config.json` |
| `CEREBRAS_CONFIG_CONTENT` | Inline JSON config        | `{"theme":"dracula"}`  |
| `CEREBRAS_CONFIG_DIR`     | Additional config dir     | `/path/to/.cerebras`   |
| `CEREBRAS_SKIP_AUTH`      | Skip authentication (dev) | `true`                 |
| `CLERK_PUBLISHABLE_KEY`   | Clerk public key          | `pk_test_...`          |
| `CLERK_SECRET_KEY`        | Clerk secret key          | `sk_test_...`          |

### D. API Endpoints (Backend)

| Endpoint                 | Method | Purpose                 |
| ------------------------ | ------ | ----------------------- |
| `/auth/device/authorize` | POST   | Start device flow       |
| `/auth/device/poll`      | POST   | Poll for completion     |
| `/auth/token`            | POST   | Exchange code for token |
| `/auth/verify`           | GET    | Verify session          |
| `/workspace/create`      | POST   | Create user workspace   |

### E. File Locations

| Purpose        | macOS/Linux                    | Windows                                    |
| -------------- | ------------------------------ | ------------------------------------------ |
| Config         | `~/.cerebras/`                 | `%USERPROFILE%\.cerebras\`                 |
| Session        | `~/.cerebras/session.json`     | `%USERPROFILE%\.cerebras\session.json`     |
| Credentials    | `~/.cerebras/credentials.json` | `%USERPROFILE%\.cerebras\credentials.json` |
| Project Config | `.cerebras/`                   | `.cerebras\`                               |
| Project Agents | `AGENTS.md`                    | `AGENTS.md`                                |

### F. Glossary

- **Agent:** AI assistant with specific capabilities and permissions
- **Build Mode:** Full-access agent for making changes
- **Plan Mode:** Read-only agent for analysis
- **LSP:** Language Server Protocol for code intelligence
- **TUI:** Terminal User Interface
- **Session:** Single conversation with the AI
- **Tool:** Function the AI can call to perform actions
- **Provider:** AI model provider (Anthropic, OpenAI, etc.)
- **Cerebras Zen:** Managed AI service by Cerebras
- **Retry Budget:** Maximum number of retry attempts
- **Jitter:** Random delay variation to prevent thundering herd
- **JSONC:** JSON with comments

### G. Support Resources

- **Documentation:** https://cerebras-code.dev/docs
- **GitHub:** https://github.com/arihantchoudhary/opencode
- **Discord:** https://discord.gg/opencode (pending migration)
- **Issues:** https://github.com/arihantchoudhary/opencode/issues
- **Discussions:** https://github.com/arihantchoudhary/opencode/discussions
- **npm Package:** https://www.npmjs.com/package/cerebras-ai

### H. Contributing

See [CONTRIBUTING.md](/Users/ari/GitHub/opencode/CONTRIBUTING.md) for:

- Development setup
- Code style preferences
- PR guidelines
- Testing requirements
- Feature request process

---

## Document History

| Version | Date       | Author       | Changes              |
| ------- | ---------- | ------------ | -------------------- |
| 1.0     | 2025-11-28 | Product Team | Initial PRD creation |

---

**End of Document**
