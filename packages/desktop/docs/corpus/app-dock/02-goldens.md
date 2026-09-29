# App-Dock Goldens

> One golden per requirement, naming the shipped test as its witness. Goldens are traceable: requirement → golden → test.

## bounds-conversion: Bounds Conversion

### GOLDEN-001 (for REQ-001)
**Requirement**: The system shall panelBoundsToContent converts CSS bounds to content bounds by dividing by zoom.

**Witness**: app-dock-utils.test.ts:4-12

### GOLDEN-002 (for REQ-002)
**Requirement**: The system shall panelBoundsToContent rejects bounds with non-positive width or height.

**Witness**: app-dock-utils.test.ts:4-12

### GOLDEN-003 (for REQ-003)
**Requirement**: The system shall panelBoundsToContent rejects zoom values that are not finite or not positive.

**Witness**: app-dock-utils.test.ts:4-12

### GOLDEN-004 (for REQ-004)
**Requirement**: The system shall panelBoundsToContent rejects bounds that produce non-positive content bounds after division.

**Witness**: app-dock-utils.test.ts:4-12

### GOLDEN-005 (for REQ-005)
**Requirement**: The system shall panelBoundsToContent rounds x, y, width, height after division.

**Witness**: app-dock-utils.test.ts:4-12

### GOLDEN-006 (for REQ-006)
**Requirement**: If the system panelBoundsToContent accepts zero or negative width or height, then it shall refuse and return an error.

**Witness**: app-dock-utils.test.ts:4-12

### GOLDEN-007 (for REQ-007)
**Requirement**: If the system panelBoundsToContent accepts non-finite or non-positive zoom, then it shall refuse and return an error.

**Witness**: app-dock-utils.test.ts:4-12

### GOLDEN-008 (for REQ-008)
**Requirement**: If the system panelBoundsToContent produces content bounds with zero or negative dimensions, then it shall refuse and return an error.

**Witness**: app-dock-utils.test.ts:4-12

## url-validation: URL Validation and Normalization

### GOLDEN-009 (for REQ-009)
**Requirement**: The system shall appDockURL accepts a valid HTTPS URL and returns it normalized.

**Witness**: app-dock-utils.test.ts:14-22

### GOLDEN-010 (for REQ-010)
**Requirement**: The system shall appDockURL accepts a bare domain and returns an HTTPS URL.

**Witness**: app-dock-utils.test.ts:14-22

### GOLDEN-011 (for REQ-011)
**Requirement**: The system shall appDockURL accepts a search term and returns a Google search HTTPS URL.

**Witness**: app-dock-utils.test.ts:14-22

### GOLDEN-012 (for REQ-012)
**Requirement**: The system shall appDockURL rejects empty or whitespace-only input.

**Witness**: app-dock-utils.test.ts:14-22

### GOLDEN-013 (for REQ-013)
**Requirement**: The system shall appDockURL rejects file: scheme.

**Witness**: app-dock-utils.test.ts:14-22

### GOLDEN-014 (for REQ-014)
**Requirement**: The system shall appDockURL rejects javascript: scheme.

**Witness**: app-dock-utils.test.ts:14-22

### GOLDEN-015 (for REQ-015)
**Requirement**: If the system appDockURL accepts file: scheme URLs, then it shall refuse and return an error.

**Witness**: app-dock-utils.test.ts:14-22

### GOLDEN-016 (for REQ-016)
**Requirement**: If the system appDockURL accepts javascript: scheme URLs, then it shall refuse and return an error.

**Witness**: app-dock-utils.test.ts:14-22

### GOLDEN-017 (for REQ-017)
**Requirement**: If the system appDockURL accepts empty or whitespace-only input, then it shall refuse and return an error.

**Witness**: app-dock-utils.test.ts:14-22

## zoom-clamping: Zoom Clamping

### GOLDEN-018 (for REQ-018)
**Requirement**: The system shall appDockZoom clamps values below 0.5 up to 0.5.

**Witness**: app-dock-utils.test.ts:24-29

### GOLDEN-019 (for REQ-019)
**Requirement**: The system shall appDockZoom clamps values above 3 down to 3.

**Witness**: app-dock-utils.test.ts:24-29

### GOLDEN-020 (for REQ-020)
**Requirement**: The system shall appDockZoom passes through values within [0.5, 3] unchanged.

**Witness**: app-dock-utils.test.ts:24-29

### GOLDEN-021 (for REQ-021)
**Requirement**: The system shall appDockZoom throws on NaN or non-finite input.

**Witness**: app-dock-utils.test.ts:24-29

### GOLDEN-022 (for REQ-022)
**Requirement**: If the system appDockZoom accepts NaN or non-finite input, then it shall refuse and return an error.

**Witness**: app-dock-utils.test.ts:24-29

## rpc-bridge-dispatch: RPC Bridge Dispatch

### GOLDEN-023 (for REQ-023)
**Requirement**: The system shall handleDockRPC consumes only messages with type dock.rpc and ignores others.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-024 (for REQ-024)
**Requirement**: The system shall handleDockRPC returns true when it consumes a dock.rpc message.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-025 (for REQ-025)
**Requirement**: The system shall handleDockRPC returns false for non-dock messages.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-026 (for REQ-026)
**Requirement**: The system shall Unknown dock operations return an error result with ok:false.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-027 (for REQ-027)
**Requirement**: The system shall open with non-HTTPS address returns an error result mentioning HTTPS.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-028 (for REQ-028)
**Requirement**: The system shall open with valid HTTPS address returns ok:true with tabID and URL.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-029 (for REQ-029)
**Requirement**: The system shall list returns the opened tab with tabID and active:true.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-030 (for REQ-030)
**Requirement**: The system shall read returns a page snapshot with items containing refs for interactive elements.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-031 (for REQ-031)
**Requirement**: The system shall click on a button ref returns ok:true and mutates the live page.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-032 (for REQ-032)
**Requirement**: The system shall type on an input ref sets the value and reflects in subsequent snapshot.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-033 (for REQ-033)
**Requirement**: The system shall go reload returns ok:true and preserves the tab.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-034 (for REQ-034)
**Requirement**: The system shall close returns ok:true and empties the tab list.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-035 (for REQ-035)
**Requirement**: If the system handleDockRPC consumes non-dock.rpc messages, then it shall refuse and return an error.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-036 (for REQ-036)
**Requirement**: If the system Unknown operations return ok:true, then it shall refuse and return an error.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-037 (for REQ-037)
**Requirement**: If the system Non-HTTPS open returns ok:true, then it shall refuse and return an error.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-038 (for REQ-038)
**Requirement**: If the system Click or type reports failure on valid refs, then it shall refuse and return an error.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-039 (for REQ-039)
**Requirement**: If the system go reload loses the tab, then it shall refuse and return an error.

**Witness**: app-dock-rpc.test.ts:103-145

### GOLDEN-040 (for REQ-040)
**Requirement**: If the system close leaves tabs in the list, then it shall refuse and return an error.

**Witness**: app-dock-rpc.test.ts:103-145

## browser-snapshot: Browser Snapshot Script

### GOLDEN-041 (for REQ-041)
**Requirement**: The system shall buildSnapshotScript returns an object with url, title, viewport, items[], text.

**Witness**: app-dock-tools.test.ts:86-105

### GOLDEN-042 (for REQ-042)
**Requirement**: The system shall items contains interactive elements with unique positive integer refs.

**Witness**: app-dock-tools.test.ts:86-105

### GOLDEN-043 (for REQ-043)
**Requirement**: The system shall items includes element kinds: button, input, a, div (contenteditable), textarea.

**Witness**: app-dock-tools.test.ts:86-105

### GOLDEN-044 (for REQ-044)
**Requirement**: The system shall Refs are stable across repeated snapshots of the same page.

**Witness**: app-dock-tools.test.ts:86-105

### GOLDEN-045 (for REQ-045)
**Requirement**: The system shall Budget parameter clamps item count and sets truncated:true when exceeded.

**Witness**: app-dock-tools.test.ts:86-105

### GOLDEN-046 (for REQ-046)
**Requirement**: If the system Snapshot lacks url, title, viewport, items, or text, then it shall refuse and return an error.

**Witness**: app-dock-tools.test.ts:86-105

### GOLDEN-047 (for REQ-047)
**Requirement**: If the system Refs are not positive integers or are duplicated, then it shall refuse and return an error.

**Witness**: app-dock-tools.test.ts:86-105

### GOLDEN-048 (for REQ-048)
**Requirement**: If the system Hidden or aria-hidden inert elements appear in snapshot, then it shall refuse and return an error.

**Witness**: app-dock-tools.test.ts:86-105

### GOLDEN-049 (for REQ-049)
**Requirement**: If the system Budget cap is not honored or truncated flag is not set, then it shall refuse and return an error.

**Witness**: app-dock-tools.test.ts:86-105

## browser-click: Browser Click Script

### GOLDEN-050 (for REQ-050)
**Requirement**: The system shall buildClickScript dispatches a working pointer/mouse event sequence.

**Witness**: app-dock-tools.test.ts:107-111

### GOLDEN-051 (for REQ-051)
**Requirement**: The system shall Click on a button ref increments the counter in the live page.

**Witness**: app-dock-tools.test.ts:107-111

### GOLDEN-052 (for REQ-052)
**Requirement**: The system shall Click returns ok:true on success.

**Witness**: app-dock-tools.test.ts:107-111

### GOLDEN-053 (for REQ-053)
**Requirement**: If the system Click returns ok:false on a valid ref, then it shall refuse and return an error.

**Witness**: app-dock-tools.test.ts:107-111

### GOLDEN-054 (for REQ-054)
**Requirement**: If the system Click does not mutate the live page state, then it shall refuse and return an error.

**Witness**: app-dock-tools.test.ts:107-111

## browser-type: Browser Type Script

### GOLDEN-055 (for REQ-055)
**Requirement**: The system shall buildTypeScript sets input value via native setter.

**Witness**: app-dock-tools.test.ts:113-128

### GOLDEN-056 (for REQ-056)
**Requirement**: The system shall Type fires input and change events on the element.

**Witness**: app-dock-tools.test.ts:113-128

### GOLDEN-057 (for REQ-057)
**Requirement**: The system shall Type returns ok:true and the typed value.

**Witness**: app-dock-tools.test.ts:113-128

### GOLDEN-058 (for REQ-058)
**Requirement**: The system shall Type handles textarea and contenteditable targets.

**Witness**: app-dock-tools.test.ts:113-128

### GOLDEN-059 (for REQ-059)
**Requirement**: If the system Type does not set the input value, then it shall refuse and return an error.

**Witness**: app-dock-tools.test.ts:113-128

### GOLDEN-060 (for REQ-060)
**Requirement**: If the system Type does not fire input/change events, then it shall refuse and return an error.

**Witness**: app-dock-tools.test.ts:113-128

### GOLDEN-061 (for REQ-061)
**Requirement**: If the system Type fails on textarea or contenteditable, then it shall refuse and return an error.

**Witness**: app-dock-tools.test.ts:113-128

## stale-ref-handling: Stale Ref Handling

### GOLDEN-062 (for REQ-062)
**Requirement**: The system shall Click on a removed element ref returns ok:false with error mentioning gone.

**Witness**: app-dock-tools.test.ts:130-134

### GOLDEN-063 (for REQ-063)
**Requirement**: If the system Stale ref click returns ok:true, then it shall refuse and return an error.

**Witness**: app-dock-tools.test.ts:130-134

## https-only: HTTPS-Only Enforcement

### GOLDEN-064 (for REQ-064)
**Requirement**: The system shall open rejects http, file, javascript, data schemes with HTTPS-only error.

**Witness**: app-dock-security.test.ts:504-529

### GOLDEN-065 (for REQ-065)
**Requirement**: The system shall navigate rejects http, file, javascript, data schemes with HTTPS-only error.

**Witness**: app-dock-security.test.ts:504-529

### GOLDEN-066 (for REQ-066)
**Requirement**: If the system open accepts non-HTTPS schemes, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:504-529

### GOLDEN-067 (for REQ-067)
**Requirement**: If the system navigate accepts non-HTTPS schemes, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:504-529

## navigation-policy: Navigation Policy

### GOLDEN-068 (for REQ-068)
**Requirement**: The system shall Real window.open to non-HTTPS target is blocked with navigation-error.

**Witness**: app-dock-security.test.ts:532-566

### GOLDEN-069 (for REQ-069)
**Requirement**: The system shall Real main-frame navigation to non-HTTPS target is blocked.

**Witness**: app-dock-security.test.ts:532-566

### GOLDEN-070 (for REQ-070)
**Requirement**: The system shall Real HTTPS redirect to HTTP is blocked with navigation-error.

**Witness**: app-dock-security.test.ts:532-566

### GOLDEN-071 (for REQ-071)
**Requirement**: If the system window.open to non-HTTPS succeeds, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:532-566

### GOLDEN-072 (for REQ-072)
**Requirement**: If the system Main-frame navigation to non-HTTPS succeeds, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:532-566

### GOLDEN-073 (for REQ-073)
**Requirement**: If the system HTTPS redirect to HTTP succeeds, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:532-566

## webcontents-view-security: WebContentsView Security Policy

### GOLDEN-074 (for REQ-074)
**Requirement**: The system shall App Dock WebContentsView is created with sandbox:true.

**Witness**: app-dock-security.test.ts:568-575

### GOLDEN-075 (for REQ-075)
**Requirement**: The system shall App Dock WebContentsView is created with contextIsolation:true.

**Witness**: app-dock-security.test.ts:568-575

### GOLDEN-076 (for REQ-076)
**Requirement**: The system shall App Dock WebContentsView is created with nodeIntegration:false.

**Witness**: app-dock-security.test.ts:568-575

### GOLDEN-077 (for REQ-077)
**Requirement**: If the system WebContentsView has sandbox:false, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:568-575

### GOLDEN-078 (for REQ-078)
**Requirement**: If the system WebContentsView has contextIsolation:false, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:568-575

### GOLDEN-079 (for REQ-079)
**Requirement**: If the system WebContentsView has nodeIntegration:true, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:568-575

## permission-denial: Permission Denial

### GOLDEN-080 (for REQ-080)
**Requirement**: The system shall Permission request is denied (state: denied).

**Witness**: app-dock-security.test.ts:577-601

### GOLDEN-081 (for REQ-081)
**Requirement**: The system shall Permission check returns denied.

**Witness**: app-dock-security.test.ts:577-601

### GOLDEN-082 (for REQ-082)
**Requirement**: The system shall Permission denial emits App Dock UI state with identity and permission name.

**Witness**: app-dock-security.test.ts:577-601

### GOLDEN-083 (for REQ-083)
**Requirement**: The system shall Permission event is cloneable and omits storage data.

**Witness**: app-dock-security.test.ts:577-601

### GOLDEN-084 (for REQ-084)
**Requirement**: If the system Permission request is granted, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:577-601

### GOLDEN-085 (for REQ-085)
**Requirement**: If the system Permission check returns granted, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:577-601

### GOLDEN-086 (for REQ-086)
**Requirement**: If the system Permission event exposes storageKey or user data path, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:577-601

## event-envelope-sanitization: Event Envelope Sanitization

### GOLDEN-087 (for REQ-087)
**Requirement**: The system shall Renderer events omit storageKey.

**Witness**: app-dock-security.test.ts:603-616

### GOLDEN-088 (for REQ-088)
**Requirement**: The system shall Renderer events omit user data path (temp directory).

**Witness**: app-dock-security.test.ts:603-616

### GOLDEN-089 (for REQ-089)
**Requirement**: The system shall Navigation error envelopes omit storageKey and temp path.

**Witness**: app-dock-security.test.ts:603-616

### GOLDEN-090 (for REQ-090)
**Requirement**: If the system Renderer events expose storageKey, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:603-616

### GOLDEN-091 (for REQ-091)
**Requirement**: If the system Renderer events expose user data path, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:603-616

### GOLDEN-092 (for REQ-092)
**Requirement**: If the system Navigation error envelopes expose storage internals, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:603-616

## navigation-error-envelope: Navigation Error Envelope

### GOLDEN-093 (for REQ-093)
**Requirement**: The system shall Navigation error envelope is discriminated with tabID and generation.

**Witness**: app-dock-security.test.ts:603-611

### GOLDEN-094 (for REQ-094)
**Requirement**: The system shall Navigation error code is either blocked or failed.

**Witness**: app-dock-security.test.ts:603-611

### GOLDEN-095 (for REQ-095)
**Requirement**: The system shall Navigation error identity contains tabID (string) and generation (safe integer).

**Witness**: app-dock-security.test.ts:603-611

### GOLDEN-096 (for REQ-096)
**Requirement**: If the system Navigation error lacks discriminated identity, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:603-611

### GOLDEN-097 (for REQ-097)
**Requirement**: If the system Navigation error code is neither blocked nor failed, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:603-611

## view-lifecycle: View Lifecycle

### GOLDEN-098 (for REQ-098)
**Requirement**: The system shall Close destroys the WebContentsView immediately.

**Witness**: app-dock-security.test.ts:618-630

### GOLDEN-099 (for REQ-099)
**Requirement**: The system shall Closed identity emits no scheduled events after destruction (500ms grace).

**Witness**: app-dock-security.test.ts:618-630

### GOLDEN-100 (for REQ-100)
**Requirement**: If the system Closed WebContentsView remains alive, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:618-630

### GOLDEN-101 (for REQ-101)
**Requirement**: If the system Closed identity emits stale events after destruction, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:618-630

## profile-isolation: Profile Isolation and Deletion

### GOLDEN-102 (for REQ-102)
**Requirement**: The system shall Profile delete cancels and removes in-progress downloads.

**Witness**: app-dock-security.test.ts:632-685

### GOLDEN-103 (for REQ-103)
**Requirement**: The system shall Profile delete tombstones the old profile partition.

**Witness**: app-dock-security.test.ts:632-685

### GOLDEN-104 (for REQ-104)
**Requirement**: The system shall Fresh profile after delete has empty localStorage.

**Witness**: app-dock-security.test.ts:632-685

### GOLDEN-105 (for REQ-105)
**Requirement**: The system shall Delete profile blocks further open on that profile ID.

**Witness**: app-dock-security.test.ts:632-685

### GOLDEN-106 (for REQ-106)
**Requirement**: If the system Profile delete leaves downloads running, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:632-685

### GOLDEN-107 (for REQ-107)
**Requirement**: If the system Profile delete does not tombstone partition, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:632-685

### GOLDEN-108 (for REQ-108)
**Requirement**: If the system Fresh profile inherits deleted profile storage, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:632-685

## ipc-sender-validation: IPC Sender Validation

### GOLDEN-109 (for REQ-109)
**Requirement**: The system shall Malformed bounds are rejected with Invalid App Dock bounds.

**Witness**: app-dock-security.test.ts:691-707

### GOLDEN-110 (for REQ-110)
**Requirement**: The system shall Subframe IPC sender is rejected with Invalid App Dock sender.

**Witness**: app-dock-security.test.ts:691-707

### GOLDEN-111 (for REQ-111)
**Requirement**: If the system Malformed bounds are accepted, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:691-707

### GOLDEN-112 (for REQ-112)
**Requirement**: If the system Subframe IPC sender is accepted, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:691-707

## fullscreen-command-validation: Fullscreen and Command Validation

### GOLDEN-113 (for REQ-113)
**Requirement**: The system shall Non-boolean fullscreen state is rejected with Invalid App Dock fullscreen state.

**Witness**: app-dock-security.test.ts:709-720

### GOLDEN-114 (for REQ-114)
**Requirement**: The system shall Invalid command enum is rejected with Invalid App Dock command.

**Witness**: app-dock-security.test.ts:709-720

### GOLDEN-115 (for REQ-115)
**Requirement**: If the system Non-boolean fullscreen state is accepted, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:709-720

### GOLDEN-116 (for REQ-116)
**Requirement**: If the system Invalid command enum is accepted, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:709-720

## throttling: Hide/Select Throttling

### GOLDEN-117 (for REQ-117)
**Requirement**: The system shall Hide throttles a 25ms ticker to at most one tick in 300ms.

**Witness**: app-dock-security.test.ts:721-757

### GOLDEN-118 (for REQ-118)
**Requirement**: The system shall Select resumes three ticks within 200ms.

**Witness**: app-dock-security.test.ts:721-757

### GOLDEN-119 (for REQ-119)
**Requirement**: If the system Hidden ticker is not throttled, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:721-757

### GOLDEN-120 (for REQ-120)
**Requirement**: If the system Selected ticker does not resume within 200ms, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:721-757

## open-response-contract: Open Response Contract

### GOLDEN-121 (for REQ-121)
**Requirement**: The system shall IPC open response omits storageKey and path fields.

**Witness**: app-dock-security.test.ts:758-762

### GOLDEN-122 (for REQ-122)
**Requirement**: If the system IPC open response exposes storageKey or path, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:758-762

## state-event-identity: State Event Identity

### GOLDEN-123 (for REQ-123)
**Requirement**: The system shall State events carry tabID (string) and generation (safe integer).

**Witness**: app-dock-security.test.ts:763-771

### GOLDEN-124 (for REQ-124)
**Requirement**: If the system State events lack tabID or generation, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:763-771

## cross-window-profile-sharing: Cross-Window Profile Sharing

### GOLDEN-125 (for REQ-125)
**Requirement**: The system shall Two BrowserWindows opening the same profile create both views.

**Witness**: app-dock-security.test.ts:775-802

### GOLDEN-126 (for REQ-126)
**Requirement**: The system shall Profile delete from window A destroys views in both windows A and B.

**Witness**: app-dock-security.test.ts:775-802

### GOLDEN-127 (for REQ-127)
**Requirement**: The system shall Profile delete detaches views from both windows.

**Witness**: app-dock-security.test.ts:775-802

### GOLDEN-128 (for REQ-128)
**Requirement**: If the system Shared profile does not create both views, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:775-802

### GOLDEN-129 (for REQ-129)
**Requirement**: If the system Profile delete from A leaves B's view alive, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:775-802

### GOLDEN-130 (for REQ-130)
**Requirement**: If the system Profile delete leaves view attached in either window, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:775-802

## close-tabs-validation: Close-tabs Validation

### GOLDEN-131 (for REQ-131)
**Requirement**: The system shall close-tabs with invalid scope is rejected.

**Witness**: app-dock-security.test.ts:804-871

### GOLDEN-132 (for REQ-132)
**Requirement**: The system shall close-tabs others destroys only other tabs, keeps target.

**Witness**: app-dock-security.test.ts:804-871

### GOLDEN-133 (for REQ-133)
**Requirement**: The system shall close-tabs right validates complete visual order.

**Witness**: app-dock-security.test.ts:804-871

### GOLDEN-134 (for REQ-134)
**Requirement**: The system shall close-tabs right with wrong visual order is rejected.

**Witness**: app-dock-security.test.ts:804-871

### GOLDEN-135 (for REQ-135)
**Requirement**: The system shall close-tabs right with foreign tab in order is rejected.

**Witness**: app-dock-security.test.ts:804-871

### GOLDEN-136 (for REQ-136)
**Requirement**: The system shall close-tabs right with duplicate tabs in order is rejected.

**Witness**: app-dock-security.test.ts:804-871

### GOLDEN-137 (for REQ-137)
**Requirement**: The system shall close-tabs right closes only visual-right tabs.

**Witness**: app-dock-security.test.ts:804-871

### GOLDEN-138 (for REQ-138)
**Requirement**: If the system Invalid close-tabs scope is accepted, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:804-871

### GOLDEN-139 (for REQ-139)
**Requirement**: If the system close-tabs others destroys target, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:804-871

### GOLDEN-140 (for REQ-140)
**Requirement**: If the system close-tabs right accepts incomplete or wrong visual order, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:804-871

### GOLDEN-141 (for REQ-141)
**Requirement**: If the system close-tabs right closes non-right tabs, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:804-871

## https-popup: HTTPS Popup Handling

### GOLDEN-142 (for REQ-142)
**Requirement**: The system shall HTTPS window.open emits tab-opened with cloneable public identity (tabID, generation, url).

**Witness**: app-dock-security.test.ts:874-917

### GOLDEN-143 (for REQ-143)
**Requirement**: The system shall HTTPS popup creates second WebContentsView.

**Witness**: app-dock-security.test.ts:874-917

### GOLDEN-144 (for REQ-144)
**Requirement**: The system shall HTTPS popup target loads and is selected and attached.

**Witness**: app-dock-security.test.ts:874-917

### GOLDEN-145 (for REQ-145)
**Requirement**: The system shall Popup source view is hidden and detached.

**Witness**: app-dock-security.test.ts:874-917

### GOLDEN-146 (for REQ-146)
**Requirement**: If the system HTTPS popup does not emit tab-opened, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:874-917

### GOLDEN-147 (for REQ-147)
**Requirement**: If the system HTTPS popup does not create second view, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:874-917

### GOLDEN-148 (for REQ-148)
**Requirement**: If the system Popup target does not load or is not selected, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:874-917

### GOLDEN-149 (for REQ-149)
**Requirement**: If the system Popup source remains attached, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:874-917

## contract-field: Contract Field Minimality

### GOLDEN-150 (for REQ-150)
**Requirement**: The system shall Open and tab-opened contracts expose only tabID, generation, and URL.

**Witness**: app-dock-security.test.ts:928-972

### GOLDEN-151 (for REQ-151)
**Requirement**: The system shall Event envelopes omit legacy id and adapter fields.

**Witness**: app-dock-security.test.ts:928-972

### GOLDEN-152 (for REQ-152)
**Requirement**: The system shall State, tab-opened, and navigation-error events are cloneable public identities.

**Witness**: app-dock-security.test.ts:928-972

### GOLDEN-153 (for REQ-153)
**Requirement**: If the system Open or tab-opened exposes id, storageKey, path, or adapter fields, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:928-972

### GOLDEN-154 (for REQ-154)
**Requirement**: If the system Event envelopes expose legacy id or adapter fields, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:928-972

## restart-persistence: Restart Persistence

### GOLDEN-155 (for REQ-155)
**Requirement**: The system shall Fresh Electron main process preserves same profile localStorage and cookie.

**Witness**: app-dock-security.test.ts:973-980

### GOLDEN-156 (for REQ-156)
**Requirement**: The system shall Deleted profile tombstone survives restart and blocks old partition access.

**Witness**: app-dock-security.test.ts:973-980

### GOLDEN-157 (for REQ-157)
**Requirement**: The system shall Separate profiles retain isolated storage across fresh Electron main process.

**Witness**: app-dock-security.test.ts:973-980

### GOLDEN-158 (for REQ-158)
**Requirement**: If the system Profile localStorage or cookie lost on restart, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:973-980

### GOLDEN-159 (for REQ-159)
**Requirement**: If the system Deleted profile tombstone does not survive restart, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:973-980

### GOLDEN-160 (for REQ-160)
**Requirement**: If the system Separate profiles share storage across restart, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:973-980

## corrupt-registry: Corrupt Registry Fails Closed

### GOLDEN-161 (for REQ-161)
**Requirement**: The system shall Corrupt native registry fails closed without rebind and remains unchanged.

**Witness**: app-dock-security.test.ts:979

### GOLDEN-162 (for REQ-162)
**Requirement**: If the system Corrupt registry is silently rebind or modified, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:979

## renderer-crash-recovery: Renderer Crash Recovery

### GOLDEN-163 (for REQ-163)
**Requirement**: The system shall Real selected renderer crash emits tab-crashed with old identity and reason crashed/killed.

**Witness**: app-dock-security.test.ts:982-1051

### GOLDEN-164 (for REQ-164)
**Requirement**: The system shall IPC recovery creates same tabID/URL/profile with newer generation.

**Witness**: app-dock-security.test.ts:982-1051

### GOLDEN-165 (for REQ-165)
**Requirement**: The system shall Recovered selected tab is usable and preserves other tabs.

**Witness**: app-dock-security.test.ts:982-1051

### GOLDEN-166 (for REQ-166)
**Requirement**: The system shall Old crashed generation events are ignored after recovery.

**Witness**: app-dock-security.test.ts:982-1051

### GOLDEN-167 (for REQ-167)
**Requirement**: If the system Crash does not emit tab-crashed with old identity, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:982-1051

### GOLDEN-168 (for REQ-168)
**Requirement**: If the system Recovery does not create newer generation, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:982-1051

### GOLDEN-169 (for REQ-169)
**Requirement**: If the system Recovery does not preserve other tabs, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:982-1051

### GOLDEN-170 (for REQ-170)
**Requirement**: If the system Old generation events emitted after recovery, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:982-1051

## capacity-lru: Capacity LRU Eviction

### GOLDEN-171 (for REQ-171)
**Requirement**: The system shall 20 inactive views across two windows use global LRU.

**Witness**: app-dock-security.test.ts:1053-1095

### GOLDEN-172 (for REQ-172)
**Requirement**: The system shall Selecting A0 retains it while opening one more evicts older B0.

**Witness**: app-dock-security.test.ts:1053-1095

### GOLDEN-173 (for REQ-173)
**Requirement**: The system shall Active views remain usable during eviction.

**Witness**: app-dock-security.test.ts:1053-1095

### GOLDEN-174 (for REQ-174)
**Requirement**: The system shall Recently selected tab remains usable after eviction.

**Witness**: app-dock-security.test.ts:1053-1095

### GOLDEN-175 (for REQ-175)
**Requirement**: If the system LRU eviction displaces an active view, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:1053-1095

### GOLDEN-176 (for REQ-176)
**Requirement**: If the system Recently selected tab becomes unusable after eviction, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:1053-1095

### GOLDEN-177 (for REQ-177)
**Requirement**: If the system Global LRU not honored across windows, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:1053-1095

## download-limit: Download Limit

### GOLDEN-178 (for REQ-178)
**Requirement**: The system shall Nine real same-profile slow downloads admit eight progressing.

**Witness**: app-dock-security.test.ts:1097-1160

### GOLDEN-179 (for REQ-179)
**Requirement**: The system shall Ninth download is cancelled safely with failure event.

**Witness**: app-dock-security.test.ts:1097-1160

### GOLDEN-180 (for REQ-180)
**Requirement**: The system shall Download events expose no filesystem path.

**Witness**: app-dock-security.test.ts:1097-1160

### GOLDEN-181 (for REQ-181)
**Requirement**: If the system More than eight progressing downloads admitted, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:1097-1160

### GOLDEN-182 (for REQ-182)
**Requirement**: If the system Ninth download is not cancelled, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:1097-1160

### GOLDEN-183 (for REQ-183)
**Requirement**: If the system Download events expose filesystem path, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:1097-1160

## devtools-gate: DevTools Gate

### GOLDEN-184 (for REQ-184)
**Requirement**: The system shall App Dock DevTools do not open without trusted development route.

**Witness**: app-dock-security.test.ts:1162-1176

### GOLDEN-185 (for REQ-185)
**Requirement**: The system shall Ordinary user input (F12) does not open DevTools.

**Witness**: app-dock-security.test.ts:1162-1176

### GOLDEN-186 (for REQ-186)
**Requirement**: The system shall Trusted developmentMode()=true allows openDevTools.

**Witness**: app-dock-security.test.ts:1162-1176

### GOLDEN-187 (for REQ-187)
**Requirement**: If the system DevTools open without trusted route, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:1162-1176

### GOLDEN-188 (for REQ-188)
**Requirement**: If the system F12 opens DevTools in production mode, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:1162-1176

### GOLDEN-189 (for REQ-189)
**Requirement**: If the system developmentMode=true does not allow DevTools, then it shall refuse and return an error.

**Witness**: app-dock-security.test.ts:1162-1176

## profile-registry: Profile Registry

### GOLDEN-190 (for REQ-190)
**Requirement**: The system shall Profile ID must match ^[a-z0-9][a-z0-9-]{0,31}$.

**Witness**: app-dock-profile-registry.test.ts

### GOLDEN-191 (for REQ-191)
**Requirement**: The system shall Manifest validation rejects invalid profiles, tabs, bookmarks, history.

**Witness**: app-dock-profile-registry.test.ts

### GOLDEN-192 (for REQ-192)
**Requirement**: The system shall Registry load fails closed on corrupt data.

**Witness**: app-dock-profile-registry.test.ts

### GOLDEN-193 (for REQ-193)
**Requirement**: The system shall ensureActive creates new profile with UUID storageKey.

**Witness**: app-dock-profile-registry.test.ts

### GOLDEN-194 (for REQ-194)
**Requirement**: The system shall markDeleting transitions active→deleting, returns storageKey.

**Witness**: app-dock-profile-registry.test.ts

### GOLDEN-195 (for REQ-195)
**Requirement**: The system shall markDeleted transitions deleting→deleted, rewrites manifest and removes tabs.

**Witness**: app-dock-profile-registry.test.ts

### GOLDEN-196 (for REQ-196)
**Requirement**: The system shall replaceManifest enforces revision match and active profile set consistency.

**Witness**: app-dock-profile-registry.test.ts

### GOLDEN-197 (for REQ-197)
**Requirement**: If the system Registry accepts profile ID outside pattern, then it shall refuse and return an error.

**Witness**: app-dock-profile-registry.test.ts

### GOLDEN-198 (for REQ-198)
**Requirement**: If the system Registry accepts manifest exceeding internal limits, then it shall refuse and return an error.

**Witness**: app-dock-profile-registry.test.ts

### GOLDEN-199 (for REQ-199)
**Requirement**: If the system Corrupt registry loads without error, then it shall refuse and return an error.

**Witness**: app-dock-profile-registry.test.ts

### GOLDEN-200 (for REQ-200)
**Requirement**: If the system ensureActive creates profile without storageKey, then it shall refuse and return an error.

**Witness**: app-dock-profile-registry.test.ts

### GOLDEN-201 (for REQ-201)
**Requirement**: If the system markDeleting on deleted profile succeeds, then it shall refuse and return an error.

**Witness**: app-dock-profile-registry.test.ts

### GOLDEN-202 (for REQ-202)
**Requirement**: If the system markDeleted on non-deleting profile succeeds, then it shall refuse and return an error.

**Witness**: app-dock-profile-registry.test.ts

### GOLDEN-203 (for REQ-203)
**Requirement**: If the system replaceManifest accepts revision mismatch, then it shall refuse and return an error.

**Witness**: app-dock-profile-registry.test.ts

## dock-scroll: Dock Scroll

### GOLDEN-204 (for REQ-204)
**Requirement**: The system shall dock_scroll dispatches scroll and rejects invalid direction or amount.

**Witness**: app-dock-live.test.ts

### GOLDEN-205 (for REQ-205)
**Requirement**: The system shall RPC dispatch validates scroll direction against up, down, top, bottom.

**Witness**: app-dock-live.test.ts

### GOLDEN-206 (for REQ-206)
**Requirement**: If the system dock_scroll accepts invalid direction, then it shall refuse and return an error.

**Witness**: app-dock-live.test.ts

## dock-hover: Dock Hover

### GOLDEN-207 (for REQ-207)
**Requirement**: The system shall dock_hover dispatches mouseover on live element.

**Witness**: app-dock-live.test.ts

### GOLDEN-208 (for REQ-208)
**Requirement**: If the system dock_hover reports success on missing element ref, then it shall refuse and return an error.

**Witness**: app-dock-live.test.ts

## dock-click-at: Dock Click At Coordinates

### GOLDEN-209 (for REQ-209)
**Requirement**: The system shall dock_clickAt clicks live coordinates.

**Witness**: app-dock-live.test.ts

### GOLDEN-210 (for REQ-210)
**Requirement**: If the system dock_clickAt reports success with no element at coordinates, then it shall refuse and return an error.

**Witness**: app-dock-live.test.ts

## dock-drag: Dock Drag

### GOLDEN-211 (for REQ-211)
**Requirement**: The system shall dock_drag runs pointer drag sequence on live elements.

**Witness**: app-dock-live.test.ts

### GOLDEN-212 (for REQ-212)
**Requirement**: If the system dock_drag reports success with missing element ref, then it shall refuse and return an error.

**Witness**: app-dock-live.test.ts

## dock-scroll-to: Dock Scroll To

### GOLDEN-213 (for REQ-213)
**Requirement**: The system shall dock_scrollTo jumps to live coordinates.

**Witness**: app-dock-live.test.ts

### GOLDEN-214 (for REQ-214)
**Requirement**: If the system dock_scrollTo rejects valid coordinates, then it shall refuse and return an error.

**Witness**: app-dock-live.test.ts

## snapshot-shadow-dom: Snapshot Shadow DOM Piercing

### GOLDEN-215 (for REQ-215)
**Requirement**: The system shall dock_read pierces open shadow DOM in live snapshot.

**Witness**: app-dock-live.test.ts

### GOLDEN-216 (for REQ-216)
**Requirement**: If the system dock_read omits visible inputs inside open shadow roots, then it shall refuse and return an error.

**Witness**: app-dock-live.test.ts

## dock-youtube-llm: Dock YouTube LLM Drive

### GOLDEN-217 (for REQ-217)
**Requirement**: The system shall dock session drives dock_open, dock_read and dock_click against YouTube results via live model call.

**Witness**: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model)

### GOLDEN-218 (for REQ-218)
**Requirement**: The system shall live model turn produces final text answering with a video title.

**Witness**: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model)

### GOLDEN-219 (for REQ-219)
**Requirement**: The system shall dock_* tools are visible in the session tool list for the live model.

**Witness**: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model)

### GOLDEN-220 (for REQ-220)
**Requirement**: If the system dock session completes without invoking any dock_* tool, then it shall refuse and return an error.

**Witness**: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model)

### GOLDEN-221 (for REQ-221)
**Requirement**: If the system session tool list omits dock_* tools for the live model, then it shall refuse and return an error.

**Witness**: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model)

