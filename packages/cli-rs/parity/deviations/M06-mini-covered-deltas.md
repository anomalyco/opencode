# M06: mini keeps a live delta that occurs in the listed text

**TypeScript.** The stream subscribes before the messages are listed, so a delta sent before the list can arrive
after it. The fragment reconciler (`stream-v2.fragment.ts:44-63`) drops a live delta when it occurs anywhere in the
listed text that no earlier delta consumed. When mini attaches to a reply that is already streaming, the deltas sent
before the subscription never arrive, so that text is never consumed, and a later delta that happens to occur in it
(a space, a comma, " the") is dropped. A list of `"a b"` followed by the deltas `" "` and `"c"` shows `a bc`.

A resize replay restores the text this client printed with the same projection, so a delta that waited for the list
and occurs in that text is dropped too.

**Rust.** Deltas carry no sequence number and a listed part no version, so `Fragments::delta` uses their order: a
delta sent before the list repeats the end of the listed text. A run of deltas is dropped only when it ends where the
listed text ends. While a run occurs in the listed text but does not reach its end, it is held back, and it is shown
as soon as the next delta proves it new. The list of `"a b"` followed by `" "` and `"c"` shows `a b c`; followed by
`" "` and `"b"`, it shows `a b`. A resize replay checks the deltas that waited for its list against the text it
restores the same way.

A new delta that equals the end of the listed text is still dropped: without a sequence number it cannot be told apart
from a repeated one. The server lists a part's text only when it ends, and sends no delta after that, so the case does
not occur with it.

**Reason.** Simon decided to fix this defect the TS client shares in Rust, with no upstream proposal.
