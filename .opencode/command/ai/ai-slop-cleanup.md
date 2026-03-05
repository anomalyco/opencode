---
title: "AI Slop Cleanup"
description: "Remove AI-style code slop from branch changes"
summary: "Review branch diff against dev and clean inconsistent AI-generated patterns"
category: "AI"
icon: "🤖"
tags: ["ai", "cleanup", "refactor", "quality"]
agent: "ai"
---

Check the diff against dev, and remove all AI generated slop introduced in this branch.

This includes:

- Extra comments that a human wouldn't add or is inconsistent with the rest of the file
- Extra defensive checks or try/catch blocks that are abnormal for that area of the codebase (especially if called by trusted / validated codepaths)
- Casts to any to get around type issues
- Any other style that is inconsistent with the file
- Unnecessary emoji usage

Report at the end with only a 1-3 sentence summary of what you changed
