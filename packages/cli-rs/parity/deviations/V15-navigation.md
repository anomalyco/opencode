# V15: no saved scroll anchor, and session.first without a head window

E.8's scrolling, navigation, and groups match the TypeScript cells where both show the same rows
(`E.8/navigate`: every checkpoint, `page-up` included, has zero differing cells). Three differences remain;
no checkpoint shows them.

1. The scroll anchor is not saved. TypeScript keeps each tab's scroll anchor in the session tabs
   (`sessionTabs.setScrollAnchor`, `context/session-tabs.tsx:400-410`), so a tab reopens where it was. Rust keeps
   the open and closed groups per session as TypeScript does (`sessionTabs.groupExpanded`, kept by
   `tabs::Tabs::expanded_groups`), but a session view that mounts again starts at the bottom. Reason: the anchor
   needs the transcript to restore a row's screen position after its rows mount, which the window
   (`messages/list.rs`) does not offer yet.
2. `session.first` mounts every loaded row. TypeScript mounts the first 60 rows (`setVisibleRowsEnd`) and
   mounts newer ones as the reader scrolls down (`revealNewerRows`). Rust's window (E.6a) only trims older
   rows, so after `session.first` a long session has every row mounted until `session.last` or a scroll back
   to the bottom returns to the tail. The screen is the same. Reason: an end window is a second windowing
   mode in `messages/list.rs`; it can come when a long session shows a cost.
3. `session.submit_scroll` is not applied. TypeScript's prompt calls `toBottom` after a submit unless it is
   `keep` (`routes/session/index.tsx:1650-1652`). The Rust prompt (E.2) has no submit hook for the route yet;
   a new message still scrolls into view while the reader is at the bottom, because the transcript is sticky.

Permission-blocked tools in exploration and activity groups (`partitionPending`) are not split out either: a
pending tool stays inside its collapsed group. The permission prompt (E.9a) shows the request below the
transcript, so nothing is hidden. Reason: E.9a and E.7a own the pending tool rows.
