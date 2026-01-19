---
name: 'step-01-understand'
description: 'Analyze the requirement delta between current state and what user wants to build'

workflow_path: '{project-root}/_bmad/bmm/workflows/bmad-quick-flow/create-tech-spec'
nextStepFile: './step-02-investigate.md'
skipToStepFile: './step-03-generate.md'
templateFile: '{workflow_path}/tech-spec-template.md'
wipFile: '{implementation_artifacts}/tech-spec-wip.md'
---

# Step 1: Analyze Requirement Delta

**Progress: Step 1 of 4** - Next: Deep Investigation

## RULES:

- MUST NOT skip steps.
- MUST NOT optimize sequence.
- MUST follow exact instructions.
- MUST NOT look ahead to future steps.
- ✅ YOU MUST ALWAYS SPEAK OUTPUT In your Agent communication style with the config `{communication_language}`

## CONTEXT:

- Variables from `workflow.md` are available in memory.
- Focus: Define the technical requirement delta and scope.
- Investigation: Perform surface-level code scans ONLY to verify the delta. Reserve deep dives into implementation consequences for Step 2.
- Objective: Establish a verifiable delta between current state and target state.

## SEQUENCE OF INSTRUCTIONS

### 0. Check for Work in Progress

a) **Before anything else, check if `{wipFile}` exists:**

b) **IF WIP FILE EXISTS:**

1. Read the frontmatter and extract: `title`, `slug`, `stepsCompleted`
2. Calculate progress: `lastStep = max(stepsCompleted)`
3. Present to user:

```
Hey {user_name}! Found a tech-spec in progress:

**{title}** - Step {lastStep} of 4 complete

Is this what you're here to continue?

[y] Yes, pick up where I left off
[n] No, archive it and start something new
```

4. **HALT and wait for user selection.**

a) **Menu Handling:**

- **[y] Continue existing:**
  - Jump directly to the appropriate step based on `stepsCompleted`:
    - `[1]` → Load `{nextStepFile}` (Step 2)
    - `[1, 2]` → Load `{skipToStepFile}` (Step 3)
    - `[1, 2, 3]` → Load `./step-04-review.md` (Step 4)
- **[n] Archive and start fresh:**
  - Rename `{wipFile}` to `{implementation_artifacts}/tech-spec-{slug}-archived-{date}.md`

### 1. Greet and Ask for Initial Request

a) **Greet the user briefly:**

"Hey {user_name}! What are we building today?"

b) **Get their initial description.** Don't ask detailed questions yet - just understand enough to know where to look.

### 2. Quick Orient Scan

a) **Before asking detailed questions, do a rapid scan to understand the landscape:**

b) **Check for existing context docs:**

- Check `{output_folder}` and `{planning_artifacts}`for planning documents (PRD, architecture, epics, research)
- Check for `**/project-context.md` - if it exists, skim for patterns and conventions
- Check for any existing stories or specs related to user's request

c) **If user mentioned specific code/features, do a quick scan:**

- Search for relevant files/classes/functions they mentioned
- Skim the structure (don't deep-dive yet - that's Step 2)
- Note: tech stack, obvious patterns, file locations

d) **Build mental model:**

- What's the likely landscape for this feature?
- What's the likely scope based on what you found?
- What questions do you NOW have, informed by the code?

**This scan should take < 30 seconds. Just enough to ask smart questions.**

### 3. Ask Informed Questions

a) **Now ask clarifying questions - but make them INFORMED by what you found:**

Instead of generic questions like "What's the scope?", ask specific ones like:
- "`AuthService` handles validation in the controller — should the new field follow that pattern or move it to a dedicated validator?"
- "`NavigationSidebar` component uses local state for the 'collapsed' toggle — should we stick with that or move it to the global store?"
- "The epics doc mentions X - is this related?"

**Adapt to {user_skill_level}.** Technical users want technical questions. Non-technical users need translation.

b) **If no existing code is found:**

- Ask about intended architecture, patterns, constraints
- Ask what similar systems they'd like to emulate

### 4. Capture Core Understanding

a) **From the conversation, extract and confirm:**

- **Title**: A clear, concise name for this work
- **Slug**: URL-safe version of title (lowercase, hyphens, no spaces)
- **Problem Statement**: What problem are we solving?
- **Solution**: High-level approach (1-2 sentences)
- **In Scope**: What's included
- **Out of Scope**: What's explicitly NOT included

b) **Ask the user to confirm the captured understanding before proceeding.**

### 5. Initialize WIP File

a) **Create the tech-spec WIP file:**

1. Copy template from `{templateFile}`
2. Write to `{wipFile}`
3. Update frontmatter with captured values:
   ```yaml
   ---
   title: '{title}'
   slug: '{slug}'
   created: '{date}'
   status: 'in-progress'
   stepsCompleted: [1]
   tech_stack: []
   files_to_modify: []
   code_patterns: []
   test_patterns: []
   ---
   ```
4. Fill in Overview section with Problem Statement, Solution, and Scope
5. Fill in Context for Development section with any technical preferences or constraints gathered during informed discovery.
6. Write the file

b) **Report to user:**

"Created: `{wipFile}`

**Captured:**

- Title: {title}
- Problem: {problem_statement_summary}
- Scope: {scope_summary}"

### 6. Present Checkpoint Menu

a) **Display menu:**

```
[a] Advanced Elicitation - dig deeper into requirements
[c] Continue - proceed to next step
[p] Party Mode - bring in other experts
```

b) **HALT and wait for user selection.**

#### Menu Handling:

- **[a]**: Load and execute `{advanced_elicitation}`, then return here and redisplay menu
- **[c]**: Load and execute `{nextStepFile}` (Map Technical Constraints)
- **[p]**: Load and execute `{party_mode_exec}`, then return here and redisplay menu

---

## REQUIRED OUTPUTS:

- MUST initialize WIP file with captured metadata.

## VERIFICATION CHECKLIST:

- [ ] WIP check performed FIRST before any greeting.
- [ ] `{wipFile}` created with correct frontmatter, Overview, Context for Development, and `stepsCompleted: [1]`.
- [ ] User selected [c] to continue.
