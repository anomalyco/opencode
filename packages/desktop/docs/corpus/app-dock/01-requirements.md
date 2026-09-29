# App-Dock Requirements

> Generated from invariant register. Each requirement is a plain `shall` sentence quoting its clause verbatim. Each `unwanted` becomes an `If-then` refusal requirement.

## bounds-conversion: Bounds Conversion

### REQ-001
The system **shall** panelBoundsToContent converts CSS bounds to content bounds by dividing by zoom. *(from invariant `bounds-conversion`)*

### REQ-002
The system **shall** panelBoundsToContent rejects bounds with non-positive width or height. *(from invariant `bounds-conversion`)*

### REQ-003
The system **shall** panelBoundsToContent rejects zoom values that are not finite or not positive. *(from invariant `bounds-conversion`)*

### REQ-004
The system **shall** panelBoundsToContent rejects bounds that produce non-positive content bounds after division. *(from invariant `bounds-conversion`)*

### REQ-005
The system **shall** panelBoundsToContent rounds x, y, width, height after division. *(from invariant `bounds-conversion`)*

### REQ-006
If the system panelBoundsToContent accepts zero or negative width or height, then it **shall refuse** and return an error. *(from invariant `bounds-conversion` unwanted)*

### REQ-007
If the system panelBoundsToContent accepts non-finite or non-positive zoom, then it **shall refuse** and return an error. *(from invariant `bounds-conversion` unwanted)*

### REQ-008
If the system panelBoundsToContent produces content bounds with zero or negative dimensions, then it **shall refuse** and return an error. *(from invariant `bounds-conversion` unwanted)*

## url-validation: URL Validation and Normalization

### REQ-009
The system **shall** appDockURL accepts a valid HTTPS URL and returns it normalized. *(from invariant `url-validation`)*

### REQ-010
The system **shall** appDockURL accepts a bare domain and returns an HTTPS URL. *(from invariant `url-validation`)*

### REQ-011
The system **shall** appDockURL accepts a search term and returns a Google search HTTPS URL. *(from invariant `url-validation`)*

### REQ-012
The system **shall** appDockURL rejects empty or whitespace-only input. *(from invariant `url-validation`)*

### REQ-013
The system **shall** appDockURL rejects file: scheme. *(from invariant `url-validation`)*

### REQ-014
The system **shall** appDockURL rejects javascript: scheme. *(from invariant `url-validation`)*

### REQ-015
If the system appDockURL accepts file: scheme URLs, then it **shall refuse** and return an error. *(from invariant `url-validation` unwanted)*

### REQ-016
If the system appDockURL accepts javascript: scheme URLs, then it **shall refuse** and return an error. *(from invariant `url-validation` unwanted)*

### REQ-017
If the system appDockURL accepts empty or whitespace-only input, then it **shall refuse** and return an error. *(from invariant `url-validation` unwanted)*

## zoom-clamping: Zoom Clamping

### REQ-018
The system **shall** appDockZoom clamps values below 0.5 up to 0.5. *(from invariant `zoom-clamping`)*

### REQ-019
The system **shall** appDockZoom clamps values above 3 down to 3. *(from invariant `zoom-clamping`)*

### REQ-020
The system **shall** appDockZoom passes through values within [0.5, 3] unchanged. *(from invariant `zoom-clamping`)*

### REQ-021
The system **shall** appDockZoom throws on NaN or non-finite input. *(from invariant `zoom-clamping`)*

### REQ-022
If the system appDockZoom accepts NaN or non-finite input, then it **shall refuse** and return an error. *(from invariant `zoom-clamping` unwanted)*

## rpc-bridge-dispatch: RPC Bridge Dispatch

### REQ-023
The system **shall** handleDockRPC consumes only messages with type dock.rpc and ignores others. *(from invariant `rpc-bridge-dispatch`)*

### REQ-024
The system **shall** handleDockRPC returns true when it consumes a dock.rpc message. *(from invariant `rpc-bridge-dispatch`)*

### REQ-025
The system **shall** handleDockRPC returns false for non-dock messages. *(from invariant `rpc-bridge-dispatch`)*

### REQ-026
The system **shall** Unknown dock operations return an error result with ok:false. *(from invariant `rpc-bridge-dispatch`)*

### REQ-027
The system **shall** open with non-HTTPS address returns an error result mentioning HTTPS. *(from invariant `rpc-bridge-dispatch`)*

### REQ-028
The system **shall** open with valid HTTPS address returns ok:true with tabID and URL. *(from invariant `rpc-bridge-dispatch`)*

### REQ-029
The system **shall** list returns the opened tab with tabID and active:true. *(from invariant `rpc-bridge-dispatch`)*

### REQ-030
The system **shall** read returns a page snapshot with items containing refs for interactive elements. *(from invariant `rpc-bridge-dispatch`)*

### REQ-031
The system **shall** click on a button ref returns ok:true and mutates the live page. *(from invariant `rpc-bridge-dispatch`)*

### REQ-032
The system **shall** type on an input ref sets the value and reflects in subsequent snapshot. *(from invariant `rpc-bridge-dispatch`)*

### REQ-033
The system **shall** go reload returns ok:true and preserves the tab. *(from invariant `rpc-bridge-dispatch`)*

### REQ-034
The system **shall** close returns ok:true and empties the tab list. *(from invariant `rpc-bridge-dispatch`)*

### REQ-035
If the system handleDockRPC consumes non-dock.rpc messages, then it **shall refuse** and return an error. *(from invariant `rpc-bridge-dispatch` unwanted)*

### REQ-036
If the system Unknown operations return ok:true, then it **shall refuse** and return an error. *(from invariant `rpc-bridge-dispatch` unwanted)*

### REQ-037
If the system Non-HTTPS open returns ok:true, then it **shall refuse** and return an error. *(from invariant `rpc-bridge-dispatch` unwanted)*

### REQ-038
If the system Click or type reports failure on valid refs, then it **shall refuse** and return an error. *(from invariant `rpc-bridge-dispatch` unwanted)*

### REQ-039
If the system go reload loses the tab, then it **shall refuse** and return an error. *(from invariant `rpc-bridge-dispatch` unwanted)*

### REQ-040
If the system close leaves tabs in the list, then it **shall refuse** and return an error. *(from invariant `rpc-bridge-dispatch` unwanted)*

## browser-snapshot: Browser Snapshot Script

### REQ-041
The system **shall** buildSnapshotScript returns an object with url, title, viewport, items[], text. *(from invariant `browser-snapshot`)*

### REQ-042
The system **shall** items contains interactive elements with unique positive integer refs. *(from invariant `browser-snapshot`)*

### REQ-043
The system **shall** items includes element kinds: button, input, a, div (contenteditable), textarea. *(from invariant `browser-snapshot`)*

### REQ-044
The system **shall** Refs are stable across repeated snapshots of the same page. *(from invariant `browser-snapshot`)*

### REQ-045
The system **shall** Budget parameter clamps item count and sets truncated:true when exceeded. *(from invariant `browser-snapshot`)*

### REQ-046
If the system Snapshot lacks url, title, viewport, items, or text, then it **shall refuse** and return an error. *(from invariant `browser-snapshot` unwanted)*

### REQ-047
If the system Refs are not positive integers or are duplicated, then it **shall refuse** and return an error. *(from invariant `browser-snapshot` unwanted)*

### REQ-048
If the system Hidden or aria-hidden inert elements appear in snapshot, then it **shall refuse** and return an error. *(from invariant `browser-snapshot` unwanted)*

### REQ-049
If the system Budget cap is not honored or truncated flag is not set, then it **shall refuse** and return an error. *(from invariant `browser-snapshot` unwanted)*

## browser-click: Browser Click Script

### REQ-050
The system **shall** buildClickScript dispatches a working pointer/mouse event sequence. *(from invariant `browser-click`)*

### REQ-051
The system **shall** Click on a button ref increments the counter in the live page. *(from invariant `browser-click`)*

### REQ-052
The system **shall** Click returns ok:true on success. *(from invariant `browser-click`)*

### REQ-053
If the system Click returns ok:false on a valid ref, then it **shall refuse** and return an error. *(from invariant `browser-click` unwanted)*

### REQ-054
If the system Click does not mutate the live page state, then it **shall refuse** and return an error. *(from invariant `browser-click` unwanted)*

## browser-type: Browser Type Script

### REQ-055
The system **shall** buildTypeScript sets input value via native setter. *(from invariant `browser-type`)*

### REQ-056
The system **shall** Type fires input and change events on the element. *(from invariant `browser-type`)*

### REQ-057
The system **shall** Type returns ok:true and the typed value. *(from invariant `browser-type`)*

### REQ-058
The system **shall** Type handles textarea and contenteditable targets. *(from invariant `browser-type`)*

### REQ-059
If the system Type does not set the input value, then it **shall refuse** and return an error. *(from invariant `browser-type` unwanted)*

### REQ-060
If the system Type does not fire input/change events, then it **shall refuse** and return an error. *(from invariant `browser-type` unwanted)*

### REQ-061
If the system Type fails on textarea or contenteditable, then it **shall refuse** and return an error. *(from invariant `browser-type` unwanted)*

## stale-ref-handling: Stale Ref Handling

### REQ-062
The system **shall** Click on a removed element ref returns ok:false with error mentioning gone. *(from invariant `stale-ref-handling`)*

### REQ-063
If the system Stale ref click returns ok:true, then it **shall refuse** and return an error. *(from invariant `stale-ref-handling` unwanted)*

## https-only: HTTPS-Only Enforcement

### REQ-064
The system **shall** open rejects http, file, javascript, data schemes with HTTPS-only error. *(from invariant `https-only`)*

### REQ-065
The system **shall** navigate rejects http, file, javascript, data schemes with HTTPS-only error. *(from invariant `https-only`)*

### REQ-066
If the system open accepts non-HTTPS schemes, then it **shall refuse** and return an error. *(from invariant `https-only` unwanted)*

### REQ-067
If the system navigate accepts non-HTTPS schemes, then it **shall refuse** and return an error. *(from invariant `https-only` unwanted)*

## navigation-policy: Navigation Policy

### REQ-068
The system **shall** Real window.open to non-HTTPS target is blocked with navigation-error. *(from invariant `navigation-policy`)*

### REQ-069
The system **shall** Real main-frame navigation to non-HTTPS target is blocked. *(from invariant `navigation-policy`)*

### REQ-070
The system **shall** Real HTTPS redirect to HTTP is blocked with navigation-error. *(from invariant `navigation-policy`)*

### REQ-071
If the system window.open to non-HTTPS succeeds, then it **shall refuse** and return an error. *(from invariant `navigation-policy` unwanted)*

### REQ-072
If the system Main-frame navigation to non-HTTPS succeeds, then it **shall refuse** and return an error. *(from invariant `navigation-policy` unwanted)*

### REQ-073
If the system HTTPS redirect to HTTP succeeds, then it **shall refuse** and return an error. *(from invariant `navigation-policy` unwanted)*

## webcontents-view-security: WebContentsView Security Policy

### REQ-074
The system **shall** App Dock WebContentsView is created with sandbox:true. *(from invariant `webcontents-view-security`)*

### REQ-075
The system **shall** App Dock WebContentsView is created with contextIsolation:true. *(from invariant `webcontents-view-security`)*

### REQ-076
The system **shall** App Dock WebContentsView is created with nodeIntegration:false. *(from invariant `webcontents-view-security`)*

### REQ-077
If the system WebContentsView has sandbox:false, then it **shall refuse** and return an error. *(from invariant `webcontents-view-security` unwanted)*

### REQ-078
If the system WebContentsView has contextIsolation:false, then it **shall refuse** and return an error. *(from invariant `webcontents-view-security` unwanted)*

### REQ-079
If the system WebContentsView has nodeIntegration:true, then it **shall refuse** and return an error. *(from invariant `webcontents-view-security` unwanted)*

## permission-denial: Permission Denial

### REQ-080
The system **shall** Permission request is denied (state: denied). *(from invariant `permission-denial`)*

### REQ-081
The system **shall** Permission check returns denied. *(from invariant `permission-denial`)*

### REQ-082
The system **shall** Permission denial emits App Dock UI state with identity and permission name. *(from invariant `permission-denial`)*

### REQ-083
The system **shall** Permission event is cloneable and omits storage data. *(from invariant `permission-denial`)*

### REQ-084
If the system Permission request is granted, then it **shall refuse** and return an error. *(from invariant `permission-denial` unwanted)*

### REQ-085
If the system Permission check returns granted, then it **shall refuse** and return an error. *(from invariant `permission-denial` unwanted)*

### REQ-086
If the system Permission event exposes storageKey or user data path, then it **shall refuse** and return an error. *(from invariant `permission-denial` unwanted)*

## event-envelope-sanitization: Event Envelope Sanitization

### REQ-087
The system **shall** Renderer events omit storageKey. *(from invariant `event-envelope-sanitization`)*

### REQ-088
The system **shall** Renderer events omit user data path (temp directory). *(from invariant `event-envelope-sanitization`)*

### REQ-089
The system **shall** Navigation error envelopes omit storageKey and temp path. *(from invariant `event-envelope-sanitization`)*

### REQ-090
If the system Renderer events expose storageKey, then it **shall refuse** and return an error. *(from invariant `event-envelope-sanitization` unwanted)*

### REQ-091
If the system Renderer events expose user data path, then it **shall refuse** and return an error. *(from invariant `event-envelope-sanitization` unwanted)*

### REQ-092
If the system Navigation error envelopes expose storage internals, then it **shall refuse** and return an error. *(from invariant `event-envelope-sanitization` unwanted)*

## navigation-error-envelope: Navigation Error Envelope

### REQ-093
The system **shall** Navigation error envelope is discriminated with tabID and generation. *(from invariant `navigation-error-envelope`)*

### REQ-094
The system **shall** Navigation error code is either blocked or failed. *(from invariant `navigation-error-envelope`)*

### REQ-095
The system **shall** Navigation error identity contains tabID (string) and generation (safe integer). *(from invariant `navigation-error-envelope`)*

### REQ-096
If the system Navigation error lacks discriminated identity, then it **shall refuse** and return an error. *(from invariant `navigation-error-envelope` unwanted)*

### REQ-097
If the system Navigation error code is neither blocked nor failed, then it **shall refuse** and return an error. *(from invariant `navigation-error-envelope` unwanted)*

## view-lifecycle: View Lifecycle

### REQ-098
The system **shall** Close destroys the WebContentsView immediately. *(from invariant `view-lifecycle`)*

### REQ-099
The system **shall** Closed identity emits no scheduled events after destruction (500ms grace). *(from invariant `view-lifecycle`)*

### REQ-100
If the system Closed WebContentsView remains alive, then it **shall refuse** and return an error. *(from invariant `view-lifecycle` unwanted)*

### REQ-101
If the system Closed identity emits stale events after destruction, then it **shall refuse** and return an error. *(from invariant `view-lifecycle` unwanted)*

## profile-isolation: Profile Isolation and Deletion

### REQ-102
The system **shall** Profile delete cancels and removes in-progress downloads. *(from invariant `profile-isolation`)*

### REQ-103
The system **shall** Profile delete tombstones the old profile partition. *(from invariant `profile-isolation`)*

### REQ-104
The system **shall** Fresh profile after delete has empty localStorage. *(from invariant `profile-isolation`)*

### REQ-105
The system **shall** Delete profile blocks further open on that profile ID. *(from invariant `profile-isolation`)*

### REQ-106
If the system Profile delete leaves downloads running, then it **shall refuse** and return an error. *(from invariant `profile-isolation` unwanted)*

### REQ-107
If the system Profile delete does not tombstone partition, then it **shall refuse** and return an error. *(from invariant `profile-isolation` unwanted)*

### REQ-108
If the system Fresh profile inherits deleted profile storage, then it **shall refuse** and return an error. *(from invariant `profile-isolation` unwanted)*

## ipc-sender-validation: IPC Sender Validation

### REQ-109
The system **shall** Malformed bounds are rejected with Invalid App Dock bounds. *(from invariant `ipc-sender-validation`)*

### REQ-110
The system **shall** Subframe IPC sender is rejected with Invalid App Dock sender. *(from invariant `ipc-sender-validation`)*

### REQ-111
If the system Malformed bounds are accepted, then it **shall refuse** and return an error. *(from invariant `ipc-sender-validation` unwanted)*

### REQ-112
If the system Subframe IPC sender is accepted, then it **shall refuse** and return an error. *(from invariant `ipc-sender-validation` unwanted)*

## fullscreen-command-validation: Fullscreen and Command Validation

### REQ-113
The system **shall** Non-boolean fullscreen state is rejected with Invalid App Dock fullscreen state. *(from invariant `fullscreen-command-validation`)*

### REQ-114
The system **shall** Invalid command enum is rejected with Invalid App Dock command. *(from invariant `fullscreen-command-validation`)*

### REQ-115
If the system Non-boolean fullscreen state is accepted, then it **shall refuse** and return an error. *(from invariant `fullscreen-command-validation` unwanted)*

### REQ-116
If the system Invalid command enum is accepted, then it **shall refuse** and return an error. *(from invariant `fullscreen-command-validation` unwanted)*

## throttling: Hide/Select Throttling

### REQ-117
The system **shall** Hide throttles a 25ms ticker to at most one tick in 300ms. *(from invariant `throttling`)*

### REQ-118
The system **shall** Select resumes three ticks within 200ms. *(from invariant `throttling`)*

### REQ-119
If the system Hidden ticker is not throttled, then it **shall refuse** and return an error. *(from invariant `throttling` unwanted)*

### REQ-120
If the system Selected ticker does not resume within 200ms, then it **shall refuse** and return an error. *(from invariant `throttling` unwanted)*

## open-response-contract: Open Response Contract

### REQ-121
The system **shall** IPC open response omits storageKey and path fields. *(from invariant `open-response-contract`)*

### REQ-122
If the system IPC open response exposes storageKey or path, then it **shall refuse** and return an error. *(from invariant `open-response-contract` unwanted)*

## state-event-identity: State Event Identity

### REQ-123
The system **shall** State events carry tabID (string) and generation (safe integer). *(from invariant `state-event-identity`)*

### REQ-124
If the system State events lack tabID or generation, then it **shall refuse** and return an error. *(from invariant `state-event-identity` unwanted)*

## cross-window-profile-sharing: Cross-Window Profile Sharing

### REQ-125
The system **shall** Two BrowserWindows opening the same profile create both views. *(from invariant `cross-window-profile-sharing`)*

### REQ-126
The system **shall** Profile delete from window A destroys views in both windows A and B. *(from invariant `cross-window-profile-sharing`)*

### REQ-127
The system **shall** Profile delete detaches views from both windows. *(from invariant `cross-window-profile-sharing`)*

### REQ-128
If the system Shared profile does not create both views, then it **shall refuse** and return an error. *(from invariant `cross-window-profile-sharing` unwanted)*

### REQ-129
If the system Profile delete from A leaves B's view alive, then it **shall refuse** and return an error. *(from invariant `cross-window-profile-sharing` unwanted)*

### REQ-130
If the system Profile delete leaves view attached in either window, then it **shall refuse** and return an error. *(from invariant `cross-window-profile-sharing` unwanted)*

## close-tabs-validation: Close-tabs Validation

### REQ-131
The system **shall** close-tabs with invalid scope is rejected. *(from invariant `close-tabs-validation`)*

### REQ-132
The system **shall** close-tabs others destroys only other tabs, keeps target. *(from invariant `close-tabs-validation`)*

### REQ-133
The system **shall** close-tabs right validates complete visual order. *(from invariant `close-tabs-validation`)*

### REQ-134
The system **shall** close-tabs right with wrong visual order is rejected. *(from invariant `close-tabs-validation`)*

### REQ-135
The system **shall** close-tabs right with foreign tab in order is rejected. *(from invariant `close-tabs-validation`)*

### REQ-136
The system **shall** close-tabs right with duplicate tabs in order is rejected. *(from invariant `close-tabs-validation`)*

### REQ-137
The system **shall** close-tabs right closes only visual-right tabs. *(from invariant `close-tabs-validation`)*

### REQ-138
If the system Invalid close-tabs scope is accepted, then it **shall refuse** and return an error. *(from invariant `close-tabs-validation` unwanted)*

### REQ-139
If the system close-tabs others destroys target, then it **shall refuse** and return an error. *(from invariant `close-tabs-validation` unwanted)*

### REQ-140
If the system close-tabs right accepts incomplete or wrong visual order, then it **shall refuse** and return an error. *(from invariant `close-tabs-validation` unwanted)*

### REQ-141
If the system close-tabs right closes non-right tabs, then it **shall refuse** and return an error. *(from invariant `close-tabs-validation` unwanted)*

## https-popup: HTTPS Popup Handling

### REQ-142
The system **shall** HTTPS window.open emits tab-opened with cloneable public identity (tabID, generation, url). *(from invariant `https-popup`)*

### REQ-143
The system **shall** HTTPS popup creates second WebContentsView. *(from invariant `https-popup`)*

### REQ-144
The system **shall** HTTPS popup target loads and is selected and attached. *(from invariant `https-popup`)*

### REQ-145
The system **shall** Popup source view is hidden and detached. *(from invariant `https-popup`)*

### REQ-146
If the system HTTPS popup does not emit tab-opened, then it **shall refuse** and return an error. *(from invariant `https-popup` unwanted)*

### REQ-147
If the system HTTPS popup does not create second view, then it **shall refuse** and return an error. *(from invariant `https-popup` unwanted)*

### REQ-148
If the system Popup target does not load or is not selected, then it **shall refuse** and return an error. *(from invariant `https-popup` unwanted)*

### REQ-149
If the system Popup source remains attached, then it **shall refuse** and return an error. *(from invariant `https-popup` unwanted)*

## contract-field: Contract Field Minimality

### REQ-150
The system **shall** Open and tab-opened contracts expose only tabID, generation, and URL. *(from invariant `contract-field`)*

### REQ-151
The system **shall** Event envelopes omit legacy id and adapter fields. *(from invariant `contract-field`)*

### REQ-152
The system **shall** State, tab-opened, and navigation-error events are cloneable public identities. *(from invariant `contract-field`)*

### REQ-153
If the system Open or tab-opened exposes id, storageKey, path, or adapter fields, then it **shall refuse** and return an error. *(from invariant `contract-field` unwanted)*

### REQ-154
If the system Event envelopes expose legacy id or adapter fields, then it **shall refuse** and return an error. *(from invariant `contract-field` unwanted)*

## restart-persistence: Restart Persistence

### REQ-155
The system **shall** Fresh Electron main process preserves same profile localStorage and cookie. *(from invariant `restart-persistence`)*

### REQ-156
The system **shall** Deleted profile tombstone survives restart and blocks old partition access. *(from invariant `restart-persistence`)*

### REQ-157
The system **shall** Separate profiles retain isolated storage across fresh Electron main process. *(from invariant `restart-persistence`)*

### REQ-158
If the system Profile localStorage or cookie lost on restart, then it **shall refuse** and return an error. *(from invariant `restart-persistence` unwanted)*

### REQ-159
If the system Deleted profile tombstone does not survive restart, then it **shall refuse** and return an error. *(from invariant `restart-persistence` unwanted)*

### REQ-160
If the system Separate profiles share storage across restart, then it **shall refuse** and return an error. *(from invariant `restart-persistence` unwanted)*

## corrupt-registry: Corrupt Registry Fails Closed

### REQ-161
The system **shall** Corrupt native registry fails closed without rebind and remains unchanged. *(from invariant `corrupt-registry`)*

### REQ-162
If the system Corrupt registry is silently rebind or modified, then it **shall refuse** and return an error. *(from invariant `corrupt-registry` unwanted)*

## renderer-crash-recovery: Renderer Crash Recovery

### REQ-163
The system **shall** Real selected renderer crash emits tab-crashed with old identity and reason crashed/killed. *(from invariant `renderer-crash-recovery`)*

### REQ-164
The system **shall** IPC recovery creates same tabID/URL/profile with newer generation. *(from invariant `renderer-crash-recovery`)*

### REQ-165
The system **shall** Recovered selected tab is usable and preserves other tabs. *(from invariant `renderer-crash-recovery`)*

### REQ-166
The system **shall** Old crashed generation events are ignored after recovery. *(from invariant `renderer-crash-recovery`)*

### REQ-167
If the system Crash does not emit tab-crashed with old identity, then it **shall refuse** and return an error. *(from invariant `renderer-crash-recovery` unwanted)*

### REQ-168
If the system Recovery does not create newer generation, then it **shall refuse** and return an error. *(from invariant `renderer-crash-recovery` unwanted)*

### REQ-169
If the system Recovery does not preserve other tabs, then it **shall refuse** and return an error. *(from invariant `renderer-crash-recovery` unwanted)*

### REQ-170
If the system Old generation events emitted after recovery, then it **shall refuse** and return an error. *(from invariant `renderer-crash-recovery` unwanted)*

## capacity-lru: Capacity LRU Eviction

### REQ-171
The system **shall** 20 inactive views across two windows use global LRU. *(from invariant `capacity-lru`)*

### REQ-172
The system **shall** Selecting A0 retains it while opening one more evicts older B0. *(from invariant `capacity-lru`)*

### REQ-173
The system **shall** Active views remain usable during eviction. *(from invariant `capacity-lru`)*

### REQ-174
The system **shall** Recently selected tab remains usable after eviction. *(from invariant `capacity-lru`)*

### REQ-175
If the system LRU eviction displaces an active view, then it **shall refuse** and return an error. *(from invariant `capacity-lru` unwanted)*

### REQ-176
If the system Recently selected tab becomes unusable after eviction, then it **shall refuse** and return an error. *(from invariant `capacity-lru` unwanted)*

### REQ-177
If the system Global LRU not honored across windows, then it **shall refuse** and return an error. *(from invariant `capacity-lru` unwanted)*

## download-limit: Download Limit

### REQ-178
The system **shall** Nine real same-profile slow downloads admit eight progressing. *(from invariant `download-limit`)*

### REQ-179
The system **shall** Ninth download is cancelled safely with failure event. *(from invariant `download-limit`)*

### REQ-180
The system **shall** Download events expose no filesystem path. *(from invariant `download-limit`)*

### REQ-181
If the system More than eight progressing downloads admitted, then it **shall refuse** and return an error. *(from invariant `download-limit` unwanted)*

### REQ-182
If the system Ninth download is not cancelled, then it **shall refuse** and return an error. *(from invariant `download-limit` unwanted)*

### REQ-183
If the system Download events expose filesystem path, then it **shall refuse** and return an error. *(from invariant `download-limit` unwanted)*

## devtools-gate: DevTools Gate

### REQ-184
The system **shall** App Dock DevTools do not open without trusted development route. *(from invariant `devtools-gate`)*

### REQ-185
The system **shall** Ordinary user input (F12) does not open DevTools. *(from invariant `devtools-gate`)*

### REQ-186
The system **shall** Trusted developmentMode()=true allows openDevTools. *(from invariant `devtools-gate`)*

### REQ-187
If the system DevTools open without trusted route, then it **shall refuse** and return an error. *(from invariant `devtools-gate` unwanted)*

### REQ-188
If the system F12 opens DevTools in production mode, then it **shall refuse** and return an error. *(from invariant `devtools-gate` unwanted)*

### REQ-189
If the system developmentMode=true does not allow DevTools, then it **shall refuse** and return an error. *(from invariant `devtools-gate` unwanted)*

## profile-registry: Profile Registry

### REQ-190
The system **shall** Profile ID must match ^[a-z0-9][a-z0-9-]{0,31}$. *(from invariant `profile-registry`)*

### REQ-191
The system **shall** Manifest validation rejects invalid profiles, tabs, bookmarks, history. *(from invariant `profile-registry`)*

### REQ-192
The system **shall** Registry load fails closed on corrupt data. *(from invariant `profile-registry`)*

### REQ-193
The system **shall** ensureActive creates new profile with UUID storageKey. *(from invariant `profile-registry`)*

### REQ-194
The system **shall** markDeleting transitions active→deleting, returns storageKey. *(from invariant `profile-registry`)*

### REQ-195
The system **shall** markDeleted transitions deleting→deleted, rewrites manifest and removes tabs. *(from invariant `profile-registry`)*

### REQ-196
The system **shall** replaceManifest enforces revision match and active profile set consistency. *(from invariant `profile-registry`)*

### REQ-197
If the system Registry accepts profile ID outside pattern, then it **shall refuse** and return an error. *(from invariant `profile-registry` unwanted)*

### REQ-198
If the system Registry accepts manifest exceeding internal limits, then it **shall refuse** and return an error. *(from invariant `profile-registry` unwanted)*

### REQ-199
If the system Corrupt registry loads without error, then it **shall refuse** and return an error. *(from invariant `profile-registry` unwanted)*

### REQ-200
If the system ensureActive creates profile without storageKey, then it **shall refuse** and return an error. *(from invariant `profile-registry` unwanted)*

### REQ-201
If the system markDeleting on deleted profile succeeds, then it **shall refuse** and return an error. *(from invariant `profile-registry` unwanted)*

### REQ-202
If the system markDeleted on non-deleting profile succeeds, then it **shall refuse** and return an error. *(from invariant `profile-registry` unwanted)*

### REQ-203
If the system replaceManifest accepts revision mismatch, then it **shall refuse** and return an error. *(from invariant `profile-registry` unwanted)*

## dock-scroll: Dock Scroll

### REQ-204
The system **shall** dock_scroll dispatches scroll and rejects invalid direction or amount. *(from invariant `dock-scroll`)*

### REQ-205
The system **shall** RPC dispatch validates scroll direction against up, down, top, bottom. *(from invariant `dock-scroll`)*

### REQ-206
If the system dock_scroll accepts invalid direction, then it **shall refuse** and return an error. *(from invariant `dock-scroll` unwanted)*

## dock-hover: Dock Hover

### REQ-207
The system **shall** dock_hover dispatches mouseover on live element. *(from invariant `dock-hover`)*

### REQ-208
If the system dock_hover reports success on missing element ref, then it **shall refuse** and return an error. *(from invariant `dock-hover` unwanted)*

## dock-click-at: Dock Click At Coordinates

### REQ-209
The system **shall** dock_clickAt clicks live coordinates. *(from invariant `dock-click-at`)*

### REQ-210
If the system dock_clickAt reports success with no element at coordinates, then it **shall refuse** and return an error. *(from invariant `dock-click-at` unwanted)*

## dock-drag: Dock Drag

### REQ-211
The system **shall** dock_drag runs pointer drag sequence on live elements. *(from invariant `dock-drag`)*

### REQ-212
If the system dock_drag reports success with missing element ref, then it **shall refuse** and return an error. *(from invariant `dock-drag` unwanted)*

## dock-scroll-to: Dock Scroll To

### REQ-213
The system **shall** dock_scrollTo jumps to live coordinates. *(from invariant `dock-scroll-to`)*

### REQ-214
If the system dock_scrollTo rejects valid coordinates, then it **shall refuse** and return an error. *(from invariant `dock-scroll-to` unwanted)*

## snapshot-shadow-dom: Snapshot Shadow DOM Piercing

### REQ-215
The system **shall** dock_read pierces open shadow DOM in live snapshot. *(from invariant `snapshot-shadow-dom`)*

### REQ-216
If the system dock_read omits visible inputs inside open shadow roots, then it **shall refuse** and return an error. *(from invariant `snapshot-shadow-dom` unwanted)*

## dock-youtube-llm: Dock YouTube LLM Drive

### REQ-217
The system **shall** dock session drives dock_open, dock_read and dock_click against YouTube results via live model call. *(from invariant `dock-youtube-llm`)*

### REQ-218
The system **shall** live model turn produces final text answering with a video title. *(from invariant `dock-youtube-llm`)*

### REQ-219
The system **shall** dock_* tools are visible in the session tool list for the live model. *(from invariant `dock-youtube-llm`)*

### REQ-220
If the system dock session completes without invoking any dock_* tool, then it **shall refuse** and return an error. *(from invariant `dock-youtube-llm` unwanted)*

### REQ-221
If the system session tool list omits dock_* tools for the live model, then it **shall refuse** and return an error. *(from invariant `dock-youtube-llm` unwanted)*

