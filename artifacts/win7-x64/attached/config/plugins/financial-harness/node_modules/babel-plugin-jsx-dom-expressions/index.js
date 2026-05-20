'use strict';

var SyntaxJSX = require('@babel/plugin-syntax-jsx');
var t = require('@babel/types');
var helperModuleImports = require('@babel/helper-module-imports');
var htmlEntities = require('html-entities');

function _interopNamespaceDefault(e) {
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n.default = e;
  return Object.freeze(n);
}

var t__namespace = /*#__PURE__*/_interopNamespaceDefault(t);

// list of lowercase booleans
const booleans = [
"allowfullscreen",
"async",
"alpha", // HTMLInputElement
"autofocus", // HTMLElement prop
"autoplay",
"checked",
"controls",
"default",
"disabled",
"formnovalidate",
"hidden", // HTMLElement prop - not a boolean
"indeterminate",
"inert", // HTMLElement prop
"ismap",
"loop",
"multiple",
"muted",
"nomodule",
"novalidate",
"open",
"playsinline",
"readonly",
"required",
"reversed",
"seamless", // HTMLIframeElement - non-standard
"selected",

"adauctionheaders", // experimental
"browsingtopics", // experimental
"credentialless", // experimental
"defaultchecked",
"defaultmuted",
"defaultselected",
"defer",
"disablepictureinpicture",
"disableremoteplayback",
"preservespitch", // appears as camelCase property only (not as attribute)
"shadowrootclonable",
"shadowrootcustomelementregistry", // experimental - doesnt seem to have a prop yet
"shadowrootdelegatesfocus",
"shadowrootserializable", // experimental
"sharedstoragewritable" // experimental
];

const BooleanAttributes = /*#__PURE__*/new Set(booleans);

const Properties = /*#__PURE__*/new Set([
// locked to properties
"className",
"value",

// booleans with camelCase
"readOnly",
"noValidate",
"formNoValidate",
"isMap",
"noModule",
"playsInline",

"adAuctionHeaders", // experimental
"allowFullscreen",
"browsingTopics", // experimental
"defaultChecked",
"defaultMuted",
"defaultSelected",
"disablePictureInPicture",
"disableRemotePlayback",
"preservesPitch",
"shadowRootClonable",
"shadowRootCustomElementRegistry", // experimental
"shadowRootDelegatesFocus",
"shadowRootSerializable", // experimental
"sharedStorageWritable", // experimental

...booleans]);


const ChildProperties = /*#__PURE__*/new Set([
"innerHTML",
"textContent",
"innerText",
"children"]);


// React Compat
const Aliases = /*#__PURE__*/Object.assign(Object.create(null), {
  className: "class",
  htmlFor: "for"
});

const PropAliases = /*#__PURE__*/Object.assign(Object.create(null), {
  // locked to properties
  class: "className",

  // booleans map
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

// list of Element events that will be delegated
const DelegatedEvents = /*#__PURE__*/new Set([
"beforeinput",
"click",
"dblclick",
"contextmenu",
"focusin",
"focusout",
"input",
"keydown",
"keyup",
"mousedown",
"mousemove",
"mouseout",
"mouseover",
"mouseup",
"pointerdown",
"pointermove",
"pointerout",
"pointerover",
"pointerup",
"touchend",
"touchmove",
"touchstart"]);


const SVGElements = /*#__PURE__*/new Set([
// "a",
"altGlyph",
"altGlyphDef",
"altGlyphItem",
"animate",
"animateColor",
"animateMotion",
"animateTransform",
"circle",
"clipPath",
"color-profile",
"cursor",
"defs",
"desc",
"ellipse",
"feBlend",
"feColorMatrix",
"feComponentTransfer",
"feComposite",
"feConvolveMatrix",
"feDiffuseLighting",
"feDisplacementMap",
"feDistantLight",
"feDropShadow",
"feFlood",
"feFuncA",
"feFuncB",
"feFuncG",
"feFuncR",
"feGaussianBlur",
"feImage",
"feMerge",
"feMergeNode",
"feMorphology",
"feOffset",
"fePointLight",
"feSpecularLighting",
"feSpotLight",
"feTile",
"feTurbulence",
"filter",
"font",
"font-face",
"font-face-format",
"font-face-name",
"font-face-src",
"font-face-uri",
"foreignObject",
"g",
"glyph",
"glyphRef",
"hkern",
"image",
"line",
"linearGradient",
"marker",
"mask",
"metadata",
"missing-glyph",
"mpath",
"path",
"pattern",
"polygon",
"polyline",
"radialGradient",
"rect",
// "script",
"set",
"stop",
// "style",
"svg",
"switch",
"symbol",
"text",
"textPath",
// "title",
"tref",
"tspan",
"use",
"view",
"vkern"]);


const SVGNamespace = {
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace"
};

var VoidElements = [
'area',
'base',
'br',
'col',
'embed',
'hr',
'img',
'input',
'keygen',
'link',
'menuitem',
'meta',
'param',
'source',
'track',
'wbr'];

const reservedNameSpaces = new Set([
"class",
"on",
"oncapture",
"style",
"use",
"prop",
"attr",
"bool"]);


const nonSpreadNameSpaces = new Set(["class", "style", "use", "prop", "attr", "bool"]);

function getConfig(path) {
  return path.hub.file.metadata.config;
}

const getRendererConfig = (path, renderer) => {
  const config = getConfig(path);
  return config?.renderers?.find((r) => r.name === renderer) ?? config;
};

function registerImportMethod(path, name, moduleName) {
  const imports =
  path.scope.getProgramParent().data.imports || (
  path.scope.getProgramParent().data.imports = new Map());
  moduleName = moduleName || getConfig(path).moduleName;
  if (!imports.has(`${moduleName}:${name}`)) {
    let id = helperModuleImports.addNamed(path, name, moduleName, {
      nameHint: `_$${name}`
    });
    imports.set(`${moduleName}:${name}`, id);
    return id;
  } else {
    let iden = imports.get(`${moduleName}:${name}`);
    // the cloning is required to play well with babel-preset-env which is
    // transpiling import as we add them and using the same identifier causes
    // problems with the multiple identifiers of the same thing
    return t__namespace.cloneNode(iden);
  }
}

function jsxElementNameToString(node) {
  if (t__namespace.isJSXMemberExpression(node)) {
    return `${jsxElementNameToString(node.object)}.${node.property.name}`;
  }
  if (t__namespace.isJSXIdentifier(node) || t__namespace.isIdentifier(node)) {
    return node.name;
  }
  return `${node.namespace.name}:${node.name.name}`;
}

function getTagName(tag) {
  const jsxName = tag.openingElement.name;
  return jsxElementNameToString(jsxName);
}

function isComponent(tagName) {
  return (
    tagName[0] && tagName[0].toLowerCase() !== tagName[0] ||
    tagName.includes(".") ||
    /[^a-zA-Z]/.test(tagName[0]));

}

function hasStaticMarker(object, path) {
  if (!object) return false;
  if (
  object.leadingComments &&
  object.leadingComments[0] &&
  object.leadingComments[0].value.trim() === getConfig(path).staticMarker)

  return true;
  if (object.expression) return hasStaticMarker(object.expression, path);
}

function isDynamic(path, { checkMember, checkTags, checkCallExpressions = true, native }) {
  const config = getConfig(path);
  if (config.generate === "ssr" && native) {
    checkMember = false;
    checkCallExpressions = false;
  }
  const expr = path.node;
  if (t__namespace.isFunction(expr)) return false;
  if (
  expr.leadingComments &&
  expr.leadingComments[0] &&
  expr.leadingComments[0].value.trim() === config.staticMarker)
  {
    return false;
  }

  if (
  checkCallExpressions && (
  t__namespace.isCallExpression(expr) ||
  t__namespace.isOptionalCallExpression(expr) ||
  t__namespace.isTaggedTemplateExpression(expr)))
  {
    return true;
  }

  if (checkMember && t__namespace.isMemberExpression(expr)) {
    // Do not assume property access on namespaced imports as dynamic.
    const object = path.get("object").node;

    if (
    t__namespace.isIdentifier(object) && (
    !expr.computed ||
    !isDynamic(path.get("property"), {
      checkMember,
      checkTags,
      checkCallExpressions,
      native
    })))
    {
      const binding = path.scope.getBinding(object.name);

      if (binding && binding.path.isImportNamespaceSpecifier()) {
        return false;
      }
    }

    return true;
  }

  if (
  checkMember && (
  t__namespace.isOptionalMemberExpression(expr) ||
  t__namespace.isSpreadElement(expr) ||
  t__namespace.isBinaryExpression(expr) && expr.operator === "in"))
  {
    return true;
  }

  if (checkTags && (t__namespace.isJSXElement(expr) || t__namespace.isJSXFragment(expr) && expr.children.length)) {
    return true;
  }

  let dynamic;
  path.traverse({
    Function(p) {
      if (t__namespace.isObjectMethod(p.node) && p.node.computed) {
        dynamic = isDynamic(p.get("key"), { checkMember, checkTags, checkCallExpressions, native });
      }
      p.skip();
    },
    CallExpression(p) {
      checkCallExpressions && (dynamic = true) && p.stop();
    },
    OptionalCallExpression(p) {
      checkCallExpressions && (dynamic = true) && p.stop();
    },
    MemberExpression(p) {
      checkMember && (dynamic = true) && p.stop();
    },
    OptionalMemberExpression(p) {
      checkMember && (dynamic = true) && p.stop();
    },
    SpreadElement(p) {
      checkMember && (dynamic = true) && p.stop();
    },
    BinaryExpression(p) {
      checkMember && p.node.operator === "in" && (dynamic = true) && p.stop();
    },
    JSXElement(p) {
      checkTags ? (dynamic = true) && p.stop() : p.skip();
    },
    JSXFragment(p) {
      checkTags && p.node.children.length ? (dynamic = true) && p.stop() : p.skip();
    }
  });
  return dynamic;
}

function getStaticExpression(path) {
  const node = path.node;
  let value, type;
  return (
    t__namespace.isJSXExpressionContainer(node) &&
    t__namespace.isJSXElement(path.parent) &&
    !isComponent(getTagName(path.parent)) &&
    !t__namespace.isSequenceExpression(node.expression) &&
    (value = path.get("expression").evaluate().value) !== undefined && (
    (type = typeof value) === "string" || type === "number") &&
    value);

}

// remove unnecessary JSX Text nodes
function filterChildren(children) {
  return children.filter(
  ({ node: child }) =>
  !(t__namespace.isJSXExpressionContainer(child) && t__namespace.isJSXEmptyExpression(child.expression)) && (
  !t__namespace.isJSXText(child) || !/^[\r\n]\s*$/.test(child.extra.raw)));

}

function checkLength(children) {
  let i = 0;
  children.forEach((path) => {
    const child = path.node;
    !(t__namespace.isJSXExpressionContainer(child) && t__namespace.isJSXEmptyExpression(child.expression)) && (
    !t__namespace.isJSXText(child) || !/^\s*$/.test(child.extra.raw) || /^ *$/.test(child.extra.raw)) &&
    i++;
  });
  return i > 1;
}

function trimWhitespace(text) {
  text = text.replace(/\r/g, "");
  if (/\n/g.test(text)) {
    text = text.
    split("\n").
    map((t, i) => i ? t.replace(/^\s*/g, "") : t).
    filter((s) => !/^\s*$/.test(s)).
    join(" ");
  }
  return text.replace(/\s+/g, " ");
}

function toEventName(name) {
  return name.slice(2).toLowerCase();
}

function toPropertyName(name) {
  return name.toLowerCase().replace(/-([a-z])/g, (_, w) => w.toUpperCase());
}

function wrappedByText(list, startIndex) {
  let index = startIndex,
    wrapped;
  while (--index >= 0) {
    const node = list[index];
    if (!node) continue;
    if (node.text) {
      wrapped = true;
      break;
    }
    if (node.id) return false;
  }
  if (!wrapped) return false;
  index = startIndex;
  while (++index < list.length) {
    const node = list[index];
    if (!node) continue;
    if (node.text) return true;
    if (node.id) return false;
  }
  return false;
}

function transformCondition(path, inline, deep) {
  const config = getConfig(path);
  const expr = path.node;
  const memo = registerImportMethod(path, config.memoWrapper);
  let dTest, cond, id;
  if (
  t__namespace.isConditionalExpression(expr) && (
  isDynamic(path.get("consequent"), {
    checkTags: true,
    checkMember: true
  }) ||
  isDynamic(path.get("alternate"), { checkTags: true, checkMember: true })))
  {
    dTest = isDynamic(path.get("test"), { checkMember: true });
    if (dTest) {
      cond = expr.test;
      if (!t__namespace.isBinaryExpression(cond))
      cond = t__namespace.unaryExpression("!", t__namespace.unaryExpression("!", cond, true), true);
      id = inline ?
      t__namespace.callExpression(memo, [t__namespace.arrowFunctionExpression([], cond)]) :
      path.scope.generateUidIdentifier("_c$");
      expr.test = t__namespace.callExpression(id, []);
      if (t__namespace.isConditionalExpression(expr.consequent) || t__namespace.isLogicalExpression(expr.consequent)) {
        expr.consequent = transformCondition(path.get("consequent"), true, true);
      }
      if (t__namespace.isConditionalExpression(expr.alternate) || t__namespace.isLogicalExpression(expr.alternate)) {
        expr.alternate = transformCondition(path.get("alternate"), true, true);
      }
    }
  } else if (t__namespace.isLogicalExpression(expr)) {
    let nextPath = path;
    // handle top-level or, ie cond && <A/> || <B/>
    while (nextPath.node.operator !== "&&" && t__namespace.isLogicalExpression(nextPath.node.left)) {
      nextPath = nextPath.get("left");
    }
    nextPath.node.operator === "&&" &&
    isDynamic(nextPath.get("right"), { checkTags: true, checkMember: true }) && (
    dTest = isDynamic(nextPath.get("left"), {
      checkMember: true
    }));
    if (dTest) {
      cond = nextPath.node.left;
      if (!t__namespace.isBinaryExpression(cond))
      cond = t__namespace.unaryExpression("!", t__namespace.unaryExpression("!", cond, true), true);
      id = inline ?
      t__namespace.callExpression(memo, [t__namespace.arrowFunctionExpression([], cond)]) :
      path.scope.generateUidIdentifier("_c$");
      nextPath.node.left = t__namespace.callExpression(id, []);
    }
  }
  if (dTest && !inline) {
    const statements = [
    t__namespace.variableDeclaration("var", [
    t__namespace.variableDeclarator(
    id,
    config.memoWrapper ?
    t__namespace.callExpression(memo, [t__namespace.arrowFunctionExpression([], cond)]) :
    t__namespace.arrowFunctionExpression([], cond))]),


    t__namespace.arrowFunctionExpression([], expr)];

    return deep ?
    t__namespace.callExpression(
    t__namespace.arrowFunctionExpression(
    [],
    t__namespace.blockStatement([statements[0], t__namespace.returnStatement(statements[1])])),

    []) :

    statements;
  }
  return deep ? expr : t__namespace.arrowFunctionExpression([], expr);
}

function escapeHTML(s, attr) {
  if (typeof s !== "string") return s;
  const delim = attr ? '"' : "<";
  const escDelim = attr ? "&quot;" : "&lt;";
  let iDelim = s.indexOf(delim);
  let iAmp = s.indexOf("&");

  if (iDelim < 0 && iAmp < 0) return s;

  let left = 0,
    out = "";

  while (iDelim >= 0 && iAmp >= 0) {
    if (iDelim < iAmp) {
      if (left < iDelim) out += s.substring(left, iDelim);
      out += escDelim;
      left = iDelim + 1;
      iDelim = s.indexOf(delim, left);
    } else {
      if (left < iAmp) out += s.substring(left, iAmp);
      out += "&amp;";
      left = iAmp + 1;
      iAmp = s.indexOf("&", left);
    }
  }

  if (iDelim >= 0) {
    do {
      if (left < iDelim) out += s.substring(left, iDelim);
      out += escDelim;
      left = iDelim + 1;
      iDelim = s.indexOf(delim, left);
    } while (iDelim >= 0);
  } else {
    while (iAmp >= 0) {
      if (left < iAmp) out += s.substring(left, iAmp);
      out += "&amp;";
      left = iAmp + 1;
      iAmp = s.indexOf("&", left);
    }
  }

  return left < s.length ? out + s.substring(left) : out;
}

function convertJSXIdentifier(node) {
  if (t__namespace.isJSXIdentifier(node)) {
    if (t__namespace.isValidIdentifier(node.name)) {
      node.type = "Identifier";
    } else {
      return t__namespace.stringLiteral(node.name);
    }
  } else if (t__namespace.isJSXMemberExpression(node)) {
    return t__namespace.memberExpression(
    convertJSXIdentifier(node.object),
    convertJSXIdentifier(node.property));

  } else if (t__namespace.isJSXNamespacedName(node)) {
    return t__namespace.stringLiteral(`${node.namespace.name}:${node.name.name}`);
  }

  return node;
}

function canNativeSpread(key, { checkNameSpaces } = {}) {
  if (checkNameSpaces && key.includes(":") && nonSpreadNameSpaces.has(key.split(":")[0]))
  return false;
  // TODO: figure out how to detect definitely function ref
  if (key === "ref") return false;
  return true;
}

const chars = "etaoinshrdlucwmfygpbTAOISWCBvkxjqzPHFMDRELNGUKVYJQZX_$";
const base = chars.length;

function getNumberedId(num) {
  let out = "";

  do {
    const digit = num % base;

    num = Math.floor(num / base);
    out = chars[digit] + out;
  } while (num !== 0);

  return out;
}

function escapeStringForTemplate(str) {
  return str.replace(/[{\\`\n\t\b\f\v\r\u2028\u2029]/g, (ch) => templateEscapes.get(ch));
}

const templateEscapes = new Map([
["{", "\\{"],
["`", "\\`"],
["\\", "\\\\"],
["\n", "\\n"],
["\t", "\\t"],
["\b", "\\b"],
["\f", "\\f"],
["\v", "\\v"],
["\r", "\\r"],
["\u2028", "\\u2028"],
["\u2029", "\\u2029"]]);


function evaluateAndInline(value, valueNode) {
  if (t__namespace.isJSXExpressionContainer(value)) {
    evaluateAndInline(value.expression, valueNode.get("expression"));
  } else if (t__namespace.isObjectProperty(value)) {
    evaluateAndInline(value.value, valueNode.get("value"));
  } else if (
  t__namespace.isStringLiteral(value) ||
  t__namespace.isNumericLiteral(value) ||
  t__namespace.isBooleanLiteral(value) ||
  t__namespace.isNullLiteral(value))
  ; else if (t__namespace.isObjectExpression(value)) {const properties = value.properties;
    const propertiesNode = valueNode.get("properties");
    for (let i = 0; i < properties.length; i++) {
      evaluateAndInline(properties[i], propertiesNode[i]);
    }
  } else {
    const r = valueNode.evaluate();
    if (r.confident) {
      if (typeof r.value === "string") {
        valueNode.replaceWith(t__namespace.stringLiteral(r.value));
      } else if (typeof r.value === "number") {
        valueNode.replaceWith(t__namespace.numericLiteral(r.value));
      } else if (typeof r.value === "boolean") {
        valueNode.replaceWith(t__namespace.booleanLiteral(r.value));
      }
    }
  }
}

const InlineElements = [
"a",
"abbr",
"acronym",
"b",
"bdi",
"bdo",
"big",
"br",
"button",
"canvas",
"cite",
"code",
"data",
"datalist",
"del",
"dfn",
"em",
"embed",
"i",
"iframe",
"img",
"input",
"ins",
"kbd",
"label",
"map",
"mark",
"meter",
"noscript",
"object",
"output",
"picture",
"progress",
"q",
"ruby",
"s",
"samp",
"script",
"select",
"slot",
"small",
"span",
"strong",
"sub",
"sup",
"svg",
"template",
"textarea",
"time",
"u",
"tt",
"var",
"video"];


const BlockElements = [
"address",
"article",
"aside",
"blockquote",
"dd",
"details",
"dialog",
"div",
"dl",
"dt",
"fieldset",
"figcaption",
"figure",
"footer",
"form",
"h1",
"h2",
"h3",
"h4",
"h5",
"h6",
"header",
"hgroup",
"hr",
"li",
"main",
"menu",
"nav",
"ol",
"p",
"pre",
"section",
"table",
"ul"];

const alwaysClose = [
"title",
"style",
"a",
"strong",
"small",
"b",
"u",
"i",
"em",
"s",
"code",
"object",
"table",
"button",
"textarea",
"select",
"iframe",
"script",
"noscript",
"template",
"fieldset"];


function transformElement$3(path, info) {
  path.
  get("openingElement").
  get("attributes").
  forEach((attr) => {
    evaluateAndInline(attr.node.value, attr.get("value"));
  });

  let tagName = getTagName(path.node),
    config = getConfig(path),
    wrapSVG = info.topLevel && tagName != "svg" && SVGElements.has(tagName),
    voidTag = VoidElements.indexOf(tagName) > -1,
    isCustomElement =
    tagName.indexOf("-") > -1 ||
    path.
    get("openingElement").
    get("attributes").
    some((a) => a.node?.name?.name === "is" || a.name?.name === "is"),
    isImportNode =
    (tagName === "img" || tagName === "iframe") &&
    path.
    get("openingElement").
    get("attributes").
    some((a) => a.node.name?.name === "loading"),
    results = {
      template: `<${tagName}`,
      templateWithClosingTags: `<${tagName}`,
      declarations: [],
      exprs: [],
      dynamics: [],
      postExprs: [],
      isSVG: wrapSVG,
      hasCustomElement: isCustomElement,
      isImportNode,
      tagName,
      renderer: "dom",
      skipTemplate: false
    };

  if (!config.inlineStyles) {
    path.
    get("openingElement").
    get("attributes").
    forEach((a) => {
      if (a.node.name?.name === "style") {
        let value = a.node.value.expression ? a.node.value.expression : a.node.value;
        if (t__namespace.isStringLiteral(value)) {
          // jsx attribute value is a sting that may takes more than one line
          value = t__namespace.templateLiteral(
          [t__namespace.templateElement({ raw: value.value, cooked: value.value })],
          []);

        }
        a.get("value").replaceWith(
        t__namespace.jSXExpressionContainer(t__namespace.callExpression(t__namespace.arrowFunctionExpression([], value), [])));

      }
    });
  }

  path.
  get("openingElement").
  get("attributes").
  some((a) => {
    if (a.node.name?.name === "data-hk") {
      a.remove();
      let filename = "";
      try {
        filename = path.scope.getProgramParent().path.hub.file.opts.filename;
      } catch (e) {}

      console.log(
      "\n" +
      path.
      buildCodeFrameError(
      `"data-hk" attribute found in template, which could potentially cause hydration miss-matches. Usually happens when copying and pasting Solid SSRed code into JSX. Please remove the attribute from the JSX. \n\n${filename}\n`).

      toString());

    }
  });
  if (config.hydratable && (tagName === "html" || tagName === "head" || tagName === "body")) {
    results.skipTemplate = true;
    if (tagName === "head" && info.topLevel) {
      const createComponent = registerImportMethod(
      path,
      "createComponent",
      getRendererConfig(path, "dom").moduleName);

      const NoHydration = registerImportMethod(
      path,
      "NoHydration",
      getRendererConfig(path, "dom").moduleName);

      results.exprs.push(
      t__namespace.expressionStatement(
      t__namespace.callExpression(createComponent, [NoHydration, t__namespace.objectExpression([])])));


      return results;
    }
  }
  if (wrapSVG) {
    results.template = "<svg>" + results.template;
    results.templateWithClosingTags = "<svg>" + results.templateWithClosingTags;
  }
  if (!info.skipId) {
    results.id = path.scope.generateUidIdentifier("el$");
  }
  transformAttributes$2(path, results);
  if (config.contextToCustomElements && (tagName === "slot" || isCustomElement)) {
    contextToCustomElement(path, results);
  }
  results.template += ">";
  results.templateWithClosingTags += ">";
  if (!voidTag) {
    // always close tags can still be skipped if they have no closing parents and are the last element
    const toBeClosed =
    !info.lastElement ||
    !config.omitLastClosingTag ||
    info.toBeClosed && (!config.omitNestedClosingTags || info.toBeClosed.has(tagName));
    if (toBeClosed) {
      results.toBeClosed = new Set(info.toBeClosed || alwaysClose);
      results.toBeClosed.add(tagName);
      if (InlineElements.includes(tagName)) BlockElements.forEach((i) => results.toBeClosed.add(i));
    } else results.toBeClosed = info.toBeClosed;
    if (tagName !== "noscript") transformChildren$2(path, results, config);
    if (toBeClosed) results.template += `</${tagName}>`;
    results.templateWithClosingTags += `</${tagName}>`;
  }
  if (info.topLevel && config.hydratable && results.hasHydratableEvent) {
    let runHydrationEvents = registerImportMethod(
    path,
    "runHydrationEvents",
    getRendererConfig(path, "dom").moduleName);

    results.postExprs.push(t__namespace.expressionStatement(t__namespace.callExpression(runHydrationEvents, [])));
  }
  if (wrapSVG) {
    results.template += "</svg>";
    results.templateWithClosingTags += "</svg>";
  }
  return results;
}

function setAttr$2(path, elem, name, value, { isSVG, dynamic, prevId, isCE, tagName }) {
  // pull out namespace
  const config = getConfig(path);
  let parts, namespace;
  if ((parts = name.split(":")) && parts[1] && reservedNameSpaces.has(parts[0])) {
    name = parts[1];
    namespace = parts[0];
  }

  if (namespace === "style") {
    const setStyleProperty = registerImportMethod(
    path,
    "setStyleProperty",
    getRendererConfig(path, "dom").moduleName);


    return t__namespace.callExpression(setStyleProperty, [
    elem,
    t__namespace.stringLiteral(name),
    t__namespace.isAssignmentExpression(value) && t__namespace.isIdentifier(value.left) ? value.right : value]);

  }

  if (namespace === "class") {
    return t__namespace.callExpression(
    t__namespace.memberExpression(
    t__namespace.memberExpression(elem, t__namespace.identifier("classList")),
    t__namespace.identifier("toggle")),

    [
    t__namespace.stringLiteral(name),
    dynamic ? value : t__namespace.unaryExpression("!", t__namespace.unaryExpression("!", value))]);


  }

  if (name === "style") {
    return t__namespace.callExpression(
    registerImportMethod(path, "style", getRendererConfig(path, "dom").moduleName),
    prevId ? [elem, value, prevId] : [elem, value]);

  }

  if (!isSVG && name === "class") {
    return t__namespace.callExpression(
    registerImportMethod(path, "className", getRendererConfig(path, "dom").moduleName),
    [elem, value]);

  }

  if (name === "classList") {
    return t__namespace.callExpression(
    registerImportMethod(path, "classList", getRendererConfig(path, "dom").moduleName),
    prevId ? [elem, value, prevId] : [elem, value]);

  }

  if (dynamic && name === "textContent") {
    if (config.hydratable) {
      return t__namespace.callExpression(registerImportMethod(path, "setProperty"), [
      elem,
      t__namespace.stringLiteral("data"),
      value]);

    }
    return t__namespace.assignmentExpression("=", t__namespace.memberExpression(elem, t__namespace.identifier("data")), value);
  }

  if (namespace === "bool") {
    return t__namespace.callExpression(
    registerImportMethod(path, "setBoolAttribute", getRendererConfig(path, "dom").moduleName),
    [elem, t__namespace.stringLiteral(name), value]);

  }

  const isChildProp = ChildProperties.has(name);
  const isProp = Properties.has(name);
  const alias = getPropAlias(name, tagName.toUpperCase());
  if (namespace !== "attr" && (isChildProp || !isSVG && isProp || isCE || namespace === "prop")) {
    if (isCE && !isChildProp && !isProp && namespace !== "prop") name = toPropertyName(name);
    if (config.hydratable && namespace !== "prop") {
      return t__namespace.callExpression(registerImportMethod(path, "setProperty"), [
      elem,
      t__namespace.stringLiteral(alias || name),
      value]);

    }
    return t__namespace.assignmentExpression(
    "=",
    t__namespace.memberExpression(elem, t__namespace.identifier(alias || name)),
    value);

  }

  let isNameSpaced = name.indexOf(":") > -1;
  name = Aliases[name] || name;
  !isSVG && (name = name.toLowerCase());
  const ns = isNameSpaced && SVGNamespace[name.split(":")[0]];
  if (ns) {
    return t__namespace.callExpression(
    registerImportMethod(path, "setAttributeNS", getRendererConfig(path, "dom").moduleName),
    [elem, t__namespace.stringLiteral(ns), t__namespace.stringLiteral(name), value]);

  } else {
    return t__namespace.callExpression(
    registerImportMethod(path, "setAttribute", getRendererConfig(path, "dom").moduleName),
    [elem, t__namespace.stringLiteral(name), value]);

  }
}

function detectResolvableEventHandler(attribute, handler) {
  while (t__namespace.isIdentifier(handler)) {
    const lookup = attribute.scope.getBinding(handler.name);
    if (lookup) {
      if (t__namespace.isVariableDeclarator(lookup.path.node)) {
        handler = lookup.path.node.init;
      } else if (t__namespace.isFunctionDeclaration(lookup.path.node)) {
        return true;
      } else return false;
    } else return false;
  }
  return t__namespace.isFunction(handler);
}

function transformAttributes$2(path, results) {
  let elem = results.id,
    hasHydratableEvent = false,
    children,
    spreadExpr,
    attributes = path.get("openingElement").get("attributes");
  const tagName = getTagName(path.node),
    isSVG = SVGElements.has(tagName),
    isCE = tagName.includes("-") || attributes.some((a) => a.node.name?.name === "is"),
    hasChildren = path.node.children.length > 0,
    config = getConfig(path);

  // preprocess spreads
  if (attributes.some((attribute) => t__namespace.isJSXSpreadAttribute(attribute.node))) {
    [attributes, spreadExpr] = processSpreads$1(path, attributes, {
      elem,
      isSVG,
      hasChildren,
      wrapConditionals: config.wrapConditionals
    });
    path.get("openingElement").set(
    "attributes",
    attributes.map((a) => a.node));

    //NOTE: can't be checked at compile time so add to compiled output
    hasHydratableEvent = true;
  }

  /**
   * Inline styles
   *
   * 1. When string
   * 2. When is an object, the key is a string, and value is string/numeric
   * 3. Remove properties from object when value is undefined/null
   * 4. When `value.evaluate().confident`
   *
   * Also, when `key` is computed value is also `value.evaluate().confident`
   */

  attributes = path.get("openingElement").get("attributes");

  const styleAttributes = attributes.filter((a) => a.node.name && a.node.name.name === "style");
  if (styleAttributes.length > 0) {
    let inlinedStyle = "";

    for (let i = 0; i < styleAttributes.length; i++) {
      const attr = styleAttributes[i];

      let value = attr.node.value;
      const node = attr.get("value");
      if (t__namespace.isJSXExpressionContainer(value)) {
        value = value.expression;
      }

      if (t__namespace.isStringLiteral(value)) {
        inlinedStyle += `${value.value.replace(/;$/, "")};`;
        attr.remove();
      } else if (t__namespace.isObjectExpression(value)) {
        const properties = value.properties;
        const propertiesNode = node.get("expression").get("properties");
        const toRemoveProperty = [];
        for (let i = 0; i < properties.length; i++) {
          const property = properties[i];

          if (property.computed) {
            /* { [computed]: `${1+1}px` } => { [computed]: `2px` } */
            const r = propertiesNode[i].get("value").evaluate();
            if (r.confident && (typeof r.value === "string" || typeof r.value === "number")) {
              property.value = t__namespace.inherits(t__namespace.stringLiteral(`${r.value}`), property.value);
            }
            // computed cannot be inlined - maybe can be evaluated but this is pretty rare
            continue;
          }

          if (t__namespace.isObjectProperty(property)) {
            const key = t__namespace.isIdentifier(property.key) ? property.key.name : property.key.value;
            if (t__namespace.isStringLiteral(property.value) || t__namespace.isNumericLiteral(property.value)) {
              inlinedStyle += `${key}:${property.value.value};`;
              toRemoveProperty.push(property);
            } else if (
            t__namespace.isIdentifier(property.value) && property.value.name === "undefined" ||
            t__namespace.isNullLiteral(property.value))
            {
              toRemoveProperty.push(property);
            } else {
              const r = propertiesNode[i].get("value").evaluate();
              if (r.confident && (typeof r.value === "string" || typeof r.value === "number")) {
                inlinedStyle += `${key}:${r.value};`;
                toRemoveProperty.push(property);
              }
            }
          }
        }
        for (const remove of toRemoveProperty) {
          value.properties.splice(value.properties.indexOf(remove), 1);
        }
        if (value.properties.length === 0) {
          attr.remove();
        }
      }
    }

    if (inlinedStyle !== "") {
      const styleAttribute = t__namespace.jsxAttribute(
      t__namespace.jsxIdentifier("style"),
      t__namespace.stringLiteral(inlinedStyle.replace(/;$/, "")));

      path.get("openingElement").node.attributes.push(styleAttribute);
    }
  }

  // preprocess styles
  const styleAttribute = path.
  get("openingElement").
  get("attributes").
  find(
  (a) =>
  a.node.name &&
  a.node.name.name === "style" &&
  t__namespace.isJSXExpressionContainer(a.node.value) &&
  t__namespace.isObjectExpression(a.node.value.expression) &&
  !a.node.value.expression.properties.some((p) => t__namespace.isSpreadElement(p)));

  if (styleAttribute) {
    let i = 0,
      leading = styleAttribute.node.value.expression.leadingComments;
    styleAttribute.node.value.expression.properties.slice().forEach((p, index) => {
      if (!p.computed) {
        if (leading) p.value.leadingComments = leading;
        path.
        get("openingElement").
        node.attributes.splice(
        styleAttribute.key + ++i,
        0,
        t__namespace.jsxAttribute(
        t__namespace.jsxNamespacedName(
        t__namespace.jsxIdentifier("style"),
        t__namespace.jsxIdentifier(t__namespace.isIdentifier(p.key) ? p.key.name : p.key.value)),

        t__namespace.jsxExpressionContainer(p.value)));


        styleAttribute.node.value.expression.properties.splice(index - i - 1, 1);
      }
    });
    if (!styleAttribute.node.value.expression.properties.length)
    path.get("openingElement").node.attributes.splice(styleAttribute.key, 1);
  }

  // preprocess classList
  attributes = path.get("openingElement").get("attributes");
  const classListAttribute = attributes.find(
  (a) =>
  a.node.name &&
  a.node.name.name === "classList" &&
  t__namespace.isJSXExpressionContainer(a.node.value) &&
  t__namespace.isObjectExpression(a.node.value.expression) &&
  !a.node.value.expression.properties.some(
  (p) =>
  t__namespace.isSpreadElement(p) ||
  p.computed ||
  t__namespace.isStringLiteral(p.key) && (p.key.value.includes(" ") || p.key.value.includes(":"))));


  if (classListAttribute) {
    let i = 0,
      leading = classListAttribute.node.value.expression.leadingComments,
      classListProperties = classListAttribute.get("value").get("expression").get("properties");
    classListProperties.slice().forEach((propPath, index) => {
      const p = propPath.node;
      const { confident, value: computed } = propPath.get("value").evaluate();
      if (leading) p.value.leadingComments = leading;
      if (!confident) {
        path.
        get("openingElement").
        node.attributes.splice(
        classListAttribute.key + ++i,
        0,
        t__namespace.jsxAttribute(
        t__namespace.jsxNamespacedName(
        t__namespace.jsxIdentifier("class"),
        t__namespace.jsxIdentifier(t__namespace.isIdentifier(p.key) ? p.key.name : p.key.value)),

        t__namespace.jsxExpressionContainer(p.value)));


      } else if (computed) {
        path.
        get("openingElement").
        node.attributes.splice(
        classListAttribute.key + ++i,
        0,
        t__namespace.jsxAttribute(
        t__namespace.jsxIdentifier("class"),
        t__namespace.stringLiteral(t__namespace.isIdentifier(p.key) ? p.key.name : p.key.value)));


      }
      classListProperties.splice(index - i - 1, 1);
    });
    if (!classListProperties.length)
    path.get("openingElement").node.attributes.splice(classListAttribute.key, 1);
  }

  // combine class properties
  attributes = path.get("openingElement").get("attributes");
  const classAttributes = attributes.filter(
  (a) => a.node.name && (a.node.name.name === "class" || a.node.name.name === "className"));

  if (classAttributes.length > 1) {
    const first = classAttributes[0].node,
      values = [],
      quasis = [t__namespace.templateElement({ raw: "" })];
    for (let i = 0; i < classAttributes.length; i++) {
      const attr = classAttributes[i].node,
        isLast = i === classAttributes.length - 1;
      if (!t__namespace.isJSXExpressionContainer(attr.value)) {
        const prev = quasis.pop();
        quasis.push(
        t__namespace.templateElement({
          raw: (prev ? prev.value.raw : "") + `${attr.value.value}` + (isLast ? "" : " ")
        }));

      } else {
        values.push(t__namespace.logicalExpression("||", attr.value.expression, t__namespace.stringLiteral("")));
        quasis.push(t__namespace.templateElement({ raw: isLast ? "" : " " }));
      }
      i && attributes.splice(attributes.indexOf(classAttributes[i]), 1);
    }
    if (values.length) first.value = t__namespace.jsxExpressionContainer(t__namespace.templateLiteral(quasis, values));else
    first.value = t__namespace.stringLiteral(quasis[0].value.raw);
  }
  path.get("openingElement").set(
  "attributes",
  attributes.map((a) => a.node));


  let needsSpacing = true;

  // scoped because of `needsSpacing`
  function inlineAttributeOnTemplate(isSVG, key, results, value) {
    !isSVG && (key = key.toLowerCase());
    results.template += `${needsSpacing ? " " : ""}${key}`;

    if (!value) {
      needsSpacing = true;
      return;
    }

    let text = value.value;
    if (typeof text === "number") text = String(text);
    let needsQuoting = !config.omitQuotes;

    if (key === "style" || key === "class") {
      text = trimWhitespace(text);
      if (key === "style") {
        text = text.replace(/; /g, ";").replace(/: /g, ":");
      }
    }

    if (!text.length) {
      needsSpacing = true;
      results.template += ``;
      return;
    }

    for (let i = 0, len = text.length; i < len; i++) {
      let char = text[i];

      if (
      char === "'" ||
      char === '"' ||
      char === " " ||
      char === "\t" ||
      char === "\n" ||
      char === "\r" ||
      char === "`" ||
      char === "=" ||
      char === "<" ||
      char === ">")
      {
        needsQuoting = true;
      }
    }

    if (needsQuoting) {
      needsSpacing = false;
      results.template += `="${escapeHTML(text, true)}"`;
    } else {
      needsSpacing = true;
      results.template += `=${escapeHTML(text, true)}`;
    }
  }

  path.
  get("openingElement").
  get("attributes").
  forEach((attribute) => {
    const node = attribute.node;
    let value = node.value,
      key = t__namespace.isJSXNamespacedName(node.name) ?
      `${node.name.namespace.name}:${node.name.name.name}` :
      node.name.name,
      reservedNameSpace =
      t__namespace.isJSXNamespacedName(node.name) && reservedNameSpaces.has(node.name.namespace.name);
    if (t__namespace.isJSXExpressionContainer(value) && !key.startsWith("use:")) {
      const evaluated = attribute.get("value").get("expression").evaluate().value;
      let type;
      if (
      evaluated !== undefined && (
      (type = typeof evaluated) === "string" || type === "number"))
      {
        if (type === "number" && (Properties.has(key) || key.startsWith("prop:"))) {
          value = t__namespace.jsxExpressionContainer(t__namespace.numericLiteral(evaluated));
        } else value = t__namespace.stringLiteral(String(evaluated));
      }
    }
    if (
    t__namespace.isJSXNamespacedName(node.name) &&
    reservedNameSpace &&
    !t__namespace.isJSXExpressionContainer(value))
    {
      node.value = value = t__namespace.jsxExpressionContainer(value || t__namespace.jsxEmptyExpression());
    }
    if (
    t__namespace.isJSXExpressionContainer(value) && (
    reservedNameSpace ||
    !(t__namespace.isStringLiteral(value.expression) || t__namespace.isNumericLiteral(value.expression))))
    {
      if (key === "ref") {
        // Normalize expressions for non-null and type-as
        while (
        t__namespace.isTSNonNullExpression(value.expression) ||
        t__namespace.isTSAsExpression(value.expression))
        {
          value.expression = value.expression.expression;
        }
        let binding,
          isConstant =
          t__namespace.isIdentifier(value.expression) && (
          binding = path.scope.getBinding(value.expression.name)) && (
          binding.kind === "const" || binding.kind === "module");
        if (!isConstant && t__namespace.isLVal(value.expression)) {
          const refIdentifier = path.scope.generateUidIdentifier("_ref$");
          results.exprs.unshift(
          t__namespace.variableDeclaration("var", [t__namespace.variableDeclarator(refIdentifier, value.expression)]),
          t__namespace.expressionStatement(
          t__namespace.conditionalExpression(
          t__namespace.binaryExpression(
          "===",
          t__namespace.unaryExpression("typeof", refIdentifier),
          t__namespace.stringLiteral("function")),

          t__namespace.callExpression(
          registerImportMethod(path, "use", getRendererConfig(path, "dom").moduleName),
          [refIdentifier, elem]),

          t__namespace.assignmentExpression("=", value.expression, elem))));



        } else if (isConstant || t__namespace.isFunction(value.expression)) {
          results.exprs.unshift(
          t__namespace.expressionStatement(
          t__namespace.callExpression(
          registerImportMethod(path, "use", getRendererConfig(path, "dom").moduleName),
          [value.expression, elem])));



        } else {
          const refIdentifier = path.scope.generateUidIdentifier("_ref$");
          results.exprs.unshift(
          t__namespace.variableDeclaration("var", [t__namespace.variableDeclarator(refIdentifier, value.expression)]),
          t__namespace.expressionStatement(
          t__namespace.logicalExpression(
          "&&",
          t__namespace.binaryExpression(
          "===",
          t__namespace.unaryExpression("typeof", refIdentifier),
          t__namespace.stringLiteral("function")),

          t__namespace.callExpression(
          registerImportMethod(path, "use", getRendererConfig(path, "dom").moduleName),
          [refIdentifier, elem]))));




        }
      } else if (key.startsWith("use:")) {
        // Some trick to treat JSXIdentifier as Identifier
        node.name.name.type = "Identifier";
        results.exprs.unshift(
        t__namespace.expressionStatement(
        t__namespace.callExpression(
        registerImportMethod(path, "use", getRendererConfig(path, "dom").moduleName),
        [
        node.name.name,
        elem,
        t__namespace.arrowFunctionExpression(
        [],
        t__namespace.isJSXEmptyExpression(value.expression) ?
        t__namespace.booleanLiteral(true) :
        value.expression)])));





      } else if (key === "children") {
        children = value;
      } else if (key.startsWith("on")) {
        const ev = toEventName(key);
        if (key.startsWith("on:")) {
          const args = [elem, t__namespace.stringLiteral(key.split(":")[1]), value.expression];

          results.exprs.unshift(
          t__namespace.expressionStatement(
          t__namespace.callExpression(
          registerImportMethod(
          path,
          "addEventListener",
          getRendererConfig(path, "dom").moduleName),

          args)));



        } else if (key.startsWith("oncapture:")) {
          // deprecated see above condition
          const args = [
          t__namespace.stringLiteral(key.split(":")[1]),
          value.expression,
          t__namespace.booleanLiteral(true)];

          results.exprs.push(
          t__namespace.expressionStatement(
          t__namespace.callExpression(t__namespace.memberExpression(elem, t__namespace.identifier("addEventListener")), args)));


        } else if (
        config.delegateEvents && (
        DelegatedEvents.has(ev) || config.delegatedEvents.indexOf(ev) !== -1))
        {
          // can only hydrate delegated events
          hasHydratableEvent = true;
          const events =
          attribute.scope.getProgramParent().data.events || (
          attribute.scope.getProgramParent().data.events = new Set());
          events.add(ev);
          let handler = value.expression;
          const resolveable = detectResolvableEventHandler(attribute, handler);
          if (t__namespace.isArrayExpression(handler)) {
            if (handler.elements.length > 1) {
              results.exprs.unshift(
              t__namespace.expressionStatement(
              t__namespace.assignmentExpression(
              "=",
              t__namespace.memberExpression(elem, t__namespace.identifier(`$$${ev}Data`)),
              handler.elements[1])));



            }
            handler = handler.elements[0];
            results.exprs.unshift(
            t__namespace.expressionStatement(
            t__namespace.assignmentExpression(
            "=",
            t__namespace.memberExpression(elem, t__namespace.identifier(`$$${ev}`)),
            handler)));



          } else if (t__namespace.isFunction(handler) || resolveable) {
            results.exprs.unshift(
            t__namespace.expressionStatement(
            t__namespace.assignmentExpression(
            "=",
            t__namespace.memberExpression(elem, t__namespace.identifier(`$$${ev}`)),
            handler)));



          } else {
            results.exprs.unshift(
            t__namespace.expressionStatement(
            t__namespace.callExpression(
            registerImportMethod(
            path,
            "addEventListener",
            getRendererConfig(path, "dom").moduleName),

            [elem, t__namespace.stringLiteral(ev), handler, t__namespace.booleanLiteral(true)])));



          }
        } else {
          let handler = value.expression;
          const resolveable = detectResolvableEventHandler(attribute, handler);
          if (t__namespace.isArrayExpression(handler)) {
            if (handler.elements.length > 1) {
              handler = t__namespace.arrowFunctionExpression(
              [t__namespace.identifier("e")],
              t__namespace.callExpression(handler.elements[0], [handler.elements[1], t__namespace.identifier("e")]));

            } else handler = handler.elements[0];
            results.exprs.unshift(
            t__namespace.expressionStatement(
            t__namespace.callExpression(t__namespace.memberExpression(elem, t__namespace.identifier("addEventListener")), [
            t__namespace.stringLiteral(ev),
            handler])));



          } else if (t__namespace.isFunction(handler) || resolveable) {
            results.exprs.unshift(
            t__namespace.expressionStatement(
            t__namespace.callExpression(t__namespace.memberExpression(elem, t__namespace.identifier("addEventListener")), [
            t__namespace.stringLiteral(ev),
            handler])));



          } else {
            results.exprs.unshift(
            t__namespace.expressionStatement(
            t__namespace.callExpression(
            registerImportMethod(
            path,
            "addEventListener",
            getRendererConfig(path, "dom").moduleName),

            [elem, t__namespace.stringLiteral(ev), handler])));



          }
        }
      } else if (
      config.effectWrapper && (
      isDynamic(attribute.get("value").get("expression"), {
        checkMember: true
      }) ||
      (key === "classList" || key === "style") &&
      !attribute.get("value").get("expression").evaluate().confident &&
      !hasStaticMarker(value, path)))
      {
        /*
          Following code doesn't repect static marker `@once`.
          https://github.com/ryansolid/dom-expressions/pull/438
          ||
          (
              (
                  key === "classList" || key === "style") &&
                  !attribute.get("value").get("expression").evaluate().confident
              )
          )
         */

        let nextElem = elem;
        if (key === "value" || key === "checked") {
          const effectWrapperId = registerImportMethod(path, config.effectWrapper);
          results.postExprs.push(
          t__namespace.expressionStatement(
          t__namespace.callExpression(effectWrapperId, [
          t__namespace.arrowFunctionExpression(
          [],
          setAttr$2(path, elem, key, value.expression, {
            tagName,
            isSVG,
            isCE
          }))])));




          return;
        }
        if (key === "textContent") {
          nextElem = attribute.scope.generateUidIdentifier("el$");
          children = t__namespace.jsxText(" ");
          children.extra = { raw: " ", rawValue: " " };
          results.declarations.push(
          t__namespace.variableDeclarator(nextElem, t__namespace.memberExpression(elem, t__namespace.identifier("firstChild"))));

        }
        results.dynamics.push({
          elem: nextElem,
          key,
          value: value.expression,
          isSVG,
          isCE,
          tagName
        });
      } else if (key.slice(0, 5) === "attr:") {
        if (t__namespace.isJSXExpressionContainer(value)) value = value.expression;

        if (t__namespace.isStringLiteral(value) || t__namespace.isNumericLiteral(value)) {
          // inlined  "attr:"
          inlineAttributeOnTemplate(isSVG, key.slice(5), results, value);
        } else {
          // dynamic "attr:"
          results.exprs.push(
          t__namespace.expressionStatement(setAttr$2(attribute, elem, key, value, { isSVG, isCE, tagName })));

        }
      } else if (key.slice(0, 5) === "bool:") {
        // inline it on the template when possible
        let content = value;

        if (t__namespace.isJSXExpressionContainer(content)) content = content.expression;

        function addBoolAttribute() {
          results.template += `${needsSpacing ? " " : ""}${key.slice(5)}`;
          needsSpacing = true;
        }

        switch (content.type) {
          case "StringLiteral":{
              if (content.value.length && content.value !== "0") {
                addBoolAttribute();
              }
              return;
            }
          case "NullLiteral":{
              return;
            }
          case "BooleanLiteral":{
              if (content.value) {
                addBoolAttribute();
              }
              return;
            }
          case "Identifier":{
              if (content.name === "undefined") {
                return;
              }
              break;
            }}


        // when not possible to inline it in the template
        results.exprs.push(
        t__namespace.expressionStatement(
        setAttr$2(
        attribute,
        elem,
        key,
        t__namespace.isJSXExpressionContainer(value) ? value.expression : value,
        { isSVG, isCE, tagName })));



      } else {
        results.exprs.push(
        t__namespace.expressionStatement(
        setAttr$2(attribute, elem, key, value.expression, { isSVG, isCE, tagName })));


      }
    } else {
      if (config.hydratable && key === "$ServerOnly") {
        results.skipTemplate = true;
        return;
      }
      if (t__namespace.isJSXExpressionContainer(value)) value = value.expression;

      // properties
      key = Aliases[key] || key;
      if (value && ChildProperties.has(key)) {
        results.exprs.push(
        t__namespace.expressionStatement(setAttr$2(attribute, elem, key, value, { isSVG, isCE, tagName })));

      } else {
        inlineAttributeOnTemplate(isSVG, key, results, value);
      }
    }
  });
  if (!hasChildren && children) {
    path.node.children.push(children);
  }
  if (spreadExpr) results.exprs.push(spreadExpr);

  results.hasHydratableEvent = results.hasHydratableEvent || hasHydratableEvent;
}

function findLastElement(children, hydratable) {
  let lastElement = -1,
    tagName;
  for (let i = children.length - 1; i >= 0; i--) {
    const node = children[i].node;
    if (
    hydratable ||
    t__namespace.isJSXText(node) ||
    getStaticExpression(children[i]) !== false ||
    t__namespace.isJSXElement(node) && (tagName = getTagName(node)) && !isComponent(tagName))
    {
      lastElement = i;
      break;
    }
  }
  return lastElement;
}

function transformChildren$2(path, results, config) {
  let tempPath = results.id && results.id.name,
    tagName = getTagName(path.node),
    nextPlaceholder,
    childPostExprs = [],
    i = 0;
  const filteredChildren = filterChildren(path.get("children")),
    lastElement = findLastElement(filteredChildren, config.hydratable),
    childNodes = filteredChildren.reduce((memo, child, index) => {
      if (child.isJSXFragment()) {
        throw new Error(
        `Fragments can only be used top level in JSX. Not used under a <${tagName}>.`);

      }
      const transformed = transformNode(child, {
        toBeClosed: results.toBeClosed,
        lastElement: index === lastElement,
        skipId: !results.id || !detectExpressions(filteredChildren, index, config)
      });
      if (!transformed) return memo;
      const i = memo.length;
      if (transformed.text && i && memo[i - 1].text) {
        memo[i - 1].template += transformed.template;
        memo[i - 1].templateWithClosingTags +=
        transformed.templateWithClosingTags || transformed.template;
      } else memo.push(transformed);
      return memo;
    }, []);

  childNodes.forEach((child, index) => {
    if (!child) return;
    if (child.tagName && child.renderer !== "dom") {
      throw new Error(`<${child.tagName}> is not supported in <${tagName}>.
      Wrap the usage with a component that would render this element, eg. Canvas`);
    }

    results.template += child.template;
    results.templateWithClosingTags += child.templateWithClosingTags || child.template;
    results.isImportNode = results.isImportNode || child.isImportNode;

    if (child.id) {
      if (child.tagName === "head") {
        if (config.hydratable) {
          const createComponent = registerImportMethod(
          path,
          "createComponent",
          getRendererConfig(path, "dom").moduleName);

          const NoHydration = registerImportMethod(
          path,
          "NoHydration",
          getRendererConfig(path, "dom").moduleName);

          results.exprs.push(
          t__namespace.expressionStatement(
          t__namespace.callExpression(createComponent, [NoHydration, t__namespace.objectExpression([])])));


        }
        return;
      }

      let getNextMatch;
      if (config.hydratable && tagName === "html") {
        getNextMatch = registerImportMethod(
        path,
        "getNextMatch",
        getRendererConfig(path, "dom").moduleName);

      }
      const walk = t__namespace.memberExpression(
      t__namespace.identifier(tempPath),
      t__namespace.identifier(i === 0 ? "firstChild" : "nextSibling"));

      results.declarations.push(
      t__namespace.variableDeclarator(
      child.id,
      config.hydratable && tagName === "html" ?
      t__namespace.callExpression(getNextMatch, [walk, t__namespace.stringLiteral(child.tagName)]) :
      walk));


      results.declarations.push(...child.declarations);
      results.exprs.push(...child.exprs);
      results.dynamics.push(...child.dynamics);
      childPostExprs.push(...child.postExprs);
      results.hasHydratableEvent = results.hasHydratableEvent || child.hasHydratableEvent;
      results.hasCustomElement = results.hasCustomElement || child.hasCustomElement;
      results.isImportNode = results.isImportNode || child.isImportNode;
      tempPath = child.id.name;
      nextPlaceholder = null;
      i++;
    } else if (child.exprs.length) {
      let insert = registerImportMethod(path, "insert", getRendererConfig(path, "dom").moduleName);
      const multi = checkLength(filteredChildren),
        markers = config.hydratable && multi;
      // boxed by textNodes
      if (markers || wrappedByText(childNodes, index)) {
        let exprId, contentId;
        if (markers) tempPath = createPlaceholder(path, results, tempPath, i++, "$")[0].name;
        if (nextPlaceholder) {
          exprId = nextPlaceholder;
        } else {
          [exprId, contentId] = createPlaceholder(path, results, tempPath, i++, markers ? "/" : "");
        }
        if (!markers) nextPlaceholder = exprId;
        results.exprs.push(
        t__namespace.expressionStatement(
        t__namespace.callExpression(
        insert,
        contentId ?
        [results.id, child.exprs[0], exprId, contentId] :
        [results.id, child.exprs[0], exprId])));



        tempPath = exprId.name;
      } else if (multi) {
        results.exprs.push(
        t__namespace.expressionStatement(
        t__namespace.callExpression(insert, [
        results.id,
        child.exprs[0],
        nextChild$1(childNodes, index) || t__namespace.nullLiteral()])));



      } else {
        results.exprs.push(
        t__namespace.expressionStatement(t__namespace.callExpression(insert, [results.id, child.exprs[0]])));

      }
    } else nextPlaceholder = null;
  });
  results.postExprs.unshift(...childPostExprs);
}

function createPlaceholder(path, results, tempPath, i, char) {
  const exprId = path.scope.generateUidIdentifier("el$"),
    config = getConfig(path);
  let contentId;
  results.template += `<!${char}>`;
  results.templateWithClosingTags += `<!${char}>`;
  if (config.hydratable && char === "/") {
    contentId = path.scope.generateUidIdentifier("co$");
    results.declarations.push(
    t__namespace.variableDeclarator(
    t__namespace.arrayPattern([exprId, contentId]),
    t__namespace.callExpression(
    registerImportMethod(path, "getNextMarker", getRendererConfig(path, "dom").moduleName),
    [t__namespace.memberExpression(t__namespace.identifier(tempPath), t__namespace.identifier("nextSibling"))])));



  } else
  results.declarations.push(
  t__namespace.variableDeclarator(
  exprId,
  t__namespace.memberExpression(
  t__namespace.identifier(tempPath),
  t__namespace.identifier(i === 0 ? "firstChild" : "nextSibling"))));



  return [exprId, contentId];
}

function nextChild$1(children, index) {
  return children[index + 1] && (children[index + 1].id || nextChild$1(children, index + 1));
}

// reduce unnecessary refs
function detectExpressions(children, index, config) {
  if (children[index - 1]) {
    const node = children[index - 1].node;
    if (
    t__namespace.isJSXExpressionContainer(node) &&
    !t__namespace.isJSXEmptyExpression(node.expression) &&
    getStaticExpression(children[index - 1]) === false)

    return true;
    let tagName;
    if (t__namespace.isJSXElement(node) && (tagName = getTagName(node)) && isComponent(tagName)) return true;
  }
  for (let i = index; i < children.length; i++) {
    const child = children[i].node;
    if (t__namespace.isJSXExpressionContainer(child)) {
      if (!t__namespace.isJSXEmptyExpression(child.expression) && getStaticExpression(children[i]) === false)
      return true;
    } else if (t__namespace.isJSXElement(child)) {
      const tagName = getTagName(child);
      if (isComponent(tagName)) return true;
      if (
      config.contextToCustomElements && (
      tagName === "slot" ||
      tagName.indexOf("-") > -1 ||
      child.openingElement.attributes.some((a) => a.name?.name === "is")))

      return true;
      if (
      child.openingElement.attributes.some(
      (attr) =>
      t__namespace.isJSXSpreadAttribute(attr) ||
      ["textContent", "innerHTML", "innerText"].includes(attr.name.name) ||
      attr.name.namespace && (
      attr.name.namespace.name === "use" || attr.name.namespace.name === "prop") ||
      t__namespace.isJSXExpressionContainer(attr.value) &&
      !(
      t__namespace.isStringLiteral(attr.value.expression) ||
      t__namespace.isNumericLiteral(attr.value.expression))))



      return true;
      const nextChildren = filterChildren(children[i].get("children"));
      if (nextChildren.length) if (detectExpressions(nextChildren, 0, config)) return true;
    }
  }
}

function contextToCustomElement(path, results) {
  results.exprs.push(
  t__namespace.expressionStatement(
  t__namespace.assignmentExpression(
  "=",
  t__namespace.memberExpression(results.id, t__namespace.identifier("_$owner")),
  t__namespace.callExpression(
  registerImportMethod(path, "getOwner", getRendererConfig(path, "dom").moduleName),
  []))));




}

function processSpreads$1(path, attributes, { elem, isSVG, hasChildren, wrapConditionals }) {
  const config = getConfig(path);
  // TODO: skip but collect the names of any properties after the last spread to not overwrite them
  const filteredAttributes = [];
  const spreadArgs = [];
  let runningObject = [];
  let dynamicSpread = false;
  let firstSpread = false;
  attributes.forEach((attribute) => {
    const node = attribute.node;
    const key =
    !t__namespace.isJSXSpreadAttribute(node) && (
    t__namespace.isJSXNamespacedName(node.name) ?
    `${node.name.namespace.name}:${node.name.name.name}` :
    node.name.name);
    if (t__namespace.isJSXSpreadAttribute(node)) {
      const isStatic =
      node.innerComments &&
      node.innerComments[0] &&
      node.innerComments[0].value.trim() === config.staticMarker;

      firstSpread = true;
      if (runningObject.length) {
        spreadArgs.push(t__namespace.objectExpression(runningObject));
        runningObject = [];
      }

      const s =
      isDynamic(attribute.get("argument"), {
        checkMember: true
      }) && (dynamicSpread = true) ?
      t__namespace.isCallExpression(node.argument) &&
      !node.argument.arguments.length &&
      !t__namespace.isCallExpression(node.argument.callee) &&
      !t__namespace.isMemberExpression(node.argument.callee) ?
      node.argument.callee :
      t__namespace.arrowFunctionExpression([], node.argument) :
      node.argument;

      spreadArgs.push(isStatic ? t__namespace.objectExpression([t__namespace.spreadElement(s)]) : s);
    } else if (
    (firstSpread ||
    t__namespace.isJSXExpressionContainer(node.value) &&
    isDynamic(attribute.get("value").get("expression"), { checkMember: true })) &&
    canNativeSpread(key, { checkNameSpaces: true }))
    {
      const isContainer = t__namespace.isJSXExpressionContainer(node.value);
      const dynamic =
      isContainer && isDynamic(attribute.get("value").get("expression"), { checkMember: true });
      if (dynamic) {
        const id = convertJSXIdentifier(node.name);
        let expr =
        wrapConditionals && (
        t__namespace.isLogicalExpression(node.value.expression) ||
        t__namespace.isConditionalExpression(node.value.expression)) ?
        transformCondition(attribute.get("value").get("expression"), true) :
        t__namespace.arrowFunctionExpression([], node.value.expression);
        runningObject.push(
        t__namespace.objectMethod(
        "get",
        id,
        [],
        t__namespace.blockStatement([t__namespace.returnStatement(expr.body)]),
        !t__namespace.isValidIdentifier(key)));


      } else {
        runningObject.push(
        t__namespace.objectProperty(
        t__namespace.stringLiteral(key),
        isContainer ?
        node.value.expression :
        node.value || (Properties.has(key) ? t__namespace.booleanLiteral(true) : t__namespace.stringLiteral(""))));


      }
    } else filteredAttributes.push(attribute);
  });

  if (runningObject.length) {
    spreadArgs.push(t__namespace.objectExpression(runningObject));
  }

  const props =
  spreadArgs.length === 1 && !dynamicSpread ?
  spreadArgs[0] :
  t__namespace.callExpression(registerImportMethod(path, "mergeProps"), spreadArgs);

  return [
  filteredAttributes,
  t__namespace.expressionStatement(
  t__namespace.callExpression(
  registerImportMethod(path, "spread", getRendererConfig(path, "dom").moduleName),
  [elem, props, t__namespace.booleanLiteral(isSVG), t__namespace.booleanLiteral(hasChildren)]))];



}

function createTemplate$2(path, result, wrap) {
  const config = getConfig(path);
  if (result.id) {
    registerTemplate(path, result);
    if (
    !(result.exprs.length || result.dynamics.length || result.postExprs.length) &&
    result.decl.declarations.length === 1)
    {
      return result.decl.declarations[0].init;
    } else {
      return t__namespace.callExpression(
      t__namespace.arrowFunctionExpression(
      [],
      t__namespace.blockStatement([
      result.decl,
      ...result.exprs.concat(
      wrapDynamics$1(path, result.dynamics) || [],
      result.postExprs || []),

      t__namespace.returnStatement(result.id)])),


      []);

    }
  }
  if (wrap && result.dynamic && config.memoWrapper) {
    return t__namespace.callExpression(registerImportMethod(path, config.memoWrapper), [result.exprs[0]]);
  }
  return result.exprs[0];
}

function appendTemplates$1(path, templates) {
  const declarators = templates.map((template) => {
    const tmpl = {
      cooked: template.template,
      raw: escapeStringForTemplate(template.template)
    };

    const shouldUseImportNode = template.isCE || template.isImportNode;
    const isMathML =
    /^<(math|annotation|annotation-xml|maction|math|merror|mfrac|mi|mmultiscripts|mn|mo|mover|mpadded|mphantom|mprescripts|mroot|mrow|ms|mspace|msqrt|mstyle|msub|msubsup|msup|mtable|mtd|mtext|mtr|munder|munderover|semantics|menclose|mfenced)(\s|>)/.test(
    template.template);


    return t__namespace.variableDeclarator(
    template.id,
    t__namespace.addComment(
    t__namespace.callExpression(
    registerImportMethod(path, "template", getRendererConfig(path, "dom").moduleName),
    [t__namespace.templateLiteral([t__namespace.templateElement(tmpl, true)], [])].concat(
    template.isSVG || shouldUseImportNode || isMathML ?
    [
    t__namespace.booleanLiteral(!!shouldUseImportNode),
    t__namespace.booleanLiteral(template.isSVG),
    t__namespace.booleanLiteral(isMathML)] :

    [])),


    "leading",
    "#__PURE__"));


  });
  path.node.body.unshift(t__namespace.variableDeclaration("var", declarators));
}

function registerTemplate(path, results) {
  const { hydratable } = getConfig(path);
  let decl;
  if (results.template.length) {
    let templateDef, templateId;
    if (!results.skipTemplate) {
      const templates =
      path.scope.getProgramParent().data.templates || (
      path.scope.getProgramParent().data.templates = []);
      if (templateDef = templates.find((t) => t.template === results.template)) {
        templateId = templateDef.id;
      } else {
        templateId = path.scope.generateUidIdentifier("tmpl$");
        templates.push({
          id: templateId,
          template: results.template,
          templateWithClosingTags: results.templateWithClosingTags,
          isSVG: results.isSVG,
          isCE: results.hasCustomElement,
          isImportNode: results.isImportNode,
          renderer: "dom"
        });
      }
    }
    decl = t__namespace.variableDeclarator(
    results.id,
    hydratable ?
    t__namespace.callExpression(
    registerImportMethod(path, "getNextElement", getRendererConfig(path, "dom").moduleName),
    templateId ? [templateId] : []) :

    t__namespace.callExpression(templateId, []));

  }
  results.declarations.unshift(decl);
  results.decl = t__namespace.variableDeclaration("var", results.declarations);
}

function wrapDynamics$1(path, dynamics) {
  if (!dynamics.length) return;
  const config = getConfig(path);

  const effectWrapperId = registerImportMethod(path, config.effectWrapper);

  if (dynamics.length === 1) {
    let dynamicStyle;
    const prevValue =
    dynamics[0].key === "classList" ||
    dynamics[0].key === "style" || (
    dynamicStyle = dynamics[0].key.startsWith("style:")) ?
    t__namespace.identifier("_$p") :
    undefined;
    if (dynamicStyle) {
      dynamics[0].value = t__namespace.assignmentExpression("=", prevValue, dynamics[0].value);
    } else if (
    dynamics[0].key.startsWith("class:") &&
    !t__namespace.isBooleanLiteral(dynamics[0].value) &&
    !t__namespace.isUnaryExpression(dynamics[0].value))
    {
      dynamics[0].value = t__namespace.unaryExpression("!", t__namespace.unaryExpression("!", dynamics[0].value));
    }

    return t__namespace.expressionStatement(
    t__namespace.callExpression(effectWrapperId, [
    t__namespace.arrowFunctionExpression(
    prevValue ? [prevValue] : [],
    setAttr$2(path, dynamics[0].elem, dynamics[0].key, dynamics[0].value, {
      isSVG: dynamics[0].isSVG,
      isCE: dynamics[0].isCE,
      tagName: dynamics[0].tagName,
      dynamic: true,
      prevId: prevValue
    }))]));



  }

  const prevId = t__namespace.identifier("_p$");

  /** @type {t.VariableDeclarator[]} */
  const declarations = [];
  /** @type {t.ExpressionStatement[]} */
  const statements = [];
  /** @type {t.Identifier[]} */
  const properties = [];

  dynamics.forEach(({ elem, key, value, isSVG, isCE, tagName }, index) => {
    const varIdent = path.scope.generateUidIdentifier("v$");

    const propIdent = t__namespace.identifier(getNumberedId(index));
    const propMember = t__namespace.memberExpression(prevId, propIdent);

    if (key.startsWith("class:") && !t__namespace.isBooleanLiteral(value) && !t__namespace.isUnaryExpression(value)) {
      value = t__namespace.unaryExpression("!", t__namespace.unaryExpression("!", value));
    }

    properties.push(propIdent);
    declarations.push(t__namespace.variableDeclarator(varIdent, value));

    if (key === "classList" || key === "style") {
      statements.push(
      t__namespace.expressionStatement(
      t__namespace.assignmentExpression(
      "=",
      propMember,
      setAttr$2(path, elem, key, varIdent, {
        isSVG,
        isCE,
        tagName,
        dynamic: true,
        prevId: propMember
      }))));



    } else {
      const prev = key.startsWith("style:") ? varIdent : undefined;
      statements.push(
      t__namespace.expressionStatement(
      t__namespace.logicalExpression(
      "&&",
      t__namespace.binaryExpression("!==", varIdent, propMember),
      setAttr$2(path, elem, key, t__namespace.assignmentExpression("=", propMember, varIdent), {
        isSVG,
        isCE,
        tagName,
        dynamic: true,
        prevId: prev
      }))));



    }
  });

  return t__namespace.expressionStatement(
  t__namespace.callExpression(effectWrapperId, [
  t__namespace.arrowFunctionExpression(
  [prevId],
  t__namespace.blockStatement([
  t__namespace.variableDeclaration("var", declarations),
  ...statements,
  t__namespace.returnStatement(prevId)])),


  t__namespace.objectExpression(properties.map((id) => t__namespace.objectProperty(id, t__namespace.identifier("undefined"))))]));


}

function createTemplate$1(path, result) {
  if (!result.template) {
    return result.exprs[0];
  }

  let template, id;

  if (!Array.isArray(result.template)) {
    template = t__namespace.stringLiteral(result.template);
  } else if (result.template.length === 1) {
    template = t__namespace.stringLiteral(result.template[0]);
  } else {
    const strings = result.template.map((tmpl) => t__namespace.stringLiteral(tmpl));
    template = t__namespace.arrayExpression(strings);
  }

  const templates =
  path.scope.getProgramParent().data.templates || (
  path.scope.getProgramParent().data.templates = []);
  const found = templates.find((tmp) => {
    if (t__namespace.isArrayExpression(tmp.template) && t__namespace.isArrayExpression(template)) {
      return tmp.template.elements.every(
      (el, i) => template.elements[i] && el.value === template.elements[i].value);

    }
    return tmp.template.value === template.value;
  });
  if (!found) {
    id = path.scope.generateUidIdentifier("tmpl$");
    templates.push({
      id,
      template,
      templateWithClosingTags: template,
      renderer: "ssr"
    });
  } else id = found.id;

  if (result.wontEscape) {
    if (!Array.isArray(result.template) || result.template.length === 1) return id;else
    if (
    Array.isArray(result.template) &&
    result.template.length === 2 &&
    result.templateValues[0].type === "CallExpression" &&
    result.templateValues[0].callee.name === "_$ssrHydrationKey")
    {
      // remove unnecessary ssr call when only hydration key is used
      return t__namespace.binaryExpression(
      "+",
      t__namespace.binaryExpression(
      "+",
      t__namespace.memberExpression(id, t__namespace.numericLiteral(0), true),
      result.templateValues[0]),

      t__namespace.memberExpression(id, t__namespace.numericLiteral(1), true));

    }
  }
  return t__namespace.callExpression(
  registerImportMethod(path, "ssr"),
  Array.isArray(result.template) && result.template.length > 1 ?
  [id, ...result.templateValues] :
  [id]);

}

function appendTemplates(path, templates) {
  const declarators = templates.map((template) => {
    return t__namespace.variableDeclarator(template.id, template.template);
  });
  path.node.body.unshift(t__namespace.variableDeclaration("var", declarators));
}

function appendToTemplate(template, value) {
  let array;
  if (Array.isArray(value)) {
    [value, ...array] = value;
  }
  template[template.length - 1] += value;
  if (array && array.length) template.push.apply(template, array);
}

function transformElement$2(path, info) {
  path.
  get("openingElement").
  get("attributes").
  forEach((attr) => {
    evaluateAndInline(attr.node.value, attr.get("value"));
  });

  const config = getConfig(path);
  const tagName = getTagName(path.node);
  if (tagName === "script" || tagName === "style") path.doNotEscape = true;

  // contains spread attributes
  if (path.node.openingElement.attributes.some((a) => t__namespace.isJSXSpreadAttribute(a)))
  return createElement(path, { ...info, ...config });

  const voidTag = VoidElements.indexOf(tagName) > -1,
    results = {
      template: [`<${tagName}`],
      templateValues: [],
      declarations: [],
      exprs: [],
      dynamics: [],
      tagName,
      wontEscape: path.node.wontEscape,
      renderer: "ssr"
    };

  if (info.topLevel && config.hydratable) {
    if (tagName === "head") {
      registerImportMethod(path, "NoHydration");
      registerImportMethod(path, "createComponent");
      const child = transformElement$2(path, { ...info, topLevel: false });
      results.template = "";
      results.templateWithClosingTags = "";
      results.exprs.push(
      t__namespace.callExpression(t__namespace.identifier("_$createComponent"), [
      t__namespace.identifier("_$NoHydration"),
      t__namespace.objectExpression([
      t__namespace.objectMethod(
      "get",
      t__namespace.identifier("children"),
      [],
      t__namespace.blockStatement([t__namespace.returnStatement(createTemplate$1(path, child))]))])]));




      return results;
    }
    results.template.push("");
    results.templateValues.push(
    t__namespace.callExpression(registerImportMethod(path, "ssrHydrationKey"), []));

  }
  transformAttributes$1(path, results, { ...config, ...info });
  appendToTemplate(results.template, ">");
  if (!voidTag) {
    transformChildren$1(path, results, { ...config, ...info });
    appendToTemplate(results.template, `</${tagName}>`);
  }
  return results;
}

function toAttribute(key, isSVG) {
  key = Aliases[key] || key;
  !isSVG && (key = key.toLowerCase());
  return key;
}

function setAttr$1(attribute, results, name, value, isSVG) {
  // strip out namespaces for now, everything at this point is an attribute
  let parts;
  if ((parts = name.split(":")) && parts[1] && reservedNameSpaces.has(parts[0])) {
    name = parts[1];
    parts[0];
  }

  name = toAttribute(name, isSVG);
  const attr = t__namespace.callExpression(registerImportMethod(attribute, "ssrAttribute"), [
  t__namespace.stringLiteral(name),
  value,
  t__namespace.booleanLiteral(false)]);

  if (results.template[results.template.length - 1].length) {
    results.template.push("");
    results.templateValues.push(attr);
  } else {
    const last = results.templateValues.length - 1;
    results.templateValues[last] = t__namespace.binaryExpression("+", results.templateValues[last], attr);
  }
}

function escapeExpression(path, expression, attr, escapeLiterals) {
  if (
  t__namespace.isStringLiteral(expression) ||
  t__namespace.isNumericLiteral(expression) ||
  t__namespace.isTemplateLiteral(expression) && expression.expressions.length === 0)
  {
    if (escapeLiterals) {
      if (t__namespace.isStringLiteral(expression)) return t__namespace.stringLiteral(escapeHTML(expression.value, attr));else
      if (t__namespace.isTemplateLiteral(expression))
      return t__namespace.stringLiteral(escapeHTML(expression.quasis[0].value.raw, attr));
    }
    return expression;
  } else if (t__namespace.isFunction(expression)) {
    if (t__namespace.isBlockStatement(expression.body)) {
      expression.body.body = expression.body.body.map((e) => {
        if (t__namespace.isReturnStatement(e))
        e.argument = escapeExpression(path, e.argument, attr, escapeLiterals);
        return e;
      });
    } else expression.body = escapeExpression(path, expression.body, attr, escapeLiterals);
    return expression;
  } else if (t__namespace.isTemplateLiteral(expression)) {
    expression.expressions = expression.expressions.map((e) =>
    escapeExpression(path, e, attr, escapeLiterals));

    return expression;
  } else if (t__namespace.isUnaryExpression(expression)) {
    return expression;
  } else if (t__namespace.isBinaryExpression(expression)) {
    expression.left = escapeExpression(path, expression.left, attr, escapeLiterals);
    expression.right = escapeExpression(path, expression.right, attr, escapeLiterals);
    return expression;
  } else if (t__namespace.isConditionalExpression(expression)) {
    expression.consequent = escapeExpression(path, expression.consequent, attr, escapeLiterals);
    expression.alternate = escapeExpression(path, expression.alternate, attr, escapeLiterals);
    return expression;
  } else if (t__namespace.isLogicalExpression(expression)) {
    // Preserve the old short-circuit shape for && while still escaping the
    // selected result of || and ?? as a whole.
    if (expression.operator === "&&") {
      expression.right = escapeExpression(path, expression.right, attr, escapeLiterals);
      return expression;
    }
  } else if (t__namespace.isCallExpression(expression) && t__namespace.isFunction(expression.callee)) {
    if (t__namespace.isBlockStatement(expression.callee.body)) {
      expression.callee.body.body = expression.callee.body.body.map((e) => {
        if (t__namespace.isReturnStatement(e))
        e.argument = escapeExpression(path, e.argument, attr, escapeLiterals);
        return e;
      });
    } else
    expression.callee.body = escapeExpression(path, expression.callee.body, attr, escapeLiterals);
    return expression;
  } else if (t__namespace.isJSXElement(expression) && !isComponent(getTagName(expression))) {
    expression.wontEscape = true;
    return expression;
  }

  return t__namespace.callExpression(
  registerImportMethod(path, "escape"),
  [expression].concat(attr ? [t__namespace.booleanLiteral(true)] : []));

}

function transformToObject(attrName, attributes, selectedAttributes) {
  const properties = [];
  const existingAttribute = attributes.find((a) => a.node.name.name === attrName);
  for (let i = 0; i < selectedAttributes.length; i++) {
    const attr = selectedAttributes[i].node;
    const computed = !t__namespace.isValidIdentifier(attr.name.name.name);
    if (!computed) {
      attr.name.name.type = "Identifier";
    }
    properties.push(
    t__namespace.objectProperty(
    computed ? t__namespace.stringLiteral(attr.name.name.name) : attr.name.name,
    t__namespace.isJSXExpressionContainer(attr.value) ? attr.value.expression : attr.value));


    (existingAttribute || i) && attributes.splice(selectedAttributes[i].key, 1);
  }
  if (
  existingAttribute &&
  t__namespace.isJSXExpressionContainer(existingAttribute.node.value) &&
  t__namespace.isObjectExpression(existingAttribute.node.value.expression))
  {
    existingAttribute.node.value.expression.properties.push(...properties);
  } else {
    selectedAttributes[0].node = t__namespace.jsxAttribute(
    t__namespace.jsxIdentifier(attrName),
    t__namespace.jsxExpressionContainer(t__namespace.objectExpression(properties)));

  }
}

function normalizeAttributes(path) {
  const attributes = path.get("openingElement").get("attributes"),
    styleAttributes = attributes.filter(
    (a) => t__namespace.isJSXNamespacedName(a.node.name) && a.node.name.namespace.name === "style"),

    classNamespaceAttributes = attributes.filter(
    (a) => t__namespace.isJSXNamespacedName(a.node.name) && a.node.name.namespace.name === "class");

  if (classNamespaceAttributes.length)
  transformToObject("classList", attributes, classNamespaceAttributes);
  const classAttributes = attributes.filter(
  (a) =>
  a.node.name && (
  a.node.name.name === "class" ||
  a.node.name.name === "className" ||
  a.node.name.name === "classList"));

  // combine class propertoes
  if (classAttributes.length > 1) {
    const first = classAttributes[0].node,
      values = [],
      quasis = [t__namespace.templateElement({ raw: "" })];
    for (let i = 0; i < classAttributes.length; i++) {
      const attr = classAttributes[i].node,
        isLast = i === classAttributes.length - 1;
      if (!t__namespace.isJSXExpressionContainer(attr.value)) {
        const prev = quasis.pop();
        quasis.push(
        t__namespace.templateElement({
          raw: (prev ? prev.value.raw : "") + `${attr.value.value}` + (isLast ? "" : " ")
        }));

      } else {
        let expr = attr.value.expression;
        if (attr.name.name === "classList") {
          if (t__namespace.isObjectExpression(expr) && !expr.properties.some((p) => t__namespace.isSpreadElement(p))) {
            transformClasslistObject(path, expr, values, quasis);
            if (!isLast) quasis[quasis.length - 1].value.raw += " ";
            i && attributes.splice(attributes.indexOf(classAttributes[i]), 1);
            continue;
          }
          expr = t__namespace.callExpression(registerImportMethod(path, "ssrClassList"), [expr]);
        }
        values.push(t__namespace.logicalExpression("||", expr, t__namespace.stringLiteral("")));
        quasis.push(t__namespace.templateElement({ raw: isLast ? "" : " " }));
      }
      i && attributes.splice(attributes.indexOf(classAttributes[i]), 1);
    }
    first.name = t__namespace.jsxIdentifier("class");
    first.value = t__namespace.jsxExpressionContainer(t__namespace.templateLiteral(quasis, values));
  }
  if (styleAttributes.length) transformToObject("style", attributes, styleAttributes);
  return attributes;
}

function transformAttributes$1(path, results, info) {
  const tagName = getTagName(path.node),
    isSVG = SVGElements.has(tagName),
    hasChildren = path.node.children.length > 0,
    attributes = normalizeAttributes(path);
  let children;

  attributes.forEach((attribute) => {
    const node = attribute.node;

    let value = node.value,
      key = t__namespace.isJSXNamespacedName(node.name) ?
      `${node.name.namespace.name}:${node.name.name.name}` :
      node.name.name,
      reservedNameSpace =
      t__namespace.isJSXNamespacedName(node.name) && reservedNameSpaces.has(node.name.namespace.name);
    if (
    (t__namespace.isJSXNamespacedName(node.name) && reservedNameSpace || ChildProperties.has(key)) &&
    !t__namespace.isJSXExpressionContainer(value))
    {
      node.value = value = t__namespace.jsxExpressionContainer(value || t__namespace.jsxEmptyExpression());
    }

    if (
    t__namespace.isJSXExpressionContainer(value) && (
    reservedNameSpace ||
    ChildProperties.has(key) ||
    !(
    t__namespace.isStringLiteral(value.expression) ||
    t__namespace.isNumericLiteral(value.expression) ||
    t__namespace.isBooleanLiteral(value.expression))))

    {
      if (
      key === "ref" ||
      key.startsWith("use:") ||
      key.startsWith("prop:") ||
      key.startsWith("on"))

      return;else
      if (ChildProperties.has(key)) {
        if (info.hydratable && key === "textContent" && value && value.expression) {
          value.expression = t__namespace.logicalExpression("||", value.expression, t__namespace.stringLiteral(" "));
        }
        if (key === "innerHTML") path.doNotEscape = true;
        children = value;
      } else {
        let doEscape = true;

        if (key.startsWith("attr:")) key = key.replace("attr:", "");
        if (BooleanAttributes.has(key) || key.startsWith("bool:")) {
          key = key.replace("bool:", "");
          results.template.push("");
          const fn = t__namespace.callExpression(registerImportMethod(attribute, "ssrAttribute"), [
          t__namespace.stringLiteral(key),
          value.expression,
          t__namespace.booleanLiteral(true)]);

          results.templateValues.push(fn);
          return;
        }
        if (key === "style") {
          if (
          t__namespace.isJSXExpressionContainer(value) &&
          t__namespace.isObjectExpression(value.expression) &&
          !value.expression.properties.some((p) => t__namespace.isSpreadElement(p)))
          {
            if (value.expression.properties.length === 0) {
              return;
            }
            const props = value.expression.properties.map((p, i) => {
              if (p.computed) {
                return t__namespace.callExpression(registerImportMethod(path, "ssrStyleProperty"), [
                t__namespace.binaryExpression("+", p.key, t__namespace.stringLiteral(":")),
                escapeExpression(path, p.value, true, true)]);

              }
              return t__namespace.callExpression(registerImportMethod(path, "ssrStyleProperty"), [
              t__namespace.stringLiteral(
              (i ? ";" : "") + (t__namespace.isIdentifier(p.key) ? p.key.name : p.key.value) + ":"),

              escapeExpression(path, p.value, true, true)]);

            });

            let res = props[0];
            for (let i = 1; i < props.length; i++) {
              res = t__namespace.binaryExpression("+", res, props[i]);
            }
            value.expression = res;
          } else {
            value.expression = t__namespace.callExpression(registerImportMethod(path, "ssrStyle"), [
            value.expression]);

          }
          doEscape = false;
        }
        if (key === "classList") {
          if (
          t__namespace.isObjectExpression(value.expression) &&
          !value.expression.properties.some((p) => t__namespace.isSpreadElement(p)))
          {
            const values = [],
              quasis = [t__namespace.templateElement({ raw: "" })];
            transformClasslistObject(path, value.expression, values, quasis);
            if (!values.length) value.expression = t__namespace.stringLiteral(quasis[0].value.raw);else
            if (values.length === 1 && !quasis[0].value.raw && !quasis[1].value.raw) {
              value.expression = values[0];
            } else value.expression = t__namespace.templateLiteral(quasis, values);
          } else {
            value.expression = t__namespace.callExpression(registerImportMethod(path, "ssrClassList"), [
            value.expression]);

          }
          key = "class";
          doEscape = false;
        }
        if (doEscape) value.expression = escapeExpression(path, value.expression, true);

        if (!doEscape || t__namespace.isLiteral(value.expression)) {
          key = toAttribute(key, isSVG);
          appendToTemplate(results.template, ` ${key}="`);
          results.template.push(`"`);
          results.templateValues.push(value.expression);
        } else setAttr$1(attribute, results, key, value.expression, isSVG);
      }
    } else {
      if (key === "$ServerOnly") return;
      if (t__namespace.isJSXExpressionContainer(value)) value = value.expression;
      key = toAttribute(key, isSVG);
      const isBoolean = BooleanAttributes.has(key);
      if (isBoolean && value && value.value !== "" && !value.value) return;
      appendToTemplate(results.template, ` ${key}`);
      if (!value) return;
      let text = isBoolean ? "" : value.value;
      if (key === "style" || key === "class") {
        text = trimWhitespace(String(text));
        if (key === "style") {
          text = text.replace(/; /g, ";").replace(/: /g, ":");
        }
      }

      appendToTemplate(
      results.template,
      // `String(text)` is needed, as text.length will mess up `attr=10>` becomes `attr>` without it
      String(text) === "" ? `` : `="${escapeHTML(text, true)}"`);

    }
  });
  if (!hasChildren && children) {
    path.node.children.push(children);
  }
}

function transformClasslistObject(path, expr, values, quasis) {
  expr.properties.forEach((prop, i) => {
    const isLast = expr.properties.length - 1 === i;
    let key = prop.key;
    if (t__namespace.isIdentifier(prop.key) && !prop.computed) key = t__namespace.stringLiteral(key.name);else
    if (prop.computed) {
      key = t__namespace.callExpression(registerImportMethod(path, "escape"), [
      prop.key,
      t__namespace.booleanLiteral(true)]);

    } else key = t__namespace.stringLiteral(escapeHTML(prop.key.value));
    if (t__namespace.isBooleanLiteral(prop.value)) {
      if (prop.value.value === true) {
        if (!prop.computed) {
          const prev = quasis.pop();
          quasis.push(
          t__namespace.templateElement({
            raw:
            (prev ? prev.value.raw : "") + (i ? " " : "") + `${key.value}` + (isLast ? "" : " ")
          }));

        } else {
          values.push(key);
          quasis.push(t__namespace.templateElement({ raw: isLast ? "" : " " }));
        }
      }
    } else {
      values.push(t__namespace.conditionalExpression(prop.value, key, t__namespace.stringLiteral("")));
      quasis.push(t__namespace.templateElement({ raw: isLast ? "" : " " }));
    }
  });
}

function transformChildren$1(path, results, { hydratable }) {
  const doNotEscape = path.doNotEscape;
  const filteredChildren = filterChildren(path.get("children"));
  const multi = checkLength(filteredChildren),
    markers = hydratable && multi;
  filteredChildren.forEach((node) => {
    if (t__namespace.isJSXElement(node.node) && getTagName(node.node) === "head") {
      const child = transformNode(node, { doNotEscape, hydratable: false });
      registerImportMethod(path, "NoHydration");
      registerImportMethod(path, "createComponent");
      results.template.push("");
      results.templateValues.push(
      t__namespace.callExpression(t__namespace.identifier("_$createComponent"), [
      t__namespace.identifier("_$NoHydration"),
      t__namespace.objectExpression([
      t__namespace.objectMethod(
      "get",
      t__namespace.identifier("children"),
      [],
      t__namespace.blockStatement([t__namespace.returnStatement(createTemplate$1(path, child))]))])]));




      return;
    }
    const child = transformNode(node, { doNotEscape });
    if (!child) return;
    appendToTemplate(results.template, child.template);
    results.templateValues.push.apply(results.templateValues, child.templateValues || []);
    if (child.exprs.length) {
      if (!doNotEscape && !child.spreadElement)
      child.exprs[0] = escapeExpression(path, child.exprs[0]);

      // boxed by textNodes
      if (markers && !child.spreadElement) {
        appendToTemplate(results.template, `<!--$-->`);
        results.template.push("");
        results.templateValues.push(child.exprs[0]);
        appendToTemplate(results.template, `<!--/-->`);
      } else {
        results.template.push("");
        results.templateValues.push(child.exprs[0]);
      }
    }
  });
}

function createElement(path, { topLevel, hydratable }) {
  const tagName = getTagName(path.node),
    config = getConfig(path),
    attributes = normalizeAttributes(path),
    doNotEscape = path.doNotEscape;

  const filteredChildren = filterChildren(path.get("children")),
    multi = checkLength(filteredChildren),
    markers = hydratable && multi,
    childNodes = filteredChildren.reduce((memo, path) => {
      if (t__namespace.isJSXText(path.node)) {
        const v = htmlEntities.decode(trimWhitespace(path.node.extra.raw));
        if (v.length) memo.push(t__namespace.stringLiteral(v));
      } else {
        const child = transformNode(path);
        if (markers && child.exprs.length && !child.spreadElement)
        memo.push(t__namespace.stringLiteral("<!--$-->"));
        if (child.exprs.length && !doNotEscape && !child.spreadElement)
        child.exprs[0] = escapeExpression(path, child.exprs[0]);
        memo.push(getCreateTemplate(config, path, child)(path, child, true));
        if (markers && child.exprs.length && !child.spreadElement)
        memo.push(t__namespace.stringLiteral("<!--/-->"));
      }
      return memo;
    }, []);

  let props;
  if (attributes.length === 1) {
    props = [attributes[0].node.argument];
  } else {
    props = [];
    let runningObject = [],
      dynamicSpread = false,
      hasChildren = path.node.children.length > 0;

    attributes.forEach((attribute) => {
      const node = attribute.node;
      if (t__namespace.isJSXSpreadAttribute(node)) {
        if (runningObject.length) {
          props.push(t__namespace.objectExpression(runningObject));
          runningObject = [];
        }
        props.push(
        isDynamic(attribute.get("argument"), {
          checkMember: true
        }) && (dynamicSpread = true) ?
        t__namespace.isCallExpression(node.argument) &&
        !node.argument.arguments.length &&
        !t__namespace.isCallExpression(node.argument.callee) &&
        !t__namespace.isMemberExpression(node.argument.callee) ?
        node.argument.callee :
        t__namespace.arrowFunctionExpression([], node.argument) :
        node.argument);

      } else {
        const value = node.value || t__namespace.booleanLiteral(true),
          id = convertJSXIdentifier(node.name),
          key = t__namespace.isJSXNamespacedName(node.name) ?
          `${node.name.namespace.name}:${node.name.name.name}` :
          node.name.name;

        if (hasChildren && key === "children") return;
        if (
        key === "ref" ||
        key.startsWith("use:") ||
        key.startsWith("prop:") ||
        key.startsWith("on"))

        return;
        if (t__namespace.isJSXExpressionContainer(value)) {
          if (
          isDynamic(attribute.get("value").get("expression"), {
            checkMember: true,
            checkTags: true
          }))
          {
            let expr = t__namespace.arrowFunctionExpression([], value.expression);
            runningObject.push(
            t__namespace.objectMethod(
            "get",
            id,
            [],
            t__namespace.blockStatement([t__namespace.returnStatement(expr.body)]),
            !t__namespace.isValidIdentifier(key)));


          } else runningObject.push(t__namespace.objectProperty(id, value.expression));} else
        runningObject.push(t__namespace.objectProperty(id, value));
      }
    });

    if (runningObject.length || !props.length) props.push(t__namespace.objectExpression(runningObject));

    if (props.length > 1 || dynamicSpread) {
      props = [t__namespace.callExpression(registerImportMethod(path, "mergeProps"), props)];
    }
  }

  const exprs = [
  t__namespace.callExpression(registerImportMethod(path, "ssrElement"), [
  t__namespace.stringLiteral(tagName),
  props[0],
  childNodes.length ?
  hydratable ?
  t__namespace.arrowFunctionExpression(
  [],
  childNodes.length === 1 ? childNodes[0] : t__namespace.arrayExpression(childNodes)) :

  childNodes.length === 1 ?
  childNodes[0] :
  t__namespace.arrayExpression(childNodes) :
  t__namespace.identifier("undefined"),
  t__namespace.booleanLiteral(Boolean(topLevel && config.hydratable))])];


  return { exprs, template: "", spreadElement: true };
}

function transformElement$1(path, info) {
  path.
  get("openingElement").
  get("attributes").
  forEach((attr) => {
    evaluateAndInline(attr.node.value, attr.get("value"));
  });

  let tagName = getTagName(path.node),
    results = {
      id: path.scope.generateUidIdentifier("el$"),
      declarations: [],
      exprs: [],
      dynamics: [],
      postExprs: [],
      tagName,
      renderer: "universal"
    };

  results.declarations.push(
  t__namespace.variableDeclarator(
  results.id,
  t__namespace.callExpression(
  registerImportMethod(
  path,
  "createElement",
  getRendererConfig(path, "universal").moduleName),

  [t__namespace.stringLiteral(tagName)])));




  transformAttributes(path, results);
  transformChildren(path, results);

  return results;
}

function transformAttributes(path, results) {
  let children, spreadExpr;
  let attributes = path.get("openingElement").get("attributes");
  const elem = results.id,
    hasChildren = path.node.children.length > 0,
    config = getConfig(path);

  // preprocess spreads
  if (attributes.some((attribute) => t__namespace.isJSXSpreadAttribute(attribute.node))) {
    [attributes, spreadExpr] = processSpreads(path, attributes, {
      elem,
      hasChildren,
      wrapConditionals: config.wrapConditionals
    });
    path.get("openingElement").set(
    "attributes",
    attributes.map((a) => a.node));

  }

  path.
  get("openingElement").
  get("attributes").
  forEach((attribute) => {
    const node = attribute.node;

    let value = node.value,
      key = t__namespace.isJSXNamespacedName(node.name) ?
      `${node.name.namespace.name}:${node.name.name.name}` :
      node.name.name,
      reservedNameSpace = t__namespace.isJSXNamespacedName(node.name) && node.name.namespace.name === "use";
    if (
    t__namespace.isJSXNamespacedName(node.name) &&
    reservedNameSpace &&
    !t__namespace.isJSXExpressionContainer(value))
    {
      node.value = value = t__namespace.jsxExpressionContainer(value || t__namespace.jsxEmptyExpression());
    }
    if (t__namespace.isJSXExpressionContainer(value)) {
      if (key === "ref") {
        // Normalize expressions for non-null and type-as
        while (
        t__namespace.isTSNonNullExpression(value.expression) ||
        t__namespace.isTSAsExpression(value.expression))
        {
          value.expression = value.expression.expression;
        }
        let binding,
          isConstant =
          t__namespace.isIdentifier(value.expression) && (
          binding = path.scope.getBinding(value.expression.name)) && (
          binding.kind === "const" || binding.kind === "module");
        if (!isConstant && t__namespace.isLVal(value.expression)) {
          const refIdentifier = path.scope.generateUidIdentifier("_ref$");
          results.exprs.unshift(
          t__namespace.variableDeclaration("var", [t__namespace.variableDeclarator(refIdentifier, value.expression)]),
          t__namespace.expressionStatement(
          t__namespace.conditionalExpression(
          t__namespace.binaryExpression(
          "===",
          t__namespace.unaryExpression("typeof", refIdentifier),
          t__namespace.stringLiteral("function")),

          t__namespace.callExpression(
          registerImportMethod(
          path,
          "use",
          getRendererConfig(path, "universal").moduleName),

          [refIdentifier, elem]),

          t__namespace.assignmentExpression("=", value.expression, elem))));



        } else if (isConstant || t__namespace.isFunction(value.expression)) {
          results.exprs.unshift(
          t__namespace.expressionStatement(
          t__namespace.callExpression(
          registerImportMethod(
          path,
          "use",
          getRendererConfig(path, "universal").moduleName),

          [value.expression, elem])));



        } else {
          const refIdentifier = path.scope.generateUidIdentifier("_ref$");
          results.exprs.unshift(
          t__namespace.variableDeclaration("var", [t__namespace.variableDeclarator(refIdentifier, value.expression)]),
          t__namespace.expressionStatement(
          t__namespace.logicalExpression(
          "&&",
          t__namespace.binaryExpression(
          "===",
          t__namespace.unaryExpression("typeof", refIdentifier),
          t__namespace.stringLiteral("function")),

          t__namespace.callExpression(
          registerImportMethod(
          path,
          "use",
          getRendererConfig(path, "universal").moduleName),

          [refIdentifier, elem]))));




        }
      } else if (key.startsWith("use:")) {
        // Some trick to treat JSXIdentifier as Identifier
        node.name.name.type = "Identifier";
        results.exprs.unshift(
        t__namespace.expressionStatement(
        t__namespace.callExpression(
        registerImportMethod(path, "use", getRendererConfig(path, "universal").moduleName),
        [
        node.name.name,
        elem,
        t__namespace.arrowFunctionExpression(
        [],
        t__namespace.isJSXEmptyExpression(value.expression) ?
        t__namespace.booleanLiteral(true) :
        value.expression)])));





      } else if (key === "children") {
        children = value;
      } else if (
      config.effectWrapper &&
      isDynamic(attribute.get("value").get("expression"), {
        checkMember: true
      }))
      {
        results.dynamics.push({ elem, key, value: value.expression });
      } else {
        results.exprs.push(
        t__namespace.expressionStatement(setAttr(attribute, elem, key, value.expression)));

      }
    } else {
      results.exprs.push(t__namespace.expressionStatement(setAttr(attribute, elem, key, value)));
    }
  });
  if (spreadExpr) results.exprs.push(spreadExpr);
  if (!hasChildren && children) {
    path.node.children.push(children);
  }
}

function setAttr(path, elem, name, value, { prevId } = {}) {
  if (!value) value = t__namespace.booleanLiteral(true);
  return t__namespace.callExpression(
  registerImportMethod(path, "setProp", getRendererConfig(path, "universal").moduleName),
  prevId ? [elem, t__namespace.stringLiteral(name), value, prevId] : [elem, t__namespace.stringLiteral(name), value]);

}

function transformChildren(path, results) {
  const filteredChildren = filterChildren(path.get("children")),
    multi = checkLength(filteredChildren),
    childNodes = filteredChildren.map(transformNode).reduce((memo, child) => {
      if (!child) return memo;
      const i = memo.length;
      if (child.text && i && memo[i - 1].text) {
        memo[i - 1].template += child.template;
        memo[i - 1].templateWithClosingTags += child.templateWithClosingTags || child.template;
      } else memo.push(child);
      return memo;
    }, []);

  const appends = [];
  childNodes.forEach((child, index) => {
    if (!child) return;
    if (child.tagName && child.renderer !== "universal") {
      throw new Error(`<${child.tagName}> is not supported in <${getTagName(path.node)}>.
        Wrap the usage with a component that would render this element, eg. Canvas`);
    }
    if (child.id) {
      let insertNode = registerImportMethod(
      path,
      "insertNode",
      getRendererConfig(path, "universal").moduleName);

      let insert = child.id;
      if (child.text) {
        let createTextNode = registerImportMethod(
        path,
        "createTextNode",
        getRendererConfig(path, "universal").moduleName);

        if (multi) {
          results.declarations.push(
          t__namespace.variableDeclarator(
          child.id,
          t__namespace.callExpression(createTextNode, [
          t__namespace.templateLiteral(
          [t__namespace.templateElement({ raw: escapeStringForTemplate(child.template) })],
          [])])));




        } else
        insert = t__namespace.callExpression(createTextNode, [
        t__namespace.templateLiteral(
        [t__namespace.templateElement({ raw: escapeStringForTemplate(child.template) })],
        [])]);


      }
      appends.push(t__namespace.expressionStatement(t__namespace.callExpression(insertNode, [results.id, insert])));
      results.declarations.push(...child.declarations);
      results.exprs.push(...child.exprs);
      results.dynamics.push(...child.dynamics);
    } else if (child.exprs.length) {
      let insert = registerImportMethod(
      path,
      "insert",
      getRendererConfig(path, "universal").moduleName);

      if (multi) {
        results.exprs.push(
        t__namespace.expressionStatement(
        t__namespace.callExpression(insert, [
        results.id,
        child.exprs[0],
        nextChild(childNodes, index) || t__namespace.nullLiteral()])));



      } else {
        results.exprs.push(
        t__namespace.expressionStatement(t__namespace.callExpression(insert, [results.id, child.exprs[0]])));

      }
    }
  });
  results.exprs.unshift(...appends);
}

function nextChild(children, index) {
  return children[index + 1] && (children[index + 1].id || nextChild(children, index + 1));
}

function processSpreads(path, attributes, { elem, hasChildren, wrapConditionals }) {
  // TODO: skip but collect the names of any properties after the last spread to not overwrite them
  const filteredAttributes = [];
  const spreadArgs = [];
  let runningObject = [];
  let dynamicSpread = false;
  let firstSpread = false;
  attributes.forEach((attribute) => {
    const node = attribute.node;
    const key =
    !t__namespace.isJSXSpreadAttribute(node) && (
    t__namespace.isJSXNamespacedName(node.name) ?
    `${node.name.namespace.name}:${node.name.name.name}` :
    node.name.name);
    if (t__namespace.isJSXSpreadAttribute(node)) {
      firstSpread = true;
      if (runningObject.length) {
        spreadArgs.push(t__namespace.objectExpression(runningObject));
        runningObject = [];
      }
      spreadArgs.push(
      isDynamic(attribute.get("argument"), {
        checkMember: true
      }) && (dynamicSpread = true) ?
      t__namespace.isCallExpression(node.argument) &&
      !node.argument.arguments.length &&
      !t__namespace.isCallExpression(node.argument.callee) &&
      !t__namespace.isMemberExpression(node.argument.callee) ?
      node.argument.callee :
      t__namespace.arrowFunctionExpression([], node.argument) :
      node.argument);

    } else if (
    (firstSpread ||
    t__namespace.isJSXExpressionContainer(node.value) &&
    isDynamic(attribute.get("value").get("expression"), { checkMember: true })) &&
    canNativeSpread(key, { checkNameSpaces: true }))
    {
      const isContainer = t__namespace.isJSXExpressionContainer(node.value);
      const dynamic =
      isContainer && isDynamic(attribute.get("value").get("expression"), { checkMember: true });
      if (dynamic) {
        const id = convertJSXIdentifier(node.name);
        let expr =
        wrapConditionals && (
        t__namespace.isLogicalExpression(node.value.expression) ||
        t__namespace.isConditionalExpression(node.value.expression)) ?
        transformCondition(attribute.get("value").get("expression"), true) :
        t__namespace.arrowFunctionExpression([], node.value.expression);
        runningObject.push(
        t__namespace.objectMethod(
        "get",
        id,
        [],
        t__namespace.blockStatement([t__namespace.returnStatement(expr.body)]),
        !t__namespace.isValidIdentifier(key)));


      } else {
        runningObject.push(
        t__namespace.objectProperty(
        t__namespace.stringLiteral(key),
        isContainer ? node.value.expression : node.value || t__namespace.booleanLiteral(true)));


      }
    } else filteredAttributes.push(attribute);
  });

  if (runningObject.length) {
    spreadArgs.push(t__namespace.objectExpression(runningObject));
  }

  const props =
  spreadArgs.length === 1 && !dynamicSpread ?
  spreadArgs[0] :
  t__namespace.callExpression(registerImportMethod(path, "mergeProps"), spreadArgs);

  return [
  filteredAttributes,
  t__namespace.expressionStatement(
  t__namespace.callExpression(
  registerImportMethod(path, "spread", getRendererConfig(path, "universal").moduleName),
  [elem, props, t__namespace.booleanLiteral(hasChildren)]))];



}

function createTemplate(path, result, wrap) {
  const config = getConfig(path);
  if (result.id) {
    result.decl = t__namespace.variableDeclaration("var", result.declarations);
    if (
    !(result.exprs.length || result.dynamics.length || result.postExprs.length) &&
    result.decl.declarations.length === 1)
    {
      return result.decl.declarations[0].init;
    } else {
      return t__namespace.callExpression(
      t__namespace.arrowFunctionExpression(
      [],
      t__namespace.blockStatement([
      result.decl,
      ...result.exprs.concat(
      wrapDynamics(path, result.dynamics) || [],
      result.postExprs || []),

      t__namespace.returnStatement(result.id)])),


      []);

    }
  }
  if (wrap && result.dynamic && config.memoWrapper) {
    return t__namespace.callExpression(registerImportMethod(path, config.memoWrapper), [result.exprs[0]]);
  }
  return result.exprs[0];
}

function wrapDynamics(path, dynamics) {
  if (!dynamics.length) return;
  const config = getConfig(path);

  const effectWrapperId = registerImportMethod(path, config.effectWrapper);

  if (dynamics.length === 1) {
    const prevValue = t__namespace.identifier("_$p");

    return t__namespace.expressionStatement(
    t__namespace.callExpression(effectWrapperId, [
    t__namespace.arrowFunctionExpression(
    [prevValue],
    setAttr(path, dynamics[0].elem, dynamics[0].key, dynamics[0].value, {
      dynamic: true,
      prevId: prevValue
    }))]));



  }

  const prevId = t__namespace.identifier("_p$");

  /** @type {t.VariableDeclarator[]} */
  const declarations = [];
  /** @type {t.ExpressionStatement[]} */
  const statements = [];
  /** @type {t.Identifier[]} */
  const properties = [];

  dynamics.forEach(({ elem, key, value }, index) => {
    const varIdent = path.scope.generateUidIdentifier("v$");

    const propIdent = t__namespace.identifier(getNumberedId(index));
    const propMember = t__namespace.memberExpression(prevId, propIdent);

    properties.push(propIdent);
    declarations.push(t__namespace.variableDeclarator(varIdent, value));

    statements.push(
    t__namespace.expressionStatement(
    t__namespace.logicalExpression(
    "&&",
    t__namespace.binaryExpression("!==", varIdent, propMember),
    t__namespace.assignmentExpression(
    "=",
    propMember,
    setAttr(path, elem, key, varIdent, { dynamic: true, prevId: propMember })))));




  });

  return t__namespace.expressionStatement(
  t__namespace.callExpression(effectWrapperId, [
  t__namespace.arrowFunctionExpression(
  [prevId],
  t__namespace.blockStatement([
  t__namespace.variableDeclaration("var", declarations),
  ...statements,
  t__namespace.returnStatement(prevId)])),


  t__namespace.objectExpression(
  properties.map((id) => t__namespace.objectProperty(id, t__namespace.identifier("undefined"))))]));



}

function convertComponentIdentifier(node) {
  if (t__namespace.isJSXIdentifier(node)) {
    if (node.name === "this") return t__namespace.thisExpression();
    if (t__namespace.isValidIdentifier(node.name)) node.type = "Identifier";else
    return t__namespace.stringLiteral(node.name);
  } else if (t__namespace.isJSXMemberExpression(node)) {
    const prop = convertComponentIdentifier(node.property);
    const computed = t__namespace.isStringLiteral(prop);
    return t__namespace.memberExpression(convertComponentIdentifier(node.object), prop, computed);
  }

  return node;
}

function transformComponent(path) {
  let exprs = [],
    config = getConfig(path),
    tagId = convertComponentIdentifier(path.node.openingElement.name),
    props = [],
    runningObject = [],
    dynamicSpread = false,
    hasChildren = path.node.children.length > 0;

  if (config.builtIns.indexOf(tagId.name) > -1 && !path.scope.hasBinding(tagId.name)) {
    const newTagId = registerImportMethod(path, tagId.name);
    tagId.name = newTagId.name;
  }

  path.
  get("openingElement").
  get("attributes").
  forEach((attribute) => {
    const node = attribute.node;
    if (t__namespace.isJSXSpreadAttribute(node)) {
      if (runningObject.length) {
        props.push(t__namespace.objectExpression(runningObject));
        runningObject = [];
      }
      props.push(
      isDynamic(attribute.get("argument"), {
        checkMember: true
      }) && (dynamicSpread = true) ?
      t__namespace.isCallExpression(node.argument) &&
      !node.argument.arguments.length &&
      !t__namespace.isCallExpression(node.argument.callee) &&
      !t__namespace.isMemberExpression(node.argument.callee) ?
      node.argument.callee :
      t__namespace.arrowFunctionExpression([], node.argument) :
      node.argument);

    } else {
      // handle weird babel bug around HTML entities
      const value =
        (t__namespace.isStringLiteral(node.value) ? t__namespace.stringLiteral(node.value.value) : node.value) ||
        t__namespace.booleanLiteral(true),
        id = convertJSXIdentifier(node.name),
        key = id.name;
      if (hasChildren && key === "children") return;
      if (t__namespace.isJSXExpressionContainer(value)) {
        if (key === "ref") {
          if (config.generate === "ssr") return;
          // Normalize expressions for non-null and type-as
          while (
          t__namespace.isTSNonNullExpression(value.expression) ||
          t__namespace.isTSAsExpression(value.expression) ||
          t__namespace.isTSSatisfiesExpression(value.expression))
          {
            value.expression = value.expression.expression;
          }
          let binding,
            isConstant =
            t__namespace.isIdentifier(value.expression) && (
            binding = path.scope.getBinding(value.expression.name)) && (
            binding.kind === "const" || binding.kind === "module");
          if (!isConstant && t__namespace.isLVal(value.expression)) {
            const refIdentifier = path.scope.generateUidIdentifier("_ref$");
            runningObject.push(
            t__namespace.objectMethod(
            "method",
            t__namespace.identifier("ref"),
            [t__namespace.identifier("r$")],
            t__namespace.blockStatement([
            t__namespace.variableDeclaration("var", [
            t__namespace.variableDeclarator(refIdentifier, value.expression)]),

            t__namespace.expressionStatement(
            t__namespace.conditionalExpression(
            t__namespace.binaryExpression(
            "===",
            t__namespace.unaryExpression("typeof", refIdentifier),
            t__namespace.stringLiteral("function")),

            t__namespace.callExpression(refIdentifier, [t__namespace.identifier("r$")]),
            t__namespace.assignmentExpression("=", value.expression, t__namespace.identifier("r$"))))])));





          } else if (!isConstant && t__namespace.isOptionalMemberExpression(value.expression)) {
            const refIdentifier = path.scope.generateUidIdentifier("_ref$");
            runningObject.push(
            t__namespace.objectMethod(
            "method",
            t__namespace.identifier("ref"),
            [t__namespace.identifier("r$")],
            t__namespace.blockStatement([
            t__namespace.variableDeclaration("var", [
            t__namespace.variableDeclarator(refIdentifier, value.expression)]),


            t__namespace.expressionStatement(
            t__namespace.conditionalExpression(
            t__namespace.binaryExpression(
            "===",
            t__namespace.unaryExpression("typeof", refIdentifier),
            t__namespace.stringLiteral("function")),

            t__namespace.callExpression(refIdentifier, [t__namespace.identifier("r$")]),
            t__namespace.logicalExpression(
            "&&",
            t__namespace.unaryExpression(
            "!",
            t__namespace.unaryExpression("!", t__namespace.identifier(value.expression.object.name))),

            t__namespace.assignmentExpression(
            "=",
            t__namespace.memberExpression(
            t__namespace.identifier(value.expression.object.name),
            t__namespace.identifier(value.expression.property.name)),

            t__namespace.identifier("r$")))))])));







          } else if (isConstant || t__namespace.isFunction(value.expression)) {
            runningObject.push(t__namespace.objectProperty(t__namespace.identifier("ref"), value.expression));
          } else if (t__namespace.isCallExpression(value.expression)) {
            const refIdentifier = path.scope.generateUidIdentifier("_ref$");
            runningObject.push(
            t__namespace.objectMethod(
            "method",
            t__namespace.identifier("ref"),
            [t__namespace.identifier("r$")],
            t__namespace.blockStatement([
            t__namespace.variableDeclaration("var", [
            t__namespace.variableDeclarator(refIdentifier, value.expression)]),

            t__namespace.expressionStatement(
            t__namespace.logicalExpression(
            "&&",
            t__namespace.binaryExpression(
            "===",
            t__namespace.unaryExpression("typeof", refIdentifier),
            t__namespace.stringLiteral("function")),

            t__namespace.callExpression(refIdentifier, [t__namespace.identifier("r$")])))])));





          }
        } else if (
        isDynamic(attribute.get("value").get("expression"), {
          checkMember: true,
          checkTags: true
        }))
        {
          if (
          config.wrapConditionals &&
          config.generate !== "ssr" && (
          t__namespace.isLogicalExpression(value.expression) ||
          t__namespace.isConditionalExpression(value.expression)))
          {
            const expr = transformCondition(attribute.get("value").get("expression"), true);

            runningObject.push(
            t__namespace.objectMethod(
            "get",
            id,
            [],
            t__namespace.blockStatement([t__namespace.returnStatement(expr.body)]),
            !t__namespace.isValidIdentifier(key)));


          } else if (
          t__namespace.isCallExpression(value.expression) &&
          t__namespace.isArrowFunctionExpression(value.expression.callee) &&
          value.expression.callee.params.length === 0)
          {
            const callee = value.expression.callee;
            const body = t__namespace.isBlockStatement(callee.body) ?
            callee.body :
            t__namespace.blockStatement([t__namespace.returnStatement(callee.body)]);

            runningObject.push(t__namespace.objectMethod("get", id, [], body, !t__namespace.isValidIdentifier(key)));
          } else {
            runningObject.push(
            t__namespace.objectMethod(
            "get",
            id,
            [],
            t__namespace.blockStatement([t__namespace.returnStatement(value.expression)]),
            !t__namespace.isValidIdentifier(key)));


          }
        } else runningObject.push(t__namespace.objectProperty(id, value.expression));} else
      runningObject.push(t__namespace.objectProperty(id, value));
    }
  });

  const childResult = transformComponentChildren(path.get("children"), config);
  if (childResult && childResult[0]) {
    if (childResult[1]) {
      const body =
      t__namespace.isCallExpression(childResult[0]) && t__namespace.isFunction(childResult[0].arguments[0]) ?
      childResult[0].arguments[0].body :
      childResult[0].body ?
      childResult[0].body :
      childResult[0];
      runningObject.push(
      t__namespace.objectMethod(
      "get",
      t__namespace.identifier("children"),
      [],
      t__namespace.isExpression(body) ? t__namespace.blockStatement([t__namespace.returnStatement(body)]) : body));


    } else runningObject.push(t__namespace.objectProperty(t__namespace.identifier("children"), childResult[0]));
  }
  if (runningObject.length || !props.length) props.push(t__namespace.objectExpression(runningObject));

  if (props.length > 1 || dynamicSpread) {
    props = [t__namespace.callExpression(registerImportMethod(path, "mergeProps"), props)];
  }
  const componentArgs = [tagId, props[0]];
  exprs.push(t__namespace.callExpression(registerImportMethod(path, "createComponent"), componentArgs));

  // handle hoisting conditionals
  if (exprs.length > 1) {
    const ret = exprs.pop();
    exprs = [
    t__namespace.callExpression(
    t__namespace.arrowFunctionExpression([], t__namespace.blockStatement([...exprs, t__namespace.returnStatement(ret)])),
    [])];


  }
  return { exprs, template: "", component: true };
}

function transformComponentChildren(children, config) {
  const filteredChildren = filterChildren(children);
  if (!filteredChildren.length) return;
  let dynamic = false;
  let pathNodes = [];

  let transformedChildren = filteredChildren.reduce((memo, path) => {
    if (t__namespace.isJSXText(path.node)) {
      const v = htmlEntities.decode(trimWhitespace(path.node.extra.raw));
      if (v.length) {
        pathNodes.push(path.node);
        memo.push(t__namespace.stringLiteral(v));
      }
    } else {
      const child = transformNode(path, {
        topLevel: true,
        componentChild: true,
        lastElement: true
      });
      dynamic = dynamic || child.dynamic;
      if (
      config.generate === "ssr" &&
      filteredChildren.length > 1 &&
      child.dynamic &&
      t__namespace.isFunction(child.exprs[0]))
      {
        child.exprs[0] = child.exprs[0].body;
      }
      pathNodes.push(path.node);
      memo.push(getCreateTemplate(config, path, child)(path, child, filteredChildren.length > 1));
    }
    return memo;
  }, []);

  if (transformedChildren.length === 1) {
    transformedChildren = transformedChildren[0];
    if (
    !t__namespace.isJSXExpressionContainer(pathNodes[0]) &&
    !t__namespace.isJSXSpreadChild(pathNodes[0]) &&
    !t__namespace.isJSXText(pathNodes[0]))
    {
      transformedChildren =
      t__namespace.isCallExpression(transformedChildren) &&
      !transformedChildren.arguments.length &&
      !t__namespace.isIdentifier(transformedChildren.callee) ?
      transformedChildren.callee :
      t__namespace.arrowFunctionExpression([], transformedChildren);
      dynamic = true;
    }
  } else {
    transformedChildren = t__namespace.arrowFunctionExpression([], t__namespace.arrayExpression(transformedChildren));
    dynamic = true;
  }
  return [transformedChildren, dynamic];
}

function transformFragmentChildren(children, results, config) {
  const filteredChildren = filterChildren(children),
    childNodes = filteredChildren.reduce((memo, path) => {
      if (t__namespace.isJSXText(path.node)) {
        const v = htmlEntities.decode(trimWhitespace(path.node.extra.raw));
        if (v.length) memo.push(t__namespace.stringLiteral(v));
      } else {
        const child = transformNode(path, { topLevel: true, fragmentChild: true, lastElement: true });
        memo.push(getCreateTemplate(config, path, child)(path, child, true));
      }
      return memo;
    }, []);
  results.exprs.push(childNodes.length === 1 ? childNodes[0] : t__namespace.arrayExpression(childNodes));
}

function transformJSX(path, state) {
  if (state.skip) return;

  const config = getConfig(path);

  const replace = transformThis(path);
  const result = transformNode(
  path,
  t__namespace.isJSXFragment(path.node) ?
  {} :
  {
    topLevel: true,
    lastElement: true
  });


  const template = getCreateTemplate(config, path, result);

  path.replaceWith(replace(template(path, result, false)));

  path.traverse({
    enter(path) {
      if (
      path.node.leadingComments &&
      path.node.leadingComments[0] &&
      path.node.leadingComments[0].value.trim() === config.staticMarker)
      {
        path.node.leadingComments.shift();
      }
    }
  });
}

function getTargetFunctionParent(path, parent) {
  let current = path.scope.getFunctionParent();
  while (current !== parent && current.path.isArrowFunctionExpression()) {
    current = current.path.parentPath.scope.getFunctionParent();
  }
  return current;
}

function transformThis(path) {
  const parent = path.scope.getFunctionParent();
  let thisId;
  path.traverse({
    ThisExpression(path) {
      const current = getTargetFunctionParent(path, parent);
      if (current === parent) {
        thisId || (thisId = path.scope.generateUidIdentifier("self$"));
        path.replaceWith(thisId);
      }
    },
    JSXElement(path) {
      let source = path.get("openingElement").get("name");
      while (source.isJSXMemberExpression()) {
        source = source.get("object");
      }
      if (source.isJSXIdentifier() && source.node.name === "this") {
        const current = getTargetFunctionParent(path, parent);
        if (current === parent) {
          thisId || (thisId = path.scope.generateUidIdentifier("self$"));
          source.replaceWith(t__namespace.jsxIdentifier(thisId.name));

          if (path.node.closingElement) {
            path.node.closingElement.name = path.node.openingElement.name;
          }
        }
      }
    }
  });
  return (node) => {
    if (thisId) {
      if (!parent || parent.block.type === "ClassMethod") {
        const decl = t__namespace.variableDeclaration("const", [
        t__namespace.variableDeclarator(thisId, t__namespace.thisExpression())]);

        if (parent) {
          const stmt = path.getStatementParent();
          stmt.insertBefore(decl);
        } else {
          return t__namespace.callExpression(
          t__namespace.arrowFunctionExpression([], t__namespace.blockStatement([decl, t__namespace.returnStatement(node)])),
          []);

        }
      } else {
        parent.push({
          id: thisId,
          init: t__namespace.thisExpression(),
          kind: "const"
        });
      }
    }
    return node;
  };
}

function transformNode(path, info = {}) {
  const config = getConfig(path);
  const node = path.node;
  let staticValue;
  if (t__namespace.isJSXElement(node)) {
    return transformElement(config, path, info);
  } else if (t__namespace.isJSXFragment(node)) {
    let results = { template: "", declarations: [], exprs: [], dynamics: [] };
    // <><div /><Component /></>
    transformFragmentChildren(path.get("children"), results, config);
    return results;
  } else if (t__namespace.isJSXText(node) || (staticValue = getStaticExpression(path)) !== false) {
    const text =
    staticValue !== undefined ?
    info.doNotEscape ?
    staticValue.toString() :
    escapeHTML(staticValue.toString()) :
    trimWhitespace(node.extra.raw);
    if (!text.length) return null;
    const results = {
      template: text,
      declarations: [],
      exprs: [],
      dynamics: [],
      postExprs: [],
      text: true
    };
    if (!info.skipId && config.generate !== "ssr")
    results.id = path.scope.generateUidIdentifier("el$");
    return results;
  } else if (t__namespace.isJSXExpressionContainer(node)) {
    if (t__namespace.isJSXEmptyExpression(node.expression)) return null;
    if (
    !isDynamic(path.get("expression"), {
      checkMember: true,
      checkTags: !!info.componentChild,
      native: !info.componentChild
    }))
    {
      return { exprs: [node.expression], template: "" };
    }
    const expr =
    config.wrapConditionals &&
    config.generate !== "ssr" && (
    t__namespace.isLogicalExpression(node.expression) || t__namespace.isConditionalExpression(node.expression)) ?
    transformCondition(path.get("expression"), info.componentChild || info.fragmentChild) :
    !info.componentChild && (
    config.generate !== "ssr" || info.fragmentChild) &&
    t__namespace.isCallExpression(node.expression) &&
    !t__namespace.isCallExpression(node.expression.callee) &&
    !t__namespace.isMemberExpression(node.expression.callee) &&
    node.expression.arguments.length === 0 ?
    node.expression.callee :
    t__namespace.arrowFunctionExpression([], node.expression);
    return {
      exprs:
      expr.length > 1 ?
      [
      t__namespace.callExpression(
      t__namespace.arrowFunctionExpression(
      [],
      t__namespace.blockStatement([expr[0], t__namespace.returnStatement(expr[1])])),

      [])] :


      [expr],
      template: "",
      dynamic: true
    };
  } else if (t__namespace.isJSXSpreadChild(node)) {
    if (
    !isDynamic(path.get("expression"), {
      checkMember: true,
      native: !info.componentChild
    }))

    return { exprs: [node.expression], template: "" };
    const expr = t__namespace.arrowFunctionExpression([], node.expression);
    return {
      exprs: [expr],
      template: "",
      dynamic: true
    };
  }
}

function getCreateTemplate(config, path, result) {
  if (result.tagName && result.renderer === "dom" || config.generate === "dom") {
    return createTemplate$2;
  }

  if (result.renderer === "ssr" || config.generate === "ssr") {
    return createTemplate$1;
  }

  return createTemplate;
}

function transformElement(config, path, info = {}) {
  const node = path.node;
  let tagName = getTagName(node);
  // <Component ...></Component>
  if (isComponent(tagName)) return transformComponent(path);

  // <div ...></div>
  // const element = getTransformElemet(config, path, tagName);

  const tagRenderer = (config.renderers ?? []).find((renderer) =>
  renderer.elements.includes(tagName));


  if (tagRenderer?.name === "dom" || getConfig(path).generate === "dom") {
    return transformElement$3(path, info);
  }

  if (getConfig(path).generate === "ssr") {
    return transformElement$2(path, info);
  }

  return transformElement$1(path);
}

// import parse5 from "parse5";
const parse5 = require("parse5");

/** `bodyElement` will be used as a `context` (The place where we run `innerHTML`) */
const bodyElement = parse5.parse(
`<!DOCTYPE html><html><head></head><body></body></html>`
// @ts-ignore
).childNodes[1].childNodes[1];

function innerHTML(htmlFragment) {
  /** `htmlFragment` will be parsed as if it was set to the `bodyElement`'s `innerHTML` property. */
  const parsedFragment = parse5.parseFragment(bodyElement, htmlFragment);

  /** `serialize` returns back a string from the parsed nodes */
  return parse5.serialize(parsedFragment);
}

/**
 * Returns an object with information when the markup is invalid
 *
 * @param {string} html - The html string to validate
 * @returns {{
 *   html: string; // html stripped of attributives and content
 *   browser: string; // what the browser returned from evaluating `html`
 * } | null}
 */
function isInvalidMarkup(html) {
  html = html

  // normalize dom-expressions comments, so comments location are also validated
  .replaceAll("<!>", "<!---->").
  replaceAll("<!$>", "<!--$-->").
  replaceAll("<!/>", "<!--/-->")

  // replace text nodes
  // text nodes are problematic, think "doesn't" vs "doesn&#39;t"
  // we can detect if text nodes were moved by the browser when the `#text` moves

  // replace text nodes that isnt in between tags by `#text`
  .replace(/^[^<]+/, "#text").
  replace(/[^>]+$/, "#text")
  // replace text nodes in between tags by `#text`
  .replace(/>[^<]+</gi, ">#text<")

  // remove attributes (the lack of quotes will make it mismatch)
  // attributes are not longer added to `templateWithClosingTags`
  // https://github.com/solidjs/solid/issues/2338
  // .replace(/<([a-z0-9-:]+)\s+[^>]+>/gi, "<$1>")

  // fix escaping, so doesnt mess up the validation
  // `&lt;script>a();&lt;/script>` -> `&lt;script&gt;a();&lt;/script&gt;`
  .replace(/&lt;([^>]+)>/gi, "&lt;$1&gt;");

  // edge cases (safe to assume they will use the partial in the right place)

  // table cells
  if (/^<(td|th)>/.test(html)) {
    html = `<table><tbody><tr>${html}</tr></tbody></table>`;
  }

  // table rows
  if (/^<tr>/.test(html)) {
    html = `<table><tbody>${html}</tbody></table>`;
  }

  // table misc
  if (/^<col>/.test(html)) {
    html = `<table><colgroup>${html}</colgroup></table>`;
  }

  // table components
  if (/^<(thead|tbody|tfoot|colgroup|caption)>/.test(html)) {
    html = `<table>${html}</table>`;
  }

  // skip when equal to:
  switch (html) {
    // empty table components
    case "<table></table>":
    case "<table><thead></thead></table>":
    case "<table><tbody></tbody></table>":
    case "<table><thead></thead><tbody></tbody></table>":{
        return;
      }}


  /** Parse HTML. `browser` is a string with the supposed resulting html of a real `innerHTML` call */
  const browser = innerHTML(html);

  if (html.toLowerCase() !== browser.toLowerCase()) {
    return {
      html,
      browser
    };
  }
}

// add to the top/bottom of the module.
var postprocess = ((path, state) => {
  if (state.skip) return;

  if (path.scope.data.events) {
    path.node.body.push(
    t__namespace.expressionStatement(
    t__namespace.callExpression(
    registerImportMethod(path, "delegateEvents", getRendererConfig(path, "dom").moduleName),
    [t__namespace.arrayExpression(Array.from(path.scope.data.events).map((e) => t__namespace.stringLiteral(e)))])));



  }
  if (path.scope.data.templates?.length) {
    if (path.hub.file.metadata.config.validate) {
      for (const template of path.scope.data.templates) {
        const html = template.templateWithClosingTags;
        // not sure when/why this is not a string
        if (typeof html === "string") {
          const result = isInvalidMarkup(html);
          if (result) {
            const message =
            "\nThe HTML provided is malformed and will yield unexpected output when evaluated by a browser.\n";
            console.warn(message);
            console.warn("User HTML:\n", result.html);
            console.warn("Browser HTML:\n", result.browser);
            console.warn("Original HTML:\n", html);
            // throw path.buildCodeFrameError();
          }
        }
      }
    }
    let domTemplates = path.scope.data.templates.filter((temp) => temp.renderer === "dom");
    let ssrTemplates = path.scope.data.templates.filter((temp) => temp.renderer === "ssr");
    domTemplates.length > 0 && appendTemplates$1(path, domTemplates);
    ssrTemplates.length > 0 && appendTemplates(path, ssrTemplates);
  }
});

var config = {
  moduleName: "dom",
  generate: "dom",
  hydratable: false,
  delegateEvents: true,
  delegatedEvents: [],
  builtIns: [],
  requireImportSource: false,
  wrapConditionals: true,
  omitNestedClosingTags: false,
  omitLastClosingTag: true,
  omitQuotes: true,
  contextToCustomElements: false,
  staticMarker: "@once",
  effectWrapper: "effect",
  memoWrapper: "memo",
  validate: true,
  inlineStyles: true
};

var preprocess = ((path, state) => {
  const merged = path.hub.file.metadata.config = Object.assign({}, config, state.opts);
  const lib = merged.requireImportSource;
  if (lib) {
    const comments = path.hub.file.ast.comments;
    let process = false;
    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];
      const pieces = comment.value.split("@jsxImportSource");
      if (pieces.length === 2 && pieces[1].trim() === lib) {
        process = true;
        break;
      }
    }
    if (!process) {
      state.skip = true;
      return;
    }
  }
});

var index = (() =>



{
  return {
    name: "JSX DOM Expressions",
    inherits: SyntaxJSX.default,
    visitor: {
      JSXElement: transformJSX,
      JSXFragment: transformJSX,
      Program: {
        enter: preprocess,
        exit: postprocess
      }
    }
  };
});

module.exports = index;
