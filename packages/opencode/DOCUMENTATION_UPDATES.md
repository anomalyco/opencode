# Documentation Updates for CodeSurf

## Overview

This document tracks all documentation updates made to highlight CodeSurf-specific features while keeping the main OpenCode documentation intact.

## Files Created

### 1. CodeSurfBlock Component

**Location**: `packages/web/src/components/CodeSurfBlock.astro`

A reusable Astro component for highlighting CodeSurf features in documentation with three types:

- **Feature** (🏄 blue): New CodeSurf features
- **Difference** (⚡ purple): How CodeSurf differs from OpenCode
- **Addition** (➕ green): Enhancements to existing features

### 2. Component Documentation

**Location**: `packages/web/src/components/CODESURF_DOCS.md`

Complete guide for using the CodeSurfBlock component including:

- Usage examples
- Props reference
- Styling guidelines
- Best practices

### 3. Features Summary

**Location**: `packages/opencode/CODESURF_FEATURES.md`

Comprehensive list of all CodeSurf-specific features including:

- Dual sidebar system
- Tool favorites
- Quick commit workflow
- Mouse support improvements
- UI/UX enhancements

## Files Updated

### 1. TUI Documentation

**Location**: `packages/web/src/content/docs/tui.mdx`

**Added sections:**

- **Sidebars**: Dual sidebar layout (left sessions, right tools/todos/files)
- **Session Management**: Quick commit workflow and session switching
- **Tool Favorites**: How to mark and use favorite tools
- **Mouse Support**: Enhanced mouse interaction details

**Import added:**

```mdx
import CodeSurfBlock from "../../components/CodeSurfBlock.astro

"
```

### 2. Keybinds Documentation

**Location**: `packages/web/src/content/docs/keybinds.mdx`

**Added section:**

- **Sidebar Keybinds**: CodeSurf-specific sidebar toggle keybinds
- **Quick Tab Switching**: Number keys for tab navigation

**Import added:**

```mdx
import CodeSurfBlock from "../../components/CodeSurfBlock.astro

"
```

## Features Documented

### Dual Sidebar System

- ✅ Left sidebar: Session list and switching
- ✅ Right sidebar: Tools, Todos, Files tabs
- ✅ Toggle keybinds: `Cmd+[`, `Cmd+]`, `Cmd+B`
- ✅ Width controls: Header +/- buttons plus Shift+Bracket keybinds to resize
- ✅ Tab switching: `1`, `2`, `3` keys

### Tool Favorites

- ✅ Star system: None → Project → Global
- ✅ Visual indicators: ☆ gray, ★ blue, ★ gold
- ✅ Sorting behavior
- ✅ Config persistence

### Quick Commit Workflow

- ✅ File selection checkboxes
- ✅ Auto commit message generation
- ✅ Custom commit messages
- ✅ Committed status indicators

### Session Management

- ✅ Persistent session list
- ✅ Active session indicator (▶)
- ✅ Single-click switching
- ✅ No duplicate titles

### Mouse Support

- ✅ Click to select text
- ✅ UI element interaction
- ✅ Mouse wheel scrolling
- ✅ Input protection (filtered escape codes)

### UI/UX Enhancements

- ✅ No text wrapping in session names
- ✅ Proper truncation with ellipsis
- ✅ Optimized sidebar width (45 chars)
- ✅ Fixed height for single-line display
- ✅ Clean headers without corruption

## Documentation Strategy

### Principles

1. **Non-Intrusive**: Original OpenCode docs remain unchanged in content
2. **Clearly Marked**: All CodeSurf features highlighted with CodeSurfBlock components
3. **Supplementary**: CodeSurf blocks add to, not replace, existing documentation
4. **Maintainable**: Easy to identify and update CodeSurf-specific content

### Visual Indicators

All CodeSurf-specific content is wrapped in `<CodeSurfBlock>` components with:

- Color-coded borders (blue/purple/green)
- Icon indicators (🏄/⚡/➕)
- Descriptive titles
- Hover effects for discoverability

### Example Usage

```mdx
<CodeSurfBlock type="feature" title="Dual Sidebar Layout">

CodeSurf features an enhanced dual sidebar layout:

- **Left**: Session management
- **Right**: Tools, Todos, Files

</CodeSurfBlock>
```

## Future Documentation Needs

Areas that may need CodeSurf-specific documentation:

1. **Configuration**: How favorites are stored in config
2. **Themes**: Any CodeSurf-specific theme adjustments
3. **Troubleshooting**: CodeSurf-specific issues and solutions
4. **CLI**: Any command-line differences
5. **Plugins**: If CodeSurf adds plugin capabilities

## Maintenance

### When Adding New Features

1. Update `CODESURF_FEATURES.md` with feature description
2. Add `CodeSurfBlock` to relevant docs page
3. Use appropriate block type (feature/difference/addition)
4. Keep blocks concise and focused
5. Update this document with changes

### When Updating OpenCode Base

1. Pull upstream changes to docs
2. Verify CodeSurfBlock imports still work
3. Check for conflicts in updated sections
4. Ensure CodeSurf blocks don't contradict base docs
5. Update block content if base feature changed

## Testing Documentation

Before deploying updated documentation:

- [ ] Verify all CodeSurfBlock imports work
- [ ] Check component renders correctly (light/dark mode)
- [ ] Confirm all links work
- [ ] Validate code examples
- [ ] Test keybind descriptions match actual behavior
- [ ] Review for consistency with CODESURF_FEATURES.md

## Contact

For documentation questions or suggestions:

- File an issue in the CodeSurf repository
- Tag documentation-related PRs with `docs:`
- Follow the documentation style guide in this file
