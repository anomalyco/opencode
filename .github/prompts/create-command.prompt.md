---
description: "Trellis Copilot prompt: Create New Copilot Prompt"
---

# Create New Copilot Prompt

Create a new Copilot slash-command prompt file in `.github/prompts/`.

## Usage

```
/create-command <command-name> <description>
```

Example:

```
/create-command review-pr Check PR code changes against project guidelines
```

## Execution Steps

### 1. Parse Input

Extract from user input:
- Command name: must be kebab-case (example: `review-pr`)
- Description: one-sentence purpose

### 2. Analyze Requirements

Classify the command intent:
- Initialization
- Pre-development check
- Quality check
- Session recording
- Generation / automation

### 3. Generate Prompt Content

Create concise, executable Markdown content.

Simple prompt shape:

```markdown
Single clear instruction with expected output.
```

Complex prompt shape:

```markdown
# Prompt Title

Short purpose.

## Steps

### 1. Step One
Concrete action.

### 2. Step Two
Concrete action.

## Output

Expected output format.
```

### 4. Create Prompt File

Write file:

- `.github/prompts/<command-name>.prompt.md`

If the file already exists, compare content and update only when user asks to overwrite.

### 5. Confirm Result

Output:

```
[OK] Created Copilot Prompt: /<command-name>

File path:
- .github/prompts/<command-name>.prompt.md

Usage:
/<command-name>

Description:
<description>
```

## Content Quality Guidelines

Good prompt traits:
1. Clear and concise
2. Actionable without extra interpretation
3. Properly scoped
4. Defines expected output when needed

Avoid:
1. Vague intent (example: "optimize code")
2. Overly long instructions with mixed goals
3. Duplicating existing prompt behavior without reason

## Naming Conventions

| Prompt Type | Prefix | Example |
|------------|--------|---------|
| Session Start | `start` | `start` |
| Pre-development | `before-` | `before-dev` |
| Check | `check-` | `check` |
| Record | `record-` | `record-session` |
| Generate | `generate-` | `generate-api-doc` |
| Update | `update-` | `update-changelog` |
| Other | verb-first | `review-code`, `sync-data` |
