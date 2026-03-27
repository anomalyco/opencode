name: 🚀 Feature Request
description: Suggest an idea, feature, or enhancement
labels: [discussion]
title: "[FEATURE]:"

body:

- type: checkboxes
  id: verified
  attributes:
  label: Feature hasn't been suggested before.
  options: - label: I have verified this feature I'm about to request hasn't been suggested before.
  required: true
  - type: textarea
    attributes:
    label: Describe the enhancement you want to request
    description: What do you want to change or add? What are the benefits of implementing this? Try to be detailed so we can understand your request better :)
    validations:
    required: true
    value: |

    ### Feature: Dynamic Model Routing via Plugin Hook

    **What it is:**
    A plugin hook that allows plugins to dynamically change the active model for the entire OpenCode session. When a plugin overrides the model, it should update OpenCode's active model state, so that all subsequent agents and tasks using inherited model (no explicit model pin) will use the new model.

    **Current behavior:**
    - Subagents launched via Task tool use the global config model, not the parent's active model (#17870, #6928)
    - Model selection is static and determined at session start
    - The model picker shows one model, but subagents use a different one
    - Plugins cannot affect the active model shown in the UI

    **Proposed behavior:**
    - Plugins can intercept and override the model selection via the `chat.message` hook
    - When a plugin changes the model, it updates OpenCode's **active model state**
    - The UI/model picker reflects this change
    - All subsequent agents/tasks that use inherited model will use this new active model
    - The routed model persists through the user message → assistant → subagent chain
    - Subagent model inheritance (#17870) works correctly

    **Key distinction from current `chat.message` behavior:**
    - Current: Plugin can mutate `output.message.model`, but it only affects the user message and subsequent assistant/subagent for that turn
    - Proposed: Plugin can change the active model, affecting all future turns and the UI state

    **Benefits:**
    1. **True active model inheritance** - Fixes #17870 where subagents ignore parent's active model
    2. **UI consistency** - Model picker always reflects the actual model being used
    3. **Dynamic routing** - Route tasks to appropriate models based on content/complexity
    4. **Cost optimization** - Use cheaper models for simple tasks
    5. **Failover** - Automatically switch providers on rate limits or errors
    6. **A/B testing** - Blind model evaluation with proper UI feedback (#16932)

    **Implementation status:**
    The core routing behavior is implemented and tested via the existing `chat.message` hook. Tests are in review at `packages/opencode/test/session/chat-message-model-routing.test.ts`. This request is to extend this to update the active model state and UI.

  - type: textarea
    attributes:
    label: | ### Current Status

          **Partially implemented.** The existing `chat.message` hook allows plugins to mutate `output.message.model`, but this only affects the current turn's chain (user → assistant → subagent). It does NOT update OpenCode's active model state or UI, and future turns revert to the old model.

          Test coverage exists at `packages/opencode/test/session/chat-message-model-routing.test.ts`.

          **This is insufficient because:**
          - Turn N+1 reverts to the old model
          - Subagents in future turns still ignore the parent's active model (#17870)
          - Model picker shows a model that doesn't match actual behavior

          **This request is to:**
          1. When a plugin changes the model, update OpenCode's active model state
          2. Update the UI/model picker to reflect the new active model
          3. Ensure all future turns use the new active model
          4. Subagents inherit correctly across all turns

- type: textarea
  attributes:
  label: "### Problem\n\nDescribe the problem or limitation that this feature would solve.\n\n**Related issues:**\n- #17870 - Subagent spawned via Task tool uses global config model instead of inheriting parent session's active model\n- #6928 - Subtask commands do not inherit model\n- #16932 - chat.model hook for blind LLM benchmarking (proposes a hook but for a different use case)\n- #4475 - Plugins using noReply cause model to switch to agent default\n"
  validations:
  required: true
  - type: textarea
    attributes:
    label: | ### Proposed Solution

    Extend the `chat.message` hook (or add a dedicated `chat.model` hook) to update OpenCode's active model state when a plugin changes the model.

    ```typescript
    "chat.model"?: (
      input: {
        sessionID: string
        agent: string
        proposedModel?: { providerID: string; modelID: string }
      },
      output: {
        model?: { providerID: string; modelID: string }
      }
    ) => Promise<void>
    ```

    **Hook semantics:**
    - Fires when a plugin wants to change the active model
    - When `output.model` is set, OpenCode updates its active model state
    - The UI/model picker reflects the new active model
    - All subsequent turns use the new active model by default
    - Subagents launched via Task tool inherit the new active model (unless pinned)

    **Resolution order:**
    1. Plugin `chat.model` / `chat.message` model mutation (updates active model)
    2. Explicit `agent.model` pin in agent configuration
    3. Parent assistant model (subagent inheritance)
    4. Default model resolution

    **Effect on active model:**
    - When a plugin returns a different model, OpenCode should update the active model
    - This affects future turns until another model change occurs
    - Subagents without explicit `model` inherit the active model
    - The model picker UI should display the active model

  validations:
  required: false

- type: textarea
  attributes:
  label: | ### Use Cases

      1. **Dynamic model routing based on prompt content**
         - Route coding tasks to specialized code models
         - Route debugging tasks to models with better reasoning
         - Route simple queries to faster/cheaper models

      2. **Model fallback/failover**
         - Detect rate limits or errors and switch to backup provider
         - Handle provider-specific outages gracefully

      3. **A/B testing and benchmarking**
         - Randomly assign models for blind evaluation (original #16932 use case)
         - Track performance metrics across different models

      4. **Enterprise model governance**
         - Enforce policy-based model selection (e.g., cost limits, compliance)
         - Audit trail of model selection decisions

      5. **Context-aware routing**
         - Analyze file types, project size, or task complexity
         - Select appropriate model tier dynamically

  validations:
  required: false
  - type: textarea
    attributes:
    label: | ### Implementation Notes

          **What exists:**
          - `chat.message` hook allows plugins to mutate `output.message.model`
          - Model inheritance chain works (user → assistant → subagent)
          - Test coverage at `packages/opencode/test/session/chat-message-model-routing.test.ts`

          **What needs to be added:**
          - Update OpenCode's active model state when plugin changes model
          - Update the UI/model picker to reflect the new active model
          - Ensure future turns use the new active model by default

          **Key change needed:**
          In `prompt.ts` where `chat.message` is triggered, when `output.message.model` is mutated, also update the session's active model. This should propagate to the UI so the model picker reflects the change.

          **Files involved:**
          - `packages/plugin/src/index.ts` - Hook type definition
          - `packages/opencode/src/session/prompt.ts` - Update active model when hook mutates model
          - `packages/opencode/src/tool/task.ts` - Already respects parent assistant model (lines 108-111)
          - UI components - Display active model from session state

  validations:
  required: false
  - type: textarea
    attributes:
    label: | ### Complementary Approaches

          1. **Add model parameter to Task tool**
             - PR #14961 already implements explicit model passing
             - Requires caller to know which model to use
             - Doesn't update UI or active model state
             - Useful for intentional model selection, not dynamic routing

  validations:
  required: false
  - type: textarea
    attributes:
    label: | ### Questions for Discussion
    1. **Hook timing:** Should the hook fire before or after the user message is persisted?
    2. **UI update:** How should the model picker UI respond when a plugin changes the active model? (animate? flash? silent update?)
    3. **Validation:** How should model validation failures be handled when updating active model?
    4. **Override mechanism:** Should users be able to opt out of plugin model changes? (e.g., config flag)
    5. **Dedicated hook vs extend existing:** Should we add a dedicated `chat.model` hook or extend `chat.message`?
    6. **Persistence:** Should the active model change persist across session restarts?

  validations:
  required: false
