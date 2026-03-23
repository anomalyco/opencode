
# Goal

## Syncing with only one writer

This system defines a basic event sourcing system for session replayability. The goal is to allow for one device to control and modify the session, and allow multiple other devices to "sync" session data. The sync works by getting a log of events to replay and replaying them locally.

Because only one device is allowed to write, we don't need any kind of sophisticated distributed system clocks or causal ordering. We implement total ordering with a simple sequence id (a number) and increment it by one every time we generate an event.

## Bus event integration and backwards compatibility

This initial implementation aims to be fully backwards compatible. We should be able to land this without any visible changes to the user.

An existing `Bus` abstraction to send events already exists. We already send events like `session.created` through the system. We should not duplicate this.

The difference in event sourcing is events are sent _before_ the mutation happens, and "projectors" handle the effects and perform the mutations. This difference is subtle, and a necessary change for syncing to work.

So the goal is:

* Introduce a new syncing abstraction to handle event sourcing and projectors
* Seamlessly integrate these new events into the same existing `Bus` abstraction
* Maintain full backwards compatibility to reduce risk

## My approach

This directory introduces a new abstraction: `SyncEvent`. This handles all of the event sourcing.

There are now "sync events" which are different than "bus events". Bus events are defined like this:

```ts
const Diff = BusEvent.define(
  "session.diff",
  z.object({
    sessionID: SessionID.zod,
    diff: Snapshot.FileDiff.array(),
  }),
)
```

You can do `Bus.publish(Diff, { ... })` to push these events, and `Bus.subscribe(Diff, handler)` to listen to them.

Sync events are a lower-level abstraction which are similar, but also handle the requirements for recording and replaying. Defining them looks like this:

```ts
const Created = SyncEvent.define({
  type: "session.created",
  version: 1,
  aggregate: "sessionID",
  schema: z.object({
    sessionID: SessionID.zod,
    info: Info,
  }),
})
```


Not too different, except they track a version and an "aggregate" field (will explain that later).

You do this to run an event, which is kind of like `Bus.publish` except that it runs through the event sourcing system:

```
SyncEvent.run(Created, { ... })
```

Importantly, **sync events automatically re-publish as bus events**. This makes them backwards compatible, and allows the `Bus` to still be the single abstraction that the system uses to listen for individual events.

**We have upgraded many of the session events to be sync events** (all of the ones that mutate the db). Sync and bus events are largely compatible. Here are the differences:

### Event shape

* The shape of the events are slightly different. A sync event has the `type`, `id`, `seq`, `aggregateID`, and `data` fields. A bus event has the `type` and `properties` fields. `data` and `properties` are largely the same thing. This conversation is automatically handled when the sync system re-published the event throught the bus.

The reason for this is because sync events need to track more information. I chose not to copy the `properties` naming to more clearly disambiguate the event types.

### Event flow

There is no way to subscribe to individual sync events in `SyncEvent`. You can use `subscribeAll` to receive _all_ of the events, which is needed for clients that want to record them.

To listen for individual events, use `Bus.subscribe`. You can pass in a sync event definition to it: `Bus.subscribe(Created, handler)`. This is fully supported.

You should never "publish" a sync event however: `Bus.publish(Created, ...)`. This will throw a type error on purpose; sync events must always be run through the sync system directly.

### Backwards compatibility

The system install projectors in `server/projectors.js`. It calls `SyncEvent.init` to do this. It also installs two different hooks for providing backwards compatibility:

* `convertDefinition`: a function that convert a zod definition for an event schema
* `convertEvent`: a function that converts an individual event's data

These hooks allow for arbitrary conversions at runtime, allowing for us to provide a backwards compatible interface to clients.

For example, the sync system changed the `session.updated` event to only include the fields that were changed, compared to before where it returned the full session object. We install converters to load the full session object and return it to clients.

**Important**: 