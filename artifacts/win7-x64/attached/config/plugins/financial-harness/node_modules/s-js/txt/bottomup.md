# 5 Minute Bottom-Up Intro to S

## Start with a piece of code  

This will do:

```javascript
let greeting = "Hello",
    name = "world",
    message = `${greeting}, ${name}!`;

document.body.textContent = message;
```

This isn't much of a web app, but it has the basic parts of a program: some data, some calculations on that data, and a side effect.  Most importantly for our purposes, it's static: if `greeting` or `name` change, the page doesn't update.  Our mission is to change that.

## Thunk it up

A 'thunk' is a function with no arguments.  We can convert the parts of the code to thunks by wrapping them in lambdas: `() => ...`:

```javascript
let greeting = () => "Hello",
    name = () => "world",
    message = () => `${greeting()}, ${name()}!`;

() => document.body.textContent = message();
```

This may seem like a meaningless syntactic transformation, but it gives us two useful qualities: 

1. we've captured the computations, making them re-runnable

2. we've made reading a value require a function call

These two are the minimum requirements to build a reactive system.  For this reason, a lot of S's API takes or returns thunks.

## Add change

Use `S.data(...)` instead of a plain lambda for the parts containing data:

```javascript
let greeting = S.data("Hello"),
    name = S.data("world"),
    message = () => `${greeting()}, ${name()}!`;

() => document.body.textContent = message();
```

`S.data()` returns a small function, though not quite as small as our plain lambda wrapper.  It adds two important qualities:

1. It's settable, by passing in a new value: 

```javascript
name();           // returns "world"
name("internet"); // set name() to "internet"
name();           // now returns "internet"
message();        // "Hello, internet!"
```
2. It communicates with `S` whenever it's called, either for a read or a set.

## Add reactivity

Use `S(...)` to wrap the computations we want to stay current as the data changes:

```javascript
let greeting = S.data("Hello"),
    name = S.data("world"),
    message = () => `${greeting()}, ${name()}!`;

S(() => document.body.textContent = message()); // sets page to "Hello, world!"
```

This is the last piece of the puzzle.  `S(...)` runs our thunk in a special context, monitoring it to record if any data signals or other computations are called.  If any of them change later, then the computation needs to be re-run.

```javascript
name("internet"); // page now says "Hello, internet!"
name("reactivity"); // page now says "Hello, reactivity!"
```

Note that the `S(...)` computation doesn't call `name()` directly, rather it calls `message()` which calls `name()`: `S` can "see through" intermediate functions to any signals called.

Like `S.data()`, `S(...)` also returns a thunk, whose value is the result of the most recent execution.  This means that you can wrap an existing thunk without affecting its type or value.  The only thing `S()` changes is *when* the thunk is executed: without it, it's run once per call; with it, once per change.

## Controlling What a "Change" Is

Use `S.freeze()` to change multiple data signals at the same time:

```javascript
S.freeze(() => {
    greeting("Howdy"); // page doesn't update yet ...
    name("friend"); // ... still not ...
}); // ... now page says "Howdy, friend!"
```
