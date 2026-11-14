# P02: an Enter before the catalogs load is held, not dropped

TypeScript: `submitInner` returns early when it has no agent or model selection
(`packages/tui/src/component/prompt/index.tsx:1165-1171`). Until the location's agent list loads,
`local.agent.current()` is `undefined` (`packages/tui/src/context/local.tsx:89-98`), so an Enter does nothing and the
text stays. When agents have loaded but models have not, `local.model.selection()` is `undefined`, so the Enter shows
"Connect an integration to send prompts" and, while the integration list is also unloaded, opens the integration
dialog (`index.tsx:319-328`). Only `--prompt` waits for the catalogs and then submits (`routes/home.tsx:68-79`).

Rust: an Enter before the agent and model catalogs load is held like `--prompt`. It submits, with its delivery, once
everything a submit needs has loaded, if the prompt still has the same text; an edit cancels it, and a later Enter
replaces it (`crates/tui/src/prompt/submit.rs`, `prompt/editor.rs` `submit_startup`).

Reason: on a fresh start a user who types quickly loses the submit in TS, or gets a warning that names a missing
integration that is only loading. Holding the Enter reuses the `--prompt` path and shows no state TS does not.
