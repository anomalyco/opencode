# Architecture Analysis: Plugin-Based Refactoring Plan

**Generated:** November 5, 2025  
**Scope:** Changes from November 1-5, 2025 (134 commits, 368+ files)  
**Author:** Jason Kneen (jason.kneen@bouncingfish.com)

## Executive Summary

Analysis of recent development work reveals 8 major feature areas that can be refactored into a modular plugin-based architecture. Current implementation has tight coupling between features, making maintenance and optional feature loading difficult.

---

## Feature Categories

### 1. **HAL Interface & Widget System**

**Status:** MOST ACTIVE - 80+ backup iterations  
**Priority:** HIGH - Core visual interface

#### Files Modified:

```
packages/livekit-player/src/components/ChatIndicator.tsx (+ 80 backups)
packages/livekit-player/src/components/ChatIndicator.css (+ 20 backups)
packages/livekit-player/src/components/ChatIndicator-realtime.tsx
packages/livekit-player/src/components/BlobAudioReactor.ts
packages/livekit-player/src/components/TitleBar.tsx
packages/livekit-player/src/components/CloseButton.tsx
packages/livekit-player/src/components/ErrorBoundary.tsx
```

#### Features:

- HAL lens visual interface (AI assistant visualization)
- Widget grid system with drag/drop
- Camera feed integration
- Real-time audio visualization (blob reactor)
- Z-index stacking management
- Status indicator animations

#### Plugin Potential: **HIGH**

- **Plugin Name:** `@opencode/plugin-hal-interface`
- **Type:** UI Plugin
- **Dependencies:** LiveKit audio, React
- **Config Options:** Widget layout, lens size, animation settings

---

### 2. **LiveKit Real-Time Communication**

**Status:** CORE INFRASTRUCTURE - Production ready  
**Priority:** HIGH - Voice/audio foundation

#### Files Modified:

```
packages/opencode/src/livekit/
  ├── room-manager.ts
  ├── room-agent.ts
  ├── tool-bridge.ts
  ├── transcription.ts
  ├── types.ts
  └── index.ts

packages/livekit-player/
  ├── src-tauri/ (Tauri desktop wrapper)
  ├── electron/ (Electron desktop wrapper)
  └── package.json

packages/desktop/src/context/livekit.tsx
packages/opencode/src/cli/cmd/tui/context/livekit.tsx
```

#### Features:

- WebRTC room management
- Agent-to-agent communication
- Tool execution bridge (CLI ↔ Voice Agent)
- Real-time transcription
- Audio track management
- Desktop app wrappers (Tauri + Electron)

#### Plugin Potential: **MEDIUM**

- **Why Not Full Plugin:** Core functionality for voice features
- **Possible Split:**
  - Core: Basic room/audio management (keep in core)
  - Plugin: Advanced features (transcription, multi-room, recording)
- **Plugin Name:** `@opencode/plugin-livekit-advanced`

#### Documentation:

- `LIVEKIT_INTEGRATION_COMPLETE.md`
- `LIVEKIT_RESTORED.md`
- `AUDIO_PLAYBACK_SETUP.md`
- `SESSION_MANAGER_README.md`

---

### 3. **RAID Knowledge Base System**

**Status:** NEW FEATURE - Testing phase  
**Priority:** MEDIUM - Enhanced RAG

#### Files Modified:

```
packages/opencode/src/raid/
  ├── raid-kb.ts
  ├── raid-orchestrator.ts
  ├── raid-config.ts
  ├── raid-types.ts
  └── README.md

packages/opencode/src/tool/
  ├── raid-ingest.ts
  ├── raid-query.ts
  ├── raid-search.ts
  └── raid-kb.ts

.opencode/raid.db (SQLite database)
```

#### Features:

- Document sharding (overlapping chunks)
- Multi-shard parallel querying
- Answer fusion/synthesis
- BM25 full-text search
- AI-powered routing to relevant shards
- Project + global knowledge bases

#### Plugin Potential: **HIGH**

- **Plugin Name:** `@opencode/plugin-raid-kb`
- **Type:** Tool Plugin (adds 4 new tools)
- **Dependencies:** OpenAI/Anthropic API, SQLite
- **Tools Added:**
  - `raid-ingest` - Ingest documents
  - `raid-query` - Query with orchestration
  - `raid-search` - Full-text search
  - `raid-kb` - Manage knowledge base

#### Documentation:

- `KB_RAID_ASSESSMENT.md`
- `KB_RAID_FINAL_ASSESSMENT.md`
- `README_KB_TESTING.md`

---

### 4. **Skills System (Progressive)**

**Status:** MATURE - Published to npm  
**Priority:** MEDIUM - Code pattern learning

#### Files Modified:

```
packages/skills/
  ├── src/skill-system.ts
  ├── src/skill-loader.ts
  ├── src/skill-matcher.ts
  ├── src/skill-executor.ts
  ├── src/types.ts
  └── examples/

packages/opencode/src/skills/ (mirrored)

.opencode/skills/test-skill/SKILL.md
.opencode/skills/test-skill/SKILL.md
```

#### Features:

- Markdown-based skill definitions (SKILL.md)
- Fuzzy matching (intent detection)
- Hierarchical skill organization
- Examples + reference documentation
- Progressive skill building over time

#### Plugin Potential: **HIGH**

- **Current Status:** Already published as standalone package `@opencode/skills`
- **Integration:** Can be made fully optional
- **Plugin Name:** `@opencode/plugin-skills`
- **Type:** Tool Plugin + System Extension

#### Documentation:

- `BENCHMARKS.md`
- `LIVE_COMPARISON.md`
- `REAL_OUTPUT_COMPARISON.md`
- `PACKAGE_SUMMARY.md`

---

### 5. **Agent Orchestration & Task System**

**Status:** CORE FEATURE - Active development  
**Priority:** HIGH - Multi-agent coordination

#### Files Modified:

```
packages/opencode/src/session/
  ├── workflows.ts
  ├── task-hierarchy.ts
  ├── prompt/orchestrator.txt
  └── index.ts

packages/opencode/src/agent/agent.ts
packages/opencode/src/tool/
  ├── task.ts
  ├── switch-mode.ts
  ├── complete-task.ts
  └── registry.ts

packages/opencode/src/parallel/
  ├── branch.ts
  ├── worktree.ts
  └── index.ts
```

#### Features:

- Orchestrator → Specialist agent delegation
- Task hierarchy management
- Mode switching (general, architect, plan, test)
- Git worktree parallelization
- Task completion workflow

#### Plugin Potential: **LOW**

- **Why:** Core architecture feature
- **Possible:** Make specialist agents pluggable
- **Keep in Core:** Orchestrator, task system, mode switching

#### Documentation:

- `ORCHESTRATION.md`
- `ORCHESTRATOR_BUGS_FIXED.md`
- `AGENT_TRACKING.md`
- `PARALLEL_MODE.md`

---

### 6. **TUI Enhancements (Terminal UI)**

**Status:** INCREMENTAL IMPROVEMENTS  
**Priority:** MEDIUM - UX improvements

#### Files Modified:

```
packages/opencode/src/cli/cmd/tui/
  ├── component/
  │   ├── context-usage-bar.tsx
  │   ├── dialog-agent-manager.tsx
  │   ├── dialog-kb-manager.tsx
  │   ├── dialog-livekit.tsx
  │   ├── dialog-mcp-manager.tsx
  │   ├── dialog-memory-add.tsx
  │   ├── dialog-memory-list.tsx
  │   ├── dialog-skill-manager.tsx
  │   └── plugin-component.tsx
  ├── routes/session/
  │   ├── left-sidebar.tsx
  │   ├── sidebar.tsx
  │   ├── footer.tsx
  │   └── header.tsx
  └── ui/
      ├── dialog.tsx
      └── dialog-select.tsx

packages/tui/internal/components/dialog/session.go
packages/ui/src/components/context-usage-bar.tsx
```

#### Features:

- Dual collapsible sidebars
- Context usage bar (token tracking)
- Management dialogs (agents, KB, skills, MCP)
- LiveKit room management UI
- Memory browser interface
- Plugin component rendering

#### Plugin Potential: **MEDIUM**

- **Split Strategy:**
  - Core: Base TUI framework, prompt input, session display
  - Plugins: Management dialogs, advanced sidebars
- **Plugin Names:**
  - `@opencode/plugin-tui-managers` (KB, skills, MCP dialogs)
  - `@opencode/plugin-tui-sidebars` (advanced sidebar features)

#### Documentation:

- `COLLAPSIBLE_SIDEBARS.md`
- `SIDEBAR_TOOLS.md`
- `packages/web/src/content/docs/tui.mdx`

---

### 7. **Desktop Applications (Tauri + Electron)**

**Status:** DUAL BUILDS - Tauri primary  
**Priority:** MEDIUM - Cross-platform distribution

#### Files Modified:

```
packages/desktop/
  ├── src-tauri/
  │   ├── src/lib.rs
  │   ├── Cargo.toml
  │   └── tauri.conf.json
  ├── src/
  │   ├── components/
  │   │   ├── prompt-input.tsx
  │   │   ├── voice-control.tsx
  │   │   ├── sidebar.tsx
  │   │   └── todo-list.tsx
  │   ├── context/livekit.tsx
  │   └── pages/index.tsx
  └── package.json

packages/livekit-player/
  ├── src-tauri/ (HAL desktop app)
  └── electron/ (legacy)
```

#### Features:

- Tauri-based desktop wrapper
- Voice control integration
- Image upload capability
- Todo list UI
- LiveKit context provider
- Native system integration

#### Plugin Potential: **N/A**

- **Type:** Separate build target, not pluggable
- **Note:** Uses plugin system but IS NOT a plugin

#### Documentation:

- `TAURI_SETUP.md`
- `FEATURES_ADDED.md`
- `IMAGE_UPLOAD_COMPLETE.md`

---

### 8. **Plugin System Infrastructure**

**Status:** FOUNDATION READY - Active development  
**Priority:** HIGH - Enables all other plugins

#### Files Modified:

```
packages/opencode/src/plugin/index.ts
packages/opencode/src/ui/
  ├── registry.ts
  ├── schema.ts
  └── types.ts

packages/opencode/.opencode/plugin/
  ├── example-ui-plugin.ts
  └── README.md

packages/plugin/src/index.ts
packages/plugin-prefill-assistant/
  ├── src/index.ts
  ├── example-config.jsonc
  └── IMPLEMENTATION.md

test/plugin/prefill-assistant.test.ts
test/ui/plugin.test.ts
test/ui/integration.test.ts
```

#### Features:

- Plugin discovery & loading
- UI extension points
- Tool registration
- Configuration schema validation
- Example: Prefill assistant plugin

#### Plugin Potential: **N/A - IS THE SYSTEM**

- Already designed for extensibility
- UI plugin system documented in `UI_PLUGIN_SYSTEM_PLAN.md`

#### Documentation:

- `UI_PLUGIN_SYSTEM_PLAN.md`
- `UI_IMPLEMENTATION_COMPLETE.md`
- `PREFILL_ASSISTANT_GUIDE.md`

---

### 9. **Anthropic Claude Code Integration**

**Status:** NEW - API parity  
**Priority:** MEDIUM - Alternative to custom tools

#### Files Modified:

```
packages/opencode/src/tool/
  ├── cc-bash.ts
  ├── cc-edit.ts
  ├── cc-read.ts
  ├── cc-write.ts
  ├── cc-list.ts
  ├── cc-glob.ts
  ├── cc-grep.ts
  ├── cc-webfetch.ts
  ├── cc-computer-use.ts
  └── (corresponding .txt prompt files)
```

#### Features:

- Anthropic's native tool implementations
- Computer use tool (screen control)
- Drop-in replacements for custom tools
- Improved compatibility with Claude

#### Plugin Potential: **HIGH**

- **Plugin Name:** `@opencode/plugin-anthropic-tools`
- **Type:** Tool Plugin
- **Config:** Enable/disable Anthropic tools vs custom tools
- **Use Case:** Users preferring Anthropic's tool implementations

#### Documentation:

- `ANTHROPIC_FEATURES.md`
- `ANTHROPIC_INTEGRATION_SUMMARY.md`
- `CLAUDE_CODE_TOOLS.md`
- `COMPUTER_USE.md`

---

### 10. **Memory System**

**Status:** CLI + TUI integration  
**Priority:** LOW - Storage utility

#### Files Modified:

```
packages/opencode/src/cli/cmd/memory.ts
packages/opencode/src/cli/cmd/MEMORY_README.md
packages/opencode/src/cli/cmd/tui/component/dialog-memory-add.tsx
packages/opencode/src/cli/cmd/tui/component/dialog-memory-list.tsx
```

#### Features:

- Store/retrieve arbitrary data
- CLI commands: `memory add`, `memory list`, `memory get`
- TUI dialog interfaces
- Persistent storage

#### Plugin Potential: **MEDIUM**

- **Plugin Name:** `@opencode/plugin-memory`
- **Type:** Tool Plugin + Command Plugin
- **Commands Added:** `memory` command group

---

### 11. **MCP (Model Context Protocol) Integration**

**Status:** TESTING - Discovery system  
**Priority:** MEDIUM - External tool integration

#### Files Modified:

```
packages/opencode/src/mcp/index.ts
packages/opencode/src/cli/cmd/tui/component/dialog-mcp-manager.tsx
test/mcp/discovery.test.ts
```

#### Features:

- MCP server discovery
- External tool integration
- TUI management dialog

#### Plugin Potential: **MEDIUM**

- **Plugin Name:** `@opencode/plugin-mcp`
- **Type:** Integration Plugin
- **Note:** MCP itself provides tools, so this is a "plugin loader for plugins"

---

### 12. **Semantic Search Tool**

**Status:** EXPERIMENTAL - Vector search  
**Priority:** LOW - Alternative to RAID

#### Files Modified:

```
packages/opencode/tool/
  ├── fast-semantic-search.ts
  ├── index-codebase.ts
  └── SEMANTIC_SEARCH_README.md
```

#### Features:

- Vector-based code search
- Codebase indexing
- Similarity matching

#### Plugin Potential: **HIGH**

- **Plugin Name:** `@opencode/plugin-semantic-search`
- **Type:** Tool Plugin
- **Alternative to:** RAID KB for some use cases

---

## Plugin Architecture Recommendations

### Tier 1: High-Priority Plugins (Should be extracted)

1. **`@opencode/plugin-hal-interface`**
   - Visual HAL lens + widget grid
   - Optional for CLI-only users
   - Heavy UI dependencies

2. **`@opencode/plugin-raid-kb`**
   - Advanced RAG system
   - Optional for users with smaller codebases
   - Requires AI API credits

3. **`@opencode/plugin-skills`**
   - Already published standalone
   - Easy to make optional
   - Progressive learning system

4. **`@opencode/plugin-anthropic-tools`**
   - Alternative tool implementations
   - Users can choose custom vs Anthropic
   - Computer use tool (experimental)

5. **`@opencode/plugin-semantic-search`**
   - Vector search capability
   - Alternative to grep/glob
   - Resource-intensive indexing

### Tier 2: Medium-Priority Plugins

6. **`@opencode/plugin-livekit-advanced`**
   - Keep basic audio in core
   - Plugin: Transcription, recording, multi-room

7. **`@opencode/plugin-tui-managers`**
   - Management dialogs (KB, skills, MCP, memory)
   - Core TUI remains minimal

8. **`@opencode/plugin-memory`**
   - Memory storage commands
   - Nice-to-have, not essential

9. **`@opencode/plugin-mcp`**
   - MCP server integration
   - For users wanting external tools

### Tier 3: Keep in Core

- Agent orchestration (fundamental architecture)
- Basic tool system (bash, edit, read, write)
- Session management
- Core TUI framework
- Basic LiveKit room management
- Configuration system

---

## Implementation Strategy

### Phase 1: Plugin Infrastructure (Week 1)

- [ ] Define plugin manifest schema
- [ ] Implement plugin loader with dependency resolution
- [ ] Create plugin registry system
- [ ] Add plugin enable/disable configuration

### Phase 2: Extract High-Value Plugins (Week 2-3)

- [ ] Extract HAL interface to plugin
- [ ] Extract RAID KB to plugin
- [ ] Extract Anthropic tools to plugin
- [ ] Extract semantic search to plugin

### Phase 3: Extract Medium-Priority Plugins (Week 4)

- [ ] Split LiveKit (core vs advanced)
- [ ] Extract TUI managers to plugin
- [ ] Extract memory system to plugin
- [ ] Extract MCP integration to plugin

### Phase 4: Testing & Documentation (Week 5)

- [ ] Write plugin development guide
- [ ] Create plugin templates
- [ ] Test plugin loading/unloading
- [ ] Document plugin API

### Phase 5: Migration & Cleanup (Week 6)

- [ ] Update default configurations
- [ ] Clean up 80+ ChatIndicator backup files
- [ ] Remove tight coupling between features
- [ ] Update documentation

---

## Plugin API Design

### Plugin Manifest (opencode-plugin.json)

```json
{
  "name": "@opencode/plugin-hal-interface",
  "version": "1.0.0",
  "type": "ui",
  "displayName": "HAL Interface",
  "description": "Visual AI assistant interface with widget grid",
  "author": "OpenCode Team",
  "main": "./dist/index.js",
  "dependencies": {
    "@opencode/core": "^0.1.0",
    "livekit-client": "^2.0.0"
  },
  "provides": {
    "ui": ["hal-lens", "widget-grid"],
    "commands": [],
    "tools": []
  },
  "requires": {
    "features": ["livekit"],
    "permissions": ["audio", "video"]
  },
  "config": {
    "schema": "./config-schema.json",
    "defaults": {
      "lensSize": "medium",
      "widgetLayout": "grid"
    }
  }
}
```

### Plugin Entry Point (index.ts)

```typescript
import { Plugin, PluginContext } from "@opencode/plugin-api"

export default class HALInterfacePlugin implements Plugin {
  name = "@opencode/plugin-hal-interface"
  version = "1.0.0"

  async activate(context: PluginContext) {
    // Register UI components
    context.ui.register("hal-lens", HALLensComponent)
    context.ui.register("widget-grid", WidgetGridComponent)

    // Register commands
    context.commands.register("hal.toggle", toggleHAL)

    // Subscribe to events
    context.events.on("livekit.connected", onLiveKitConnected)
  }

  async deactivate() {
    // Cleanup
  }
}
```

---

## Benefits of Plugin Architecture

### For Users

- **Faster startup** - Only load what you need
- **Smaller bundle** - Don't ship unused features
- **Lower resource usage** - Less memory/CPU for disabled features
- **Flexible configuration** - Enable features per-project
- **Easier learning curve** - Start simple, add features gradually

### For Developers

- **Clearer separation of concerns** - Each plugin is self-contained
- **Easier testing** - Test plugins in isolation
- **Independent versioning** - Update plugins without core changes
- **Community plugins** - Third-party extensions possible
- **Faster development** - Work on plugins without rebuilding core

### For the Project

- **Better maintainability** - Smaller, focused codebases
- **Easier debugging** - Isolate issues to specific plugins
- **More flexible architecture** - Swap implementations easily
- **Clearer documentation** - Document each plugin separately
- **Professional structure** - Industry-standard plugin system

---

## Configuration Examples

### Minimal Configuration (CLI only)

```jsonc
{
  "plugins": {
    // No plugins enabled - pure CLI experience
  },
}
```

### Voice User Configuration

```jsonc
{
  "plugins": {
    "@opencode/plugin-hal-interface": {
      "enabled": true,
      "config": { "lensSize": "large" },
    },
    "@opencode/plugin-livekit-advanced": {
      "enabled": true,
      "config": { "transcription": true },
    },
  },
}
```

### Power User Configuration

```jsonc
{
  "plugins": {
    "@opencode/plugin-hal-interface": { "enabled": true },
    "@opencode/plugin-raid-kb": { "enabled": true },
    "@opencode/plugin-skills": { "enabled": true },
    "@opencode/plugin-semantic-search": { "enabled": true },
    "@opencode/plugin-anthropic-tools": { "enabled": true },
    "@opencode/plugin-memory": { "enabled": true },
  },
}
```

---

## Testing Strategy

### Unit Tests

- Each plugin has its own test suite
- Test plugin activation/deactivation
- Test plugin configuration validation
- Test plugin API contract

### Integration Tests

- Test plugin interaction with core
- Test plugin dependency resolution
- Test plugin loading order
- Test plugin event communication

### End-to-End Tests

- Test full user workflows with plugins
- Test plugin enable/disable scenarios
- Test plugin configuration changes
- Test plugin error handling

---

## Migration Checklist

### Before Starting

- [x] Document all modified files
- [x] Categorize features into logical groups
- [x] Identify plugin candidates
- [ ] Review with team
- [ ] Create migration timeline

### Infrastructure

- [ ] Design plugin manifest schema
- [ ] Implement plugin loader
- [ ] Create plugin API types
- [ ] Set up plugin testing framework
- [ ] Create plugin template generator

### Per Plugin

- [ ] Extract code to separate package
- [ ] Define plugin manifest
- [ ] Implement plugin entry point
- [ ] Write plugin tests
- [ ] Document plugin API
- [ ] Update core to remove direct dependencies

### Cleanup

- [ ] Remove 80+ ChatIndicator backup files
- [ ] Update all documentation
- [ ] Update configuration examples
- [ ] Create migration guide for users
- [ ] Publish plugins to npm

---

## Recent Features: Model Selection & Cost Optimization

**Status:** ✅ Complete (v0.2.0)  
**Impact:** ~80% cost reduction for orchestration/planning  
**Documentation:** `packages/opencode/MODEL_SELECTION.md`

### Overview

OpenCode now intelligently selects AI models based on agent capabilities, using small/cheap models for read-only agents while maintaining flagship models for code generation. This results in significant cost savings with no quality degradation for coordination tasks.

### Implementation

**Core Components:**

1. **Provider.getSmallModel()** (`src/provider/provider.ts:708-759`)
   - Selects appropriate small model per provider
   - Priority: Haiku → Flash → Nano
   - Handles provider-specific quirks (GitHub Copilot premium filtering)
   - Respects user-configured `small_model` override

2. **Session.resolveModel()** (`src/session/prompt.ts:478-543`)
   - Implements model selection priority hierarchy
   - Auto-selects small models for read-only agents
   - Logs selection decisions for debugging
   - Falls back safely to default models

3. **Agent Permission System** (`src/agent/agent.ts`)
   - `permission.edit = "deny"` → Small model (orchestrator, plan)
   - `permission.edit = "allow"` → Default model (general, architect)

### Model Selection Priority

```
1. Explicit model request (--model flag)
2. Agent-specific configuration (agent.model)
3. Auto-selection based on permissions:
   - Read-only (edit: "deny") → Small model
   - Edit-enabled (edit: "allow") → Default model
4. User's default model (config.json)
```

### Cost Analysis

**Typical Feature Implementation Workflow:**

```
WITHOUT AUTO-SELECTION (all Sonnet):
  Orchestrator:  50K tokens × $0.005 = $0.25
  Plan Agent:    30K tokens × $0.005 = $0.15
  General Agent: 100K tokens × $0.005 = $0.50
  TOTAL: $0.90

WITH AUTO-SELECTION:
  Orchestrator:  50K tokens × $0.001 = $0.05  (-80%)
  Plan Agent:    30K tokens × $0.001 = $0.03  (-80%)
  General Agent: 100K tokens × $0.005 = $0.50  (same)
  TOTAL: $0.58 (-36% overall)
```

**Monthly Savings:** ~$70/month for active developers (~35% reduction)

### Small Model Priority List

1. `claude-haiku-4-5` / `claude-haiku-4.5` - Anthropic's fast model
2. `3-5-haiku` / `3.5-haiku` - Claude 3.5 Haiku variants
3. `gemini-2.5-flash` - Google's efficient model
4. `gpt-5-nano` - OpenAI's small model (when available)

### Configuration

Users can override auto-selection:

```jsonc
// ~/.opencode/config.json
{
  "small_model": "anthropic/claude-haiku-4.5", // Override small model
  "model": "anthropic/claude-sonnet-4", // Default model
}
```

### Testing

**Test Coverage:**

- `test/provider/small-model.test.ts` (7 tests) - Provider selection logic
- `test/session/model-resolution.test.ts` (6 tests) - Agent integration

**All tests passing:** ✅

### Benefits

**For Users:**

- 35-40% lower API costs with no quality loss
- Transparent auto-selection (no configuration required)
- Override options for custom workflows

**For the Project:**

- More economical for users → Higher adoption
- Demonstrates cost-awareness
- Extensible to future cost optimization strategies

### Future Enhancements

1. **Cost Tracking Dashboard** - Real-time cost monitoring per session
2. **Dynamic Model Selection** - A/B test models based on task complexity
3. **Budget Limits** - Auto-downgrade when approaching budget thresholds
4. **Provider-Specific Optimization** - Custom priority lists per provider/region

---

## Next Steps

1. **Review this analysis** - Get team feedback on plugin candidates
2. **Prioritize plugins** - Which should be extracted first?
3. **Design plugin API** - Finalize plugin interface contracts
4. **Create POC** - Extract one simple plugin to prove architecture
5. **Iterate** - Refine based on POC learnings

---

## Questions to Answer

1. **Should Skills be a plugin?** Already published standalone, easy win?
2. **LiveKit split line?** Where do we draw core vs advanced features?
3. **TUI plugins?** How do we handle terminal UI extensibility?
4. **Backward compatibility?** Support old configs during migration?
5. **Plugin marketplace?** Plan for third-party plugins eventually?

---

## File Cleanup Recommendations

### High Priority (Delete immediately)

```
packages/livekit-player/src/components/ChatIndicator.tsx.* (80+ backups)
packages/livekit-player/src/components/ChatIndicator.css.bak* (20+ backups)
packages/desktop/src/components/prompt-input.tsx.backup
packages/desktop/src/components/prompt-input.tsx.bak*
packages/opencode/src/cli/cmd/tui/routes/session/index.tsx.backup
packages/livekit-player/src/App.tsx.broken
```

### Medium Priority (Review then delete)

```
test-* files in packages/opencode/ (20+ test scripts)
packages/opencode/test-pkg/*.tgz (build artifacts)
.opencode/raid.db-shm, .opencode/raid.db-wal (temp SQLite files)
packages/sdk/stainless/stainless.yml.backup
```

### Low Priority (Keep for reference)

```
*_SUMMARY.md files (session reports)
*_COMPLETE.md files (feature completion docs)
*/README.md files (documentation)
```

---

## Estimated Impact

### Code Reduction

- **Current:** ~368+ files modified in 5 days
- **After plugins:** Core reduces by ~40%
- **Plugin packages:** 8-10 separate plugins
- **Bundle size:** 30-50% smaller for minimal config

### Startup Time

- **Current:** Loads everything
- **After plugins:** Only loads enabled plugins
- **Estimated improvement:** 2-5x faster for minimal config

### Maintainability

- **Current:** Tight coupling, hard to test in isolation
- **After plugins:** Clear boundaries, independent testing
- **Developer productivity:** 2-3x faster for focused changes

---

## Conclusion

The codebase has grown significantly with powerful features, but tight coupling is becoming a maintenance burden. Extracting features into plugins will:

1. **Improve user experience** - Faster, more flexible
2. **Improve developer experience** - Clearer, more maintainable
3. **Enable future growth** - Community plugins, marketplace
4. **Reduce technical debt** - Clean architecture, clear boundaries

**Recommended approach:** Start with high-value, low-risk plugins (Skills, RAID KB, Anthropic tools) to prove the architecture, then systematically migrate remaining features.
