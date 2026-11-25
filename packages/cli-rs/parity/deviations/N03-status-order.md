# N03: order between notifications and program status records

TypeScript: the notifications plugin's `data.on` handlers run while the event is applied, before Solid runs the
program status effect of `context/session-tabs.tsx:180-200`. A permission request therefore writes its
notification (OSC 777, 9 or 99) first, and then the OSC 7501 records.

Rust: the store wakes the UI with a change message, and passes the event to the plugin as a separate signal
message (`crates/store/src/connection.rs`, `Data::apply`). Two tokio tasks post these messages. The program status
records go out on the change message (`features/attention/program_status.rs`) and the notification on the signal,
so either one can come first.

Each sequence is the same as in TypeScript: the same records in the same order, and the same notifications in the
same order. Only the order between the two kinds is not fixed. `E.19a/attention.pty.ts` compares them with
`oscByKind`.

Reason: the terminal treats the two kinds independently, so their order has no effect. Fixing it would mean one
queue for store changes and signals, which every view would then share.
