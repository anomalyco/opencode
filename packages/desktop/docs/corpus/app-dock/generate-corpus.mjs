#!/usr/bin/env node
/**
 * Brownfield corpus generator for app-dock subsystem.
 * Invariants lifted from shipped tests on main.
 * One source of truth → four artifacts emitted.
 */
import fs from "fs";
import path from "path";

const outDir = path.join(path.dirname(new URL(import.meta.url).pathname));

const invariants = [
  {
    id: "bounds-conversion",
    title: "Bounds Conversion",
    clauses: [
      "panelBoundsToContent converts CSS bounds to content bounds by dividing by zoom",
      "panelBoundsToContent rejects bounds with non-positive width or height",
      "panelBoundsToContent rejects zoom values that are not finite or not positive",
      "panelBoundsToContent rejects bounds that produce non-positive content bounds after division",
      "panelBoundsToContent rounds x, y, width, height after division"
    ],
    unwanted: [
      "panelBoundsToContent accepts zero or negative width or height",
      "panelBoundsToContent accepts non-finite or non-positive zoom",
      "panelBoundsToContent produces content bounds with zero or negative dimensions"
    ],
    tests: ["app-dock-utils.test.ts:4-12"]
  },
  {
    id: "url-validation",
    title: "URL Validation and Normalization",
    clauses: [
      "appDockURL accepts a valid HTTPS URL and returns it normalized",
      "appDockURL accepts a bare domain and returns an HTTPS URL",
      "appDockURL accepts a search term and returns a Google search HTTPS URL",
      "appDockURL rejects empty or whitespace-only input",
      "appDockURL rejects file: scheme",
      "appDockURL rejects javascript: scheme"
    ],
    unwanted: [
      "appDockURL accepts file: scheme URLs",
      "appDockURL accepts javascript: scheme URLs",
      "appDockURL accepts empty or whitespace-only input"
    ],
    tests: ["app-dock-utils.test.ts:14-22"]
  },
  {
    id: "zoom-clamping",
    title: "Zoom Clamping",
    clauses: [
      "appDockZoom clamps values below 0.5 up to 0.5",
      "appDockZoom clamps values above 3 down to 3",
      "appDockZoom passes through values within [0.5, 3] unchanged",
      "appDockZoom throws on NaN or non-finite input"
    ],
    unwanted: [
      "appDockZoom accepts NaN or non-finite input"
    ],
    tests: ["app-dock-utils.test.ts:24-29"]
  },
  {
    id: "rpc-bridge-dispatch",
    title: "RPC Bridge Dispatch",
    clauses: [
      "handleDockRPC consumes only messages with type dock.rpc and ignores others",
      "handleDockRPC returns true when it consumes a dock.rpc message",
      "handleDockRPC returns false for non-dock messages",
      "Unknown dock operations return an error result with ok:false",
      "open with non-HTTPS address returns an error result mentioning HTTPS",
      "open with valid HTTPS address returns ok:true with tabID and URL",
      "list returns the opened tab with tabID and active:true",
      "read returns a page snapshot with items containing refs for interactive elements",
      "click on a button ref returns ok:true and mutates the live page",
      "type on an input ref sets the value and reflects in subsequent snapshot",
      "go reload returns ok:true and preserves the tab",
      "close returns ok:true and empties the tab list"
    ],
    unwanted: [
      "handleDockRPC consumes non-dock.rpc messages",
      "Unknown operations return ok:true",
      "Non-HTTPS open returns ok:true",
      "Click or type reports failure on valid refs",
      "go reload loses the tab",
      "close leaves tabs in the list"
    ],
    tests: ["app-dock-rpc.test.ts:103-145"]
  },
  {
    id: "browser-snapshot",
    title: "Browser Snapshot Script",
    clauses: [
      "buildSnapshotScript returns an object with url, title, viewport, items[], text",
      "items contains interactive elements with unique positive integer refs",
      "items includes element kinds: button, input, a, div (contenteditable), textarea",
      "Refs are stable across repeated snapshots of the same page",
      "Budget parameter clamps item count and sets truncated:true when exceeded"
    ],
    unwanted: [
      "Snapshot lacks url, title, viewport, items, or text",
      "Refs are not positive integers or are duplicated",
      "Hidden or aria-hidden inert elements appear in snapshot",
      "Budget cap is not honored or truncated flag is not set"
    ],
    tests: ["app-dock-tools.test.ts:86-105"]
  },
  {
    id: "browser-click",
    title: "Browser Click Script",
    clauses: [
      "buildClickScript dispatches a working pointer/mouse event sequence",
      "Click on a button ref increments the counter in the live page",
      "Click returns ok:true on success"
    ],
    unwanted: [
      "Click returns ok:false on a valid ref",
      "Click does not mutate the live page state"
    ],
    tests: ["app-dock-tools.test.ts:107-111"]
  },
  {
    id: "browser-type",
    title: "Browser Type Script",
    clauses: [
      "buildTypeScript sets input value via native setter",
      "Type fires input and change events on the element",
      "Type returns ok:true and the typed value",
      "Type handles textarea and contenteditable targets"
    ],
    unwanted: [
      "Type does not set the input value",
      "Type does not fire input/change events",
      "Type fails on textarea or contenteditable"
    ],
    tests: ["app-dock-tools.test.ts:113-128"]
  },
  {
    id: "stale-ref-handling",
    title: "Stale Ref Handling",
    clauses: [
      "Click on a removed element ref returns ok:false with error mentioning gone"
    ],
    unwanted: [
      "Stale ref click returns ok:true"
    ],
    tests: ["app-dock-tools.test.ts:130-134"]
  },
  {
    id: "https-only",
    title: "HTTPS-Only Enforcement",
    clauses: [
      "open rejects http, file, javascript, data schemes with HTTPS-only error",
      "navigate rejects http, file, javascript, data schemes with HTTPS-only error"
    ],
    unwanted: [
      "open accepts non-HTTPS schemes",
      "navigate accepts non-HTTPS schemes"
    ],
    tests: ["app-dock-security.test.ts:504-529"]
  },
  {
    id: "navigation-policy",
    title: "Navigation Policy",
    clauses: [
      "Real window.open to non-HTTPS target is blocked with navigation-error",
      "Real main-frame navigation to non-HTTPS target is blocked",
      "Real HTTPS redirect to HTTP is blocked with navigation-error"
    ],
    unwanted: [
      "window.open to non-HTTPS succeeds",
      "Main-frame navigation to non-HTTPS succeeds",
      "HTTPS redirect to HTTP succeeds"
    ],
    tests: ["app-dock-security.test.ts:532-566"]
  },
  {
    id: "webcontents-view-security",
    title: "WebContentsView Security Policy",
    clauses: [
      "App Dock WebContentsView is created with sandbox:true",
      "App Dock WebContentsView is created with contextIsolation:true",
      "App Dock WebContentsView is created with nodeIntegration:false"
    ],
    unwanted: [
      "WebContentsView has sandbox:false",
      "WebContentsView has contextIsolation:false",
      "WebContentsView has nodeIntegration:true"
    ],
    tests: ["app-dock-security.test.ts:568-575"]
  },
  {
    id: "permission-denial",
    title: "Permission Denial",
    clauses: [
      "Permission request is denied (state: denied)",
      "Permission check returns denied",
      "Permission denial emits App Dock UI state with identity and permission name",
      "Permission event is cloneable and omits storage data"
    ],
    unwanted: [
      "Permission request is granted",
      "Permission check returns granted",
      "Permission event exposes storageKey or user data path"
    ],
    tests: ["app-dock-security.test.ts:577-601"]
  },
  {
    id: "event-envelope-sanitization",
    title: "Event Envelope Sanitization",
    clauses: [
      "Renderer events omit storageKey",
      "Renderer events omit user data path (temp directory)",
      "Navigation error envelopes omit storageKey and temp path"
    ],
    unwanted: [
      "Renderer events expose storageKey",
      "Renderer events expose user data path",
      "Navigation error envelopes expose storage internals"
    ],
    tests: ["app-dock-security.test.ts:603-616"]
  },
  {
    id: "navigation-error-envelope",
    title: "Navigation Error Envelope",
    clauses: [
      "Navigation error envelope is discriminated with tabID and generation",
      "Navigation error code is either blocked or failed",
      "Navigation error identity contains tabID (string) and generation (safe integer)"
    ],
    unwanted: [
      "Navigation error lacks discriminated identity",
      "Navigation error code is neither blocked nor failed"
    ],
    tests: ["app-dock-security.test.ts:603-611"]
  },
  {
    id: "view-lifecycle",
    title: "View Lifecycle",
    clauses: [
      "Close destroys the WebContentsView immediately",
      "Closed identity emits no scheduled events after destruction (500ms grace)"
    ],
    unwanted: [
      "Closed WebContentsView remains alive",
      "Closed identity emits stale events after destruction"
    ],
    tests: ["app-dock-security.test.ts:618-630"]
  },
  {
    id: "profile-isolation",
    title: "Profile Isolation and Deletion",
    clauses: [
      "Profile delete cancels and removes in-progress downloads",
      "Profile delete tombstones the old profile partition",
      "Fresh profile after delete has empty localStorage",
      "Delete profile blocks further open on that profile ID"
    ],
    unwanted: [
      "Profile delete leaves downloads running",
      "Profile delete does not tombstone partition",
      "Fresh profile inherits deleted profile storage"
    ],
    tests: ["app-dock-security.test.ts:632-685"]
  },
  {
    id: "ipc-sender-validation",
    title: "IPC Sender Validation",
    clauses: [
      "Malformed bounds are rejected with Invalid App Dock bounds",
      "Subframe IPC sender is rejected with Invalid App Dock sender"
    ],
    unwanted: [
      "Malformed bounds are accepted",
      "Subframe IPC sender is accepted"
    ],
    tests: ["app-dock-security.test.ts:691-707"]
  },
  {
    id: "fullscreen-command-validation",
    title: "Fullscreen and Command Validation",
    clauses: [
      "Non-boolean fullscreen state is rejected with Invalid App Dock fullscreen state",
      "Invalid command enum is rejected with Invalid App Dock command"
    ],
    unwanted: [
      "Non-boolean fullscreen state is accepted",
      "Invalid command enum is accepted"
    ],
    tests: ["app-dock-security.test.ts:709-720"]
  },
  {
    id: "throttling",
    title: "Hide/Select Throttling",
    clauses: [
      "Hide throttles a 25ms ticker to at most one tick in 300ms",
      "Select resumes three ticks within 200ms"
    ],
    unwanted: [
      "Hidden ticker is not throttled",
      "Selected ticker does not resume within 200ms"
    ],
    tests: ["app-dock-security.test.ts:721-757"]
  },
  {
    id: "open-response-contract",
    title: "Open Response Contract",
    clauses: [
      "IPC open response omits storageKey and path fields"
    ],
    unwanted: [
      "IPC open response exposes storageKey or path"
    ],
    tests: ["app-dock-security.test.ts:758-762"]
  },
  {
    id: "state-event-identity",
    title: "State Event Identity",
    clauses: [
      "State events carry tabID (string) and generation (safe integer)"
    ],
    unwanted: [
      "State events lack tabID or generation"
    ],
    tests: ["app-dock-security.test.ts:763-771"]
  },
  {
    id: "cross-window-profile-sharing",
    title: "Cross-Window Profile Sharing",
    clauses: [
      "Two BrowserWindows opening the same profile create both views",
      "Profile delete from window A destroys views in both windows A and B",
      "Profile delete detaches views from both windows"
    ],
    unwanted: [
      "Shared profile does not create both views",
      "Profile delete from A leaves B's view alive",
      "Profile delete leaves view attached in either window"
    ],
    tests: ["app-dock-security.test.ts:775-802"]
  },
  {
    id: "close-tabs-validation",
    title: "Close-tabs Validation",
    clauses: [
      "close-tabs with invalid scope is rejected",
      "close-tabs others destroys only other tabs, keeps target",
      "close-tabs right validates complete visual order",
      "close-tabs right with wrong visual order is rejected",
      "close-tabs right with foreign tab in order is rejected",
      "close-tabs right with duplicate tabs in order is rejected",
      "close-tabs right closes only visual-right tabs"
    ],
    unwanted: [
      "Invalid close-tabs scope is accepted",
      "close-tabs others destroys target",
      "close-tabs right accepts incomplete or wrong visual order",
      "close-tabs right closes non-right tabs"
    ],
    tests: ["app-dock-security.test.ts:804-871"]
  },
  {
    id: "https-popup",
    title: "HTTPS Popup Handling",
    clauses: [
      "HTTPS window.open emits tab-opened with cloneable public identity (tabID, generation, url)",
      "HTTPS popup creates second WebContentsView",
      "HTTPS popup target loads and is selected and attached",
      "Popup source view is hidden and detached"
    ],
    unwanted: [
      "HTTPS popup does not emit tab-opened",
      "HTTPS popup does not create second view",
      "Popup target does not load or is not selected",
      "Popup source remains attached"
    ],
    tests: ["app-dock-security.test.ts:874-917"]
  },
  {
    id: "contract-field",
    title: "Contract Field Minimality",
    clauses: [
      "Open and tab-opened contracts expose only tabID, generation, and URL",
      "Event envelopes omit legacy id and adapter fields",
      "State, tab-opened, and navigation-error events are cloneable public identities"
    ],
    unwanted: [
      "Open or tab-opened exposes id, storageKey, path, or adapter fields",
      "Event envelopes expose legacy id or adapter fields"
    ],
    tests: ["app-dock-security.test.ts:928-972"]
  },
  {
    id: "restart-persistence",
    title: "Restart Persistence",
    clauses: [
      "Fresh Electron main process preserves same profile localStorage and cookie",
      "Deleted profile tombstone survives restart and blocks old partition access",
      "Separate profiles retain isolated storage across fresh Electron main process"
    ],
    unwanted: [
      "Profile localStorage or cookie lost on restart",
      "Deleted profile tombstone does not survive restart",
      "Separate profiles share storage across restart"
    ],
    tests: ["app-dock-security.test.ts:973-980"]
  },
  {
    id: "corrupt-registry",
    title: "Corrupt Registry Fails Closed",
    clauses: [
      "Corrupt native registry fails closed without rebind and remains unchanged"
    ],
    unwanted: [
      "Corrupt registry is silently rebind or modified"
    ],
    tests: ["app-dock-security.test.ts:979"]
  },
  {
    id: "renderer-crash-recovery",
    title: "Renderer Crash Recovery",
    clauses: [
      "Real selected renderer crash emits tab-crashed with old identity and reason crashed/killed",
      "IPC recovery creates same tabID/URL/profile with newer generation",
      "Recovered selected tab is usable and preserves other tabs",
      "Old crashed generation events are ignored after recovery"
    ],
    unwanted: [
      "Crash does not emit tab-crashed with old identity",
      "Recovery does not create newer generation",
      "Recovery does not preserve other tabs",
      "Old generation events emitted after recovery"
    ],
    tests: ["app-dock-security.test.ts:982-1051"]
  },
  {
    id: "capacity-lru",
    title: "Capacity LRU Eviction",
    clauses: [
      "20 inactive views across two windows use global LRU",
      "Selecting A0 retains it while opening one more evicts older B0",
      "Active views remain usable during eviction",
      "Recently selected tab remains usable after eviction"
    ],
    unwanted: [
      "LRU eviction displaces an active view",
      "Recently selected tab becomes unusable after eviction",
      "Global LRU not honored across windows"
    ],
    tests: ["app-dock-security.test.ts:1053-1095"]
  },
  {
    id: "download-limit",
    title: "Download Limit",
    clauses: [
      "Nine real same-profile slow downloads admit eight progressing",
      "Ninth download is cancelled safely with failure event",
      "Download events expose no filesystem path"
    ],
    unwanted: [
      "More than eight progressing downloads admitted",
      "Ninth download is not cancelled",
      "Download events expose filesystem path"
    ],
    tests: ["app-dock-security.test.ts:1097-1160"]
  },
  {
    id: "devtools-gate",
    title: "DevTools Gate",
    clauses: [
      "App Dock DevTools do not open without trusted development route",
      "Ordinary user input (F12) does not open DevTools",
      "Trusted developmentMode()=true allows openDevTools"
    ],
    unwanted: [
      "DevTools open without trusted route",
      "F12 opens DevTools in production mode",
      "developmentMode=true does not allow DevTools"
    ],
    tests: ["app-dock-security.test.ts:1162-1176"]
  },
  {
    id: "profile-registry",
    title: "Profile Registry",
    clauses: [
      "Profile ID must match ^[a-z0-9][a-z0-9-]{0,31}$",
      "Manifest validation rejects invalid profiles, tabs, bookmarks, history",
      "Registry load fails closed on corrupt data",
      "ensureActive creates new profile with UUID storageKey",
      "markDeleting transitions active→deleting, returns storageKey",
      "markDeleted transitions deleting→deleted, rewrites manifest and removes tabs",
      "replaceManifest enforces revision match and active profile set consistency"
    ],
    unwanted: [
      "Registry accepts profile ID outside pattern",
      "Registry accepts manifest exceeding internal limits",
      "Corrupt registry loads without error",
      "ensureActive creates profile without storageKey",
      "markDeleting on deleted profile succeeds",
      "markDeleted on non-deleting profile succeeds",
      "replaceManifest accepts revision mismatch"
    ],
    tests: ["app-dock-profile-registry.test.ts"]
  },
  {
    id: "dock-scroll",
    title: "Dock Scroll",
    clauses: [
      "dock_scroll dispatches scroll and rejects invalid direction or amount",
      "RPC dispatch validates scroll direction against up, down, top, bottom"
    ],
    unwanted: [
      "dock_scroll accepts invalid direction"
    ],
    tests: ["app-dock-live.test.ts"]
  },
  {
    id: "dock-hover",
    title: "Dock Hover",
    clauses: [
      "dock_hover dispatches mouseover on live element"
    ],
    unwanted: [
      "dock_hover reports success on missing element ref"
    ],
    tests: ["app-dock-live.test.ts"]
  },
  {
    id: "dock-click-at",
    title: "Dock Click At Coordinates",
    clauses: [
      "dock_clickAt clicks live coordinates"
    ],
    unwanted: [
      "dock_clickAt reports success with no element at coordinates"
    ],
    tests: ["app-dock-live.test.ts"]
  },
  {
    id: "dock-drag",
    title: "Dock Drag",
    clauses: [
      "dock_drag runs pointer drag sequence on live elements"
    ],
    unwanted: [
      "dock_drag reports success with missing element ref"
    ],
    tests: ["app-dock-live.test.ts"]
  },
  {
    id: "dock-scroll-to",
    title: "Dock Scroll To",
    clauses: [
      "dock_scrollTo jumps to live coordinates"
    ],
    unwanted: [
      "dock_scrollTo rejects valid coordinates"
    ],
    tests: ["app-dock-live.test.ts"]
  },
  {
    id: "snapshot-shadow-dom",
    title: "Snapshot Shadow DOM Piercing",
    clauses: [
      "dock_read pierces open shadow DOM in live snapshot"
    ],
    unwanted: [
      "dock_read omits visible inputs inside open shadow roots"
    ],
    tests: ["app-dock-live.test.ts"]
  },
  {
    id: "dock-youtube-llm",
    title: "Dock YouTube LLM Drive",
    clauses: [
      "dock session drives dock_open, dock_read and dock_click against YouTube results via live model call",
      "live model turn produces final text answering with a video title",
      "dock_* tools are visible in the session tool list for the live model"
    ],
    unwanted: [
      "dock session completes without invoking any dock_* tool",
      "session tool list omits dock_* tools for the live model"
    ],
    tests: ["app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model)"]
  }
];

// Generate invariant register
function genInvariantRegister() {
  let md = "# App-Dock Subsystem Invariant Register\n\n";
  md += "> Brownfield corpus — lifted from shipped tests on `main`. Every clause states behaviour that is on `master` and measured by a named test. "
    + "Paraphrase is not used; each requirement quotes its clause verbatim.\n\n";
  md += `| Invariant | Title | Clauses | Unwanted | Witnesses |\n`;
  md += `|---|---|---|---|---|\n`;

  for (const inv of invariants) {
    md += `| \`${inv.id}\` | ${inv.title} | ${inv.clauses.length} | ${inv.unwanted.length} | ${inv.tests.join(", ")} |\n`;
  }
  md += "\n## Clause Detail\n\n";

  for (const inv of invariants) {
    md += `### ${inv.id}: ${inv.title}\n\n`;
    md += "**Clauses**\n";
    for (const c of inv.clauses) {
      md += `- ${c} *(measured: ${inv.tests.join(", ")})*\n`;
    }
    md += "\n**Unwanted**\n";
    for (const u of inv.unwanted) {
      md += `- ${u} *(measured: ${inv.tests.join(", ")})*\n`;
    }
    md += "\n";
  }

  return md;
}

// Generate requirements (one per clause + one per unwanted)
function genRequirements() {
  let md = "# App-Dock Requirements\n\n";
  md += "> Generated from invariant register. Each requirement is a plain `shall` sentence quoting its clause verbatim. "
    + "Each `unwanted` becomes an `If-then` refusal requirement.\n\n";

  let reqNum = 1;
  for (const inv of invariants) {
    md += `## ${inv.id}: ${inv.title}\n\n`;

    for (const clause of inv.clauses) {
      md += `### REQ-${String(reqNum).padStart(3, "0")}\n`;
      md += `The system **shall** ${clause}.`;
      md += ` *(from invariant \`${inv.id}\`)*\n\n`;
      reqNum++;
    }

    for (const unwanted of inv.unwanted) {
      md += `### REQ-${String(reqNum).padStart(3, "0")}\n`;
      md += `If the system ${unwanted}, then it **shall refuse** and return an error.`;
      md += ` *(from invariant \`${inv.id}\` unwanted)*\n\n`;
      reqNum++;
    }
  }

  return md;
}

// Generate goldens
function genGoldens() {
  let md = "# App-Dock Goldens\n\n";
  md += "> One golden per requirement, naming the shipped test as its witness. "
    + "Goldens are traceable: requirement → golden → test.\n\n";

  let reqNum = 1;
  for (const inv of invariants) {
    md += `## ${inv.id}: ${inv.title}\n\n`;

    for (const clause of inv.clauses) {
      md += `### GOLDEN-${String(reqNum).padStart(3, "0")} (for REQ-${String(reqNum).padStart(3, "0")})\n`;
      md += `**Requirement**: The system shall ${clause}.\n\n`;
      md += `**Witness**: ${inv.tests.join("; ")}\n\n`;
      reqNum++;
    }

    for (const unwanted of inv.unwanted) {
      md += `### GOLDEN-${String(reqNum).padStart(3, "0")} (for REQ-${String(reqNum).padStart(3, "0")})\n`;
      md += `**Requirement**: If the system ${unwanted}, then it shall refuse and return an error.\n\n`;
      md += `**Witness**: ${inv.tests.join("; ")}\n\n`;
      reqNum++;
    }
  }

  return md;
}

// Generate work-package cards
function genCards() {
  let md = "# App-Dock Work-Package Cards\n\n";
  md += "> One card per requirement and per golden. Cards are scheduled together — requirements without cards are orphans. "
    + "Traceability closes mechanically.\n\n";

  let reqNum = 1;
  for (const inv of invariants) {
    md += `## ${inv.id}: ${inv.title}\n\n`;

    for (const clause of inv.clauses) {
      md += `### WP-${String(reqNum).padStart(3, "0")} (covers REQ-${String(reqNum).padStart(3, "0")} + GOLDEN-${String(reqNum).padStart(3, "0")})\n`;
      md += `**Invariant**: \`${inv.id}\`\n`;
      md += `**Clause**: ${clause}\n`;
      md += `**Witness**: ${inv.tests.join("; ")}\n`;
      md += `**Status**: ready (test exists on main)\n\n`;
      reqNum++;
    }

    for (const unwanted of inv.unwanted) {
      md += `### WP-${String(reqNum).padStart(3, "0")} (covers REQ-${String(reqNum).padStart(3, "0")} + GOLDEN-${String(reqNum).padStart(3, "0")})\n`;
      md += `**Invariant**: \`${inv.id}\`\n`;
      md += `**Unwanted**: ${unwanted}\n`;
      md += `**Witness**: ${inv.tests.join("; ")}\n`;
      md += `**Status**: ready (test exists on main)\n\n`;
      reqNum++;
    }
  }

  return md;
}

// Write all artifacts
function writeAll() {
  fs.writeFileSync(path.join(outDir, "00-invariant-register.md"), genInvariantRegister());
  fs.writeFileSync(path.join(outDir, "01-requirements.md"), genRequirements());
  fs.writeFileSync(path.join(outDir, "02-goldens.md"), genGoldens());
  fs.writeFileSync(path.join(outDir, "03-cards.md"), genCards());

  // Split into per-invariant files
  const invariantsDir = path.join(outDir, "invariants")
  fs.mkdirSync(invariantsDir, { recursive: true })
  for (const inv of invariants) {
    let md = `# Invariant: \`${inv.id}\` - ${inv.title}\n\n`
    md += `> Clauses: ${inv.clauses.length} | Unwanted: ${inv.unwanted.length} | Witnesses: ${inv.tests.join(", ")}\n\n`
    md += "## Clauses\n"
    for (const c of inv.clauses) {
      md += `- ${c} *(measured: ${inv.tests.join(", ")})*\n`
    }
    md += "\n## Unwanted\n"
    for (const u of inv.unwanted) {
      md += `- ${u} *(measured: ${inv.tests.join(", ")})*\n`
    }
    md += "\n"
    fs.writeFileSync(path.join(invariantsDir, `${inv.id}.md`), md)
  }

  const totalReqs = invariants.reduce((n, inv) => n + inv.clauses.length + inv.unwanted.length, 0)
  console.log(`Generated corpus in ${outDir}`)
  console.log(`Invariants: ${invariants.length}`)
  console.log(`Total requirements: ${totalReqs}`)
  console.log(`Total goldens: ${totalReqs}`)
  console.log(`Total cards: ${totalReqs}`)
}

writeAll();