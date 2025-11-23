# Web Component

The Web component provides browser-based interface for OpenCode, primarily focused on documentation, session sharing, and public showcase features.

## Architecture Overview

```
┌─────────────────┐
│   Web App       │ ← Astro + SolidJS
└─────────────────┘
          │
          ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Pages         │    │   Components    │    │   API Client    │
│   (Routes)      │    │   (UI)          │    │   Integration   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
          │                    │                       │
          ▼                    ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Content       │    │   Starlight     │    │   Server API    │
│   Management    │    │   (Docs)        │    │   Backend       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Core Files

### Astro Configuration (`packages/web/astro.config.mjs`)

- **Framework**: Astro for static site generation
- **Integration**: SolidJS for interactive components
- **Deployment**: SST/Cloudflare Workers

### Main Application (`packages/web/src/pages/`)

- **Documentation Pages**: Starlight-based documentation
- **Share Pages**: Public session sharing interface
- **Static Assets**: Images, styles, and resources

### Components (`packages/web/src/components/`)

- **Share Component**: Interactive session viewer
- **UI Components**: Reusable interface elements
- **Icons**: Custom icon system

## Documentation Site

### Starlight Integration

```typescript
// packages/web/src/pages/docs/index.mdx
---
title: OpenCode Documentation
description: AI-powered development tool for terminal
---

import { Card, CardGrid } from '@components/CardGrid'

Welcome to OpenCode documentation. Here you'll find everything you need to get started.

<CardGrid>
  <Card title="Quick Start" href="/docs/1-0">
    Get up and running in minutes
  </Card>
  <Card title="CLI Reference" href="/docs/cli">
    Complete command reference
  </Card>
  <Card title="Configuration" href="/docs/config">
    Customize your setup
  </Card>
</CardGrid>
```

### Content Structure

```
packages/web/src/content/docs/
├── 1-0.mdx              # Getting started
├── agents.mdx             # Agent system
├── cli.mdx                # CLI reference
├── commands.mdx           # Command reference
├── config.mdx             # Configuration
├── custom-tools.mdx       # Custom tools
├── formatters.mdx          # Code formatting
├── github.mdx             # GitHub integration
├── ide.mdx                # IDE integration
├── lsp.mdx                # LSP support
├── mcp-servers.mdx        # MCP servers
├── models.mdx             # AI models
├── modes.mdx              # Agent modes
├── permissions.mdx        # Permission system
├── plugins.mdx            # Plugin system
├── providers.mdx          # AI providers
├── rules.mdx              # Custom rules
├── sdk.mdx                # SDK usage
├── server.mdx             # Server setup
├── share.mdx              # Session sharing
├── themes.mdx             # Theme system
├── tools.mdx              # Tool system
├── troubleshooting.mdx     # Troubleshooting
├── tui.mdx                # TUI guide
└── zen.mdx                # OpenCode Zen
```

## Session Sharing

### Share Page (`packages/web/src/pages/s/[id].astro`)

```astro
---
import { Base64 } from "js-base64"
import Share from "../../components/Share.tsx"

const { id } = Astro.params
const res = await fetch(`${apiUrl}/share_data?id=${id}`)
const data = await res.json()

if (!data.info) {
  return new Response(null, {
    status: 404,
    statusText: 'Not found'
  })
}

// Generate OG image
const ogImage = `${config.socialCard}/opencode-share/${encodedTitle}.png?model=${modelParam}&version=${version}&id=${id}`
---
<StarlightPage hasSidebar={false} frontmatter={{
  title: data.info.title,
  pagefind: false,
  template: "splash",
  head: [
    {
      tag: "meta",
      attrs: {
        property: "og:image",
        content: ogImage,
      },
    },
  ],
}}>
  <Share
    id={id}
    api={apiUrl}
    info={data.info}
    messages={data.messages}
    client:only="solid"
  />
</StarlightPage>
```

### Share Component (`packages/web/src/components/Share.tsx`)

```typescript
interface ShareProps {
  id: string
  api: string
  info: Session.Info
  messages: MessageV2.WithParts[]
}

export default function Share(props: ShareProps) {
  const [messages, setMessages] = createSignal(props.messages)
  const [loading, setLoading] = createSignal(false)

  return (
    <div class="share-container">
      <SessionHeader info={props.info} />
      <MessageList messages={messages()} />
      <SessionFooter
        sessionId={props.id}
        onCopyLink={handleCopyLink}
        onExport={handleExport}
      />
    </div>
  )
}
```

### Message Display

```typescript
// Message rendering with syntax highlighting
function MessagePart(props: { part: MessageV2.Part }) {
  switch (props.part.type) {
    case "text":
      return <MarkdownRenderer content={props.part.text} />
    case "tool":
      return <ToolExecution part={props.part} />
    case "file":
      return <FileAttachment part={props.part} />
    default:
      return null
  }
}
```

## UI Components

### Markdown Renderer

```typescript
// packages/web/src/components/share/
export function MarkdownRenderer(props: { content: string }) {
  const [html, setHtml] = createSignal("")

  createEffect(async () => {
    const rendered = await renderMarkdown(props.content)
    setHtml(rendered)
  })

  return (
    <div
      class="markdown-content"
      innerHTML={html()}
    />
  )
}
```

### Code Highlighting

```typescript
// Syntax highlighting for code blocks
function CodeBlock(props: { code: string; language?: string }) {
  const [highlighted, setHighlighted] = createSignal("")

  createEffect(async () => {
    const highlighted = await highlightCode(props.code, props.language)
    setHighlighted(highlighted)
  })

  return (
    <pre class="code-block">
      <code
        class={`language-${props.language || 'text'}`}
        innerHTML={highlighted()}
      />
    </pre>
  )
}
```

### Tool Execution Display

```typescript
// Tool execution visualization
function ToolExecution(props: { part: MessageV2.ToolPart }) {
  return (
    <div class="tool-execution">
      <div class="tool-header">
        <span class="tool-name">{props.part.tool}</span>
        <span class={`tool-status ${props.part.state.status}`}>
          {props.part.state.status}
        </span>
      </div>

      {props.part.state.input && (
        <div class="tool-input">
          <h4>Input:</h4>
          <CodeBlock
            code={JSON.stringify(props.part.state.input, null, 2)}
            language="json"
          />
        </div>
      )}

      {props.part.state.output && (
        <div class="tool-output">
          <h4>Output:</h4>
          <pre>{props.part.state.output}</pre>
        </div>
      )}
    </div>
  )
}
```

## API Integration

### Client SDK Usage

```typescript
// packages/web/src/lib/api.ts
export class OpenCodeAPI {
  constructor(private baseUrl: string) {}

  async getSession(id: string): Promise<Session.Info> {
    const response = await fetch(`${this.baseUrl}/session/${id}`)
    return response.json()
  }

  async getShareData(id: string): Promise<ShareData> {
    const response = await fetch(`${this.baseUrl}/share_data?id=${id}`)
    return response.json()
  }

  async getMessages(sessionId: string): Promise<MessageV2.WithParts[]> {
    const response = await fetch(`${this.baseUrl}/session/${sessionId}/message`)
    return response.json()
  }
}
```

### Real-time Updates

```typescript
// WebSocket connection for live updates
export function useRealTimeUpdates(sessionId: string) {
  const [messages, setMessages] = createSignal<MessageV2.WithParts[]>([])

  createEffect(async () => {
    const eventSource = new EventSource(`${apiUrl}/event`)

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)

      if (data.type === "message.part.updated" && data.properties.part.sessionID === sessionId) {
        updateMessagePart(data.properties.part)
      }
    }

    return () => eventSource.close()
  })

  return messages
}
```

## Styling System

### Theme Configuration

```css
/* packages/web/src/styles/custom.css */
:root {
  --opencode-primary: #2563eb;
  --opencode-secondary: #64748b;
  --opencode-success: #10b981;
  --opencode-warning: #f59e0b;
  --opencode-error: #ef4444;
  --opencode-background: #ffffff;
  --opencode-surface: #f8fafc;
  --opencode-border: #e2e8f0;
}

[data-theme="dark"] {
  --opencode-primary: #3b82f6;
  --opencode-secondary: #94a3b8;
  --opencode-success: #22c55e;
  --opencode-warning: #fbbf24;
  --opencode-error: #f87171;
  --opencode-background: #0f172a;
  --opencode-surface: #1e293b;
  --opencode-border: #334155;
}
```

### Component Styles

```css
/* Share page styles */
.share-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.session-header {
  border-bottom: 1px solid var(--opencode-border);
  padding-bottom: 1rem;
  margin-bottom: 2rem;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.tool-execution {
  background: var(--opencode-surface);
  border: 1px solid var(--opencode-border);
  border-radius: 0.5rem;
  padding: 1rem;
  margin: 1rem 0;
}
```

## Performance Optimizations

### Static Generation

```typescript
// Astro static generation
export async function getStaticPaths() {
  // Generate static paths for known shared sessions
  return [{ params: { id: "abc123" } }, { params: { id: "def456" } }]
}
```

### Code Splitting

```typescript
// Lazy loading for better performance
const ShareComponent = lazy(() => import("../components/Share.tsx"))
const MarkdownRenderer = lazy(() => import("../components/MarkdownRenderer.tsx"))
```

### Image Optimization

```typescript
// OG image generation
export async function generateOGImage(sessionData: ShareData): Promise<string> {
  const canvas = createCanvas(1200, 630)
  const ctx = canvas.getContext("2d")

  // Draw session preview
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, 1200, 630)

  // Add title and metadata
  ctx.fillStyle = "#000000"
  ctx.font = "bold 48px IBM Plex Sans"
  ctx.fillText(sessionData.info.title, 50, 100)

  return canvas.toDataURL()
}
```

## SEO and Social

### Meta Tags

```astro
---
// Dynamic meta tag generation
const metaTags = [
  {
    tag: "meta",
    attrs: {
      name: "description",
      content: "OpenCode - AI-powered development tool for terminal",
    },
  },
  {
    tag: "meta",
    attrs: {
      property: "og:title",
      content: data.info.title,
    },
  },
  {
    tag: "meta",
    attrs: {
      property: "og:description",
      content: `AI-assisted development session: ${data.info.title}`,
    },
  },
  {
    tag: "meta",
    attrs: {
      property: "og:image",
      content: ogImage,
    },
  },
]
---
```

### Structured Data

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "OpenCode",
  "description": "AI-powered development tool for terminal",
  "applicationCategory": "DeveloperApplication",
  "operatingSystem": "Linux, macOS, Windows",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  }
}
```

## Deployment

### Astro Build

```typescript
// packages/web/astro.config.mjs
export default defineConfig({
  integrations: [
    solidjs(),
    starlight({
      title: "OpenCode Documentation",
      customCss: ["./src/styles/custom.css"],
    }),
  ],
  output: "static",
  adapter: cloudflare(),
})
```

### SST Integration

```typescript
// infra/app.ts
new sst.cloudflare.x.Astro("Web", {
  domain: "docs." + domain,
  path: "packages/web",
  environment: {
    SST_STAGE: $app.stage,
    VITE_API_URL: api.url.apply((url) => url!),
  },
})
```

## Analytics and Monitoring

### Page Tracking

```typescript
// Analytics integration
export function useAnalytics() {
  createEffect(() => {
    // Track page views
    if (typeof gtag !== "undefined") {
      gtag("config", "GA_MEASUREMENT_ID")
      gtag("event", "page_view", {
        page_title: document.title,
        page_location: window.location.href,
      })
    }
  })
}
```

### Performance Metrics

```typescript
// Web Vitals tracking
export function usePerformanceMetrics() {
  createEffect(() => {
    // Track Core Web Vitals
    import("web-vitals").then(({ getCLS, getFID, getFCP, getLCP, getTTFB }) => {
      getCLS(console.log)
      getFID(console.log)
      getFCP(console.log)
      getLCP(console.log)
      getTTFB(console.log)
    })
  })
}
```

## Accessibility

### ARIA Support

```typescript
// Accessible component structure
export function AccessibleMessage(props: MessageProps) {
  return (
    <article
      role="article"
      aria-label={`Message from ${props.role}`}
      tabIndex={0}
    >
      <header>
        <h2>{props.role}</h2>
      </header>
      <div
        role="document"
        aria-label="Message content"
      >
        {props.content}
      </div>
    </article>
  )
}
```

### Keyboard Navigation

```typescript
// Keyboard navigation support
export function useKeyboardNavigation() {
  const [focusedIndex, setFocusedIndex] = createSignal(0)

  const handleKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        setFocusedIndex((prev) => prev + 1)
        break
      case "ArrowUp":
        setFocusedIndex((prev) => Math.max(0, prev - 1))
        break
      case "Enter":
        activateFocusedItem()
        break
    }
  }

  return { focusedIndex, handleKeyDown }
}
```

The Web component provides a polished, accessible interface for documentation and session sharing, extending OpenCode's reach beyond the terminal while maintaining consistency with the overall system design.
