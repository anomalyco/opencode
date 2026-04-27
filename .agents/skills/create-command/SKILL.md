---
name: create-command
description: "Scaffolds a new skill file with proper naming conventions and structure. Analyzes requirements to determine skill type and generates appropriate content. Use when adding a new developer workflow skill, creating a custom skill, or extending the Trellis skill set."
---

# Create New Skill

Create a new Codex skill in `.agents/skills/<skill-name>/SKILL.md` based on user requirements.

## Usage

```bash
$create-command <skill-name> <description>
```

**Example**:
```bash
$create-command review-pr Check PR code changes against project guidelines
```

## Execution Steps

### 1. Parse Input

Extract from user input:
- **Skill name**: Use kebab-case (e.g., `review-pr`)
- **Description**: What the skill should accomplish

### 2. Analyze Requirements

Determine skill type based on description:
- **Initialization**: Read docs, establish context
- **Pre-development**: Read guidelines, check dependencies
- **Code check**: Validate code quality and guideline compliance
- **Recording**: Record progress, questions, structure changes
- **Generation**: Generate docs or code templates

### 3. Generate Skill Content

Minimum `SKILL.md` structure:

```markdown
---
name: <skill-name>
description: "<description>"
---

# <Skill Title>

<Instructions for when and how to use this skill>
```

### 4. Create Files

Create:
- `.agents/skills/<skill-name>/SKILL.md`

### 5. Confirm Creation

Output result:

```text
[OK] Created Skill: <skill-name>

File path:
- .agents/skills/<skill-name>/SKILL.md

Usage:
- Trigger directly with $<skill-name>
- Or open /skills and select it

Description:
<description>
```

## Skill Content Guidelines

### [OK] Good skill content

1. **Clear and concise**: Immediately understandable
2. **Executable**: AI can follow steps directly
3. **Well-scoped**: Clear boundaries of what to do and not do
4. **Has output**: Specifies expected output format (if needed)

### [X] Avoid

1. **Too vague**: e.g., "optimize code"
2. **Too complex**: Single skill should not exceed 100 lines
3. **Duplicate functionality**: Check if similar skill exists first

## Naming Conventions

| Skill Type | Prefix | Example |
|------------|--------|---------|
| Session Start | `start` | `start` |
| Pre-development | `before-` | `before-dev` |
| Check | `check-` | `check` |
| Record | `record-` | `record-session` |
| Generate | `generate-` | `generate-api-doc` |
| Update | `update-` | `update-changelog` |
| Other | Verb-first | `review-code`, `sync-data` |
