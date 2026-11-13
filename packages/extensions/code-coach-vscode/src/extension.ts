import * as vscode from "vscode";
import { type Finding, decide } from "./triage";

/**
 * Code Coach extension entry point.
 *
 * The coach is a silent side-panel that watches edits and nudges. It never
 * blocks the editor, never changes what you typed, and never sends anything.
 *
 * Breaks the input into a debounced save queue, scores each saved change with
 * the triage engine, and shows the card when there is something worth saying.
 * Silence is the default.
 */

const DEBOUNCE_MS = 900;
const MAX_RESULTS = 2;

/** Last N saved revisions, in order. */
class Ring {
  items: string[] = [];

  push(text: string) {
    this.items.push(text);
    if (this.items.length > MAX_REVISIONS) {
      this.items.shift();
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  const ring = new Ring();
  const panel = vscode.window.createWebviewPanel(
    "codeCoach.card",
    "Code Coach",
    { preserveFocus: true, viewColumn: vscode.ViewColumn.Beside }
  );

  let timer: NodeJS.Timeout | undefined;

  function show(nudges: Finding[]) {
    if (!nudges.length) {
      panel.dispose();
      return;
    }
    panel.webview.html = renderCard(nudges);
  }

  // A save that lands during the debounce just extends the window, so only the
  // latest revision matters. Everything before it is ignored.
  const onSave = (text: string) => {
    ring.push(text);
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      const texts = ring.items;
      const findings: Finding[] = [];
      for (const text of texts) {
        const result = decide(text, text, []);
        if (result.kind === "nudge") {
          for (const f of result.findings) {
            if (!findings.some((x) => x.id === f.id)) {
              findings.push(f);
            }
          }
        }
      }
      show(findings.slice(0, MAX_RESULTS));
    }, DEBOUNCE_MS);
  };

  const disposable = vscode.workspace.onDidSave((event) => {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === event.document.uri.fsPath);
    if (doc) {
      onSave(doc.getText());
    }
  });

  context.subscriptions.push(disposable);

  // Pre-heat the panel so it is visible even before the first save.
  panel.webview.html = renderCard([]);
}

function renderCard(nudges: Finding[]): string {
  const actions = nudges.length
    ? `<div class="actions">
        <button id="explain">Explain why</button>
        <button id="fix">Fix my prompt</button>
        <button id="ignore">Ignore</button>
      </div>`
    : `<p class="empty">No edits flagged yet.</p>`;
  const list = nudges.map((f) => `
    <div class="finding">
      <h2>${escapeHtml(f.title)}</h2>
      <p>${escapeHtml(f.why)}</p>
      <p class="fix"><strong>Fix:</strong> ${escapeHtml(f.fix)}</p>
    </div>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  body { font-family: var(--vscode-font-family); margin: 0; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
  .card { max-width: 640px; margin: 24px auto; padding: 20px; border: 1px solid var(--vscode-focusBorder); border-radius: 8px; background: var(--vscode-editorWidget-background); }
  h1 { margin: 0 0 8px; font-size: 16px; }
  p { margin: 8px 0; line-height: 1.45; }
  .empty { color: var(--vscode-descriptionForeground); }
  .actions { display: flex; gap: 8px; margin-top: 16px; }
  button { padding: 6px 12px; cursor: pointer; }
  .finding { border-top: 1px solid var(--vscode-widget-border); padding-top: 12px; margin-top: 12px; }
  .finding h2 { margin: 0 0 4px; font-size: 14px; }
  .fix { margin-top: 6px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Code Coach</h1>
    <p>Keeping your edits safe.</p>
    ${list}
    ${actions}
  </div>
  <script>
    (() => {
      const post = (command: string) => {
        vscode.postMessage({ command });
      };
      document.getElementById("explain")?.addEventListener("click", () => post("explain"));
      document.getElementById("fix")?.addEventListener("click", () => post("fix"));
      document.getElementById("ignore")?.addEventListener("click", () => post("ignore"));
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch;
  });
}
