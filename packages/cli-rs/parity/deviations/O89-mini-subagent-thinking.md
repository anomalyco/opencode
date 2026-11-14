# O89: mini's subagent reasoning follows `/settings`

**TypeScript.** The subagent tracker takes `thinking` once, when the transport starts (`runtime.ts:801`,
`stream-v2.transport.ts:541`). After `/settings` hides Reasoning, a subagent started later still shows its
reasoning in the subagent view, and showing Reasoning again does not bring it back for children. The main transcript
follows the setting at once.

**Rust.** `/settings` sets the tracker's `thinking` too (`Footers::set_thinking`, `Tracker::set_thinking`), so a
child's reasoning that arrives after the change follows the new setting, as the main transcript does. Reasoning
already shown stays, as in the main transcript.

**Reason.** The user decided to fix the defects the TS client shares in Rust and record them as deviations, with no
upstream proposal (O-89).
