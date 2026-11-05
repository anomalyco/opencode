---
title: Standalone HTML
description: Bundle a single-page app into a single self-contained .html file with no external dependencies
---

Bun can bundle your entire frontend into a **single `.html` file** with zero external dependencies. JavaScript, TypeScript, JSX, CSS, images, fonts, videos, WASM — everything gets inlined into one file.

```bash terminal icon="terminal"
bun build --compile --target=browser ./index.html --outdir=dist
```

The output is a completely self-contained HTML document. No relative paths. No external files. No server required. Just one `.html` file that works anywhere a browser can open it.

## One file. Upload anywhere.

The output is a single `.html` file you can put anywhere:

- **Upload it to S3** or any static file host — no directory structure to maintain, one file
- **Double-click it from your desktop** — it opens in the browser and works offline, no localhost server needed
- **Embed it in your webview** — No need to deal with relative files
- **Insert it in an `<iframe>`** — embed interactive content in another page with a single file URL
- **Serve it from anywhere** — any HTTP server, CDN, or file share. One file, zero configuration.

There's nothing to install, no `node_modules` to deploy, no build artifacts to coordinate, no relative paths to think about. The entire app — framework code, stylesheets, images, everything — lives in that one file.

## Truly one file

Normally, distributing a web page means managing a folder of assets — the HTML, the JavaScript bundles, the CSS files, the images. Move the HTML without the rest and everything breaks. Browsers have tried to solve this before: Safari's `.webarchive` and `.mhtml` are supposed to save a page as a single file, but in practice they unpack into a folder of loose files on your computer — defeating the purpose.

Standalone HTML is different. The output is a plain `.html` file. Not an archive. Not a folder. One file, with everything inside it. Every image, every font, every line of CSS and JavaScript is embedded directly in the HTML using standard `<style>` tags, `<script>` tags, and `data:` URIs. Any browser can open it. Any server can host it. Any file host can store it.

This makes it practical to distribute web pages the same way you'd distribute a PDF — as a single file you can move, copy, upload, or share without worrying about broken paths or missing assets.

## Quick start

<CodeGroup>

```html index.html icon="file-code"
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script src="./app.tsx"></script>
  </body>
</html>
```

```tsx app.tsx icon="/icons/typescript.svg"
import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return <h1>Hello from a single HTML file!</h1>;
}

createRoot(document.getElementById("root")!).render(<App />);
```

```css styles.css icon="file-code"
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #f5f5f5;
}
```

</CodeGroup>

```bash terminal icon="terminal"
bun build --compile --target=browser ./index.html --outdir=dist
```

Open `dist/index.html` — the React app works with no server.

## Everything gets inlined

Bun inlines every local asset it finds in your HTML. If it has a relative path, it gets embedded into the output file. This isn't limited to images and stylesheets — it works with any file type.

### What gets inlined

| In your source                                   | In the output                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `<script src="./app.tsx">`                       | `<script type="module">...bundled code...</script>`                      |
| `<link rel="stylesheet" href="./styles.css">`    | `<style>...bundled CSS...</style>`                                       |
| `<img src="./logo.png">`                         | `<img src="data:image/png;base64,...">`                                  |
| `<img src="./icon.svg">`                         | `<img src="data:image/svg+xml;base64,...">`                              |
| `<video src="./demo.mp4">`                       | `<video src="data:video/mp4;base64,...">`                                |
| `<audio src="./click.wav">`                      | `<audio src="data:audio/wav;base64,...">`                                |
| `<source src="./clip.webm">`                     | `<source src="data:video/webm;base64,...">`                              |
| `<video poster="./thumb.jpg">`                   | `<video poster="data:image/jpeg;base64,...">`                            |
| `<link rel="icon" href="./favicon.ico">`         | `<link rel="icon" href="data:image/x-icon;base64,...">`                  |
| `<link rel="manifest" href="./app.webmanifest">` | `<link rel="manifest" href="data:application/manifest+json;base64,...">` |
| CSS `url("./bg.png")`                            | CSS `url(data:image/png;base64,...)`                                     |
| CSS `@import "./reset.css"`                      | Flattened into the `<style>` tag                                         |
| CSS `url("./font.woff2")`                        | CSS `url(data:font/woff2;base64,...)`                                    |
| JS `import "./styles.css"`                       | Merged into the `<style>` tag                                            |

Images, fonts, WASM binaries, videos, audio files, SVGs — any file referenced by a relative path gets base64-encoded into a `data:` URI and embedded directly in the HTML. The MIME type is automatically detected from the file extension.

External URLs (like CDN links or absolute URLs) are left untouched.

## Using with React

React apps work out of the box. Bun handles JSX transpilation and npm package resolution automatically.

```bash terminal icon="terminal"
bun install react react-dom
```

<CodeGroup>

```html index.html icon="file-code"
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My App</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script src="./app.tsx"></script>
  </body>
</html>
```

```tsx app.tsx icon="/icons/typescript.svg"
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Counter } from "./components/Counter.tsx";

function App() {
  return (
    <main>
      <h1>Single-file React App</h1>
      <Counter />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
```

```tsx components/Counter.tsx icon="/icons/typescript.svg"
import React, { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
}
```

</CodeGroup>

```bash terminal icon="terminal"
bun build --compile --target=browser ./index.html --outdir=dist
```

All of React, your components, and your CSS are bundled into `dist/index.html`. Upload that one file anywhere and it works.

## Using with Tailwind CSS

Install the plugin and reference Tailwind in your HTML or CSS:

```bash terminal icon="terminal"
bun install --dev bun-plugin-tailwind
```

<CodeGroup>

```html index.html icon="file-code"
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="tailwindcss" />
  </head>
  <body class="bg-gray-100 flex items-center justify-center min-h-screen">
    <div id="root"></div>
    <script src="./app.tsx"></script>
  </body>
</html>
```

```tsx app.tsx icon="/icons/typescript.svg"
import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <div className="bg-white rounded-lg shadow-lg p-8 max-w-md">
      <h1 className="text-2xl font-bold text-gray-800">Hello Tailwind</h1>
      <p className="text-gray-600 mt-2">This is a single HTML file.</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
```

</CodeGroup>

Build with the plugin using the JavaScript API:

```ts build.ts icon="/icons/typescript.svg"
await Bun.build({
  entrypoints: ["./index.html"],
  compile: true,
  target: "browser",
  outdir: "./dist",
  plugins: [require("bun-plugin-tailwind")],
});
```

```bash terminal icon="terminal"
bun run build.ts
```

The generated Tailwind CSS is inlined directly into the HTML file as a `<style>` tag.

## How it works

When you pass `--compile --target=browser` with an HTML entrypoint, Bun:

1. Parses the HTML and discovers all `<script>`, `<link>`, `<img>`, `<video>`, `<audio>`, `<source>`, and other asset references
2. Bundles all JavaScript/TypeScript/JSX into a single module
3. Bundles all CSS (including `@import` chains and CSS imported from JS) into a single stylesheet
4. Converts every relative asset reference into a base64 `data:` URI
5. Inlines the bundled JS as `<script type="module">` before `</body>`
6. Inlines the bundled CSS as `<style>` in `<head>`
7. Outputs a single `.html` file with no external dependencies

## Minification

Add `--minify` to minify the JavaScript and CSS:

```bash terminal icon="terminal"
bun build --compile --target=browser --minify ./index.html --outdir=dist
```

Or via the API:

```ts build.ts icon="/icons/typescript.svg"
await Bun.build({
  entrypoints: ["./index.html"],
  compile: true,
  target: "browser",
  outdir: "./dist",
  minify: true,
});
```

## JavaScript API

You can use `Bun.build()` to produce standalone HTML programmatically:

```ts build.ts icon="/icons/typescript.svg"
const result = await Bun.build({
  entrypoints: ["./index.html"],
  compile: true,
  target: "browser",
  outdir: "./dist", // optional — omit to get output as BuildArtifact
  minify: true,
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
} else {
  console.log("Built:", result.outputs[0].path);
}
```

When `outdir` is omitted, the output is available as a `BuildArtifact` in `result.outputs`:

```ts icon="/icons/typescript.svg"
const result = await Bun.build({
  entrypoints: ["./index.html"],
  compile: true,
  target: "browser",
});

const html = await result.outputs[0].text();
await Bun.write("output.html", html);
```

## Multiple HTML files

You can pass multiple HTML files as entrypoints. Each produces its own standalone HTML file:

```bash terminal icon="terminal"
bun build --compile --target=browser ./index.html ./about.html --outdir=dist
```

## Environment variables

Use `--env` to inline environment variables into the bundled JavaScript:

```bash terminal icon="terminal"
API_URL=https://api.example.com bun build --compile --target=browser --env=inline ./index.html --outdir=dist
```

References to `process.env.API_URL` in your JavaScript are replaced with the literal value at build time.

## Limitations

- **Code splitting** is not supported — `--splitting` cannot be used with `--compile --target=browser`
- **Large assets** increase file size since they're base64-encoded (33% overhead vs the raw binary)
- **External URLs** (CDN links, absolute URLs) are left as-is — only relative paths are inlined
