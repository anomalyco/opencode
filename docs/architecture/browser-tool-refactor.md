# Browser Tool Refactor Specification

## Overview
Refactor the browser automation layer from dozens of individual operation tools to seven high-level tools with action-based schemas. This maintains full browser functionality while providing a cleaner, more discoverable interface for agents.

## High-Level Tools

### 1. browserNavigate
Handles all browser navigation operations.

**Parameters:**
```typescript
{
  action: Schema.Literal(
    "goto",      // Navigate to URL
    "back",      // Go back in history
    "forward",   // Go forward in history
    "refresh",   // Reload current page
    "newTab",    // Open new tab
    "closeTab",  // Close current tab
    "switchTab", // Switch to specific tab
    "listTabs"   // List all open tabs
  ),
  url: Schema.optional(Schema.String), // Required for "goto" action
  target: Schema.optional(Schema.String) // For "switchTab" (tab ID/index) or "newTab" (URL)
}
```

**Returns:** Structured JSON with operation result and current browser state

### 2. browserAction
Handles all browser interaction operations.

**Parameters:**
```typescript
{
  action: Schema.Literal(
    "click",         // Click element
    "doubleClick",   // Double click element
    "rightClick",    // Right click element
    "type",          // Type text into element
    "clear",         // Clear element value
    "hover",         // Hover over element
    "focus",         // Focus element
    "select",        // Select option in dropdown
    "check",         // Check checkbox/radio
    "uncheck",       // Uncheck checkbox/radio
    "upload",        // Upload file to input
    "scroll",        // Scroll by pixels
    "scrollToElement" // Scroll element into view
  ),
  target: Schema.String, // CSS selector, text, or element reference
  value: Schema.optional(Schema.String), // For type, select, upload actions
  optionValue: Schema.optional(Schema.String), // For select action (option value)
  pixels: Schema.optional(Schema.Number) // For scroll action (px to scroll)
}
```

**Returns:** Structured JSON with action confirmation and updated page state

### 3. browserObserve
Handles all page content extraction operations.

**Parameters:**
```typescript
{
  action: Schema.Literal(
    "snapshot",    // Get accessibility tree
    "screenshot",  // Capture page screenshot
    "text",        // Get visible text
    "html",        // Get page HTML
    "links",       // Get all links
    "tables",      // Get all tables
    "forms"        // Get all forms
  ),
  selector: Schema.optional(Schema.String), // Scope extraction to element
  fullPage: Schema.optional(Schema.Boolean) // For screenshot: capture full page
}
```

**Returns:** Structured JSON with requested data (text, HTML, arrays, base64 image, etc.)

### 4. browserWait
Handles all waiting/polling operations.

**Parameters:**
```typescript
{
  action: Schema.Literal(
    "waitForElement",    // Wait for element to appear
    "waitForText",       // Wait for text to appear
    "waitForNetworkIdle" // Wait for network to be idle
  ),
  target: Schema.String, // CSS selector or text to wait for
  timeout: Schema.optional(Schema.Number) // Timeout in ms (default: 30000)
}
```

**Returns:** Structured JSON with wait result and timing information

### 5. browserContext
Handles all browser context operations.

**Parameters:**
```typescript
{
  action: Schema.Literal(
    "listFrames",        // List all frames/iframes
    "switchFrame",       // Switch to specific frame
    "getCookies",        // Get cookies (all or specific)
    "setCookies",        // Set cookie
    "clearCookies",      // Clear cookies (all or specific)
    "getLocalStorage",   // Get localStorage item
    "setLocalStorage",   // Set localStorage item
    "removeLocalStorage" // Remove localStorage item
  ),
  target: Schema.optional(Schema.String), // Frame name/index, cookie name, or storage key
  name: Schema.optional(Schema.String), // For cookie operations (cookie name)
  value: Schema.optional(Schema.String), // For cookie/storage setting (value)
  domain: Schema.optional(Schema.String) // For cookie operations (domain)
}
```

**Returns:** Structured JSON with context data (cookies, storage values, frame list, etc.)

### 6. browserDebug
Handles all browser debugging and diagnostics operations.

**Parameters:**
```typescript
{
  action: Schema.Literal(
    "getConsoleLogs",    // Get console messages
    "getNetworkRequests",// Get network requests
    "getPageErrors",     // Get page errors
    "highlightElement",  // Highlight element on page
    "locateElement"      // Get element position/size
  ),
  target: Schema.optional(Schema.String), // For highlight/locate actions (selector)
  level: Schema.optional(Schema.Literal("error", "warning", "info")) // For console logs
}
```

**Returns:** Structured JSON with debug data (logs, requests, errors, element info, etc.)

### 7. browserEval
Handles JavaScript execution in browser context.

**Parameters:**
```typescript
{
  code: Schema.String, // JavaScript to execute
  returnByValue: Schema.optional(Schema.Boolean) // Default: true (return by value, not reference)
}
```

**Returns:** Structured JSON with execution result and any errors

## Implementation Details

### Backend Integration
All tools route through the existing Playwright backend in `packages/opencode/src/tool/browser/engine.ts`:

- Single `BrowserEngine` instance manages Playwright lifecycle
- Session-scoped browser contexts and pages
- Multi-tab support via nested Map structure: `Map<sessionID, Map<pageID, Page>>`
- Frame support via Playwright's frame API
- Automatic cleanup on session end

### Error Handling
Each tool returns consistent structured responses:
```typescript
{
  success: boolean,
  data: any, // Tool-specific result data
  error: string | null, // Error message if failed
  browserState: {
    sessionId: string,
    pageId: string,
    url: string,
    title: string,
    tabs: number
  }
}
```

### Permission System
All browser tools require the "browser" permission:
- Automatic permission prompts for first use
- Configurable permission persistence
- Granitable control per session

### Configuration
Browser tools are gated by `experimental.browser.enabled` config:
```jsonc
{
  "experimental": {
    "browser": {
      "enabled": false,
      "headless": true,
      "viewport": { "width": 1280, "height": 720 }
    }
  }
}
```

## Benefits
1. **Reduced Complexity**: 7 tools vs 50+ individual operations
2. **Discoverability**: Clear tool categories with action-based discovery
3. **Consistency**: Uniform parameter patterns and response formats
4. **Maintainability**: Centralized logic for common operations
5. **Extensibility**: Easy to add new actions to existing tools
6. **Backwards Compatibility**: Can coexist with individual tools during migration

## Migration Path
1. Implement high-level tools alongside existing individual tools
2. Update documentation and examples to use high-level tools
3. Provide conversion utilities for existing workflows
4. Deprecate individual tools in future release after migration period