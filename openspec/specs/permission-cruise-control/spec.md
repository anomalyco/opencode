# Permission cruise_control Specification

## Purpose

Built-in LLM permission classifier module `cruise_control` that auto-allows/denies gated tool permissions using a user-configured model with fail-closed safety rails. Host-side ask remains for missing model, rails, timeout, and parse failure.

## Requirements

### Requirement: Built-In cruise_control Module

KanCode SHALL provide a built-in permission module with ID `cruise_control` that classifies pending tool permission requests using a user-configured model. The name `cruise_control` is KanCode’s product term; comparisons to Copilot Autopilot or Claude Code auto mode are conceptual inspiration only and MUST NOT appear as module IDs or config keys.

#### Scenario: cruise_control is the built-in classifier id
- **WHEN** a user configures `permission.bash` to `"cruise_control"` with valid `permission_modules.cruise_control` options
- **THEN** the built-in LLM classifier module handles the gated bash permission decision

#### Scenario: Custom module ids remain available
- **WHEN** a plugin registers `puetsua_permit`
- **THEN** users may set permission actions to `"puetsua_permit"` independently of `cruise_control`

### Requirement: User-Configured Classifier Model

The `cruise_control` module SHALL require a configured model reference under `permission_modules.cruise_control.model` (for example `opencode/deepseek-v4-flash` or `ollama_cloud/kimi-k2.7-code`). The module MUST resolve that model through the existing provider/model stack. Missing or unresolvable model configuration MUST fail closed to the configured `fallback` (never allow).

#### Scenario: Classify with deepseek flash
- **WHEN** `permission_modules.cruise_control.model` is `opencode/deepseek-v4-flash` and a gated tool permission is evaluated
- **THEN** `cruise_control` invokes that model to produce an allow/deny decision

#### Scenario: Classify with ollama cloud model
- **WHEN** `permission_modules.cruise_control.model` is `ollama_cloud/kimi-k2.7-code` and a gated tool permission is evaluated
- **THEN** `cruise_control` invokes that model through normal provider resolution

#### Scenario: Missing model fails closed
- **WHEN** a rule selects `cruise_control` but `permission_modules.cruise_control.model` is missing or cannot be resolved
- **THEN** the effective decision is host-side ask (configure warning) or the configured `fallback` when the model cannot be resolved after being set
- **AND** the decision MUST NOT be `allow`

### Requirement: Classifier Input And Output Contract

The `cruise_control` classifier MUST receive a structured, non-executable summary of the permission request (permission key, patterns/resources, tool metadata, truncated args) with tool args placed in a delimited data section that MUST NOT be treated as system instructions. The classifier LLM MUST return schema-validated JSON with a `decision` of `allow` or `deny` (and a reason string). Invalid or unparseable output MUST map to `fallback`. Host-side ask remains available for missing model, `never_auto`/allowlist rails, timeout, and parse failure.

Classifier guidance MUST be configurable via `permission_modules.cruise_control.instructions` with optional `background`, `allow`, `conditional`, and `deny` string arrays. When the whole `instructions` object or individual sections are omitted, KanCode MUST seed/use built-in defaults for missing sections and MUST NOT wipe sections the user already set (including empty arrays). Legacy `system_prompt` MUST NOT be part of the schema.

#### Scenario: Valid allow decision
- **WHEN** the classifier returns valid JSON `{ "decision": "allow", "reason": "..." }` for a permission key on the allowlist and not on `never_auto`
- **THEN** the tool permission is allowed without showing the human ask UI

#### Scenario: Uncertain or invalid output uses fallback
- **WHEN** the classifier returns invalid JSON, omits `decision`, returns `ask`, or otherwise cannot be validated
- **THEN** the effective decision is `fallback`
- **AND** the decision MUST NOT be `allow`

#### Scenario: Default instructions when unset
- **WHEN** `permission_modules.cruise_control.instructions` is omitted
- **THEN** the classifier uses the built-in default instructions rendered into the system prompt

#### Scenario: Partial instructions merge
- **WHEN** the user configures only some instruction sections
- **THEN** missing sections use built-in defaults and configured sections are preserved as-is

### Requirement: cruise_control Safety Rails

The `cruise_control` module MUST apply `timeout_ms`, `fallback`, `allowlist`, and optional `never_auto`. `never_auto` MUST default to empty/unset (no never_auto escalation) unless the user configures it. When `allowlist` is omitted, the built-in default MUST include `external_directory` so classifier or dynamic-cache `allow` can stick (destructive rails and managed-directory logic still apply). `doom_loop` MUST NOT be on the default allowlist. An empty allowlist MUST prevent auto-allow. Timeout, abort, and provider errors MUST use `fallback` and MUST NEVER allow. Classifier `allow` outcomes MUST be once-scoped and MUST NOT write durable always-allow state.

#### Scenario: never_auto blocks auto allow when configured
- **WHEN** `never_auto` includes `external_directory` and the classifier returns `allow` for that key
- **THEN** the effective decision is not allow (escalate to ask)

#### Scenario: unset never_auto does not force ask
- **WHEN** `never_auto` is omitted or empty and the classifier returns `allow` for an allowlisted key
- **THEN** the effective decision remains `allow`

#### Scenario: default allowlist includes external_directory
- **WHEN** `allowlist` is omitted and the classifier returns `allow` for `external_directory`
- **THEN** the effective decision remains `allow`

#### Scenario: default allowlist excludes doom_loop
- **WHEN** `allowlist` is omitted and the classifier returns `allow` for `doom_loop`
- **THEN** the effective decision is ask (allowlist miss)

#### Scenario: Timeout never allows
- **WHEN** the classifier call exceeds `timeout_ms`
- **THEN** the effective decision is `fallback`
- **AND** the decision MUST NOT be `allow`

#### Scenario: Distinct from TUI auto mode
- **WHEN** TUI permission mode is `auto` and no permission rule selects `cruise_control`
- **THEN** asks are auto-replied with `once` without invoking the LLM classifier

### Requirement: Per-Prompt Dynamic Allow/Deny Lists

The `cruise_control` module SHALL maintain separate in-memory allow and deny action lists learned from successful classifier outcomes after safety rails. Before invoking the LLM, the module MUST check the deny list then the allow list. A deny-list hit MUST return deny with reason indicating a cached deny. An allow-list hit MUST return allow only when safety rails still permit auto-allow; otherwise it MUST escalate without treating the hit as a durable allow. Ask outcomes, classifier failures, and fallbacks MUST NOT be cached. Destructive auto-deny and managed-directory auto-allow MUST still run before dynamic-list lookup and MUST NOT require the LLM. The lists MUST be cleared when a new user prompt starts (`chat.message`) and MUST NOT persist across prompt turns or to config/state files by default. Configuration under `permission_modules.cruise_control.dynamic_list` MAY disable the feature or set a max size (oldest entries evicted).

#### Scenario: Cache hit skips LLM within a prompt turn
- **WHEN** the classifier previously allowed a permission key+patterns within the current user-prompt turn
- **AND** the same key is evaluated again before the next user prompt
- **THEN** the module returns allow with a cached-allow reason without calling the classifier LLM

#### Scenario: Deny wins over allow
- **WHEN** the same action key is present on both dynamic lists
- **THEN** the effective decision is deny

#### Scenario: Lists clear on new user prompt
- **WHEN** a new user message is created for a session (`chat.message`)
- **THEN** both dynamic allow and deny lists are empty before subsequent classifications

#### Scenario: Destructive still wins without LLM
- **WHEN** a pending bash pattern matches a destructive auto-deny rule
- **THEN** the module denies without consulting the dynamic lists or the LLM

### Requirement: Parallel Classify Concurrency

The `cruise_control` module SHALL honor `permission_modules.cruise_control.parallel_classify`. When the option is `false` or omitted (default), concurrent LLM classify calls MUST be serialized so only one classify runs at a time. When `true`, concurrent classify calls MAY run in parallel. Deterministic rails (destructive deny, managed-directory allow) and dynamic-list hits MUST NOT wait on the classify queue.

#### Scenario: Default serializes concurrent classify
- **WHEN** multiple tools need cruise_control LLM classification in one turn and `parallel_classify` is unset or `false`
- **THEN** only one classify LLM call runs at a time

#### Scenario: Parallel classify when enabled
- **WHEN** `permission_modules.cruise_control.parallel_classify` is `true` and multiple classify calls are pending
- **THEN** those LLM classify calls may run concurrently

#### Scenario: Rails bypass the classify queue
- **WHEN** one classify call is in progress under serialized mode
- **AND** another pending permission matches a destructive rail or dynamic-list hit
- **THEN** that decision completes without waiting for the in-flight classify to finish

### Requirement: Example Config Shape

Documentation and schema examples for `cruise_control` MUST show module ID `"cruise_control"` and a `permission_modules.cruise_control` block including `model`.

#### Scenario: Documented example uses cruise_control
- **WHEN** a user follows the documented starter config for LLM permission gating
- **THEN** the example uses `"cruise_control"` as the permission action and sets `permission_modules.cruise_control.model` to a concrete ref such as `opencode/deepseek-v4-flash` or `ollama_cloud/kimi-k2.7-code`
