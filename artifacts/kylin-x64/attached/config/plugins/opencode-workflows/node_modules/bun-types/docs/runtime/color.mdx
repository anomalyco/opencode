---
title: Color
description: Format colors as CSS, ANSI, numbers, hex strings, and more
---

`Bun.color(input, outputFormat?)` leverages Bun's CSS parser to parse, normalize, and convert colors from user input to a variety of output formats, including:

| Format       | Example                          |
| ------------ | -------------------------------- |
| `"css"`      | `"red"`                          |
| `"ansi"`     | `"\x1b[38;2;255;0;0m"`           |
| `"ansi-16"`  | `"\x1b[38;5;\tm"`                |
| `"ansi-256"` | `"\x1b[38;5;196m"`               |
| `"ansi-16m"` | `"\x1b[38;2;255;0;0m"`           |
| `"number"`   | `0x1a2b3c`                       |
| `"rgb"`      | `"rgb(255, 99, 71)"`             |
| `"rgba"`     | `"rgba(255, 99, 71, 0.5)"`       |
| `"hsl"`      | `"hsl(120, 50%, 50%)"`           |
| `"hex"`      | `"#1a2b3c"`                      |
| `"HEX"`      | `"#1A2B3C"`                      |
| `"{rgb}"`    | `{ r: 255, g: 99, b: 71 }`       |
| `"{rgba}"`   | `{ r: 255, g: 99, b: 71, a: 1 }` |
| `"[rgb]"`    | `[ 255, 99, 71 ]`                |
| `"[rgba]"`   | `[ 255, 99, 71, 255]`            |

There are many different ways to use this API:

- Validate and normalize colors to persist in a database (`number` is the most database-friendly)
- Convert colors to different formats
- Colorful logging beyond the 16 colors many use today (use `ansi` to auto-detect terminal color support, or use `ansi-16`, `ansi-256`, or `ansi-16m` to target a specific color depth)
- Format colors for use in CSS injected into HTML
- Get the `r`, `g`, `b`, and `a` color components as JavaScript objects or numbers from a CSS color string

You can think of this as an alternative to the popular npm packages [`color`](https://github.com/Qix-/color) and [`tinycolor2`](https://github.com/bgrins/TinyColor) except with full support for parsing CSS color strings and zero dependencies built directly into Bun.

### Flexible input

You can pass in any of the following:

- Standard CSS color names like `"red"`
- Numbers like `0xff0000`
- Hex strings like `"#f00"`
- RGB strings like `"rgb(255, 0, 0)"`
- RGBA strings like `"rgba(255, 0, 0, 1)"`
- HSL strings like `"hsl(0, 100%, 50%)"`
- HSLA strings like `"hsla(0, 100%, 50%, 1)"`
- RGB objects like `{ r: 255, g: 0, b: 0 }`
- RGBA objects like `{ r: 255, g: 0, b: 0, a: 1 }`
- RGB arrays like `[255, 0, 0]`
- RGBA arrays like `[255, 0, 0, 255]`
- LAB strings like `"lab(50% 50% 50%)"`
- ... anything else that CSS can parse as a single color value

### Format colors as CSS

The `"css"` format outputs valid CSS for use in stylesheets, inline styles, CSS variables, css-in-js, etc. It returns the most compact representation of the color as a string.

```ts
Bun.color("red", "css"); // "red"
Bun.color(0xff0000, "css"); // "#f000"
Bun.color("#f00", "css"); // "red"
Bun.color("#ff0000", "css"); // "red"
Bun.color("rgb(255, 0, 0)", "css"); // "red"
Bun.color("rgba(255, 0, 0, 1)", "css"); // "red"
Bun.color("hsl(0, 100%, 50%)", "css"); // "red"
Bun.color("hsla(0, 100%, 50%, 1)", "css"); // "red"
Bun.color({ r: 255, g: 0, b: 0 }, "css"); // "red"
Bun.color({ r: 255, g: 0, b: 0, a: 1 }, "css"); // "red"
Bun.color([255, 0, 0], "css"); // "red"
Bun.color([255, 0, 0, 255], "css"); // "red"
```

If the input is unknown or fails to parse, `Bun.color` returns `null`.

### Format colors as ANSI (for terminals)

The `"ansi"` format outputs ANSI escape codes for use in terminals to make text colorful.

```ts
Bun.color("red", "ansi"); // "\u001b[38;2;255;0;0m"
Bun.color(0xff0000, "ansi"); // "\u001b[38;2;255;0;0m"
Bun.color("#f00", "ansi"); // "\u001b[38;2;255;0;0m"
Bun.color("#ff0000", "ansi"); // "\u001b[38;2;255;0;0m"
Bun.color("rgb(255, 0, 0)", "ansi"); // "\u001b[38;2;255;0;0m"
Bun.color("rgba(255, 0, 0, 1)", "ansi"); // "\u001b[38;2;255;0;0m"
Bun.color("hsl(0, 100%, 50%)", "ansi"); // "\u001b[38;2;255;0;0m"
Bun.color("hsla(0, 100%, 50%, 1)", "ansi"); // "\u001b[38;2;255;0;0m"
Bun.color({ r: 255, g: 0, b: 0 }, "ansi"); // "\u001b[38;2;255;0;0m"
Bun.color({ r: 255, g: 0, b: 0, a: 1 }, "ansi"); // "\u001b[38;2;255;0;0m"
Bun.color([255, 0, 0], "ansi"); // "\u001b[38;2;255;0;0m"
Bun.color([255, 0, 0, 255], "ansi"); // "\u001b[38;2;255;0;0m"
```

This gets the color depth of stdout and automatically chooses one of `"ansi-16m"`, `"ansi-256"`, `"ansi-16"` based on the environment variables. If stdout doesn't support any form of ANSI color, it returns an empty string. As with the rest of Bun's color API, if the input is unknown or fails to parse, it returns `null`.

#### 24-bit ANSI colors (`ansi-16m`)

The `"ansi-16m"` format outputs 24-bit ANSI colors for use in terminals to make text colorful. 24-bit color means you can display 16 million colors on supported terminals, and requires a modern terminal that supports it.

This converts the input color to RGBA, and then outputs that as an ANSI color.

```ts
Bun.color("red", "ansi-16m"); // "\x1b[38;2;255;0;0m"
Bun.color(0xff0000, "ansi-16m"); // "\x1b[38;2;255;0;0m"
Bun.color("#f00", "ansi-16m"); // "\x1b[38;2;255;0;0m"
Bun.color("#ff0000", "ansi-16m"); // "\x1b[38;2;255;0;0m"
```

#### 256 ANSI colors (`ansi-256`)

The `"ansi-256"` format approximates the input color to the nearest of the 256 ANSI colors supported by some terminals.

```ts
Bun.color("red", "ansi-256"); // "\u001b[38;5;196m"
Bun.color(0xff0000, "ansi-256"); // "\u001b[38;5;196m"
Bun.color("#f00", "ansi-256"); // "\u001b[38;5;196m"
Bun.color("#ff0000", "ansi-256"); // "\u001b[38;5;196m"
```

To convert from RGBA to one of the 256 ANSI colors, we ported the algorithm that [`tmux` uses](https://github.com/tmux/tmux/blob/dae2868d1227b95fd076fb4a5efa6256c7245943/colour.c#L44-L55).

#### 16 ANSI colors (`ansi-16`)

The `"ansi-16"` format approximates the input color to the nearest of the 16 ANSI colors supported by most terminals.

```ts
Bun.color("red", "ansi-16"); // "\u001b[38;5;\tm"
Bun.color(0xff0000, "ansi-16"); // "\u001b[38;5;\tm"
Bun.color("#f00", "ansi-16"); // "\u001b[38;5;\tm"
Bun.color("#ff0000", "ansi-16"); // "\u001b[38;5;\tm"
```

This works by first converting the input to a 24-bit RGB color space, then to `ansi-256`, and then we convert that to the nearest 16 ANSI color.

### Format colors as numbers

The `"number"` format outputs a 24-bit number for use in databases, configuration, or any other use case where a compact representation of the color is desired.

```ts
Bun.color("red", "number"); // 16711680
Bun.color(0xff0000, "number"); // 16711680
Bun.color({ r: 255, g: 0, b: 0 }, "number"); // 16711680
Bun.color([255, 0, 0], "number"); // 16711680
Bun.color("rgb(255, 0, 0)", "number"); // 16711680
Bun.color("rgba(255, 0, 0, 1)", "number"); // 16711680
Bun.color("hsl(0, 100%, 50%)", "number"); // 16711680
Bun.color("hsla(0, 100%, 50%, 1)", "number"); // 16711680
```

### Get the red, green, blue, and alpha channels

You can use the `"{rgba}"`, `"{rgb}"`, `"[rgba]"` and `"[rgb]"` formats to get the red, green, blue, and alpha channels as objects or arrays.

#### `{rgba}` object

The `"{rgba}"` format outputs an object with the red, green, blue, and alpha channels.

```ts
type RGBAObject = {
  // 0 - 255
  r: number;
  // 0 - 255
  g: number;
  // 0 - 255
  b: number;
  // 0 - 1
  a: number;
};
```

Example:

```ts
Bun.color("hsl(0, 0%, 50%)", "{rgba}"); // { r: 128, g: 128, b: 128, a: 1 }
Bun.color("red", "{rgba}"); // { r: 255, g: 0, b: 0, a: 1 }
Bun.color(0xff0000, "{rgba}"); // { r: 255, g: 0, b: 0, a: 1 }
Bun.color({ r: 255, g: 0, b: 0 }, "{rgba}"); // { r: 255, g: 0, b: 0, a: 1 }
Bun.color([255, 0, 0], "{rgba}"); // { r: 255, g: 0, b: 0, a: 1 }
```

To behave similarly to CSS, the `a` channel is a decimal number between `0` and `1`.

The `"{rgb}"` format is similar, but it doesn't include the alpha channel.

```ts
Bun.color("hsl(0, 0%, 50%)", "{rgb}"); // { r: 128, g: 128, b: 128 }
Bun.color("red", "{rgb}"); // { r: 255, g: 0, b: 0 }
Bun.color(0xff0000, "{rgb}"); // { r: 255, g: 0, b: 0 }
Bun.color({ r: 255, g: 0, b: 0 }, "{rgb}"); // { r: 255, g: 0, b: 0 }
Bun.color([255, 0, 0], "{rgb}"); // { r: 255, g: 0, b: 0 }
```

#### `[rgba]` array

The `"[rgba]"` format outputs an array with the red, green, blue, and alpha channels.

```ts
// All values are 0 - 255
type RGBAArray = [number, number, number, number];
```

Example:

```ts
Bun.color("hsl(0, 0%, 50%)", "[rgba]"); // [128, 128, 128, 255]
Bun.color("red", "[rgba]"); // [255, 0, 0, 255]
Bun.color(0xff0000, "[rgba]"); // [255, 0, 0, 255]
Bun.color({ r: 255, g: 0, b: 0 }, "[rgba]"); // [255, 0, 0, 255]
Bun.color([255, 0, 0], "[rgba]"); // [255, 0, 0, 255]
```

Unlike the `"{rgba}"` format, the alpha channel is an integer between `0` and `255`. This is useful for typed arrays where each channel must be the same underlying type.

The `"[rgb]"` format is similar, but it doesn't include the alpha channel.

```ts
Bun.color("hsl(0, 0%, 50%)", "[rgb]"); // [128, 128, 128]
Bun.color("red", "[rgb]"); // [255, 0, 0]
Bun.color(0xff0000, "[rgb]"); // [255, 0, 0]
Bun.color({ r: 255, g: 0, b: 0 }, "[rgb]"); // [255, 0, 0]
Bun.color([255, 0, 0], "[rgb]"); // [255, 0, 0]
```

### Format colors as hex strings

The `"hex"` format outputs a lowercase hex string for use in CSS or other contexts.

```ts
Bun.color("hsl(0, 0%, 50%)", "hex"); // "#808080"
Bun.color("red", "hex"); // "#ff0000"
Bun.color(0xff0000, "hex"); // "#ff0000"
Bun.color({ r: 255, g: 0, b: 0 }, "hex"); // "#ff0000"
Bun.color([255, 0, 0], "hex"); // "#ff0000"
```

The `"HEX"` format is similar, but it outputs a hex string with uppercase letters instead of lowercase letters.

```ts
Bun.color("hsl(0, 0%, 50%)", "HEX"); // "#808080"
Bun.color("red", "HEX"); // "#FF0000"
Bun.color(0xff0000, "HEX"); // "#FF0000"
Bun.color({ r: 255, g: 0, b: 0 }, "HEX"); // "#FF0000"
Bun.color([255, 0, 0], "HEX"); // "#FF0000"
```

### Bundle-time client-side color formatting

Like many of Bun's APIs, you can use macros to invoke `Bun.color` at bundle-time for use in client-side JavaScript builds:

```ts client-side.ts
import { color } from "bun" with { type: "macro" };

console.log(color("#f00", "css"));
```

Then, build the client-side code:

```sh
bun build ./client-side.ts
```

This will output the following to `client-side.js`:

```js
// client-side.ts
console.log("red");
```
