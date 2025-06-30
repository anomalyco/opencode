# AWS Bedrock Integration: A Post-Mortem

## TL;DR

OpenCode's AWS Bedrock integration was failing silently due to model ID format mismatch. The fix? Understanding Bedrock's opinionated model naming convention and properly configuring AWS credentials in the execution environment.

## The Problem

Started with what seemed like a straightforward task - running OpenCode with AWS Bedrock as the LLM provider. The command:

```bash
bun run ./src/index.ts --model amazon-bedrock/claude-3-sonnet-20240229
```

Resulted in the dreaded:
```
Error: Unexpected error, check log file at ~/.local/share/opencode/log/...
```

## Root Cause Analysis

### 1. Model ID Format Mismatch

The initial assumption was that Bedrock would accept standard Anthropic model IDs with just a provider prefix. Wrong. AWS Bedrock has its own model ID schema:

```
❌ amazon-bedrock/claude-3-sonnet-20240229
✅ amazon-bedrock/anthropic.claude-3-sonnet-20240229-v1:0
```

The provider dynamically transforms model IDs for Claude models, but only partially:

```typescript
// packages/opencode/src/provider/provider.ts
async getModel(sdk: any, modelID: string) {
  if (modelID.includes("claude")) {
    const prefix = region.split("-")[0]
    modelID = `${prefix}.${modelID}`
  }
  return sdk.languageModel(modelID)
}
```

This transformation was insufficient - it was adding the region prefix but not the vendor prefix or version suffix.

### 2. Silent Provider Initialization Failure

The provider loading mechanism checks for AWS credentials before initializing:

```typescript
"amazon-bedrock": async () => {
  if (!process.env["AWS_PROFILE"] && !process.env["AWS_ACCESS_KEY_ID"])
    return { autoload: false }
  // ...
}
```

Without explicit AWS credentials in the environment, the provider silently skips initialization. No errors, no warnings - just missing models in the listing.

### 3. Bun Runtime Quirks

An interesting side issue emerged with Bun's CLI handling. The `auth` command conflicts with Bun's reserved subcommands:

```bash
# This fails due to Bun intercepting "auth"
bun run dev
opencode auth login

# Workaround required
bun run ./src/index.ts auth login
```

## The Solution

### Step 1: Ensure AWS Credentials

First, we needed to explicitly set AWS credentials in the shell environment:

```bash
export AWS_PROFILE=default  # or your profile name
# Alternative: export AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
```

### Step 2: Use Correct Model IDs

After setting credentials, running `models` command revealed the actual Bedrock model IDs:

```bash
AWS_PROFILE=default bun run ./src/index.ts models | grep bedrock
```

This showed the proper format: `amazon-bedrock/anthropic.claude-sonnet-4-20250514-v1:0`

### Step 3: Execute with Proper Configuration

```bash
AWS_PROFILE=default bun run ./src/index.ts run "Hello from AWS Bedrock!" \
  --model amazon-bedrock/anthropic.claude-sonnet-4-20250514-v1:0
```

## Key Learnings

1. **Provider Auto-loading is Environment-Dependent**: The AWS Bedrock provider only initializes when it detects valid AWS credentials. This is a feature, not a bug - it prevents unnecessary SDK loading and potential errors.

2. **Model ID Formats are Provider-Specific**: Each provider can have its own model naming convention. AWS Bedrock's format includes vendor prefix, model name, and version suffix.

3. **Silent Failures Need Better DX**: The provider initialization silently failing made debugging harder. Consider adding debug logging or warnings when providers skip initialization.

4. **Runtime-Specific Edge Cases**: Bun's reserved command handling creates unexpected conflicts. Document these edge cases prominently.

## Recommendations

1. **Improve Error Messages**: When a model isn't found, include hints about provider initialization requirements.

2. **Add Provider Diagnostics**: A `opencode providers --diagnose` command could show which providers are available and why others aren't loading.

3. **Standardize Model ID Translation**: Consider implementing a more robust model ID translation layer that handles the full transformation needed for each provider.

4. **Enhanced Documentation**: Add a troubleshooting section specifically for provider-specific setup requirements.

## Implementation Details

The working configuration requires:
- AWS SDK credentials (via environment or credentials file)
- Correct model ID format with vendor prefix and version
- Understanding of the provider's lazy-loading mechanism

This investigation revealed that what appeared to be a simple integration issue was actually a confluence of design decisions around security (credential checking), performance (lazy loading), and provider flexibility (custom model IDs).

---

*Written while debugging OpenCode v0.0.5 with Bun v1.2.17*