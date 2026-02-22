import type { FC, Child } from "hono/jsx"
import { raw } from "hono/html"

const Layout: FC<{ title: string; children?: Child }> = ({ title, children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <style>
        {raw(`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #0a0a0a; color: #e0e0e0; font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace; font-size: 14px; line-height: 1.6; }
        a { color: #6ee7b7; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .container { max-width: 900px; margin: 0 auto; padding: 1rem; }
        nav { border-bottom: 1px solid #1e293b; padding: 0.75rem 1rem; margin-bottom: 1.5rem; }
        nav a { font-weight: bold; font-size: 16px; }
        .meta { color: #94a3b8; font-size: 12px; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; background: #1e293b; color: #94a3b8; }
        pre, code { font-family: inherit; }
        pre { background: #1e1e2e; border: 1px solid #2d2d3d; border-radius: 6px; padding: 1rem; overflow-x: auto; margin: 0.5rem 0; }
        code { background: #1e1e2e; padding: 2px 6px; border-radius: 3px; }
        pre code { background: none; padding: 0; }
        .message { border: 1px solid #1e293b; border-radius: 8px; margin: 1rem 0; padding: 1rem; }
        .message.user { border-left: 3px solid #6ee7b7; }
        .message.assistant { border-left: 3px solid #818cf8; }
        .message-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
        .role { font-weight: bold; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; }
        .role.user { color: #6ee7b7; }
        .role.assistant { color: #818cf8; }
        .tool { background: #1a1a2e; border: 1px solid #2d2d3d; border-radius: 6px; margin: 0.5rem 0; padding: 0.75rem; }
        .tool-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-size: 12px; }
        .tool-name { color: #fbbf24; font-weight: bold; }
        .tool-status { font-size: 11px; }
        .tool-status.completed { color: #6ee7b7; }
        .tool-status.error { color: #f87171; }
        .tool-status.running { color: #fbbf24; }
        .tool-status.pending { color: #94a3b8; }
        .tool-output { max-height: 300px; overflow-y: auto; }
        .session-card { display: block; border: 1px solid #1e293b; border-radius: 8px; padding: 1rem; margin: 0.75rem 0; transition: border-color 0.15s; }
        .session-card:hover { border-color: #6ee7b7; text-decoration: none; }
        .session-title { font-size: 16px; color: #e0e0e0; margin-bottom: 0.25rem; }
        .diff { margin: 0.5rem 0; }
        .diff-header { background: #1a1a2e; padding: 0.5rem; border-radius: 4px 4px 0 0; font-size: 12px; color: #94a3b8; }
        .diff-add { color: #6ee7b7; }
        .diff-del { color: #f87171; }
        .diff-stats { font-size: 11px; }
        .reasoning { color: #94a3b8; font-style: italic; border-left: 2px solid #2d2d3d; padding-left: 0.75rem; margin: 0.5rem 0; }
        .search-box { width: 100%; padding: 0.5rem 0.75rem; background: #1e1e2e; border: 1px solid #2d2d3d; border-radius: 6px; color: #e0e0e0; font-family: inherit; font-size: 14px; margin-bottom: 1rem; }
        .search-box:focus { outline: none; border-color: #6ee7b7; }
        .tokens { font-size: 11px; color: #94a3b8; }
        .cost { color: #fbbf24; }
        .text-content p { margin: 0.5rem 0; }
        .text-content ul, .text-content ol { margin: 0.5rem 0 0.5rem 1.5rem; }
        .text-content h1, .text-content h2, .text-content h3 { margin: 1rem 0 0.5rem; color: #e0e0e0; }
        .step-finish { border-top: 1px solid #1e293b; margin-top: 0.5rem; padding-top: 0.5rem; }
      `)}
      </style>
    </head>
    <body>
      <nav>
        <div class="container">
          <a href="/sessions">opencode sessions</a>
        </div>
      </nav>
      <div class="container">{children}</div>
    </body>
  </html>
)

export default Layout
