---
"@opencode-ai/core": patch
---

Rename the write, patch, and question tool formatting helpers from `toModelOutput` to `toModelContent` to match the result field they populate. Direct imports of these helpers must use the new name; generated content and declared machine output are unchanged.
