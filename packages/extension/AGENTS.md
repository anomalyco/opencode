# AGENTS.md - Eidorail Extension Development Guidelines

## Project Overview

**Eidorail** is a browser extension that provides a multi-platform AI chat sidebar with OpenCode integration. It's built with:

- **WXT** (Web Extension Tools) for the extension framework
- **SolidJS** for reactive UI
- **TypeScript** for type safety
- **Vite** for bundling

This extension is part of the larger Eidorail project (forked from OpenCode/sst) and lives in `packages/extension/`.

## Commands

```bash
# Development (hot reload)
bun run dev              # Chrome
bun run dev:firefox      # Firefox

# Production build
bun run build            # Chrome → .output/chrome-mv3/
bun run build:firefox    # Firefox

# Package for distribution
bun run zip
bun run zip:firefox

# Type checking
bun run typecheck
```

## Loading the Extension

### Chrome/Edge

1. Go to `chrome://extensions` or `edge://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select: `packages/extension/.output/chrome-mv3/`

### From WSL (Windows path)

```
\\wsl.localhost\Ubuntu\home\jordan\github\eidorail\packages\extension\.output\chrome-mv3
```

## Architecture

```
packages/extension/
├── entrypoints/
│   ├── background.ts        # Service worker - sidepanel management, message handling
│   └── sidepanel/
│       ├── index.html       # Sidepanel entry HTML
│       ├── main.tsx         # SolidJS app - platform tabs, settings modal
│       └── style.css        # Dark theme styles
├── public/
│   ├── icon-*.png           # Extension icons
│   └── iframe-rules.json    # Declarative net request rules for iframe embedding
├── wxt.config.ts            # WXT configuration + manifest settings
├── package.json
└── tsconfig.json
```

## Key Features

### Platform Tab Bar

- Shows platform icons at the top (Eidorail/OpenCode, Claude Code, ChatGPT, Gemini)
- Click to switch between platforms (lazy-loads iframes)
- "+" button opens settings to add more platforms

### Settings Modal

- Manage active platforms (reorder, hide/show, remove)
- Add preset platforms (Perplexity, DeepSeek, OpenRouter, Poe, etc.)
- Add custom platforms with any URL
- Restore defaults

### OpenCode Integration

- First tab embeds OpenCode web UI (`http://localhost:4096/`)
- Shows connection prompt if OpenCode isn't running
- User runs `opencode web` to start the server

## Code Style

- **Framework**: SolidJS with JSX (`.tsx` files)
- **State**: Use `createSignal()` for reactive state
- **Effects**: Use `onMount()` for initialization, `createEffect()` for reactive side effects
- **Conditionals**: Use `<Show when={...}>` for conditional rendering
- **Lists**: Use `<For each={...}>` for list rendering
- **Icons**: SVG strings in `PLATFORM_ICONS` record, rendered via `innerHTML`

### Example Pattern

```tsx
const [platforms, setPlatforms] = createSignal<Platform[]>(loadPlatforms())

function savePlatforms(p: Platform[]) {
  localStorage.setItem("eidorail-platforms", JSON.stringify(p))
  setPlatforms(p)
}

// In JSX:
;<For each={platforms().filter((p) => p.isVisible)}>
  {(platform) => (
    <button onClick={() => switchView(platform.id)}>
      <span innerHTML={getIcon(platform.icon)} />
    </button>
  )}
</For>
```

## Current State & Next Steps

### Completed

- Basic extension structure with WXT + SolidJS
- Platform tab bar with 5 default platforms (OpenCode, ChatGPT, Claude, Gemini, Claude Code)
- Settings modal with full platform management
- Preset platforms list (8 additional AI platforms)
- Custom platform support
- Improved icon visibility
- "Open in new tab" functionality
- Responsive CSS for narrow sidebar widths (400px and 300px breakpoints)
- Default workspace root setting in settings modal
- Compact mode support: OpenCode loaded with `?compact=true` for narrow sidebar
- Multi-platform conversation export (Claude, ChatGPT, Gemini) to Markdown/JSON
- Platform detection utilities for 11 AI platforms
- Improved iframe rules for 12 platforms with better header handling

### Compact Mode Implementation

The extension uses a **content script approach** that works with vanilla `sst/opencode` - no modifications to opencode itself are required.

1. **Extension**: `packages/extension/entrypoints/opencode-compact.content.ts` - Content script that:
   - Detects iframe context (`window.self !== window.top`)
   - Injects CSS to hide sidebar and optimize for narrow widths
   - Adds floating toggle button to show/hide sidebar as overlay
   - Modifies localStorage to ensure sidebar starts closed

2. **Extension**: `packages/extension/entrypoints/sidepanel/main.tsx` - OpenCode URL points to `http://localhost:4096/`

This approach:

- Works with vanilla `sst/opencode` installed via `npx opencode`
- No upstream conflicts or maintenance burden
- Content script only activates when in iframe (extension context)
- Normal OpenCode experience when accessed directly in browser

### Known Limitations

1. **Claude.ai Sidebar** - Claude.ai hides their sidebar toggle (opacity: 0) at narrow widths. This is their responsive behavior that we cannot control from an iframe. Users can use "Open in new tab" for full functionality.

### Pending Improvements

1. **OpenCode Project Selection**
   - Review and improve project selection UX in native OpenCode web experience
   - Consider adding project picker in the extension UI
   - Use workspace root setting when launching OpenCode

## Important Files

| File                              | Purpose                                |
| --------------------------------- | -------------------------------------- |
| `entrypoints/sidepanel/main.tsx`  | Main app component, all UI logic       |
| `entrypoints/sidepanel/style.css` | All styles (CSS variables, dark theme) |
| `entrypoints/background.ts`       | Service worker, sidepanel behavior     |
| `wxt.config.ts`                   | Manifest permissions, icons, commands  |
| `public/iframe-rules.json`        | Rules to strip X-Frame-Options headers |

## CSS Variables

```css
--bg-primary: #131010; /* Main background */
--bg-secondary: #1a1717; /* Tab bar, modal background */
--bg-tertiary: #242121; /* Hover states, inputs */
--text-primary: #f8f7f7; /* Main text */
--text-secondary: #c8c5c5; /* Secondary text */
--text-muted: #8b8888; /* Muted/disabled text */
--accent: #e08a30; /* Orange accent (active tabs, buttons) */
--border: #3d3a3a; /* Border color */
```

## Manifest Permissions

The extension requests:

- `sidePanel` - Side panel API
- `storage` - localStorage for settings
- `tabs` - Tab management, open in new tab
- `activeTab` - Current tab info
- `scripting` - Execute scripts in tabs
- `declarativeNetRequest` - Modify headers for iframe embedding

Host permissions include localhost:4096 (OpenCode) and all major AI chat platforms.

## Known Issues

- **Type error in wxt.config.ts**: Version mismatch between vite and wxt's internal vite. Does NOT affect builds - ignore the TypeScript error.
- **Iframe embedding**: Some sites may still block embedding despite header stripping. Claude.ai and ChatGPT generally work.

## Testing Checklist

After changes, verify:

- [ ] Extension builds without errors (`bun run build`)
- [ ] Sidepanel opens when clicking extension icon
- [ ] Platform switching works (tabs change, iframes load)
- [ ] Settings modal opens/closes properly
- [ ] Can add/remove/reorder platforms
- [ ] "Open in new tab" opens correct URL
- [ ] OpenCode connection detection works
