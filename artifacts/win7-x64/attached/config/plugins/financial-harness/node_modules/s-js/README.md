# S.js

S.js is a small reactive programming library.  It combines an automatic dependency graph with a synchronous execution engine.  The goal is to make reactive programming simple, clean, and fast.  

An S app consists of *data signals* and *computations*:

- *data signals* are created with `S.data(<value>)`.  They are small containers for a piece of data that may change.

- *computations* are created with `S(() => <code>)`.  They are kept up-to-date as data signals change.

Both kinds of signals are represented as small functions: call a signal to read its current value, pass a data signal a new value to update it.

Beyond these two, S has a handful of utilities for controlling what counts as a change and how S responds.

## Features

**Automatic Updates** - When data signal(s) change, S automatically re-runs any computations which read the old values.

**A Clear, Consistent Timeline** - S apps advance through a series of discrete "ticks."  In each tick, all signals are guaranteed to return up-to-date values, and state is immutable until the tick completes.  This greatly simplifies the often difficult task of reasoning about how change flows through a reactive app.

**Batched Updates** - Multiple data signals can be changed in a single tick (aka "transactions").

**Automatic Disposals** - S computations can themselves create more computations, with the rule that "child" computations are disposed when their "parent" updates.  This simple rule allows apps to be leak-free without the need for manual disposals.

## A Quick Example

Start with the the world's smallest web app.  It just sets the body of the page to the text "Hello, world!"

```javascript
let greeting = "Hello",
    name = "world";

document.body.textContent = `${greeting}, ${name}!`;
```

Now let's change the name.

```javascript
name = "reactivity";
```

The page is now out of date, since it still has the old name, "Hello, world!"  It didn't *react* to the data change.  So let's fix that with S's wrappers.

```javascript
let greeting = S.data("Hello"),
    name = S.data("world");

S(() => document.body.textContent = `${greeting()}, ${name()}!`);
```

The wrappers return small functions, called *signals*, which are containers for values that change over time.  We read the current value of a signal by calling it, and if it's a data signal, we can set its next value by passing it in.

```javascript
name("reactivity");
```

S knows that we read the old value of `name()` when we set the page text, so it re-runs that computation now that `name()` has changed.  The page now reads "Hello, reactivity!"  Yay!

We've converted the plain code we started with into a small machine, able to detect and keep abreast of incoming changes.  Our data signals define the kind of changes we might see, our computations how we respond to them.

For longer examples see:
- the [minimalist todos](https://github.com/adamhaile/surplus#example) application in the [Surplus](https://github.com/adamhaile/surplus) library
- the [Surplus implementation of the "Realworld" demo](https://github.com/adamhaile/surplus-realworld)

## API

## Data Signals

### `S.data(<value>)`
A data signal is a small container for a single value.  It's where information and change enter the system.  Read the current value of a data signal by calling it, set the next value by passing in a new one:

```javascript
const name = S.data("sue");
name(); // returns "sue"
name("emily") // sets name() to "emily" and returns "emily"
```

Data signals define the granularity of change in your application.  Depending on your needs, you may choose to make them fine-grained &ndash; containing only an atomic value like a string, number, etc &ndash; or coarse &ndash; an entire large object in a single data signal.

Note that when setting a data signal you are setting the **next** value: if you set a data signal in a context where time is frozen, like in an `S.freeze()` or a computation body, then your change will not take effect until time advances.  This is because of S's unified global timeline of atomic instants: if your change took effect immediately, then there would be a before and after the change, breaking the instant in two:

```javascript
const name = S.data("sue");
S.freeze(() => {
    name("mary"); // *schedules* next value of "mary" and returns "mary"
    name(); // still returns "sue"
});
name(); // now returns "mary";
```

Most of the time, you are setting a data signal at top level (outside a computation or freeze), so the system immediately advances to account for the change.

It is an error to schedule two different next values for a data signal (where "different" is determined by `!==`):

```javascript
const name = S.data("sue");
S.freeze(() => {
    name("emily");
    name("emily"); // OK, "emily" === "emily"
    name("jane"); // EXCEPTION: conflicting changes: "emily" !== "jane"
});
```

Data signals created by `S.data()` always fire a change event when set, even if the new value is the same as the old:

```javascript
const name = S.data("sue"),
    counter = S.on(name, c => c + 1, 0); // counts name() change events
counter(); // returns 1 to start
name("sue"); // fire three change events, all with same value
name("sue");
name("sue");
counter(); // now returns 4
```

### `S.value(<value>)`

`S.value()` is identical to `S.data()` except that it does not fire a change event when set to the same value.  It tells S "only the value of this data signal is important, not the set event."

```javascript
const name = S.value("sue"),
    counter = S.on(name, c => c + 1, 0);
counter(); // returns 1 to start
name("sue"); // set to the same value
counter(); // still returns 1, name() value didn't change
```

The default comparator is `===`, but you can pass in a custom one as a second parameter if something else is more appropriate:

```javascript
const user = S.value(sue, (a, b) => a.userId === b.userId);
```

## Computations

### `S(() => <code>)`
A computation is a "live" piece of code which S will re-run as needed when data signals change.

S runs the supplied function immediately, and as it runs, S automatically monitors any signals that it reads.  To S, your function looks like:
```javascript
S(() => {
        ... foo() ...
    ... bar() ...
       ... bleck() ... zog() ...
});
```
If any of those signals change, S schedules the computation to be re-run.

The referenced signals don't need to be in the lexical body of the function: they might be in a function called from your computation.  All that matters is that evaluating the computation caused them to be read.  

Similarly, signals that are in the body of the function but aren't read due to conditional branches aren't recorded.  This is true even if prior executions went down a different branch and did read them: only the last run matters, because only those signals were involved in creating the current value.

If some of those signals are computations, S guarantees that they will always return a current value.  You'll never get a "stale" value, one that is affected by an upstream change but hasn't been updated yet.  To your function, the world is always temporally consistent.

S also guarantees that, no matter how many changed data signals are upstream of your function and no matter how many paths there are through the graph from them to your function, it will only run once per update.

Together, these two qualities make S "glitchless" (named after [this scene from The Matrix](https://www.youtube.com/watch?v=z_KmNZNT5xw)): you'll never experience the same moment twice (redundant updates of a computation) or two moments at once (stale and current values in the same update).

### Not Just Pure Functions

The functions passed to S don't have to be pure (i.e. no side-effects).  For instance, we can log all changes to `name()` like so:
```javascript
S(() => console.log(name());
```
Every time `name()` changes, this will re-run and re-log the value to the console.

In a sense, this expands the idea of what the 'value' of the computation is to include the side-effects it produces.

Tip: `S.cleanup()` and `S.on()` can be useful utilities when writing computations that perform side-effects.  The first can help make your computations idempotent (a nice property for effectful computations), while the second can help make it clear when they run.

### ... And Maybe Not Pure Functions

Ask yourself: if a pure computation isn't read in your app, does it need to run?

The `S()` constructor is symmetric: it takes a paramless function that returns a value, and it returns a paramless function that returns the same value.  The only difference is *when* that function runs.  Without `S()`, it runs once per call.  With `S()`, it runs once per change.  

While S computations are designed to have minimal overhead, the cost isn't zero, and it may be faster and/or clearer to leave some lambdas plain.  Any computations which call them will "see through" to any signals they reference, so they'll still be reactive.

Some rules of thumb:
1. If your function is O(1) and simple enough that its overhead is comparable to that of S's bookkeeping, leave it a plain lambda.  An example would be a `fullName()` function that just concats `firstName()` and `lastName()` data signals.

2. If your function is attached to an object that outlives its parent computation, lean towards a plain lambda, to avoid the need for manual lifecycle management (see `S.root()`).

3. On the other hand, if your function's complexity is O(N) (scales with the amount of data), lean towards a computation, unless you're sure that it will only be called a constant number of times per update cycle.

### Computations Creating Computations

S allows computations to expand the system with more computations.  

```javascript
const isLogging = S.value(true);
S(() => {
    if (isLogging()) {
        S(() => console.log(foo()));
        S(() => console.log(bar()));
        S(() => console.log(bleck()));
    }
});
```

In this example, the outer 'parent' or 'constructor' computation defines when we should be logging, while the inner 'child' computations are each responsible for logging a single signal.

Two important qualities to note:
1. The outer computation only depends on the signals it itself reads, in this case just `isLogging()`, while the inner ones only depend on their single signal, `foo()`, `bar()`, or `bleck()` respectively.
2. The inner computations are automatically disposed when the parent updates.  They can be thought of as part of the computation's 'value' and, like that value, only last until the next execution.

So if `isLogging()` changes to `false`, the outer computations re-runs, causing the inners to be disposed, and since they're not re-created, we stop logging.

This same pattern allows an entire web application to be built without any `dispose()`, `unsubscribe()` or `...DidUnmount()` handlers.  A single `route()` data signal may drive a `router()` computation which constructs the current view, including all the computations that make the view dynamic.  When the `route()` changes, all those computations are guaranteed to be disposed automatically.

For special cases where you want or need manual control of computations' lifetimes, see `S.root()`.

### Reducing Computations

### `S(val => <code>, <seed>)`
Construct a reducing computation, whose new value is derived from the last one, staring with `<seed>`.  For instance, this keeps a running sum of `foo()`:

```javascript
const sumFoo = S(sum => sum + foo(), 0);
```

### Static Dependencies

### `S.on(<signal>, val => <code>, <seed>, <onchanges>)`
Statically declare a computation's dependencies, rather than relying on S's automatic dependency detection. 

`<seed>` is optional, with default `undefined`.

`<onchanges>` is optional and defaults to `false`.  If `<onchanges>` is true, then the initial run is skipped (i.e. computation starts with value `<seed>` and doesn't run `<code>` until a change occurs).

`<signal>` may be an array, in which case dependencies are created for each signal in the array.

Most of the time, S's automatic dependency detection is what you want, but there are always exceptions, and `S.on()` lets you statically declare which signals a computation watches.

`S.on()` is useful when:
1. it's the event, not the value of a signal that's important. `S.on()` makes that clear.
2. it's syntactically cleaner than lots of `S.sample()` calls.

Note that, unlike in some other libraries, `S.on()` does not change the parameters a function receives, only when it runs.  Besides the first `<seed>` and last `<onchanges>` parameters, `S.on()` is identical to `S()`.

### Computation Roots

### `S.root(dispose => <code>)`
Computations created by `<code>` live until `dispose` is called.  S will log a warning if you try to construct a computation that is not under a root or parent computation.

```javascript
// assume this is top-level code, not in a computation
const foo = S(() => bar() + bleck()); // causes console warning
S.root(() => {
    const foo = S(() => bar() + bleck()); // no warning
})
```

As mentioned above, most computations in an S app are child computations, and their lifetimes are controlled by their parents.  But there are two exceptions:

1. True top-level computations, like the `router()` mentioned above, are not under any parent.
2. In certain corner cases, we may want computations to outlive their parents' update cycles.

For the first case, `S.root()` tells S that we really did mean for these computations to be top-level, and so no error is logged.

For the second case, `S.root()` lets the computations escape their parents.  They are 'orphaned' and will live until we call the `dispose` function.

A couple of cases where orphaning may be appropriate:

1. The computation is tied to a particular object and only references data signals belonging to that object.  In that case, orphaning it means it will last until the object is GC'd.

2. The computation is tied to external, imperative events which cannot be easily converted into declarative state.  So we create it inside an `S.root()` and call the supplied `dispose` function at the appropriate terminating event.


## Utilities

### Freezing The Clock To Apply Multiple Updates

### `S.freeze(() => <code>)`
Run `<code>`, but hold any data changes it produces in a pending state until it completes, at which point they all run as a single update.  If called within a computation, the system is already frozen, so `freeze` is inert.  Returns value of `<code>`.

This is also called a 'transaction' or 'changeset' in some other reactive libraries.

Data signals represent information coming from 'the outside': maybe the user, or a server response, or some other external source of information.  Sometimes these updates include new data for multiple data signals.  If we were to apply these changes one at a time, it a) might be inefficient, as the system would update for each single change, and b) might include states that never existed in the external system and don't make sense, when only a portion of the changes have been applied.

`S.freeze()` 'freezes' the clock and lets us batch changes so that they all run as a single update.

```javascript
const foo = S.data(1),
    bar = S.data(2);
S.freeze(() => {
    foo(3); // schedule two changes to run together
    bar(4);
    foo(), bar(); // still returns 1 and 2, as change hasn't been applied yet!
});
foo(), bar(); // now returns 3 and 4
```

Note that inside a computation, time is already frozen, due to the global atomic timeline, so in that context `S.freeze()` is inert.

### Sampling Signals To Avoid Dependencies

### `S.sample(<signal>)`
Sample the current value of `<signal>` but don't create a dependency on it.

In most cases, if we read a signal, then it matters to our computation and our computation should be re-run if the signal changes.  But there are cases where we want to tell S "due to changes in other signals, I know I want the current value of this signal, but I don't care if it changes."

For instance, say we wanted to increment `bar()` whenever `foo()` turns true.  We *do not* want to do it like this:

```javascript
S(() => { if (foo()) bar(bar() + 1); });
```

That code both reads and sets bar, meaning it immediately invalidates itself and has to run again ... and again ... and again, until S throws an exception and tells us we have a runaway mutation.

Instead, we want to do:

```javascript
S(() => { if (foo()) bar(S.sample(bar) + 1); });
```

That says "when `foo()` turns true, make `bar()` one more than its value at the time `foo()` changed."  It only runs once, as `bar()` is no longer an invalidator.

Note that in many cases, it may be clearer to use `S.on()` than `S.sample()` to accomplish the same effect (`S.on()` is built on `S.sample()`):

```javascript
S.on(foo, () => { if (foo()) bar(bar() + 1); });
```

Here, we don't need to sample `bar()`, as `S.on()` already limits our dependencies to just `foo()`.

### Cleaning Up Stale Side-Effects

### `S.cleanup(final => <code>)`
Run the given function just before the enclosing computation updates or is disposed.  The function receives a boolean parameter indicating whether this is the "final" cleanup, with `true` meaning the computation is being disposed, `false` it is being updated.

S.cleanup() is used in computations that cause side-effects.  It helps us revert the side-effects of the last execution, so that they don't continue to accumulate, and so that we can finally remove them when the computation is disposed.

For instance, say we want to attach a click event handler to an element whenever `foo()` is true:

```javascript
S(() => {
    if (foo()) {
        const onClickHandler = e => doSomething();
        el.addEventListener('click', onClickHandler);
    }
});
```

We then notice that even when `foo()` is false, `doSomething` is still called!  

This is because what our code is actually doing is attaching a *new* event listener each time `foo()` turns true.  If `foo()` goes true-false-true-false-true, we'll have three event handlers subscribed.  

Our side-effects are accumulating, when we want only the last one to be present.  Such a side-effect is called idempotent.

`S.cleanup()` lets us fix that:

```javascript
S(() => {
    if (foo()) {
        const onClickHandler = e => doSomething();
        el.addEventListener('click', onClickHandler);
        S.cleanup(() => el.removeEventListener('click', onClickHandler));
    }
});
```

The function passed into `S.cleanup()`, the one that removes the listener, will be called just before the computation's next update or, if that doesn't happen, just before the computation is disposed.  Since the cleanup removes the old listener, we'll be left with only 0 or 1 listeners, depending on whether `foo()` was true when the computation ran.

Because it's clearest to define cleanup functions adjacent to the code that needs cleaning up, S lets you call `S.cleanup()` as many times as you need in your computation.  All the supplied functions will run just before the computation updates or is disposed.

## Advanced

### Setting Data Signals From Computations

S allows computations to set data signals.  Since state is immutable during an update, these changes don't take effect until the current update finishes, at which point the system performs a follow-on update to account for the new values.

```javascript
S(() => { if (balance() < 0) overdrawn(true); });
```

There can be any number of follow-on updates.  The code below makes sure `foo()` is greater than 10 by incrementing it until it is.

```javascript
S(() => foo() > 10 || foo(foo() + 1));
```

Updates continue until there is a round where no more mutations are generated.  At that point, the system is called "at rest" or having "run to completion."  It awaits an external data signal change to initiate further updates.

Mutating data signals from computations is a very powerful feature but needs a few warnings:

1. Be careful not to create runaway mutation cycles, where your computation sets a data signal it also reads, thereby auto-invalidating itself and causing another run, and another, and another, etc.  This can be avoided by either using `S.on()` or `S.sample()` to suppress a dependency on the mutated signal, or by having a base condition that halts the cycle once the condition is met.  Note that if you do have a runaway mutation, S will throw an exception after an excessively long number of follow-on updates (currently hard-coded to 100,000).

2. Be aware that all the states of the mutated data signal are visible to other computations.  So in the line above that sets `overdrawn()`, there will be a round of updates where `balance()` is less than 0 but `overdrawn()` has not yet been set to `true`, followed by a round in which it has.

3. Not a bug but a feature: S will throw an exception if you try to set a data signal to two different values during the same update.  I.e., it's not "last set wins."  This is on purpose: your program has a bug, in that two different parts disagree about what the next value of the data signal should be.  Note that you *can* set a data signal twice to the *same* value, as determined by `===` or whatever comparator you may have passed to `S.value()`.

With all these caveats, it's worth asking whether it ever makes sense to mutate a data signal from a computation.  In general, there are two scenarios where it may:

Case 1. To provide a more natural and guaranteed way of writing "rule"-like behavior.

```javascript
S(() => {
    if (checking() < 0 && savings() > 1000) {
        checking(checking() + 1000);
        savings(savings() - 1000);
    }
});
```

This example embodies the rule "transfer $1,000 from savings into checking whenever checking is overdrawn and savings has the money."  It doesn't matter what bit of code set checking low, it will always run as long as its condition is met, possibly even making a few transfers if checking was very low.

The alternative would be to have a `withdraw(amount)` function which first checked if checking had the requisite funds and initiated a transfer if not.  That would work *if* all parts of your code were sure to call the function rather than modifying `checking()` directly.  The above rule functions no matter where the change comes from.

Case 2. For algorithmic optimizations.

Say we had 1,000 computations all watching whether `foo()` was their particular value:

```javascript
S(() => { if (foo() === 0) do0(); });
S(() => { if (foo() === 1) do1(); });
S(() => { if (foo() === 2) do2(); });
// ... etc
S(() => { if (foo() === 1000) do1000(); });
```

Every time `foo()` changes, all 1,000 wake up to check it, making for an overall complexity of O(N), where N here is 1,000.

We can change that to O(1) by creating an array of 1,000 boolean data signals, each representing whether `foo()` is their value, plus a 'dispatch' computation that sets just one of the 1,000 data signals:

```javascript
const bins = ... array of 1,000 boolean data signals;
S(() => bins[foo()](true)); 
S(() => { if (bins[0]()) do0(); });
S(() => { if (bins[1]()) do1(); });
S(() => { if (bins[2]()) do2(); });
// ... etc
S(() => { if (bins[1000]()) do1000(); });
```

Now only one of the watchers fires each time, the one whose bin was set, resulting in a complexity of O(1).

However, the cost of this optimization, besides the complexity introduced, is that we've broken synchronicity: the watchers don't run until the update *after* `foo()` changes to their value, because only then does the change to their bin take effect.

## Experimental

### `S.subclock(() => <code>)`
Run computations and data signals created by `<code>` on a subclock, meaning that they don't just run but run *to completion* before surrounding code reads them.

This is still an experimental feature, meaning it's still proving its usefulness in S and may be removed and/or changed in the future.  It currently requires the use of a different compilation of S: `import S from 's-js/withsubclocks';`

`S.subclock()` is only meaningful in scenarios where we are setting data signals from computations.  The problem it solves is to restore synchronicity to such changes by removing other computation's awareness of intermediate states and exposing only the final, at rest state.

Take the "increment `foo()` until it's > 10" example from above, but now we'll attach a logger so we can see its behavior:

```javascript
const foo = S.value(20);
S(() => foo() > 10 || foo(foo() + 1));
S(() => console.log(foo()));
```

If we kick it off by setting `foo()` to a value less than 10, we can see the behavior:

```javascript
foo(5);
> 5
> 6
> 7
> 8
> 9
> 10
> 11
```

However, if we create both `foo()` and the incrementer in a subclock and leave the logger outside it, the logger only sees the final value.

```javascript
let foo;
S.subclock(() => {
    foo = S.value(20);
    S(() => foo() > 10 || foo(foo() + 1));
});
S(() => console.log(foo()));
foo(5);
> 11
```

In effect, subclocks "partition" time, allowing the subclock to go through many ticks in the time the surrounding clock only goes through one.

Subclocks can be used to make optimizations like the ones above synchronous, and can also provide synchronous equivalents to many of the utilities in event-based, data-flow oriented reactive libraries, like filtering events so that only ones meeting certain conditions propagate.

&copy; 2013-present Adam Haile, adam.haile@gmail.com.  MIT License.
