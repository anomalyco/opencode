<!-- Context: openagents-repo/context-overview | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

# OpenCode Plugin Context Library

This library provides structured context for AI coding assistants to understand, build, and extend OpenCode plugins. Depending on your task, you can load specific parts of this library.

## 📚 Library Map

### 🏗️ Architecture
Foundational concepts of how plugins are registered and executed.
- [Overview](./architecture/overview.md): Basic structure, registration, and context object.
- [Lifecycle](./architecture/lifecycle.md): Packaging, manifest, and session lifecycle.

### 🛠️ Capabilities
Deep dives into specific plugin features.
- [Events](./capabilities/events.md): Detailed list of all 25+ hookable events.
- [Events: Skills Plugin](./capabilities/events_skills.md): Practical example of event hooks in the Skills Plugin.
- [Tools](./capabilities/tools.md): How to build and register custom tools using Zod.
- [Agents](./capabilities/agents.md): Creating and configuring custom AI agents.

### 📖 Reference
Guidelines and troubleshooting.
- [Best Practices](./reference/best-practices.md): Message injection workarounds, security, and performance.

### 🧩 Claude Code Plugins (External)
Claude Code plugin system documentation (harvested from external docs).
- [Concepts: Plugin Architecture](./concepts/plugin-architecture.md): Core concepts and structure
- [Guides: Creating Plugins](./guides/creating-plugins.md): Step-by-step creation
- [Guides: Migrating to Plugins](./guides/migrating-to-plugins.md): Convert standalone to plugin
- [Lookup: Plugin Structure](./lookup/plugin-structure.md): Directory reference

## 🚀 How to use this library
If you are asking an AI to build a new feature:
1. **For a new tool**: Provide `architecture/overview.md` and `capabilities/tools.md`.
2. **For reacting to events**: Provide `capabilities/events.md`.
3. **For overall plugin architecture**: Provide `architecture/overview.md` and `architecture/lifecycle.md`.
