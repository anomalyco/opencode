// The per-subscriber backlog of events awaiting SSE delivery is bounded so a
// consumer that stops draining cannot grow it without limit. A TCP connection
// stuck in CLOSE_WAIT never surfaces an abort, so the only cleanup signal for
// an event stream used to be one a half-dead peer never sends; meanwhile its
// queue kept absorbing the full event firehose (#20695).
//
// On overflow the queue ends instead of dropping events silently: buffered
// events still flush, the response completes, finalizers unsubscribe the
// listener, and a live client reconnects and resyncs from the event log
// (sync events carry a total order, see src/sync/README.md, which is what
// makes disconnection safe).
//
// Sizing: events are small JSON payloads; healthy consumers drain within
// milliseconds while heavy streaming bursts run to the low thousands. 10k
// absorbs bursts with ample margin yet caps a dead connection's cost at a
// few megabytes instead of unbounded gigabytes.
export const SUBSCRIBER_BACKLOG_CAPACITY = 10_000
