## ADDED Requirements

### Requirement: Module IDs Are Valid Permission Actions

The system SHALL accept registered permission module IDs as V1 permission action values in addition to the built-in literals `allow`, `ask`, and `deny`. Reserved literals `allow`, `ask`, and `deny` MUST remain built-in modes and MUST NOT be registerable as module IDs.

#### Scenario: Config names cruise_control for bash
- **WHEN** user config sets `permission.bash` to `"cruise_control"` and `cruise_control` is a registered module
- **THEN** evaluation of a matching bash permission rule resolves to the `cruise_control` module rather than treating the string as an unknown static effect

#### Scenario: Existing allow ask deny still work
- **WHEN** user config sets `permission.edit` to `"ask"` (or `"allow"` / `"deny"`)
- **THEN** behavior matches today's static ruleset evaluation with no module invocation

#### Scenario: Pattern maps still use static actions
- **WHEN** user config sets `permission.bash` to `{ "*": "ask", "git *": "allow" }`
- **THEN** pattern keys are matched with last-match-wins and module options are NOT read from that object

### Requirement: Top-Level Permission Modules Config

The system SHALL load per-module options from a top-level `permission_modules` map in config (dual-read aware with `kancode.json(c)` / `opencode.json(c)` and `.kancode` / `.opencode` precedence). Module options MUST NOT be nested inside V1 pattern-map objects.

#### Scenario: Module options loaded from kancode.json
- **WHEN** `kancode.json` contains `permission_modules.cruise_control.model` set to a provider/model ref
- **THEN** the `cruise_control` module receives that model configuration at decision time

#### Scenario: Dual-read prefers kancode file
- **WHEN** both `kancode.json` and `opencode.json` exist in the same directory and only one defines `permission_modules`
- **THEN** config loading follows existing KanCode filename preference (KanCode file wins; do not merge both files from the same directory)

### Requirement: Permission Module Registry

The system SHALL provide a permission module registry that includes first-party built-in modules and MAY include modules registered by plugins. Lookup of an unknown module ID at decision time MUST fail closed to `deny` and MUST emit an auditable record of the failure.

#### Scenario: Built-in cruise_control is registered
- **WHEN** the process starts with default plugins
- **THEN** module ID `cruise_control` is available in the registry without a user plugin

#### Scenario: Plugin registers custom module
- **WHEN** a plugin registers module ID `puetsua_permit` successfully
- **THEN** config may use `"puetsua_permit"` as a permission action and the registry routes decisions to that module

#### Scenario: Unknown module fails closed
- **WHEN** a matching rule action is `"not_a_real_module"` and no such module is registered
- **THEN** the permission decision is `deny`
- **AND** an audit record notes the unknown module

#### Scenario: Reserved ID registration rejected
- **WHEN** a plugin attempts to register a module with ID `allow`, `ask`, or `deny`
- **THEN** registration fails with a clear error and the built-in mode is unchanged

### Requirement: Evaluation Order With Modules

Static `allow` and `deny` rules MUST short-circuit without invoking a module. A module MUST be invoked only when the last matching rule selects a module ID (V1) or an `ask` effect with a `module` field (V2). Module outcomes MUST be one of `allow`, `deny`, or `ask`. When the module returns `ask`, the existing human ask / ACP / non-interactive reject path MUST apply.

#### Scenario: Static deny wins before module
- **WHEN** a later matching rule sets the permission to `deny` and an earlier rule named `cruise_control`
- **THEN** the tool call is denied and `cruise_control` is not invoked

#### Scenario: Module returns ask falls through to UI
- **WHEN** a module returns `ask` for a pending tool permission in an interactive TUI session
- **THEN** the existing permission ask UI is shown and awaits a once/always/reject reply

#### Scenario: Module timeout uses fallback
- **WHEN** a module does not return within its configured timeout
- **THEN** the decision is the module's configured `fallback` (`ask` or `deny`)
- **AND** the decision MUST NOT be `allow`

### Requirement: V2 Optional Module Field

V2 permission rules SHALL keep `effect` as the closed set `allow | deny | ask` and MAY include an optional `module` string. When migrating a V1 module action to V2, the system MUST map it to `{ effect: "ask", module: "<id>" }`.

#### Scenario: V1 module action migrates to V2
- **WHEN** V1 config `permission.bash: "cruise_control"` is migrated to V2 rules
- **THEN** the resulting rule has `action` bash, `effect` `ask`, and `module` `cruise_control`

#### Scenario: V2 static allow ignores module
- **WHEN** a V2 rule has `effect: "allow"` and also sets `module`
- **THEN** the effect is allow without invoking the module

### Requirement: Safety And Audit For Modules

Permission modules MUST fail closed on classifier/provider errors. Auto-allow from a module MUST respect configured allowlists and never-auto lists. Classifier or module decisions that allow a tool MUST NOT persist as durable “always” approvals unless the human explicitly replies `always` in the ask UI.

#### Scenario: Empty allowlist cannot auto-allow
- **WHEN** `cruise_control` (or another module with the same policy) has an empty allowlist and the classifier would return allow
- **THEN** the effective decision is not allow (uses `fallback` or deny/ask per module policy)

#### Scenario: Audit records module decision
- **WHEN** a module produces a decision for a tool permission
- **THEN** a session-local audit record includes module id, decision, permission key, and latency or error without logging secret values
