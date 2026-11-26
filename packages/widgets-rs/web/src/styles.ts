/** The renderer's stylesheet, adopted by each widget's shadow root (constructable, so no inline `<style>` for CSP). */
export const CSS: string = /* css */ `
:host { display: block; position: relative; contain: layout style; border-radius: 6px; }
:host(:focus) { outline: none; }
:host([data-focused]) { outline: 2px solid var(--pw-accent); outline-offset: 4px; }
:host([hidden]) { display: none; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.pw-root {
  position: relative; font: 14px/1.45 var(--pw-font); color: var(--pw-text); -webkit-font-smoothing: antialiased;
  min-width: 0;
}
:host(:fullscreen) { background: var(--pw-bg); overflow: auto; }
:host(:fullscreen) .pw-root {
  /* The root fills the safe area minus a 16 px padding on every side, canvases included; the padding shows the
     background. The close button keeps its place on screen, over the padded root's top-right corner, and the
     program is told where (widgets-fullscreen.md, Layout and Chrome). */
  min-height: 100%; display: flex; flex-direction: column;
  padding: calc(env(safe-area-inset-top) + 16px) calc(env(safe-area-inset-right) + 16px)
    calc(env(safe-area-inset-bottom) + 16px) calc(env(safe-area-inset-left) + 16px);
}
/* Full screen (widgets-fullscreen.md, Layout): the root fills the screen; every canvas and shader not opted out with
   fill: false shares the remaining height equally (its height is the minimum); taller content scrolls. */
:host(:fullscreen) .pw-root > .pw-view { flex: 1 1 auto; display: flex; flex-direction: column; }
:host(:fullscreen) .pw-root > .pw-view > * { flex: 1 1 auto; }
:host(:fullscreen) .pw-has-fill { flex: 1 1 auto; }
:host(:fullscreen) .pw-col > .pw-fill, :host(:fullscreen) .pw-card > .pw-fill { flex: 1 1 0; }
:host(:fullscreen) .pw-row > .pw-fill { align-self: stretch; }
:host(:fullscreen) .pw-chip { display: none; }
.pw-view { min-width: 0; }
/* stack (widgets.md, Stack): one grid cell, children layered in order; the cell is as tall as the tallest child plus
   its insets. Children let the pointer through except where something takes input. */
.pw-stack { display: grid; grid-template-columns: minmax(0, 1fr); width: 100%; min-width: 0; position: relative; isolation: isolate; }
.pw-stack > * { grid-area: 1 / 1; min-width: 0; max-width: 100%; pointer-events: none; }
.pw-stack .pw-btn, .pw-stack .pw-check, .pw-stack .pw-slider, .pw-stack .pw-option, .pw-stack .pw-input,
.pw-stack .pw-press, .pw-stack .pw-carousel[data-id], .pw-stack .pw-surface[data-pointer] { pointer-events: auto; }
.pw-col { display: flex; flex-direction: column; min-width: 0; }
.pw-row { display: flex; flex-direction: row; min-width: 0; }
.pw-row.pw-wrap { flex-wrap: wrap; }
.pw-row > .pw-card { flex: 1 1 180px; }
.pw-g0 { gap: 0; } .pw-g1 { gap: 4px; } .pw-g2 { gap: 8px; } .pw-g3 { gap: 12px; }
.pw-a-start { align-items: flex-start; } .pw-a-center { align-items: center; } .pw-a-end { align-items: flex-end; }
.pw-a-stretch { align-items: stretch; }
.pw-col.pw-a-start > *, .pw-col.pw-a-center > *, .pw-col.pw-a-end > * { max-width: 100%; }
.pw-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.pw-title { font-size: 16px; font-weight: 600; line-height: 1.3; }
.pw-caption { font-size: 12px; }
.pw-code { font-family: var(--pw-mono); font-size: 12.5px; background: var(--pw-surface); border-radius: 4px; padding: 1px 4px; }
.pw-t-muted { color: var(--pw-muted); } .pw-t-accent { color: var(--pw-accent); } .pw-t-success { color: var(--pw-success); }
.pw-t-warning { color: var(--pw-warning); } .pw-t-error { color: var(--pw-error); }
.pw-md { overflow-wrap: anywhere; }
.pw-md > :first-child { margin-top: 0; } .pw-md > :last-child { margin-bottom: 0; }
.pw-md p, .pw-md ul, .pw-md ol, .pw-md pre, .pw-md blockquote { margin: 0 0 8px; }
.pw-md ul, .pw-md ol { padding-left: 20px; }
.pw-md h1, .pw-md h2, .pw-md h3, .pw-md h4 { margin: 4px 0 6px; font-size: 15px; font-weight: 600; }
.pw-md h1 { font-size: 17px; } .pw-md h2 { font-size: 16px; }
.pw-md code { font-family: var(--pw-mono); font-size: 12.5px; background: var(--pw-surface); border-radius: 4px; padding: 1px 4px; }
.pw-md pre { background: var(--pw-surface); border: 1px solid var(--pw-border); border-radius: 6px; padding: 8px 10px; overflow: auto; }
.pw-md pre code { background: none; padding: 0; }
.pw-md blockquote { border-left: 3px solid var(--pw-border); padding-left: 10px; color: var(--pw-muted); }
.pw-md a { color: var(--pw-accent); }
.pw-md hr { border: 0; border-top: 1px solid var(--pw-border); }
.pw-img { display: block; width: 100%; height: auto; object-fit: cover; border-radius: calc(var(--pw-radius) - 2px); background: var(--pw-surface); }
.pw-img-missing { display: flex; align-items: center; justify-content: center; color: var(--pw-muted); font-size: 12px; padding: 8px; text-align: center; }
.pw-card {
  display: flex; flex-direction: column; gap: 8px; padding: 10px; min-width: 0;
  background: var(--pw-surface); border: 1px solid var(--pw-border); border-radius: var(--pw-radius);
  transition: border-color .12s, box-shadow .12s;
}
.pw-card.pw-press { cursor: pointer; }
.pw-card.pw-press:hover { border-color: color-mix(in srgb, var(--pw-accent) 50%, var(--pw-border)); }
.pw-card.pw-press:focus-visible { outline: 2px solid var(--pw-accent); outline-offset: 2px; }
.pw-card.pw-selected { border-color: var(--pw-accent); box-shadow: 0 0 0 1px var(--pw-accent); }
.pw-btn {
  font: inherit; font-weight: 500; font-size: 13px; line-height: 18px; padding: 6px 14px; border-radius: var(--pw-radius);
  border: 1px solid var(--pw-border); background: var(--pw-surface); color: var(--pw-text); cursor: pointer;
  transition: filter .12s, background .12s;
}
.pw-btn:hover:not(:disabled) { filter: brightness(1.12); }
.pw-btn:focus-visible { outline: 2px solid var(--pw-accent); outline-offset: 2px; }
.pw-btn:disabled { opacity: .5; cursor: default; }
.pw-btn.pw-primary { background: var(--pw-accent); border-color: var(--pw-accent); color: var(--pw-accent-text); }
.pw-btn.pw-danger { background: var(--pw-error); border-color: var(--pw-error); color: #fff; }
.pw-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.pw-label { font-size: 12px; color: var(--pw-muted); font-weight: 500; }
.pw-check { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
.pw-check input { width: 16px; height: 16px; margin: 0; accent-color: var(--pw-accent); cursor: inherit; }
.pw-check.pw-disabled { opacity: .5; cursor: default; }
.pw-slider-head { display: flex; justify-content: space-between; gap: 8px; }
.pw-slider-value { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--pw-text); }
.pw-slider { width: 100%; margin: 4px 0; accent-color: var(--pw-accent); cursor: pointer; }
.pw-input {
  font: inherit; color: var(--pw-text); background: var(--pw-bg); border: 1px solid var(--pw-border);
  border-radius: var(--pw-radius); padding: 7px 10px; width: 100%; min-width: 0; resize: vertical;
}
.pw-input:focus { outline: none; border-color: var(--pw-accent); box-shadow: 0 0 0 1px var(--pw-accent); }
.pw-input::placeholder { color: var(--pw-muted); }
.pw-options { display: flex; flex-direction: column; gap: 4px; }
.pw-option {
  display: flex; align-items: flex-start; gap: 8px; text-align: left; font: inherit; color: var(--pw-text);
  background: var(--pw-bg); border: 1px solid var(--pw-border); border-radius: var(--pw-radius); padding: 7px 10px; cursor: pointer;
}
.pw-option:focus-visible { outline: 2px solid var(--pw-accent); outline-offset: 1px; }
.pw-option[aria-checked="true"] { border-color: var(--pw-accent); background: color-mix(in srgb, var(--pw-accent) 10%, var(--pw-bg)); }
.pw-option:disabled { cursor: default; opacity: .6; }
.pw-mark { flex: none; width: 14px; height: 14px; margin-top: 2px; border: 1.5px solid var(--pw-muted); border-radius: 50%; }
.pw-option.pw-multi .pw-mark { border-radius: 3px; }
.pw-option[aria-checked="true"] .pw-mark { border-color: var(--pw-accent); background: var(--pw-accent); box-shadow: inset 0 0 0 2px var(--pw-bg); }
.pw-option-text { display: flex; flex-direction: column; min-width: 0; }
.pw-option-desc { font-size: 12px; color: var(--pw-muted); }
.pw-divider { border: 0; border-top: 1px solid var(--pw-border); margin: 2px 0; width: 100%; }
.pw-carousel { position: relative; overflow: hidden; border-radius: calc(var(--pw-radius) - 2px); touch-action: pan-y; outline: none; min-width: 0; }
.pw-carousel:focus-visible { box-shadow: 0 0 0 2px var(--pw-accent); }
.pw-track { display: flex; transition: transform .25s ease; will-change: transform; }
.pw-track.pw-dragging { transition: none; }
.pw-slide { flex: 0 0 100%; min-width: 0; }
.pw-arrow {
  position: absolute; top: 50%; transform: translateY(-50%); width: 28px; height: 28px; border-radius: 50%; border: 0;
  background: rgba(0,0,0,.45); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity .15s; padding: 0;
}
.pw-arrow svg { width: 14px; height: 14px; }
.pw-carousel:hover .pw-arrow, .pw-carousel:focus-within .pw-arrow { opacity: 1; }
@media (hover: none) { .pw-arrow { display: none; } }
.pw-arrow:disabled { visibility: hidden; }
.pw-prev { left: 6px; } .pw-next { right: 6px; }
.pw-dots { position: absolute; left: 0; right: 0; bottom: 6px; display: flex; justify-content: center; gap: 5px; pointer-events: none; }
.pw-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,.5); box-shadow: 0 0 2px rgba(0,0,0,.4); padding: 0; border: 0; pointer-events: auto; cursor: pointer; }
.pw-dot.pw-on { background: #fff; }
.pw-surface { position: relative; width: 100%; min-width: 0; }
.pw-surface canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; touch-action: none; border-radius: calc(var(--pw-radius) - 2px); }
.pw-surface .pw-alt { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 8px; text-align: center; color: var(--pw-muted); font-size: 12px; background: var(--pw-surface); border-radius: calc(var(--pw-radius) - 2px); }
.pw-surface .pw-poster { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: calc(var(--pw-radius) - 2px); }
.pw-surface .pw-alt-error { justify-content: flex-start; align-items: flex-end; color: var(--pw-error); background: transparent; font-family: var(--pw-mono); font-size: 11px; }
.pw-error { color: var(--pw-error); font-size: 12px; font-family: var(--pw-mono); white-space: pre-wrap; border: 1px solid color-mix(in srgb, var(--pw-error) 40%, transparent); border-radius: 6px; padding: 6px 8px; margin-top: 8px; }
.pw-failure { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; font-size: 12px; }
.pw-failure-text { color: var(--pw-error); font-family: var(--pw-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.pw-failure-told { color: var(--pw-muted); }
.pw-error-card { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.pw-loading { height: 64px; border-radius: var(--pw-radius); background: linear-gradient(90deg, var(--pw-surface), color-mix(in srgb, var(--pw-surface) 70%, var(--pw-border)), var(--pw-surface)); background-size: 200% 100%; animation: pw-shimmer 1.2s linear infinite; }
@keyframes pw-shimmer { from { background-position: 100% 0 } to { background-position: -100% 0 } }
@media (prefers-reduced-motion: reduce) { .pw-loading { animation: none; } .pw-track { transition: none; } }
.pw-status { margin-top: 8px; font-size: 12px; color: var(--pw-muted); display: flex; gap: 6px; align-items: center; }
.pw-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--pw-muted); border: 1px solid var(--pw-border); border-radius: 999px; padding: 1px 8px; margin-bottom: 8px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pw-readonly .pw-view { pointer-events: none; }
.pw-readonly .pw-view .pw-carousel { pointer-events: auto; }
.pw-hint {
  position: absolute; top: -2px; right: 30px; z-index: 2; font-size: 11px; line-height: 16px; padding: 2px 6px;
  display: inline-flex; align-items: center; gap: 4px; font-family: var(--pw-mono);
  border-radius: 999px; color: var(--pw-muted); background: var(--pw-bg); border: 1px solid var(--pw-border);
  pointer-events: none;
}
.pw-hint svg { width: 13px; height: 13px; }
:host(:fullscreen) .pw-hint {
  /* Full screen has no chrome but the close button, and the program only keeps clear of that: no focus hint there
     (Esc and back close full screen, releasing the keyboard). */
  display: none;
}
.pw-expand {
  position: absolute; top: -4px; right: -4px; z-index: 2; width: 28px; height: 28px; border-radius: 6px; padding: 0;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  border: 1px solid var(--pw-border); background: var(--pw-bg); color: var(--pw-muted); opacity: 0; transition: opacity .15s;
}
.pw-expand svg { width: 14px; height: 14px; }
.pw-expand:hover { color: var(--pw-text); }
.pw-root:hover > .pw-expand, .pw-expand:focus-visible { opacity: 1; }
.pw-expand:focus-visible { outline: 2px solid var(--pw-accent); outline-offset: 1px; }
@media (hover: none) { .pw-expand { opacity: .85; } }
:host(:fullscreen) .pw-expand {
  /* The only chrome: always visible, 32 x 32 (all of it the button), 8 px from the safe area's top and right edges. */
  position: fixed; top: calc(env(safe-area-inset-top) + 8px); right: calc(env(safe-area-inset-right) + 8px);
  width: 32px; height: 32px; border-radius: 8px; opacity: 1;
  background: color-mix(in srgb, var(--pw-bg) 85%, transparent); color: var(--pw-text);
}
`

let sheet: CSSStyleSheet | undefined

/** The shared constructable stylesheet. */
export function stylesheet(): CSSStyleSheet {
  if (!sheet) {
    sheet = new CSSStyleSheet()
    sheet.replaceSync(CSS)
  }
  return sheet
}
