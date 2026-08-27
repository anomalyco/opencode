---
"@opencode-ai/core": minor
---

Rename ModelResolver.supported to ModelResolver.hasPackage. Consumers of the old export must update the name; the predicate remains Boolean(model.package), checking only whether a catalog model declares a provider package, not whether it can be loaded. Default-model selection behavior is unchanged.
