# V15: permission-blocked tools stay in their group

E.8's scrolling, navigation, groups, and per-tab scroll anchors match the TypeScript cells (`E.8/navigate` and
`E.8/tab-anchor`: every checkpoint has zero differing cells). One difference remains; no checkpoint shows it.

Permission-blocked tools in exploration and activity groups (`partitionPending`, `grouping/session.ts:163-176`) are
not split out: a pending tool stays inside its collapsed group. The permission prompt (E.9a) shows the request below
the transcript, so nothing is hidden. Reason: E.9a and E.7a own the pending tool rows.
