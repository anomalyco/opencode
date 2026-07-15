## ADDED Requirements

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
- **THEN** `cruise_control` invokes that model to produce an allow/deny/ask decision

#### Scenario: Classify with ollama cloud model
- **WHEN** `permission_modules.cruise_control.model` is `ollama_cloud/kimi-k2.7-code` and a gated tool permission is evaluated
- **THEN** `cruise_control` invokes that model through normal provider resolution

#### Scenario: Missing model fails closed
- **WHEN** a rule selects `cruise_control` but `permission_modules.cruise_control.model` is missing or cannot be resolved
- **THEN** the effective decision is the configured `fallback` (default `deny`)
- **AND** the decision MUST NOT be `allow`

### Requirement: Classifier Input And Output Contract

The `cruise_control` classifier MUST receive a structured, non-executable summary of the permission request (permission key, patterns/resources, tool metadata, truncated args) with tool args placed in a delimited data section that MUST NOT be treated as system instructions. The classifier MUST return schema-validated JSON with a `decision` of `allow`, `deny`, or `ask` (and a reason string). Invalid or unparseable output MUST map to `fallback`.

#### Scenario: Valid allow decision
- **WHEN** the classifier returns valid JSON `{ "decision": "allow", "reason": "..." }` for a permission key on the allowlist and not on `never_auto`
- **THEN** the tool permission is allowed without showing the human ask UI

#### Scenario: Uncertain or invalid output uses fallback
- **WHEN** the classifier returns invalid JSON, omits `decision`, or otherwise cannot be validated
- **THEN** the effective decision is `fallback`
- **AND** the decision MUST NOT be `allow`

### Requirement: cruise_control Safety Rails

The `cruise_control` module MUST apply `timeout_ms`, `fallback`, `allowlist`, and `never_auto`. Default `never_auto` MUST include at least `external_directory` and `doom_loop` where those permissions exist. An empty allowlist MUST prevent auto-allow. Timeout, abort, and provider errors MUST use `fallback` and MUST NEVER allow. Classifier `allow` outcomes MUST be once-scoped and MUST NOT write durable always-allow state.

#### Scenario: never_auto blocks auto allow
- **WHEN** the pending permission key is `external_directory` and the classifier returns `allow`
- **THEN** the effective decision is not allow (uses `fallback` or deny/ask per policy)

#### Scenario: Timeout never allows
- **WHEN** the classifier call exceeds `timeout_ms`
- **THEN** the effective decision is `fallback`
- **AND** the decision MUST NOT be `allow`

#### Scenario: Distinct from TUI auto mode
- **WHEN** TUI permission mode is `auto` and no permission rule selects `cruise_control`
- **THEN** asks are auto-replied with `once` without invoking the LLM classifier

### Requirement: Example Config Shape

Documentation and schema examples for `cruise_control` MUST show module ID `"cruise_control"` and a `permission_modules.cruise_control` block including `model`.

#### Scenario: Documented example uses cruise_control
- **WHEN** a user follows the documented starter config for LLM permission gating
- **THEN** the example uses `"cruise_control"` as the permission action and sets `permission_modules.cruise_control.model` to a concrete ref such as `opencode/deepseek-v4-flash` or `ollama_cloud/kimi-k2.7-code`
