# Instance Context

Instance selection is now Effect-provided context.

Use these APIs:

- `InstanceRef` for the current project context.
- `WorkspaceRef` for the current workspace id.
- `InstanceState.context` / `InstanceState.directory` inside Effect services that require an instance.
- `InstanceStore` at entry boundaries that need to load, reload, or dispose project contexts.
- `EffectBridge` for native, plugin, or plain JavaScript callback boundaries that need to re-enter Effect with captured refs.

Do not add new ambient instance globals. Promise and callback boundaries should either stay in Effect, use `EffectBridge`, or pass the required context explicitly.
