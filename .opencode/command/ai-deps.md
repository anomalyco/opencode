---
description: "Bump AI sdk dependencies minor / patch versions only"
---

Please read @package.json and @packages/opencode/package.json.

Your job is to look into AI SDK dependencies, figure out if they have versions that can be upgraded (minor or patch versions ONLY no major ignore major changes).

I want a report of every dependency and the version that can be upgraded to.
What would be even better is if you can give me links to the changelog for each dependency, or at least some reference info so I can see what bugs were fixed or new features were added.

Consider using subagents for each dep to save your context window.

Here is a short list of some deps (please be comprehensive tho):

- "ai"
- "@ai-sdk/openai"
- "@ai-sdk/anthropic"
- "@openrouter/ai-sdk-provider"
- etc, etc

DO NOT upgrade the dependencies yet, just make a list of all dependencies and their versions that can be upgraded to minor or patch versions only.

Write up your findings to ai-sdk-updates.md
