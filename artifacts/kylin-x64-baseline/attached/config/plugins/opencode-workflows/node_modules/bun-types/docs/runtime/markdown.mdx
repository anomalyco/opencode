---
title: Markdown
description: Parse and render Markdown with Bun's built-in Markdown API, supporting GFM extensions and custom rendering callbacks
---

<Callout type="note">
  **Unstable API** — This API is under active development and may change in future versions of Bun.
</Callout>

Bun includes a fast, built-in Markdown parser written in Zig. It supports GitHub Flavored Markdown (GFM) extensions and provides three APIs:

- `Bun.markdown.html()` — render Markdown to an HTML string
- `Bun.markdown.render()` — render Markdown with custom callbacks for each element
- `Bun.markdown.react()` — render Markdown to React JSX elements

---

## `Bun.markdown.html()`

Convert a Markdown string to HTML.

```ts
const html = Bun.markdown.html("# Hello **world**");
// "<h1>Hello <strong>world</strong></h1>\n"
```

GFM extensions like tables, strikethrough, and task lists are enabled by default:

```ts
const html = Bun.markdown.html(`
| Feature      | Status |
|-------------|--------|
| Tables       | ~~done~~ |
| Strikethrough| ~~done~~ |
| Task lists   | done |
`);
```

### Options

Pass an options object as the second argument to configure the parser:

```ts
const html = Bun.markdown.html("some markdown", {
  tables: true, // GFM tables (default: true)
  strikethrough: true, // GFM strikethrough (default: true)
  tasklists: true, // GFM task lists (default: true)
  tagFilter: true, // GFM tag filter for disallowed HTML tags
  autolinks: true, // Autolink URLs, emails, and www. links
});
```

All available options:

| Option                 | Default | Description                                                 |
| ---------------------- | ------- | ----------------------------------------------------------- |
| `tables`               | `false` | GFM tables                                                  |
| `strikethrough`        | `false` | GFM strikethrough (`~~text~~`)                              |
| `tasklists`            | `false` | GFM task lists (`- [x] item`)                               |
| `autolinks`            | `false` | Enable autolinks — see [Autolinks](#autolinks)              |
| `headings`             | `false` | Heading IDs and autolinks — see [Heading IDs](#heading-ids) |
| `hardSoftBreaks`       | `false` | Treat soft line breaks as hard breaks                       |
| `wikiLinks`            | `false` | Enable `[[wiki links]]`                                     |
| `underline`            | `false` | `__text__` renders as `<u>` instead of `<strong>`           |
| `latexMath`            | `false` | Enable `$inline$` and `$$display$$` math                    |
| `collapseWhitespace`   | `false` | Collapse whitespace in text                                 |
| `permissiveAtxHeaders` | `false` | ATX headers without space after `#`                         |
| `noIndentedCodeBlocks` | `false` | Disable indented code blocks                                |
| `noHtmlBlocks`         | `false` | Disable HTML blocks                                         |
| `noHtmlSpans`          | `false` | Disable inline HTML                                         |
| `tagFilter`            | `false` | GFM tag filter for disallowed HTML tags                     |

#### Autolinks

Pass `true` to enable all autolink types, or an object for granular control:

```ts
// Enable all autolinks (URL, WWW, email)
Bun.markdown.html("Visit www.example.com", { autolinks: true });

// Enable only specific types
Bun.markdown.html("Visit www.example.com", {
  autolinks: { url: true, www: true },
});
```

#### Heading IDs

Pass `true` to enable both heading IDs and autolink headings, or an object for granular control:

```ts
// Enable heading IDs and autolink headings
Bun.markdown.html("## Hello World", { headings: true });
// '<h2 id="hello-world"><a href="#hello-world">Hello World</a></h2>\n'

// Enable only heading IDs (no autolink)
Bun.markdown.html("## Hello World", { headings: { ids: true } });
// '<h2 id="hello-world">Hello World</h2>\n'
```

---

## `Bun.markdown.render()`

Parse Markdown and render it using custom JavaScript callbacks. This gives you full control over the output format — you can generate HTML with custom classes, React elements, ANSI terminal output, or any other string format.

```ts
const result = Bun.markdown.render("# Hello **world**", {
  heading: (children, { level }) => `<h${level} class="title">${children}</h${level}>`,
  strong: children => `<b>${children}</b>`,
  paragraph: children => `<p>${children}</p>`,
});
// '<h1 class="title">Hello <b>world</b></h1>'
```

### Callback signature

Each callback receives:

1. **`children`** — the accumulated content of the element as a string
2. **`meta`** (optional) — an object with element-specific metadata

Return a string to replace the element's rendering. Return `null` or `undefined` to omit the element from the output entirely. If no callback is registered for an element, its children pass through unchanged.

### Block callbacks

| Callback     | Meta                                          | Description                                                                              |
| ------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `heading`    | `{ level, id? }`                              | Heading level 1–6. `id` is set when `headings: { ids: true }` is enabled                 |
| `paragraph`  | —                                             | Paragraph block                                                                          |
| `blockquote` | —                                             | Blockquote block                                                                         |
| `code`       | `{ language? }`                               | Fenced or indented code block. `language` is the info-string when specified on the fence |
| `list`       | `{ ordered, start?, depth }`                  | `depth` is nesting level (0 = top-level). `start` is set for ordered lists               |
| `listItem`   | `{ index, depth, ordered, start?, checked? }` | See [List item meta](#list-item-meta) below                                              |
| `hr`         | —                                             | Horizontal rule                                                                          |
| `table`      | —                                             | Table block                                                                              |
| `thead`      | —                                             | Table head                                                                               |
| `tbody`      | —                                             | Table body                                                                               |
| `tr`         | —                                             | Table row                                                                                |
| `th`         | `{ align? }`                                  | Table header cell. `align` is `"left"`, `"center"`, `"right"`, or absent                 |
| `td`         | `{ align? }`                                  | Table data cell                                                                          |
| `html`       | —                                             | Raw HTML content                                                                         |

#### List item meta

The `listItem` callback receives everything needed to render markers directly:

- `index` — 0-based position within the parent list
- `depth` — the parent list's nesting level (0 = top-level)
- `ordered` — whether the parent list is ordered
- `start` — the parent list's start number (only when `ordered` is true)
- `checked` — task list state (only for `- [x]` / `- [ ]` items)

### Inline callbacks

| Callback        | Meta                               | Description                  |
| --------------- | ---------------------------------- | ---------------------------- |
| `strong`        | —                                  | Strong emphasis (`**text**`) |
| `emphasis`      | —                                  | Emphasis (`*text*`)          |
| `link`          | `{ href: string, title?: string }` | Link                         |
| `image`         | `{ src: string, title?: string }`  | Image                        |
| `codespan`      | —                                  | Inline code (`` `code` ``)   |
| `strikethrough` | —                                  | Strikethrough (`~~text~~`)   |
| `text`          | —                                  | Plain text content           |

### Examples

#### Custom HTML with classes

```ts
const html = Bun.markdown.render("# Title\n\nHello **world**", {
  heading: (children, { level }) => `<h${level} class="heading heading-${level}">${children}</h${level}>`,
  paragraph: children => `<p class="body">${children}</p>`,
  strong: children => `<strong class="bold">${children}</strong>`,
});
```

#### Stripping all formatting

```ts
const plaintext = Bun.markdown.render("# Hello **world**", {
  heading: children => children,
  paragraph: children => children,
  strong: children => children,
  emphasis: children => children,
  link: children => children,
  image: () => "",
  code: children => children,
  codespan: children => children,
});
// "Hello world"
```

#### Omitting elements

Return `null` or `undefined` to remove an element from the output:

```ts
const result = Bun.markdown.render("# Title\n\n![logo](img.png)\n\nHello", {
  image: () => null, // Remove all images
  heading: children => children,
  paragraph: children => children + "\n",
});
// "Title\nHello\n"
```

#### ANSI terminal output

```ts
const ansi = Bun.markdown.render("# Hello\n\nThis is **bold** and *italic*", {
  heading: (children, { level }) => `\x1b[1;4m${children}\x1b[0m\n`,
  paragraph: children => children + "\n",
  strong: children => `\x1b[1m${children}\x1b[22m`,
  emphasis: children => `\x1b[3m${children}\x1b[23m`,
});
```

#### Nested list numbering

The `listItem` callback receives everything needed to render markers directly — no post-processing:

```ts
const result = Bun.markdown.render("1. first\n   1. sub-a\n   2. sub-b\n2. second", {
  listItem: (children, { index, depth, ordered, start }) => {
    const n = (start ?? 1) + index;
    // 1. 2. 3. at depth 0, a. b. c. at depth 1, i. ii. iii. at depth 2
    const marker = !ordered
      ? "-"
      : depth === 0
        ? `${n}.`
        : depth === 1
          ? `${String.fromCharCode(96 + n)}.`
          : `${toRoman(n)}.`;
    return "  ".repeat(depth) + marker + " " + children.trimEnd() + "\n";
  },
  // Prepend a newline so nested lists are separated from their parent item's text
  list: children => "\n" + children,
});
// 1. first
//   a. sub-a
//   b. sub-b
// 2. second
```

#### Code block syntax highlighting

````ts
const result = Bun.markdown.render("```js\nconsole.log('hi')\n```", {
  code: (children, meta) => {
    const lang = meta?.language ?? "";
    return `<pre><code class="language-${lang}">${children}</code></pre>`;
  },
});
````

### Parser options

Parser options are passed as a separate third argument:

```ts
const result = Bun.markdown.render(
  "Visit www.example.com",
  {
    link: (children, { href }) => `[${children}](${href})`,
    paragraph: children => children,
  },
  { autolinks: true },
);
```

---

## `Bun.markdown.react()`

Render Markdown directly to React elements. Returns a `<Fragment>` that you can use as a component return value.

```tsx
function Markdown({ text }: { text: string }) {
  return Bun.markdown.react(text);
}
```

### Server-side rendering

Works with `renderToString()` and React Server Components:

```tsx
import { renderToString } from "react-dom/server";

const html = renderToString(Bun.markdown.react("# Hello **world**"));
// "<h1>Hello <strong>world</strong></h1>"
```

### Component overrides

Replace any HTML element with a custom React component by passing it in the second argument, keyed by tag name:

```tsx
function Code({ language, children }) {
  return (
    <pre data-language={language}>
      <code>{children}</code>
    </pre>
  );
}

function Link({ href, title, children }) {
  return (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Heading({ id, children }) {
  return (
    <h2 id={id}>
      <a href={`#${id}`}>{children}</a>
    </h2>
  );
}

const el = Bun.markdown.react(
  content,
  {
    pre: Code,
    a: Link,
    h2: Heading,
  },
  { headings: { ids: true } },
);
```

#### Available overrides

Every HTML tag produced by the parser can be overridden:

| Option       | Props                        | Description                                                     |
| ------------ | ---------------------------- | --------------------------------------------------------------- |
| `h1`–`h6`    | `{ id?, children }`          | Headings. `id` is set when `headings: { ids: true }` is enabled |
| `p`          | `{ children }`               | Paragraph                                                       |
| `blockquote` | `{ children }`               | Blockquote                                                      |
| `pre`        | `{ language?, children }`    | Code block. `language` is the info string (e.g. `"js"`)         |
| `hr`         | `{}`                         | Horizontal rule (no children)                                   |
| `ul`         | `{ children }`               | Unordered list                                                  |
| `ol`         | `{ start, children }`        | Ordered list. `start` is the first item number                  |
| `li`         | `{ checked?, children }`     | List item. `checked` is set for task list items                 |
| `table`      | `{ children }`               | Table                                                           |
| `thead`      | `{ children }`               | Table head                                                      |
| `tbody`      | `{ children }`               | Table body                                                      |
| `tr`         | `{ children }`               | Table row                                                       |
| `th`         | `{ align?, children }`       | Table header cell                                               |
| `td`         | `{ align?, children }`       | Table data cell                                                 |
| `em`         | `{ children }`               | Emphasis (`*text*`)                                             |
| `strong`     | `{ children }`               | Strong (`**text**`)                                             |
| `a`          | `{ href, title?, children }` | Link                                                            |
| `img`        | `{ src, alt?, title? }`      | Image (no children)                                             |
| `code`       | `{ children }`               | Inline code                                                     |
| `del`        | `{ children }`               | Strikethrough (`~~text~~`)                                      |
| `br`         | `{}`                         | Hard line break (no children)                                   |

### React 18 and older

By default, elements use `Symbol.for('react.transitional.element')` as the `$$typeof` symbol. For React 18 and older, pass `reactVersion: 18` in the options (third argument):

```tsx
function Markdown({ text }: { text: string }) {
  return Bun.markdown.react(text, undefined, { reactVersion: 18 });
}
```

### Parser options

All [parser options](#options) are passed as the third argument:

```tsx
const el = Bun.markdown.react("## Hello World", undefined, {
  headings: { ids: true },
  autolinks: true,
});
```
