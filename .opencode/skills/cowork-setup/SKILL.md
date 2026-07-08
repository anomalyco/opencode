---
name: cowork-setup
description: Set up an OpenWork folder, scaffold PROJECTS/TEMPLATES/OUTPUTS/ABOUT-ME, or refresh the work layout. Use when the user asks to "set up cowork", "initialize work folder", or points the agent at a new folder for knowledge work.
---

# OpenWork folder setup

This skill guides the work agent through creating or repairing the OpenWork folder layout used by opencode Cowork mode.

## Canonical layout

Every work folder has exactly these entries; the agent may rely on them without searching:

```
ABOUT-ME/
  about-me.md        — who the user is, stable context
  writing-style.md   — voice, tone, formatting preferences
PROJECTS/
  <one subfolder per long-running initiative>
TEMPLATES/
  <reusable templates the user curates>
OUTPUTS/
  <the ONLY place the work agent may write deliverables>
FOLDER.md
  per-folder instructions (read alongside ABOUT-ME/)
```

## Scaffolding rules

1. If the target directory is missing any of `ABOUT-ME/`, `PROJECTS/`, `TEMPLATES/`, `OUTPUTS/`, create them.
2. Seed `ABOUT-ME/about-me.md`, `ABOUT-ME/writing-style.md`, and `FOLDER.md` with the templates below, BUT NEVER overwrite an existing file. User content is sacred.
3. Add `.gitkeep` inside the four subdirectories so empty folders survive in git.
4. After scaffolding, read `ABOUT-ME/about-me.md` and `FOLDER.md` and report them back to the user so they can fill them in or confirm they're correct.

## Seed templates

### ABOUT-ME/about-me.md
```
# About me

## Role
## Context
## Preferences
```

### ABOUT-ME/writing-style.md
```
# Writing style

## Voice
## Tone
## Formatting rules
```

### FOLDER.md
```
# Folder instructions

## Conventions
## Defaults
```

## What to ask the user

After scaffolding, ask (max 2 questions):
- "What is your role and what kind of work goes in this folder?"
- "Anything about writing style I should know? (tone, language, formatting)"

Use the answers to populate `ABOUT-ME/about-me.md` and `ABOUT-ME/writing-style.md` only if the user explicitly consents.

## Don'ts

- Don't delete existing files inside the target directory.
- Don't move user files. Organizing files is a separate task that requires its own approval.
- Don't create deliverables outside `OUTPUTS/`.