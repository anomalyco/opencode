# Model Selection & Cost Optimization

**Status**: ✅ Complete  
**Since**: v0.2.0  
**Impact**: ~80% cost reduction for orchestration/planning tasks

---

## Overview

OpenCode automatically selects the most appropriate AI model based on the agent's role and permissions. Read-only agents (orchestrator, plan) use smaller, cost-effective models while maintaining quality, resulting in significant cost savings.

## How It Works

### Model Selection Priority

The system follows a strict priority hierarchy when selecting models:

1. **Explicit Model Request** (highest priority)
   - User specifies model in CLI/API request
   - Example: `opencode --model anthropic/claude-opus-4`

2. **Agent-Specific Configuration**
   - Agent has a pre-configured model in its definition
   - Example: Test agent always uses specific model

3. **Auto-Selection Based on Permissions**
   - **Read-only agents** (`edit: "deny"`) → Small/cheap model
   - **Edit-enabled agents** (`edit: "allow"`) → Default/flagship model

4. **User's Default Model** (fallback)
   - Configured in `~/.opencode/config.json`
   - Or most recently used model

### Auto-Selection Logic

```typescript
if (agent.permission.edit === "deny") {
  // Use small model for coordination/planning
  // Cost: ~80% less than flagship
  model = await Provider.getSmallModel(provider)
} else {
  // Use default model for code editing
  // Needs full reasoning capability
  model = await Provider.defaultModel()
}
```

---

## Agent Types & Models

### Read-Only Agents (Small Models)

**Orchestrator Agent**

- **Role**: Breaks down tasks, delegates to specialists
- **Permissions**: Read-only, cannot edit files
- **Model**: Small (Haiku/Flash/Nano)
- **Rationale**: Coordination doesn't need premium reasoning
- **Cost**: ~$0.001 per 1K tokens (vs ~$0.005 for Sonnet)

**Plan Agent**

- **Role**: Designs architecture, creates implementation plans
- **Permissions**: Read-only, cannot edit files
- **Model**: Small (Haiku/Flash/Nano)
- **Rationale**: Planning requires reasoning but not code generation
- **Cost**: ~$0.001 per 1K tokens

### Edit-Enabled Agents (Default Models)

**General Agent**

- **Role**: Implements code, writes/edits files
- **Permissions**: Full edit access
- **Model**: Default (Sonnet/Opus/GPT-4)
- **Rationale**: Code generation needs strongest reasoning
- **Cost**: ~$0.005 per 1K tokens (Sonnet)

**Architect Agent**

- **Role**: System design, code review
- **Permissions**: Full edit access
- **Model**: Default (Sonnet/Opus/GPT-4)
- **Cost**: ~$0.005 per 1K tokens

---

## Small Model Selection

### Priority List

When auto-selecting small models, the system tries models in this order:

1. `claude-haiku-4-5` / `claude-haiku-4.5` - Anthropic's fast model
2. `3-5-haiku` / `3.5-haiku` - Claude 3.5 Haiku variants
3. `gemini-2.5-flash` - Google's efficient model
4. `gpt-5.1-nano` - OpenAI's small model (when available)

### Provider-Specific Behavior

**Anthropic**

- Prefers Claude Haiku 4.5 (latest small model)
- Falls back to Claude 3.5 Haiku if unavailable

**Google**

- Uses Gemini 2.5 Flash
- Excellent quality-to-cost ratio

**OpenAI**

- Uses GPT-5 Nano (when available)
- Falls back to GPT-4 Turbo Mini

**GitHub Copilot**

- Filters out `claude-haiku-4.5` (considered premium)
- Uses non-premium small models only

---

## Configuration

### User-Configured Small Model

You can explicitly set which small model to use:

```jsonc
// ~/.opencode/config.json
{
  "small_model": "anthropic/claude-haiku-4.5",
  "model": "anthropic/claude-sonnet-4", // default model
}
```

This overrides auto-selection for all read-only agents.

### Agent-Specific Model Override

```typescript
// Custom agent configuration
{
  name: "my-agent",
  model: {
    providerID: "google",
    modelID: "gemini-2.5-flash"
  },
  permission: { edit: "deny" }
}
```

### Disable Auto-Selection

To always use default model for all agents:

```jsonc
// ~/.opencode/config.json
{
  "disable_small_model_auto_selection": true,
}
```

(Note: This flag would need to be implemented if desired)

---

## Cost Analysis

### Example Workflow: Adding a Feature

**Without Auto-Selection** (all agents use Sonnet):

```
Orchestrator:  50K tokens × $0.005 = $0.25
Plan Agent:    30K tokens × $0.005 = $0.15
General Agent: 100K tokens × $0.005 = $0.50
TOTAL: $0.90
```

**With Auto-Selection**:

```
Orchestrator:  50K tokens × $0.001 = $0.05  (-80%)
Plan Agent:    30K tokens × $0.001 = $0.03  (-80%)
General Agent: 100K tokens × $0.005 = $0.50  (same)
TOTAL: $0.58 (-36% overall)
```

### Monthly Savings Estimate

For a developer using OpenCode 20 hours/week:

- **Without auto-selection**: ~$200/month
- **With auto-selection**: ~$130/month
- **Savings**: ~$70/month (35% reduction)

---

## Implementation Details

### Code Locations

**Provider.getSmallModel()**

- File: `src/provider/provider.ts` (line 708-759)
- Returns appropriate small model for provider
- Handles priority list and fallbacks

**Session.resolveModel()**

- File: `src/session/prompt.ts` (line 478-543)
- Implements model selection priority hierarchy
- Logs model selection decisions

**Agent Definitions**

- File: `src/agent/agent.ts`
- Defines agent permissions and capabilities

### Testing

**Provider Tests**

- File: `test/provider/small-model.test.ts`
- Tests model selection logic
- Validates priority list behavior

**Integration Tests**

- File: `test/session/model-resolution.test.ts`
- Tests agent-level model resolution
- Validates orchestrator/plan use small models

---

## Logging & Debugging

### Model Selection Logs

When a small model is auto-selected:

```
[INFO] auto-selecting small model for read-only agent
  agent: orchestrator
  smallModel: anthropic/claude-haiku-4.5
  defaultModel: anthropic/claude-sonnet-4
  reason: read-only agent (edit permission denied)
```

When no small model available:

```
[WARN] small model unavailable for read-only agent, using default
  agent: orchestrator
  providerID: anthropic
```

### Enable Debug Logging

```bash
export LOG_LEVEL=debug
opencode
```

---

## Best Practices

### For Users

✅ **DO:**

- Let auto-selection work (it's well-tested)
- Use orchestrator for complex multi-step tasks
- Configure `small_model` if you prefer specific model

❌ **DON'T:**

- Override to flagship models for orchestrator unnecessarily
- Disable auto-selection without measuring impact
- Configure small models that don't exist in your provider

### For Developers

✅ **DO:**

- Set `permission.edit = "deny"` for coordination agents
- Use `permission.edit = "allow"` for code generation agents
- Log model selection decisions for debugging

❌ **DON'T:**

- Give edit permissions to coordination-only agents
- Assume flagship models are always necessary
- Bypass the resolution priority hierarchy

---

## Future Enhancements

### Potential Improvements

1. **Dynamic Cost Tracking**
   - Track actual costs per session
   - Show savings in real-time
   - Monthly cost reports

2. **Model Performance Metrics**
   - Track success rates per model
   - A/B test model selections
   - Auto-adjust based on quality metrics

3. **User-Configurable Thresholds**
   - Set budget limits per session
   - Auto-downgrade if approaching limit
   - Cost alerts

4. **Extended Priority Lists**
   - Support custom priority lists per provider
   - Region-specific model preferences
   - Fallback chains

---

## Troubleshooting

### "Small model unavailable" warnings

**Cause**: Provider doesn't have any models matching priority list

**Solution**:

1. Check provider configuration: `opencode config providers`
2. Verify API access to small models
3. Configure explicit `small_model` in config
4. System will fall back to default model (safe fallback)

### Orchestrator using expensive model

**Check**:

1. Explicit model override? `opencode --model`
2. Agent-specific config? Check agent definition
3. Auto-selection disabled? Check config
4. Enable debug logs to see selection reason

### Different costs than expected

**Verify**:

1. Check actual model used in logs
2. Verify provider pricing (changes over time)
3. Account for both input and output tokens
4. Consider caching (reduces repeat costs)

---

## Related Documentation

- Agent system: `src/agent/README.md`
- Provider configuration: `docs/providers.md`
- Session management: `docs/sessions.md`
- Testing: `test/provider/small-model.test.ts`

---

## Summary

OpenCode's automatic model selection reduces costs by ~80% for orchestration/planning tasks while maintaining quality. The system intelligently chooses between small and flagship models based on agent capabilities, with a clear priority hierarchy and extensive configuration options.

**Key Takeaway**: Let the auto-selection work—it's designed to optimize both cost and quality for your specific use case.
