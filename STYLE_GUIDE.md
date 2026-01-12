## Style Guide

- Try to keep things in one function unless composable or reusable
- AVOID unnecessary destructuring of variables. instead of doing `const { a, b }
= obj` just reference it as obj.a and obj.b. this preserves context
- AVOID `try`/`catch` where possible
- AVOID using `any` type
- PREFER single word variable names where possible
- Use as many bun apis as possible like Bun.file()

# Avoid let statements

we don't like let statements, especially combined with if/else statements.
prefer const

This is bad:

Good:

```ts
const foo = condition ? 1 : 2
```

Bad:

```ts
let foo

if (condition) foo = 1
else foo = 2
```

# Avoid else statements

Prefer early returns or even using `iife` to avoid else statements

Good:

```ts
function foo() {
  if (condition) return 1
  return 2
}
```

Bad:

```ts
function foo() {
  if (condition) return 1
  else return 2
}
```

# Prefer single word naming

Try your best to find a single word name for your variables, functions, etc.
Only use multiple words if you cannot.

Good:

```ts
const foo = 1
const bar = 2
const baz = 3
```

Bad:

```ts
const fooBar = 1
const barBaz = 2
const bazFoo = 3
```
