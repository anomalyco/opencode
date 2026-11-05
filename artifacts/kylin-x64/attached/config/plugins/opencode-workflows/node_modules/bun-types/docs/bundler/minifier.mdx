---
name: Minifier
description: Reduce bundle sizes with Bun's JavaScript and TypeScript minifier
---

Bun includes a fast JavaScript and TypeScript minifier that can reduce bundle sizes by 80% or more (depending on the codebase) and make output code run faster. The minifier performs dozens of optimizations including constant folding, dead code elimination, and syntax transformations. Unlike other minifiers, Bun's minifier makes `bun build` run faster since there's less code to print.

## CLI Usage

### Enable all minification

Use the `--minify` flag to enable all minification modes:

```bash
bun build ./index.ts --minify --outfile=out.js
```

The `--minify` flag automatically enables:

- Whitespace minification
- Syntax minification
- Identifier minification

### Production mode

The `--production` flag automatically enables minification:

```bash
bun build ./index.ts --production --outfile=out.js
```

The `--production` flag also:

- Sets `process.env.NODE_ENV` to `production`
- Enables the production-mode JSX import & transform

### Granular control

You can enable specific minification modes individually:

```bash
# Only remove whitespace
bun build ./index.ts --minify-whitespace --outfile=out.js

# Only minify syntax
bun build ./index.ts --minify-syntax --outfile=out.js

# Only minify identifiers
bun build ./index.ts --minify-identifiers --outfile=out.js

# Combine specific modes
bun build ./index.ts --minify-whitespace --minify-syntax --outfile=out.js
```

## JavaScript API

When using Bun's bundler programmatically, configure minification through the `minify` option:

```ts
await Bun.build({
  entrypoints: ["./index.ts"],
  outdir: "./out",
  minify: true, // Enable all minification modes
});
```

For granular control, pass an object:

```ts
await Bun.build({
  entrypoints: ["./index.ts"],
  outdir: "./out",
  minify: {
    whitespace: true,
    syntax: true,
    identifiers: true,
  },
});
```

## Minification Modes

Bun's minifier has three independent modes that can be enabled separately or combined.

### Whitespace minification (`--minify-whitespace`)

Removes all unnecessary whitespace, newlines, and formatting from the output.

### Syntax minification (`--minify-syntax`)

Rewrites JavaScript syntax to shorter equivalent forms and performs constant folding, dead code elimination, and other optimizations.

### Identifier minification (`--minify-identifiers`)

Renames local variables and function names to shorter identifiers using frequency-based optimization.

## All Transformations

### Boolean literal shortening

**Mode:** `--minify-syntax`

Converts boolean literals to shorter expressions.

```ts Input
true
false
```

```js Output
!0
!1
```

### Boolean algebra optimizations

**Mode:** `--minify-syntax`

Simplifies boolean expressions using logical rules.

```ts Input
!!x
x === true
x && true
x || false
!true
!false
```

```js Output
x
x
x
x
!1
!0
```

### Undefined shortening

**Mode:** `--minify-syntax`

Replaces `undefined` with shorter equivalent.

```ts Input
undefined
let x = undefined;
```

```js Output
void 0
let x=void 0;
```

### Undefined equality optimization

**Mode:** `--minify-syntax`

Optimizes loose equality checks with undefined.

```ts Input
x == undefined
x != undefined
```

```js Output
x == null
x != null
```

### Infinity shortening

**Mode:** `--minify-syntax`

Converts Infinity to mathematical expressions.

```ts Input
Infinity
-Infinity
```

```js Output
1/0
-1/0
```

### Typeof optimizations

**Mode:** `--minify-syntax`

Optimizes typeof comparisons and evaluates constant typeof expressions.

```ts Input
typeof x === 'undefined'
typeof x !== 'undefined'
typeof require
typeof null
typeof true
typeof 123
typeof "str"
typeof 123n
```

```js Output
typeof x>'u'
typeof x<'u'
"function"
"object"
"boolean"
"number"
"string"
"bigint"
```

### Number formatting

**Mode:** `--minify-syntax`

Formats numbers in the most compact representation.

```ts Input
10000
100000
1000000
1.0
-42.0
```

```js Output
1e4
1e5
1e6
1
-42
```

### Arithmetic constant folding

**Mode:** `--minify-syntax`

Evaluates arithmetic operations at compile time.

```ts Input
1 + 2
10 - 5
3 * 4
10 / 2
10 % 3
2 ** 3
```

```js Output
3
5
12
5
1
8
```

### Bitwise constant folding

**Mode:** `--minify-syntax`

Evaluates bitwise operations at compile time.

```ts Input
5 & 3
5 | 3
5 ^ 3
8 << 2
32 >> 2
~5
```

```js Output
1
7
6
32
8
-6
```

### String concatenation

**Mode:** `--minify-syntax`

Combines string literals at compile time.

```ts Input
"a" + "b"
"x" + 123
"foo" + "bar" + "baz"
```

```js Output
"ab"
"x123"
"foobarbaz"
```

### String indexing

**Mode:** `--minify-syntax`

Evaluates string character access at compile time.

```ts Input
"foo"[2]
"hello"[0]
```

```js Output
"o"
"h"
```

### Template literal folding

**Mode:** `--minify-syntax`

Evaluates template literals with constant expressions.

```ts Input
`a${123}b`
`result: ${5 + 10}`
```

```js Output
"a123b"
"result: 15"
```

### Template literal to string conversion

**Mode:** `--minify-syntax`

Converts simple template literals to regular strings.

```ts Input
`Hello World`
`Line 1
Line 2`
```

```js Output
"Hello World"
"Line 1\nLine 2"
```

### String quote optimization

**Mode:** `--minify-syntax`

Chooses the optimal quote character to minimize escapes.

```ts Input
"It's a string"
'He said "hello"'
`Simple string`
```

```js Output
"It's a string"
'He said "hello"'
"Simple string"
```

### Array spread inlining

**Mode:** `--minify-syntax`

Inlines array spread operations with constant arrays.

```ts Input
[1, ...[2, 3], 4]
[...[a, b]]
```

```js Output
[1,2,3,4]
[a,b]
```

### Array indexing

**Mode:** `--minify-syntax`

Evaluates constant array access at compile time.

```ts Input
[x][0]
['a', 'b', 'c'][1]
['a', , 'c'][1]
```

```js Output
x
'b'
void 0
```

### Property access optimization

**Mode:** `--minify-syntax`

Converts bracket notation to dot notation when possible.

```ts Input
obj["property"]
obj["validName"]
obj["123"]
obj["invalid-name"]
```

```js Output
obj.property
obj.validName
obj["123"]
obj["invalid-name"]
```

### Comparison folding

**Mode:** `--minify-syntax`

Evaluates constant comparisons at compile time.

```ts Input
3 < 5
5 > 3
3 <= 3
5 >= 6
"a" < "b"
```

```js Output
!0
!0
!0
!1
!0
```

### Logical operation folding

**Mode:** `--minify-syntax`

Simplifies logical operations with constant values.

```ts Input
true && x
false && x
true || x
false || x
```

```js Output
x
!1
!0
x
```

### Nullish coalescing folding

**Mode:** `--minify-syntax`

Evaluates nullish coalescing with known values.

```ts Input
null ?? x
undefined ?? x
42 ?? x
```

```js Output
x
x
42
```

### Comma expression simplification

**Mode:** `--minify-syntax`

Removes side-effect-free expressions from comma sequences.

```ts Input
(0, x)
(123, "str", x)
```

```js Output
x
x
```

### Ternary conditional folding

**Mode:** `--minify-syntax`

Evaluates conditional expressions with constant conditions.

```ts Input
true ? a : b
false ? a : b
x ? true : false
x ? false : true
```

```js Output
a
b
x ? !0 : !1
x ? !1 : !0
```

### Unary expression folding

**Mode:** `--minify-syntax`

Simplifies unary operations.

```ts Input
+123
+"123"
-(-x)
~~x
!!x
```

```js Output
123
123
123
123
x
~~x
!!x
x
```

### Double negation removal

**Mode:** `--minify-syntax`

Removes unnecessary double negations.

```ts Input
!!x
!!!x
```

```js Output
x
!x
```

### If statement optimization

**Mode:** `--minify-syntax`

Optimizes if statements with constant conditions.

```ts Input
if (true) x;
if (false) x;
if (x) { a; }
if (x) {} else y;
```

```js Output
x;
// removed
if(x)a;
if(!x)y;
```

### Dead code elimination

**Mode:** `--minify-syntax`

Removes unreachable code and code without side effects.

```ts Input
if (false) {
  unreachable();
}
function foo() {
  return x;
  deadCode();
}
```

```js Output
function foo(){return x}
```

### Unreachable branch removal

**Mode:** `--minify-syntax`

Removes branches that can never execute.

```ts Input
while (false) {
  neverRuns();
}
```

```js Output
// removed entirely
```

### Empty block removal

**Mode:** `--minify-syntax`

Removes empty blocks and unnecessary braces.

```ts Input
{ }
if (x) { }
```

```js Output
;
// removed
```

### Single statement block unwrapping

**Mode:** `--minify-syntax`

Removes unnecessary braces around single statements.

```ts Input
if (condition) {
  doSomething();
}
```

```js Output
if(condition)doSomething();
```

### TypeScript enum inlining

**Mode:** `--minify-syntax`

Inlines TypeScript enum values at compile time.

```ts Input
enum Color { Red, Green, Blue }
const x = Color.Red;
```

```js Output
const x=0;
```

### Pure annotation support

**Mode:** Always active

Respects `/*@__PURE__*/` annotations for tree shaking.

```ts Input
const x = /*@__PURE__*/ expensive();
// If x is unused...
```

```js Output
// removed entirely
```

### Identifier renaming

**Mode:** `--minify-identifiers`

Renames local variables to shorter names based on usage frequency.

```ts Input
function calculateSum(firstNumber, secondNumber) {
  const result = firstNumber + secondNumber;
  return result;
}
```

```js Output
function a(b,c){const d=b+c;return d}
```

**Naming strategy:**

- Most frequently used identifiers get the shortest names (a, b, c...)
- Single letters: a-z (26 names)
- Double letters: aa-zz (676 names)
- Triple letters and beyond as needed

**Preserved identifiers:**

- JavaScript keywords and reserved words
- Global identifiers
- Named exports (to maintain API)
- CommonJS names: `exports`, `module`

### Whitespace removal

**Mode:** `--minify-whitespace`

Removes all unnecessary whitespace.

```ts Input
function add(a, b) {
    return a + b;
}
let x = 10;
```

```js Output
function add(a,b){return a+b;}let x=10;
```

### Semicolon optimization

**Mode:** `--minify-whitespace`

Inserts semicolons only when necessary.

```ts Input
let a = 1;
let b = 2;
return a + b;
```

```js Output
let a=1;let b=2;return a+b
```

### Operator spacing removal

**Mode:** `--minify-whitespace`

Removes spaces around operators.

```ts Input
a + b
x = y * z
foo && bar || baz
```

```js Output
a+b
x=y*z
foo&&bar||baz
```

### Comment removal

**Mode:** `--minify-whitespace`

Removes comments except important license comments.

```ts Input
// This comment is removed
/* So is this */
/*! But this license comment is kept */
function test() { /* inline comment */ }
```

```js Output
/*! But this license comment is kept */
function test(){}
```

### Object and array formatting

**Mode:** `--minify-whitespace`

Removes whitespace in object and array literals.

```ts Input
const obj = {
    name: "John",
    age: 30
};
const arr = [1, 2, 3];
```

```js Output
const obj={name:"John",age:30};const arr=[1,2,3];
```

### Control flow formatting

**Mode:** `--minify-whitespace`

Removes whitespace in control structures.

```ts Input
if (condition) {
    doSomething();
}
for (let i = 0; i < 10; i++) {
    console.log(i);
}
```

```js Output
if(condition)doSomething();for(let i=0;i<10;i++)console.log(i);
```

### Function formatting

**Mode:** `--minify-whitespace`

Removes whitespace in function declarations.

```ts Input
function myFunction(param1, param2) {
    return param1 + param2;
}
const arrow = (a, b) => a + b;
```

```js Output
function myFunction(a,b){return a+b}const arrow=(a,b)=>a+b;
```

### Parentheses minimization

**Mode:** Always active

Only adds parentheses when necessary for operator precedence.

```ts Input
(a + b) * c
a + (b * c)
((x))
```

```js Output
(a+b)*c
a+b*c
x
```

### Property mangling

**Mode:** `--minify-identifiers` (with configuration)

Renames object properties to shorter names when configured.

```ts Input
obj.longPropertyName
```

```js Output (with property mangling enabled)
obj.a
```

### Template literal value folding

**Mode:** `--minify-syntax`

Converts non-string interpolated values to strings and folds them into the template.

```ts Input
`hello ${123}`
`value: ${true}`
`result: ${null}`
`status: ${undefined}`
`big: ${10n}`
```

```js Output
"hello 123"
"value: true"
"result: null"
"status: undefined"
"big: 10"
```

### String length constant folding

**Mode:** `--minify-syntax`

Evaluates `.length` property on string literals at compile time.

```ts Input
"hello world".length
"test".length
```

```js Output
11
4
```

### Constructor call simplification

**Mode:** `--minify-syntax`

Simplifies constructor calls for built-in types.

```ts Input
new Object()
new Object(null)
new Object({a: 1})
new Array()
new Array(x, y)
```

```js Output
{}
{}
{a:1}
[]
[x,y]
```

### Single property object inlining

**Mode:** `--minify-syntax`

Inlines property access for objects with a single property.

```ts Input
({fn: () => console.log('hi')}).fn()
```

```js Output
(() => console.log('hi'))()
```

### String charCodeAt constant folding

**Mode:** Always active

Evaluates `charCodeAt()` on string literals for ASCII characters.

```ts Input
"hello".charCodeAt(1)
"A".charCodeAt(0)
```

```js Output
101
65
```

### Void 0 equality to null equality

**Mode:** `--minify-syntax`

Converts loose equality checks with `void 0` to `null` since they're equivalent.

```ts Input
x == void 0
x != void 0
```

```js Output
x == null
x != null
```

### Negation operator optimization

**Mode:** `--minify-syntax`

Moves negation operator through comma expressions.

```ts Input
-(a, b)
-(x, y, z)
```

```js Output
a,-b
x,y,-z
```

### Import.meta property inlining

**Mode:** Bundle mode

Inlines `import.meta` properties at build time when values are known.

```ts Input
import.meta.dir
import.meta.file
import.meta.path
import.meta.url
```

```js Output
"/path/to/directory"
"filename.js"
"/full/path/to/file.js"
"file:///full/path/to/file.js"
```

### Variable declaration merging

**Mode:** `--minify-syntax`

Merges adjacent variable declarations of the same type.

```ts Input
let a = 1;
let b = 2;
const c = 3;
const d = 4;
```

```js Output
let a=1,b=2;
const c=3,d=4;
```

### Expression statement merging

**Mode:** `--minify-syntax`

Merges adjacent expression statements using comma operator.

```ts Input
console.log(1);
console.log(2);
console.log(3);
```

```js Output
console.log(1),console.log(2),console.log(3);
```

### Return statement merging

**Mode:** `--minify-syntax`

Merges expressions before return with comma operator.

```ts Input
console.log(x);
return y;
```

```js Output
return console.log(x),y;
```

### Throw statement merging

**Mode:** `--minify-syntax`

Merges expressions before throw with comma operator.

```ts Input
console.log(x);
throw new Error();
```

```js Output
throw(console.log(x),new Error());
```

### TypeScript enum cross-module inlining

**Mode:** `--minify-syntax` (bundle mode)

Inlines enum values across module boundaries.

```ts Input 
// lib.ts
export enum Color { Red, Green, Blue }

// Input (main.ts)
import { Color } from './lib';
const x = Color.Red;
```

```js Output
const x=0;
```

### Computed property enum inlining

**Mode:** `--minify-syntax`

Inlines enum values used as computed object properties.

```ts Input
enum Keys { FOO = 'foo' }
const obj = { [Keys.FOO]: value }
```

```js Output
const obj={foo:value}
```

### String number to numeric index

**Mode:** `--minify-syntax`

Converts string numeric property access to numeric index.

```ts Input
obj["0"]
arr["5"]
```

```js Output
obj[0]
arr[5]
```

### Arrow function body shortening

**Mode:** Always active

Uses expression body syntax when an arrow function only returns a value.

```ts Input
() => { return x; }
(a) => { return a + 1; }
```

```js Output
() => x
a => a + 1
```

### Object property shorthand

**Mode:** Always active

Uses shorthand syntax when property name and value identifier match.

```ts Input
{ x: x, y: y }
{ name: name, age: age }
```

```js Output
{ x, y }
{ name, age }
```

### Method shorthand

**Mode:** Always active

Uses method shorthand syntax in object literals.

```ts Input
{
  foo: function() {},
  bar: async function() {}
}
```

```js Output
{
  foo() {},
  async bar() {}
}
```

### Drop debugger statements

**Mode:** `--drop=debugger`

Removes `debugger` statements from code.

```ts Input
function test() {
  debugger;
  return x;
}
```

```js Output
function test(){return x}
```

### Drop console calls

**Mode:** `--drop=console`

Removes all `console.*` method calls from code.

```ts Input
console.log("debug");
console.warn("warning");
x = console.error("error");
```

```js Output
void 0;
void 0;
x=void 0;
```

### Drop custom function calls

**Mode:** `--drop=<name>`

Removes calls to specified global functions or methods.

```ts Input
assert(condition);
obj.assert(test);
```

```js Output with --drop=assert
void 0;
void 0;
```

## Keep Names

When minifying identifiers, you may want to preserve original function and class names for debugging purposes. Use the `--keep-names` flag:

```bash
bun build ./index.ts --minify --keep-names --outfile=out.js
```

Or in the JavaScript API:

```ts
await Bun.build({
  entrypoints: ["./index.ts"],
  outdir: "./out",
  minify: {
    identifiers: true,
    keepNames: true,
  },
});
```

This preserves the `.name` property on functions and classes while still minifying the actual identifier names in the code.

## Combined Example

Using all three minification modes together:

```ts input.ts (158 bytes)
const myVariable = 42;

const myFunction = () => {
  const isValid = true;
  const result = undefined;
  return isValid ? myVariable : result;
};

const output = myFunction();
```

```js output.js
// Output with --minify (49 bytes, 69% reduction)
const a=42,b=()=>{const c=!0,d=void 0;return c?a:d},e=b();
```

## When to Use Minification

**Use `--minify` for:**

- Production bundles
- Reducing CDN bandwidth costs
- Improving page load times

**Use individual modes for:**

- **`--minify-whitespace`:** Quick size reduction without semantic changes
- **`--minify-syntax`:** Smaller output while keeping readable identifiers for debugging
- **`--minify-identifiers`:** Maximum size reduction (combine with `--keep-names` for better stack traces)

**Avoid minification for:**

- Development builds (harder to debug)
- When you need readable error messages
- Libraries where consumers may read the source
