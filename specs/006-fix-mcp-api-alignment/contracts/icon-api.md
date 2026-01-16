# Contract: Icon and IconButton API

**Feature**: 006-fix-mcp-api-alignment
**Components**: Icon, IconButton (`@opencode-ai/ui`)

## Icon Interface

```typescript
export interface IconProps extends ComponentProps<"svg"> {
  name: keyof typeof icons  // Must be a valid icon name
  size?: "small" | "normal" | "large"
}
```

## IconButton Interface

```typescript
export interface IconButtonProps extends ComponentProps<typeof Kobalte> {
  icon: IconProps["name"]   // Must be a valid icon name
  size?: "normal" | "large" // NOTE: "small" is NOT valid
  iconSize?: IconProps["size"]
  variant?: "primary" | "secondary" | "ghost"
}
```

## Available Icons (Subset)

### Navigation
- `arrow-up`, `arrow-down`, `arrow-left`, `arrow-right`
- `chevron-down`, `chevron-right`, `chevron-left`, `chevron-up`
- `chevron-grabber-vertical`

### UI Actions
- `close` - X icon, use for removal/dismiss
- `plus`, `plus-small` - Add actions
- `check`, `check-small` - Confirmation/success
- `copy` - Copy to clipboard
- `expand`, `collapse` - Expand/collapse sections

### Editing
- `pencil-line` - Edit action (replaces "edit")
- `edit-small-2` - Alternative edit icon

### Status/State
- `circle-check` - Success state
- `circle-error` - Error state (replaces "alert-triangle")

### File/Data
- `folder`, `file`, `archive`
- `code`, `code-lines`, `console`

### Special
- `mcp` - MCP-specific icon
- `server` - Server icon
- `brain`, `glasses` - AI-related

## Icon Mapping for Missing Icons

| Missing Icon | Replacement | Notes |
|-------------|-------------|-------|
| `spinner` | CSS animation | Use `animate-spin` on any icon |
| `edit` | `pencil-line` | Standard edit icon |
| `trash` | `close` | X icon for removal |
| `lock` | Text "(sensitive)" | No lock icon available |
| `alert-triangle` | `circle-error` | Error state indicator |

## Correct Usage Patterns

### Pattern 1: Basic Icon

```typescript
import { Icon } from '@opencode-ai/ui'

<Icon name="pencil-line" size="small" />
<Icon name="close" size="normal" />
```

### Pattern 2: Icon Button

```typescript
import { IconButton } from '@opencode-ai/ui'

// Default size (normal)
<IconButton icon="pencil-line" variant="ghost" />

// With explicit sizes
<IconButton icon="close" size="large" iconSize="normal" />
```

### Pattern 3: Loading Spinner

```typescript
// Use CSS animation instead of spinner icon
<Icon name="circle-check" class="animate-spin" />

// Or use dedicated loading state with different icon
<Icon name="code" class="animate-spin" />
```

### Pattern 4: Sensitive Data Indicator

```typescript
// Instead of lock icon, use text
<span class="text-xs text-muted-foreground">(sensitive)</span>

// Or use subtle styling
<span class="opacity-60" title="Contains sensitive value">
  {truncatedValue}
</span>
```

## Incorrect Usage (Do NOT Use)

```typescript
// ❌ WRONG: Invalid icon name
<Icon name="spinner" />
<Icon name="trash" />
<Icon name="edit" />

// ❌ WRONG: Invalid size on IconButton
<IconButton icon="close" size="small" />

// ❌ WRONG: Missing icon name
<Icon name="non-existent-icon" />
```

## Size Reference

### Icon Sizes
| Size | Dimensions | Use Case |
|------|------------|----------|
| `small` | 16x16 | Inline with text, compact UI |
| `normal` | 20x20 | Default, standard buttons |
| `large` | 24x24 | Prominent actions, headers |

### IconButton Sizes
| Size | Button | Default IconSize | Use Case |
|------|--------|------------------|----------|
| `normal` | Standard | `small` | Default, most use cases |
| `large` | Larger | `normal` | Prominent actions |

## Notes

- Always verify icon name exists in the icons object
- IconButton `size` refers to button size, `iconSize` refers to icon within button
- Use CSS `animate-spin` for loading indicators
- Consider text alternatives when semantic icons don't exist
- The project has 64+ icons - check icon.tsx for full list
