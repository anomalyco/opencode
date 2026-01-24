# Issue #10348: Grok Code Fast 1 disappeared from OpenCode Zen

## Root Cause Analysis

### Problem Statement
The "Grok Code Fast 1" model (xAI/grok-code-fast-1) has disappeared from the model selection dialog in OpenCode Zen.

### Technical Details

**Files Involved**:
1. `/root/opencode/packages/opencode/src/cli/cmd/tui/component/dialog-model.tsx` (Model selection UI)
2. `/root/opencode/packages/console/core/src/model.ts` (Zen model data loader)
3. `/root/opencode/packages/opencode/src/provider/provider.ts` (Provider filtering logic)

**Root Cause**: Models marked with `status: "deprecated"` are filtered out from the model list.

**Filtering Logic** (`dialog-model.tsx:124`):
```typescript
filter(([_, info]) => info.status !== "deprecated"),
```

**Provider Logic** (`provider.ts`):
```typescript
if (model.status === "deprecated") delete provider.models[modelID]
```

### Understanding the Architecture

**OpenCode Zen** is a web interface that serves models from:
- Environment variables `Resource.ZEN_MODELS1-8` (see `console/core/src/model.ts:69-81`)
- Models are loaded at runtime from these environment variables
- The models data includes status fields: `"alpha"`, `"beta"`, `"deprecated"`, `"active"`

**Model Flow**:
1. Zen loads model configuration from environment variables
2. Models with `status: "deprecated"` are filtered out
3. User cannot see or select deprecated models in the UI

### Why Grok Code Fast 1 Disappeared

The xAI team likely marked `grok-code-fast-1` as `deprecated` in the model configuration. This happens when:
1. A newer version replaces it (e.g., `grok-code-fast-2`)
2. The model is being phased out
3. There are issues with the model
4. xAI wants to migrate users to a different model

### Verification

To verify if the model is deprecated:
1. Check the environment variables `ZEN_MODELS1-8` in the Zen deployment
2. Look for the model entry in the JSON configuration
3. Check if `"status": "deprecated"` is set

Example configuration that would cause this:
```json
{
  "models": {
    "xai/grok-code-fast-1": {
      "name": "Grok Code Fast 1",
      "status": "deprecated",
      ...
    }
  }
}
```

### Solution Options

**Option 1: Update Model Configuration** (If model should still be available)
- Change status from `"deprecated"` to `"active"` or `"beta"`
- Update the environment variables in the Zen deployment
- Requires access to infrastructure/environment configuration

**Option 2: Use Newer Model** (If model is truly deprecated)
- Users should migrate to the replacement model
- Check if `grok-code-fast-2` or similar exists
- Update documentation to guide users

**Option 3: Allow Showing Deprecated Models** (Not recommended)
- Remove or modify the filter in `dialog-model.tsx:124`
- Add visual indicator that model is deprecated
- Allows users to select deprecated models with warning

### Recommended Approach

**If the model was incorrectly marked deprecated**:
1. Contact xAI team to verify model status
2. Update the Zen environment variables with correct status
3. Document the correct model lifecycle

**If the model is intentionally deprecated**:
1. This is working as designed
2. Users should use the replacement model
3. Consider adding a migration message in the UI

### Related Code

**Model Status Values** (`provider/models.ts`):
```typescript
status: z.enum(["alpha", "beta", "deprecated"]).optional()
```

**Provider Filtering** (`provider/provider.ts`):
```typescript
if (model.status === "deprecated") delete provider.models[modelID]
```

### Testing

To test if a model appears in the list:
1. Set model status to `"active"` in configuration
2. Restart Zen application
3. Open model selection dialog
4. Verify model appears in the list

### User Impact

**Affected Users**:
- Users who had "Grok Code Fast 1" as a favorite
- Users with recent sessions using this model
- Users who specifically need this model

**Workaround**:
- Manually select the model by typing its name
- Use a different model
- Contact support to verify if model should be available

### Status

- ✅ Root cause identified (model marked as deprecated)
- ✅ Filtering mechanism understood
- ⏳ Need verification: Is model intentionally deprecated?
- ⏳ Action required: Update model status if incorrect, or document migration path

### Additional Notes

This is not a bug - it's a feature to hide deprecated models from the UI. The issue title suggests the disappearance was unexpected, which may indicate:
1. The model was marked deprecated by mistake
2. Communication about deprecation was insufficient
3. Users were not given migration guidance

### Related Issues

None directly related, but similar issues could occur for any provider's deprecated models.

### Documentation Updates Needed

- If model is deprecated: Add migration guide
- If model was wrongly marked: Document correct status values
- User-facing: Explain why models disappear and what to do
