# AWS Bedrock Setup Guide

Quick setup for running CH-AI Runtime with AWS Bedrock.

## Quick Start

```bash
# 1. Set AWS credentials (choose one)
export AWS_PROFILE=default
# OR
export AWS_ACCESS_KEY_ID=xxx AWS_SECRET_ACCESS_KEY=yyy

# 2. Run CH-AI Runtime
cd packages/opencode
AWS_REGION=us-east-1 bun run ./src/index.ts

# 3. Test with a model
bun run ./src/index.ts run "Test AWS Bedrock" \
  --model amazon-bedrock/anthropic.claude-sonnet-4-20250514-v1:0
```

## Configuration Options

### Shell Alias (Recommended)

Add to `~/.bashrc` or `~/.zshrc`:

```bash
alias opencode-bedrock='AWS_PROFILE=default AWS_REGION=us-east-1 bun run /path/to/opencode/packages/opencode/src/index.ts'
```


## Required IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "bedrock:ListFoundationModels",
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream"
    ],
    "Resource": "*"
  }]
}
```