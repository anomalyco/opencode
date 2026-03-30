import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "../../util/lazy"
import { RemoteAuth } from "../remote-auth"
import { buildRemoteURL } from "../remote-pairing"

const MAX_REMOTE_TTL_SECONDS = 60 * 60 * 24 * 7

const PairBody = z.object({
  directory: z.string().min(1),
  sessionID: z.string().optional(),
  ttlSeconds: z.coerce.number().int().min(60).max(MAX_REMOTE_TTL_SECONDS).optional(),
})

const PairResponse = z
  .object({
    token: z.string(),
    expiresAt: z.number(),
    directory: z.string(),
    sessionID: z.string().optional(),
    url: z.string().url(),
  })
  .meta({ ref: "RemotePairResponse" })

function escapeHTMLAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
}

function buildAppScriptSource(requestURL: string) {
  const url = new URL(requestURL)
  const params = new URLSearchParams(url.search)
  params.set("app", "1")
  return `?${params.toString()}`
}

function buildRemoteBaseURL(requestURL: string) {
  const url = new URL(requestURL)
  const result = new URL(requestURL)
  result.pathname = url.pathname
    .replace(/\/pair$/, "")
    .replace(/\/app\.js$/, "")
    .replace(/\/$/, "")
  result.search = ""
  result.hash = ""
  return result
}

function renderHTML(requestURL: string) {
  const appScriptSource = escapeHTMLAttribute(buildAppScriptSource(requestURL))
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Open Code Commander Remote</title>
    <style>
      :root {
        color-scheme: light;
        --vh: 100vh;
        --keyboard: 0px;
        --bg: #f6f5f3;
        --surface: #ffffff;
        --surface-muted: #f3f1ed;
        --surface-soft: #f8f7f4;
        --surface-strong: #efebe5;
        --text: #171717;
        --muted: #767676;
        --muted-strong: #545454;
        --accent: #2f6df6;
        --accent-soft: rgba(47, 109, 246, 0.1);
        --accent-ink: #ffffff;
        --border: rgba(17, 17, 17, 0.08);
        --border-strong: rgba(17, 17, 17, 0.14);
        --shadow: 0 18px 40px rgba(15, 23, 42, 0.06);
        --success: #1d9b5f;
        --success-soft: rgba(29, 155, 95, 0.1);
        --warning: #e39a1c;
        --warning-soft: rgba(227, 154, 28, 0.12);
        --error: #cb4d4d;
        --error-soft: rgba(203, 77, 77, 0.12);
        --info: #0ea5a3;
        --info-soft: rgba(14, 165, 163, 0.12);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        height: 100%;
        min-height: 100%;
        background: var(--bg);
        color: var(--text);
      }
      body {
        height: var(--vh);
        min-height: var(--vh);
        font-size: 15px;
        line-height: 1.5;
        overscroll-behavior-y: none;
        overflow: hidden;
      }
      h1,
      h2,
      h3,
      p,
      pre {
        margin: 0;
      }
      button,
      input,
      select,
      textarea {
        font: inherit;
      }
      button,
      input,
      select,
      textarea {
        border-radius: 1rem;
      }
      button {
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        padding: 0.8rem 1rem;
        transition:
          background 120ms ease,
          border-color 120ms ease,
          transform 120ms ease;
      }
      button:disabled {
        opacity: 0.45;
      }
      button.ghost {
        background: transparent;
      }
      button.compact {
        padding: 0.6rem 0.85rem;
      }
      button.icon {
        width: 3rem;
        min-width: 3rem;
        padding: 0.75rem;
      }
      button.primary {
        border-color: transparent;
        background: var(--accent);
        color: var(--accent-ink);
      }
      button.reject {
        color: var(--error);
        border-color: rgba(203, 77, 77, 0.24);
        background: rgba(203, 77, 77, 0.04);
      }
      input,
      select,
      textarea {
        width: 100%;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        padding: 0.85rem 0.95rem;
      }
      textarea {
        resize: none;
        min-height: 3.75rem;
      }
      pre,
      code,
      .mono {
        font-family: "SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace;
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
      }
      .hidden {
        display: none !important;
      }
      .app-shell {
        height: var(--vh);
        min-height: var(--vh);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .status-header,
      .status-bar,
      .tab-bar {
        background: rgba(246, 245, 243, 0.95);
        backdrop-filter: blur(20px);
      }
      .status-header,
      .status-bar,
      .tab-bar,
      .pane-head,
      .composer,
      .pending-shell,
      .section-block,
      .stat-card,
      .session-item,
      .log-item,
      .message,
      .pending-item,
      .tool-block,
      .file-block,
      .empty-state {
        border: 1px solid var(--border);
        background: var(--surface);
        box-shadow: var(--shadow);
      }
      .status-header {
        position: sticky;
        top: 0;
        z-index: 8;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
        padding: max(0.85rem, env(safe-area-inset-top)) 1rem 0.85rem;
        border-bottom: 1px solid var(--border);
      }
      .brand {
        min-width: 0;
        display: flex;
        gap: 0.8rem;
        align-items: flex-start;
      }
      .brand-mark {
        width: 2.75rem;
        height: 2.75rem;
        display: block;
        flex-shrink: 0;
      }
      .brand-mark svg {
        width: 100%;
        height: 100%;
        display: block;
      }
      .brand-copy {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      .brand-copy strong {
        font-size: 1.05rem;
        font-weight: 700;
      }
      .brand-model {
        color: var(--muted);
      }
      .brand-note {
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.35;
      }
      .header-pills,
      .pane-actions,
      .subpills,
      .status-bar,
      .field-head,
      .inline-actions,
      .pair-actions,
      .filters,
      .meta-line,
      .message-head,
      .log-meta,
      .question-inputs,
      .section-head {
        display: flex;
        gap: 0.65rem;
      }
      .header-pills,
      .pane-actions,
      .subpills,
      .inline-actions,
      .pair-actions,
      .filters {
        flex-wrap: wrap;
      }
      .status-header .header-pills {
        justify-content: flex-end;
      }
      .pill,
      .badge,
      .inline-badge,
      .status-meta {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        min-width: 0;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
        padding: 0.45rem 0.75rem;
        border-radius: 999px;
      }
      .badge.compact,
      .pill.subtle,
      .inline-badge {
        padding: 0.38rem 0.7rem;
      }
      .status-meta {
        background: transparent;
        border: 0;
        padding: 0;
        color: var(--muted-strong);
        border-radius: 0;
      }
      .status-bar {
        align-items: center;
        padding: 0.65rem 1rem;
        border-bottom: 1px solid var(--border);
        box-shadow: none;
      }
      .status-meta-grow {
        flex: 1;
      }
      .tab-bar {
        display: flex;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        overflow-x: auto;
        border-bottom: 1px solid var(--border);
        box-shadow: none;
      }
      .tab-button {
        min-width: 7rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.45rem;
        padding: 0.85rem 1rem;
        border-radius: 1rem;
        color: var(--muted-strong);
        background: transparent;
        border-color: transparent;
        box-shadow: none;
      }
      .tab-button.is-active {
        color: var(--text);
        background: var(--surface);
        border-color: var(--border-strong);
      }
      .tab-badge {
        padding: 0.1rem 0.45rem;
        border-radius: 999px;
        background: var(--surface-muted);
        color: var(--muted-strong);
        font-size: 0.76rem;
      }
      .status-dot {
        width: 0.6rem;
        height: 0.6rem;
        border-radius: 999px;
        background: var(--warning);
      }
      .status-dot.online {
        background: var(--success);
      }
      .status-dot.connecting {
        background: var(--warning);
      }
      .status-dot.offline {
        background: var(--error);
      }
      .tone-success {
        border-color: rgba(29, 155, 95, 0.2);
        color: var(--success);
        background: var(--success-soft);
      }
      .tone-warning {
        border-color: rgba(227, 154, 28, 0.2);
        color: var(--warning);
        background: var(--warning-soft);
      }
      .tone-error {
        border-color: rgba(203, 77, 77, 0.2);
        color: var(--error);
        background: var(--error-soft);
      }
      .tone-info {
        border-color: rgba(14, 165, 163, 0.18);
        color: var(--info);
        background: var(--info-soft);
      }
      .tab-panel {
        display: none;
        flex: 1;
        min-height: 0;
        padding: 1rem;
        overflow: hidden;
      }
      .tab-panel.is-active {
        display: flex;
      }
      .pane {
        width: min(100%, 96rem);
        margin: 0 auto;
        height: 100%;
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        border-radius: 1.5rem;
        overflow: hidden;
      }
      .pane-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
        padding: 1rem 1rem 0.9rem;
        border-bottom: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.84);
      }
      .pane-kicker,
      .label,
      .hint,
      .pair-note,
      .session-meta,
      .message-meta,
      .message-model,
      .message-finish,
      .log-meta .meta {
        color: var(--muted);
      }
      .pane-kicker,
      .label {
        font-size: 0.78rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }
      .pane-note {
        color: var(--muted);
        margin-top: 0.15rem;
      }
      .view-body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        background: var(--surface-soft);
      }
      .chat-pane {
        background: var(--surface-soft);
        min-height: 0;
      }
      .subpills {
        padding: 0.85rem 1rem 0;
        overflow-x: auto;
      }
      .pending-shell {
        margin: 1rem 1rem 0;
        padding: 0.85rem;
        border-radius: 1.25rem;
      }
      .pending-head,
      .section-head,
      .field-head,
      .meta-line,
      .message-head,
      .log-meta {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 0.75rem;
      }
      .pending,
      .logs,
      .session-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .pending {
        margin-top: 0.85rem;
      }
      .message-list,
      .log-list {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 1rem;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-y;
      }
      .messages {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .message-row {
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
      }
      .message-row.user {
        flex-direction: row-reverse;
      }
      .message-avatar {
        width: 2.4rem;
        height: 2.4rem;
        flex: 0 0 2.4rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: var(--surface);
        border: 1px solid var(--border);
        color: var(--muted-strong);
        font-size: 0.82rem;
        font-weight: 700;
        box-shadow: var(--shadow);
      }
      .message {
        width: fit-content;
        max-width: min(84%, 52rem);
        padding: 0.9rem 1rem;
        border-radius: 1.4rem;
      }
      .message.user {
        margin-left: auto;
        background: #eceae6;
      }
      .message.assistant {
        margin-right: auto;
        background: #ffffff;
      }
      .message.system {
        max-width: 100%;
        width: 100%;
      }
      .message-author {
        color: var(--text);
        font-weight: 600;
      }
      .tool-block,
      .file-block,
      .question-inputs,
      .log-extra {
        margin-top: 0.75rem;
      }
      .message-body pre {
        font-family: inherit;
        white-space: pre-wrap;
      }
      .message-time {
        display: block;
        margin-top: 0.7rem;
        color: var(--muted);
        font-size: 0.88rem;
      }
      .tool-block,
      .file-block,
      .log-extra,
      details {
        border: 1px solid var(--border);
        background: var(--surface-soft);
        border-radius: 1rem;
      }
      .tool-block,
      .file-block,
      .log-extra {
        padding: 0.75rem;
      }
      details summary {
        cursor: pointer;
        color: var(--muted);
        padding: 0.75rem 0.85rem;
        list-style: none;
      }
      details summary::-webkit-details-marker {
        display: none;
      }
      details[open] summary {
        border-bottom: 1px solid var(--border);
      }
      details .details-body {
        padding: 0.85rem;
      }
      .typing-dots {
        display: inline-flex;
        gap: 0.35rem;
        align-items: center;
      }
      .typing-dots span {
        width: 0.45rem;
        height: 0.45rem;
        border-radius: 999px;
        background: var(--muted);
        animation: pulse 1.2s ease-in-out infinite;
      }
      .typing-dots span:nth-child(2) {
        animation-delay: 0.15s;
      }
      .typing-dots span:nth-child(3) {
        animation-delay: 0.3s;
      }
      @keyframes pulse {
        0%,
        80%,
        100% {
          opacity: 0.35;
          transform: translateY(0);
        }
        40% {
          opacity: 1;
          transform: translateY(-2px);
        }
      }
      .composer {
        margin: 0 1rem 1rem;
        margin-bottom: max(1rem, env(safe-area-inset-bottom));
        padding: 0.85rem;
        border-radius: 1.25rem;
        background: rgba(255, 255, 255, 0.85);
      }
      body.keyboard-open .composer {
        margin-bottom: max(0.5rem, env(safe-area-inset-bottom));
      }
      .attachment-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.55rem;
        margin-bottom: 0.75rem;
      }
      .attachment-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        border: 1px solid var(--border);
        background: var(--surface-soft);
        padding: 0.4rem 0.65rem;
        border-radius: 999px;
        max-width: 100%;
      }
      .attachment-chip span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .attachment-chip button {
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--muted);
        box-shadow: none;
      }
      .command-menu {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        margin-bottom: 0.75rem;
        border: 1px solid var(--border);
        background: var(--surface);
        padding: 0.45rem;
        border-radius: 1rem;
      }
      .command-item {
        width: 100%;
        text-align: left;
        padding: 0.65rem 0.75rem;
        border: 1px solid transparent;
        background: transparent;
        border-radius: 0.85rem;
        box-shadow: none;
      }
      .command-item.active {
        border-color: rgba(47, 109, 246, 0.18);
        background: var(--accent-soft);
      }
      .command-note {
        display: block;
        color: var(--muted);
        margin-top: 0.2rem;
        font-size: 0.88rem;
      }
      .composer-shell {
        display: flex;
        gap: 0.75rem;
        align-items: flex-end;
      }
      .composer-shell textarea {
        min-height: 3.5rem;
        max-height: 12rem;
        height: 3.5rem;
        overflow-y: auto;
        border-radius: 1.1rem;
      }
      .composer-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
        margin-top: 0.75rem;
      }
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
      }
      .stat-card,
      .section-block,
      .session-item,
      .log-item,
      .pending-item,
      .empty-state {
        border-radius: 1.25rem;
        padding: 1rem;
      }
      .span-2 {
        grid-column: 1 / -1;
      }
      .field-value {
        margin-top: 0.4rem;
        font-size: 1.2rem;
        font-weight: 600;
      }
      .pair-code {
        margin-top: 0.55rem;
        font-size: clamp(2rem, 8vw, 3rem);
        letter-spacing: 0.12em;
        text-align: center;
        font-weight: 700;
      }
      .progress {
        margin-top: 0.75rem;
        height: 0.55rem;
        border-radius: 999px;
        background: var(--surface-strong);
        overflow: hidden;
      }
      .progress-bar {
        width: 0%;
        height: 100%;
        background: var(--accent);
        border-radius: inherit;
      }
      .progress-meta {
        margin-top: 0.55rem;
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
        color: var(--muted);
        font-size: 0.86rem;
      }
      .session-item {
        width: 100%;
        text-align: left;
      }
      .session-item.active {
        border-color: rgba(47, 109, 246, 0.24);
        background: var(--accent-soft);
      }
      .filters {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .filters label {
        min-width: 0;
      }
      .log-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0;
      }
      .log-item {
        display: flex;
        gap: 0.85rem;
        align-items: flex-start;
      }
      .log-dot {
        width: 0.7rem;
        height: 0.7rem;
        margin-top: 0.4rem;
        border-radius: 999px;
        background: var(--info);
        flex: 0 0 0.7rem;
      }
      .log-item.level-WARN .log-dot {
        background: var(--warning);
      }
      .log-item.level-ERROR .log-dot {
        background: var(--error);
      }
      .log-item.level-DEBUG .log-dot {
        background: var(--muted);
      }
      .question-inputs {
        display: grid;
      }
      .empty-state {
        color: var(--muted-strong);
        background: var(--surface);
      }
      @media (max-width: 900px) {
        .filters,
        .stats-grid {
          grid-template-columns: 1fr;
        }
        .span-2 {
          grid-column: auto;
        }
      }
      @media (max-width: 720px) {
        button,
        input,
        select,
        textarea {
          font-size: 16px;
        }
        .status-header,
        .status-bar,
        .tab-bar,
        .tab-panel {
          padding-left: 0.75rem;
          padding-right: 0.75rem;
        }
        .status-header {
          flex-direction: row;
        }
        .status-bar {
          flex-wrap: wrap;
        }
        .pane-head,
        .composer,
        .pending-shell,
        .view-body,
        .message-list {
          padding-left: 0.85rem;
          padding-right: 0.85rem;
        }
        .pane-actions,
        .composer-meta,
        .message-head,
        .field-head,
        .section-head {
          flex-direction: column;
          align-items: stretch;
        }
        .message {
          max-width: calc(100% - 3.15rem);
        }
        .composer {
          margin-left: 0.85rem;
          margin-right: 0.85rem;
        }
        .composer-shell {
          align-items: stretch;
        }
        .tab-button {
          min-width: max-content;
          white-space: nowrap;
        }
      }
    </style>
  </head>
  <body>
    <main class="app-shell">
      <header class="status-header">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 220 220" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="70" y="30" width="80" height="160" rx="18" fill="#0F172A" />
              <rect x="82" y="55" width="56" height="95" rx="8" fill="#111827" />
              <rect x="90" y="70" width="40" height="35" rx="6" fill="#1F2937" />
              <path
                d="M96 85 L104 92 L96 99"
                stroke="#60A5FA"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <line x1="108" y1="98" x2="122" y2="98" stroke="#60A5FA" stroke-width="3" stroke-linecap="round" />
              <path d="M150 65 C165 75 165 95 150 105" stroke="#6366F1" stroke-width="4" stroke-linecap="round" />
              <path d="M160 55 C185 75 185 95 160 115" stroke="#6366F1" stroke-width="4" stroke-linecap="round" />
              <circle cx="110" cy="110" r="105" stroke="#3B82F6" stroke-opacity="0.15" stroke-width="4" />
            </svg>
          </div>
          <div class="brand-copy">
            <strong>Open Code</strong>
            <span class="brand-model hidden" id="brand-model">Commander remote workspace</span>
            <span class="brand-note hidden" id="remote-meta">Commander remote workspace connected and ready.</span>
          </div>
        </div>
        <div class="header-pills">
          <span class="pill" id="connection-pill">
            <span class="status-dot connecting" id="connection-dot"></span>
            <span id="connection-label">Connecting</span>
          </span>
          <span class="pill" id="busy-badge">Available</span>
        </div>
      </header>

      <section class="status-bar">
        <span class="status-meta" id="context-badge">Context: —</span>
        <span class="status-meta" id="cost-badge">Cost: —</span>
        <span class="status-meta status-meta-grow" id="model-badge">Model: —</span>
      </section>

      <nav class="tab-bar" aria-label="Remote tabs">
        <button type="button" class="tab-button is-active" data-tab="chat" aria-selected="true">
          <span>Chat</span>
          <span id="chat-tab-badge" class="tab-badge hidden">0</span>
        </button>
        <button type="button" class="tab-button" data-tab="logs" aria-selected="false">
          <span>Logs</span>
          <span id="logs-tab-badge" class="tab-badge hidden">0</span>
        </button>
        <button type="button" class="tab-button" data-tab="sessions" aria-selected="false">
          <span>Sessions</span>
        </button>
        <button type="button" class="tab-button" data-tab="pair" aria-selected="false">
          <span>Pairing</span>
        </button>
      </nav>

      <section class="tab-panel is-active" data-tab-panel="chat">
        <section class="pane chat-pane">
          <div class="pane-head hidden">
            <div>
              <p class="pane-kicker">Chat</p>
              <h1 id="session-title">Remote session</h1>
              <p class="pane-note" id="session-meta">No session selected.</p>
            </div>
            <div class="pane-actions">
              <span class="inline-badge" id="session-status-badge">Idle</span>
              <button type="button" id="refresh-button" class="ghost compact">Refresh</button>
            </div>
          </div>

          <div class="subpills hidden">
            <span class="badge compact" id="pending-badge">0 pending</span>
            <span class="badge compact" id="events-badge">Events: connecting</span>
            <span class="badge compact" id="logs-badge">Logs: connecting</span>
          </div>

          <section class="pending-shell hidden" id="pending-panel">
            <div class="pending-head">
              <div>
                <h2>Pending items</h2>
                <p class="pane-note">Permissions and questions waiting for a reply.</p>
              </div>
              <span class="inline-badge" id="pending-inline-count">0</span>
            </div>
            <div class="pending" id="pending-list"></div>
          </section>

          <div class="message-list" id="message-list"></div>

          <form id="prompt-form" class="composer">
            <div class="attachment-list hidden" id="attachment-list"></div>
            <div class="command-menu hidden" id="command-menu"></div>
            <div class="composer-shell">
              <input
                id="attach-input"
                class="hidden"
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.html,.xml,.yml,.yaml,.sh,.py,.go,.rs,.java,.kt,.swift,.sql"
              />
              <button type="button" id="attach-button" class="ghost icon">+</button>
              <textarea id="prompt-input" placeholder="Type a message..."></textarea>
              <button type="submit" id="send-button" class="primary icon">↗</button>
            </div>
            <div class="composer-meta hidden">
              <p class="hint" id="prompt-hint">Use / to preview commands or attach files before sending.</p>
              <button type="button" id="jump-latest" class="ghost compact hidden">Jump to latest</button>
            </div>
          </form>
        </section>
      </section>

      <section class="tab-panel" data-tab-panel="logs">
        <section class="pane">
          <div class="pane-head">
            <div>
              <p class="pane-kicker">Logs</p>
              <h2>Activity logs</h2>
              <p class="pane-note">Inspect the current Commander process without leaving mobile.</p>
            </div>
            <div class="pane-actions">
              <span class="pill subtle" id="log-count">0 entries</span>
              <button type="button" id="refresh-logs-button" class="ghost compact">Refresh logs</button>
            </div>
          </div>
          <div class="view-body">
            <div class="filters">
              <label>
                <div class="label">Scope</div>
                <select id="log-scope">
                  <option value="workspace">Workspace</option>
                  <option value="session">Active session</option>
                </select>
              </label>
              <label>
                <div class="label">Service</div>
                <select id="log-service">
                  <option value="">All services</option>
                </select>
              </label>
              <label>
                <div class="label">Level</div>
                <select id="log-level">
                  <option value="">All levels</option>
                  <option value="INFO">INFO</option>
                  <option value="WARN">WARN</option>
                  <option value="ERROR">ERROR</option>
                  <option value="DEBUG">DEBUG</option>
                </select>
              </label>
            </div>
            <div class="log-list" id="log-list"></div>
            <div class="inline-actions">
              <button type="button" id="jump-logs-latest" class="ghost compact hidden">Jump to latest</button>
            </div>
          </div>
        </section>
      </section>

      <section class="tab-panel" data-tab-panel="sessions">
        <section class="pane">
          <div class="pane-head">
            <div>
              <p class="pane-kicker">Sessions</p>
              <h2>Current session</h2>
              <p class="pane-note">Inspect the active conversation and switch if needed.</p>
            </div>
            <div class="pane-actions">
              <span class="pill subtle" id="session-tab-status">Idle</span>
              <button type="button" id="new-session-button" class="ghost compact">New session</button>
            </div>
          </div>
          <div class="view-body">
            <div class="stats-grid">
              <article class="stat-card span-2">
                <p class="label">Session ID</p>
                <p class="field-value mono" id="session-id-value">—</p>
              </article>
              <article class="stat-card">
                <p class="label">Started</p>
                <p class="field-value mono" id="session-start-value">—</p>
              </article>
              <article class="stat-card">
                <p class="label">Duration</p>
                <p class="field-value mono" id="session-duration-value">—</p>
              </article>
              <article class="stat-card">
                <p class="label">Messages</p>
                <p class="field-value" id="session-message-value">0</p>
              </article>
              <article class="stat-card">
                <p class="label">Total cost</p>
                <p class="field-value" id="session-total-cost-value">—</p>
              </article>
              <article class="stat-card span-2">
                <p class="label">Model</p>
                <p class="field-value mono" id="session-model-value">—</p>
                <div class="progress"><div class="progress-bar" id="session-context-bar"></div></div>
                <div class="progress-meta">
                  <span id="session-context-value">0 tokens</span>
                  <span id="session-context-max">200,000 max</span>
                </div>
              </article>
              <article class="stat-card span-2">
                <p class="label">Tokens used</p>
                <p class="field-value mono" id="session-token-value">0</p>
              </article>
            </div>
            <section class="section-block">
              <div class="section-head">
                <div>
                  <h3>Available sessions</h3>
                  <p class="hint">Tap a session to continue chatting there.</p>
                </div>
              </div>
              <div class="session-list" id="session-list"></div>
            </section>
          </div>
        </section>
      </section>

      <section class="tab-panel" data-tab-panel="pair">
        <section class="pane">
          <div class="pane-head">
            <div>
              <p class="pane-kicker">Pairing</p>
              <h2>Secure access</h2>
              <p class="pane-note">Reuse this exact link later or share it safely with the paired device.</p>
            </div>
            <div class="pane-actions">
              <span class="pill subtle" id="pair-status-pill">Protected</span>
            </div>
          </div>
          <div class="view-body">
            <div class="stats-grid">
              <article class="stat-card span-2">
                <div class="field-head">
                  <span class="label">Pairing code</span>
                  <button type="button" id="copy-code-button" class="ghost compact">Copy</button>
                </div>
                <div class="pair-code mono" id="pair-code-value">—</div>
                <p class="hint" id="pair-expiry">Protected by the server auth flow.</p>
              </article>
              <article class="stat-card span-2">
                <div class="field-head">
                  <span class="label">Exact pairing URL</span>
                  <button type="button" id="copy-link-button" class="ghost compact">Copy</button>
                </div>
                <input id="secure-link-input" readonly value="" />
                <p class="hint">Open this exact link to reuse the same pairing.</p>
              </article>
              <article class="stat-card span-2">
                <div class="field-head">
                  <span class="label">Base URL</span>
                  <button type="button" id="copy-base-button" class="ghost compact">Copy</button>
                </div>
                <input id="base-link-input" readonly value="" />
                <p class="hint">The base URL works only with valid server credentials or a pairing token.</p>
              </article>
              <article class="stat-card">
                <p class="label">Directory</p>
                <p class="field-value mono" id="directory-meta">—</p>
                <p class="hint" id="pair-directory-note">Workspace-scoped remote access.</p>
              </article>
              <article class="stat-card">
                <p class="label">Access</p>
                <p class="field-value" id="pair-access-label">Server auth</p>
                <p class="hint" id="pair-session-note">Workspace home</p>
              </article>
              <article class="stat-card span-2">
                <p class="label">Token preview</p>
                <p class="field-value mono" id="token-preview">—</p>
              </article>
            </div>
            <div class="inline-actions">
              <button type="button" id="regenerate-button" class="primary compact">Regenerate link</button>
              <button type="button" id="open-link-button" class="ghost compact">Open</button>
            </div>
            <p class="hint" id="pair-hint"></p>
          </div>
        </section>
      </section>
    </main>

    <script type="module" src="${appScriptSource}"></script>
  </body>
</html>`
}

const script = String.raw`
const LOG_LIMIT = 200;
const MESSAGE_LIMIT = 80;
const CONNECT_TIMEOUT = 3000;
const REQUEST_TIMEOUT = 5000;
const PROMPT_TIMEOUT = 8000;
const KEYBOARD_MIN = 120;
const INPUT_MIN = 56;
const INPUT_MAX = 192;
const COMMAND_LIMIT = 8;
const CONTEXT_MAX = 200000;
const TAB_STORAGE_KEY = "opencode_remote_tab";
const TABS = ["chat", "logs", "sessions", "pair"];
const query = new URLSearchParams(window.location.search);
const ROUTE_PREFIX = normalizeRoutePrefix(window.location.pathname);

const state = {
  activeTab: "chat",
  commands: [],
  commandIndex: 0,
  attachments: [],
  lockedSessionID: query.get("sessionID") || "",
  currentSessionID: query.get("sessionID") || "",
  sessions: [],
  sessionStatus: {},
  messages: [],
  permissions: [],
  questions: [],
  logs: [],
  services: [],
  unseenMessages: 0,
  unseenLogs: 0,
  eventsConnection: "connecting",
  logsConnection: "connecting",
};

let messageViewport;
let logViewport;
let snapshotTimer;
let eventStream;
let logSocket;
let eventPollTimer;
let logPollTimer;
let eventConnectTimer;
let logConnectTimer;
let logReconnectTimer;
let logReconnectAttempts = 0;
let logReconnectGeneration = 0;

const el = {
  brandModel: document.getElementById("brand-model"),
  remoteMeta: document.getElementById("remote-meta"),
  connectionPill: document.getElementById("connection-pill"),
  connectionDot: document.getElementById("connection-dot"),
  connectionLabel: document.getElementById("connection-label"),
  directoryMeta: document.getElementById("directory-meta"),
  pairDirectoryNote: document.getElementById("pair-directory-note"),
  pairAccessLabel: document.getElementById("pair-access-label"),
  pairExpiry: document.getElementById("pair-expiry"),
  pairStatusPill: document.getElementById("pair-status-pill"),
  pairCodeValue: document.getElementById("pair-code-value"),
  busyBadge: document.getElementById("busy-badge"),
  contextBadge: document.getElementById("context-badge"),
  costBadge: document.getElementById("cost-badge"),
  modelBadge: document.getElementById("model-badge"),
  pendingBadge: document.getElementById("pending-badge"),
  eventsBadge: document.getElementById("events-badge"),
  logsBadge: document.getElementById("logs-badge"),
  jumpLatest: document.getElementById("jump-latest"),
  refreshButton: document.getElementById("refresh-button"),
  secureLinkInput: document.getElementById("secure-link-input"),
  baseLinkInput: document.getElementById("base-link-input"),
  tokenPreview: document.getElementById("token-preview"),
  pairSessionNote: document.getElementById("pair-session-note"),
  copyLinkButton: document.getElementById("copy-link-button"),
  copyCodeButton: document.getElementById("copy-code-button"),
  copyBaseButton: document.getElementById("copy-base-button"),
  openLinkButton: document.getElementById("open-link-button"),
  regenerateButton: document.getElementById("regenerate-button"),
  pairHint: document.getElementById("pair-hint"),
  newSessionButton: document.getElementById("new-session-button"),
  sessionList: document.getElementById("session-list"),
  sessionTabStatus: document.getElementById("session-tab-status"),
  sessionIDValue: document.getElementById("session-id-value"),
  sessionStartValue: document.getElementById("session-start-value"),
  sessionDurationValue: document.getElementById("session-duration-value"),
  sessionMessageValue: document.getElementById("session-message-value"),
  sessionTotalCostValue: document.getElementById("session-total-cost-value"),
  sessionModelValue: document.getElementById("session-model-value"),
  sessionContextBar: document.getElementById("session-context-bar"),
  sessionContextValue: document.getElementById("session-context-value"),
  sessionContextMax: document.getElementById("session-context-max"),
  sessionTokenValue: document.getElementById("session-token-value"),
  tabButtons: Array.from(document.querySelectorAll("[data-tab]")),
  tabPanels: Array.from(document.querySelectorAll("[data-tab-panel]")),
  chatTabBadge: document.getElementById("chat-tab-badge"),
  logsTabBadge: document.getElementById("logs-tab-badge"),
  logCount: document.getElementById("log-count"),
  pendingPanel: document.getElementById("pending-panel"),
  pendingInlineCount: document.getElementById("pending-inline-count"),
  pendingList: document.getElementById("pending-list"),
  sessionTitle: document.getElementById("session-title"),
  sessionMeta: document.getElementById("session-meta"),
  sessionStatusBadge: document.getElementById("session-status-badge"),
  messageList: document.getElementById("message-list"),
  promptForm: document.getElementById("prompt-form"),
  promptInput: document.getElementById("prompt-input"),
  promptHint: document.getElementById("prompt-hint"),
  commandMenu: document.getElementById("command-menu"),
  attachmentList: document.getElementById("attachment-list"),
  attachButton: document.getElementById("attach-button"),
  attachInput: document.getElementById("attach-input"),
  sendButton: document.getElementById("send-button"),
  jumpLogsLatest: document.getElementById("jump-logs-latest"),
  refreshLogsButton: document.getElementById("refresh-logs-button"),
  logScope: document.getElementById("log-scope"),
  logService: document.getElementById("log-service"),
  logLevel: document.getElementById("log-level"),
  logList: document.getElementById("log-list"),
};

messageViewport = el.messageList;
logViewport = el.logList;

function vh() {
  if (window.visualViewport && window.visualViewport.height) return window.visualViewport.height;
  return window.innerHeight;
}

function inset() {
  if (!window.visualViewport) return 0;
  return Math.max(window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop, 0);
}

function sync() {
  const keyboard = inset();
  document.documentElement.style.setProperty('--vh', vh() + 'px');
  document.documentElement.style.setProperty('--keyboard', keyboard + 'px');
  document.body.classList.toggle('keyboard-open', keyboard > KEYBOARD_MIN);
}

function resize() {
  el.promptInput.style.height = INPUT_MIN + 'px';
  const next = Math.max(INPUT_MIN, Math.min(el.promptInput.scrollHeight, INPUT_MAX));
  el.promptInput.style.height = next + 'px';
}

function editable(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (node instanceof HTMLTextAreaElement) return true;
  if (node instanceof HTMLInputElement) return !['button', 'checkbox', 'file', 'hidden', 'radio', 'reset', 'submit'].includes(node.type);
  return node.isContentEditable;
}

function reveal(node) {
  if (!(node instanceof HTMLElement)) return;
  if (node === el.promptInput || node.closest('#prompt-form')) return;
  requestAnimationFrame(() => {
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

function hydrateTab() {
  try {
    const value = localStorage.getItem(TAB_STORAGE_KEY);
    if (value && TABS.includes(value)) state.activeTab = value;
  } catch {}
}

function setActiveTab(tab, persist) {
  const next = TABS.includes(tab) ? tab : "chat";
  state.activeTab = next;
  el.tabButtons.forEach((item) => {
    const active = item.dataset.tab === next;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-selected", String(active));
  });
  el.tabPanels.forEach((item) => {
    item.classList.toggle("is-active", item.dataset.tabPanel === next);
  });
  if (next === "chat") {
    state.unseenMessages = 0;
    requestAnimationFrame(() => {
      resize();
      jumpToLatest();
    });
  }
  if (next === "logs") {
    state.unseenLogs = 0;
    requestAnimationFrame(() => jumpLogsToLatest());
  }
  updateJumpButtons();
  updateTabBadges();
  if (persist === false) return;
  try {
    localStorage.setItem(TAB_STORAGE_KEY, next);
  } catch {}
}

function builtins() {
  return [
    {
      name: 'new',
      description: 'start a fresh mobile session',
      source: 'local',
      hints: [],
    },
    {
      name: 'chat',
      description: 'jump to the chat tab',
      source: 'local',
      hints: [],
    },
    {
      name: 'pairing',
      description: 'open pairing and security',
      source: 'local',
      hints: [],
    },
    {
      name: 'sessions',
      description: 'open the sessions tab',
      source: 'local',
      hints: [],
    },
    {
      name: 'logs',
      description: 'open the logs tab',
      source: 'local',
      hints: [],
    },
  ];
}

function slash() {
  const end = el.promptInput.selectionStart ?? el.promptInput.value.length;
  const text = el.promptInput.value.slice(0, end);
  const match = text.match(/^\/([^\s]*)$/);
  if (!match) return;
  return match[1].toLowerCase();
}

function shown() {
  const text = slash();
  if (text === undefined) return [];
  const list = builtins().concat(state.commands);
  if (!text) return list.slice(0, COMMAND_LIMIT);
  return list
    .filter((item) => {
      return item.name.toLowerCase().includes(text) || (item.description || '').toLowerCase().includes(text);
    })
    .slice(0, COMMAND_LIMIT);
}

function renderCommands() {
  const list = shown();
  const open = list.length > 0 && slash() !== undefined;
  el.commandMenu.classList.toggle('hidden', !open);
  if (!open) {
    el.commandMenu.innerHTML = '';
    return;
  }
  if (state.commandIndex >= list.length) state.commandIndex = 0;
  el.commandMenu.innerHTML = list.map((item, index) => {
    const active = index === state.commandIndex ? ' active' : '';
    const hints = item.hints && item.hints.length ? ' · ' + item.hints.join(' ') : '';
    const label = item.source === 'local' ? 'local' : item.source || 'command';
    return '<button type="button" class="command-item' + active + '" data-command-select="' + escapeHTML(item.name) + '">' +
      '<strong>/' + escapeHTML(item.name) + '</strong>' +
      '<span class="command-note">' + escapeHTML((item.description || 'command') + hints + ' · ' + label) + '</span>' +
      '</button>';
  }).join('');
}

function choose(name) {
  el.promptInput.value = '/' + name + ' ';
  state.commandIndex = 0;
  resize();
  renderCommands();
  el.promptInput.focus();
}

async function loadCommands() {
  const list = await apiFetch('/command');
  state.commands = (Array.isArray(list) ? list : []).map((item) => ({
    name: item.name,
    description: item.description || '',
    source: item.source || 'command',
    hints: Array.isArray(item.hints) ? item.hints : [],
  }));
  renderCommands();
}

function mime(name, type) {
  if (type) return type;
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
  if (ext === 'pdf') return 'application/pdf';
  if (['txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'xml', 'yml', 'yaml', 'sh', 'py', 'go', 'rs', 'java', 'kt', 'swift', 'sql'].includes(ext)) return 'text/plain';
  return 'application/octet-stream';
}

function size(value) {
  if (!value) return '0 B';
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderAttachments() {
  const open = state.attachments.length > 0;
  el.attachmentList.classList.toggle('hidden', !open);
  if (!open) {
    el.attachmentList.innerHTML = '';
    return;
  }
  el.attachmentList.innerHTML = state.attachments.map((item, index) => {
    return '<div class="attachment-chip">' +
      '<span>' + escapeHTML(item.filename + ' · ' + size(item.bytes)) + '</span>' +
      '<button type="button" data-attachment-remove="' + index + '" aria-label="Remove attachment">×</button>' +
      '</div>';
  }).join('');
}

function parts(text) {
  const list = [];
  if (text) list.push({ type: 'text', text: text });
  return list.concat(state.attachments.map((item) => ({
    type: 'file',
    filename: item.filename,
    mime: item.mime,
    url: item.url,
  })));
}

function clearComposer() {
  el.promptInput.value = '';
  state.attachments = [];
  renderAttachments();
  resize();
  renderCommands();
  if (el.attachInput) el.attachInput.value = '';
}

async function read(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

async function add(list) {
  const files = Array.from(list || []);
  if (!files.length) return;
  const next = await Promise.all(files.map(async (item) => ({
    filename: item.name || 'attachment',
    mime: mime(item.name || 'attachment', item.type),
    url: String(await read(item)),
    bytes: item.size || 0,
  })));
  state.attachments = state.attachments.concat(next);
  renderAttachments();
  el.promptInput.focus();
}

function normalizeRoutePrefix(pathname) {
  const value = typeof pathname === "string" && pathname ? pathname : "/remote";
  const match = value.match(/^(.*)\/remote(?:\/app\.js)?\/?$/);
  return match ? (match[1] || "") : "";
}

function preservedQuery(extra) {
  const params = new URLSearchParams();
  ["directory", "workspace", "token", "expiresAt", "sessionID"].forEach((key) => {
    const value = query.get(key);
    if (value) params.set(key, value);
  });
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      params.delete(key);
      return;
    }
    params.set(key, String(value));
  });
  return params;
}

function syncPageURL() {
  if (state.currentSessionID) query.set("sessionID", state.currentSessionID);
  else query.delete("sessionID");
  const url = new URL(window.location.href);
  url.search = preservedQuery({ sessionID: state.currentSessionID || undefined }).toString();
  window.history.replaceState({}, "", url.toString());
}

function remotePageURL() {
  const url = new URL((ROUTE_PREFIX || "") + "/remote", window.location.origin);
  url.search = preservedQuery({ sessionID: state.currentSessionID || undefined }).toString();
  return url.toString();
}

function apiURL(path, extra) {
  const url = new URL((ROUTE_PREFIX || "") + path, window.location.origin);
  url.search = preservedQuery(extra).toString();
  return url.toString();
}

function socketURL(path, extra) {
  const url = new URL(apiURL(path, extra));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function isSessionLocked() {
  return !!state.lockedSessionID;
}

function authHeaders(headers) {
  const result = new Headers(headers || {});
  const token = query.get("token");
  if (token) result.set("Authorization", "Bearer " + token);
  return result;
}

function errorMessage(payload, fallback) {
  if (payload && typeof payload === "object") {
    if (typeof payload.message === "string" && payload.message) return payload.message;
    if (payload.data && typeof payload.data === "object" && typeof payload.data.message === "string") {
      return payload.data.message;
    }
  }
  return fallback || "Request failed";
}

async function apiFetch(path, options, extra, timeout) {
  const nextOptions = options || {};
  const headers = authHeaders(nextOptions.headers);
  if (nextOptions.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout || REQUEST_TIMEOUT);
  let response;
  try {
    response = await fetch(apiURL(path, extra), { ...nextOptions, headers, signal: ctl.signal });
  } catch (error) {
    if (error && typeof error === 'object' && error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorMessage(payload, response.statusText));
  }
  return payload;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatCompactCount(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0";
  if (numeric < 1000) return String(numeric);
  if (numeric < 10000) return (numeric / 1000).toFixed(1) + "K";
  if (numeric < 1000000) return Math.round(numeric / 100) / 10 + "K";
  return Math.round(numeric / 100000) / 10 + "M";
}

function formatCurrency(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: numeric >= 10 ? 2 : 3,
  }).format(numeric);
}

function formatStructured(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function shorten(value, max) {
  const limit = max || 16;
  const text = String(value || "");
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1).trimEnd() + "…";
}

function maskToken(token) {
  if (!token) return "Server auth";
  if (token.length <= 12) return token;
  return token.slice(0, 6) + "…" + token.slice(-6);
}

function pairCode(token) {
  if (!token) return "SERVER-AUTH";
  const text = token.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (text.length <= 8) return text || "TOKEN";
  return text.slice(0, 4) + "-" + text.slice(-4);
}

function baseRemoteURL() {
  return new URL((ROUTE_PREFIX || "") + "/remote", window.location.origin).toString();
}

function currentSession() {
  return state.sessions.find((item) => item.id === state.currentSessionID);
}

function currentSessionStatus() {
  return state.currentSessionID ? state.sessionStatus[state.currentSessionID] : undefined;
}

function statusLabel(status) {
  if (!status || status.type === "idle") return "Idle";
  if (status.type === "busy") return "Busy";
  return "Retry " + status.attempt;
}

function statusTone(status) {
  if (!status || status.type === "idle") return "";
  if (status.type === "busy") return "tone-info";
  return "tone-warning";
}

function availabilityTone(status) {
  if (status && status.type === "busy") return "tone-warning";
  return "tone-success";
}

function availabilityLabel(status) {
  if (status && status.type === "busy") return "Busy";
  return "Available";
}

function connectionTone(status) {
  if (status === "live") return "tone-success";
  if (status === "polling") return "tone-success";
  if (status === "reconnecting") return "tone-warning";
  if (status === "offline") return "tone-error";
  return "tone-info";
}

function connectionLabel(status) {
  if (status === "live") return "live";
  if (status === "polling") return "polling";
  if (status === "reconnecting") return "reconnecting";
  if (status === "offline") return "offline";
  return "connecting";
}

function overallConnection() {
  if (state.eventsConnection === "live" || state.logsConnection === "live") {
    return { kind: "online", label: "Live" };
  }
  if (state.eventsConnection === "polling" || state.logsConnection === "polling") {
    return { kind: "online", label: "Polling" };
  }
  if (state.eventsConnection === "reconnecting" || state.logsConnection === "reconnecting") {
    return { kind: "connecting", label: "Reconnecting" };
  }
  if (state.eventsConnection === "connecting" || state.logsConnection === "connecting") {
    return { kind: "connecting", label: "Connecting" };
  }
  return { kind: "offline", label: "Offline" };
}

function extractText(parts) {
  const list = (parts || [])
    .filter((part) => part.type === "text" && !part.synthetic && !part.ignored)
    .map((part) => (part.text || "").trim())
    .filter(Boolean);
  if (list.length) return list.join("\n\n");
  if ((parts || []).some((part) => part.type === "reasoning")) return "[reasoning]";
  if ((parts || []).some((part) => part.type === "tool")) return "[tool activity]";
  if ((parts || []).some((part) => part.type === "file")) return "[file context]";
  return "[no text content]";
}

function latestAssistant() {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const candidate = state.messages[index];
    if (candidate && candidate.info && candidate.info.role === "assistant") return candidate.info;
  }
}

function tokenTotal(tokens) {
  if (!tokens) return 0;
  return tokens.total || tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

function formatClock(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatMessageTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDuration(start, end) {
  if (!start) return "—";
  const first = Number(start);
  if (!Number.isFinite(first) || first <= 0) return "—";
  const last = Number(end || Date.now());
  const span = Math.max(Math.floor((last - first) / 1000), 0);
  const hours = Math.floor(span / 3600);
  const mins = Math.floor((span % 3600) / 60);
  const secs = span % 60;
  if (hours) return hours + "h " + mins + "m";
  if (mins) return mins + "m " + secs + "s";
  return secs + "s";
}

function headerModelLabel() {
  const assistant = latestAssistant();
  if (!assistant) return "Remote workspace";
  return assistant.modelID || assistant.providerID || "Remote workspace";
}

function contextBadgeLabel() {
  const assistant = latestAssistant();
  const total = assistant ? tokenTotal(assistant.tokens) : 0;
  return "Context: " + (total ? formatCompactCount(total) + " / " + formatCompactCount(CONTEXT_MAX) : "—");
}

function costBadgeLabel() {
  const total = state.messages.reduce((sum, entry) => {
    return entry.info && entry.info.role === "assistant" ? sum + Number(entry.info.cost || 0) : sum;
  }, 0);
  return "Cost: " + formatCurrency(total);
}

function modelBadgeLabel() {
  const assistant = latestAssistant();
  return "Model: " + (assistant ? assistant.modelID || assistant.providerID : "—");
}

function sessionMetrics() {
  const session = currentSession();
  const assistant = latestAssistant();
  const times = state.messages
    .map((entry) => entry.info && entry.info.time ? entry.info.time.completed || entry.info.time.created : 0)
    .filter(Boolean);
  const created = session && session.time ? session.time.created || session.time.updated : times[0];
  const updated = session && session.time ? session.time.updated || session.time.created : times[times.length - 1];
  const tokens = state.messages.reduce((sum, entry) => {
    return entry.info && entry.info.role === "assistant" ? sum + tokenTotal(entry.info.tokens) : sum;
  }, 0);
  const cost = state.messages.reduce((sum, entry) => {
    return entry.info && entry.info.role === "assistant" ? sum + Number(entry.info.cost || 0) : sum;
  }, 0);
  const context = assistant ? tokenTotal(assistant.tokens) : 0;
  const percent = Math.max(0, Math.min(100, Math.round((context / CONTEXT_MAX) * 100)));
  return {
    id: state.currentSessionID || "—",
    created,
    updated,
    duration: formatDuration(created, updated),
    messages: state.messages.length,
    tokens,
    cost,
    context,
    percent,
    model: assistant ? [assistant.providerID, assistant.modelID].filter(Boolean).join(" · ") : "—",
    status: currentSessionStatus(),
  };
}

function pendingCount() {
  return visiblePermissions().length + visibleQuestions().length;
}

function visiblePermissions() {
  if (!state.currentSessionID) return state.permissions;
  const current = state.permissions.filter((item) => item.sessionID === state.currentSessionID);
  if (isSessionLocked()) return current;
  const rest = state.permissions.filter((item) => item.sessionID !== state.currentSessionID);
  return current.concat(rest);
}

function visibleQuestions() {
  if (!state.currentSessionID) return state.questions;
  const current = state.questions.filter((item) => item.sessionID === state.currentSessionID);
  if (isSessionLocked()) return current;
  const rest = state.questions.filter((item) => item.sessionID !== state.currentSessionID);
  return current.concat(rest);
}

function renderMessageDetails(parts) {
  const reasoning = (parts || []).filter((part) => part.type === "reasoning");
  const tools = (parts || []).filter((part) => part.type === "tool");
  const files = (parts || []).filter((part) => part.type === "file");
  let html = "";

  if (reasoning.length) {
    html += '<details><summary>Reasoning (' + reasoning.length + ')</summary><div class="details-body">' +
      reasoning.map((part) => '<div class="tool-block"><pre>' + escapeHTML((part.text || "").trim() || "[empty reasoning]") + '</pre></div>').join("") +
      '</div></details>';
  }

  if (tools.length) {
    html += '<details><summary>Tool activity (' + tools.length + ')</summary><div class="details-body">' +
      tools.map((part) => {
        const status = part.state && part.state.status ? part.state.status : "pending";
        const input = part.state && "input" in part.state ? formatStructured(part.state.input) : "";
        const output = part.state && "output" in part.state ? formatStructured(part.state.output) : "";
        const error = part.state && "error" in part.state ? String(part.state.error || "") : "";
        return '<div class="tool-block">' +
          '<div class="meta-line"><strong>' + escapeHTML(part.tool || "tool") + '</strong><span class="message-meta">' + escapeHTML(status) + '</span></div>' +
          (input ? '<pre style="margin-top:0.65rem">' + escapeHTML(input) + '</pre>' : '') +
          (output ? '<pre style="margin-top:0.65rem">' + escapeHTML(output) + '</pre>' : '') +
          (error ? '<pre style="margin-top:0.65rem;color:var(--error)">' + escapeHTML(error) + '</pre>' : '') +
          '</div>';
      }).join("") +
      '</div></details>';
  }

  if (files.length) {
    html += '<details><summary>Files (' + files.length + ')</summary><div class="details-body">' +
      files.map((part) => '<div class="file-block"><strong>' + escapeHTML(part.filename || part.source && part.source.type || "file") + '</strong><div class="pair-note">' + escapeHTML(part.source && part.source.type === "file" ? part.source.path : part.url || "") + '</div></div>').join("") +
      '</div></details>';
  }

  return html;
}

function renderSessions() {
  const visibleSessions = isSessionLocked()
    ? state.sessions.filter((session) => session.id === state.lockedSessionID)
    : state.sessions;

  if (!visibleSessions.length) {
    if (isSessionLocked()) {
      el.sessionList.innerHTML = '<div class="empty-state">This pairing link is locked to a session that is no longer available.</div>';
      return;
    }
    el.sessionList.innerHTML = '<div class="empty-state">No sessions yet. Send a prompt to create the first one.</div>';
    return;
  }

  el.sessionList.innerHTML = visibleSessions.map((session) => {
    const active = session.id === state.currentSessionID ? ' active' : '';
    const status = state.sessionStatus[session.id];
    return '<button type="button" class="session-item' + active + '" data-session-id="' + escapeHTML(session.id) + '">' +
      '<div class="meta-line"><strong>' + escapeHTML(session.title || 'Untitled session') + '</strong><span class="badge compact ' + statusTone(status) + '">' + escapeHTML(statusLabel(status)) + '</span></div>' +
      '<div class="session-meta" style="margin-top:0.45rem">' + escapeHTML(formatTimestamp(session.time && (session.time.updated || session.time.created))) + '</div>' +
      '<div class="session-meta">' + escapeHTML(shorten(session.id, 24)) + '</div>' +
      '</button>';
  }).join('');
}

function renderSessionDetails() {
  const info = sessionMetrics();
  const label = state.currentSessionID ? statusLabel(info.status) : "Ready";
  const tone = state.currentSessionID ? statusTone(info.status) : "";
  el.sessionTabStatus.textContent = label;
  el.sessionTabStatus.className = 'pill subtle ' + tone;
  el.sessionIDValue.textContent = info.id;
  el.sessionStartValue.textContent = formatClock(info.created);
  el.sessionDurationValue.textContent = info.duration;
  el.sessionMessageValue.textContent = String(info.messages);
  el.sessionTotalCostValue.textContent = formatCurrency(info.cost);
  el.sessionModelValue.textContent = info.model;
  el.sessionContextBar.style.width = info.percent + '%';
  el.sessionContextValue.textContent = info.context ? info.context.toLocaleString() + ' tokens' : '0 tokens';
  el.sessionContextMax.textContent = CONTEXT_MAX.toLocaleString() + ' max';
  el.sessionTokenValue.textContent = info.tokens.toLocaleString();
}

function renderMessages() {
  const session = currentSession();
  const status = currentSessionStatus();
  el.sessionTitle.textContent = session && session.title ? session.title : isSessionLocked() ? 'Locked remote session' : 'Remote session';
  el.sessionMeta.textContent = state.currentSessionID
    ? (isSessionLocked() ? 'Locked session ID: ' : 'Session ID: ') + state.currentSessionID
    : 'No session selected.';
  el.sessionStatusBadge.textContent = statusLabel(status);
  el.sessionStatusBadge.className = 'inline-badge ' + statusTone(status);

  if (isSessionLocked() && state.currentSessionID && !session) {
    el.messageList.innerHTML = '<div class="messages"><article class="message-row assistant">' +
      '<div class="message-avatar">OC</div>' +
      '<div class="message assistant"><div class="message-body"><pre>This link is tied to a session that no longer exists. Open a fresh pairing link from Open Code Commander.</pre></div></div>' +
      '</article></div>';
    return;
  }

  if (!state.currentSessionID) {
    el.messageList.innerHTML = '<div class="messages"><article class="message-row assistant">' +
      '<div class="message-avatar">OC</div>' +
      '<div class="message assistant">' +
      '<div class="message-body"><pre>Hello! I’m Open Code and I’m ready to help. Send a message, type / to preview commands, or attach files from your phone.</pre></div>' +
      '<div class="message-meta" style="margin-top:0.65rem">A new session will be created automatically when you send the first prompt.</div>' +
      '</div>' +
      '</article></div>';
    return;
  }

  if (!state.messages.length) {
    el.messageList.innerHTML = '<div class="messages"><article class="message-row assistant">' +
      '<div class="message-avatar">OC</div>' +
      '<div class="message assistant"><div class="message-body"><pre>No messages yet. Start chatting below and I’ll pick up the current session instantly.</pre></div></div>' +
      '</article></div>';
    return;
  }

  const items = state.messages.map((entry) => {
    const role = entry.info && entry.info.role ? entry.info.role : 'assistant';
    const text = extractText(entry.parts || []);
    const time = formatMessageTime(entry.info.time && (entry.info.time.completed || entry.info.time.created));
    const icon = role === 'user' ? 'Y' : role === 'assistant' ? 'OC' : role.slice(0, 2).toUpperCase();
    return '<article class="message-row ' + escapeHTML(role) + '">' +
      '<div class="message-avatar">' + escapeHTML(icon) + '</div>' +
      '<div class="message ' + escapeHTML(role) + '">' +
        '<div class="message-body"><pre>' + escapeHTML(text) + '</pre></div>' +
        '<span class="message-time">' + escapeHTML(time) + '</span>' +
        renderMessageDetails(entry.parts || []) +
      '</div>' +
      '</article>';
  });
  if (status && status.type === 'busy') {
    items.push('<article class="message-row assistant">' +
      '<div class="message-avatar">OC</div>' +
      '<div class="message assistant">' +
      '<div class="message-body"><div class="typing-dots"><span></span><span></span><span></span></div></div>' +
      '</div>' +
      '</article>');
  }
  el.messageList.innerHTML = '<div class="messages">' + items.join('') + '</div>';
}

function renderPending() {
  const permissions = visiblePermissions();
  const questions = visibleQuestions();
  const total = permissions.length + questions.length;
  el.pendingInlineCount.textContent = String(total);
  el.pendingBadge.textContent = total + ' pending';
  el.pendingPanel.classList.toggle('hidden', total === 0);

  if (!total) {
    el.pendingList.innerHTML = '<div class="empty-state">No pending approvals or questions.</div>';
    return;
  }

  const permissionHTML = permissions.map((item) => {
    const filepath = item.metadata && typeof item.metadata.filepath === 'string' ? item.metadata.filepath : '';
    const command = item.metadata && typeof item.metadata.command === 'string' ? item.metadata.command : '';
    const pattern = item.metadata && typeof item.metadata.pattern === 'string' ? item.metadata.pattern : '';
    return '<article class="pending-item">' +
      '<div class="meta-line"><strong>Permission</strong><span class="badge compact tone-warning">Approval</span></div>' +
      '<div style="margin-top:0.55rem">' + escapeHTML(item.permission || 'permission') + '</div>' +
      (filepath ? '<div class="pair-note">Path: ' + escapeHTML(filepath) + '</div>' : '') +
      (command ? '<div class="pair-note">Command: ' + escapeHTML(command) + '</div>' : '') +
      (pattern ? '<div class="pair-note">Pattern: ' + escapeHTML(pattern) + '</div>' : '') +
      '<div class="pair-note">' + escapeHTML(item.sessionID || 'workspace') + '</div>' +
      '<div class="pair-actions" style="margin-top:0.75rem">' +
        '<button type="button" class="primary compact" data-permission-reply="once" data-permission-id="' + escapeHTML(item.id) + '">Allow once</button>' +
        '<button type="button" class="ghost compact" data-permission-reply="always" data-permission-id="' + escapeHTML(item.id) + '">Always allow</button>' +
        '<button type="button" class="ghost compact reject" data-permission-reply="reject" data-permission-id="' + escapeHTML(item.id) + '">Reject</button>' +
      '</div>' +
      '</article>';
  }).join('');

  const questionHTML = questions.map((item) => {
    return '<article class="pending-item" data-question-id="' + escapeHTML(item.id) + '">' +
      '<div class="meta-line"><strong>Question</strong><span class="badge compact tone-info">Reply</span></div>' +
      '<div class="question-inputs">' +
        item.questions.map((question) => {
          return '<label>' +
            '<div class="pair-note" style="margin-bottom:0.45rem">' + escapeHTML(question.header || question.question || 'Question') + '</div>' +
            '<textarea placeholder="' + escapeHTML(question.question || 'Answer') + '"></textarea>' +
          '</label>';
        }).join('') +
      '</div>' +
      '<div class="pair-actions" style="margin-top:0.75rem">' +
        '<button type="button" class="primary compact" data-question-reply="' + escapeHTML(item.id) + '">Reply</button>' +
        '<button type="button" class="ghost compact reject" data-question-reject="' + escapeHTML(item.id) + '">Reject</button>' +
      '</div>' +
      '</article>';
  }).join('');

  el.pendingList.innerHTML = permissionHTML + questionHTML;
}

function renderLogFilters() {
  const current = el.logService.value;
  el.logService.innerHTML = '<option value="">All services</option>' +
    state.services.map((service) => '<option value="' + escapeHTML(service) + '">' + escapeHTML(service) + '</option>').join('');
  el.logService.value = current;
}

function renderLogs() {
  el.logCount.textContent = state.logs.length + (state.logs.length === 1 ? ' entry' : ' entries');
  if (!state.logs.length) {
    el.logList.innerHTML = '<div class="empty-state">Waiting for live logs.</div>';
    return;
  }

  el.logList.innerHTML = state.logs.map((entry) => {
    const tone = entry.level === 'ERROR' ? 'tone-error' : entry.level === 'WARN' ? 'tone-warning' : entry.level === 'INFO' ? 'tone-info' : '';
    const extra = entry.extra ? '<div class="log-extra"><pre>' + escapeHTML(formatStructured(entry.extra)) + '</pre></div>' : '';
    return '<article class="log-item level-' + escapeHTML(entry.level) + '">' +
      '<span class="log-dot"></span>' +
      '<div style="flex:1;min-width:0">' +
        '<div class="log-meta">' +
          '<div class="inline-actions">' +
          '<span class="badge compact ' + tone + '">' + escapeHTML(entry.level) + '</span>' +
          '<span class="badge compact">' + escapeHTML(entry.service) + '</span>' +
          '</div>' +
          '<span class="meta">' + escapeHTML(formatTimestamp(entry.time)) + '</span>' +
        '</div>' +
        '<pre style="margin-top:0.75rem">' + escapeHTML(entry.message) + '</pre>' +
        extra +
      '</div>' +
      '</article>';
  }).join('');
}

function renderPairing() {
  const token = query.get('token') || '';
  const expiresAt = Number(query.get('expiresAt') || 0);
  const hasToken = !!token;
  const pairedDirectory = query.get('directory') || (hasToken ? 'Resolved from secure link' : '—');
  el.pairStatusPill.textContent = hasToken ? 'Paired' : 'Protected';
  el.pairStatusPill.className = 'pill subtle ' + (hasToken ? 'tone-success' : '');
  el.pairCodeValue.textContent = pairCode(token);
  el.directoryMeta.textContent = pairedDirectory;
  el.pairDirectoryNote.textContent = state.currentSessionID
    ? (isSessionLocked() ? 'Locked to session ' : 'Session ') + shorten(state.currentSessionID, 24) + (isSessionLocked() ? '.' : ' is preselected.')
    : 'Workspace home is preselected.';
  el.pairAccessLabel.textContent = hasToken ? 'Temporary token' : 'Server auth';
  el.pairExpiry.textContent = hasToken && expiresAt ? 'Valid until ' + formatTimestamp(expiresAt) : hasToken ? 'Temporary access is active.' : 'Protected by the server auth flow.';
  el.secureLinkInput.value = remotePageURL();
  el.baseLinkInput.value = baseRemoteURL();
  el.tokenPreview.textContent = maskToken(token);
  el.pairSessionNote.textContent = state.currentSessionID
    ? (isSessionLocked() ? 'This link can only control the paired session.' : 'Opens the selected session immediately.')
    : 'Opens the remote workspace home.';
  el.regenerateButton.disabled = !query.get('directory');
  if (!el.pairHint.textContent) {
    el.pairHint.textContent = 'Use the exact pairing URL on the device you want to reconnect later.';
  }
}

function renderConnection() {
  const overall = overallConnection();
  el.connectionPill.className = 'pill ' + connectionTone(overall.kind === 'online' ? 'live' : overall.kind === 'offline' ? 'offline' : 'reconnecting');
  el.connectionDot.className = 'status-dot ' + overall.kind;
  el.connectionLabel.textContent = overall.label;
  el.eventsBadge.className = 'badge compact ' + connectionTone(state.eventsConnection);
  el.logsBadge.className = 'badge compact ' + connectionTone(state.logsConnection);
  el.eventsBadge.textContent = 'Events: ' + connectionLabel(state.eventsConnection);
  el.logsBadge.textContent = 'Logs: ' + connectionLabel(state.logsConnection);
}

function updateHeaderChips() {
  const status = currentSessionStatus();
  el.busyBadge.className = 'pill ' + availabilityTone(status);
  el.busyBadge.textContent = availabilityLabel(status);
  el.contextBadge.textContent = contextBadgeLabel();
  el.costBadge.textContent = costBadgeLabel();
  el.modelBadge.textContent = modelBadgeLabel();
  el.brandModel.textContent = headerModelLabel();
  el.pendingBadge.textContent = pendingCount() + ' pending';
}

function renderAll() {
  el.newSessionButton.classList.toggle('hidden', isSessionLocked());
  el.logScope.disabled = isSessionLocked();
  if (isSessionLocked()) el.logScope.value = 'session';
  renderConnection();
  updateHeaderChips();
  renderPairing();
  renderSessionDetails();
  renderSessions();
  renderMessages();
  renderPending();
  renderLogFilters();
  renderLogs();
  resize();
  updateJumpButtons();
  updateTabBadges();
}

function updateTabBadges() {
  const chat = state.activeTab === "chat" ? 0 : pendingCount() + state.unseenMessages;
  const logs = state.activeTab === "logs" ? 0 : state.unseenLogs;
  el.chatTabBadge.textContent = String(chat);
  el.chatTabBadge.classList.toggle("hidden", chat === 0);
  el.logsTabBadge.textContent = String(logs);
  el.logsTabBadge.classList.toggle("hidden", logs === 0);
}

function updateJumpButtons() {
  const showMessages = state.activeTab === 'chat' && state.unseenMessages > 0 && !isMessageViewportNearBottom();
  const showLogs = state.activeTab === 'logs' && state.unseenLogs > 0 && !isLogViewportNearBottom();
  el.jumpLatest.classList.toggle('hidden', !showMessages);
  el.jumpLogsLatest.classList.toggle('hidden', !showLogs);
  el.jumpLatest.textContent = showMessages ? 'Jump to latest (' + state.unseenMessages + ')' : 'Jump to latest';
  el.jumpLogsLatest.textContent = showLogs ? 'Jump to latest (' + state.unseenLogs + ')' : 'Jump to latest';
}

function isMessageViewportNearBottom() {
  if (!messageViewport) return true;
  if (state.activeTab !== 'chat') return false;
  return messageViewport.scrollHeight - messageViewport.scrollTop - messageViewport.clientHeight < 48;
}

function isLogViewportNearBottom() {
  if (!logViewport) return true;
  if (state.activeTab !== 'logs') return false;
  return logViewport.scrollHeight - logViewport.scrollTop - logViewport.clientHeight < 48;
}

function jumpToLatest() {
  if (!messageViewport) return;
  messageViewport.scrollTop = messageViewport.scrollHeight;
  state.unseenMessages = 0;
  updateJumpButtons();
}

function jumpLogsToLatest() {
  if (!logViewport) return;
  logViewport.scrollTop = logViewport.scrollHeight;
  state.unseenLogs = 0;
  updateJumpButtons();
}

function onMessageScroll() {
  if (isMessageViewportNearBottom()) {
    state.unseenMessages = 0;
    updateJumpButtons();
  }
}

function onLogScroll() {
  if (isLogViewportNearBottom()) {
    state.unseenLogs = 0;
    updateJumpButtons();
  }
}

function ensureSelectedSession() {
  if (isSessionLocked()) {
    const changed = state.currentSessionID !== state.lockedSessionID;
    state.currentSessionID = state.lockedSessionID;
    syncPageURL();
    return changed;
  }
  if (state.currentSessionID && state.sessions.some((session) => session.id === state.currentSessionID)) return false;
  const next = state.sessions[0] && state.sessions[0].id ? state.sessions[0].id : '';
  const changed = next !== state.currentSessionID;
  state.currentSessionID = next;
  syncPageURL();
  return changed;
}

async function loadSessions() {
  const [sessions, sessionStatus] = await Promise.all([
    apiFetch('/session'),
    apiFetch('/session/status'),
  ]);
  state.sessions = (Array.isArray(sessions) ? sessions : [])
    .filter((item) => !item.time || !item.time.archived)
    .sort((a, b) => {
      const aTime = a.time && (a.time.updated || a.time.created) || 0;
      const bTime = b.time && (b.time.updated || b.time.created) || 0;
      return bTime - aTime;
    });
  state.sessionStatus = sessionStatus || {};
  return ensureSelectedSession();
}

async function loadMessages() {
  if (!state.currentSessionID || (isSessionLocked() && !currentSession())) {
    state.messages = [];
    return;
  }
  const payload = await apiFetch('/session/' + state.currentSessionID + '/message', {}, { limit: MESSAGE_LIMIT });
  state.messages = Array.isArray(payload) ? payload : [];
}

async function loadPending() {
  const [permissions, questions] = await Promise.all([
    apiFetch('/permission'),
    apiFetch('/question'),
  ]);
  state.permissions = Array.isArray(permissions) ? permissions : [];
  state.questions = Array.isArray(questions) ? questions : [];
}

function activeLogSessionID() {
  return el.logScope.value === 'session' && state.currentSessionID ? state.currentSessionID : undefined;
}

function mergeServices(entries) {
  const combined = new Set(state.services);
  (entries || []).forEach((entry) => {
    if (entry && entry.service) combined.add(entry.service);
  });
  state.services = Array.from(combined).sort((a, b) => a.localeCompare(b));
}

async function loadLogsSnapshot() {
  const payload = await apiFetch('/log', {}, {
    limit: LOG_LIMIT,
    service: el.logService.value || undefined,
    level: el.logLevel.value || undefined,
    sessionID: activeLogSessionID(),
  });
  state.logs = Array.isArray(payload) ? payload.slice(-LOG_LIMIT) : [];
  mergeServices(state.logs);
}

function appendLogEntry(entry) {
  if (!entry || !entry.id) return;
  if (state.logs.some((item) => item.id === entry.id)) return;
  state.logs = state.logs.concat([entry]).slice(-LOG_LIMIT);
  mergeServices([entry]);
  if (!isLogViewportNearBottom()) {
    state.unseenLogs += 1;
  }
  renderLogs();
  renderLogFilters();
  if (isLogViewportNearBottom()) {
    requestAnimationFrame(() => jumpLogsToLatest());
  } else {
    updateJumpButtons();
  }
}

async function refreshSnapshot(includeLogs) {
  const previousMessageSignature = state.messages.map((entry) => {
    const completed = entry.info && entry.info.time && entry.info.time.completed ? entry.info.time.completed : 0;
    const created = entry.info && entry.info.time ? entry.info.time.created : 0;
    const id = entry.info && entry.info.id ? entry.info.id : 'message';
    return id + ':' + created + ':' + completed + ':' + (entry.parts || []).length;
  }).join('|');
  const previousSessionID = state.currentSessionID;

  try {
    const selectionChanged = await loadSessions();
    await Promise.all([
      loadMessages(),
      loadPending(),
      includeLogs ? loadLogsSnapshot() : Promise.resolve(),
    ]);
    renderAll();

    const nextSignature = state.messages.map((entry) => {
      const completed = entry.info && entry.info.time && entry.info.time.completed ? entry.info.time.completed : 0;
      const created = entry.info && entry.info.time ? entry.info.time.created : 0;
      const id = entry.info && entry.info.id ? entry.info.id : 'message';
      return id + ':' + created + ':' + completed + ':' + (entry.parts || []).length;
    }).join('|');

    if (selectionChanged || previousSessionID !== state.currentSessionID) {
      state.unseenMessages = 0;
      requestAnimationFrame(() => jumpToLatest());
      if (el.logScope.value === 'session') restartLogStream();
      return;
    }

    if (nextSignature !== previousMessageSignature) {
      if (isMessageViewportNearBottom()) {
        requestAnimationFrame(() => jumpToLatest());
      } else {
        state.unseenMessages += 1;
        updateJumpButtons();
      }
    }
  } catch (error) {
    el.remoteMeta.textContent = error && error.message ? error.message : 'Refresh failed';
    throw error;
  }
}

function scheduleSnapshotRefresh() {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = undefined;
    refreshSnapshot(false).catch(() => {});
  }, 140);
}

function stopEventPoll() {
  if (!eventPollTimer) return;
  clearTimeout(eventPollTimer);
  eventPollTimer = undefined;
}

function stopEventConnect() {
  if (!eventConnectTimer) return;
  clearTimeout(eventConnectTimer);
  eventConnectTimer = undefined;
}

function startEventPoll(delay) {
  if (eventPollTimer) return;
  eventPollTimer = setTimeout(async () => {
    eventPollTimer = undefined;
    if (state.eventsConnection === 'live') return;
    try {
      await refreshSnapshot(false);
      if (state.eventsConnection !== 'live') {
        state.eventsConnection = 'polling';
        renderConnection();
      }
      startEventPoll(2000);
    } catch {
      if (state.eventsConnection !== 'live' && state.eventsConnection !== 'offline') {
        state.eventsConnection = 'reconnecting';
        renderConnection();
      }
      startEventPoll(3000);
    }
  }, delay || 0);
}

function stopLogPoll() {
  if (!logPollTimer) return;
  clearTimeout(logPollTimer);
  logPollTimer = undefined;
}

function stopLogConnect() {
  if (!logConnectTimer) return;
  clearTimeout(logConnectTimer);
  logConnectTimer = undefined;
}

function startLogPoll(delay) {
  if (logPollTimer) return;
  logPollTimer = setTimeout(async () => {
    logPollTimer = undefined;
    if (state.logsConnection === 'live') return;
    try {
      await loadLogsSnapshot();
      renderAll();
      if (state.logsConnection !== 'live') {
        state.logsConnection = 'polling';
        renderConnection();
      }
      startLogPoll(2000);
    } catch {
      if (state.logsConnection !== 'live' && state.logsConnection !== 'offline') {
        state.logsConnection = 'reconnecting';
        renderConnection();
      }
      startLogPoll(3000);
    }
  }, delay || 0);
}

async function createSession() {
  if (isSessionLocked()) {
    el.pairHint.textContent = 'This pairing link is locked to a single session. Generate a new link from Open Code Commander to control another one.';
    return;
  }
  const created = await apiFetch('/session', {
    method: 'POST',
    body: JSON.stringify({ title: 'Standalone remote ' + new Date().toLocaleTimeString() }),
  });
  if (created && created.id) {
    state.currentSessionID = created.id;
    syncPageURL();
  }
  await refreshSnapshot(el.logScope.value === 'session');
  setActiveTab('chat');
  requestAnimationFrame(() => jumpToLatest());
}

async function selectSession(sessionID) {
  if (isSessionLocked()) return;
  if (!sessionID || sessionID === state.currentSessionID) return;
  state.currentSessionID = sessionID;
  syncPageURL();
  state.unseenMessages = 0;
  await Promise.all([
    loadMessages(),
    loadPending(),
    el.logScope.value === 'session' ? loadLogsSnapshot() : Promise.resolve(),
  ]);
  renderAll();
  if (el.logScope.value === 'session') restartLogStream();
  setActiveTab('chat');
  requestAnimationFrame(() => jumpToLatest());
}

async function runLocal(name) {
  if (name === 'new') return void await createSession();
  if (name === 'chat') return void setActiveTab('chat');
  if (name === 'pairing') return void setActiveTab('pair');
  if (name === 'sessions') return void setActiveTab('sessions');
  if (name === 'logs') return void setActiveTab('logs');
}

async function sendCommand(text) {
  const match = text.match(/^\/([^\s]+)(?:\s+(.*))?$/);
  if (!match) throw new Error('Invalid command');
  const name = match[1].toLowerCase();
  const args = (match[2] || '').trim();
  const local = builtins().find((item) => item.name === name);
  if (local) {
    await runLocal(name);
    return;
  }
  const cmd = state.commands.find((item) => item.name.toLowerCase() === name);
  if (!cmd) throw new Error('Unknown command: /' + name);
  if (!state.currentSessionID) await createSession();
  if (!state.currentSessionID) return;
  await apiFetch('/session/' + state.currentSessionID + '/command', {
    method: 'POST',
    body: JSON.stringify({
      command: cmd.name,
      arguments: args,
      parts: state.attachments.length ? parts('').filter((item) => item.type === 'file') : undefined,
    }),
  }, undefined, PROMPT_TIMEOUT);
}

async function sendPrompt() {
  const text = el.promptInput.value.trim();
  if (!text && state.attachments.length === 0) return;
  setActiveTab('chat');
  el.sendButton.disabled = true;
  el.promptHint.textContent = 'Sending prompt…';
  try {
    if (text.startsWith('/')) {
      await sendCommand(text);
    } else {
      if (!state.currentSessionID) await createSession();
      if (isSessionLocked() && !currentSession()) {
        el.promptHint.textContent = 'The paired session is unavailable. Generate a fresh remote link from Open Code Commander.';
        return;
      }
      if (!state.currentSessionID) return;
      await apiFetch('/session/' + state.currentSessionID + '/prompt_async', {
        method: 'POST',
        body: JSON.stringify({ parts: parts(text) }),
      }, undefined, PROMPT_TIMEOUT);
    }
    clearComposer();
    el.promptHint.textContent = 'Prompt sent.';
    if (state.eventsConnection !== 'live') startEventPoll(250);
    if (state.logsConnection !== 'live') startLogPoll(500);
    scheduleSnapshotRefresh();
  } catch (error) {
    if (error && error.message === 'Request timed out') {
      el.promptHint.textContent = 'Prompt request timed out; checking the session…';
      if (state.eventsConnection !== 'live') startEventPoll(0);
      if (state.logsConnection !== 'live') startLogPoll(250);
      scheduleSnapshotRefresh();
      return;
    }
    el.promptHint.textContent = error && error.message ? error.message : 'Prompt failed.';
  } finally {
    el.sendButton.disabled = false;
  }
}

async function replyPermission(requestID, reply) {
  await apiFetch('/permission/' + requestID + '/reply', {
    method: 'POST',
    body: JSON.stringify({ reply: reply }),
  });
  await refreshSnapshot(false);
}

async function replyQuestion(requestID) {
  const root = document.querySelector('[data-question-id="' + requestID + '"]');
  if (!root) return;
  const answers = Array.from(root.querySelectorAll('textarea')).map((input) => {
    const value = input.value.trim();
    return value ? [value] : [];
  });
  if (answers.some((answer) => answer.length === 0)) {
    el.pairHint.textContent = 'Answer every question before submitting.';
    return;
  }
  await apiFetch('/question/' + requestID + '/reply', {
    method: 'POST',
    body: JSON.stringify({ answers: answers }),
  });
  await refreshSnapshot(false);
}

async function rejectQuestion(requestID) {
  await apiFetch('/question/' + requestID + '/reject', { method: 'POST' });
  await refreshSnapshot(false);
}

async function copyText(value, success, failure) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    el.pairHint.textContent = success;
  } catch {
    el.pairHint.textContent = failure;
  }
}

async function copyCurrentLink() {
  await copyText(remotePageURL(), 'Secure link copied.', 'Could not copy the secure link.');
}

async function copyBaseLink() {
  await copyText(baseRemoteURL(), 'Base URL copied.', 'Could not copy the base URL.');
}

async function copyCurrentCode() {
  await copyText(pairCode(query.get('token') || ''), 'Pairing code copied.', 'Could not copy the pairing code.');
}

function openCurrentLink() {
  window.open(remotePageURL(), '_blank', 'noopener,noreferrer');
}

async function regenerateLink() {
  const directory = query.get('directory');
  if (!directory) {
    el.pairHint.textContent = 'This remote link has no workspace scope to regenerate. Create a new one from Open Code Commander.';
    return;
  }
  const payload = await apiFetch('/remote/pair', {
    method: 'POST',
    body: JSON.stringify({
      directory: directory,
      sessionID: state.currentSessionID || query.get('sessionID') || undefined,
    }),
  });
  if (!payload || !payload.url) {
    el.pairHint.textContent = 'Could not regenerate the secure link.';
    return;
  }
  window.location.href = payload.url;
}

function connectEvents() {
  if (typeof EventSource === 'undefined') {
    state.eventsConnection = 'reconnecting';
    renderConnection();
    startEventPoll(0);
    return;
  }
  if (eventStream) eventStream.close();
  stopEventPoll();
  stopEventConnect();
  state.eventsConnection = 'connecting';
  renderConnection();
  eventStream = new EventSource(apiURL('/event'));
  eventConnectTimer = setTimeout(() => {
    eventConnectTimer = undefined;
    if (state.eventsConnection !== 'connecting') return;
    state.eventsConnection = 'reconnecting';
    renderConnection();
    startEventPoll(0);
  }, CONNECT_TIMEOUT);

  eventStream.onopen = () => {
    stopEventConnect();
    stopEventPoll();
    state.eventsConnection = 'live';
    renderConnection();
  };

  eventStream.onerror = () => {
    stopEventConnect();
    state.eventsConnection = eventStream && eventStream.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting';
    renderConnection();
    startEventPoll(0);
  };

  eventStream.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data || '{}');
      if (!payload || typeof payload.type !== 'string') return;
      if (payload.type === 'server.connected' || payload.type === 'server.heartbeat') return;
      if (
        payload.type.startsWith('session.') ||
        payload.type.startsWith('message.') ||
        payload.type.startsWith('permission.') ||
        payload.type.startsWith('question.')
      ) {
        scheduleSnapshotRefresh();
      }
    } catch {}
  };
}

function stopLogStream() {
  logReconnectGeneration += 1;
  if (logReconnectTimer) {
    clearTimeout(logReconnectTimer);
    logReconnectTimer = undefined;
  }
  stopLogPoll();
  stopLogConnect();
  if (logSocket && logSocket.readyState !== WebSocket.CLOSED && logSocket.readyState !== WebSocket.CLOSING) {
    logSocket.close(1000);
  }
  logSocket = undefined;
}

function startLogStream() {
  if (typeof WebSocket === 'undefined') {
    state.logsConnection = 'reconnecting';
    renderConnection();
    startLogPoll(0);
    return;
  }
  const url = socketURL('/log/connect', {
    service: el.logService.value || undefined,
    level: el.logLevel.value || undefined,
    sessionID: activeLogSessionID(),
  });
  const generation = ++logReconnectGeneration;
  state.logsConnection = logReconnectAttempts > 0 ? 'reconnecting' : 'connecting';
  renderConnection();
  logSocket = new WebSocket(url);
  logConnectTimer = setTimeout(() => {
    logConnectTimer = undefined;
    if (generation !== logReconnectGeneration || state.logsConnection !== 'connecting') return;
    state.logsConnection = 'reconnecting';
    renderConnection();
    startLogPoll(0);
  }, CONNECT_TIMEOUT);

  logSocket.addEventListener('open', () => {
    if (generation !== logReconnectGeneration) return;
    stopLogConnect();
    stopLogPoll();
    logReconnectAttempts = 0;
    state.logsConnection = 'live';
    renderConnection();
  });

  logSocket.addEventListener('message', (event) => {
    if (generation !== logReconnectGeneration) return;
    try {
      const payload = JSON.parse(typeof event.data === 'string' ? event.data : '{}');
      appendLogEntry(payload);
    } catch {}
  });

  logSocket.addEventListener('error', () => {
    if (generation !== logReconnectGeneration) return;
    stopLogConnect();
    state.logsConnection = 'reconnecting';
    renderConnection();
    startLogPoll(0);
  });

  logSocket.addEventListener('close', (event) => {
    if (generation !== logReconnectGeneration) return;
    stopLogConnect();
    logSocket = undefined;
    if (event.code === 1000) {
      state.logsConnection = 'offline';
      renderConnection();
      return;
    }
    logReconnectAttempts += 1;
    state.logsConnection = 'reconnecting';
    renderConnection();
    startLogPoll(0);
    if (logReconnectTimer) clearTimeout(logReconnectTimer);
    logReconnectTimer = setTimeout(() => {
      logReconnectTimer = undefined;
      startLogStream();
    }, Math.min(1000 * logReconnectAttempts, 4000));
  });
}

function restartLogStream() {
  stopLogStream();
  loadLogsSnapshot().then(renderAll).catch(() => {}).finally(() => startLogStream());
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.tab) {
    setActiveTab(target.dataset.tab);
    return;
  }
  if (target.dataset.sessionId) {
    selectSession(target.dataset.sessionId).catch(() => {});
    return;
  }
  if (target.dataset.commandSelect) {
    choose(target.dataset.commandSelect);
    return;
  }
  if (target.dataset.attachmentRemove) {
    state.attachments.splice(Number(target.dataset.attachmentRemove), 1);
    renderAttachments();
    return;
  }
  if (target.id === 'attach-button') {
    el.attachInput.click();
    return;
  }
  if (target.id === 'new-session-button') return void createSession().catch(() => {});
  if (target.id === 'refresh-button') return void refreshSnapshot(true).catch(() => {});
  if (target.id === 'jump-latest') return void jumpToLatest();
  if (target.id === 'copy-link-button') return void copyCurrentLink();
  if (target.id === 'copy-base-button') return void copyBaseLink();
  if (target.id === 'copy-code-button') return void copyCurrentCode();
  if (target.id === 'open-link-button') return void openCurrentLink();
  if (target.id === 'regenerate-button') return void regenerateLink().catch(() => {});
  if (target.id === 'refresh-logs-button') return void loadLogsSnapshot().then(renderAll).catch(() => {});
  if (target.id === 'jump-logs-latest') return void jumpLogsToLatest();
  if (target.dataset.permissionReply) {
    return void replyPermission(target.dataset.permissionId, target.dataset.permissionReply).catch(() => {});
  }
  if (target.dataset.questionReply) return void replyQuestion(target.dataset.questionReply).catch(() => {});
  if (target.dataset.questionReject) return void rejectQuestion(target.dataset.questionReject).catch(() => {});
});

el.promptForm.addEventListener('submit', (event) => {
  event.preventDefault();
  sendPrompt().catch(() => {});
});

el.promptInput.addEventListener('input', () => {
  state.commandIndex = 0;
  resize();
  renderCommands();
});

el.promptInput.addEventListener('click', () => renderCommands());

el.promptInput.addEventListener('keydown', (event) => {
  const list = shown();
  if (list.length && slash() !== undefined) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      state.commandIndex = (state.commandIndex + 1) % list.length;
      renderCommands();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      state.commandIndex = (state.commandIndex - 1 + list.length) % list.length;
      renderCommands();
      return;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
      event.preventDefault();
      choose(list[state.commandIndex].name);
      return;
    }
    if (event.key === 'Escape') {
      el.commandMenu.classList.add('hidden');
      state.commandIndex = 0;
      return;
    }
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendPrompt().catch(() => {});
  }
});

el.promptInput.addEventListener('paste', (event) => {
  const files = Array.from(event.clipboardData?.files || []);
  if (!files.length) return;
  event.preventDefault();
  add(files).catch(() => {});
});

el.attachInput.addEventListener('change', () => {
  add(el.attachInput.files).catch(() => {});
});

el.logScope.addEventListener('change', () => {
  if (isSessionLocked()) {
    el.logScope.value = 'session';
  }
  if (!state.currentSessionID && el.logScope.value === 'session') {
    el.logScope.value = 'workspace';
  }
  restartLogStream();
});
el.logService.addEventListener('change', () => restartLogStream());
el.logLevel.addEventListener('change', () => restartLogStream());
el.messageList.addEventListener('scroll', onMessageScroll);
el.logList.addEventListener('scroll', onLogScroll);

document.addEventListener('focusin', (event) => {
  sync();
  if (editable(event.target)) reveal(event.target);
});
document.addEventListener('focusout', () => {
  setTimeout(sync, 40);
});
window.addEventListener('resize', sync);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', sync);
  window.visualViewport.addEventListener('scroll', sync);
}

window.addEventListener('beforeunload', () => {
  if (eventStream) eventStream.close();
  stopLogStream();
  stopEventPoll();
  stopEventConnect();
  if (snapshotTimer) clearTimeout(snapshotTimer);
});

hydrateTab();
sync();
resize();
setActiveTab(state.activeTab, false);
renderAttachments();
loadCommands().catch(() => {});
renderAll();
refreshSnapshot(true).catch(() => {});
connectEvents();
restartLogStream();
`

export const RemoteRoutes = lazy(() =>
  new Hono()
    .get("/", (c) => {
      if (c.req.query("app") === "1") {
        c.header("Content-Type", "application/javascript; charset=utf-8")
        c.header("Cache-Control", "private, no-store")
        return c.body(script)
      }
      c.header(
        "Content-Security-Policy",
        "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      )
      c.header("Referrer-Policy", "no-referrer")
      c.header("Cache-Control", "private, no-store")
      return c.html(renderHTML(c.req.url))
    })
    .post(
      "/pair",
      describeRoute({
        summary: "Create a temporary standalone remote link",
        description: "Create an ephemeral pairing token for the standalone remote page.",
        operationId: "remote.pair",
        responses: {
          200: {
            description: "Temporary remote pairing created",
            content: {
              "application/json": {
                schema: resolver(PairResponse),
              },
            },
          },
        },
      }),
      validator("json", PairBody),
      async (c) => {
        const body = c.req.valid("json")
        const token = RemoteAuth.verifyRequest(c.req.raw)
        if (token && !RemoteAuth.matchesScope(token, body)) {
          throw new RemoteAuth.ScopeError({ message: "Remote token cannot change workspace or session scope" })
        }
        const info = RemoteAuth.create({
          directory: body.directory,
          sessionID: body.sessionID,
          ttlSeconds: body.ttlSeconds,
        })
        const url = buildRemoteURL(buildRemoteBaseURL(c.req.url).toString(), info)
        c.header("Cache-Control", "private, no-store")
        return c.json({
          token: info.token,
          expiresAt: info.expiresAt,
          directory: info.directory,
          sessionID: info.sessionID,
          url,
        })
      },
    )
    .get("/app.js", (c) => {
      c.header("Content-Type", "application/javascript; charset=utf-8")
      c.header("Cache-Control", "private, no-store")
      return c.body(script)
    }),
)
