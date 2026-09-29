# App-Dock Work-Package Cards

> One card per requirement and per golden. Cards are scheduled together — requirements without cards are orphans. Traceability closes mechanically.

## bounds-conversion: Bounds Conversion

### WP-001 (covers REQ-001 + GOLDEN-001)
**Invariant**: `bounds-conversion`
**Clause**: panelBoundsToContent converts CSS bounds to content bounds by dividing by zoom
**Witness**: app-dock-utils.test.ts:4-12
**Status**: ready (test exists on main)

### WP-002 (covers REQ-002 + GOLDEN-002)
**Invariant**: `bounds-conversion`
**Clause**: panelBoundsToContent rejects bounds with non-positive width or height
**Witness**: app-dock-utils.test.ts:4-12
**Status**: ready (test exists on main)

### WP-003 (covers REQ-003 + GOLDEN-003)
**Invariant**: `bounds-conversion`
**Clause**: panelBoundsToContent rejects zoom values that are not finite or not positive
**Witness**: app-dock-utils.test.ts:4-12
**Status**: ready (test exists on main)

### WP-004 (covers REQ-004 + GOLDEN-004)
**Invariant**: `bounds-conversion`
**Clause**: panelBoundsToContent rejects bounds that produce non-positive content bounds after division
**Witness**: app-dock-utils.test.ts:4-12
**Status**: ready (test exists on main)

### WP-005 (covers REQ-005 + GOLDEN-005)
**Invariant**: `bounds-conversion`
**Clause**: panelBoundsToContent rounds x, y, width, height after division
**Witness**: app-dock-utils.test.ts:4-12
**Status**: ready (test exists on main)

### WP-006 (covers REQ-006 + GOLDEN-006)
**Invariant**: `bounds-conversion`
**Unwanted**: panelBoundsToContent accepts zero or negative width or height
**Witness**: app-dock-utils.test.ts:4-12
**Status**: ready (test exists on main)

### WP-007 (covers REQ-007 + GOLDEN-007)
**Invariant**: `bounds-conversion`
**Unwanted**: panelBoundsToContent accepts non-finite or non-positive zoom
**Witness**: app-dock-utils.test.ts:4-12
**Status**: ready (test exists on main)

### WP-008 (covers REQ-008 + GOLDEN-008)
**Invariant**: `bounds-conversion`
**Unwanted**: panelBoundsToContent produces content bounds with zero or negative dimensions
**Witness**: app-dock-utils.test.ts:4-12
**Status**: ready (test exists on main)

## url-validation: URL Validation and Normalization

### WP-009 (covers REQ-009 + GOLDEN-009)
**Invariant**: `url-validation`
**Clause**: appDockURL accepts a valid HTTPS URL and returns it normalized
**Witness**: app-dock-utils.test.ts:14-22
**Status**: ready (test exists on main)

### WP-010 (covers REQ-010 + GOLDEN-010)
**Invariant**: `url-validation`
**Clause**: appDockURL accepts a bare domain and returns an HTTPS URL
**Witness**: app-dock-utils.test.ts:14-22
**Status**: ready (test exists on main)

### WP-011 (covers REQ-011 + GOLDEN-011)
**Invariant**: `url-validation`
**Clause**: appDockURL accepts a search term and returns a Google search HTTPS URL
**Witness**: app-dock-utils.test.ts:14-22
**Status**: ready (test exists on main)

### WP-012 (covers REQ-012 + GOLDEN-012)
**Invariant**: `url-validation`
**Clause**: appDockURL rejects empty or whitespace-only input
**Witness**: app-dock-utils.test.ts:14-22
**Status**: ready (test exists on main)

### WP-013 (covers REQ-013 + GOLDEN-013)
**Invariant**: `url-validation`
**Clause**: appDockURL rejects file: scheme
**Witness**: app-dock-utils.test.ts:14-22
**Status**: ready (test exists on main)

### WP-014 (covers REQ-014 + GOLDEN-014)
**Invariant**: `url-validation`
**Clause**: appDockURL rejects javascript: scheme
**Witness**: app-dock-utils.test.ts:14-22
**Status**: ready (test exists on main)

### WP-015 (covers REQ-015 + GOLDEN-015)
**Invariant**: `url-validation`
**Unwanted**: appDockURL accepts file: scheme URLs
**Witness**: app-dock-utils.test.ts:14-22
**Status**: ready (test exists on main)

### WP-016 (covers REQ-016 + GOLDEN-016)
**Invariant**: `url-validation`
**Unwanted**: appDockURL accepts javascript: scheme URLs
**Witness**: app-dock-utils.test.ts:14-22
**Status**: ready (test exists on main)

### WP-017 (covers REQ-017 + GOLDEN-017)
**Invariant**: `url-validation`
**Unwanted**: appDockURL accepts empty or whitespace-only input
**Witness**: app-dock-utils.test.ts:14-22
**Status**: ready (test exists on main)

## zoom-clamping: Zoom Clamping

### WP-018 (covers REQ-018 + GOLDEN-018)
**Invariant**: `zoom-clamping`
**Clause**: appDockZoom clamps values below 0.5 up to 0.5
**Witness**: app-dock-utils.test.ts:24-29
**Status**: ready (test exists on main)

### WP-019 (covers REQ-019 + GOLDEN-019)
**Invariant**: `zoom-clamping`
**Clause**: appDockZoom clamps values above 3 down to 3
**Witness**: app-dock-utils.test.ts:24-29
**Status**: ready (test exists on main)

### WP-020 (covers REQ-020 + GOLDEN-020)
**Invariant**: `zoom-clamping`
**Clause**: appDockZoom passes through values within [0.5, 3] unchanged
**Witness**: app-dock-utils.test.ts:24-29
**Status**: ready (test exists on main)

### WP-021 (covers REQ-021 + GOLDEN-021)
**Invariant**: `zoom-clamping`
**Clause**: appDockZoom throws on NaN or non-finite input
**Witness**: app-dock-utils.test.ts:24-29
**Status**: ready (test exists on main)

### WP-022 (covers REQ-022 + GOLDEN-022)
**Invariant**: `zoom-clamping`
**Unwanted**: appDockZoom accepts NaN or non-finite input
**Witness**: app-dock-utils.test.ts:24-29
**Status**: ready (test exists on main)

## rpc-bridge-dispatch: RPC Bridge Dispatch

### WP-023 (covers REQ-023 + GOLDEN-023)
**Invariant**: `rpc-bridge-dispatch`
**Clause**: handleDockRPC consumes only messages with type dock.rpc and ignores others
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-024 (covers REQ-024 + GOLDEN-024)
**Invariant**: `rpc-bridge-dispatch`
**Clause**: handleDockRPC returns true when it consumes a dock.rpc message
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-025 (covers REQ-025 + GOLDEN-025)
**Invariant**: `rpc-bridge-dispatch`
**Clause**: handleDockRPC returns false for non-dock messages
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-026 (covers REQ-026 + GOLDEN-026)
**Invariant**: `rpc-bridge-dispatch`
**Clause**: Unknown dock operations return an error result with ok:false
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-027 (covers REQ-027 + GOLDEN-027)
**Invariant**: `rpc-bridge-dispatch`
**Clause**: open with non-HTTPS address returns an error result mentioning HTTPS
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-028 (covers REQ-028 + GOLDEN-028)
**Invariant**: `rpc-bridge-dispatch`
**Clause**: open with valid HTTPS address returns ok:true with tabID and URL
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-029 (covers REQ-029 + GOLDEN-029)
**Invariant**: `rpc-bridge-dispatch`
**Clause**: list returns the opened tab with tabID and active:true
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-030 (covers REQ-030 + GOLDEN-030)
**Invariant**: `rpc-bridge-dispatch`
**Clause**: read returns a page snapshot with items containing refs for interactive elements
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-031 (covers REQ-031 + GOLDEN-031)
**Invariant**: `rpc-bridge-dispatch`
**Clause**: click on a button ref returns ok:true and mutates the live page
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-032 (covers REQ-032 + GOLDEN-032)
**Invariant**: `rpc-bridge-dispatch`
**Clause**: type on an input ref sets the value and reflects in subsequent snapshot
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-033 (covers REQ-033 + GOLDEN-033)
**Invariant**: `rpc-bridge-dispatch`
**Clause**: go reload returns ok:true and preserves the tab
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-034 (covers REQ-034 + GOLDEN-034)
**Invariant**: `rpc-bridge-dispatch`
**Clause**: close returns ok:true and empties the tab list
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-035 (covers REQ-035 + GOLDEN-035)
**Invariant**: `rpc-bridge-dispatch`
**Unwanted**: handleDockRPC consumes non-dock.rpc messages
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-036 (covers REQ-036 + GOLDEN-036)
**Invariant**: `rpc-bridge-dispatch`
**Unwanted**: Unknown operations return ok:true
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-037 (covers REQ-037 + GOLDEN-037)
**Invariant**: `rpc-bridge-dispatch`
**Unwanted**: Non-HTTPS open returns ok:true
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-038 (covers REQ-038 + GOLDEN-038)
**Invariant**: `rpc-bridge-dispatch`
**Unwanted**: Click or type reports failure on valid refs
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-039 (covers REQ-039 + GOLDEN-039)
**Invariant**: `rpc-bridge-dispatch`
**Unwanted**: go reload loses the tab
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

### WP-040 (covers REQ-040 + GOLDEN-040)
**Invariant**: `rpc-bridge-dispatch`
**Unwanted**: close leaves tabs in the list
**Witness**: app-dock-rpc.test.ts:103-145
**Status**: ready (test exists on main)

## browser-snapshot: Browser Snapshot Script

### WP-041 (covers REQ-041 + GOLDEN-041)
**Invariant**: `browser-snapshot`
**Clause**: buildSnapshotScript returns an object with url, title, viewport, items[], text
**Witness**: app-dock-tools.test.ts:86-105
**Status**: ready (test exists on main)

### WP-042 (covers REQ-042 + GOLDEN-042)
**Invariant**: `browser-snapshot`
**Clause**: items contains interactive elements with unique positive integer refs
**Witness**: app-dock-tools.test.ts:86-105
**Status**: ready (test exists on main)

### WP-043 (covers REQ-043 + GOLDEN-043)
**Invariant**: `browser-snapshot`
**Clause**: items includes element kinds: button, input, a, div (contenteditable), textarea
**Witness**: app-dock-tools.test.ts:86-105
**Status**: ready (test exists on main)

### WP-044 (covers REQ-044 + GOLDEN-044)
**Invariant**: `browser-snapshot`
**Clause**: Refs are stable across repeated snapshots of the same page
**Witness**: app-dock-tools.test.ts:86-105
**Status**: ready (test exists on main)

### WP-045 (covers REQ-045 + GOLDEN-045)
**Invariant**: `browser-snapshot`
**Clause**: Budget parameter clamps item count and sets truncated:true when exceeded
**Witness**: app-dock-tools.test.ts:86-105
**Status**: ready (test exists on main)

### WP-046 (covers REQ-046 + GOLDEN-046)
**Invariant**: `browser-snapshot`
**Unwanted**: Snapshot lacks url, title, viewport, items, or text
**Witness**: app-dock-tools.test.ts:86-105
**Status**: ready (test exists on main)

### WP-047 (covers REQ-047 + GOLDEN-047)
**Invariant**: `browser-snapshot`
**Unwanted**: Refs are not positive integers or are duplicated
**Witness**: app-dock-tools.test.ts:86-105
**Status**: ready (test exists on main)

### WP-048 (covers REQ-048 + GOLDEN-048)
**Invariant**: `browser-snapshot`
**Unwanted**: Hidden or aria-hidden inert elements appear in snapshot
**Witness**: app-dock-tools.test.ts:86-105
**Status**: ready (test exists on main)

### WP-049 (covers REQ-049 + GOLDEN-049)
**Invariant**: `browser-snapshot`
**Unwanted**: Budget cap is not honored or truncated flag is not set
**Witness**: app-dock-tools.test.ts:86-105
**Status**: ready (test exists on main)

## browser-click: Browser Click Script

### WP-050 (covers REQ-050 + GOLDEN-050)
**Invariant**: `browser-click`
**Clause**: buildClickScript dispatches a working pointer/mouse event sequence
**Witness**: app-dock-tools.test.ts:107-111
**Status**: ready (test exists on main)

### WP-051 (covers REQ-051 + GOLDEN-051)
**Invariant**: `browser-click`
**Clause**: Click on a button ref increments the counter in the live page
**Witness**: app-dock-tools.test.ts:107-111
**Status**: ready (test exists on main)

### WP-052 (covers REQ-052 + GOLDEN-052)
**Invariant**: `browser-click`
**Clause**: Click returns ok:true on success
**Witness**: app-dock-tools.test.ts:107-111
**Status**: ready (test exists on main)

### WP-053 (covers REQ-053 + GOLDEN-053)
**Invariant**: `browser-click`
**Unwanted**: Click returns ok:false on a valid ref
**Witness**: app-dock-tools.test.ts:107-111
**Status**: ready (test exists on main)

### WP-054 (covers REQ-054 + GOLDEN-054)
**Invariant**: `browser-click`
**Unwanted**: Click does not mutate the live page state
**Witness**: app-dock-tools.test.ts:107-111
**Status**: ready (test exists on main)

## browser-type: Browser Type Script

### WP-055 (covers REQ-055 + GOLDEN-055)
**Invariant**: `browser-type`
**Clause**: buildTypeScript sets input value via native setter
**Witness**: app-dock-tools.test.ts:113-128
**Status**: ready (test exists on main)

### WP-056 (covers REQ-056 + GOLDEN-056)
**Invariant**: `browser-type`
**Clause**: Type fires input and change events on the element
**Witness**: app-dock-tools.test.ts:113-128
**Status**: ready (test exists on main)

### WP-057 (covers REQ-057 + GOLDEN-057)
**Invariant**: `browser-type`
**Clause**: Type returns ok:true and the typed value
**Witness**: app-dock-tools.test.ts:113-128
**Status**: ready (test exists on main)

### WP-058 (covers REQ-058 + GOLDEN-058)
**Invariant**: `browser-type`
**Clause**: Type handles textarea and contenteditable targets
**Witness**: app-dock-tools.test.ts:113-128
**Status**: ready (test exists on main)

### WP-059 (covers REQ-059 + GOLDEN-059)
**Invariant**: `browser-type`
**Unwanted**: Type does not set the input value
**Witness**: app-dock-tools.test.ts:113-128
**Status**: ready (test exists on main)

### WP-060 (covers REQ-060 + GOLDEN-060)
**Invariant**: `browser-type`
**Unwanted**: Type does not fire input/change events
**Witness**: app-dock-tools.test.ts:113-128
**Status**: ready (test exists on main)

### WP-061 (covers REQ-061 + GOLDEN-061)
**Invariant**: `browser-type`
**Unwanted**: Type fails on textarea or contenteditable
**Witness**: app-dock-tools.test.ts:113-128
**Status**: ready (test exists on main)

## stale-ref-handling: Stale Ref Handling

### WP-062 (covers REQ-062 + GOLDEN-062)
**Invariant**: `stale-ref-handling`
**Clause**: Click on a removed element ref returns ok:false with error mentioning gone
**Witness**: app-dock-tools.test.ts:130-134
**Status**: ready (test exists on main)

### WP-063 (covers REQ-063 + GOLDEN-063)
**Invariant**: `stale-ref-handling`
**Unwanted**: Stale ref click returns ok:true
**Witness**: app-dock-tools.test.ts:130-134
**Status**: ready (test exists on main)

## https-only: HTTPS-Only Enforcement

### WP-064 (covers REQ-064 + GOLDEN-064)
**Invariant**: `https-only`
**Clause**: open rejects http, file, javascript, data schemes with HTTPS-only error
**Witness**: app-dock-security.test.ts:504-529
**Status**: ready (test exists on main)

### WP-065 (covers REQ-065 + GOLDEN-065)
**Invariant**: `https-only`
**Clause**: navigate rejects http, file, javascript, data schemes with HTTPS-only error
**Witness**: app-dock-security.test.ts:504-529
**Status**: ready (test exists on main)

### WP-066 (covers REQ-066 + GOLDEN-066)
**Invariant**: `https-only`
**Unwanted**: open accepts non-HTTPS schemes
**Witness**: app-dock-security.test.ts:504-529
**Status**: ready (test exists on main)

### WP-067 (covers REQ-067 + GOLDEN-067)
**Invariant**: `https-only`
**Unwanted**: navigate accepts non-HTTPS schemes
**Witness**: app-dock-security.test.ts:504-529
**Status**: ready (test exists on main)

## navigation-policy: Navigation Policy

### WP-068 (covers REQ-068 + GOLDEN-068)
**Invariant**: `navigation-policy`
**Clause**: Real window.open to non-HTTPS target is blocked with navigation-error
**Witness**: app-dock-security.test.ts:532-566
**Status**: ready (test exists on main)

### WP-069 (covers REQ-069 + GOLDEN-069)
**Invariant**: `navigation-policy`
**Clause**: Real main-frame navigation to non-HTTPS target is blocked
**Witness**: app-dock-security.test.ts:532-566
**Status**: ready (test exists on main)

### WP-070 (covers REQ-070 + GOLDEN-070)
**Invariant**: `navigation-policy`
**Clause**: Real HTTPS redirect to HTTP is blocked with navigation-error
**Witness**: app-dock-security.test.ts:532-566
**Status**: ready (test exists on main)

### WP-071 (covers REQ-071 + GOLDEN-071)
**Invariant**: `navigation-policy`
**Unwanted**: window.open to non-HTTPS succeeds
**Witness**: app-dock-security.test.ts:532-566
**Status**: ready (test exists on main)

### WP-072 (covers REQ-072 + GOLDEN-072)
**Invariant**: `navigation-policy`
**Unwanted**: Main-frame navigation to non-HTTPS succeeds
**Witness**: app-dock-security.test.ts:532-566
**Status**: ready (test exists on main)

### WP-073 (covers REQ-073 + GOLDEN-073)
**Invariant**: `navigation-policy`
**Unwanted**: HTTPS redirect to HTTP succeeds
**Witness**: app-dock-security.test.ts:532-566
**Status**: ready (test exists on main)

## webcontents-view-security: WebContentsView Security Policy

### WP-074 (covers REQ-074 + GOLDEN-074)
**Invariant**: `webcontents-view-security`
**Clause**: App Dock WebContentsView is created with sandbox:true
**Witness**: app-dock-security.test.ts:568-575
**Status**: ready (test exists on main)

### WP-075 (covers REQ-075 + GOLDEN-075)
**Invariant**: `webcontents-view-security`
**Clause**: App Dock WebContentsView is created with contextIsolation:true
**Witness**: app-dock-security.test.ts:568-575
**Status**: ready (test exists on main)

### WP-076 (covers REQ-076 + GOLDEN-076)
**Invariant**: `webcontents-view-security`
**Clause**: App Dock WebContentsView is created with nodeIntegration:false
**Witness**: app-dock-security.test.ts:568-575
**Status**: ready (test exists on main)

### WP-077 (covers REQ-077 + GOLDEN-077)
**Invariant**: `webcontents-view-security`
**Unwanted**: WebContentsView has sandbox:false
**Witness**: app-dock-security.test.ts:568-575
**Status**: ready (test exists on main)

### WP-078 (covers REQ-078 + GOLDEN-078)
**Invariant**: `webcontents-view-security`
**Unwanted**: WebContentsView has contextIsolation:false
**Witness**: app-dock-security.test.ts:568-575
**Status**: ready (test exists on main)

### WP-079 (covers REQ-079 + GOLDEN-079)
**Invariant**: `webcontents-view-security`
**Unwanted**: WebContentsView has nodeIntegration:true
**Witness**: app-dock-security.test.ts:568-575
**Status**: ready (test exists on main)

## permission-denial: Permission Denial

### WP-080 (covers REQ-080 + GOLDEN-080)
**Invariant**: `permission-denial`
**Clause**: Permission request is denied (state: denied)
**Witness**: app-dock-security.test.ts:577-601
**Status**: ready (test exists on main)

### WP-081 (covers REQ-081 + GOLDEN-081)
**Invariant**: `permission-denial`
**Clause**: Permission check returns denied
**Witness**: app-dock-security.test.ts:577-601
**Status**: ready (test exists on main)

### WP-082 (covers REQ-082 + GOLDEN-082)
**Invariant**: `permission-denial`
**Clause**: Permission denial emits App Dock UI state with identity and permission name
**Witness**: app-dock-security.test.ts:577-601
**Status**: ready (test exists on main)

### WP-083 (covers REQ-083 + GOLDEN-083)
**Invariant**: `permission-denial`
**Clause**: Permission event is cloneable and omits storage data
**Witness**: app-dock-security.test.ts:577-601
**Status**: ready (test exists on main)

### WP-084 (covers REQ-084 + GOLDEN-084)
**Invariant**: `permission-denial`
**Unwanted**: Permission request is granted
**Witness**: app-dock-security.test.ts:577-601
**Status**: ready (test exists on main)

### WP-085 (covers REQ-085 + GOLDEN-085)
**Invariant**: `permission-denial`
**Unwanted**: Permission check returns granted
**Witness**: app-dock-security.test.ts:577-601
**Status**: ready (test exists on main)

### WP-086 (covers REQ-086 + GOLDEN-086)
**Invariant**: `permission-denial`
**Unwanted**: Permission event exposes storageKey or user data path
**Witness**: app-dock-security.test.ts:577-601
**Status**: ready (test exists on main)

## event-envelope-sanitization: Event Envelope Sanitization

### WP-087 (covers REQ-087 + GOLDEN-087)
**Invariant**: `event-envelope-sanitization`
**Clause**: Renderer events omit storageKey
**Witness**: app-dock-security.test.ts:603-616
**Status**: ready (test exists on main)

### WP-088 (covers REQ-088 + GOLDEN-088)
**Invariant**: `event-envelope-sanitization`
**Clause**: Renderer events omit user data path (temp directory)
**Witness**: app-dock-security.test.ts:603-616
**Status**: ready (test exists on main)

### WP-089 (covers REQ-089 + GOLDEN-089)
**Invariant**: `event-envelope-sanitization`
**Clause**: Navigation error envelopes omit storageKey and temp path
**Witness**: app-dock-security.test.ts:603-616
**Status**: ready (test exists on main)

### WP-090 (covers REQ-090 + GOLDEN-090)
**Invariant**: `event-envelope-sanitization`
**Unwanted**: Renderer events expose storageKey
**Witness**: app-dock-security.test.ts:603-616
**Status**: ready (test exists on main)

### WP-091 (covers REQ-091 + GOLDEN-091)
**Invariant**: `event-envelope-sanitization`
**Unwanted**: Renderer events expose user data path
**Witness**: app-dock-security.test.ts:603-616
**Status**: ready (test exists on main)

### WP-092 (covers REQ-092 + GOLDEN-092)
**Invariant**: `event-envelope-sanitization`
**Unwanted**: Navigation error envelopes expose storage internals
**Witness**: app-dock-security.test.ts:603-616
**Status**: ready (test exists on main)

## navigation-error-envelope: Navigation Error Envelope

### WP-093 (covers REQ-093 + GOLDEN-093)
**Invariant**: `navigation-error-envelope`
**Clause**: Navigation error envelope is discriminated with tabID and generation
**Witness**: app-dock-security.test.ts:603-611
**Status**: ready (test exists on main)

### WP-094 (covers REQ-094 + GOLDEN-094)
**Invariant**: `navigation-error-envelope`
**Clause**: Navigation error code is either blocked or failed
**Witness**: app-dock-security.test.ts:603-611
**Status**: ready (test exists on main)

### WP-095 (covers REQ-095 + GOLDEN-095)
**Invariant**: `navigation-error-envelope`
**Clause**: Navigation error identity contains tabID (string) and generation (safe integer)
**Witness**: app-dock-security.test.ts:603-611
**Status**: ready (test exists on main)

### WP-096 (covers REQ-096 + GOLDEN-096)
**Invariant**: `navigation-error-envelope`
**Unwanted**: Navigation error lacks discriminated identity
**Witness**: app-dock-security.test.ts:603-611
**Status**: ready (test exists on main)

### WP-097 (covers REQ-097 + GOLDEN-097)
**Invariant**: `navigation-error-envelope`
**Unwanted**: Navigation error code is neither blocked nor failed
**Witness**: app-dock-security.test.ts:603-611
**Status**: ready (test exists on main)

## view-lifecycle: View Lifecycle

### WP-098 (covers REQ-098 + GOLDEN-098)
**Invariant**: `view-lifecycle`
**Clause**: Close destroys the WebContentsView immediately
**Witness**: app-dock-security.test.ts:618-630
**Status**: ready (test exists on main)

### WP-099 (covers REQ-099 + GOLDEN-099)
**Invariant**: `view-lifecycle`
**Clause**: Closed identity emits no scheduled events after destruction (500ms grace)
**Witness**: app-dock-security.test.ts:618-630
**Status**: ready (test exists on main)

### WP-100 (covers REQ-100 + GOLDEN-100)
**Invariant**: `view-lifecycle`
**Unwanted**: Closed WebContentsView remains alive
**Witness**: app-dock-security.test.ts:618-630
**Status**: ready (test exists on main)

### WP-101 (covers REQ-101 + GOLDEN-101)
**Invariant**: `view-lifecycle`
**Unwanted**: Closed identity emits stale events after destruction
**Witness**: app-dock-security.test.ts:618-630
**Status**: ready (test exists on main)

## profile-isolation: Profile Isolation and Deletion

### WP-102 (covers REQ-102 + GOLDEN-102)
**Invariant**: `profile-isolation`
**Clause**: Profile delete cancels and removes in-progress downloads
**Witness**: app-dock-security.test.ts:632-685
**Status**: ready (test exists on main)

### WP-103 (covers REQ-103 + GOLDEN-103)
**Invariant**: `profile-isolation`
**Clause**: Profile delete tombstones the old profile partition
**Witness**: app-dock-security.test.ts:632-685
**Status**: ready (test exists on main)

### WP-104 (covers REQ-104 + GOLDEN-104)
**Invariant**: `profile-isolation`
**Clause**: Fresh profile after delete has empty localStorage
**Witness**: app-dock-security.test.ts:632-685
**Status**: ready (test exists on main)

### WP-105 (covers REQ-105 + GOLDEN-105)
**Invariant**: `profile-isolation`
**Clause**: Delete profile blocks further open on that profile ID
**Witness**: app-dock-security.test.ts:632-685
**Status**: ready (test exists on main)

### WP-106 (covers REQ-106 + GOLDEN-106)
**Invariant**: `profile-isolation`
**Unwanted**: Profile delete leaves downloads running
**Witness**: app-dock-security.test.ts:632-685
**Status**: ready (test exists on main)

### WP-107 (covers REQ-107 + GOLDEN-107)
**Invariant**: `profile-isolation`
**Unwanted**: Profile delete does not tombstone partition
**Witness**: app-dock-security.test.ts:632-685
**Status**: ready (test exists on main)

### WP-108 (covers REQ-108 + GOLDEN-108)
**Invariant**: `profile-isolation`
**Unwanted**: Fresh profile inherits deleted profile storage
**Witness**: app-dock-security.test.ts:632-685
**Status**: ready (test exists on main)

## ipc-sender-validation: IPC Sender Validation

### WP-109 (covers REQ-109 + GOLDEN-109)
**Invariant**: `ipc-sender-validation`
**Clause**: Malformed bounds are rejected with Invalid App Dock bounds
**Witness**: app-dock-security.test.ts:691-707
**Status**: ready (test exists on main)

### WP-110 (covers REQ-110 + GOLDEN-110)
**Invariant**: `ipc-sender-validation`
**Clause**: Subframe IPC sender is rejected with Invalid App Dock sender
**Witness**: app-dock-security.test.ts:691-707
**Status**: ready (test exists on main)

### WP-111 (covers REQ-111 + GOLDEN-111)
**Invariant**: `ipc-sender-validation`
**Unwanted**: Malformed bounds are accepted
**Witness**: app-dock-security.test.ts:691-707
**Status**: ready (test exists on main)

### WP-112 (covers REQ-112 + GOLDEN-112)
**Invariant**: `ipc-sender-validation`
**Unwanted**: Subframe IPC sender is accepted
**Witness**: app-dock-security.test.ts:691-707
**Status**: ready (test exists on main)

## fullscreen-command-validation: Fullscreen and Command Validation

### WP-113 (covers REQ-113 + GOLDEN-113)
**Invariant**: `fullscreen-command-validation`
**Clause**: Non-boolean fullscreen state is rejected with Invalid App Dock fullscreen state
**Witness**: app-dock-security.test.ts:709-720
**Status**: ready (test exists on main)

### WP-114 (covers REQ-114 + GOLDEN-114)
**Invariant**: `fullscreen-command-validation`
**Clause**: Invalid command enum is rejected with Invalid App Dock command
**Witness**: app-dock-security.test.ts:709-720
**Status**: ready (test exists on main)

### WP-115 (covers REQ-115 + GOLDEN-115)
**Invariant**: `fullscreen-command-validation`
**Unwanted**: Non-boolean fullscreen state is accepted
**Witness**: app-dock-security.test.ts:709-720
**Status**: ready (test exists on main)

### WP-116 (covers REQ-116 + GOLDEN-116)
**Invariant**: `fullscreen-command-validation`
**Unwanted**: Invalid command enum is accepted
**Witness**: app-dock-security.test.ts:709-720
**Status**: ready (test exists on main)

## throttling: Hide/Select Throttling

### WP-117 (covers REQ-117 + GOLDEN-117)
**Invariant**: `throttling`
**Clause**: Hide throttles a 25ms ticker to at most one tick in 300ms
**Witness**: app-dock-security.test.ts:721-757
**Status**: ready (test exists on main)

### WP-118 (covers REQ-118 + GOLDEN-118)
**Invariant**: `throttling`
**Clause**: Select resumes three ticks within 200ms
**Witness**: app-dock-security.test.ts:721-757
**Status**: ready (test exists on main)

### WP-119 (covers REQ-119 + GOLDEN-119)
**Invariant**: `throttling`
**Unwanted**: Hidden ticker is not throttled
**Witness**: app-dock-security.test.ts:721-757
**Status**: ready (test exists on main)

### WP-120 (covers REQ-120 + GOLDEN-120)
**Invariant**: `throttling`
**Unwanted**: Selected ticker does not resume within 200ms
**Witness**: app-dock-security.test.ts:721-757
**Status**: ready (test exists on main)

## open-response-contract: Open Response Contract

### WP-121 (covers REQ-121 + GOLDEN-121)
**Invariant**: `open-response-contract`
**Clause**: IPC open response omits storageKey and path fields
**Witness**: app-dock-security.test.ts:758-762
**Status**: ready (test exists on main)

### WP-122 (covers REQ-122 + GOLDEN-122)
**Invariant**: `open-response-contract`
**Unwanted**: IPC open response exposes storageKey or path
**Witness**: app-dock-security.test.ts:758-762
**Status**: ready (test exists on main)

## state-event-identity: State Event Identity

### WP-123 (covers REQ-123 + GOLDEN-123)
**Invariant**: `state-event-identity`
**Clause**: State events carry tabID (string) and generation (safe integer)
**Witness**: app-dock-security.test.ts:763-771
**Status**: ready (test exists on main)

### WP-124 (covers REQ-124 + GOLDEN-124)
**Invariant**: `state-event-identity`
**Unwanted**: State events lack tabID or generation
**Witness**: app-dock-security.test.ts:763-771
**Status**: ready (test exists on main)

## cross-window-profile-sharing: Cross-Window Profile Sharing

### WP-125 (covers REQ-125 + GOLDEN-125)
**Invariant**: `cross-window-profile-sharing`
**Clause**: Two BrowserWindows opening the same profile create both views
**Witness**: app-dock-security.test.ts:775-802
**Status**: ready (test exists on main)

### WP-126 (covers REQ-126 + GOLDEN-126)
**Invariant**: `cross-window-profile-sharing`
**Clause**: Profile delete from window A destroys views in both windows A and B
**Witness**: app-dock-security.test.ts:775-802
**Status**: ready (test exists on main)

### WP-127 (covers REQ-127 + GOLDEN-127)
**Invariant**: `cross-window-profile-sharing`
**Clause**: Profile delete detaches views from both windows
**Witness**: app-dock-security.test.ts:775-802
**Status**: ready (test exists on main)

### WP-128 (covers REQ-128 + GOLDEN-128)
**Invariant**: `cross-window-profile-sharing`
**Unwanted**: Shared profile does not create both views
**Witness**: app-dock-security.test.ts:775-802
**Status**: ready (test exists on main)

### WP-129 (covers REQ-129 + GOLDEN-129)
**Invariant**: `cross-window-profile-sharing`
**Unwanted**: Profile delete from A leaves B's view alive
**Witness**: app-dock-security.test.ts:775-802
**Status**: ready (test exists on main)

### WP-130 (covers REQ-130 + GOLDEN-130)
**Invariant**: `cross-window-profile-sharing`
**Unwanted**: Profile delete leaves view attached in either window
**Witness**: app-dock-security.test.ts:775-802
**Status**: ready (test exists on main)

## close-tabs-validation: Close-tabs Validation

### WP-131 (covers REQ-131 + GOLDEN-131)
**Invariant**: `close-tabs-validation`
**Clause**: close-tabs with invalid scope is rejected
**Witness**: app-dock-security.test.ts:804-871
**Status**: ready (test exists on main)

### WP-132 (covers REQ-132 + GOLDEN-132)
**Invariant**: `close-tabs-validation`
**Clause**: close-tabs others destroys only other tabs, keeps target
**Witness**: app-dock-security.test.ts:804-871
**Status**: ready (test exists on main)

### WP-133 (covers REQ-133 + GOLDEN-133)
**Invariant**: `close-tabs-validation`
**Clause**: close-tabs right validates complete visual order
**Witness**: app-dock-security.test.ts:804-871
**Status**: ready (test exists on main)

### WP-134 (covers REQ-134 + GOLDEN-134)
**Invariant**: `close-tabs-validation`
**Clause**: close-tabs right with wrong visual order is rejected
**Witness**: app-dock-security.test.ts:804-871
**Status**: ready (test exists on main)

### WP-135 (covers REQ-135 + GOLDEN-135)
**Invariant**: `close-tabs-validation`
**Clause**: close-tabs right with foreign tab in order is rejected
**Witness**: app-dock-security.test.ts:804-871
**Status**: ready (test exists on main)

### WP-136 (covers REQ-136 + GOLDEN-136)
**Invariant**: `close-tabs-validation`
**Clause**: close-tabs right with duplicate tabs in order is rejected
**Witness**: app-dock-security.test.ts:804-871
**Status**: ready (test exists on main)

### WP-137 (covers REQ-137 + GOLDEN-137)
**Invariant**: `close-tabs-validation`
**Clause**: close-tabs right closes only visual-right tabs
**Witness**: app-dock-security.test.ts:804-871
**Status**: ready (test exists on main)

### WP-138 (covers REQ-138 + GOLDEN-138)
**Invariant**: `close-tabs-validation`
**Unwanted**: Invalid close-tabs scope is accepted
**Witness**: app-dock-security.test.ts:804-871
**Status**: ready (test exists on main)

### WP-139 (covers REQ-139 + GOLDEN-139)
**Invariant**: `close-tabs-validation`
**Unwanted**: close-tabs others destroys target
**Witness**: app-dock-security.test.ts:804-871
**Status**: ready (test exists on main)

### WP-140 (covers REQ-140 + GOLDEN-140)
**Invariant**: `close-tabs-validation`
**Unwanted**: close-tabs right accepts incomplete or wrong visual order
**Witness**: app-dock-security.test.ts:804-871
**Status**: ready (test exists on main)

### WP-141 (covers REQ-141 + GOLDEN-141)
**Invariant**: `close-tabs-validation`
**Unwanted**: close-tabs right closes non-right tabs
**Witness**: app-dock-security.test.ts:804-871
**Status**: ready (test exists on main)

## https-popup: HTTPS Popup Handling

### WP-142 (covers REQ-142 + GOLDEN-142)
**Invariant**: `https-popup`
**Clause**: HTTPS window.open emits tab-opened with cloneable public identity (tabID, generation, url)
**Witness**: app-dock-security.test.ts:874-917
**Status**: ready (test exists on main)

### WP-143 (covers REQ-143 + GOLDEN-143)
**Invariant**: `https-popup`
**Clause**: HTTPS popup creates second WebContentsView
**Witness**: app-dock-security.test.ts:874-917
**Status**: ready (test exists on main)

### WP-144 (covers REQ-144 + GOLDEN-144)
**Invariant**: `https-popup`
**Clause**: HTTPS popup target loads and is selected and attached
**Witness**: app-dock-security.test.ts:874-917
**Status**: ready (test exists on main)

### WP-145 (covers REQ-145 + GOLDEN-145)
**Invariant**: `https-popup`
**Clause**: Popup source view is hidden and detached
**Witness**: app-dock-security.test.ts:874-917
**Status**: ready (test exists on main)

### WP-146 (covers REQ-146 + GOLDEN-146)
**Invariant**: `https-popup`
**Unwanted**: HTTPS popup does not emit tab-opened
**Witness**: app-dock-security.test.ts:874-917
**Status**: ready (test exists on main)

### WP-147 (covers REQ-147 + GOLDEN-147)
**Invariant**: `https-popup`
**Unwanted**: HTTPS popup does not create second view
**Witness**: app-dock-security.test.ts:874-917
**Status**: ready (test exists on main)

### WP-148 (covers REQ-148 + GOLDEN-148)
**Invariant**: `https-popup`
**Unwanted**: Popup target does not load or is not selected
**Witness**: app-dock-security.test.ts:874-917
**Status**: ready (test exists on main)

### WP-149 (covers REQ-149 + GOLDEN-149)
**Invariant**: `https-popup`
**Unwanted**: Popup source remains attached
**Witness**: app-dock-security.test.ts:874-917
**Status**: ready (test exists on main)

## contract-field: Contract Field Minimality

### WP-150 (covers REQ-150 + GOLDEN-150)
**Invariant**: `contract-field`
**Clause**: Open and tab-opened contracts expose only tabID, generation, and URL
**Witness**: app-dock-security.test.ts:928-972
**Status**: ready (test exists on main)

### WP-151 (covers REQ-151 + GOLDEN-151)
**Invariant**: `contract-field`
**Clause**: Event envelopes omit legacy id and adapter fields
**Witness**: app-dock-security.test.ts:928-972
**Status**: ready (test exists on main)

### WP-152 (covers REQ-152 + GOLDEN-152)
**Invariant**: `contract-field`
**Clause**: State, tab-opened, and navigation-error events are cloneable public identities
**Witness**: app-dock-security.test.ts:928-972
**Status**: ready (test exists on main)

### WP-153 (covers REQ-153 + GOLDEN-153)
**Invariant**: `contract-field`
**Unwanted**: Open or tab-opened exposes id, storageKey, path, or adapter fields
**Witness**: app-dock-security.test.ts:928-972
**Status**: ready (test exists on main)

### WP-154 (covers REQ-154 + GOLDEN-154)
**Invariant**: `contract-field`
**Unwanted**: Event envelopes expose legacy id or adapter fields
**Witness**: app-dock-security.test.ts:928-972
**Status**: ready (test exists on main)

## restart-persistence: Restart Persistence

### WP-155 (covers REQ-155 + GOLDEN-155)
**Invariant**: `restart-persistence`
**Clause**: Fresh Electron main process preserves same profile localStorage and cookie
**Witness**: app-dock-security.test.ts:973-980
**Status**: ready (test exists on main)

### WP-156 (covers REQ-156 + GOLDEN-156)
**Invariant**: `restart-persistence`
**Clause**: Deleted profile tombstone survives restart and blocks old partition access
**Witness**: app-dock-security.test.ts:973-980
**Status**: ready (test exists on main)

### WP-157 (covers REQ-157 + GOLDEN-157)
**Invariant**: `restart-persistence`
**Clause**: Separate profiles retain isolated storage across fresh Electron main process
**Witness**: app-dock-security.test.ts:973-980
**Status**: ready (test exists on main)

### WP-158 (covers REQ-158 + GOLDEN-158)
**Invariant**: `restart-persistence`
**Unwanted**: Profile localStorage or cookie lost on restart
**Witness**: app-dock-security.test.ts:973-980
**Status**: ready (test exists on main)

### WP-159 (covers REQ-159 + GOLDEN-159)
**Invariant**: `restart-persistence`
**Unwanted**: Deleted profile tombstone does not survive restart
**Witness**: app-dock-security.test.ts:973-980
**Status**: ready (test exists on main)

### WP-160 (covers REQ-160 + GOLDEN-160)
**Invariant**: `restart-persistence`
**Unwanted**: Separate profiles share storage across restart
**Witness**: app-dock-security.test.ts:973-980
**Status**: ready (test exists on main)

## corrupt-registry: Corrupt Registry Fails Closed

### WP-161 (covers REQ-161 + GOLDEN-161)
**Invariant**: `corrupt-registry`
**Clause**: Corrupt native registry fails closed without rebind and remains unchanged
**Witness**: app-dock-security.test.ts:979
**Status**: ready (test exists on main)

### WP-162 (covers REQ-162 + GOLDEN-162)
**Invariant**: `corrupt-registry`
**Unwanted**: Corrupt registry is silently rebind or modified
**Witness**: app-dock-security.test.ts:979
**Status**: ready (test exists on main)

## renderer-crash-recovery: Renderer Crash Recovery

### WP-163 (covers REQ-163 + GOLDEN-163)
**Invariant**: `renderer-crash-recovery`
**Clause**: Real selected renderer crash emits tab-crashed with old identity and reason crashed/killed
**Witness**: app-dock-security.test.ts:982-1051
**Status**: ready (test exists on main)

### WP-164 (covers REQ-164 + GOLDEN-164)
**Invariant**: `renderer-crash-recovery`
**Clause**: IPC recovery creates same tabID/URL/profile with newer generation
**Witness**: app-dock-security.test.ts:982-1051
**Status**: ready (test exists on main)

### WP-165 (covers REQ-165 + GOLDEN-165)
**Invariant**: `renderer-crash-recovery`
**Clause**: Recovered selected tab is usable and preserves other tabs
**Witness**: app-dock-security.test.ts:982-1051
**Status**: ready (test exists on main)

### WP-166 (covers REQ-166 + GOLDEN-166)
**Invariant**: `renderer-crash-recovery`
**Clause**: Old crashed generation events are ignored after recovery
**Witness**: app-dock-security.test.ts:982-1051
**Status**: ready (test exists on main)

### WP-167 (covers REQ-167 + GOLDEN-167)
**Invariant**: `renderer-crash-recovery`
**Unwanted**: Crash does not emit tab-crashed with old identity
**Witness**: app-dock-security.test.ts:982-1051
**Status**: ready (test exists on main)

### WP-168 (covers REQ-168 + GOLDEN-168)
**Invariant**: `renderer-crash-recovery`
**Unwanted**: Recovery does not create newer generation
**Witness**: app-dock-security.test.ts:982-1051
**Status**: ready (test exists on main)

### WP-169 (covers REQ-169 + GOLDEN-169)
**Invariant**: `renderer-crash-recovery`
**Unwanted**: Recovery does not preserve other tabs
**Witness**: app-dock-security.test.ts:982-1051
**Status**: ready (test exists on main)

### WP-170 (covers REQ-170 + GOLDEN-170)
**Invariant**: `renderer-crash-recovery`
**Unwanted**: Old generation events emitted after recovery
**Witness**: app-dock-security.test.ts:982-1051
**Status**: ready (test exists on main)

## capacity-lru: Capacity LRU Eviction

### WP-171 (covers REQ-171 + GOLDEN-171)
**Invariant**: `capacity-lru`
**Clause**: 20 inactive views across two windows use global LRU
**Witness**: app-dock-security.test.ts:1053-1095
**Status**: ready (test exists on main)

### WP-172 (covers REQ-172 + GOLDEN-172)
**Invariant**: `capacity-lru`
**Clause**: Selecting A0 retains it while opening one more evicts older B0
**Witness**: app-dock-security.test.ts:1053-1095
**Status**: ready (test exists on main)

### WP-173 (covers REQ-173 + GOLDEN-173)
**Invariant**: `capacity-lru`
**Clause**: Active views remain usable during eviction
**Witness**: app-dock-security.test.ts:1053-1095
**Status**: ready (test exists on main)

### WP-174 (covers REQ-174 + GOLDEN-174)
**Invariant**: `capacity-lru`
**Clause**: Recently selected tab remains usable after eviction
**Witness**: app-dock-security.test.ts:1053-1095
**Status**: ready (test exists on main)

### WP-175 (covers REQ-175 + GOLDEN-175)
**Invariant**: `capacity-lru`
**Unwanted**: LRU eviction displaces an active view
**Witness**: app-dock-security.test.ts:1053-1095
**Status**: ready (test exists on main)

### WP-176 (covers REQ-176 + GOLDEN-176)
**Invariant**: `capacity-lru`
**Unwanted**: Recently selected tab becomes unusable after eviction
**Witness**: app-dock-security.test.ts:1053-1095
**Status**: ready (test exists on main)

### WP-177 (covers REQ-177 + GOLDEN-177)
**Invariant**: `capacity-lru`
**Unwanted**: Global LRU not honored across windows
**Witness**: app-dock-security.test.ts:1053-1095
**Status**: ready (test exists on main)

## download-limit: Download Limit

### WP-178 (covers REQ-178 + GOLDEN-178)
**Invariant**: `download-limit`
**Clause**: Nine real same-profile slow downloads admit eight progressing
**Witness**: app-dock-security.test.ts:1097-1160
**Status**: ready (test exists on main)

### WP-179 (covers REQ-179 + GOLDEN-179)
**Invariant**: `download-limit`
**Clause**: Ninth download is cancelled safely with failure event
**Witness**: app-dock-security.test.ts:1097-1160
**Status**: ready (test exists on main)

### WP-180 (covers REQ-180 + GOLDEN-180)
**Invariant**: `download-limit`
**Clause**: Download events expose no filesystem path
**Witness**: app-dock-security.test.ts:1097-1160
**Status**: ready (test exists on main)

### WP-181 (covers REQ-181 + GOLDEN-181)
**Invariant**: `download-limit`
**Unwanted**: More than eight progressing downloads admitted
**Witness**: app-dock-security.test.ts:1097-1160
**Status**: ready (test exists on main)

### WP-182 (covers REQ-182 + GOLDEN-182)
**Invariant**: `download-limit`
**Unwanted**: Ninth download is not cancelled
**Witness**: app-dock-security.test.ts:1097-1160
**Status**: ready (test exists on main)

### WP-183 (covers REQ-183 + GOLDEN-183)
**Invariant**: `download-limit`
**Unwanted**: Download events expose filesystem path
**Witness**: app-dock-security.test.ts:1097-1160
**Status**: ready (test exists on main)

## devtools-gate: DevTools Gate

### WP-184 (covers REQ-184 + GOLDEN-184)
**Invariant**: `devtools-gate`
**Clause**: App Dock DevTools do not open without trusted development route
**Witness**: app-dock-security.test.ts:1162-1176
**Status**: ready (test exists on main)

### WP-185 (covers REQ-185 + GOLDEN-185)
**Invariant**: `devtools-gate`
**Clause**: Ordinary user input (F12) does not open DevTools
**Witness**: app-dock-security.test.ts:1162-1176
**Status**: ready (test exists on main)

### WP-186 (covers REQ-186 + GOLDEN-186)
**Invariant**: `devtools-gate`
**Clause**: Trusted developmentMode()=true allows openDevTools
**Witness**: app-dock-security.test.ts:1162-1176
**Status**: ready (test exists on main)

### WP-187 (covers REQ-187 + GOLDEN-187)
**Invariant**: `devtools-gate`
**Unwanted**: DevTools open without trusted route
**Witness**: app-dock-security.test.ts:1162-1176
**Status**: ready (test exists on main)

### WP-188 (covers REQ-188 + GOLDEN-188)
**Invariant**: `devtools-gate`
**Unwanted**: F12 opens DevTools in production mode
**Witness**: app-dock-security.test.ts:1162-1176
**Status**: ready (test exists on main)

### WP-189 (covers REQ-189 + GOLDEN-189)
**Invariant**: `devtools-gate`
**Unwanted**: developmentMode=true does not allow DevTools
**Witness**: app-dock-security.test.ts:1162-1176
**Status**: ready (test exists on main)

## profile-registry: Profile Registry

### WP-190 (covers REQ-190 + GOLDEN-190)
**Invariant**: `profile-registry`
**Clause**: Profile ID must match ^[a-z0-9][a-z0-9-]{0,31}$
**Witness**: app-dock-profile-registry.test.ts
**Status**: ready (test exists on main)

### WP-191 (covers REQ-191 + GOLDEN-191)
**Invariant**: `profile-registry`
**Clause**: Manifest validation rejects invalid profiles, tabs, bookmarks, history
**Witness**: app-dock-profile-registry.test.ts
**Status**: ready (test exists on main)

### WP-192 (covers REQ-192 + GOLDEN-192)
**Invariant**: `profile-registry`
**Clause**: Registry load fails closed on corrupt data
**Witness**: app-dock-profile-registry.test.ts
**Status**: ready (test exists on main)

### WP-193 (covers REQ-193 + GOLDEN-193)
**Invariant**: `profile-registry`
**Clause**: ensureActive creates new profile with UUID storageKey
**Witness**: app-dock-profile-registry.test.ts
**Status**: ready (test exists on main)

### WP-194 (covers REQ-194 + GOLDEN-194)
**Invariant**: `profile-registry`
**Clause**: markDeleting transitions active→deleting, returns storageKey
**Witness**: app-dock-profile-registry.test.ts
**Status**: ready (test exists on main)

### WP-195 (covers REQ-195 + GOLDEN-195)
**Invariant**: `profile-registry`
**Clause**: markDeleted transitions deleting→deleted, rewrites manifest and removes tabs
**Witness**: app-dock-profile-registry.test.ts
**Status**: ready (test exists on main)

### WP-196 (covers REQ-196 + GOLDEN-196)
**Invariant**: `profile-registry`
**Clause**: replaceManifest enforces revision match and active profile set consistency
**Witness**: app-dock-profile-registry.test.ts
**Status**: ready (test exists on main)

### WP-197 (covers REQ-197 + GOLDEN-197)
**Invariant**: `profile-registry`
**Unwanted**: Registry accepts profile ID outside pattern
**Witness**: app-dock-profile-registry.test.ts
**Status**: ready (test exists on main)

### WP-198 (covers REQ-198 + GOLDEN-198)
**Invariant**: `profile-registry`
**Unwanted**: Registry accepts manifest exceeding internal limits
**Witness**: app-dock-profile-registry.test.ts
**Status**: ready (test exists on main)

### WP-199 (covers REQ-199 + GOLDEN-199)
**Invariant**: `profile-registry`
**Unwanted**: Corrupt registry loads without error
**Witness**: app-dock-profile-registry.test.ts
**Status**: ready (test exists on main)

### WP-200 (covers REQ-200 + GOLDEN-200)
**Invariant**: `profile-registry`
**Unwanted**: ensureActive creates profile without storageKey
**Witness**: app-dock-profile-registry.test.ts
**Status**: ready (test exists on main)

### WP-201 (covers REQ-201 + GOLDEN-201)
**Invariant**: `profile-registry`
**Unwanted**: markDeleting on deleted profile succeeds
**Witness**: app-dock-profile-registry.test.ts
**Status**: ready (test exists on main)

### WP-202 (covers REQ-202 + GOLDEN-202)
**Invariant**: `profile-registry`
**Unwanted**: markDeleted on non-deleting profile succeeds
**Witness**: app-dock-profile-registry.test.ts
**Status**: ready (test exists on main)

### WP-203 (covers REQ-203 + GOLDEN-203)
**Invariant**: `profile-registry`
**Unwanted**: replaceManifest accepts revision mismatch
**Witness**: app-dock-profile-registry.test.ts
**Status**: ready (test exists on main)

## dock-scroll: Dock Scroll

### WP-204 (covers REQ-204 + GOLDEN-204)
**Invariant**: `dock-scroll`
**Clause**: dock_scroll dispatches scroll and rejects invalid direction or amount
**Witness**: app-dock-live.test.ts
**Status**: ready (test exists on main)

### WP-205 (covers REQ-205 + GOLDEN-205)
**Invariant**: `dock-scroll`
**Clause**: RPC dispatch validates scroll direction against up, down, top, bottom
**Witness**: app-dock-live.test.ts
**Status**: ready (test exists on main)

### WP-206 (covers REQ-206 + GOLDEN-206)
**Invariant**: `dock-scroll`
**Unwanted**: dock_scroll accepts invalid direction
**Witness**: app-dock-live.test.ts
**Status**: ready (test exists on main)

## dock-hover: Dock Hover

### WP-207 (covers REQ-207 + GOLDEN-207)
**Invariant**: `dock-hover`
**Clause**: dock_hover dispatches mouseover on live element
**Witness**: app-dock-live.test.ts
**Status**: ready (test exists on main)

### WP-208 (covers REQ-208 + GOLDEN-208)
**Invariant**: `dock-hover`
**Unwanted**: dock_hover reports success on missing element ref
**Witness**: app-dock-live.test.ts
**Status**: ready (test exists on main)

## dock-click-at: Dock Click At Coordinates

### WP-209 (covers REQ-209 + GOLDEN-209)
**Invariant**: `dock-click-at`
**Clause**: dock_clickAt clicks live coordinates
**Witness**: app-dock-live.test.ts
**Status**: ready (test exists on main)

### WP-210 (covers REQ-210 + GOLDEN-210)
**Invariant**: `dock-click-at`
**Unwanted**: dock_clickAt reports success with no element at coordinates
**Witness**: app-dock-live.test.ts
**Status**: ready (test exists on main)

## dock-drag: Dock Drag

### WP-211 (covers REQ-211 + GOLDEN-211)
**Invariant**: `dock-drag`
**Clause**: dock_drag runs pointer drag sequence on live elements
**Witness**: app-dock-live.test.ts
**Status**: ready (test exists on main)

### WP-212 (covers REQ-212 + GOLDEN-212)
**Invariant**: `dock-drag`
**Unwanted**: dock_drag reports success with missing element ref
**Witness**: app-dock-live.test.ts
**Status**: ready (test exists on main)

## dock-scroll-to: Dock Scroll To

### WP-213 (covers REQ-213 + GOLDEN-213)
**Invariant**: `dock-scroll-to`
**Clause**: dock_scrollTo jumps to live coordinates
**Witness**: app-dock-live.test.ts
**Status**: ready (test exists on main)

### WP-214 (covers REQ-214 + GOLDEN-214)
**Invariant**: `dock-scroll-to`
**Unwanted**: dock_scrollTo rejects valid coordinates
**Witness**: app-dock-live.test.ts
**Status**: ready (test exists on main)

## snapshot-shadow-dom: Snapshot Shadow DOM Piercing

### WP-215 (covers REQ-215 + GOLDEN-215)
**Invariant**: `snapshot-shadow-dom`
**Clause**: dock_read pierces open shadow DOM in live snapshot
**Witness**: app-dock-live.test.ts
**Status**: ready (test exists on main)

### WP-216 (covers REQ-216 + GOLDEN-216)
**Invariant**: `snapshot-shadow-dom`
**Unwanted**: dock_read omits visible inputs inside open shadow roots
**Witness**: app-dock-live.test.ts
**Status**: ready (test exists on main)

## dock-youtube-llm: Dock YouTube LLM Drive

### WP-217 (covers REQ-217 + GOLDEN-217)
**Invariant**: `dock-youtube-llm`
**Clause**: dock session drives dock_open, dock_read and dock_click against YouTube results via live model call
**Witness**: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model)
**Status**: ready (test exists on main)

### WP-218 (covers REQ-218 + GOLDEN-218)
**Invariant**: `dock-youtube-llm`
**Clause**: live model turn produces final text answering with a video title
**Witness**: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model)
**Status**: ready (test exists on main)

### WP-219 (covers REQ-219 + GOLDEN-219)
**Invariant**: `dock-youtube-llm`
**Clause**: dock_* tools are visible in the session tool list for the live model
**Witness**: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model)
**Status**: ready (test exists on main)

### WP-220 (covers REQ-220 + GOLDEN-220)
**Invariant**: `dock-youtube-llm`
**Unwanted**: dock session completes without invoking any dock_* tool
**Witness**: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model)
**Status**: ready (test exists on main)

### WP-221 (covers REQ-221 + GOLDEN-221)
**Invariant**: `dock-youtube-llm`
**Unwanted**: session tool list omits dock_* tools for the live model
**Witness**: app-dock-youtube.test.ts (opt-in: APP_DOCK_YOUTUBE=1, OPENCODE_AUTH_CONTENT, APP_DOCK_YOUTUBE_MODEL=provider/model; skipped otherwise; Y03/Y04 need a tool-capable funded model)
**Status**: ready (test exists on main)

