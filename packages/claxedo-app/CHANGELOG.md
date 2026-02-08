# Changelog

All notable changes to Claxedo App will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release preparation with comprehensive documentation
- Override system for extending OpenCode without modifying upstream
- Custom rail-based layout with tab navigation (ClaxedoLayout)
- Cloud workspace creation and management
- Clerk authentication integration
- Remote access/tunneling support
- Desktop application support via Tauri
- Server-scoped state persistence
- Agent lifecycle hooks for terminal status indicators
- xterm.js-based terminal with WebGL rendering

### Changed
- Terminal implementation migrated from ghostty-web to xterm.js
- Context providers restructured for server-scoped isolation

### Fixed
- Context scope issues between app-scope and directory-scope providers
- Terminal state persistence across workspace navigation

## [1.1.34] - 2026-02-01

### Added
- Desktop build system with Tauri integration
- Override system infrastructure for pristine upstream sync
- Extension system for app, server, persist, and sync extensions

### Changed
- Migrated to file override pattern for cleaner upstream merges

### Fixed
- Session synchronization issues across multiple workspaces
