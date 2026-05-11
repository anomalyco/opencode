tl;dr All of these APIs work, are properly type-checked, and are sync events are backwards compatible with `Bus`:

```ts
// The schema from `Updated` typechecks the object correctly
SyncEvent.run(Updated, { sessionID: id, info: { title: "foo" } })

// `subscribeAll` passes a generic sync event
SyncEvent.subscribeAll((event) => {
  // These will be type-checked correctly
  event.id
  event.seq
  // This will be unknown because we are listening for all events,
  // and this API is only used to record them
  event.data
})

// This works, but you shouldn't publish sync event like this (should fail in the future)
Bus.publish(Updated, { sessionID: id, info: { title: "foo" } })

// Update event is fully type-checked
Bus.subscribe(Updated, (event) => event.properties.info.title)

// Update event is fully type-checked
client.subscribe("session.updated", (evt) => evt.properties.info.title)
```

# Goal

## Syncing with only one writer

This system defines a basic event sourcing system for session replayability. The goal is to allow for one device to control and modify the session, and allow multiple other devices to "sync" session data. The sync works by getting a log of events to replay and replaying them locally.

Because only one device is allowed to write, we don't need any kind of sophisticated distributed system clocks or causal ordering. We implement total ordering with a simple sequence id (a number) and increment it by one every time we generate an event.

## Bus event integration and backwards compatibility

This initial implementation aims to be fully backwards compatible. We should be able to land this without any visible changes to the user.

An existing `Bus` abstraction to send events already exists. We already send events like `session.created` through the system. We should not duplicate this.

The difference in event sourcing is events are sent _before_ the mutation happens, and "projectors" handle the effects and perform the mutations. This difference is subtle, and a necessary change for syncing to work.

So the goal is:

- Introduce a new syncing abstraction to handle event sourcing and projectors
- Seamlessly integrate these new events into the same existing `Bus` abstraction
- Maintain full backwards compatibility to reduce risk

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

The data passed as the second argument is properly type-checked based on the schema defined in `Created`.

Importantly, **sync events automatically re-publish as bus events**. This makes them backwards compatible, and allows the `Bus` to still be the single abstraction that the system uses to listen for individual events.

**We have upgraded many of the session events to be sync events** (all of the ones that mutate the db). Sync and bus events are largely compatible. Here are the differences:

### Event shape

- The shape of the events are slightly different. A sync event has the `type`, `id`, `seq`, `aggregateID`, and `data` fields. A bus event has the `type` and `properties` fields. `data` and `properties` are largely the same thing. This conversion is automatically handled when the sync system re-published the event through the bus.

The reason for this is because sync events need to track more information. I chose not to copy the `properties` naming to more clearly disambiguate the event types.

### Event flow

There is no way to subscribe to individual sync events in `SyncEvent`. You can use `subscribeAll` to receive _all_ of the events, which is needed for clients that want to record them.

To listen for individual events, use `Bus.subscribe`. You can pass in a sync event definition to it: `Bus.subscribe(Created, handler)`. This is fully supported.

You should never "publish" a sync event however: `Bus.publish(Created, ...)`. I would like to force this to be a type error in the future. You should never be touching the db directly, and should not be manually handling these events.

### Backwards compatibility

The system install projectors in `server/projectors.js`. It calls `SyncEvent.init` to do this. It also installs a hook for dynamically converting an event at runtime (`convertEvent`).

This allows you to "reshape" an event from the sync system before it's published to the bus. This should be avoided, but might be necessary for temporary backwards compat.

The only time we use this is the `session.updated` event. Previously this event contained the entire session object. The sync event only contains the fields updated. We convert the event to contain the full object for backwards compatibility (but ideally we'd remove this).

It's very important that types are correct when working with events. Event definitions have a `schema` which carries the definition of the event shape (provided by a zod schema, inferred into a TypeScript type). Examples:

```ts
// The schema from `Updated` typechecks the object correctly
SyncEvent.run(Updated, { sessionID: id, info: { title: "foo" } })

// `subscribeAll` passes a generic sync event
SyncEvent.subscribeAll((event) => {
  // These will be type-checked correctly
  event.id
  event.seq
  // This will be unknown because we are listening for all events,
  // and this API is only used to record them
  event.data
})

// This works, but you shouldn't publish sync event like this (should fail in the future)
Bus.publish(Updated, { sessionID: id, info: { title: "foo" } })

// Update event is fully type-checked
Bus.subscribe(Updated, (event) => event.properties.info.title)

// Update event is fully type-checked
client.subscribe("session.updated", (evt) => evt.properties.info.title)
```

The last two examples look similar to `SyncEvent.run`, but they were the cause of a lot of grief. Those are existing APIs that we can't break, but we are passing in the new sync event definitions to these APIs, which sometimes have a different event shape.

I previously mentioned the runtime conversion of events, but we still need to the types to work! To do that, the `define` API supports an optional `busSchema` prop to give it the schema for backwards compatibility. For example this is the full definition of `Session.Update`:

```ts
const Update = SyncEvent.define({
  type: "session.updated",
  version: 1,
  aggregate: "sessionID",
  schema: z.object({
    sessionID: SessionID.zod,
    info: partialSchema(Info),
  }),
  busSchema: z.object({
    sessionID: SessionID.zod,
    info: Info,
  }),
})
```

_Important_: the conversion done in `convertEvent` is not automatically type-checked with `busSchema`. It's very important they match, but because we need this at type-checking time this needs to live here.

Internally, the way this works is `busSchema` is stored on a `properties` field which is what the bus system expects. Doing this made everything with `Bus` "just work". This is why you can pass a sync event to the bus APIs.

_Alternatives_

These are some other paths I explored:

- Providing a way to subscribe to individual sync events, and change all the instances of `Bus.subscribe` in our code to it. Then you are directly only working with sync events always.
  - Two big problems. First, `Bus` is instance-scoped, and we'd need to make the sync event system instance-scoped too for backwards compat. If we didn't, those listeners would get calls for events they weren't expecting.
  - Second, we can't change consumers of our SDK. So they still have to use the old events, and we might as well stick with them for consistency
- Directly add sync event support to bus system
  - I explored adding sync events to the bus, but due to backwards compat, it only made it more complicated (still need to support both shapes)
- I explored a `convertSchema` function to convert the event schema at runtime so we didn't need `busSchema`
  - Fatal flaw: we need type-checking done earlier. We can't do this at run-time. This worked for consumers of our SDK (because it gets generated TS types from the converted schema) but breaks for our internal usage of `Bus.subscribe` calls

I explored many other permutations of the above solutions. What we have today I think is the best balance of backwards compatibility while opening a path forward for the new events.
