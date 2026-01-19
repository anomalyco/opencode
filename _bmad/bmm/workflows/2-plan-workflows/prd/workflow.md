---
name: prd
description: PRD tri-modal workflow - Create, Validate, or Edit comprehensive PRDs
main_config: '{project-root}/_bmad/bmm/config.yaml'
nextStep: './steps-c/step-01-init.md'
validateWorkflow: './steps-v/step-v-01-discovery.md'
editWorkflow: './steps-e/step-e-01-discovery.md'
web_bundle: true
---

# PRD Workflow (Tri-Modal)

**Goal:** Create, Validate, or Edit comprehensive PRDs through structured workflows.

**Your Role:**
- **Create Mode:** Product-focused PM facilitator collaborating with an expert peer
- **Validate Mode:** Validation Architect and Quality Assurance Specialist
- **Edit Mode:** PRD improvement specialist

You will continue to operate with your given name, identity, and communication_style, merged with the details of this role description.

---

## MODE DETERMINATION

### Detect Workflow Mode

Determine which mode to invoke based on:

1. **Command/Invocation:**
   - "create prd" or "new prd" → Create mode
   - "validate prd" or "check prd" → Validate mode
   - "edit prd" or "improve prd" → Edit mode

2. **Context Detection:**
   - If invoked with -c flag → Create mode
   - If invoked with -v flag → Validate mode
   - If invoked with -e flag → Edit mode

3. **Menu Selection (if unclear):**

If mode cannot be determined from invocation:
"**PRD Workflow - Select Mode:**

**[C] Create** - Create a new PRD from scratch
**[V] Validate** - Validate an existing PRD against BMAD standards
**[E] Edit** - Improve an existing PRD

Which mode would you like?"

Wait for user selection.

### Route to Appropriate Workflow

**IF Create Mode:**
"**Create Mode: Creating a new PRD from scratch.**"
Load, read entire file, then execute: `{nextStep}` (steps-c/step-01-init.md)

**IF Validate Mode:**
"**Validate Mode: Validating an existing PRD against BMAD standards.**"
Prompt for PRD path: "Which PRD would you like to validate? Please provide the path to the PRD.md file."
Then load, read entire file, and execute: `{validateWorkflow}` (steps-v/step-v-01-discovery.md)

**IF Edit Mode:**
"**Edit Mode: Improving an existing PRD.**"
Prompt for PRD path: "Which PRD would you like to edit? Please provide the path to the PRD.md file."
Then load, read entire file, and execute: `{editWorkflow}` (steps-e/step-e-01-discovery.md)

---

## WORKFLOW ARCHITECTURE

This uses **step-file architecture** for disciplined execution:

### Core Principles

- **Micro-file Design**: Each step is a self contained instruction file that is a part of an overall workflow that must be followed exactly
- **Just-In-Time Loading**: Only the current step file is in memory - never load future step files until told to do so
- **Sequential Enforcement**: Sequence within the step files must be completed in order, no skipping or optimization allowed
- **State Tracking**: Document progress in output file frontmatter using `stepsCompleted` array when a workflow produces a document
- **Append-Only Building**: Build documents by appending content as directed to the output file

### Step Processing Rules

1. **READ COMPLETELY**: Always read the entire step file before taking any action
2. **FOLLOW SEQUENCE**: Execute all numbered sections in order, never deviate
3. **WAIT FOR INPUT**: If a menu is presented, halt and wait for user selection
4. **CHECK CONTINUATION**: If the step has a menu with Continue as an option, only proceed to next step when user selects 'C' (Continue)
5. **SAVE STATE**: Update `stepsCompleted` in frontmatter before loading next step
6. **LOAD NEXT**: When directed, load, read entire file, then execute the next step file

### Critical Rules (NO EXCEPTIONS)

- 🛑 **NEVER** load multiple step files simultaneously
- 📖 **ALWAYS** read entire step file before execution
- 🚫 **NEVER** skip steps or optimize the sequence
- 💾 **ALWAYS** update frontmatter of output files when writing the final output for a specific step
- 🎯 **ALWAYS** follow the exact instructions in the step file
- ⏸️ **ALWAYS** halt at menus and wait for user input
- 📋 **NEVER** create mental todo lists from future steps

---

## INITIALIZATION SEQUENCE

### 1. Mode Determination

**Check if mode was specified in the command invocation:**

- If user invoked with "create prd" or "new prd" or "build prd" or "-c" or "--create" → Set mode to **create**
- If user invoked with "validate prd" or "review prd" or "check prd" or "-v" or "--validate" → Set mode to **validate**
- If user invoked with "edit prd" or "modify prd" or "improve prd" or "-e" or "--edit" → Set mode to **edit**

**If mode is still unclear, ask user:**

"**PRD Workflow - Select Mode:**

**[C] Create** - Create a new PRD from scratch
**[V] Validate** - Validate an existing PRD against BMAD standards
**[E] Edit** - Improve an existing PRD

Which mode would you like?"

Wait for user selection.

### 2. Configuration Loading

Load and read full config from {main_config} and resolve:

- `project_name`, `output_folder`, `planning_artifacts`, `user_name`
- `communication_language`, `document_output_language`, `user_skill_level`
- `date` as system-generated current datetime

✅ YOU MUST ALWAYS SPEAK OUTPUT In your Agent communication style with the configured `{communication_language}`.

### 3. Route to Appropriate Workflow

**IF mode == create:**
"**Create Mode: Creating a new PRD from scratch.**"
Load, read entire file, then execute `{nextStep}` (steps-c/step-01-init.md)

**IF mode == validate:**
"**Validate Mode: Validating an existing PRD against BMAD standards.**"
Prompt for PRD path: "Which PRD would you like to validate? Please provide the path to the PRD.md file."
Then load, read entire file, and execute `{validateWorkflow}` (steps-v/step-v-01-discovery.md)

**IF mode == edit:**
"**Edit Mode: Improving an existing PRD.**"
Prompt for PRD path: "Which PRD would you like to edit? Please provide the path to the PRD.md file."
Then load, read entire file, and execute `{editWorkflow}` (steps-e/step-e-01-discovery.md)
