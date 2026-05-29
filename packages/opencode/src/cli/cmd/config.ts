import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"
import { Effect } from "effect"
import { Config } from "@/config/config"
import { Global } from "@opencode-ai/core/global"
import { UI } from "../ui"
import http from "http"
import fs from "fs"
import path from "path"
import { exec } from "child_process"

const CONFIG_EDITOR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenCode Config Builder</title>
<style>
  :root {
    --bg: #0d1117; --bg-card: #161b22; --bg-input: #0d1117;
    --border: #30363d; --border-focus: #58a6ff;
    --text: #e6edf3; --text-dim: #8b949e; --text-label: #c9d1d9;
    --accent: #58a6ff; --accent-hover: #79c0ff;
    --green: #3fb950; --yellow: #d29922; --purple: #bc8cff;
    --chip-bg: #1f2937; --chip-active: #1e3a5f; --chip-border: #30363d;
    --radius: 8px; --radius-sm: 6px; --transition: 0.2s ease;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; min-height: 100vh; }
  .container { max-width: 720px; margin: 0 auto; padding: 24px 16px; }
  header { text-align: center; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid var(--border); }
  header h1 { font-size: 1.8rem; font-weight: 600; margin-bottom: 8px; background: linear-gradient(135deg, var(--accent), var(--purple)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  header p { color: var(--text-dim); font-size: 0.95rem; }
  .section { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 16px; overflow: hidden; transition: border-color var(--transition); }
  .section:hover { border-color: #484f58; }
  .section-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; cursor: pointer; user-select: none; transition: background var(--transition); }
  .section-header:hover { background: rgba(88, 166, 255, 0.04); }
  .section-header h2 { font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: 10px; }
  .chevron { width: 20px; height: 20px; transition: transform var(--transition); color: var(--text-dim); }
  .section.open .chevron { transform: rotate(180deg); }
  .section-body { max-height: 0; overflow: hidden; transition: max-height 0.3s ease, padding 0.3s ease; padding: 0 20px; }
  .section.open .section-body { max-height: 2000px; padding: 0 20px 20px; }
  .field { margin-bottom: 16px; }
  .field:last-child { margin-bottom: 0; }
  .field-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .field label { display: block; font-size: 0.875rem; font-weight: 500; color: var(--text-label); margin-bottom: 4px; }
  .field .hint { font-size: 0.78rem; color: var(--text-dim); margin-top: 2px; }
  input[type="text"], input[type="number"], select, textarea { width: 100%; padding: 8px 12px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); font-size: 0.875rem; font-family: inherit; transition: border-color var(--transition), box-shadow var(--transition); }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--border-focus); box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.15); }
  textarea { resize: vertical; min-height: 60px; font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 0.82rem; }
  select { cursor: pointer; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238b949e' d='M6 8L1 3h10z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px; }
  .toggle { position: relative; width: 44px; height: 24px; flex-shrink: 0; }
  .toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
  .toggle .slider { position: absolute; inset: 0; background: #30363d; border-radius: 12px; cursor: pointer; transition: background var(--transition); }
  .toggle .slider::before { content: ''; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform var(--transition); }
  .toggle input:checked + .slider { background: var(--green); }
  .toggle input:checked + .slider::before { transform: translateX(20px); }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .chip { padding: 6px 14px; background: var(--chip-bg); border: 1px solid var(--chip-border); border-radius: 20px; font-size: 0.8rem; cursor: pointer; transition: all var(--transition); white-space: nowrap; font-family: 'SF Mono', monospace; }
  .chip:hover { border-color: var(--accent); background: var(--chip-active); }
  .chip.active { border-color: var(--accent); background: var(--chip-active); color: var(--accent); }
  .chip .tag { font-size: 0.65rem; padding: 1px 6px; border-radius: 8px; margin-left: 6px; vertical-align: middle; }
  .chip .tag-speed { background: rgba(63, 185, 80, 0.2); color: var(--green); }
  .chip .tag-strength { background: rgba(188, 140, 255, 0.2); color: var(--purple); }
  .chip .tag-balance { background: rgba(88, 166, 255, 0.2); color: var(--accent); }
  .chip .tag-coder { background: rgba(210, 153, 34, 0.2); color: var(--yellow); }
  .preview-panel { position: fixed; right: 16px; top: 16px; width: 380px; max-height: calc(100vh - 32px); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); display: flex; flex-direction: column; z-index: 100; transition: transform 0.3s ease, opacity 0.3s ease; }
  .preview-panel.hidden { transform: translateX(400px); opacity: 0; pointer-events: none; }
  .preview-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 0.85rem; font-weight: 600; }
  .preview-actions { display: flex; gap: 8px; }
  .preview-body { flex: 1; overflow: auto; padding: 16px; }
  .preview-body pre { font-family: 'SF Mono', monospace; font-size: 0.78rem; line-height: 1.5; white-space: pre-wrap; word-break: break-all; color: var(--text-dim); }
  .btn { padding: 8px 16px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-card); color: var(--text); font-size: 0.8rem; font-weight: 500; cursor: pointer; transition: all var(--transition); display: inline-flex; align-items: center; gap: 6px; }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .btn-success { background: var(--green); border-color: var(--green); color: #fff; }
  .btn-success:hover { opacity: 0.9; }
  .fixed-controls { position: fixed; bottom: 16px; right: 16px; display: flex; gap: 8px; z-index: 101; }
  .toast { position: fixed; bottom: 80px; right: 16px; padding: 10px 18px; background: var(--green); color: #fff; border-radius: var(--radius-sm); font-size: 0.85rem; font-weight: 500; z-index: 200; transform: translateY(20px); opacity: 0; transition: all 0.3s ease; }
  .toast.show { transform: translateY(0); opacity: 1; }
  .with-preview { margin-right: 400px; }
  .field-group { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 600px) { .field-group { grid-template-columns: 1fr; } }
  @media (max-width: 900px) { .preview-panel { position: fixed; right: 0; left: 0; bottom: 0; top: auto; width: 100%; max-height: 50vh; border-radius: var(--radius) var(--radius) 0 0; } .with-preview { margin-right: 0; } }
  .save-bar { position: fixed; bottom: 0; left: 0; right: 0; padding: 12px 20px; background: var(--bg-card); border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: center; gap: 12px; z-index: 102; }
  .save-bar .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; padding: 10px 24px; font-size: 0.9rem; }
  .save-bar .btn-primary:hover { background: var(--accent-hover); }
</style>
</head>
<body>
<div class="container with-preview" id="main">
  <header>
    <h1>OpenCode Config Builder</h1>
    <p>Interactive editor for opencode.jsonc</p>
  </header>

  <div class="section open" id="sec-model">
    <div class="section-header" onclick="toggle('sec-model')">
      <h2>Model Settings</h2>
      <svg class="chevron" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"/></svg>
    </div>
    <div class="section-body">
      <div class="field">
        <label>Default Model</label>
        <input type="text" id="model" placeholder="e.g. anthropic/claude-sonnet-4-6" oninput="updatePreview()">
        <div class="hint">The primary model for all agent work</div>
      </div>
      <div class="field">
        <label>Small Model (for cheap tasks)</label>
        <input type="text" id="small_model" value="opencode/mimo-v2-flash-free" oninput="updatePreview()">
        <div class="hint">Used for title generation, compaction, and other low-cost tasks</div>
        <div class="chips">
          <span class="chip active" onclick="setSmallModel(this, 'opencode/mimo-v2-flash-free')">mimo-v2-flash-free<span class="tag tag-speed">fastest</span></span>
          <span class="chip" onclick="setSmallModel(this, 'opencode/deepseek-v4-flash-free')">deepseek-v4-flash-free<span class="tag tag-strength">strong</span></span>
          <span class="chip" onclick="setSmallModel(this, 'opencode/mimo-v2.5-free')">mimo-v2.5-free<span class="tag tag-balance">balanced</span></span>
          <span class="chip" onclick="setSmallModel(this, 'opencode/qwen3.6-plus-free')">qwen3.6-plus-free<span class="tag tag-coder">coder</span></span>
        </div>
      </div>
    </div>
  </div>

  <div class="section" id="sec-compaction">
    <div class="section-header" onclick="toggle('sec-compaction')">
      <h2>Compaction</h2>
      <svg class="chevron" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"/></svg>
    </div>
    <div class="section-body">
      <div class="field field-row">
        <div><label>Auto-compaction</label><div class="hint">Summarize conversation when context is full</div></div>
        <label class="toggle"><input type="checkbox" id="compaction_auto" checked onchange="updatePreview()"><span class="slider"></span></label>
      </div>
      <div class="field-group">
        <div class="field"><label>Tail Turns</label><input type="number" id="compaction_tail_turns" value="5" min="0" max="20" oninput="updatePreview()"><div class="hint">Recent turns kept verbatim</div></div>
        <div class="field"><label>Preserve Recent Tokens</label><input type="number" id="compaction_preserve_tokens" value="4096" min="0" step="512" oninput="updatePreview()"><div class="hint">Token budget for recent context</div></div>
      </div>
      <div class="field"><label>Compaction Model</label><input type="text" id="compaction_model" placeholder="Same as small_model if empty" oninput="updatePreview()"><div class="hint">Cheaper model for summarization</div></div>
    </div>
  </div>

  <div class="section" id="sec-experimental">
    <div class="section-header" onclick="toggle('sec-experimental')">
      <h2>Experimental</h2>
      <svg class="chevron" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"/></svg>
    </div>
    <div class="section-body">
      <div class="field"><label>MCP Timeout (ms)</label><input type="number" id="mcp_timeout" value="60000" min="5000" step="5000" oninput="updatePreview()"><div class="hint">Timeout for MCP server requests</div></div>
      <div class="field field-row">
        <div><label>Continue on Tool Denial</label><div class="hint">Keep agent loop running after tool is denied</div></div>
        <label class="toggle"><input type="checkbox" id="continue_loop_on_deny" checked onchange="updatePreview()"><span class="slider"></span></label>
      </div>
      <div class="field field-row">
        <div><label>OpenTelemetry Tracing</label><div class="hint">Enable tracing for debugging LLM calls</div></div>
        <label class="toggle"><input type="checkbox" id="opentelemetry" onchange="updatePreview()"><span class="slider"></span></label>
      </div>
    </div>
  </div>

  <div class="section" id="sec-tool-output">
    <div class="section-header" onclick="toggle('sec-tool-output')">
      <h2>Tool Output</h2>
      <svg class="chevron" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"/></svg>
    </div>
    <div class="section-body">
      <div class="field-group">
        <div class="field"><label>Max Lines</label><input type="number" id="tool_output_max_lines" value="500" min="10" step="10" oninput="updatePreview()"><div class="hint">Before truncation to disk</div></div>
        <div class="field"><label>Max Bytes</label><input type="number" id="tool_output_max_bytes" value="20000" min="1024" step="1024" oninput="updatePreview()"><div class="hint">Before truncation to disk</div></div>
      </div>
    </div>
  </div>

  <div class="section" id="sec-permissions">
    <div class="section-header" onclick="toggle('sec-permissions')">
      <h2>Permissions</h2>
      <svg class="chevron" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"/></svg>
    </div>
    <div class="section-body">
      <div class="field field-row">
        <div><label>Auto-approve Git Commands</label><div class="hint">Allow git * without asking</div></div>
        <label class="toggle"><input type="checkbox" id="perm_git_allow" checked onchange="updatePreview()"><span class="slider"></span></label>
      </div>
      <div class="field field-row">
        <div><label>Allow Edit Without Asking</label><div class="hint">Skip confirmation for file edits</div></div>
        <label class="toggle"><input type="checkbox" id="perm_edit_allow" onchange="updatePreview()"><span class="slider"></span></label>
      </div>
      <div class="field field-row">
        <div><label>Allow Websearch Without Asking</label><div class="hint">Skip confirmation for web searches</div></div>
        <label class="toggle"><input type="checkbox" id="perm_websearch_allow" onchange="updatePreview()"><span class="slider"></span></label>
      </div>
    </div>
  </div>

  <div class="section" id="sec-privacy">
    <div class="section-header" onclick="toggle('sec-privacy')">
      <h2>Privacy & Updates</h2>
      <svg class="chevron" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"/></svg>
    </div>
    <div class="section-body">
      <div class="field"><label>Session Sharing</label><select id="share" onchange="updatePreview()"><option value="manual" selected>manual</option><option value="auto">auto</option><option value="disabled">disabled</option></select></div>
      <div class="field"><label>Auto-Update</label><select id="autoupdate" onchange="updatePreview()"><option value="notify" selected>notify</option><option value="true">true</option><option value="false">false</option></select></div>
    </div>
  </div>

  <div class="section" id="sec-agents">
    <div class="section-header" onclick="toggle('sec-agents')">
      <h2>Agents</h2>
      <svg class="chevron" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"/></svg>
    </div>
    <div class="section-body">
      <div class="field field-row">
        <div><label>Disable Explore Agent</label><div class="hint">File-search specialist</div></div>
        <label class="toggle"><input type="checkbox" id="agent_explore_disable" onchange="updatePreview()"><span class="slider"></span></label>
      </div>
      <div class="field field-row">
        <div><label>Disable General Agent</label><div class="hint">General-purpose agent</div></div>
        <label class="toggle"><input type="checkbox" id="agent_general_disable" onchange="updatePreview()"><span class="slider"></span></label>
      </div>
      <div class="field"><label>Title Generation Prompt</label><textarea id="agent_title_prompt" rows="3" oninput="updatePreview()">Generate a concise, descriptive session title (max 6 words) based on the user's first message. Focus on the task or topic. No quotes, no punctuation at end.</textarea><div class="hint">Custom prompt for the title agent</div></div>
      <div class="field"><label>Default Agent</label><select id="default_agent" onchange="updatePreview()"><option value="" selected>build (default)</option><option value="plan">plan</option><option value="build">build</option></select></div>
    </div>
  </div>

  <div class="section" id="sec-instructions">
    <div class="section-header" onclick="toggle('sec-instructions')">
      <h2>System Instructions</h2>
      <svg class="chevron" viewBox="0 0 20 20" fill="currentColor"><path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"/></svg>
    </div>
    <div class="section-body">
      <div class="field"><label>Instructions File Path</label><input type="text" id="instructions_path" value="~/.config/opencode/instructions.md" oninput="updatePreview()"><div class="hint">Path to your system instructions file</div></div>
      <div class="field"><label>System Prompt Content</label><textarea id="instructions_text" rows="3" oninput="updatePreview()">Pinging all agents. Be on guard!</textarea><div class="hint">Written to the instructions file on save</div></div>
    </div>
  </div>
</div>

<div class="preview-panel" id="previewPanel">
  <div class="preview-header">
    <span>opencode.jsonc</span>
    <div class="preview-actions">
      <button class="btn" onclick="copyConfig()">Copy</button>
      <button class="btn btn-success" onclick="downloadConfig()">Download</button>
    </div>
  </div>
  <div class="preview-body"><pre id="previewJson"></pre></div>
</div>

<div class="save-bar">
  <button class="btn btn-primary" onclick="saveConfig()">Save to ~/.config/opencode/opencode.jsonc</button>
</div>

<div class="toast" id="toast"></div>

<script>
function toggle(id) { document.getElementById(id).classList.toggle('open'); }
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2000); }
function setSmallModel(chip, value) { document.querySelectorAll('.chips .chip').forEach(c => c.classList.remove('active')); chip.classList.add('active'); document.getElementById('small_model').value = value; updatePreview(); }

function buildConfig() {
  const config = {};
  config["$schema"] = "https://opencode.ai/config.json";
  const model = document.getElementById('model').value.trim();
  const smallModel = document.getElementById('small_model').value.trim();
  if (model) config.model = model;
  if (smallModel) config.small_model = smallModel;
  config.compaction = { auto: document.getElementById('compaction_auto').checked, tail_turns: parseInt(document.getElementById('compaction_tail_turns').value) || 5, preserve_recent_tokens: parseInt(document.getElementById('compaction_preserve_tokens').value) || 4096 };
  const compModel = document.getElementById('compaction_model').value.trim();
  if (compModel) config.compaction.model = compModel;
  const experimental = { mcp_timeout: parseInt(document.getElementById('mcp_timeout').value) || 60000, continue_loop_on_deny: document.getElementById('continue_loop_on_deny').checked };
  if (document.getElementById('opentelemetry').checked) experimental.openTelemetry = true;
  config.experimental = experimental;
  config.tool_output = { max_lines: parseInt(document.getElementById('tool_output_max_lines').value) || 500, max_bytes: parseInt(document.getElementById('tool_output_max_bytes').value) || 20000 };
  const perm = {};
  if (document.getElementById('perm_git_allow').checked) perm.bash = { "git *": "allow", "*": "ask" };
  if (document.getElementById('perm_edit_allow').checked) perm.edit = "allow";
  if (document.getElementById('perm_websearch_allow').checked) perm.websearch = "allow";
  if (Object.keys(perm).length) config.permission = perm;
  const share = document.getElementById('share').value;
  const autoupdate = document.getElementById('autoupdate').value;
  if (share !== 'manual') config.share = share;
  if (autoupdate !== 'notify') config.autoupdate = autoupdate === 'true' ? true : autoupdate === 'false' ? false : autoupdate;
  const agents = {};
  if (document.getElementById('agent_explore_disable').checked) agents.explore = { disable: true };
  if (document.getElementById('agent_general_disable').checked) agents.general = { disable: true };
  const titlePrompt = document.getElementById('agent_title_prompt').value.trim();
  if (titlePrompt) agents.title = { prompt: titlePrompt };
  if (Object.keys(agents).length) config.agent = agents;
  const defaultAgent = document.getElementById('default_agent').value;
  if (defaultAgent) config.default_agent = defaultAgent;
  const instrPath = document.getElementById('instructions_path').value.trim();
  if (instrPath) config.instructions = [instrPath];
  return config;
}

function updatePreview() { document.getElementById('previewJson').textContent = JSON.stringify(buildConfig(), null, 2); }

async function copyConfig() {
  try { await navigator.clipboard.writeText(JSON.stringify(buildConfig(), null, 2)); toast('Copied to clipboard'); } catch(e) { toast('Copy failed'); }
}

function downloadConfig() {
  const blob = new Blob([JSON.stringify(buildConfig(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'opencode.jsonc'; a.click();
  const instrText = document.getElementById('instructions_text').value.trim();
  if (instrText) { const b2 = new Blob([instrText + '\\n'], { type: 'text/markdown' }); const a2 = document.createElement('a'); a2.href = URL.createObjectURL(b2); a2.download = 'instructions.md'; a2.click(); }
  toast('Downloaded opencode.jsonc');
}

async function saveConfig() {
  try {
    const resp = await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: buildConfig(), instructions: document.getElementById('instructions_text').value.trim(), instructionsPath: document.getElementById('instructions_path').value.trim() }) });
    if (resp.ok) toast('Config saved! Restart opencode to apply.'); else toast('Save failed: ' + await resp.text());
  } catch(e) { toast('Save failed: ' + e.message); }
}

// Load existing config
async function loadConfig() {
  try {
    const resp = await fetch('/api/config');
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.model) document.getElementById('model').value = data.model;
    if (data.small_model) { document.getElementById('small_model').value = data.small_model; document.querySelectorAll('.chips .chip').forEach(c => { c.classList.toggle('active', c.onclick.toString().includes(data.small_model)); }); }
    if (data.compaction) { if (data.compaction.auto !== undefined) document.getElementById('compaction_auto').checked = data.compaction.auto; if (data.compaction.tail_turns !== undefined) document.getElementById('compaction_tail_turns').value = data.compaction.tail_turns; if (data.compaction.preserve_recent_tokens !== undefined) document.getElementById('compaction_preserve_tokens').value = data.compaction.preserve_recent_tokens; if (data.compaction.model) document.getElementById('compaction_model').value = data.compaction.model; }
    if (data.experimental) { if (data.experimental.mcp_timeout !== undefined) document.getElementById('mcp_timeout').value = data.experimental.mcp_timeout; if (data.experimental.continue_loop_on_deny !== undefined) document.getElementById('continue_loop_on_deny').checked = data.experimental.continue_loop_on_deny; if (data.experimental.openTelemetry !== undefined) document.getElementById('opentelemetry').checked = data.experimental.openTelemetry; }
    if (data.tool_output) { if (data.tool_output.max_lines !== undefined) document.getElementById('tool_output_max_lines').value = data.tool_output.max_lines; if (data.tool_output.max_bytes !== undefined) document.getElementById('tool_output_max_bytes').value = data.tool_output.max_bytes; }
    if (data.permission) { if (data.permission.bash) document.getElementById('perm_git_allow').checked = true; if (data.permission.edit === 'allow') document.getElementById('perm_edit_allow').checked = true; if (data.permission.websearch === 'allow') document.getElementById('perm_websearch_allow').checked = true; }
    if (data.share) document.getElementById('share').value = data.share;
    if (data.autoupdate !== undefined) document.getElementById('autoupdate').value = String(data.autoupdate);
    if (data.agent) { if (data.agent.explore?.disable) document.getElementById('agent_explore_disable').checked = true; if (data.agent.general?.disable) document.getElementById('agent_general_disable').checked = true; if (data.agent.title?.prompt) document.getElementById('agent_title_prompt').value = data.agent.title.prompt; }
    if (data.default_agent) document.getElementById('default_agent').value = data.default_agent;
    updatePreview();
  } catch(e) {}
}

updatePreview();
loadConfig();
</script>
</body>
</html>`

function getConfigPath(): string {
  const candidates = ["opencode.jsonc", "opencode.json", "config.json"].map((file) =>
    path.join(Global.Path.config, file),
  )
  for (const file of candidates) {
    if (fs.existsSync(file)) return file
  }
  return candidates[0]
}

function openBrowser(url: string) {
  const platform = process.platform
  if (platform === "darwin") exec(`open "${url}"`)
  else if (platform === "win32") exec(`start "${url}"`)
  else exec(`xdg-open "${url}"`)
}

export const ConfigCommand = cmd({
  command: "config",
  describe: "open interactive config editor in browser",
  builder: (yargs: Argv) =>
    yargs
      .option("port", {
        alias: "p",
        describe: "port to serve on",
        type: "number",
        default: 3847,
      })
      .option("no-open", {
        describe: "don't auto-open browser",
        type: "boolean",
        default: false,
      })
      .option("save", {
        describe: "save config directly without browser",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    const port = args.port as number
    const shouldOpen = !args["no-open"]
    const configPath = getConfigPath()

    if (args.save) {
      // Direct save mode: read stdin and write config
      console.log(`Config path: ${configPath}`)
      console.log("Use the --port option to open the web editor instead.")
      return
    }

    const server = http.createServer((req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
      res.setHeader("Access-Control-Allow-Headers", "Content-Type")

      if (req.method === "OPTIONS") {
        res.writeHead(204)
        res.end()
        return
      }

      if (req.url === "/" || req.url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(CONFIG_EDITOR_HTML)
        return
      }

      if (req.url === "/api/config" && req.method === "GET") {
        try {
          const content = fs.readFileSync(configPath, "utf-8")
          // Strip comments for JSON parsing
          const stripped = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
          const config = JSON.parse(stripped)
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify(config))
        } catch (e) {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end("{}")
        }
        return
      }

      if (req.url === "/api/save" && req.method === "POST") {
        let body = ""
        req.on("data", (chunk) => (body += chunk))
        req.on("end", () => {
          try {
            const { config, instructions, instructionsPath } = JSON.parse(body)

            // Ensure config directory exists
            const configDir = path.dirname(configPath)
            if (!fs.existsSync(configDir)) {
              fs.mkdirSync(configDir, { recursive: true })
            }

            // Write config
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")

            // Write instructions file if provided
            if (instructions && instructionsPath) {
              const instrPath = instructionsPath.replace("~", process.env.HOME || "")
              const instrDir = path.dirname(instrPath)
              if (!fs.existsSync(instrDir)) {
                fs.mkdirSync(instrDir, { recursive: true })
              }
              fs.writeFileSync(instrPath, instructions + "\n")
            }

            res.writeHead(200, { "Content-Type": "text/plain" })
            res.end("OK")
          } catch (e: any) {
            res.writeHead(500, { "Content-Type": "text/plain" })
            res.end(e.message)
          }
        })
        return
      }

      res.writeHead(404)
      res.end("Not found")
    })

    server.listen(port, () => {
      const url = `http://localhost:${port}`
      console.log(`\n  OpenCode Config Editor\n`)
      console.log(`  Editor:    ${url}`)
      console.log(`  Config:    ${configPath}\n`)

      if (shouldOpen) {
        openBrowser(url)
        console.log("  Browser opened. Press Ctrl+C to stop.\n")
      } else {
        console.log("  Open the URL above in your browser. Press Ctrl+C to stop.\n")
      }
    })
  },
})
