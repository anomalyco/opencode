# V15: no saved scroll anchor

E.8's scrolling, navigation, and groups match the TypeScript cells where both show the same rows
(`E.8/navigate`: every checkpoint, `page-up` included, has zero differing cells). `session.first` mounts the
oldest 60 rows and mounts newer ones as the reader scrolls down, and `session.submit_scroll` returns to the newest
rows after a send unless it is `keep`, as in TypeScript. One difference remains; no checkpoint shows it.

The scroll anchor is not saved. TypeScript keeps each tab's scroll anchor in the session tabs
(`sessionTabs.setScrollAnchor`, `context/session-tabs.tsx:400-410`), so a tab reopens where it was. Rust keeps the
open and closed groups per session as TypeScript does (`sessionTabs.groupExpanded`, kept by
`tabs::Tabs::expanded_groups`), but a session view that mounts again starts at the bottom. Reason: the anchor needs
the transcript to restore a row's screen position after its rows mount, and a per-tab field in `tabs/**`, which
another step is changing.

Permission-blocked tools in exploration and activity groups (`partitionPending`) are not split out either: a
pending tool stays inside its collapsed group. The permission prompt (E.9a) shows the request below the
transcript, so nothing is hidden. Reason: E.9a and E.7a own the pending tool rows.
