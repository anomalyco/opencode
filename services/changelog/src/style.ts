// The stone-paper palette, serif reading column and quiet chrome follow the Anomaly notes (anoma.ly/notes); the header,
// footer and mono face follow opencode.ai.
export const style = `
@font-face { font-family: "IBM Plex Serif"; font-style: normal; font-weight: 400; font-display: swap; src: url("/changelog/fonts/IBMPlexSerif-Regular-Latin1.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Serif"; font-style: italic; font-weight: 400; font-display: swap; src: url("/changelog/fonts/IBMPlexSerif-Italic-Latin1.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Serif"; font-style: normal; font-weight: 600; font-display: swap; src: url("/changelog/fonts/IBMPlexSerif-SemiBold-Latin1.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-style: normal; font-weight: 400; font-display: swap; src: url("/changelog/fonts/IBMPlexMono-Regular-Latin1.woff2") format("woff2"); }

:root {
  color-scheme: light dark;
  --paper: hsl(48, 7%, 90%);
  --paper-hover: hsl(45, 5%, 86%);
  --ink: hsl(51, 10%, 13%);
  --ink-strong: hsl(40, 6%, 7%);
  --ink-label: hsl(39, 6%, 40%);
  --ink-weak: hsl(39, 5%, 51%);
  --ink-weaker: hsl(39, 6%, 63%);
  --ink-code: hsl(32, 13%, 31%);
  --rule: hsl(48, 6%, 79%);
  --underline: hsla(38, 21%, 29%, 0.4);
  --underline-hover: hsl(38, 27%, 33%);
  --button: hsl(51, 10%, 13%);
  --button-hover: hsl(40, 6%, 7%);
  --button-ink: hsl(48, 7%, 90%);
  --logo-inner: #cfcecd;
  --logo-open: #656363;
  --logo-code: #211e1e;
  --serif: "IBM Plex Serif", Georgia, serif;
  --mono: "Berkeley Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: hsl(60, 7%, 3%);
    --paper-hover: hsl(0, 0%, 7%);
    --ink: hsl(37, 15%, 80%);
    --ink-strong: hsl(60, 9%, 98%);
    --ink-label: hsl(0, 0%, 67%);
    --ink-weak: hsl(0, 0%, 48%);
    --ink-weaker: hsl(0, 0%, 40%);
    --ink-code: hsl(33, 26%, 79%);
    --rule: hsl(0, 0%, 16%);
    --underline: hsla(37, 15%, 58%, 0.4);
    --underline-hover: hsl(38, 25%, 68%);
    --button: hsl(37, 15%, 80%);
    --button-hover: hsl(60, 9%, 98%);
    --button-ink: hsl(60, 7%, 3%);
    --logo-inner: #4b4646;
    --logo-open: #b7b1b1;
    --logo-code: #f1ecec;
  }
}

*, *::before, *::after { box-sizing: border-box; }
html { background: var(--paper); }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--mono); font-size: 16px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
h1, h2, h3, h4, p, ul { margin: 0; }
::selection { background: hsl(40, 19%, 78%); color: var(--ink-strong); }

.top { position: sticky; top: 0; z-index: 10; background: var(--paper); }
.top::after { content: ""; position: absolute; inset: 100% 0 auto; height: 24px; background: linear-gradient(to bottom, var(--paper), transparent); pointer-events: none; }
.top-inner { max-width: 67.5rem; height: 80px; margin: 0 auto; padding: 0 5rem; display: flex; align-items: center; justify-content: space-between; gap: 2rem; }
.logo { display: block; line-height: 0; }
.logo svg { height: 34px; width: auto; }
.logo .i { fill: var(--logo-inner); }
.logo .o { fill: var(--logo-open); }
.logo .c { fill: var(--logo-code); }
.nav { display: flex; align-items: center; gap: 32px; list-style: none; padding: 0; }
.nav a { color: var(--ink); text-decoration: none; white-space: nowrap; }
.nav a:hover { text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; }
.nav a.cta { display: flex; align-items: center; gap: 8px; padding: 8px 16px 8px 10px; border-radius: 4px; background: var(--button); color: var(--button-ink); font-weight: 500; }
.nav a.cta:hover { background: var(--button-hover); text-decoration: none; }
.nav a.cta svg { width: 16px; height: 16px; }
@media (max-width: 60rem) { .top-inner { padding: 0 1.5rem; } .nav { gap: 24px; } }
@media (max-width: 48rem) { .nav li:not(:last-child) { display: none; } }

main { max-width: calc(740px + 3rem); margin: 0 auto; padding: 14vh 1.5rem 0; font-family: var(--serif); font-variant-numeric: oldstyle-nums proportional-nums; font-feature-settings: "kern", "liga", "calt"; text-rendering: optimizeLegibility; }
main a { color: inherit; text-decoration: underline; text-decoration-color: var(--underline); text-decoration-thickness: 1px; text-underline-offset: 0.17em; }
main a:hover { color: var(--ink-strong); text-decoration-color: var(--underline-hover); }

.hero { margin-bottom: 96px; }
.hero h1 { font: 400 48px/1.2 var(--serif); letter-spacing: -0.015em; color: var(--ink-strong); margin-bottom: 12px; }
.hero p { font-size: 20px; line-height: 1.5; color: var(--ink-weak); }

.releases { display: flex; flex-direction: column; gap: 112px; }
.release { scroll-margin-top: 104px; }
.release > header { margin-bottom: 40px; }
.release h2 { font: 400 32px/1.3 var(--serif); letter-spacing: -0.01em; }
.release h2 a { color: var(--ink-strong); text-decoration: none; }
.release h2 a:hover { text-decoration: underline; text-decoration-color: var(--underline); }
.release time { display: block; margin-top: 6px; font-size: 16px; line-height: 1.4; color: var(--ink-weak); }

.label { font: 400 12px/1.5 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-weak); }
.intro { margin-bottom: 40px; }

.highlights { margin-bottom: 48px; }
.highlights .label { margin-bottom: 20px; }
.highlights ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 28px; }
.highlights li { font-size: 20px; line-height: 1.65; }
.highlights p { text-wrap: pretty; }
.highlights .title { font-style: italic; color: var(--ink-strong); }

.sections { border-top: 1px solid var(--rule); }
.section { border-bottom: 1px solid var(--rule); }
.section summary { display: flex; align-items: baseline; justify-content: space-between; padding: 14px 0; cursor: pointer; list-style: none; }
.section summary::-webkit-details-marker { display: none; }
.section summary::after { content: "+"; font: 400 14px/1 var(--mono); color: var(--ink-weak); }
.section[open] summary::after { content: "\\2212"; }
.section summary:hover .label, .section summary:hover::after { color: var(--ink-strong); }
.section .markdown { padding: 4px 0 28px; }

.markdown { font-size: 17px; line-height: 1.6; }
.markdown h4 { font: italic 400 17px/1.4 var(--serif); color: var(--ink-label); margin: 28px 0 12px; }
.markdown h4:first-child { margin-top: 0; }
.markdown p { margin-bottom: 12px; text-wrap: pretty; }
.markdown ul { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-direction: column; gap: 10px; }
.markdown li { position: relative; padding-left: 1.25em; text-wrap: pretty; }
.markdown li::before { content: "\\2013"; position: absolute; left: 0; color: var(--ink-weaker); }

main code { font-family: var(--mono); font-size: 0.83em; font-variant-numeric: lining-nums tabular-nums; color: var(--ink-code); white-space: nowrap; }
main strong { font-weight: 600; }

.notice { font-size: 20px; line-height: 1.65; color: var(--ink-weak); }
.v1 { margin-top: 112px; font-size: 16px; color: var(--ink-weak); }

footer { max-width: 67.5rem; margin: 8rem auto 0; display: flex; border-top: 1px solid var(--rule); }
footer a { flex: 1; display: block; padding: 2rem 0; text-align: center; color: var(--ink-strong); text-decoration: none; }
footer a + a { border-left: 1px solid var(--rule); }
footer a:hover { background: var(--paper-hover); text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px; }
.legal { display: flex; justify-content: center; flex-wrap: wrap; gap: 32px; padding: 2rem 1.5rem 5rem; color: var(--ink-weak); }
.legal a { color: var(--ink-weak); text-decoration: none; }
.legal a:hover { color: var(--ink); text-decoration: underline; }

@media (max-width: 40rem) {
  footer { flex-wrap: wrap; }
  footer a { flex: 1 0 50%; border-top: 1px solid var(--rule); }
  footer a + a { border-left: none; }
}
@media (max-width: 500px) {
  .hero h1 { font-size: 36px; }
  .highlights li { font-size: 18px; }
  .releases { gap: 80px; }
}
`
