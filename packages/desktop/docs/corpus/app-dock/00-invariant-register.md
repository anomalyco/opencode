# App-Dock Subsystem Invariant Register

> Brownfield corpus — lifted from shipped tests on `main`. Every clause states behaviour that is on `master` and measured by a named test. Paraphrase is not used; each requirement quotes its clause verbatim.

| Invariant | Title | Clauses | Unwanted | Witnesses |
|---|---|---|---|---|
| `bounds-conversion` | Bounds Conversion | 5 | 3 | app-dock-utils.test.ts:4-12 |
| `url-validation` | URL Validation and Normalization | 6 | 3 | app-dock-utils.test.ts:14-22 |
| `zoom-clamping` | Zoom Clamping | 4 | 1 | app-dock-utils.test.ts:24-29 |
| `rpc-bridge-dispatch` | RPC Bridge Dispatch | 12 | 6 | app-dock-rpc.test.ts:103-145 |
| `browser-snapshot` | Browser Snapshot Script | 5 | 4 | app-dock-tools.test.ts:86-105 |
| `browser-click` | Browser Click Script | 3 | 2 | app-dock-tools.test.ts:107-111 |
| `browser-type` | Browser Type Script | 4 | 3 | app-dock-tools.test.ts:113-128 |
| `stale-ref-handling` | Stale Ref Handling | 1 | 1 | app-dock-tools.test.ts:130-134 |
| `https-only` | HTTPS-Only Enforcement | 2 | 2 | app-dock-security.test.ts:504-529 |
| `navigation-policy` | Navigation Policy | 3 | 3 | app-dock-security.test.ts:532-566 |
| `webcontents-view-security` | WebContentsView Security Policy | 3 | 3 | app-dock-security.test.ts:568-575 |
| `permission-denial` | Permission Denial | 4 | 3 | app-dock-security.test.ts:577-601 |
| `event-envelope-sanitization` | Event Envelope Sanitization | 3 | 3 | app-dock-security.test.ts:603-616 |
| `navigation-error-envelope` | Navigation Error Envelope | 3 | 2 | app-dock-security.test.ts:603-611 |
| `view-lifecycle` | View Lifecycle | 2 | 2 | app-dock-security.test.ts:618-630 |
| `profile-isolation` | Profile Isolation and Deletion | 4 | 3 | app-dock-security.test.ts:632-685 |
| `ipc-sender-validation` | IPC Sender Validation | 2 | 2 | app-dock-security.test.ts:691-707 |
| `fullscreen-command-validation` | Fullscreen and Command Validation | 2 | 2 | app-dock-security.test.ts:709-720 |
| `throttling` | Hide/Select Throttling | 2 | 2 | app-dock-security.test.ts:721-757 |
| `open-response-contract` | Open Response Contract | 1 | 1 | app-dock-security.test.ts:758-762 |
| `state-event-identity` | State Event Identity | 1 | 1 | app-dock-security.test.ts:763-771 |
| `cross-window-profile-sharing` | Cross-Window Profile Sharing | 3 | 3 | app-dock-security.test.ts:775-802 |
| `close-tabs-validation` | Close-tabs Validation | 7 | 4 | app-dock-security.test.ts:804-871 |
| `https-popup` | HTTPS Popup Handling | 4 | 4 | app-dock-security.test.ts:874-917 |
| `contract-field` | Contract Field Minimality | 3 | 2 | app-dock-security.test.ts:928-972 |
| `restart-persistence` | Restart Persistence | 3 | 3 | app-dock-security.test.ts:973-980 |
| `corrupt-registry` | Corrupt Registry Fails Closed | 1 | 1 | app-dock-security.test.ts:979 |
| `renderer-crash-recovery` | Renderer Crash Recovery | 4 | 4 | app-dock-security.test.ts:982-1051 |
| `capacity-lru` | Capacity LRU Eviction | 4 | 3 | app-dock-security.test.ts:1053-1095 |
| `download-limit` | Download Limit | 3 | 3 | app-dock-security.test.ts:1097-1160 |
| `devtools-gate` | DevTools Gate | 3 | 3 | app-dock-security.test.ts:1162-1176 |
| `profile-registry` | Profile Registry | 7 | 7 | app-dock-profile-registry.test.ts |
| `dock-scroll` | Dock Scroll | 2 | 1 | app-dock-live.test.ts |
| `dock-hover` | Dock Hover | 1 | 1 | app-dock-live.test.ts |
| `dock-click-at` | Dock Click At Coordinates | 1 | 1 | app-dock-live.test.ts |
| `dock-drag` | Dock Drag | 1 | 1 | app-dock-live.test.ts |
| `dock-scroll-to` | Dock Scroll To | 1 | 1 | app-dock-live.test.ts |
| `snapshot-shadow-dom` | Snapshot Shadow DOM Piercing | 1 | 1 | app-dock-live.test.ts |
| `dock-youtube-llm` | Dock YouTube LLM Drive | 3 | 2 | app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model) |

## Clause Detail

### bounds-conversion: Bounds Conversion

**Clauses**
- panelBoundsToContent converts CSS bounds to content bounds by dividing by zoom *(measured: app-dock-utils.test.ts:4-12)*
- panelBoundsToContent rejects bounds with non-positive width or height *(measured: app-dock-utils.test.ts:4-12)*
- panelBoundsToContent rejects zoom values that are not finite or not positive *(measured: app-dock-utils.test.ts:4-12)*
- panelBoundsToContent rejects bounds that produce non-positive content bounds after division *(measured: app-dock-utils.test.ts:4-12)*
- panelBoundsToContent rounds x, y, width, height after division *(measured: app-dock-utils.test.ts:4-12)*

**Unwanted**
- panelBoundsToContent accepts zero or negative width or height *(measured: app-dock-utils.test.ts:4-12)*
- panelBoundsToContent accepts non-finite or non-positive zoom *(measured: app-dock-utils.test.ts:4-12)*
- panelBoundsToContent produces content bounds with zero or negative dimensions *(measured: app-dock-utils.test.ts:4-12)*

### url-validation: URL Validation and Normalization

**Clauses**
- appDockURL accepts a valid HTTPS URL and returns it normalized *(measured: app-dock-utils.test.ts:14-22)*
- appDockURL accepts a bare domain and returns an HTTPS URL *(measured: app-dock-utils.test.ts:14-22)*
- appDockURL accepts a search term and returns a Google search HTTPS URL *(measured: app-dock-utils.test.ts:14-22)*
- appDockURL rejects empty or whitespace-only input *(measured: app-dock-utils.test.ts:14-22)*
- appDockURL rejects file: scheme *(measured: app-dock-utils.test.ts:14-22)*
- appDockURL rejects javascript: scheme *(measured: app-dock-utils.test.ts:14-22)*

**Unwanted**
- appDockURL accepts file: scheme URLs *(measured: app-dock-utils.test.ts:14-22)*
- appDockURL accepts javascript: scheme URLs *(measured: app-dock-utils.test.ts:14-22)*
- appDockURL accepts empty or whitespace-only input *(measured: app-dock-utils.test.ts:14-22)*

### zoom-clamping: Zoom Clamping

**Clauses**
- appDockZoom clamps values below 0.5 up to 0.5 *(measured: app-dock-utils.test.ts:24-29)*
- appDockZoom clamps values above 3 down to 3 *(measured: app-dock-utils.test.ts:24-29)*
- appDockZoom passes through values within [0.5, 3] unchanged *(measured: app-dock-utils.test.ts:24-29)*
- appDockZoom throws on NaN or non-finite input *(measured: app-dock-utils.test.ts:24-29)*

**Unwanted**
- appDockZoom accepts NaN or non-finite input *(measured: app-dock-utils.test.ts:24-29)*

### rpc-bridge-dispatch: RPC Bridge Dispatch

**Clauses**
- handleDockRPC consumes only messages with type dock.rpc and ignores others *(measured: app-dock-rpc.test.ts:103-145)*
- handleDockRPC returns true when it consumes a dock.rpc message *(measured: app-dock-rpc.test.ts:103-145)*
- handleDockRPC returns false for non-dock messages *(measured: app-dock-rpc.test.ts:103-145)*
- Unknown dock operations return an error result with ok:false *(measured: app-dock-rpc.test.ts:103-145)*
- open with non-HTTPS address returns an error result mentioning HTTPS *(measured: app-dock-rpc.test.ts:103-145)*
- open with valid HTTPS address returns ok:true with tabID and URL *(measured: app-dock-rpc.test.ts:103-145)*
- list returns the opened tab with tabID and active:true *(measured: app-dock-rpc.test.ts:103-145)*
- read returns a page snapshot with items containing refs for interactive elements *(measured: app-dock-rpc.test.ts:103-145)*
- click on a button ref returns ok:true and mutates the live page *(measured: app-dock-rpc.test.ts:103-145)*
- type on an input ref sets the value and reflects in subsequent snapshot *(measured: app-dock-rpc.test.ts:103-145)*
- go reload returns ok:true and preserves the tab *(measured: app-dock-rpc.test.ts:103-145)*
- close returns ok:true and empties the tab list *(measured: app-dock-rpc.test.ts:103-145)*

**Unwanted**
- handleDockRPC consumes non-dock.rpc messages *(measured: app-dock-rpc.test.ts:103-145)*
- Unknown operations return ok:true *(measured: app-dock-rpc.test.ts:103-145)*
- Non-HTTPS open returns ok:true *(measured: app-dock-rpc.test.ts:103-145)*
- Click or type reports failure on valid refs *(measured: app-dock-rpc.test.ts:103-145)*
- go reload loses the tab *(measured: app-dock-rpc.test.ts:103-145)*
- close leaves tabs in the list *(measured: app-dock-rpc.test.ts:103-145)*

### browser-snapshot: Browser Snapshot Script

**Clauses**
- buildSnapshotScript returns an object with url, title, viewport, items[], text *(measured: app-dock-tools.test.ts:86-105)*
- items contains interactive elements with unique positive integer refs *(measured: app-dock-tools.test.ts:86-105)*
- items includes element kinds: button, input, a, div (contenteditable), textarea *(measured: app-dock-tools.test.ts:86-105)*
- Refs are stable across repeated snapshots of the same page *(measured: app-dock-tools.test.ts:86-105)*
- Budget parameter clamps item count and sets truncated:true when exceeded *(measured: app-dock-tools.test.ts:86-105)*

**Unwanted**
- Snapshot lacks url, title, viewport, items, or text *(measured: app-dock-tools.test.ts:86-105)*
- Refs are not positive integers or are duplicated *(measured: app-dock-tools.test.ts:86-105)*
- Hidden or aria-hidden inert elements appear in snapshot *(measured: app-dock-tools.test.ts:86-105)*
- Budget cap is not honored or truncated flag is not set *(measured: app-dock-tools.test.ts:86-105)*

### browser-click: Browser Click Script

**Clauses**
- buildClickScript dispatches a working pointer/mouse event sequence *(measured: app-dock-tools.test.ts:107-111)*
- Click on a button ref increments the counter in the live page *(measured: app-dock-tools.test.ts:107-111)*
- Click returns ok:true on success *(measured: app-dock-tools.test.ts:107-111)*

**Unwanted**
- Click returns ok:false on a valid ref *(measured: app-dock-tools.test.ts:107-111)*
- Click does not mutate the live page state *(measured: app-dock-tools.test.ts:107-111)*

### browser-type: Browser Type Script

**Clauses**
- buildTypeScript sets input value via native setter *(measured: app-dock-tools.test.ts:113-128)*
- Type fires input and change events on the element *(measured: app-dock-tools.test.ts:113-128)*
- Type returns ok:true and the typed value *(measured: app-dock-tools.test.ts:113-128)*
- Type handles textarea and contenteditable targets *(measured: app-dock-tools.test.ts:113-128)*

**Unwanted**
- Type does not set the input value *(measured: app-dock-tools.test.ts:113-128)*
- Type does not fire input/change events *(measured: app-dock-tools.test.ts:113-128)*
- Type fails on textarea or contenteditable *(measured: app-dock-tools.test.ts:113-128)*

### stale-ref-handling: Stale Ref Handling

**Clauses**
- Click on a removed element ref returns ok:false with error mentioning gone *(measured: app-dock-tools.test.ts:130-134)*

**Unwanted**
- Stale ref click returns ok:true *(measured: app-dock-tools.test.ts:130-134)*

### https-only: HTTPS-Only Enforcement

**Clauses**
- open rejects http, file, javascript, data schemes with HTTPS-only error *(measured: app-dock-security.test.ts:504-529)*
- navigate rejects http, file, javascript, data schemes with HTTPS-only error *(measured: app-dock-security.test.ts:504-529)*

**Unwanted**
- open accepts non-HTTPS schemes *(measured: app-dock-security.test.ts:504-529)*
- navigate accepts non-HTTPS schemes *(measured: app-dock-security.test.ts:504-529)*

### navigation-policy: Navigation Policy

**Clauses**
- Real window.open to non-HTTPS target is blocked with navigation-error *(measured: app-dock-security.test.ts:532-566)*
- Real main-frame navigation to non-HTTPS target is blocked *(measured: app-dock-security.test.ts:532-566)*
- Real HTTPS redirect to HTTP is blocked with navigation-error *(measured: app-dock-security.test.ts:532-566)*

**Unwanted**
- window.open to non-HTTPS succeeds *(measured: app-dock-security.test.ts:532-566)*
- Main-frame navigation to non-HTTPS succeeds *(measured: app-dock-security.test.ts:532-566)*
- HTTPS redirect to HTTP succeeds *(measured: app-dock-security.test.ts:532-566)*

### webcontents-view-security: WebContentsView Security Policy

**Clauses**
- App Dock WebContentsView is created with sandbox:true *(measured: app-dock-security.test.ts:568-575)*
- App Dock WebContentsView is created with contextIsolation:true *(measured: app-dock-security.test.ts:568-575)*
- App Dock WebContentsView is created with nodeIntegration:false *(measured: app-dock-security.test.ts:568-575)*

**Unwanted**
- WebContentsView has sandbox:false *(measured: app-dock-security.test.ts:568-575)*
- WebContentsView has contextIsolation:false *(measured: app-dock-security.test.ts:568-575)*
- WebContentsView has nodeIntegration:true *(measured: app-dock-security.test.ts:568-575)*

### permission-denial: Permission Denial

**Clauses**
- Permission request is denied (state: denied) *(measured: app-dock-security.test.ts:577-601)*
- Permission check returns denied *(measured: app-dock-security.test.ts:577-601)*
- Permission denial emits App Dock UI state with identity and permission name *(measured: app-dock-security.test.ts:577-601)*
- Permission event is cloneable and omits storage data *(measured: app-dock-security.test.ts:577-601)*

**Unwanted**
- Permission request is granted *(measured: app-dock-security.test.ts:577-601)*
- Permission check returns granted *(measured: app-dock-security.test.ts:577-601)*
- Permission event exposes storageKey or user data path *(measured: app-dock-security.test.ts:577-601)*

### event-envelope-sanitization: Event Envelope Sanitization

**Clauses**
- Renderer events omit storageKey *(measured: app-dock-security.test.ts:603-616)*
- Renderer events omit user data path (temp directory) *(measured: app-dock-security.test.ts:603-616)*
- Navigation error envelopes omit storageKey and temp path *(measured: app-dock-security.test.ts:603-616)*

**Unwanted**
- Renderer events expose storageKey *(measured: app-dock-security.test.ts:603-616)*
- Renderer events expose user data path *(measured: app-dock-security.test.ts:603-616)*
- Navigation error envelopes expose storage internals *(measured: app-dock-security.test.ts:603-616)*

### navigation-error-envelope: Navigation Error Envelope

**Clauses**
- Navigation error envelope is discriminated with tabID and generation *(measured: app-dock-security.test.ts:603-611)*
- Navigation error code is either blocked or failed *(measured: app-dock-security.test.ts:603-611)*
- Navigation error identity contains tabID (string) and generation (safe integer) *(measured: app-dock-security.test.ts:603-611)*

**Unwanted**
- Navigation error lacks discriminated identity *(measured: app-dock-security.test.ts:603-611)*
- Navigation error code is neither blocked nor failed *(measured: app-dock-security.test.ts:603-611)*

### view-lifecycle: View Lifecycle

**Clauses**
- Close destroys the WebContentsView immediately *(measured: app-dock-security.test.ts:618-630)*
- Closed identity emits no scheduled events after destruction (500ms grace) *(measured: app-dock-security.test.ts:618-630)*

**Unwanted**
- Closed WebContentsView remains alive *(measured: app-dock-security.test.ts:618-630)*
- Closed identity emits stale events after destruction *(measured: app-dock-security.test.ts:618-630)*

### profile-isolation: Profile Isolation and Deletion

**Clauses**
- Profile delete cancels and removes in-progress downloads *(measured: app-dock-security.test.ts:632-685)*
- Profile delete tombstones the old profile partition *(measured: app-dock-security.test.ts:632-685)*
- Fresh profile after delete has empty localStorage *(measured: app-dock-security.test.ts:632-685)*
- Delete profile blocks further open on that profile ID *(measured: app-dock-security.test.ts:632-685)*

**Unwanted**
- Profile delete leaves downloads running *(measured: app-dock-security.test.ts:632-685)*
- Profile delete does not tombstone partition *(measured: app-dock-security.test.ts:632-685)*
- Fresh profile inherits deleted profile storage *(measured: app-dock-security.test.ts:632-685)*

### ipc-sender-validation: IPC Sender Validation

**Clauses**
- Malformed bounds are rejected with Invalid App Dock bounds *(measured: app-dock-security.test.ts:691-707)*
- Subframe IPC sender is rejected with Invalid App Dock sender *(measured: app-dock-security.test.ts:691-707)*

**Unwanted**
- Malformed bounds are accepted *(measured: app-dock-security.test.ts:691-707)*
- Subframe IPC sender is accepted *(measured: app-dock-security.test.ts:691-707)*

### fullscreen-command-validation: Fullscreen and Command Validation

**Clauses**
- Non-boolean fullscreen state is rejected with Invalid App Dock fullscreen state *(measured: app-dock-security.test.ts:709-720)*
- Invalid command enum is rejected with Invalid App Dock command *(measured: app-dock-security.test.ts:709-720)*

**Unwanted**
- Non-boolean fullscreen state is accepted *(measured: app-dock-security.test.ts:709-720)*
- Invalid command enum is accepted *(measured: app-dock-security.test.ts:709-720)*

### throttling: Hide/Select Throttling

**Clauses**
- Hide throttles a 25ms ticker to at most one tick in 300ms *(measured: app-dock-security.test.ts:721-757)*
- Select resumes three ticks within 200ms *(measured: app-dock-security.test.ts:721-757)*

**Unwanted**
- Hidden ticker is not throttled *(measured: app-dock-security.test.ts:721-757)*
- Selected ticker does not resume within 200ms *(measured: app-dock-security.test.ts:721-757)*

### open-response-contract: Open Response Contract

**Clauses**
- IPC open response omits storageKey and path fields *(measured: app-dock-security.test.ts:758-762)*

**Unwanted**
- IPC open response exposes storageKey or path *(measured: app-dock-security.test.ts:758-762)*

### state-event-identity: State Event Identity

**Clauses**
- State events carry tabID (string) and generation (safe integer) *(measured: app-dock-security.test.ts:763-771)*

**Unwanted**
- State events lack tabID or generation *(measured: app-dock-security.test.ts:763-771)*

### cross-window-profile-sharing: Cross-Window Profile Sharing

**Clauses**
- Two BrowserWindows opening the same profile create both views *(measured: app-dock-security.test.ts:775-802)*
- Profile delete from window A destroys views in both windows A and B *(measured: app-dock-security.test.ts:775-802)*
- Profile delete detaches views from both windows *(measured: app-dock-security.test.ts:775-802)*

**Unwanted**
- Shared profile does not create both views *(measured: app-dock-security.test.ts:775-802)*
- Profile delete from A leaves B's view alive *(measured: app-dock-security.test.ts:775-802)*
- Profile delete leaves view attached in either window *(measured: app-dock-security.test.ts:775-802)*

### close-tabs-validation: Close-tabs Validation

**Clauses**
- close-tabs with invalid scope is rejected *(measured: app-dock-security.test.ts:804-871)*
- close-tabs others destroys only other tabs, keeps target *(measured: app-dock-security.test.ts:804-871)*
- close-tabs right validates complete visual order *(measured: app-dock-security.test.ts:804-871)*
- close-tabs right with wrong visual order is rejected *(measured: app-dock-security.test.ts:804-871)*
- close-tabs right with foreign tab in order is rejected *(measured: app-dock-security.test.ts:804-871)*
- close-tabs right with duplicate tabs in order is rejected *(measured: app-dock-security.test.ts:804-871)*
- close-tabs right closes only visual-right tabs *(measured: app-dock-security.test.ts:804-871)*

**Unwanted**
- Invalid close-tabs scope is accepted *(measured: app-dock-security.test.ts:804-871)*
- close-tabs others destroys target *(measured: app-dock-security.test.ts:804-871)*
- close-tabs right accepts incomplete or wrong visual order *(measured: app-dock-security.test.ts:804-871)*
- close-tabs right closes non-right tabs *(measured: app-dock-security.test.ts:804-871)*

### https-popup: HTTPS Popup Handling

**Clauses**
- HTTPS window.open emits tab-opened with cloneable public identity (tabID, generation, url) *(measured: app-dock-security.test.ts:874-917)*
- HTTPS popup creates second WebContentsView *(measured: app-dock-security.test.ts:874-917)*
- HTTPS popup target loads and is selected and attached *(measured: app-dock-security.test.ts:874-917)*
- Popup source view is hidden and detached *(measured: app-dock-security.test.ts:874-917)*

**Unwanted**
- HTTPS popup does not emit tab-opened *(measured: app-dock-security.test.ts:874-917)*
- HTTPS popup does not create second view *(measured: app-dock-security.test.ts:874-917)*
- Popup target does not load or is not selected *(measured: app-dock-security.test.ts:874-917)*
- Popup source remains attached *(measured: app-dock-security.test.ts:874-917)*

### contract-field: Contract Field Minimality

**Clauses**
- Open and tab-opened contracts expose only tabID, generation, and URL *(measured: app-dock-security.test.ts:928-972)*
- Event envelopes omit legacy id and adapter fields *(measured: app-dock-security.test.ts:928-972)*
- State, tab-opened, and navigation-error events are cloneable public identities *(measured: app-dock-security.test.ts:928-972)*

**Unwanted**
- Open or tab-opened exposes id, storageKey, path, or adapter fields *(measured: app-dock-security.test.ts:928-972)*
- Event envelopes expose legacy id or adapter fields *(measured: app-dock-security.test.ts:928-972)*

### restart-persistence: Restart Persistence

**Clauses**
- Fresh Electron main process preserves same profile localStorage and cookie *(measured: app-dock-security.test.ts:973-980)*
- Deleted profile tombstone survives restart and blocks old partition access *(measured: app-dock-security.test.ts:973-980)*
- Separate profiles retain isolated storage across fresh Electron main process *(measured: app-dock-security.test.ts:973-980)*

**Unwanted**
- Profile localStorage or cookie lost on restart *(measured: app-dock-security.test.ts:973-980)*
- Deleted profile tombstone does not survive restart *(measured: app-dock-security.test.ts:973-980)*
- Separate profiles share storage across restart *(measured: app-dock-security.test.ts:973-980)*

### corrupt-registry: Corrupt Registry Fails Closed

**Clauses**
- Corrupt native registry fails closed without rebind and remains unchanged *(measured: app-dock-security.test.ts:979)*

**Unwanted**
- Corrupt registry is silently rebind or modified *(measured: app-dock-security.test.ts:979)*

### renderer-crash-recovery: Renderer Crash Recovery

**Clauses**
- Real selected renderer crash emits tab-crashed with old identity and reason crashed/killed *(measured: app-dock-security.test.ts:982-1051)*
- IPC recovery creates same tabID/URL/profile with newer generation *(measured: app-dock-security.test.ts:982-1051)*
- Recovered selected tab is usable and preserves other tabs *(measured: app-dock-security.test.ts:982-1051)*
- Old crashed generation events are ignored after recovery *(measured: app-dock-security.test.ts:982-1051)*

**Unwanted**
- Crash does not emit tab-crashed with old identity *(measured: app-dock-security.test.ts:982-1051)*
- Recovery does not create newer generation *(measured: app-dock-security.test.ts:982-1051)*
- Recovery does not preserve other tabs *(measured: app-dock-security.test.ts:982-1051)*
- Old generation events emitted after recovery *(measured: app-dock-security.test.ts:982-1051)*

### capacity-lru: Capacity LRU Eviction

**Clauses**
- 20 inactive views across two windows use global LRU *(measured: app-dock-security.test.ts:1053-1095)*
- Selecting A0 retains it while opening one more evicts older B0 *(measured: app-dock-security.test.ts:1053-1095)*
- Active views remain usable during eviction *(measured: app-dock-security.test.ts:1053-1095)*
- Recently selected tab remains usable after eviction *(measured: app-dock-security.test.ts:1053-1095)*

**Unwanted**
- LRU eviction displaces an active view *(measured: app-dock-security.test.ts:1053-1095)*
- Recently selected tab becomes unusable after eviction *(measured: app-dock-security.test.ts:1053-1095)*
- Global LRU not honored across windows *(measured: app-dock-security.test.ts:1053-1095)*

### download-limit: Download Limit

**Clauses**
- Nine real same-profile slow downloads admit eight progressing *(measured: app-dock-security.test.ts:1097-1160)*
- Ninth download is cancelled safely with failure event *(measured: app-dock-security.test.ts:1097-1160)*
- Download events expose no filesystem path *(measured: app-dock-security.test.ts:1097-1160)*

**Unwanted**
- More than eight progressing downloads admitted *(measured: app-dock-security.test.ts:1097-1160)*
- Ninth download is not cancelled *(measured: app-dock-security.test.ts:1097-1160)*
- Download events expose filesystem path *(measured: app-dock-security.test.ts:1097-1160)*

### devtools-gate: DevTools Gate

**Clauses**
- App Dock DevTools do not open without trusted development route *(measured: app-dock-security.test.ts:1162-1176)*
- Ordinary user input (F12) does not open DevTools *(measured: app-dock-security.test.ts:1162-1176)*
- Trusted developmentMode()=true allows openDevTools *(measured: app-dock-security.test.ts:1162-1176)*

**Unwanted**
- DevTools open without trusted route *(measured: app-dock-security.test.ts:1162-1176)*
- F12 opens DevTools in production mode *(measured: app-dock-security.test.ts:1162-1176)*
- developmentMode=true does not allow DevTools *(measured: app-dock-security.test.ts:1162-1176)*

### profile-registry: Profile Registry

**Clauses**
- Profile ID must match ^[a-z0-9][a-z0-9-]{0,31}$ *(measured: app-dock-profile-registry.test.ts)*
- Manifest validation rejects invalid profiles, tabs, bookmarks, history *(measured: app-dock-profile-registry.test.ts)*
- Registry load fails closed on corrupt data *(measured: app-dock-profile-registry.test.ts)*
- ensureActive creates new profile with UUID storageKey *(measured: app-dock-profile-registry.test.ts)*
- markDeleting transitions active→deleting, returns storageKey *(measured: app-dock-profile-registry.test.ts)*
- markDeleted transitions deleting→deleted, rewrites manifest and removes tabs *(measured: app-dock-profile-registry.test.ts)*
- replaceManifest enforces revision match and active profile set consistency *(measured: app-dock-profile-registry.test.ts)*

**Unwanted**
- Registry accepts profile ID outside pattern *(measured: app-dock-profile-registry.test.ts)*
- Registry accepts manifest exceeding internal limits *(measured: app-dock-profile-registry.test.ts)*
- Corrupt registry loads without error *(measured: app-dock-profile-registry.test.ts)*
- ensureActive creates profile without storageKey *(measured: app-dock-profile-registry.test.ts)*
- markDeleting on deleted profile succeeds *(measured: app-dock-profile-registry.test.ts)*
- markDeleted on non-deleting profile succeeds *(measured: app-dock-profile-registry.test.ts)*
- replaceManifest accepts revision mismatch *(measured: app-dock-profile-registry.test.ts)*

### dock-scroll: Dock Scroll

**Clauses**
- dock_scroll dispatches scroll and rejects invalid direction or amount *(measured: app-dock-live.test.ts)*
- RPC dispatch validates scroll direction against up, down, top, bottom *(measured: app-dock-live.test.ts)*

**Unwanted**
- dock_scroll accepts invalid direction *(measured: app-dock-live.test.ts)*

### dock-hover: Dock Hover

**Clauses**
- dock_hover dispatches mouseover on live element *(measured: app-dock-live.test.ts)*

**Unwanted**
- dock_hover reports success on missing element ref *(measured: app-dock-live.test.ts)*

### dock-click-at: Dock Click At Coordinates

**Clauses**
- dock_clickAt clicks live coordinates *(measured: app-dock-live.test.ts)*

**Unwanted**
- dock_clickAt reports success with no element at coordinates *(measured: app-dock-live.test.ts)*

### dock-drag: Dock Drag

**Clauses**
- dock_drag runs pointer drag sequence on live elements *(measured: app-dock-live.test.ts)*

**Unwanted**
- dock_drag reports success with missing element ref *(measured: app-dock-live.test.ts)*

### dock-scroll-to: Dock Scroll To

**Clauses**
- dock_scrollTo jumps to live coordinates *(measured: app-dock-live.test.ts)*

**Unwanted**
- dock_scrollTo rejects valid coordinates *(measured: app-dock-live.test.ts)*

### snapshot-shadow-dom: Snapshot Shadow DOM Piercing

**Clauses**
- dock_read pierces open shadow DOM in live snapshot *(measured: app-dock-live.test.ts)*

**Unwanted**
- dock_read omits visible inputs inside open shadow roots *(measured: app-dock-live.test.ts)*

### dock-youtube-llm: Dock YouTube LLM Drive

**Clauses**
- dock session drives dock_open, dock_read and dock_click against YouTube results via live model call *(measured: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model))*
- live model turn produces final text answering with a video title *(measured: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model))*
- dock_* tools are visible in the session tool list for the live model *(measured: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model))*

**Unwanted**
- dock session completes without invoking any dock_* tool *(measured: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model))*
- session tool list omits dock_* tools for the live model *(measured: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model))*

