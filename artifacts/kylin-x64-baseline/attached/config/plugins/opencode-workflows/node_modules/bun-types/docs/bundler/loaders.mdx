---
title: Loaders
description: Built-in loaders for the Bun bundler and runtime
---

The Bun bundler implements a set of default loaders out of the box.

> As a rule of thumb: **the bundler and the runtime both support the same set of file types out of the box.**

`.js` `.cjs` `.mjs` `.mts` `.cts` `.ts` `.tsx` `.jsx` `.css` `.json` `.jsonc` `.toml` `.yaml` `.yml` `.txt` `.wasm` `.node` `.html` `.sh`

Bun uses the file extension to determine which built-in loader should be used to parse the file. Every loader has a name, such as `js`, `tsx`, or `json`. These names are used when building plugins that extend Bun with custom loaders.

You can explicitly specify which loader to use using the `'type'` import attribute.

```ts title="index.ts" icon="/icons/typescript.svg"
import my_toml from "./my_file" with { type: "toml" };
// or with dynamic imports
const { default: my_toml } = await import("./my_file", { with: { type: "toml" } });
```

## Built-in loaders

### `js`

**JavaScript loader.** Default for `.cjs` and `.mjs`.

Parses the code and applies a set of default transforms like dead-code elimination and tree shaking. Note that Bun does not attempt to down-convert syntax at the moment.

---

### `jsx`

**JavaScript + JSX loader.** Default for `.js` and `.jsx`.

Same as the `js` loader, but JSX syntax is supported. By default, JSX is down-converted to plain JavaScript; the details of how this is done depends on the `jsx*` compiler options in your `tsconfig.json`. Refer to the [TypeScript documentation on JSX](https://www.typescriptlang.org/tsconfig#jsx) for more information.

---

### `ts`

**TypeScript loader.** Default for `.ts`, `.mts`, and `.cts`.

Strips out all TypeScript syntax, then behaves identically to the `js` loader. Bun does not perform typechecking.

---

### `tsx`

**TypeScript + JSX loader.** Default for `.tsx`.

Transpiles both TypeScript and JSX to vanilla JavaScript.

---

### `json`

**JSON loader.** Default for `.json`.

JSON files can be directly imported.

```js
import pkg from "./package.json";
pkg.name; // => "my-package"
```

During bundling, the parsed JSON is inlined into the bundle as a JavaScript object.

```js
const pkg = {
  name: "my-package",
  // ... other fields
};

pkg.name;
```

If a `.json` file is passed as an entrypoint to the bundler, it will be converted to a `.js` module that `export default`s the parsed object.

<CodeGroup>

```json Input
{
  "name": "John Doe",
  "age": 35,
  "email": "johndoe@example.com"
}
```

```js Output
export default {
  name: "John Doe",
  age: 35,
  email: "johndoe@example.com",
};
```

</CodeGroup>

---

### `jsonc`

**JSON with Comments loader.** Default for `.jsonc`.

JSONC (JSON with Comments) files can be directly imported. Bun will parse them, stripping out comments and trailing commas.

```js
import config from "./config.jsonc";
console.log(config);
```

During bundling, the parsed JSONC is inlined into the bundle as a JavaScript object, identical to the `json` loader.

```js
var config = {
  option: "value",
};
```

<Note>
  Bun automatically uses the `jsonc` loader for `tsconfig.json`, `jsconfig.json`, `package.json`, and `bun.lock` files.
</Note>

---

### `toml`

**TOML loader.** Default for `.toml`.

TOML files can be directly imported. Bun will parse them with its fast native TOML parser.

```js
import config from "./bunfig.toml";
config.logLevel; // => "debug"

// via import attribute:
// import myCustomTOML from './my.config' with {type: "toml"};
```

During bundling, the parsed TOML is inlined into the bundle as a JavaScript object.

```js
var config = {
  logLevel: "debug",
  // ...other fields
};
config.logLevel;
```

If a `.toml` file is passed as an entrypoint, it will be converted to a `.js` module that `export default`s the parsed object.

<CodeGroup>

```toml Input
name = "John Doe"
age = 35
email = "johndoe@example.com"
```

```js Output
export default {
  name: "John Doe",
  age: 35,
  email: "johndoe@example.com",
};
```

</CodeGroup>

---

### `yaml`

**YAML loader.** Default for `.yaml` and `.yml`.

YAML files can be directly imported. Bun will parse them with its fast native YAML parser.

```js
import config from "./config.yaml";
console.log(config);

// via import attribute:
import data from "./data.txt" with { type: "yaml" };
```

During bundling, the parsed YAML is inlined into the bundle as a JavaScript object.

```js
var config = {
  name: "my-app",
  version: "1.0.0",
  // ...other fields
};
```

If a `.yaml` or `.yml` file is passed as an entrypoint, it will be converted to a `.js` module that `export default`s the parsed object.

<CodeGroup>

```yaml Input
name: John Doe
age: 35
email: johndoe@example.com
```

```js Output
export default {
  name: "John Doe",
  age: 35,
  email: "johndoe@example.com",
};
```

</CodeGroup>

---

### `text`

**Text loader.** Default for `.txt`.

The contents of the text file are read and inlined into the bundle as a string. Text files can be directly imported. The file is read and returned as a string.

```js
import contents from "./file.txt";
console.log(contents); // => "Hello, world!"

// To import an html file as text
// The "type" attribute can be used to override the default loader.
import html from "./index.html" with { type: "text" };
```

When referenced during a build, the contents are inlined into the bundle as a string.

```js
var contents = `Hello, world!`;
console.log(contents);
```

If a `.txt` file is passed as an entrypoint, it will be converted to a `.js` module that `export default`s the file contents.

<CodeGroup>

```txt Input
Hello, world!
```

```js Output
export default "Hello, world!";
```

</CodeGroup>

---

### `napi`

**Native addon loader.** Default for `.node`.

In the runtime, native addons can be directly imported.

```js
import addon from "./addon.node";
console.log(addon);
```

<Note>In the bundler, `.node` files are handled using the file loader.</Note>

---

### `sqlite`

**SQLite loader.** Requires `with { "type": "sqlite" }` import attribute.

In the runtime and bundler, SQLite databases can be directly imported. This will load the database using `bun:sqlite`.

```js
import db from "./my.db" with { type: "sqlite" };
```

<Warning>This is only supported when the target is `bun`.</Warning>

By default, the database is external to the bundle (so that you can potentially use a database loaded elsewhere), so the database file on-disk won't be bundled into the final output.

You can change this behavior with the `"embed"` attribute:

```js
// embed the database into the bundle
import db from "./my.db" with { type: "sqlite", embed: "true" };
```

<Info>
When using a standalone executable, the database is embedded into the single-file executable.

Otherwise, the database to embed is copied into the `outdir` with a hashed filename.

</Info>

---

### `html`

**HTML loader.** Default for `.html`.

The `html` loader processes HTML files and bundles any referenced assets. It will:

- Bundle and hash referenced JavaScript files (`<script src="...">`)
- Bundle and hash referenced CSS files (`<link rel="stylesheet" href="...">`)
- Hash referenced images (`<img src="...">`)
- Preserve external URLs (by default, anything starting with `http://` or `https://`)

For example, given this HTML file:

```html title="src/index.html" icon="file-code"
<!DOCTYPE html>
<html>
  <body>
    <img src="./image.jpg" alt="Local image" />
    <img src="https://example.com/image.jpg" alt="External image" />
    <script type="module" src="./script.js"></script>
  </body>
</html>
```

It will output a new HTML file with the bundled assets:

```html title="dist/index.html" icon="file-code"
<!DOCTYPE html>
<html>
  <body>
    <img src="./image-HASHED.jpg" alt="Local image" />
    <img src="https://example.com/image.jpg" alt="External image" />
    <script type="module" src="./output-ALSO-HASHED.js"></script>
  </body>
</html>
```

Under the hood, it uses [`lol-html`](https://github.com/cloudflare/lol-html) to extract script and link tags as entrypoints, and other assets as external.

<Accordion title="List of supported HTML selectors">
Currently, the list of selectors is:

- `audio[src]`
- `iframe[src]`
- `img[src]`
- `img[srcset]`
- `link:not([rel~='stylesheet']):not([rel~='modulepreload']):not([rel~='manifest']):not([rel~='icon']):not([rel~='apple-touch-icon'])[href]`
- `link[as='font'][href], link[type^='font/'][href]`
- `link[as='image'][href]`
- `link[as='style'][href]`
- `link[as='video'][href], link[as='audio'][href]`
- `link[as='worker'][href]`
- `link[rel='icon'][href], link[rel='apple-touch-icon'][href]`
- `link[rel='manifest'][href]`
- `link[rel='stylesheet'][href]`
- `script[src]`
- `source[src]`
- `source[srcset]`
- `video[poster]`
- `video[src]`

</Accordion>

<Note>

**HTML Loader Behavior in Different Contexts**

The `html` loader behaves differently depending on how it's used:

- Static Build: When you run `bun build ./index.html`, Bun produces a static site with all assets bundled and hashed.
- Runtime: When you run `bun run server.ts` (where `server.ts` imports an HTML file), Bun bundles assets on-the-fly during development, enabling features like hot module replacement.
- Full-stack Build: When you run `bun build --target=bun server.ts` (where `server.ts` imports an HTML file), the import resolves to a manifest object that `Bun.serve` uses to efficiently serve pre-bundled assets in production.

</Note>

---

### `css`

**CSS loader.** Default for `.css`.

CSS files can be directly imported. The bundler will parse and bundle CSS files, handling `@import` statements and `url()` references.

```js
import "./styles.css";
```

During bundling, all imported CSS files are bundled together into a single `.css` file in the output directory.

```css
.my-class {
  background: url("./image.png");
}
```

---

### `sh`

**Bun Shell loader.** Default for `.sh` files.

This loader is used to parse Bun Shell scripts. It's only supported when starting Bun itself, so it's not available in the bundler or in the runtime.

```bash
bun run ./script.sh
```

---

### `file`

**File loader.** Default for all unrecognized file types.

The file loader resolves the import as a path/URL to the imported file. It's commonly used for referencing media or font assets.

```js
// logo.ts
import logo from "./logo.svg";
console.log(logo);
```

In the runtime, Bun checks that the `logo.svg` file exists and converts it to an absolute path to the location of `logo.svg` on disk.

```bash
bun run logo.ts
# Output: /path/to/project/logo.svg
```

In the bundler, things are slightly different. The file is copied into `outdir` as-is, and the import is resolved as a relative path pointing to the copied file.

```js
// Output
var logo = "./logo.svg";
console.log(logo);
```

If a value is specified for `publicPath`, the import will use value as a prefix to construct an absolute path/URL.

| Public path                  | Resolved import                    |
| ---------------------------- | ---------------------------------- |
| `""` (default)               | `/logo.svg`                        |
| `"/assets"`                  | `/assets/logo.svg`                 |
| `"https://cdn.example.com/"` | `https://cdn.example.com/logo.svg` |

<Note>
The location and file name of the copied file is determined by the value of `naming.asset`.

This loader is copied into the `outdir` as-is. The name of the copied file is determined using the value of `naming.asset`.

</Note>
