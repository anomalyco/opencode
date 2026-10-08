import { Schema } from "effect"

/** The methods of the in-page helper library, in the order `PAGE_HELPERS` defines them. */
export const PAGE_METHODS = [
  "count",
  "first",
  "all",
  "info",
  "name",
  "describe",
  "actionable",
  "control",
  "select",
  "setValue",
  "checked",
  "read",
  "textPresent",
  "scroll",
  "storage",
  "idle",
  "suggest",
] as const

export type PageMethod = (typeof PAGE_METHODS)[number]

/** `count`: how many elements matched, and how many of those are visible. */
export const PageCount = Schema.Struct({ count: Schema.Number, visible: Schema.Number })

/** `actionable`, `select`, `setValue`: success, or a short model-facing reason such as "not visible". */
export const PageOutcome = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({ ok: Schema.Literal(false), reason: Schema.String }),
])

/** `info`: role and name whenever they are non-empty, plus the requested fields and computed styles. */
export const PageInfo = Schema.Struct({
  tag: Schema.String,
  role: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  visible: Schema.Boolean,
  box: Schema.optionalKey(
    Schema.Struct({ x: Schema.Number, y: Schema.Number, width: Schema.Number, height: Schema.Number }),
  ),
  value: Schema.optionalKey(Schema.String),
  attributes: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  styles: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  html: Schema.optionalKey(Schema.String),
})

/** `control`: how to set the element's value. */
export const PageControl = Schema.Struct({
  kind: Schema.Literals([
    "text",
    "contenteditable",
    "select",
    "checkbox",
    "radio",
    "switch",
    "range",
    "date",
    "color",
    "file",
    "other",
  ]),
  checked: Schema.optionalKey(Schema.Boolean),
  multiple: Schema.optionalKey(Schema.Boolean),
})

/** `read`: one page of the text; `nextOffset` is present only while more text remains. */
export const PageRead = Schema.Struct({
  text: Schema.String,
  totalChars: Schema.Number,
  nextOffset: Schema.optionalKey(Schema.Number),
})

/** `scroll`: the scroll position of the element that scrolled, in CSS pixels. */
export const PagePosition = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  maxX: Schema.Number,
  maxY: Schema.Number,
})

/** `storage`: entries read or written. */
export const PageEntries = Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String }))

/**
 * Source of one self-contained function expression that returns the in-page helper library. It runs in the page, so it
 * is a string: a bundler cannot rewrite it. The desktop evaluates `(${PAGE_HELPERS})()` per call and invokes one
 * method; see `pageCall`.
 *
 * Methods that take `steps` (parsed locator steps without a leading ref) search under `this` when it is an element,
 * else the whole document, and pierce open shadow roots:
 * - `count(steps)` → `{ count, visible }`
 * - `first(steps)` → first visible match in document order, else the first match, else `null`
 * - `all(steps, limit = 20)` → matches in document order
 *
 * Element methods take the element as their first argument:
 * - `info(el, fields, styles)`, `name(el)`, `describe(el)`, `control(el)`, `checked(el)`
 * - `actionable(el, action, position?)` → Promise of `{ ok } | { ok: false, reason }`; `position` is the point the
 *   action targets, in CSS pixels from the element's top-left (default its center)
 * - `select(el, values)`, `setValue(el, value)` → `{ ok } | { ok: false, reason }`
 *
 * Page methods (`this` is an element or `window`):
 * - `read(format, after, before, offset, maxChars = 8000)` throws when `after` does not occur in the text
 * - `textPresent(needle, wantVisible)`: visible text (`innerText`) when `wantVisible`, else all DOM text
 * - `scroll(to, by)`, `storage(area, action, entries, keys)`, `idle()`, `suggest(query, limit = 10)`
 */
export const PAGE_HELPERS = String.raw`function () {
  "use strict";
  const IDLE = Symbol.for("opencode.browser.idle");
  const SKIP = new Set(["script", "style", "template", "noscript", "head"]);
  const UNREAD = new Set(["script", "style", "template", "noscript", "head", "title", "svg", "canvas", "iframe", "object", "embed", "audio", "video", "input", "textarea", "select", "datalist"]);
  const BLOCK = new Set(["address", "article", "aside", "blockquote", "body", "br", "caption", "center", "dd", "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "html", "legend", "li", "main", "menu", "nav", "ol", "option", "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul"]);
  const NAMED_BY_CONTENT = new Set(["button", "cell", "checkbox", "columnheader", "gridcell", "heading", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio", "row", "rowheader", "switch", "tab", "tooltip", "treeitem"]);
  const CONTROL_ROLES = new Set(["textbox", "searchbox", "combobox", "listbox", "checkbox", "radio", "switch", "slider", "spinbutton"]);
  const GENERIC_ROLES = new Set(["", "generic", "none", "presentation"]);
  const BUTTON_TYPES = new Set(["button", "submit", "reset", "image"]);
  const DATE_TYPES = new Set(["date", "time", "datetime-local", "month", "week"]);
  const TEXT_TYPES = new Set(["text", "email", "tel", "url", "password"]);
  const FORMATS = { date: "2026-09-07", time: "14:45", "datetime-local": "2026-09-07T14:45", month: "2026-09", week: "2026-W37", color: "#ff0000" };
  const STOP = new Set(["css", "xpath", "text", "role", "name", "label", "placeholder", "testid", "nth"]);
  const BREAK = "\uE000";
  const TICK = "\u0060";
  const texts = new Map();

  const norm = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  const clip = (value, max) => (value.length > max ? value.slice(0, Math.max(0, max - 1)) + "\u2026" : value);
  const isElement = (node) => !!node && node.nodeType === 1;
  const tagOf = (el) => String(el.localName || el.nodeName || "").toLowerCase();
  const viewOf = (el) => (el.ownerDocument && el.ownerDocument.defaultView) || window;
  const styleOf = (el) => viewOf(el).getComputedStyle(el);
  const parentOf = (node) => node.assignedSlot || node.parentElement || (node.parentNode && node.parentNode.nodeType === 11 ? node.parentNode.host : null) || null;
  const scopeOf = (self) => (self && (self.nodeType === 1 || self.nodeType === 9 || self.nodeType === 11) ? self : document);
  const fail = (reason) => ({ ok: false, reason: reason });

  function count(steps) {
    const found = resolve(scopeOf(this), steps);
    return { count: found.length, visible: found.filter((el) => visible(el)).length };
  }

  function first(steps) {
    const found = resolve(scopeOf(this), steps);
    return found.find((el) => visible(el)) || found[0] || null;
  }

  function all(steps, limit) {
    return resolve(scopeOf(this), steps).slice(0, Math.max(0, limit == null ? 20 : limit));
  }

  function resolve(scope, steps) {
    let list = [scope];
    for (const step of steps || []) {
      if (step.kind === "nth") {
        const index = step.index < 0 ? list.length + step.index : step.index;
        list = index >= 0 && index < list.length ? [list[index]] : [];
        continue;
      }
      const seen = new Set();
      const found = [];
      for (const root of list) {
        for (const el of query(root, step)) {
          if (seen.has(el)) continue;
          seen.add(el);
          found.push(el);
        }
      }
      list = list.length > 1 ? inDocumentOrder(found) : found;
    }
    return list.filter(isElement);
  }

  function query(root, step) {
    switch (step.kind) {
      case "css":
        return byCss(root, step.selector);
      case "xpath":
        return byXpath(root, step.expression);
      case "text": {
        const test = matcher(step.text, step.exact);
        return innermost(elementsUnder(root, true).filter((el) => test(textOf(el))));
      }
      case "role": {
        const test = step.name == null ? null : matcher(step.name, step.exact);
        return elementsUnder(root, true).filter((el) => roleOf(el) === step.role && (!test || test(nameOf(el))));
      }
      case "label": {
        const test = matcher(step.text, step.exact);
        return elementsUnder(root, true).filter((el) => labelsFor(el).some(test));
      }
      case "placeholder": {
        const test = matcher(step.text, step.exact);
        return elementsUnder(root, true).filter((el) => {
          const placeholder = el.getAttribute("placeholder") ?? el.getAttribute("aria-placeholder");
          return placeholder != null && test(placeholder);
        });
      }
      case "testid":
        return elementsUnder(root, true).filter((el) => ["data-testid", "data-test-id", "data-test"].some((name) => el.getAttribute(name) === step.id));
      case "ref":
        throw new Error("A ref such as @e12 is only valid as the first step of a locator.");
      default:
        throw new Error("Unknown locator step " + JSON.stringify(step.kind) + ".");
    }
  }

  // Every element under root in document order: an element, then its open shadow root, then its children.
  function elementsUnder(root, prune) {
    const out = [];
    const visit = (parent) => {
      if (parent.nodeType === 1 && parent.shadowRoot) visit(parent.shadowRoot);
      for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
        if (prune && SKIP.has(tagOf(child))) continue;
        out.push(child);
        visit(child);
      }
    };
    visit(root);
    return out;
  }

  function inDocumentOrder(elements) {
    if (elements.length < 2) return elements;
    const order = new Map(elementsUnder(elements[0].ownerDocument || document, false).map((el, index) => [el, index]));
    return elements
      .map((el, index) => ({ el: el, key: order.has(el) ? order.get(el) : Infinity, index: index }))
      .sort((a, b) => a.key - b.key || a.index - b.index)
      .map((item) => item.el);
  }

  function byCss(root, selector) {
    const all = elementsUnder(root, false);
    const hits = new Set();
    const search = (tree) => {
      let found;
      try {
        found = tree.querySelectorAll(selector);
      } catch (error) {
        throw new Error("Invalid CSS selector " + JSON.stringify(selector) + '. Prefix other locators with their engine: text=Save, role=button[name="Send"], label=Email, placeholder=Search, testid=submit, xpath=//main//a.');
      }
      for (const el of found) hits.add(el);
    };
    search(root);
    for (const el of all) if (el.shadowRoot) search(el.shadowRoot);
    return hits.size ? all.filter((el) => hits.has(el)) : [];
  }

  function byXpath(root, expression) {
    const doc = root.nodeType === 9 ? root : root.ownerDocument;
    const relative = root.nodeType !== 9 && expression.startsWith("/") ? "." + expression : expression;
    let result;
    try {
      result = doc.evaluate(relative, root, null, 7, null);
    } catch (error) {
      throw new Error("Invalid XPath " + JSON.stringify(expression) + ": " + (error && error.message ? error.message : String(error)));
    }
    const out = [];
    for (let index = 0; index < result.snapshotLength; index++) {
      const node = result.snapshotItem(index);
      if (isElement(node)) out.push(node);
    }
    return out;
  }

  function matcher(value, exact) {
    const needle = norm(value);
    if (exact) return (text) => norm(text) === needle;
    const lower = needle.toLowerCase();
    return (text) => norm(text).toLowerCase().includes(lower);
  }

  // Keeps an element only when none of its child elements (light, shadow, or slotted) also matched.
  function innermost(matched) {
    const set = new Set(matched);
    return matched.filter((el) => !childElementsOf(el).some((child) => set.has(child)));
  }

  function childElementsOf(el) {
    const out = Array.from(el.children);
    if (el.shadowRoot) out.push(...el.shadowRoot.children);
    if (tagOf(el) === "slot" && el.assignedElements) out.push(...el.assignedElements());
    return out;
  }

  // The nodes an element renders: its shadow root's, a slot's assigned nodes, else its children.
  function childNodesOf(node) {
    if (node.nodeType === 1 && node.shadowRoot) return Array.from(node.shadowRoot.childNodes);
    if (tagOf(node) === "slot" && node.assignedNodes) {
      const assigned = node.assignedNodes();
      if (assigned.length) return Array.from(assigned);
    }
    return Array.from(node.childNodes);
  }

  // Rendered-tree text without layout: block elements are separated by spaces, so "<div>a</div><div>b</div>" reads "a b".
  function textOf(el) {
    const cached = texts.get(el);
    if (cached !== undefined) return cached;
    const tag = tagOf(el);
    const text = SKIP.has(tag) ? "" : tag === "input" ? (BUTTON_TYPES.has(el.type) ? String(el.value) : "") : collect(childNodesOf(el), null);
    texts.set(el, text);
    return text;
  }

  function collect(nodes, skip) {
    let out = "";
    for (const node of nodes) {
      if (node.nodeType === 3) out += node.data;
      if (node.nodeType !== 1 || node === skip) continue;
      const text = skip && node.contains(skip) ? collect(childNodesOf(node), skip) : textOf(node);
      out += BLOCK.has(tagOf(node)) ? " " + text + " " : text;
    }
    return out;
  }

  function roleOf(el) {
    const explicit = norm(el.getAttribute("role")).split(" ")[0].toLowerCase();
    if (explicit) return explicit;
    const tag = tagOf(el);
    const implicit = implicitRole(el, tag);
    if (implicit && implicit !== "paragraph") return implicit;
    const editable = el.getAttribute("contenteditable");
    if (editable !== null && editable !== "false") return "textbox";
    return implicit;
  }

  function implicitRole(el, tag) {
    switch (tag) {
      case "a":
      case "area":
        return el.hasAttribute("href") ? "link" : "";
      case "button":
      case "summary":
        return "button";
      case "input":
        return inputRole(el);
      case "select":
        return el.multiple || el.size > 1 ? "listbox" : "combobox";
      case "textarea":
        return "textbox";
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return "heading";
      case "nav":
        return "navigation";
      case "main":
        return "main";
      case "header":
        return el.closest("article, aside, main, nav, section") ? "" : "banner";
      case "footer":
        return el.closest("article, aside, main, nav, section") ? "" : "contentinfo";
      case "aside":
        return "complementary";
      case "form":
        return "form";
      case "search":
        return "search";
      case "section":
        return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "region" : "";
      case "dialog":
        return "dialog";
      case "article":
        return "article";
      case "img":
        return el.getAttribute("alt") === "" ? "presentation" : "img";
      case "ul":
      case "ol":
      case "menu":
        return "list";
      case "li":
        return "listitem";
      case "dt":
        return "term";
      case "dd":
        return "definition";
      case "table":
        return "table";
      case "thead":
      case "tbody":
      case "tfoot":
        return "rowgroup";
      case "tr":
        return "row";
      case "td": {
        const table = el.closest("table");
        return table && ["grid", "treegrid"].includes(table.getAttribute("role")) ? "gridcell" : "cell";
      }
      case "th":
        return el.getAttribute("scope") === "row" ? "rowheader" : "columnheader";
      case "caption":
        return "caption";
      case "option":
        return "option";
      case "optgroup":
      case "details":
      case "fieldset":
        return "group";
      case "datalist":
        return "listbox";
      case "progress":
        return "progressbar";
      case "meter":
        return "meter";
      case "output":
        return "status";
      case "hr":
        return "separator";
      case "figure":
        return "figure";
      case "blockquote":
        return "blockquote";
      case "p":
        return "paragraph";
      default:
        return "";
    }
  }

  function inputRole(el) {
    const type = el.type;
    if (BUTTON_TYPES.has(type)) return "button";
    if (type === "checkbox" || type === "radio") return type;
    if (type === "range") return "slider";
    if (type === "number") return "spinbutton";
    if (type === "search") return el.hasAttribute("list") ? "combobox" : "searchbox";
    if (TEXT_TYPES.has(type)) return el.hasAttribute("list") ? "combobox" : "textbox";
    if (type === "hidden" || type === "file" || type === "color" || DATE_TYPES.has(type)) return "";
    return "textbox";
  }

  // An approximation of the accessible name: aria-labelledby, aria-label, labels, placeholder, alt, content, title.
  function nameOf(el) {
    if (!isElement(el)) return "";
    const tag = tagOf(el);
    const labelled = idsText(el, "aria-labelledby");
    if (labelled) return clip(labelled, 200);
    const aria = norm(el.getAttribute("aria-label"));
    if (aria) return clip(aria, 200);
    const field = tag === "input" || tag === "textarea" || tag === "select";
    if (field) {
      const labels = norm(labelsOf(el).map((label) => collect(childNodesOf(label), el)).join(" "));
      if (labels) return clip(labels, 200);
      const type = tag === "input" ? el.type : tag;
      if (BUTTON_TYPES.has(type)) {
        const value = norm(type === "image" ? el.getAttribute("alt") : el.value) || (type === "submit" ? "Submit" : type === "reset" ? "Reset" : "");
        if (value) return clip(value, 200);
      }
      const placeholder = norm(el.getAttribute("placeholder") || el.getAttribute("aria-placeholder"));
      if (placeholder) return clip(placeholder, 200);
    }
    if (tag === "img" || tag === "area") {
      const alt = norm(el.getAttribute("alt"));
      if (alt) return clip(alt, 200);
    }
    const title = norm(el.getAttribute("title"));
    if (NAMED_BY_CONTENT.has(roleOf(el))) {
      const content = norm(contentName(el));
      if (content) return clip(content, 200);
    }
    if (title) return clip(title, 200);
    if (field) return "";
    return clip(norm(contentName(el)), 200);
  }

  // Name from content: like textOf, but a child's aria-label or image alt stands in for the child, and aria-hidden children are skipped.
  function contentName(node) {
    let out = "";
    for (const child of childNodesOf(node)) {
      if (child.nodeType === 3) out += child.data;
      if (child.nodeType !== 1) continue;
      const tag = tagOf(child);
      if (SKIP.has(tag) || child.getAttribute("aria-hidden") === "true") continue;
      const label = norm(child.getAttribute("aria-label"));
      const svgTitle = tag === "svg" ? child.querySelector("title") : null;
      const text = label || (tag === "img" ? norm(child.getAttribute("alt")) : tag === "input" ? (BUTTON_TYPES.has(child.type) ? String(child.value) : "") : tag === "svg" ? norm(svgTitle && svgTitle.textContent) : contentName(child));
      out += BLOCK.has(tag) || label || tag === "img" ? " " + text + " " : text;
    }
    return out;
  }

  function idsText(el, attribute) {
    const ids = norm(el.getAttribute(attribute)).split(" ").filter((id) => id);
    if (!ids.length) return "";
    const root = el.getRootNode();
    const lookup = root.getElementById ? root : el.ownerDocument || document;
    return norm(ids.map((id) => {
      const target = lookup.getElementById(id);
      return target ? norm(target.getAttribute("aria-label")) || contentName(target) : "";
    }).join(" "));
  }

  function labelsOf(el) {
    const out = [];
    const id = el.getAttribute("id");
    const wrapper = el.closest ? el.closest("label") : null;
    if (wrapper && (!wrapper.getAttribute("for") || wrapper.getAttribute("for") === id)) out.push(wrapper);
    if (!id) return out;
    const root = el.getRootNode();
    if (!root.querySelectorAll) return out;
    for (const label of root.querySelectorAll("label")) if (label.getAttribute("for") === id && !out.includes(label)) out.push(label);
    return out;
  }

  // The texts that label an element, for the label engine.
  function labelsFor(el) {
    const out = [];
    const aria = el.getAttribute("aria-label");
    if (aria) out.push(aria);
    const labelled = idsText(el, "aria-labelledby");
    if (labelled) out.push(labelled);
    if (labelable(el)) for (const label of labelsOf(el)) out.push(collect(childNodesOf(label), el));
    return out;
  }

  function labelable(el) {
    const tag = tagOf(el);
    if (tag === "input") return el.type !== "hidden";
    if (["textarea", "select", "button", "meter", "output", "progress"].includes(tag)) return true;
    return el.isContentEditable === true || CONTROL_ROLES.has(roleOf(el));
  }

  function describe(el) {
    if (!isElement(el)) return String((el && el.nodeName) || "nothing").toLowerCase();
    const classes = Array.from(el.classList || []).slice(0, 2).map((name) => "." + name).join("");
    const base = clip(tagOf(el) + (el.id ? "#" + el.id : "") + classes, 70);
    const name = clip(nameOf(el), 120 - base.length - 3);
    return name ? base + ' "' + name + '"' : base;
  }

  function visible(el) {
    if (!isElement(el) || !el.isConnected) return false;
    const style = styleOf(el);
    if (style.visibility === "hidden" || style.visibility === "collapse") return false;
    for (let node = el; node; node = parentOf(node)) {
      const current = node === el ? style : styleOf(node);
      if (current.display === "none" || parseFloat(current.opacity) === 0) return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
    if (style.display !== "contents") return false;
    return childNodesOf(el).some((child) => (child.nodeType === 1 ? visible(child) : child.nodeType === 3 && child.data.trim() !== ""));
  }

  function disabled(el) {
    const tag = tagOf(el);
    if (["button", "input", "select", "textarea", "option", "optgroup", "fieldset"].includes(tag) && el.disabled) return true;
    if (["button", "input", "select", "textarea"].includes(tag)) {
      for (let node = el.parentElement; node; node = node.parentElement) {
        if (tagOf(node) !== "fieldset" || !node.disabled) continue;
        const legend = Array.from(node.children).find((child) => tagOf(child) === "legend");
        if (!legend || !legend.contains(el)) return true;
      }
    }
    for (let node = el; node; node = parentOf(node)) if (node.getAttribute && node.getAttribute("aria-disabled") === "true") return true;
    return false;
  }

  function editable(el) {
    if (el.getAttribute("aria-readonly") === "true") return false;
    const tag = tagOf(el);
    if (tag === "input" || tag === "textarea") return !el.readOnly;
    if (tag === "select") return true;
    return el.isContentEditable === true;
  }

  async function actionable(el, action, position) {
    if (!isElement(el) || !el.isConnected) return fail("not attached to the page");
    if (action === "upload") return disabled(el) ? fail("disabled") : { ok: true };
    const view = viewOf(el);
    const rect = el.getBoundingClientRect();
    const x = rect.left + (position ? position.x : rect.width / 2);
    const y = rect.top + (position ? position.y : rect.height / 2);
    if (x < 0 || y < 0 || x > view.innerWidth || y > view.innerHeight) el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    if (!visible(el)) return fail("not visible");
    if (action !== "hover" && disabled(el)) return fail("disabled");
    if ((action === "fill" || action === "type") && !editable(el)) return fail("not editable");
    if (action !== "click" && action !== "hover" && action !== "drag") return { ok: true };
    if (!(await stable(el))) return fail("moving");
    return receives(el, position);
  }

  // Compares the box across two animation frames. A page that is not painting never runs requestAnimationFrame,
  // so after 100 ms without a frame the check falls back to 50 ms timers.
  async function stable(el) {
    let stalled = false;
    const frame = () =>
      stalled
        ? new Promise((resolve) => setTimeout(resolve, 50))
        : new Promise((resolve) => {
            const timer = setTimeout(() => {
              stalled = true;
              resolve();
            }, 100);
            requestAnimationFrame(() => {
              clearTimeout(timer);
              resolve();
            });
          });
    await frame();
    const before = el.getBoundingClientRect();
    await frame();
    const after = el.getBoundingClientRect();
    return before.left === after.left && before.top === after.top && before.width === after.width && before.height === after.height;
  }

  function receives(el, position) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + (position ? position.x : rect.width / 2);
    const y = rect.top + (position ? position.y : rect.height / 2);
    let hit = el.ownerDocument.elementFromPoint(x, y);
    while (hit && hit.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    if (!hit) return fail("outside the viewport");
    for (let node = hit; node; node = parentOf(node)) if (node === el) return { ok: true };
    if (labelsOf(el).some((label) => label === hit || label.contains(hit))) return { ok: true };
    return fail("covered by " + describe(hit));
  }

  function info(el, fields, styles) {
    const want = new Set(fields || []);
    const out = { tag: tagOf(el), visible: visible(el) };
    const role = roleOf(el);
    if (role) out.role = role;
    const name = nameOf(el);
    if (name) out.name = name;
    if (want.has("text")) out.text = clip(norm(typeof el.innerText === "string" ? el.innerText : textOf(el)), 300);
    if (want.has("box")) {
      const rect = el.getBoundingClientRect();
      out.box = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    }
    if (want.has("value")) {
      const value = valueOf(el);
      if (value != null) out.value = clip(String(value), 100000);
    }
    if (want.has("attributes")) out.attributes = Object.fromEntries(Array.from(el.attributes, (attribute) => [attribute.name, clip(attribute.value, 300)]));
    if (want.has("html")) out.html = clip(el.outerHTML, 2000);
    if (styles && styles.length) {
      const computed = styleOf(el);
      out.styles = Object.fromEntries(styles.map((property) => [property, clip(String(computed.getPropertyValue(property.startsWith("--") ? property : property.replace(/[A-Z]/g, (char) => "-" + char.toLowerCase())) || ""), 300)]));
    }
    return out;
  }

  function valueOf(el) {
    const tag = tagOf(el);
    if (["input", "textarea", "select", "option", "button", "output", "progress", "meter"].includes(tag)) return el.value;
    if (el.isContentEditable) return el.innerText;
    return el.getAttribute("aria-valuetext") ?? el.getAttribute("aria-valuenow");
  }

  function control(el) {
    const tag = tagOf(el);
    if (tag === "input") {
      const type = el.type;
      if (type === "checkbox" || type === "radio") return { kind: type, checked: el.checked };
      if (type === "range" || type === "color") return { kind: type };
      if (type === "file") return { kind: "file", multiple: el.multiple };
      if (DATE_TYPES.has(type)) return { kind: "date" };
      if (BUTTON_TYPES.has(type) || type === "hidden") return { kind: "other" };
      return { kind: "text" };
    }
    if (tag === "textarea") return { kind: "text" };
    if (tag === "select") return { kind: "select", multiple: el.multiple };
    if (roleOf(el) === "switch" || el.hasAttribute("aria-checked")) return { kind: "switch", checked: el.getAttribute("aria-checked") === "true" };
    if (el.isContentEditable) return { kind: "contenteditable" };
    return { kind: "other" };
  }

  function select(el, values) {
    if (tagOf(el) !== "select") return fail("not a <select>; click it to open its list, then click the option");
    if (disabled(el)) return fail("disabled");
    const wanted = (Array.isArray(values) ? values : [values]).map(String);
    if (!el.multiple && wanted.length !== 1) return fail("this <select> takes exactly one value");
    const options = Array.from(el.querySelectorAll("option"));
    const label = (option) => norm(option.getAttribute("label") || option.textContent);
    const picked = [];
    for (const value of wanted) {
      const option = options.find((item) => !item.disabled && item.value === value) || options.find((item) => !item.disabled && label(item).toLowerCase() === norm(value).toLowerCase());
      if (!option) {
        const list = options.slice(0, 20).map((item) => JSON.stringify(label(item)) + (item.value !== label(item) ? " (value " + JSON.stringify(item.value) + ")" : "") + (item.disabled ? " (disabled)" : ""));
        return fail("no enabled option matches " + JSON.stringify(value) + "; options: " + list.join(", ") + (options.length > 20 ? ", \u2026" : ""));
      }
      picked.push(option);
    }
    if (el.multiple) for (const option of options) option.selected = picked.includes(option);
    else picked[0].selected = true;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }

  // Sets the value through the native setter, so frameworks that track the value property see the change.
  function setValue(el, value) {
    if (tagOf(el) !== "input") return fail("not an <input>");
    if (disabled(el)) return fail("disabled");
    if (el.readOnly) return fail("not editable");
    const setter = Object.getOwnPropertyDescriptor(viewOf(el).HTMLInputElement.prototype, "value").set;
    const text = String(value);
    const previous = el.value;
    const type = el.type;
    el.focus();
    setter.call(el, text);
    const accepted = type === "color" ? el.value === text.toLowerCase() : type === "range" || type === "number" ? el.value !== "" && Number(el.value) === Number(text) : el.value === text;
    if (!accepted) {
      setter.call(el, previous);
      const format = type === "range" ? "a number from " + (el.min || "0") + " to " + (el.max || "100") + (el.step && el.step !== "any" ? " in steps of " + el.step : "") : FORMATS[type] || "a value this input accepts";
      return fail("the " + type + " input rejected " + JSON.stringify(text) + "; use the format " + format);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }

  function checked(el) {
    if (tagOf(el) === "input" && (el.type === "checkbox" || el.type === "radio")) return el.checked;
    const aria = el.getAttribute("aria-checked");
    if (aria === "true") return true;
    if (aria === "false" || aria === "mixed") return false;
    return null;
  }

  function read(format, after, before, offset, maxChars) {
    const root = isElement(this) ? this : document.body || document.documentElement;
    if (!root) return { text: "", totalChars: 0 };
    const full = format === "markdown" ? blocks([root], false).join("\n\n") : plainText(root);
    const text = cut(full, after, before);
    const start = Math.max(0, Math.floor(offset || 0));
    const end = start + Math.max(1, Math.floor(maxChars || 8000));
    const out = { text: text.slice(start, end), totalChars: text.length };
    if (end < text.length) out.nextOffset = end;
    return out;
  }

  // Chromium's innerText leaves out shadow DOM, so a root with open shadow roots reads through the composed-tree walker.
  function plainText(root) {
    const shadowed = elementsUnder(root, true).some((el) => el.shadowRoot);
    if (!shadowed && typeof root.innerText === "string") return tidy(root.innerText);
    return tidy(blocks([root], true).join("\n"));
  }

  function tidy(text) {
    return text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function cut(text, after, before) {
    if (!after && !before) return text;
    const lower = text.toLowerCase();
    let start = 0;
    let end = text.length;
    if (after) {
      const at = lower.indexOf(String(after).toLowerCase());
      if (at < 0) throw new Error("The phrase " + JSON.stringify(after) + " (after) does not occur in the text. Read without after, or pick a phrase from the text.");
      start = at + String(after).length;
    }
    if (before) {
      const at = lower.indexOf(String(before).toLowerCase(), start);
      if (at >= 0) end = at;
    }
    return text.slice(start, end).trim();
  }

  function skipped(el) {
    return UNREAD.has(tagOf(el)) || el.hidden === true || el.getAttribute("aria-hidden") === "true" || styleOf(el).display === "none";
  }

  // DOM to Markdown, or to plain text without markup when plain. Returns the blocks of the given nodes; the caller
  // joins them.
  function blocks(nodes, plain) {
    const out = [];
    let line = "";
    const flush = () => {
      const text = line.split(BREAK).map((part) => part.replace(/\s+/g, " ").trim()).filter((part) => part).join("\n");
      if (text) out.push(text);
      line = "";
    };
    const add = (block) => {
      flush();
      if (block) out.push(block);
    };
    const nested = (el) => blocks(childNodesOf(el), plain);
    const same = (text) => text;
    const pad = (el, text) => (/^\s/.test(el.textContent || "") ? " " : "") + text + (/\s$/.test(el.textContent || "") ? " " : "");
    const inline = (el, wrap) => {
      const parts = nested(el);
      if (parts.length > 1) {
        flush();
        out.push(...parts);
        return;
      }
      if (parts.length) line += pad(el, wrap(parts[0].replace(/\n/g, " ")));
    };
    const walk = (node) => {
      if (node.nodeType === 3) {
        line += node.data;
        return;
      }
      if (node.nodeType !== 1 || skipped(node)) return;
      const el = node;
      const tag = tagOf(el);
      if (/^h[1-6]$/.test(tag)) {
        const text = nested(el).join(" ").replace(/\n/g, " ");
        if (text) add(plain ? text : "#".repeat(Number(tag[1])) + " " + text);
        return;
      }
      if (tag === "br") {
        line += BREAK;
        return;
      }
      if (tag === "hr") return add(plain ? "" : "---");
      if (tag === "pre") return add(plain ? (el.textContent || "").replace(/\n$/, "") : fence(el));
      if (tag === "ul" || tag === "ol" || tag === "menu") return add(list(el, tag === "ol", plain));
      if (tag === "table") return add(table(el, plain));
      if (tag === "blockquote") {
        const text = nested(el).join(plain ? "\n" : "\n\n");
        if (text) add(plain ? text : text.split("\n").map((part) => (part ? "> " + part : ">")).join("\n"));
        return;
      }
      if (tag === "img") {
        const alt = norm(el.getAttribute("alt"));
        if (alt && !plain) line += " ![" + alt + "](" + source(el) + ") ";
        return;
      }
      if (tag === "a") return plain ? inline(el, same) : link(el);
      if (tag === "strong" || tag === "b") return inline(el, plain ? same : (text) => "**" + text + "**");
      if (tag === "em" || tag === "i") return inline(el, plain ? same : (text) => "*" + text + "*");
      if (tag === "code") {
        const text = norm(el.textContent);
        const tick = plain ? "" : text.includes(TICK) ? TICK + TICK : TICK;
        if (text) line += pad(el, tick + (tick.length > 1 ? " " + text + " " : text) + tick);
        return;
      }
      const display = styleOf(el).display;
      const block = BLOCK.has(tag) || /^(block|flex|grid|list-item|table|flow-root)/.test(display);
      const spaced = !block && /^inline-/.test(display);
      if (block) flush();
      if (spaced) line += " ";
      for (const child of childNodesOf(el)) walk(child);
      if (block) flush();
      if (spaced) line += " ";
    };
    const link = (el) => {
      const href = el.getAttribute("href");
      const parts = nested(el);
      const label = parts.length ? parts : [norm(el.getAttribute("aria-label") || el.getAttribute("title"))].filter((part) => part);
      if (!label.length) return;
      const target = href && !/^\s*javascript:/i.test(href) && href !== "#" ? "(" + absolute(el, href) + ")" : null;
      if (label.length > 1) {
        flush();
        out.push(target ? "[" + label[0].replace(/\n/g, " ") + "]" + target : label[0], ...label.slice(1));
        return;
      }
      line += pad(el, target ? "[" + label[0].replace(/\n/g, " ") + "]" + target : label[0]);
    };
    for (const node of nodes) walk(node);
    flush();
    return out;
  }

  function list(el, ordered, plain) {
    const start = parseInt(el.getAttribute("start") || "", 10);
    let number = ordered && !isNaN(start) ? start : 1;
    const items = [];
    for (const child of childNodesOf(el)) {
      if (child.nodeType !== 1 || skipped(child)) continue;
      if (tagOf(child) !== "li") {
        const body = blocks([child], plain).join("\n");
        if (body) items.push(plain ? body : body.split("\n").map((part) => (part ? "  " + part : part)).join("\n"));
        continue;
      }
      const body = blocks(childNodesOf(child), plain).join("\n");
      if (plain) {
        if (body) items.push(body);
        continue;
      }
      const marker = ordered ? number++ + "." : "-";
      const lines = body.split("\n");
      const indent = " ".repeat(marker.length + 1);
      items.push((marker + " " + lines[0]).trimEnd() + lines.slice(1).map((part) => "\n" + (part ? indent + part : "")).join(""));
    }
    return items.join("\n");
  }

  function table(el, plain) {
    const rows = Array.from(el.querySelectorAll("tr")).filter((row) => row.closest("table") === el && !skipped(row));
    const grid = rows.map((row) =>
      Array.from(row.children)
        .filter((cell) => (tagOf(cell) === "td" || tagOf(cell) === "th") && !skipped(cell))
        .map((cell) => blocks(childNodesOf(cell), plain).join(" ").replace(/\n/g, " ")),
    );
    if (plain) return grid.map((cells) => cells.join("\t")).join("\n");
    const width = Math.max(0, ...grid.map((cells) => cells.length));
    if (!width) return "";
    const row = (cells) => "| " + Array.from({ length: width }, (_, index) => (cells[index] || "").replace(/\|/g, "\\|")).join(" | ") + " |";
    return [row(grid[0]), "|" + " --- |".repeat(width), ...grid.slice(1).map(row)].join("\n");
  }

  function fence(el) {
    const text = (el.textContent || "").replace(/\n$/, "");
    const code = el.querySelector("code");
    const language = /(?:^|\s)lang(?:uage)?-([\w+#-]+)/.exec((code && code.getAttribute("class")) || el.getAttribute("class") || "");
    let ticks = TICK + TICK + TICK;
    while (text.includes(ticks)) ticks += TICK;
    return ticks + (language ? language[1] : "") + "\n" + text + "\n" + ticks;
  }

  function source(el) {
    const src = el.getAttribute("src") || "";
    return /^data:/i.test(src) ? "data:\u2026" : absolute(el, src);
  }

  function absolute(el, href) {
    try {
      return new URL(href, el.baseURI || document.baseURI).href;
    } catch (error) {
      return href;
    }
  }

  function textPresent(needle, wantVisible) {
    const want = norm(needle).toLowerCase();
    if (!want) return true;
    const body = document.body || document.documentElement;
    if (!body) return false;
    if (!wantVisible) return norm(textOf(body)).toLowerCase().includes(want);
    if (norm(body.innerText).toLowerCase().includes(want)) return true;
    return elementsUnder(body, true).some((el) => el.shadowRoot && Array.from(el.shadowRoot.children).some((child) => !SKIP.has(tagOf(child)) && norm(child.innerText).toLowerCase().includes(want)));
  }

  function scroll(to, by) {
    const page = document.scrollingElement || document.documentElement;
    const el = isElement(this) ? this : null;
    if (el && !to && !by) {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      return position(page);
    }
    const target = (el && scrollable(el)) || page;
    if (to === "top") target.scrollTo({ top: 0, behavior: "instant" });
    if (to === "bottom") target.scrollTo({ top: target.scrollHeight, behavior: "instant" });
    if (to === "left") target.scrollTo({ left: 0, behavior: "instant" });
    if (to === "right") target.scrollTo({ left: target.scrollWidth, behavior: "instant" });
    if (by) target.scrollBy({ left: by.x || 0, top: by.y || 0, behavior: "instant" });
    return position(target);
  }

  function scrollable(el) {
    for (let node = el; node; node = parentOf(node)) {
      if (node === document.body || node === document.documentElement) return null;
      const style = styleOf(node);
      const y = node.scrollHeight > node.clientHeight && /(auto|scroll|overlay)/.test(style.overflowY);
      const x = node.scrollWidth > node.clientWidth && /(auto|scroll|overlay)/.test(style.overflowX);
      if (x || y) return node;
    }
    return null;
  }

  function position(el) {
    return { x: el.scrollLeft, y: el.scrollTop, maxX: Math.max(0, el.scrollWidth - el.clientWidth), maxY: Math.max(0, el.scrollHeight - el.clientHeight) };
  }

  function storage(area, action, entries, keys) {
    const store = area === "session" ? sessionStorage : localStorage;
    const entry = (name) => ({ name: clip(String(name), 2048), value: clip(String(store.getItem(name)), 100000) });
    if (action === "set") {
      const names = Object.keys(entries || {});
      for (const name of names) store.setItem(name, String(entries[name]));
      return names.map(entry);
    }
    if (action === "clear") {
      if (keys && keys.length) for (const name of keys) store.removeItem(name);
      else store.clear();
      return [];
    }
    const names = keys && keys.length ? keys : Array.from({ length: store.length }, (_, index) => store.key(index));
    return names.filter((name) => name !== null && store.getItem(name) !== null).map(entry);
  }

  function idle() {
    const now = Date.now();
    const state = window[IDLE];
    if (state && state.document === document) return now - (state.last || state.installed);
    const fresh = { document: document, installed: now, last: 0 };
    new MutationObserver(() => {
      fresh.last = Date.now();
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    window[IDLE] = fresh;
    return 0;
  }

  function interactive(el) {
    const tag = tagOf(el);
    if (tag === "a") return el.hasAttribute("href");
    if (tag === "input") return el.type !== "hidden";
    if (["button", "select", "textarea", "summary"].includes(tag)) return true;
    const editable = el.getAttribute("contenteditable");
    return (el.hasAttribute("role") && !GENERIC_ROLES.has(roleOf(el))) || el.hasAttribute("tabindex") || (editable !== null && editable !== "false");
  }

  function suggest(query, limit) {
    const words = norm(query).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1 && !STOP.has(word));
    const seen = new Set();
    const items = [];
    for (const el of elementsUnder(document, true)) {
      if (!interactive(el) || !visible(el)) continue;
      const name = clip(nameOf(el), 60);
      const description = name ? (roleOf(el) || tagOf(el)) + ' "' + name + '"' : describe(el);
      if (seen.has(description)) continue;
      seen.add(description);
      const haystack = (description + " " + (el.id || "") + " " + (el.getAttribute("placeholder") || "")).toLowerCase();
      items.push({ description: description, score: words.filter((word) => haystack.includes(word)).length, index: items.length });
    }
    return items
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, Math.max(0, limit == null ? 10 : limit))
      .map((item) => item.description);
  }

  return { count, first, all, info, name: nameOf, describe, actionable, control, select, setValue, checked, read, textPresent, scroll, storage, idle, suggest };
}`

/**
 * A function declaration for `Runtime.callFunctionOn` that builds the helper library and calls one method with the
 * call's arguments, forwarding `this`. Pass `objectId` of an element to scope the search to it, or
 * `executionContextId` alone to run against `window`. Use `returnByValue: false` for `first` and `all`, and
 * `awaitPromise: true` for `actionable`.
 */
export function pageCall(method: PageMethod): string {
  return `function (...args) { return (${PAGE_HELPERS})().${method}.apply(this, args) }`
}
