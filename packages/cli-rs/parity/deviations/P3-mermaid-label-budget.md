# P.3: a state diagram's label search is bounded

**TypeScript.** Each transition label of a state diagram searches the spots around its route until one is clear.
With many labeled transitions between the same states, the spots crowd and the search grows faster than the number
of transitions: 128 such transitions take minutes.

**Rust.** The search is faster but checks the same spots in the same order, so every diagram that draws, draws as in
TS. One diagram may check at most 4,000,000 spots (`state::routing::MAX_LABEL_CHECKS`; 128 labeled transitions
between two states take about 3,000,000, the diagrams in the corpus at most a few thousand). Past it the layout fails
and the fence shows its source.

**Reason.** A fence must not freeze the UI thread for a diagram a reply can write.
