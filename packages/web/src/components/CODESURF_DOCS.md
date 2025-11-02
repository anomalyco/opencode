# CodeSurf Documentation Components

## CodeSurfBlock Component

A reusable Astro component for highlighting CodeSurf-specific features in documentation.

### Usage

Import the component in your MDX files:

```mdx
---
title: Your Page
---

import CodeSurfBlock from "../../components/CodeSurfBlock.astro"
```

### Types

The component supports three types:

#### Feature (Default)
Highlights a new CodeSurf feature.

```mdx
<CodeSurfBlock type="feature" title="Dual Sidebar Layout">

CodeSurf features an enhanced dual sidebar layout for better project organization.

</CodeSurfBlock>
```

**Visual**: Blue border, 🏄 icon

#### Difference
Shows how CodeSurf differs from OpenCode.

```mdx
<CodeSurfBlock type="difference" title="Enhanced Mouse Interaction">

CodeSurf includes improved mouse support with click-to-select and filtered mouse wheel events.

</CodeSurfBlock>
```

**Visual**: Purple border, ⚡ icon

#### Addition
Highlights additional functionality added to existing features.

```mdx
<CodeSurfBlock type="addition" title="Sidebar Keybinds">

CodeSurf adds these keybinds for sidebar control:
- `Cmd+[` - Toggle left sidebar
- `Cmd+]` - Toggle right sidebar

</CodeSurfBlock>
```

**Visual**: Green border, ➕ icon

### Props

- `title` (optional): Custom title for the block
  - Default titles: "CodeSurf Feature", "CodeSurf Difference", "CodeSurf Addition"
- `type` (optional): One of `'feature' | 'difference' | 'addition'`
  - Default: `'feature'`

### Examples

**With custom title:**

```mdx
<CodeSurfBlock type="feature" title="Tool Favorites">
Mark tools as favorites for quick access!
</CodeSurfBlock>
```

**Default title:**

```mdx
<CodeSurfBlock type="difference">
CodeSurf hides the header when the left sidebar is visible.
</CodeSurfBlock>
```

**With markdown content:**

```mdx
<CodeSurfBlock type="addition">

### Quick Commit

1. Select files
2. Click [Commit]
3. Done!

</CodeSurfBlock>
```

### Styling

The component includes:
- Color-coded left borders
- Hover animation (slight right shift)
- Dark mode support
- Responsive prose styling
- Icon indicators

### Where to Use

Use CodeSurfBlock when documenting:

1. **Features unique to CodeSurf**
   - Dual sidebars
   - Tool favorites
   - Quick commit workflow

2. **Differences from OpenCode**
   - Modified behaviors
   - Enhanced functionality
   - UI/UX improvements

3. **Additions to existing features**
   - New keybinds
   - Extended capabilities
   - Additional options

### Guidelines

**Do:**
- ✅ Use for CodeSurf-specific features
- ✅ Keep content concise and focused
- ✅ Include practical examples
- ✅ Use appropriate type for context

**Don't:**
- ❌ Use for general OpenCode features
- ❌ Nest multiple CodeSurfBlocks
- ❌ Use for long-form content
- ❌ Repeat information from main docs

### Main Documentation Stays Intact

All original OpenCode documentation remains unchanged. CodeSurfBlock provides **supplementary** information about CodeSurf enhancements without modifying the base documentation.

This approach:
- Keeps OpenCode docs pristine
- Clearly identifies CodeSurf additions
- Maintains upgrade path
- Reduces merge conflicts
