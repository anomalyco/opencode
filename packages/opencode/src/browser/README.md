# OpenCode Browser Automation

Complete browser automation suite for OpenCode using Playwright. Enables AI agents to interact with web pages, take screenshots, and perform visual grounding for intelligent web automation.

## Quick Start

```bash
# Enable browser automation
export OPENCODE_ENABLE_BROWSER=true

# Run OpenCode with browser tools available
bun dev

# In a separate terminal, start the browser server
cd packages/opencode && node browser-server.js
```

## Tools Reference

### Navigation & Page State

#### `browser_navigate`

Navigate to URLs with integrated content returns.

```typescript
// Basic navigation
await browser_navigate({ url: "https://example.com" })

// With integrated content (no separate fetch needed)
await browser_navigate({
  url: "https://example.com",
  wait_until: "domcontentloaded",
  return_content: "inputs", // Returns list of input fields
})
```

**Parameters:**

- `url` (string, required) - Target URL
- `wait_until` (enum) - "load" | "domcontentloaded" | "networkidle" | "commit" (default: "domcontentloaded")
- `return_content` (enum) - Optional: "text" | "links" | "inputs" | "screenshot" | "structured"
- `timeout` (number, optional) - Milliseconds to wait

**Return Content Types:**

- `"text"` - Page readable text (first 500 chars)
- `"links"` - List of clickable links (filtered by tagName="a")
- `"inputs"` - List of input fields with types
- `"screenshot"` - Screenshot automatically captured
- `"structured"` - Element count and metadata

---

#### `browser_navigate_back` / `browser_navigate_forward`

Navigate browser history.

```typescript
await browser_navigate_back()
await browser_navigate_forward()
```

---

#### `browser_wait`

Wait for page states or specific elements.

```typescript
// Wait for page fully loaded
await browser_wait({ wait_for: "load", timeout: 30000 })

// Wait for element to appear
await browser_wait({ selector: "#content", visible: true })
```

**Parameters:**

- `wait_for` (enum) - "load" | "domcontentloaded" | "networkidle"
- `selector` (string, optional) - CSS selector to wait for
- `visible` (boolean) - Wait for visibility (default: false)
- `timeout` (number) - Max wait time in ms (default: 30000)

---

### Element Interaction

#### `browser_click`

Click elements by selector, ref, or coordinates.

```typescript
// By CSS selector
await browser_click({ selector: "button.submit" })

// By coordinates
await browser_click({ x: 640, y: 360 })

// By numeric ref (from list_inputs/list_buttons output)
await browser_click({ element: "search input", ref: "1" })

// With integrated content return
await browser_click({
  selector: "a.link",
  return_content: "text", // Returns page text after click
})
```

**Parameters:**

- `selector` (string, optional) - CSS selector
- `element` (string, optional) - Human-readable element description (fuzzy matched)
- `ref` (string, optional) - Numeric ref from list\_\* outputs (resolved to selector)
- `x`, `y` (numbers, optional) - Coordinates
- `button` (enum) - "left" | "right" | "middle" (default: "left")
- `doubleClick` (boolean) - Double-click (default: false)
- `return_content` (enum) - Optional: "text" | "links" | "inputs" | "screenshot" | "structured"
- `timeout` (number, optional) - Timeout in ms

---

#### `browser_type`

Type text into input fields.

```typescript
// Simple text entry
await browser_type({
  selector: "input[type='email']",
  text: "user@example.com",
})

// Clear field, type, and press Enter with content return
await browser_type({
  element: "search box",
  ref: "1",
  text: "query",
  submit: true,
  return_content: "text", // Returns search results
})

// Slow typing (simulates real user)
await browser_type({
  selector: "input",
  text: "careful typing",
  slowly: true, // 100ms per character
})
```

**Parameters:**

- `selector` (string, optional) - CSS selector
- `element` (string, optional) - Human-readable description
- `ref` (string, optional) - Numeric ref (resolved like in click)
- `text` (string, required) - Text to type
- `clear` (boolean) - Clear existing content (default: false)
- `submit` (boolean) - Press Enter after typing (default: false)
- `slowly` (boolean) - Type slowly (100ms per char) (default: false)
- `return_content` (enum) - Optional return content type
- `timeout` (number, optional) - Timeout in ms

---

#### `browser_hover`

Hover over elements (mouseover).

```typescript
await browser_hover({ selector: ".dropdown-trigger" })
```

---

#### `browser_drag`

Drag & drop elements.

```typescript
await browser_drag({
  sourceSelector: ".draggable",
  targetSelector: ".drop-zone",
})
```

---

#### `browser_scroll`

Scroll pages or elements with integrated content returns.

```typescript
// Scroll down 500px
await browser_scroll({ direction: "down", amount: 500 })

// Scroll to element
await browser_scroll({ to_element: "#footer" })

// Scroll within container
await browser_scroll({
  selector: ".sidebar",
  direction: "down",
  amount: 300,
})

// With integrated content return
await browser_scroll({
  direction: "down",
  return_content: "inputs", // Returns inputs visible after scroll
})
```

**Parameters:**

- `direction` (enum) - "up" | "down" | "left" | "right"
- `amount` (number) - Pixels to scroll (default: 500)
- `to_element` (string, optional) - CSS selector to scroll to
- `position` (object, optional) - Absolute scroll position {x, y}
- `selector` (string, optional) - Container to scroll (default: page)
- `smooth` (boolean) - Use smooth scrolling (default: true)
- `return_content` (enum) - Optional return content type
- `timeout` (number, optional) - Timeout in ms

---

#### `browser_press_key`

Press keyboard keys.

```typescript
// Single key
await browser_press_key({ key: "Enter" })

// With modifiers
await browser_press_key({ key: "a", modifiers: ["Control"] })
```

---

#### `browser_select_option`

Select option from HTML select dropdown.

```typescript
await browser_select_option({
  selector: "select[name='country']",
  value: "USA",
})
```

---

#### `browser_fill_form`

Fill multiple form fields at once.

```typescript
await browser_fill_form({
  fields: {
    "input[name='email']": "user@example.com",
    "input[name='password']": "secret",
    "select[name='country']": "USA",
  },
})
```

---

### Content & Observation

#### `browser_screenshot`

Capture page or element screenshots.

```typescript
// Viewport screenshot
await browser_screenshot()

// Full page screenshot
await browser_screenshot({ full_page: true })

// Screenshot of element
await browser_screenshot({ selector: "#content" })

// Custom quality
await browser_screenshot({
  full_page: true,
  quality: 85,
})
```

**Returns:** Base64-encoded PNG image as attachment.

---

#### `browser_content`

Extract page content in various formats.

```typescript
// Plain text (extracted via TreeWalker, 99% token reduction)
await browser_content({ format: "text" })

// HTML markup
await browser_content({ format: "html" })

// Structured elements (inputs/buttons/links)
await browser_content({ format: "list_inputs" })

// All interactive elements
await browser_content({ format: "structured" })
```

**Format Options:**

- `"text"` - Readable text only (TreeWalker extraction)
- `"html"` - Raw HTML markup
- `"list_inputs"` - Numbered input fields
- `"list_buttons"` - Numbered buttons
- `"list_links"` - Numbered links
- `"list_textareas"` - Numbered textareas
- `"structured"` - All interactive elements with metadata

---

#### `browser_search`

Find elements using fuzzy matching with scoring.

```typescript
// Find search input
await browser_search({ query: "search input" })

// Get top 5 matches
await browser_search({ query: "button submit", limit: 5 })
```

**Scoring Algorithm:**

- Exact match: 1000 points
- Substring match: 500 points
- Fuzzy match: 1-10 points per character (cumulative)
- Minimum threshold: 50 points (prevents wrong matches)

**Returns:** Array of matched elements with selector, bounds, and score.

---

#### `browser_snapshot`

Get accessibility tree snapshot.

```typescript
await browser_snapshot()
```

---

### Advanced

#### `browser_evaluate`

Execute JavaScript in page context.

```typescript
const result = await browser_evaluate({
  code: "document.title",
})
```

---

#### `browser_run_code`

Run code with console capture.

```typescript
await browser_run_code({
  code: "console.log('hello')",
})
```

---

#### `browser_handle_dialog`

Handle browser dialogs (alert, confirm, prompt).

```typescript
// Accept alert
await browser_handle_dialog({ action: "accept" })

// Dismiss and return text
await browser_handle_dialog({ action: "dismiss", return_text: true })
```

---

#### `browser_console_messages`

Capture console logs.

```typescript
const logs = await browser_console_messages({ level: "error" })
```

---

#### `browser_network_requests`

Monitor network traffic.

```typescript
const requests = await browser_network_requests()
```

---

#### `browser_tabs`

Manage browser tabs/windows.

```typescript
// List tabs
await browser_tabs({ action: "list" })

// Switch tab
await browser_tabs({ action: "switch", index: 1 })

// Close tab
await browser_tabs({ action: "close", index: 0 })

// Close all
await browser_tabs({ action: "close_all" })
```

---

#### `browser_resize`

Resize browser window.

```typescript
await browser_resize({
  width: 1280,
  height: 720,
})
```

---

#### `browser_file_upload`

Handle file upload inputs.

```typescript
await browser_file_upload({
  selector: "input[type='file']",
  filePath: "/path/to/file.pdf",
})
```

---

#### `browser_init`

Explicitly initialize browser.

```typescript
await browser_init({
  headed: true, // Show window
  profile_path: "/custom/profile",
})
```

---

#### `browser_close`

Close browser and cleanup.

```typescript
await browser_close({ close_all: true })
```

---

### Testing & Verification

#### `browser_verify_element_visible`

Assert element visibility (for test flows).

```typescript
await browser_verify_element_visible({
  selector: ".success-message",
})
```

---

#### `browser_verify_text_visible`

Assert text presence on page.

```typescript
await browser_verify_text_visible({
  text: "Order confirmed",
})
```

---

#### `browser_generate_locator`

Generate selectors for elements.

```typescript
await browser_generate_locator({
  selector: "button", // Generates human-readable locator
})
```

---

## Architecture

### Module Structure

```
src/browser/
├── index.ts              # Module exports & initialization
├── manager.ts            # BrowserManager singleton (Playwright API)
├── tools/                # Individual tool implementations
│   ├── index.ts         # Tool registry & exports
│   ├── navigate.ts      # URL navigation with integrated return_content
│   ├── click.ts         # Element clicking (selector/coordinates)
│   ├── type.ts          # Text input with ref resolution
│   ├── scroll.ts        # Page/element scrolling
│   ├── search.ts        # Element discovery via fuzzy search
│   ├── screenshot.ts    # Viewport/full-page capture
│   ├── content.ts       # Page content extraction (text/html/structured)
│   ├── wait.ts          # Wait for page states or elements
│   ├── hover.ts         # Element hover/mouseover
│   ├── drag.ts          # Drag & drop operations
│   ├── press-key.ts     # Keyboard input
│   ├── select-option.ts # HTML select dropdowns
│   ├── fill-form.ts     # Multi-field form filling
│   ├── evaluate.ts      # JavaScript evaluation
│   ├── snapshot.ts      # Accessibility tree snapshot
│   ├── tabs.ts          # Tab/window management
│   ├── console-messages.ts # Console log capture
│   ├── network-requests.ts  # Network monitoring
│   ├── handle-dialog.ts # Alert/dialog handling
│   ├── file-upload.ts   # File input handling
│   ├── resize.ts        # Window/viewport resize
│   ├── run-code.ts      # Execute code in page context
│   ├── navigate-back.ts # Browser history navigation
│   ├── verify-*.ts      # Assertion tools for testing
│   ├── generate-locator.ts # Element selector generation
│   └── close.ts         # Browser/page cleanup
├── test/                # Test utilities
│   ├── test-browser-tools.ts  # Tool export verification
│   ├── test-browser.js        # Chromium launch test
│   └── test-cli.js            # Interactive CLI for testing
└── README.md            # This file

browser-server.js        # Node.js HTTP server for Playwright bridge
```

### BrowserManager

Core singleton managing Playwright browser instance:

- **Initialization**: Auto-init on first use, supports custom profiles
- **Session Management**: Persistent profile for cookies/logins
- **Page Operations**: Single-page support (expandable to tabs)
- **Element Discovery**: Fuzzy search with scoring algorithm
- **Content Extraction**: TreeWalker-based text extraction (99% token reduction vs raw HTML)
- **Auto-Scroll**: `scrollIntoViewIfNeeded()` before interactions
- **Error Handling**: Comprehensive try-catch with proper error messages

### Browser Server (Node.js HTTP Bridge)

Runs on `http://localhost:9999` to bridge Bun/TypeScript with Playwright:

```
/init              - Initialize browser
/navigate          - Navigate to URL
/screenshot        - Take screenshot
/click             - Click element
/type              - Type text
/scroll            - Scroll page
/content           - Get page content
/elements          - List interactive elements
/searchElements    - Fuzzy search elements
/listElements      - List by type (inputs/buttons/links)
/wait              - Wait for conditions
/pageInfo          - Get page metadata
/close             - Close browser
```

## Usage Patterns

### Pattern 1: Integrated Context Returns (Optimized)

Reduce tool calls by 70% using integrated return_content:

```typescript
// Old way: 3+ separate calls
await browser_navigate({ url: "youtube.com" })
await browser_content({ format: "list_inputs" }) // Separate call
await browser_click({ selector: "input", ref: "1" })
await browser_content({ format: "text" }) // Another separate call

// New way: 2 integrated calls
await browser_navigate({
  url: "youtube.com",
  return_content: "inputs", // Integrated!
})
await browser_click({
  selector: "input",
  ref: "1",
  return_content: "text", // Integrated!
})
```

---

### Pattern 2: Ref Resolution Workflow

Use numbered refs from list outputs for reliable element targeting:

```typescript
// Step 1: Get numbered inputs
const contentResult = await browser_content({ format: "list_inputs" })
// Returns: "Input fields on page (3 total):\n[1] input[text] Search\n[2] input[email] Email\n..."

// Step 2: Click by ref (automatically resolved to selector)
await browser_click({
  element: "search input", // Helps with fuzzy fallback
  ref: "1", // Direct reference - mapped back to selector
})

// Step 3: Type with same ref
await browser_type({
  element: "search input",
  ref: "1",
  text: "query",
})
```

---

### Pattern 3: Fuzzy Search Fallback

When refs change, fuzzy search finds elements by description:

```typescript
// If ref "1" no longer works, fuzzy search takes over
await browser_click({
  element: "login button", // Natural language description
  ref: "1", // Tries ref first, falls back to fuzzy if numeric
})

// Pure fuzzy search (no ref)
await browser_click({
  element: "the big blue submit button on the bottom",
})
```

**Fuzzy Scoring:**

- Exact match: 1000 pts
- Substring: 500 pts
- Character-by-character: 1-10 pts
- Minimum: 50 pts (prevents wrong matches)

---

### Pattern 4: Dynamic Site Automation

For sites with heavy JavaScript (YouTube, Twitter, etc.):

```typescript
// Step 1: Screenshot to visually ground AI
await browser_screenshot({ full_page: false })

// Step 2: Use coordinates if selectors fail
await browser_click({ x: 640, y: 360 })

// Step 3: Wait for content to settle
await browser_wait({
  selector: ".loaded",
  visible: true,
  timeout: 5000,
})

// Step 4: Re-observe and continue
await browser_screenshot()
```

---

### Pattern 5: Form Filling

Multi-field form automation with error recovery:

```typescript
// Bulk fill
await browser_fill_form({
  fields: {
    "input[name='firstName']": "John",
    "input[name='lastName']": "Doe",
    "input[type='email']": "john@example.com",
    "select[name='country']": "USA",
    "textarea[name='message']": "Hello!",
  },
})

// Then submit
await browser_click({ selector: "button[type='submit']" })
```

---

## Environment Setup

### Configuration

```bash
# Enable browser automation
export OPENCODE_ENABLE_BROWSER=true

# Custom browser profile (persistent cookies/logins)
export OPENCODE_BROWSER_PROFILE_PATH="~/.opencode/profiles/session1"

# Debug mode (verbose logging)
export OPENCODE_BROWSER_DEBUG=true
```

### Dependencies

```bash
bun add playwright
bunx playwright install chromium
```

### Start Browser Server

```bash
# Terminal 1: Browser server (Node.js)
cd packages/opencode && node browser-server.js

# Terminal 2: OpenCode (Bun)
bun dev
```

---

## Troubleshooting

### Element Not Found

**Symptom:** `Error: Click failed: Element not found or not visible`

**Solutions:**

1. **Numeric ref mismatch**: Page changed between list and click
   - Solution: Re-run `browser_content({ format: "list_inputs" })` to refresh refs
2. **Fuzzy match too weak**: Description doesn't match element
   - Solution: Use exact CSS selector or coordinates
3. **Element not visible**: Hidden by CSS or below viewport
   - Solution: Tool auto-scrolls, but try explicit `browser_scroll({ to_element: "#target" })`

---

### Typing Fails

**Symptom:** `Error: Type failed: Element not found`

**Solutions:**

1. Click element first to focus: `await browser_click({ selector: "input" })`
2. Use `slowly: true` to simulate human typing
3. Add `clear: true` to ensure clean state

---

### Page Doesn't Load

**Symptom:** Navigation hangs or times out

**Solutions:**

1. Use `wait_until: "networkidle"` (more reliable than "load")
2. Reduce `timeout` to fail fast: `timeout: 10000`
3. Check page state: `await browser_content({ format: "text" })`

---

### Screenshots Too Large

**Symptom:** Screenshot attachment is huge (>5MB)

**Solutions:**

1. Use viewport-only (default): `full_page: false`
2. Reduce quality: `quality: 75`
3. Crop to element: `selector: "#main"`

---

## Performance Tips

1. **Use `return_content` consistently** - Reduces tool calls by ~70%
2. **Prefer numbered refs** - More stable than fuzzy matching on dynamic sites
3. **Combine scroll + content** - Wait for content to load during scroll
4. **Close browser when done** - Cleanup resources: `await browser_close({ close_all: true })`
5. **Use content format efficiently** - "text" is faster than "html" (TreeWalker vs DOM)

---

## Testing

```bash
# Test tool exports
bun run src/browser/test/test-browser-tools.ts

# Test Chromium launch
bun run src/browser/test/test-browser.js

# Interactive CLI
node src/browser/test/test-cli.js
> init true
> navigate example.com
> screenshot
> elements clickable
> close
```

---

## References

- **Playwright Docs**: https://playwright.dev
- **Fuzzy Matching**: 50-point minimum threshold, cumulative scoring
- **TreeWalker**: MDN Walker interface, text node extraction only
- **Set-of-Marks**: Visual grounding technique used in SeeAct, UI-TARS

---

**Last Updated:** January 2026  
**Version:** 2.0 (Refactored with return_content integration, numeric ref resolution)

## Notes

- The browser runs in headed (visible) mode by default.
- Browser profile is persisted at `~/.opencode/browser-profile` by default.
- All tools auto-initialize the browser on first use.
- Screenshots are returned as base64 PNG images.
