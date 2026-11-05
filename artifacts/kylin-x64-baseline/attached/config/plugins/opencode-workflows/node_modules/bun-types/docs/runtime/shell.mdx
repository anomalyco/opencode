---
title: Shell
description: Use Bun's shell scripting API to run shell commands from JavaScript
---

Bun Shell makes shell scripting with JavaScript & TypeScript fun. It's a cross-platform bash-like shell with seamless JavaScript interop.

Quickstart:

```ts index.ts icon="/icons/typescript.svg"
import { $ } from "bun";

const response = await fetch("https://example.com");

// Use Response as stdin.
await $`cat < ${response} | wc -c`; // 1256
```

---

## Features

- **Cross-platform**: works on Windows, Linux & macOS. Instead of `rimraf` or `cross-env`', you can use Bun Shell without installing extra dependencies. Common shell commands like `ls`, `cd`, `rm` are implemented natively.
- **Familiar**: Bun Shell is a bash-like shell, supporting redirection, pipes, environment variables and more.
- **Globs**: Glob patterns are supported natively, including `**`, `*`, `{expansion}`, and more.
- **Template literals**: Template literals execute shell commands, allowing interpolation of variables and expressions.
- **Safety**: Bun Shell escapes all strings by default, preventing shell injection attacks.
- **JavaScript interop**: Use `Response`, `ArrayBuffer`, `Blob`, `Bun.file(path)` and other JavaScript objects as stdin, stdout, and stderr.
- **Shell scripting**: Bun Shell can be used to run shell scripts (`.bun.sh` files).
- **Custom interpreter**: Bun Shell is written in Zig, along with its lexer, parser, and interpreter. Bun Shell is a small programming language.

---

## Getting started

The simplest shell command is `echo`. To run it, use the `$` template literal tag:

```js
import { $ } from "bun";

await $`echo "Hello World!"`; // Hello World!
```

By default, shell commands print to stdout. To quiet the output, call `.quiet()`:

```js
import { $ } from "bun";

await $`echo "Hello World!"`.quiet(); // No output
```

What if you want to access the output of the command as text? Use `.text()`:

```js
import { $ } from "bun";

// .text() automatically calls .quiet() for you
const welcome = await $`echo "Hello World!"`.text();

console.log(welcome); // Hello World!\n
```

By default, `await`ing will return stdout and stderr as `Buffer`s.

```js
import { $ } from "bun";

const { stdout, stderr } = await $`echo "Hello!"`.quiet();

console.log(stdout); // Buffer(7) [ 72, 101, 108, 108, 111, 33, 10 ]
console.log(stderr); // Buffer(0) []
```

---

## Error handling

By default, non-zero exit codes will throw an error. This `ShellError` contains information about the command run.

```js
import { $ } from "bun";

try {
  const output = await $`something-that-may-fail`.text();
  console.log(output);
} catch (err) {
  console.log(`Failed with code ${err.exitCode}`);
  console.log(err.stdout.toString());
  console.log(err.stderr.toString());
}
```

Throwing can be disabled with `.nothrow()`. The result's `exitCode` will need to be checked manually.

```js
import { $ } from "bun";

const { stdout, stderr, exitCode } = await $`something-that-may-fail`.nothrow().quiet();

if (exitCode !== 0) {
  console.log(`Non-zero exit code ${exitCode}`);
}

console.log(stdout);
console.log(stderr);
```

The default handling of non-zero exit codes can be configured by calling `.nothrow()` or `.throws(boolean)` on the `$` function itself.

```js
import { $ } from "bun";
// shell promises will not throw, meaning you will have to
// check for `exitCode` manually on every shell command.
$.nothrow(); // equivalent to $.throws(false)

// default behavior, non-zero exit codes will throw an error
$.throws(true);

// alias for $.nothrow()
$.throws(false);

await $`something-that-may-fail`; // No exception thrown
```

---

## Redirection

A command's _input_ or _output_ may be _redirected_ using the typical Bash operators:

- `<` redirect stdin
- `>` or `1>` redirect stdout
- `2>` redirect stderr
- `&>` redirect both stdout and stderr
- `>>` or `1>>` redirect stdout, _appending_ to the destination, instead of overwriting
- `2>>` redirect stderr, _appending_ to the destination, instead of overwriting
- `&>>` redirect both stdout and stderr, _appending_ to the destination, instead of overwriting
- `1>&2` redirect stdout to stderr (all writes to stdout will instead be in stderr)
- `2>&1` redirect stderr to stdout (all writes to stderr will instead be in stdout)

Bun Shell also supports redirecting from and to JavaScript objects.

### Example: Redirect output to JavaScript objects (`>`)

To redirect stdout to a JavaScript object, use the `>` operator:

```js
import { $ } from "bun";

const buffer = Buffer.alloc(100);
await $`echo "Hello World!" > ${buffer}`;

console.log(buffer.toString()); // Hello World!\n
```

The following JavaScript objects are supported for redirection to:

- `Buffer`, `Uint8Array`, `Uint16Array`, `Uint32Array`, `Int8Array`, `Int16Array`, `Int32Array`, `Float32Array`, `Float64Array`, `ArrayBuffer`, `SharedArrayBuffer` (writes to the underlying buffer)
- `Bun.file(path)`, `Bun.file(fd)` (writes to the file)

### Example: Redirect input from JavaScript objects (`<`)

To redirect the output from JavaScript objects to stdin, use the `<` operator:

```js
import { $ } from "bun";

const response = new Response("hello i am a response body");

const result = await $`cat < ${response}`.text();

console.log(result); // hello i am a response body
```

The following JavaScript objects are supported for redirection from:

- `Buffer`, `Uint8Array`, `Uint16Array`, `Uint32Array`, `Int8Array`, `Int16Array`, `Int32Array`, `Float32Array`, `Float64Array`, `ArrayBuffer`, `SharedArrayBuffer` (reads from the underlying buffer)
- `Bun.file(path)`, `Bun.file(fd)` (reads from the file)
- `Response` (reads from the body)

### Example: Redirect stdin -> file

```js
import { $ } from "bun";

await $`cat < myfile.txt`;
```

### Example: Redirect stdout -> file

```js
import { $ } from "bun";

await $`echo bun! > greeting.txt`;
```

### Example: Redirect stderr -> file

```js
import { $ } from "bun";

await $`bun run index.ts 2> errors.txt`;
```

### Example: Redirect stderr -> stdout

```js
import { $ } from "bun";

// redirects stderr to stdout, so all output
// will be available on stdout
await $`bun run ./index.ts 2>&1`;
```

### Example: Redirect stdout -> stderr

```js
import { $ } from "bun";

// redirects stdout to stderr, so all output
// will be available on stderr
await $`bun run ./index.ts 1>&2`;
```

## Piping (`|`)

Like in bash, you can pipe the output of one command to another:

```js
import { $ } from "bun";

const result = await $`echo "Hello World!" | wc -w`.text();

console.log(result); // 2\n
```

You can also pipe with JavaScript objects:

```js
import { $ } from "bun";

const response = new Response("hello i am a response body");

const result = await $`cat < ${response} | wc -w`.text();

console.log(result); // 6\n
```

## Command substitution (`$(...)`)

Command substitution allows you to substitute the output of another script into the current script:

```js
import { $ } from "bun";

// Prints out the hash of the current commit
await $`echo Hash of current commit: $(git rev-parse HEAD)`;
```

This is a textual insertion of the command's output and can be used to, for example, declare a shell variable:

```js
import { $ } from "bun";

await $`
  REV=$(git rev-parse HEAD)
  docker built -t myapp:$REV
  echo Done building docker image "myapp:$REV"
`;
```

<Note>

Because Bun internally uses the special [`raw`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#raw_strings) property on the input template literal, using the backtick syntax for command substitution won't work:

```ts icon="file-code"
import { $ } from "bun";

await $`echo \`echo hi\``;
```

Instead of printing:

```
hi
```

The above will print out:

```
echo hi
```

We instead recommend sticking to the `$(...)` syntax.

</Note>

---

## Environment variables

Environment variables can be set like in bash:

```js
import { $ } from "bun";

await $`FOO=foo bun -e 'console.log(process.env.FOO)'`; // foo\n
```

You can use string interpolation to set environment variables:

```js
import { $ } from "bun";

const foo = "bar123";

await $`FOO=${foo + "456"} bun -e 'console.log(process.env.FOO)'`; // bar123456\n
```

Input is escaped by default, preventing shell injection attacks:

```js
import { $ } from "bun";

const foo = "bar123; rm -rf /tmp";

await $`FOO=${foo} bun -e 'console.log(process.env.FOO)'`; // bar123; rm -rf /tmp\n
```

### Changing the environment variables

By default, `process.env` is used as the environment variables for all commands.

You can change the environment variables for a single command by calling `.env()`:

```js
import { $ } from "bun";

await $`echo $FOO`.env({ ...process.env, FOO: "bar" }); // bar
```

You can change the default environment variables for all commands by calling `$.env`:

```js
import { $ } from "bun";

$.env({ FOO: "bar" });

// the globally-set $FOO
await $`echo $FOO`; // bar

// the locally-set $FOO
await $`echo $FOO`.env({ FOO: "baz" }); // baz
```

You can reset the environment variables to the default by calling `$.env()` with no arguments:

```js
import { $ } from "bun";

$.env({ FOO: "bar" });

// the globally-set $FOO
await $`echo $FOO`; // bar

// the locally-set $FOO
await $`echo $FOO`.env(undefined); // ""
```

### Changing the working directory

You can change the working directory of a command by passing a string to `.cwd()`:

```js
import { $ } from "bun";

await $`pwd`.cwd("/tmp"); // /tmp
```

You can change the default working directory for all commands by calling `$.cwd`:

```js
import { $ } from "bun";

$.cwd("/tmp");

// the globally-set working directory
await $`pwd`; // /tmp

// the locally-set working directory
await $`pwd`.cwd("/"); // /
```

---

## Reading output

To read the output of a command as a string, use `.text()`:

```js
import { $ } from "bun";

const result = await $`echo "Hello World!"`.text();

console.log(result); // Hello World!\n
```

### Reading output as JSON

To read the output of a command as JSON, use `.json()`:

```js
import { $ } from "bun";

const result = await $`echo '{"foo": "bar"}'`.json();

console.log(result); // { foo: "bar" }
```

### Reading output line-by-line

To read the output of a command line-by-line, use `.lines()`:

```js
import { $ } from "bun";

for await (let line of $`echo "Hello World!"`.lines()) {
  console.log(line); // Hello World!
}
```

You can also use `.lines()` on a completed command:

```js
import { $ } from "bun";

const search = "bun";

for await (let line of $`cat list.txt | grep ${search}`.lines()) {
  console.log(line);
}
```

### Reading output as a Blob

To read the output of a command as a Blob, use `.blob()`:

```js
import { $ } from "bun";

const result = await $`echo "Hello World!"`.blob();

console.log(result); // Blob(13) { size: 13, type: "text/plain" }
```

---

## Builtin Commands

For cross-platform compatibility, Bun Shell implements a set of builtin commands, in addition to reading commands from the PATH environment variable.

- `cd`: change the working directory
- `ls`: list files in a directory (supports `-l` for long listing format)
- `rm`: remove files and directories
- `echo`: print text
- `pwd`: print the working directory
- `bun`: run bun in bun
- `cat`
- `touch`
- `mkdir`
- `which`
- `mv`
- `exit`
- `true`
- `false`
- `yes`
- `seq`
- `dirname`
- `basename`

**Partially** implemented:

- `mv`: move files and directories (missing cross-device support)

**Not** implemented yet, but planned:

- See [Issue #9716](https://github.com/oven-sh/bun/issues/9716) for the full list.

---

## Utilities

Bun Shell also implements a set of utilities for working with shells.

### `$.braces` (brace expansion)

This function implements simple [brace expansion](https://www.gnu.org/software/bash/manual/html_node/Brace-Expansion.html) for shell commands:

```js
import { $ } from "bun";

await $.braces(`echo {1,2,3}`);
// => ["echo 1", "echo 2", "echo 3"]
```

### `$.escape` (escape strings)

Exposes Bun Shell's escaping logic as a function:

```js
import { $ } from "bun";

console.log($.escape('$(foo) `bar` "baz"'));
// => \$(foo) \`bar\` \"baz\"
```

If you do not want your string to be escaped, wrap it in a `{ raw: 'str' }` object:

```js
import { $ } from "bun";

await $`echo ${{ raw: '$(foo) `bar` "baz"' }}`;
// => bun: command not found: foo
// => bun: command not found: bar
// => baz
```

---

## `.sh` file loader

For simple shell scripts, instead of `/bin/sh`, you can use Bun Shell to run shell scripts.

To do so, run the script with `bun` on a file with the `.sh` extension.

```sh script.sh icon="file-code"
echo "Hello World! pwd=$(pwd)"
```

```sh terminal icon="terminal"
bun ./script.sh
```

```txt
Hello World! pwd=/home/demo
```

Scripts with Bun Shell are cross platform, which means they work on Windows:

```powershell powershell icon="windows"
bun .\script.sh
```

```txt
Hello World! pwd=C:\Users\Demo
```

---

## Implementation notes

Bun Shell is a small programming language in Bun that is implemented in Zig. It includes a handwritten lexer, parser, and interpreter. Unlike bash, zsh, and other shells, Bun Shell runs operations concurrently.

---

## Security in the Bun shell

By design, the Bun shell _does not invoke a system shell_ (like `/bin/sh`) and
is instead a re-implementation of bash that runs in the same Bun process,
designed with security in mind.

When parsing command arguments, it treats all _interpolated variables_ as single, literal strings.

This protects the Bun shell against **command injection**:

```js
import { $ } from "bun";

const userInput = "my-file.txt; rm -rf /";

// SAFE: `userInput` is treated as a single quoted string
await $`ls ${userInput}`;
```

In the above example, `userInput` is treated as a single string. This causes
the `ls` command to try to read the contents of a single directory named
"my-file; rm -rf /".

### Security considerations

While command injection is prevented by default, developers are still
responsible for security in certain scenarios.

Similar to the `Bun.spawn` or `node:child_process.exec()` APIs, you can intentionally
execute a command which spawns a new shell (e.g. `bash -c`) with arguments.

When you do this, you hand off control, and Bun's built-in protections no
longer apply to the string interpreted by that new shell.

```js
import { $ } from "bun";

const userInput = "world; touch /tmp/pwned";

// UNSAFE: You have explicitly started a new shell process with `bash -c`.
// This new shell will execute the `touch` command. Any user input
// passed this way must be rigorously sanitized.
await $`bash -c "echo ${userInput}"`;
```

### Argument injection

The Bun shell cannot know how an external command interprets its own
command-line arguments. An attacker can supply input that the target program
recognizes as one of its own options or flags, leading to unintended behavior.

```js
import { $ } from "bun";

// Malicious input formatted as a Git command-line flag
const branch = "--upload-pack=echo pwned";

// UNSAFE: While Bun safely passes the string as a single argument,
// the `git` program itself sees and acts upon the malicious flag.
await $`git ls-remote origin ${branch}`;
```

<Note>
  **Recommendation** — As is best practice in every language, always sanitize user-provided input before passing it as
  an argument to an external command. The responsibility for validating arguments rests with your application code.
</Note>

---

## Credits

Large parts of this API were inspired by [zx](https://github.com/google/zx), [dax](https://github.com/dsherret/dax), and [bnx](https://github.com/wobsoriano/bnx). Thank you to the authors of those projects.
