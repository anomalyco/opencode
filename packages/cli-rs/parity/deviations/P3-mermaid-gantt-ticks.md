# P.3: a Gantt axis stops at 10,000 ticks

**TypeScript.** The Gantt axis puts a tick at every step from the first task to the last, and a step is at most a
year. A chart spanning millions of years adds millions of ticks, and one whose dates are so large that adding a step
no longer changes the value (`dateFormat x` with `1e300`) adds ticks forever: the renderer never returns.

**Rust.** The axis takes at most 10,000 ticks, so such a chart draws, with its ticks bunched at the left of the axis.
Charts spanning up to 10,000 years draw as in TS.

**Reason.** A fence must not hang the UI thread. No chart drawn on a terminal shows more ticks than its 64 columns.
