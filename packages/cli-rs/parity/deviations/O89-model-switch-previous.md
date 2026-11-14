# O89: a model switch without `previous` keeps the old model

**TypeScript.** When `session.model.selected` has no `previous`, the row it inserts takes
`store.session.info[id].model` (`packages/client/src/solid/data.ts:783`). That is the store's proxy of the model
object. The next line sets the session's `model` to the event's, and Solid merges an object into the object at that
path, so the row's `previous` changes to the new model too. The row shows a switch from the new model to the new
model until the refetch of the projected message replaces it.

**Rust.** `on_model_selected` clones the old model, so `previous` is the model before the switch.

**Reach.** The server always sends `previous` when the session had a model (`core/src/session/session.ts:117`), so
only an event without it shows the difference. The F.7 fold oracle (`parity/fixtures/F.7/folds.json`,
`session.model.selected#no-previous@loaded`) records it.

**Reason.** The user's decision O-89: fix in Rust the defects TS shares, and record them as deviations.
