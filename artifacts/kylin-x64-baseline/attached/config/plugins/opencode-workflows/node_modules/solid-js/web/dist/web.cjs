'use strict';

var solidJs = require('solid-js');

const booleans = ["allowfullscreen", "async", "alpha",
"autofocus",
"autoplay", "checked", "controls", "default", "disabled", "formnovalidate", "hidden",
"indeterminate", "inert",
"ismap", "loop", "multiple", "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required", "reversed", "seamless",
"selected", "adauctionheaders",
"browsingtopics",
"credentialless",
"defaultchecked", "defaultmuted", "defaultselected", "defer", "disablepictureinpicture", "disableremoteplayback", "preservespitch",
"shadowrootclonable", "shadowrootcustomelementregistry",
"shadowrootdelegatesfocus", "shadowrootserializable",
"sharedstoragewritable"
];
const Properties = /*#__PURE__*/new Set([
"className", "value",
"readOnly", "noValidate", "formNoValidate", "isMap", "noModule", "playsInline", "adAuctionHeaders",
"allowFullscreen", "browsingTopics",
"defaultChecked", "defaultMuted", "defaultSelected", "disablePictureInPicture", "disableRemotePlayback", "preservesPitch", "shadowRootClonable", "shadowRootCustomElementRegistry",
"shadowRootDelegatesFocus", "shadowRootSerializable",
"sharedStorageWritable",
...booleans]);
const ChildProperties = /*#__PURE__*/new Set(["innerHTML", "textContent", "innerText", "children"]);
const Aliases = /*#__PURE__*/Object.assign(Object.create(null), {
  className: "class",
  htmlFor: "for"
});
const PropAliases = /*#__PURE__*/Object.assign(Object.create(null), {
  class: "className",
  novalidate: {
    $: "noValidate",
    FORM: 1
  },
  formnovalidate: {
    $: "formNoValidate",
    BUTTON: 1,
    INPUT: 1
  },
  ismap: {
    $: "isMap",
    IMG: 1
  },
  nomodule: {
    $: "noModule",
    SCRIPT: 1
  },
  playsinline: {
    $: "playsInline",
    VIDEO: 1
  },
  readonly: {
    $: "readOnly",
    INPUT: 1,
    TEXTAREA: 1
  },
  adauctionheaders: {
    $: "adAuctionHeaders",
    IFRAME: 1
  },
  allowfullscreen: {
    $: "allowFullscreen",
    IFRAME: 1
  },
  browsingtopics: {
    $: "browsingTopics",
    IMG: 1
  },
  defaultchecked: {
    $: "defaultChecked",
    INPUT: 1
  },
  defaultmuted: {
    $: "defaultMuted",
    AUDIO: 1,
    VIDEO: 1
  },
  defaultselected: {
    $: "defaultSelected",
    OPTION: 1
  },
  disablepictureinpicture: {
    $: "disablePictureInPicture",
    VIDEO: 1
  },
  disableremoteplayback: {
    $: "disableRemotePlayback",
    AUDIO: 1,
    VIDEO: 1
  },
  preservespitch: {
    $: "preservesPitch",
    AUDIO: 1,
    VIDEO: 1
  },
  shadowrootclonable: {
    $: "shadowRootClonable",
    TEMPLATE: 1
  },
  shadowrootdelegatesfocus: {
    $: "shadowRootDelegatesFocus",
    TEMPLATE: 1
  },
  shadowrootserializable: {
    $: "shadowRootSerializable",
    TEMPLATE: 1
  },
  sharedstoragewritable: {
    $: "sharedStorageWritable",
    IFRAME: 1,
    IMG: 1
  }
});
function getPropAlias(prop, tagName) {
  const a = PropAliases[prop];
  return typeof a === "object" ? a[tagName] ? a["$"] : undefined : a;
}
const DelegatedEvents = /*#__PURE__*/new Set(["beforeinput", "click", "dblclick", "contextmenu", "focusin", "focusout", "input", "keydown", "keyup", "mousedown", "mousemove", "mouseout", "mouseover", "mouseup", "pointerdown", "pointermove", "pointerout", "pointerover", "pointerup", "touchend", "touchmove", "touchstart"]);
const SVGElements = /*#__PURE__*/new Set([
"altGlyph", "altGlyphDef", "altGlyphItem", "animate", "animateColor", "animateMotion", "animateTransform", "circle", "clipPath", "color-profile", "cursor", "defs", "desc", "ellipse", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix", "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur", "feImage", "feMerge", "feMergeNode", "feMorphology", "feOffset", "fePointLight", "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence", "filter", "font", "font-face", "font-face-format", "font-face-name", "font-face-src", "font-face-uri", "foreignObject", "g", "glyph", "glyphRef", "hkern", "image", "line", "linearGradient", "marker", "mask", "metadata", "missing-glyph", "mpath", "path", "pattern", "polygon", "polyline", "radialGradient", "rect",
"set", "stop",
"svg", "switch", "symbol", "text", "textPath",
"tref", "tspan", "use", "view", "vkern"]);
const SVGNamespace = {
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace"
};
const DOMElements = /*#__PURE__*/new Set(["html", "base", "head", "link", "meta", "style", "title", "body", "address", "article", "aside", "footer", "header", "main", "nav", "section", "body", "blockquote", "dd", "div", "dl", "dt", "figcaption", "figure", "hr", "li", "ol", "p", "pre", "ul", "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark", "q", "rp", "rt", "ruby", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "area", "audio", "img", "map", "track", "video", "embed", "iframe", "object", "param", "picture", "portal", "source", "svg", "math", "canvas", "noscript", "script", "del", "ins", "caption", "col", "colgroup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "button", "datalist", "fieldset", "form", "input", "label", "legend", "meter", "optgroup", "option", "output", "progress", "select", "textarea", "details", "dialog", "menu", "summary", "details", "slot", "template", "acronym", "applet", "basefont", "bgsound", "big", "blink", "center", "content", "dir", "font", "frame", "frameset", "hgroup", "image", "keygen", "marquee", "menuitem", "nobr", "noembed", "noframes", "plaintext", "rb", "rtc", "shadow", "spacer", "strike", "tt", "xmp", "a", "abbr", "acronym", "address", "applet", "area", "article", "aside", "audio", "b", "base", "basefont", "bdi", "bdo", "bgsound", "big", "blink", "blockquote", "body", "br", "button", "canvas", "caption", "center", "cite", "code", "col", "colgroup", "content", "data", "datalist", "dd", "del", "details", "dfn", "dialog", "dir", "div", "dl", "dt", "em", "embed", "fieldset", "figcaption", "figure", "font", "footer", "form", "frame", "frameset", "head", "header", "hgroup", "hr", "html", "i", "iframe", "image", "img", "input", "ins", "kbd", "keygen", "label", "legend", "li", "link", "main", "map", "mark", "marquee", "menu", "menuitem", "meta", "meter", "nav", "nobr", "noembed", "noframes", "noscript", "object", "ol", "optgroup", "option", "output", "p", "param", "picture", "plaintext", "portal", "pre", "progress", "q", "rb", "rp", "rt", "rtc", "ruby", "s", "samp", "script", "section", "select", "shadow", "slot", "small", "source", "spacer", "span", "strike", "strong", "style", "sub", "summary", "sup", "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "time", "title", "tr", "track", "tt", "u", "ul", "var", "video", "wbr", "xmp", "input", "h1", "h2", "h3", "h4", "h5", "h6",
"webview",
"isindex", "listing", "multicol", "nextid", "noindex", "search"]);

const memo = fn => solidJs.createMemo(() => fn());

function reconcileArrays(parentNode, a, b) {
  let bLength = b.length,
    aEnd = a.length,
    bEnd = bLength,
    aStart = 0,
    bStart = 0,
    after = a[aEnd - 1].nextSibling,
    map = null;
  while (aStart < aEnd || bStart < bEnd) {
    if (a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
      continue;
    }
    while (a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }
    if (aEnd === aStart) {
      const node = bEnd < bLength ? bStart ? b[bStart - 1].nextSibling : b[bEnd - bStart] : after;
      while (bStart < bEnd) parentNode.insertBefore(b[bStart++], node);
    } else if (bEnd === bStart) {
      while (aStart < aEnd) {
        if (!map || !map.has(a[aStart])) a[aStart].remove();
        aStart++;
      }
    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
      const node = a[--aEnd].nextSibling;
      parentNode.insertBefore(b[bStart++], a[aStart++].nextSibling);
      parentNode.insertBefore(b[--bEnd], node);
      a[aEnd] = b[bEnd];
    } else {
      if (!map) {
        map = new Map();
        let i = bStart;
        while (i < bEnd) map.set(b[i], i++);
      }
      const index = map.get(a[aStart]);
      if (index != null) {
        if (bStart < index && index < bEnd) {
          let i = aStart,
            sequence = 1,
            t;
          while (++i < aEnd && i < bEnd) {
            if ((t = map.get(a[i])) == null || t !== index + sequence) break;
            sequence++;
          }
          if (sequence > index - bStart) {
            const node = a[aStart];
            while (bStart < index) parentNode.insertBefore(b[bStart++], node);
          } else parentNode.replaceChild(b[bStart++], a[aStart++]);
        } else aStart++;
      } else a[aStart++].remove();
    }
  }
}

const $$EVENTS = "_$DX_DELEGATE";
function render(code, element, init, options = {}) {
  let disposer;
  solidJs.createRoot(dispose => {
    disposer = dispose;
    element === document ? code() : insert(element, code(), element.firstChild ? null : undefined, init);
  }, options.owner);
  return () => {
    disposer();
    element.textContent = "";
  };
}
function template(html, isImportNode, isSVG, isMathML) {
  let node;
  const create = () => {
    const t = isMathML ? document.createElementNS("http://www.w3.org/1998/Math/MathML", "template") : document.createElement("template");
    t.innerHTML = html;
    return isSVG ? t.content.firstChild.firstChild : isMathML ? t.firstChild : t.content.firstChild;
  };
  const fn = isImportNode ? () => solidJs.untrack(() => document.importNode(node || (node = create()), true)) : () => (node || (node = create())).cloneNode(true);
  fn.cloneNode = fn;
  return fn;
}
function delegateEvents(eventNames, document = window.document) {
  const e = document[$$EVENTS] || (document[$$EVENTS] = new Set());
  for (let i = 0, l = eventNames.length; i < l; i++) {
    const name = eventNames[i];
    if (!e.has(name)) {
      e.add(name);
      document.addEventListener(name, eventHandler);
    }
  }
}
function clearDelegatedEvents(document = window.document) {
  if (document[$$EVENTS]) {
    for (let name of document[$$EVENTS].keys()) document.removeEventListener(name, eventHandler);
    delete document[$$EVENTS];
  }
}
function setProperty(node, name, value) {
  if (isHydrating(node)) return;
  node[name] = value;
}
function setAttribute(node, name, value) {
  if (isHydrating(node)) return;
  if (value == null) node.removeAttribute(name);else node.setAttribute(name, value);
}
function setAttributeNS(node, namespace, name, value) {
  if (isHydrating(node)) return;
  if (value == null) node.removeAttributeNS(namespace, name);else node.setAttributeNS(namespace, name, value);
}
function setBoolAttribute(node, name, value) {
  if (isHydrating(node)) return;
  value ? node.setAttribute(name, "") : node.removeAttribute(name);
}
function className(node, value) {
  if (isHydrating(node)) return;
  if (value == null) node.removeAttribute("class");else node.className = value;
}
function addEventListener(node, name, handler, delegate) {
  if (delegate) {
    if (Array.isArray(handler)) {
      node[`$$${name}`] = handler[0];
      node[`$$${name}Data`] = handler[1];
    } else node[`$$${name}`] = handler;
  } else if (Array.isArray(handler)) {
    const handlerFn = handler[0];
    node.addEventListener(name, handler[0] = e => handlerFn.call(node, handler[1], e));
  } else node.addEventListener(name, handler, typeof handler !== "function" && handler);
}
function classList(node, value, prev = {}) {
  const classKeys = Object.keys(value || {}),
    prevKeys = Object.keys(prev);
  let i, len;
  for (i = 0, len = prevKeys.length; i < len; i++) {
    const key = prevKeys[i];
    if (!key || key === "undefined" || value[key]) continue;
    toggleClassKey(node, key, false);
    delete prev[key];
  }
  for (i = 0, len = classKeys.length; i < len; i++) {
    const key = classKeys[i],
      classValue = !!value[key];
    if (!key || key === "undefined" || prev[key] === classValue || !classValue) continue;
    toggleClassKey(node, key, true);
    prev[key] = classValue;
  }
  return prev;
}
function style(node, value, prev) {
  if (!value) return prev ? setAttribute(node, "style") : value;
  const nodeStyle = node.style;
  if (typeof value === "string") return nodeStyle.cssText = value;
  typeof prev === "string" && (nodeStyle.cssText = prev = undefined);
  prev || (prev = {});
  value || (value = {});
  let v, s;
  for (s in prev) {
    value[s] == null && nodeStyle.removeProperty(s);
    delete prev[s];
  }
  for (s in value) {
    v = value[s];
    if (v !== prev[s]) {
      nodeStyle.setProperty(s, v);
      prev[s] = v;
    }
  }
  return prev;
}
function setStyleProperty(node, name, value) {
  value != null ? node.style.setProperty(name, value) : node.style.removeProperty(name);
}
function spread(node, props = {}, isSVG, skipChildren) {
  const prevProps = {};
  if (!skipChildren) {
    solidJs.createRenderEffect(() => prevProps.children = insertExpression(node, props.children, prevProps.children));
  }
  solidJs.createRenderEffect(() => typeof props.ref === "function" && use(props.ref, node));
  solidJs.createRenderEffect(() => assign(node, props, isSVG, true, prevProps, true));
  return prevProps;
}
function dynamicProperty(props, key) {
  const src = props[key];
  Object.defineProperty(props, key, {
    get() {
      return src();
    },
    enumerable: true
  });
  return props;
}
function use(fn, element, arg) {
  return solidJs.untrack(() => fn(element, arg));
}
function insert(parent, accessor, marker, initial) {
  if (marker !== undefined && !initial) initial = [];
  if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker);
  solidJs.createRenderEffect(current => insertExpression(parent, accessor(), current, marker), initial);
}
function assign(node, props, isSVG, skipChildren, prevProps = {}, skipRef = false) {
  props || (props = {});
  for (const prop in prevProps) {
    if (!(prop in props)) {
      if (prop === "children") continue;
      prevProps[prop] = assignProp(node, prop, null, prevProps[prop], isSVG, skipRef, props);
    }
  }
  for (const prop in props) {
    if (prop === "children") {
      if (!skipChildren) insertExpression(node, props.children);
      continue;
    }
    const value = props[prop];
    prevProps[prop] = assignProp(node, prop, value, prevProps[prop], isSVG, skipRef, props);
  }
}
function hydrate$1(code, element, options = {}) {
  if (globalThis._$HY.done) return render(code, element, [...element.childNodes], options);
  solidJs.sharedConfig.completed = globalThis._$HY.completed;
  solidJs.sharedConfig.events = globalThis._$HY.events;
  solidJs.sharedConfig.load = id => globalThis._$HY.r[id];
  solidJs.sharedConfig.has = id => id in globalThis._$HY.r;
  solidJs.sharedConfig.gather = root => gatherHydratable(element, root);
  solidJs.sharedConfig.registry = new Map();
  solidJs.sharedConfig.context = {
    id: options.renderId || "",
    count: 0
  };
  try {
    gatherHydratable(element, options.renderId);
    return render(code, element, [...element.childNodes], options);
  } finally {
    solidJs.sharedConfig.context = null;
  }
}
function getNextElement(template) {
  let node,
    key,
    hydrating = isHydrating();
  if (!hydrating || !(node = solidJs.sharedConfig.registry.get(key = getHydrationKey()))) {
    return template();
  }
  if (solidJs.sharedConfig.completed) solidJs.sharedConfig.completed.add(node);
  solidJs.sharedConfig.registry.delete(key);
  return node;
}
function getNextMatch(el, nodeName) {
  while (el && el.localName !== nodeName) el = el.nextSibling;
  return el;
}
function getNextMarker(start) {
  let end = start,
    count = 0,
    current = [];
  if (isHydrating(start)) {
    while (end) {
      if (end.nodeType === 8) {
        const v = end.nodeValue;
        if (v === "$") count++;else if (v === "/") {
          if (count === 0) return [end, current];
          count--;
        }
      }
      current.push(end);
      end = end.nextSibling;
    }
  }
  return [end, current];
}
function runHydrationEvents() {
  if (solidJs.sharedConfig.events && !solidJs.sharedConfig.events.queued) {
    queueMicrotask(() => {
      const {
        completed,
        events
      } = solidJs.sharedConfig;
      if (!events) return;
      events.queued = false;
      while (events.length) {
        const [el, e] = events[0];
        if (!completed.has(el)) return;
        events.shift();
        eventHandler(e);
      }
      if (solidJs.sharedConfig.done) {
        solidJs.sharedConfig.events = _$HY.events = null;
        solidJs.sharedConfig.completed = _$HY.completed = null;
      }
    });
    solidJs.sharedConfig.events.queued = true;
  }
}
function isHydrating(node) {
  return !!solidJs.sharedConfig.context && !solidJs.sharedConfig.done && (!node || node.isConnected);
}
function toPropertyName(name) {
  return name.toLowerCase().replace(/-([a-z])/g, (_, w) => w.toUpperCase());
}
function toggleClassKey(node, key, value) {
  const classNames = key.trim().split(/\s+/);
  for (let i = 0, nameLen = classNames.length; i < nameLen; i++) node.classList.toggle(classNames[i], value);
}
function assignProp(node, prop, value, prev, isSVG, skipRef, props) {
  let isCE, isProp, isChildProp, propAlias, forceProp;
  if (prop === "style") return style(node, value, prev);
  if (prop === "classList") return classList(node, value, prev);
  if (value === prev) return prev;
  if (prop === "ref") {
    if (!skipRef) value(node);
  } else if (prop.slice(0, 3) === "on:") {
    const e = prop.slice(3);
    prev && node.removeEventListener(e, prev, typeof prev !== "function" && prev);
    value && node.addEventListener(e, value, typeof value !== "function" && value);
  } else if (prop.slice(0, 10) === "oncapture:") {
    const e = prop.slice(10);
    prev && node.removeEventListener(e, prev, true);
    value && node.addEventListener(e, value, true);
  } else if (prop.slice(0, 2) === "on") {
    const name = prop.slice(2).toLowerCase();
    const delegate = DelegatedEvents.has(name);
    if (!delegate && prev) {
      const h = Array.isArray(prev) ? prev[0] : prev;
      node.removeEventListener(name, h);
    }
    if (delegate || value) {
      addEventListener(node, name, value, delegate);
      delegate && delegateEvents([name]);
    }
  } else if (prop.slice(0, 5) === "attr:") {
    setAttribute(node, prop.slice(5), value);
  } else if (prop.slice(0, 5) === "bool:") {
    setBoolAttribute(node, prop.slice(5), value);
  } else if ((forceProp = prop.slice(0, 5) === "prop:") || (isChildProp = ChildProperties.has(prop)) || !isSVG && ((propAlias = getPropAlias(prop, node.tagName)) || (isProp = Properties.has(prop))) || (isCE = node.nodeName.includes("-") || "is" in props)) {
    if (forceProp) {
      prop = prop.slice(5);
      isProp = true;
    } else if (isHydrating(node)) return value;
    if (prop === "class" || prop === "className") className(node, value);else if (isCE && !isProp && !isChildProp) node[toPropertyName(prop)] = value;else node[propAlias || prop] = value;
  } else {
    const ns = isSVG && prop.indexOf(":") > -1 && SVGNamespace[prop.split(":")[0]];
    if (ns) setAttributeNS(node, ns, prop, value);else setAttribute(node, Aliases[prop] || prop, value);
  }
  return value;
}
function eventHandler(e) {
  if (solidJs.sharedConfig.registry && solidJs.sharedConfig.events) {
    if (solidJs.sharedConfig.events.find(([el, ev]) => ev === e)) return;
  }
  let node = e.target;
  const key = `$$${e.type}`;
  const oriTarget = e.target;
  const oriCurrentTarget = e.currentTarget;
  const retarget = value => Object.defineProperty(e, "target", {
    configurable: true,
    value
  });
  const handleNode = () => {
    const handler = node[key];
    if (handler && !node.disabled) {
      const data = node[`${key}Data`];
      data !== undefined ? handler.call(node, data, e) : handler.call(node, e);
      if (e.cancelBubble) return;
    }
    node.host && typeof node.host !== "string" && !node.host._$host && node.contains(e.target) && retarget(node.host);
    return true;
  };
  const walkUpTree = () => {
    while (handleNode() && (node = node._$host || node.parentNode || node.host));
  };
  Object.defineProperty(e, "currentTarget", {
    configurable: true,
    get() {
      return node || document;
    }
  });
  if (solidJs.sharedConfig.registry && !solidJs.sharedConfig.done) solidJs.sharedConfig.done = _$HY.done = true;
  if (e.composedPath) {
    const path = e.composedPath();
    retarget(path[0]);
    for (let i = 0; i < path.length - 2; i++) {
      node = path[i];
      if (!handleNode()) break;
      if (node._$host) {
        node = node._$host;
        walkUpTree();
        break;
      }
      if (node.parentNode === oriCurrentTarget) {
        break;
      }
    }
  }
  else walkUpTree();
  retarget(oriTarget);
}
function insertExpression(parent, value, current, marker, unwrapArray) {
  const hydrating = isHydrating(parent);
  if (hydrating) {
    !current && (current = [...parent.childNodes]);
    let cleaned = [];
    for (let i = 0; i < current.length; i++) {
      const node = current[i];
      if (node.nodeType === 8 && node.data.slice(0, 2) === "!$") node.remove();else cleaned.push(node);
    }
    current = cleaned;
  }
  while (typeof current === "function") current = current();
  if (value === current) return current;
  const t = typeof value,
    multi = marker !== undefined;
  parent = multi && current[0] && current[0].parentNode || parent;
  if (t === "string" || t === "number") {
    if (hydrating) return current;
    if (t === "number") {
      value = value.toString();
      if (value === current) return current;
    }
    if (multi) {
      let node = current[0];
      if (node && node.nodeType === 3) {
        node.data !== value && (node.data = value);
      } else node = document.createTextNode(value);
      current = cleanChildren(parent, current, marker, node);
    } else {
      if (current !== "" && typeof current === "string") {
        current = parent.firstChild.data = value;
      } else current = parent.textContent = value;
    }
  } else if (value == null || t === "boolean") {
    if (hydrating) return current;
    current = cleanChildren(parent, current, marker);
  } else if (t === "function") {
    solidJs.createRenderEffect(() => {
      let v = value();
      while (typeof v === "function") v = v();
      current = insertExpression(parent, v, current, marker);
    });
    return () => current;
  } else if (Array.isArray(value)) {
    const array = [];
    const currentArray = current && Array.isArray(current);
    if (normalizeIncomingArray(array, value, current, unwrapArray)) {
      solidJs.createRenderEffect(() => current = insertExpression(parent, array, current, marker, true));
      return () => current;
    }
    if (hydrating) {
      if (!array.length) return current;
      if (marker === undefined) return current = [...parent.childNodes];
      let node = array[0];
      if (node.parentNode !== parent) return current;
      const nodes = [node];
      while ((node = node.nextSibling) !== marker) nodes.push(node);
      return current = nodes;
    }
    if (array.length === 0) {
      current = cleanChildren(parent, current, marker);
      if (multi) return current;
    } else if (currentArray) {
      if (current.length === 0) {
        appendNodes(parent, array, marker);
      } else reconcileArrays(parent, current, array);
    } else {
      current && cleanChildren(parent);
      appendNodes(parent, array);
    }
    current = array;
  } else if (value.nodeType) {
    if (hydrating && value.parentNode) return current = multi ? [value] : value;
    if (Array.isArray(current)) {
      if (multi) return current = cleanChildren(parent, current, marker, value);
      cleanChildren(parent, current, null, value);
    } else if (current == null || current === "" || !parent.firstChild) {
      parent.appendChild(value);
    } else parent.replaceChild(value, parent.firstChild);
    current = value;
  } else ;
  return current;
}
function normalizeIncomingArray(normalized, array, current, unwrap) {
  let dynamic = false;
  for (let i = 0, len = array.length; i < len; i++) {
    let item = array[i],
      prev = current && current[normalized.length],
      t;
    if (item == null || item === true || item === false) ; else if ((t = typeof item) === "object" && item.nodeType) {
      normalized.push(item);
    } else if (Array.isArray(item)) {
      dynamic = normalizeIncomingArray(normalized, item, prev) || dynamic;
    } else if (t === "function") {
      if (unwrap) {
        while (typeof item === "function") item = item();
        dynamic = normalizeIncomingArray(normalized, Array.isArray(item) ? item : [item], Array.isArray(prev) ? prev : [prev]) || dynamic;
      } else {
        normalized.push(item);
        dynamic = true;
      }
    } else {
      const value = String(item);
      if (prev && prev.nodeType === 3 && prev.data === value) normalized.push(prev);else normalized.push(document.createTextNode(value));
    }
  }
  return dynamic;
}
function appendNodes(parent, array, marker = null) {
  for (let i = 0, len = array.length; i < len; i++) parent.insertBefore(array[i], marker);
}
function cleanChildren(parent, current, marker, replacement) {
  if (marker === undefined) return parent.textContent = "";
  const node = replacement || document.createTextNode("");
  if (current.length) {
    let inserted = false;
    for (let i = current.length - 1; i >= 0; i--) {
      const el = current[i];
      if (node !== el) {
        const isParent = el.parentNode === parent;
        if (!inserted && !i) isParent ? parent.replaceChild(node, el) : parent.insertBefore(node, marker);else isParent && el.remove();
      } else inserted = true;
    }
  } else parent.insertBefore(node, marker);
  return [node];
}
function gatherHydratable(element, root) {
  const templates = element.querySelectorAll(`*[data-hk]`);
  for (let i = 0; i < templates.length; i++) {
    const node = templates[i];
    const key = node.getAttribute("data-hk");
    if ((!root || key.startsWith(root)) && !solidJs.sharedConfig.registry.has(key)) solidJs.sharedConfig.registry.set(key, node);
  }
}
function getHydrationKey() {
  return solidJs.sharedConfig.getNextContextId();
}
function NoHydration(props) {
  return solidJs.sharedConfig.context ? undefined : props.children;
}
function Hydration(props) {
  return props.children;
}
const voidFn = () => undefined;
const RequestContext = Symbol();
function innerHTML(parent, content) {
  !solidJs.sharedConfig.context && (parent.innerHTML = content);
}

function throwInBrowser(func) {
  const err = new Error(`${func.name} is not supported in the browser, returning undefined`);
  console.error(err);
}
function renderToString(fn, options) {
  throwInBrowser(renderToString);
}
function renderToStringAsync(fn, options) {
  throwInBrowser(renderToStringAsync);
}
function renderToStream(fn, options) {
  throwInBrowser(renderToStream);
}
function ssr(template, ...nodes) {}
function ssrElement(name, props, children, needsId) {}
function ssrClassList(value) {}
function ssrStyle(value) {}
function ssrAttribute(key, value) {}
function ssrHydrationKey() {}
function resolveSSRNode(node) {}
function escape(html) {}
function ssrSpread(props, isSVG, skipChildren) {}

const isServer = false;
const isDev = false;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
function createElement(tagName, isSVG = false, is = undefined) {
  return isSVG ? document.createElementNS(SVG_NAMESPACE, tagName) : document.createElement(tagName, {
    is
  });
}
const hydrate = (...args) => {
  solidJs.enableHydration();
  return hydrate$1(...args);
};
function Portal(props) {
  const {
      useShadow
    } = props,
    marker = document.createTextNode(""),
    mount = () => props.mount || document.body,
    owner = solidJs.getOwner();
  let content;
  let hydrating = !!solidJs.sharedConfig.context;
  solidJs.createEffect(() => {
    if (hydrating) solidJs.getOwner().user = hydrating = false;
    content || (content = solidJs.runWithOwner(owner, () => solidJs.createMemo(() => props.children)));
    const el = mount();
    if (el instanceof HTMLHeadElement) {
      const [clean, setClean] = solidJs.createSignal(false);
      const cleanup = () => setClean(true);
      solidJs.createRoot(dispose => insert(el, () => !clean() ? content() : dispose(), null));
      solidJs.onCleanup(cleanup);
    } else {
      const container = createElement(props.isSVG ? "g" : "div", props.isSVG),
        renderRoot = useShadow && container.attachShadow ? container.attachShadow({
          mode: "open"
        }) : container;
      Object.defineProperty(container, "_$host", {
        get() {
          return marker.parentNode;
        },
        configurable: true
      });
      insert(renderRoot, content);
      el.appendChild(container);
      props.ref && props.ref(container);
      solidJs.onCleanup(() => el.removeChild(container));
    }
  }, undefined, {
    render: !hydrating
  });
  return marker;
}
function createDynamic(component, props) {
  const cached = solidJs.createMemo(component);
  return solidJs.createMemo(() => {
    const component = cached();
    switch (typeof component) {
      case "function":
        return solidJs.untrack(() => component(props));
      case "string":
        const isSvg = SVGElements.has(component);
        const el = solidJs.sharedConfig.context ? getNextElement() : createElement(component, isSvg, solidJs.untrack(() => props.is));
        spread(el, props, isSvg);
        return el;
    }
  });
}
function Dynamic(props) {
  const [, others] = solidJs.splitProps(props, ["component"]);
  return createDynamic(() => props.component, others);
}

Object.defineProperty(exports, "ErrorBoundary", {
  enumerable: true,
  get: function () { return solidJs.ErrorBoundary; }
});
Object.defineProperty(exports, "For", {
  enumerable: true,
  get: function () { return solidJs.For; }
});
Object.defineProperty(exports, "Index", {
  enumerable: true,
  get: function () { return solidJs.Index; }
});
Object.defineProperty(exports, "Match", {
  enumerable: true,
  get: function () { return solidJs.Match; }
});
Object.defineProperty(exports, "Show", {
  enumerable: true,
  get: function () { return solidJs.Show; }
});
Object.defineProperty(exports, "Suspense", {
  enumerable: true,
  get: function () { return solidJs.Suspense; }
});
Object.defineProperty(exports, "SuspenseList", {
  enumerable: true,
  get: function () { return solidJs.SuspenseList; }
});
Object.defineProperty(exports, "Switch", {
  enumerable: true,
  get: function () { return solidJs.Switch; }
});
Object.defineProperty(exports, "createComponent", {
  enumerable: true,
  get: function () { return solidJs.createComponent; }
});
Object.defineProperty(exports, "effect", {
  enumerable: true,
  get: function () { return solidJs.createRenderEffect; }
});
Object.defineProperty(exports, "getOwner", {
  enumerable: true,
  get: function () { return solidJs.getOwner; }
});
Object.defineProperty(exports, "mergeProps", {
  enumerable: true,
  get: function () { return solidJs.mergeProps; }
});
Object.defineProperty(exports, "untrack", {
  enumerable: true,
  get: function () { return solidJs.untrack; }
});
exports.Aliases = Aliases;
exports.Assets = voidFn;
exports.ChildProperties = ChildProperties;
exports.DOMElements = DOMElements;
exports.DelegatedEvents = DelegatedEvents;
exports.Dynamic = Dynamic;
exports.Hydration = Hydration;
exports.HydrationScript = voidFn;
exports.NoHydration = NoHydration;
exports.Portal = Portal;
exports.Properties = Properties;
exports.RequestContext = RequestContext;
exports.SVGElements = SVGElements;
exports.SVGNamespace = SVGNamespace;
exports.addEventListener = addEventListener;
exports.assign = assign;
exports.classList = classList;
exports.className = className;
exports.clearDelegatedEvents = clearDelegatedEvents;
exports.createDynamic = createDynamic;
exports.delegateEvents = delegateEvents;
exports.dynamicProperty = dynamicProperty;
exports.escape = escape;
exports.generateHydrationScript = voidFn;
exports.getAssets = voidFn;
exports.getHydrationKey = getHydrationKey;
exports.getNextElement = getNextElement;
exports.getNextMarker = getNextMarker;
exports.getNextMatch = getNextMatch;
exports.getPropAlias = getPropAlias;
exports.getRequestEvent = voidFn;
exports.hydrate = hydrate;
exports.innerHTML = innerHTML;
exports.insert = insert;
exports.isDev = isDev;
exports.isServer = isServer;
exports.memo = memo;
exports.render = render;
exports.renderToStream = renderToStream;
exports.renderToString = renderToString;
exports.renderToStringAsync = renderToStringAsync;
exports.resolveSSRNode = resolveSSRNode;
exports.runHydrationEvents = runHydrationEvents;
exports.setAttribute = setAttribute;
exports.setAttributeNS = setAttributeNS;
exports.setBoolAttribute = setBoolAttribute;
exports.setProperty = setProperty;
exports.setStyleProperty = setStyleProperty;
exports.spread = spread;
exports.ssr = ssr;
exports.ssrAttribute = ssrAttribute;
exports.ssrClassList = ssrClassList;
exports.ssrElement = ssrElement;
exports.ssrHydrationKey = ssrHydrationKey;
exports.ssrSpread = ssrSpread;
exports.ssrStyle = ssrStyle;
exports.style = style;
exports.template = template;
exports.use = use;
exports.useAssets = voidFn;
