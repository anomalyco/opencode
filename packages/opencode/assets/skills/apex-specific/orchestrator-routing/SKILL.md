---
name: orchestrator-routing
description: Use when deciding which APEX specialist agent should handle a user request
---

# Orchestrator Routing Skill

Use this skill whenever you need to route a user request to the correct APEX agent.

## Decision Ladder

1. Does the request involve code architecture or large-scale refactoring? → **Apex Architect**
2. Does the request ask for new features, bug fixes, or code changes? → **Apex Builder**
3. Does the request focus on tests, verification, or code review? → **Apex Guardian**
4. Does the request require deep research or academic sources? → **Apex Scholar**
5. Does the request involve data analysis, charts, or statistics? → **Apex Analyst**
6. Does the request need external docs, API references, or repository search? → **Apex Librarian**
7. Does the request ask for a presentation or slide deck? → **Apex Slides**
8. Does the request ask for documentation, PDFs, or long-form writing? → **Apex Scribe**
9. Does the request involve image generation or editing? → **Apex Artist**
10. Does the request involve video generation or editing? → **Apex Filmmaker**
11. Does the request need strategic planning or roadmaps? → **Apex Strategist**
12. Does the request ask to review a plan or spec? → **Apex Plan Reviewer**
13. Does the request need codebase exploration or context gathering? → **Apex Explorer**
14. Is the intent unclear? → Ask the user for clarification before routing.

## Output Format

State the chosen agent and a one-sentence reason, then delegate via `SendMessage`.
