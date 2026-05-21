"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  Feature: () => Feature,
  OpaqueReference: () => OpaqueReference,
  Serializer: () => Serializer,
  SerovalConflictedNodeIdError: () => SerovalConflictedNodeIdError,
  SerovalDepthLimitError: () => SerovalDepthLimitError,
  SerovalDeserializationError: () => SerovalDeserializationError,
  SerovalError: () => SerovalError,
  SerovalMalformedNodeError: () => SerovalMalformedNodeError,
  SerovalMissingInstanceError: () => SerovalMissingInstanceError,
  SerovalMissingPluginError: () => SerovalMissingPluginError,
  SerovalMissingReferenceError: () => SerovalMissingReferenceError,
  SerovalMissingReferenceForIdError: () => SerovalMissingReferenceForIdError,
  SerovalMode: () => SerovalMode,
  SerovalParserError: () => SerovalParserError,
  SerovalSerializationError: () => SerovalSerializationError,
  SerovalUnknownTypedArrayError: () => SerovalUnknownTypedArrayError,
  SerovalUnsupportedNodeError: () => SerovalUnsupportedNodeError,
  SerovalUnsupportedTypeError: () => SerovalUnsupportedTypeError,
  compileJSON: () => compileJSON,
  createPlugin: () => createPlugin,
  createReference: () => createReference,
  createStream: () => createStream,
  crossSerialize: () => crossSerialize,
  crossSerializeAsync: () => crossSerializeAsync,
  crossSerializeStream: () => crossSerializeStream,
  deserialize: () => deserialize2,
  fromCrossJSON: () => fromCrossJSON,
  fromJSON: () => fromJSON,
  getCrossReferenceHeader: () => getCrossReferenceHeader,
  resolvePlugins: () => resolvePlugins,
  serialize: () => serialize2,
  serializeAsync: () => serializeAsync,
  toCrossJSON: () => toCrossJSON,
  toCrossJSONAsync: () => toCrossJSONAsync,
  toCrossJSONStream: () => toCrossJSONStream,
  toJSON: () => toJSON,
  toJSONAsync: () => toJSONAsync
});
module.exports = __toCommonJS(src_exports);

// src/core/compat.ts
var Feature = /* @__PURE__ */ ((Feature2) => {
  Feature2[Feature2["AggregateError"] = 1] = "AggregateError";
  Feature2[Feature2["ArrowFunction"] = 2] = "ArrowFunction";
  Feature2[Feature2["ErrorPrototypeStack"] = 4] = "ErrorPrototypeStack";
  Feature2[Feature2["ObjectAssign"] = 8] = "ObjectAssign";
  Feature2[Feature2["BigIntTypedArray"] = 16] = "BigIntTypedArray";
  Feature2[Feature2["RegExp"] = 32] = "RegExp";
  return Feature2;
})(Feature || {});
var ALL_ENABLED = 1 /* AggregateError */ | 2 /* ArrowFunction */ | 4 /* ErrorPrototypeStack */ | 8 /* ObjectAssign */ | 16 /* BigIntTypedArray */ | 32 /* RegExp */;

// src/core/symbols.ts
var SYM_ASYNC_ITERATOR = Symbol.asyncIterator;
var SYM_HAS_INSTANCE = Symbol.hasInstance;
var SYM_IS_CONCAT_SPREADABLE = Symbol.isConcatSpreadable;
var SYM_ITERATOR = Symbol.iterator;
var SYM_MATCH = Symbol.match;
var SYM_MATCH_ALL = Symbol.matchAll;
var SYM_REPLACE = Symbol.replace;
var SYM_SEARCH = Symbol.search;
var SYM_SPECIES = Symbol.species;
var SYM_SPLIT = Symbol.split;
var SYM_TO_PRIMITIVE = Symbol.toPrimitive;
var SYM_TO_STRING_TAG = Symbol.toStringTag;
var SYM_UNSCOPABLES = Symbol.unscopables;

// src/core/constants.ts
var SYMBOL_STRING = {
  [0 /* AsyncIterator */]: "Symbol.asyncIterator",
  [1 /* HasInstance */]: "Symbol.hasInstance",
  [2 /* IsConcatSpreadable */]: "Symbol.isConcatSpreadable",
  [3 /* Iterator */]: "Symbol.iterator",
  [4 /* Match */]: "Symbol.match",
  [5 /* MatchAll */]: "Symbol.matchAll",
  [6 /* Replace */]: "Symbol.replace",
  [7 /* Search */]: "Symbol.search",
  [8 /* Species */]: "Symbol.species",
  [9 /* Split */]: "Symbol.split",
  [10 /* ToPrimitive */]: "Symbol.toPrimitive",
  [11 /* ToStringTag */]: "Symbol.toStringTag",
  [12 /* Unscopables */]: "Symbol.unscopables"
};
var INV_SYMBOL_REF = {
  [SYM_ASYNC_ITERATOR]: 0 /* AsyncIterator */,
  [SYM_HAS_INSTANCE]: 1 /* HasInstance */,
  [SYM_IS_CONCAT_SPREADABLE]: 2 /* IsConcatSpreadable */,
  [SYM_ITERATOR]: 3 /* Iterator */,
  [SYM_MATCH]: 4 /* Match */,
  [SYM_MATCH_ALL]: 5 /* MatchAll */,
  [SYM_REPLACE]: 6 /* Replace */,
  [SYM_SEARCH]: 7 /* Search */,
  [SYM_SPECIES]: 8 /* Species */,
  [SYM_SPLIT]: 9 /* Split */,
  [SYM_TO_PRIMITIVE]: 10 /* ToPrimitive */,
  [SYM_TO_STRING_TAG]: 11 /* ToStringTag */,
  [SYM_UNSCOPABLES]: 12 /* Unscopables */
};
var SYMBOL_REF = {
  [0 /* AsyncIterator */]: SYM_ASYNC_ITERATOR,
  [1 /* HasInstance */]: SYM_HAS_INSTANCE,
  [2 /* IsConcatSpreadable */]: SYM_IS_CONCAT_SPREADABLE,
  [3 /* Iterator */]: SYM_ITERATOR,
  [4 /* Match */]: SYM_MATCH,
  [5 /* MatchAll */]: SYM_MATCH_ALL,
  [6 /* Replace */]: SYM_REPLACE,
  [7 /* Search */]: SYM_SEARCH,
  [8 /* Species */]: SYM_SPECIES,
  [9 /* Split */]: SYM_SPLIT,
  [10 /* ToPrimitive */]: SYM_TO_PRIMITIVE,
  [11 /* ToStringTag */]: SYM_TO_STRING_TAG,
  [12 /* Unscopables */]: SYM_UNSCOPABLES
};
var CONSTANT_STRING = {
  [2 /* True */]: "!0",
  [3 /* False */]: "!1",
  [1 /* Undefined */]: "void 0",
  [0 /* Null */]: "null",
  [4 /* NegZero */]: "-0",
  [5 /* Inf */]: "1/0",
  [6 /* NegInf */]: "-1/0",
  [7 /* Nan */]: "0/0"
};
var NIL = void 0;
var CONSTANT_VAL = {
  [2 /* True */]: true,
  [3 /* False */]: false,
  [1 /* Undefined */]: NIL,
  [0 /* Null */]: null,
  [4 /* NegZero */]: -0,
  [5 /* Inf */]: Number.POSITIVE_INFINITY,
  [6 /* NegInf */]: Number.NEGATIVE_INFINITY,
  [7 /* Nan */]: Number.NaN
};
var ERROR_CONSTRUCTOR_STRING = {
  [0 /* Error */]: "Error",
  [1 /* EvalError */]: "EvalError",
  [2 /* RangeError */]: "RangeError",
  [3 /* ReferenceError */]: "ReferenceError",
  [4 /* SyntaxError */]: "SyntaxError",
  [5 /* TypeError */]: "TypeError",
  [6 /* URIError */]: "URIError"
};
var ERROR_CONSTRUCTOR = {
  [0 /* Error */]: Error,
  [1 /* EvalError */]: EvalError,
  [2 /* RangeError */]: RangeError,
  [3 /* ReferenceError */]: ReferenceError,
  [4 /* SyntaxError */]: SyntaxError,
  [5 /* TypeError */]: TypeError,
  [6 /* URIError */]: URIError
};

// src/core/node.ts
function createSerovalNode(t, i, s, c, m, p, e, a, f, b, o, l) {
  return {
    t,
    i,
    s,
    c,
    m,
    p,
    e,
    a,
    f,
    b,
    o,
    l
  };
}

// src/core/literals.ts
function createConstantNode(value) {
  return createSerovalNode(
    2 /* Constant */,
    NIL,
    value,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL
  );
}
var TRUE_NODE = /* @__PURE__ */ createConstantNode(
  2 /* True */
);
var FALSE_NODE = /* @__PURE__ */ createConstantNode(
  3 /* False */
);
var UNDEFINED_NODE = /* @__PURE__ */ createConstantNode(
  1 /* Undefined */
);
var NULL_NODE = /* @__PURE__ */ createConstantNode(
  0 /* Null */
);
var NEG_ZERO_NODE = /* @__PURE__ */ createConstantNode(
  4 /* NegZero */
);
var INFINITY_NODE = /* @__PURE__ */ createConstantNode(
  5 /* Inf */
);
var NEG_INFINITY_NODE = /* @__PURE__ */ createConstantNode(
  6 /* NegInf */
);
var NAN_NODE = /* @__PURE__ */ createConstantNode(7 /* Nan */);

// src/core/string.ts
function serializeChar(str) {
  switch (str) {
    case '"':
      return '\\"';
    case "\\":
      return "\\\\";
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case "\b":
      return "\\b";
    case "	":
      return "\\t";
    case "\f":
      return "\\f";
    case "<":
      return "\\x3C";
    case "\u2028":
      return "\\u2028";
    case "\u2029":
      return "\\u2029";
    default:
      return NIL;
  }
}
function serializeString(str) {
  let result = "";
  let lastPos = 0;
  let replacement;
  for (let i = 0, len = str.length; i < len; i++) {
    replacement = serializeChar(str[i]);
    if (replacement) {
      result += str.slice(lastPos, i) + replacement;
      lastPos = i + 1;
    }
  }
  if (lastPos === 0) {
    result = str;
  } else {
    result += str.slice(lastPos);
  }
  return result;
}
function deserializeReplacer(str) {
  switch (str) {
    case "\\\\":
      return "\\";
    case '\\"':
      return '"';
    case "\\n":
      return "\n";
    case "\\r":
      return "\r";
    case "\\b":
      return "\b";
    case "\\t":
      return "	";
    case "\\f":
      return "\f";
    case "\\x3C":
      return "<";
    case "\\u2028":
      return "\u2028";
    case "\\u2029":
      return "\u2029";
    default:
      return str;
  }
}
function deserializeString(str) {
  return str.replace(
    /(\\\\|\\"|\\n|\\r|\\b|\\t|\\f|\\u2028|\\u2029|\\x3C)/g,
    deserializeReplacer
  );
}

// src/core/keys.ts
var REFERENCES_KEY = "__SEROVAL_REFS__";
var GLOBAL_CONTEXT_REFERENCES = "$R";
var GLOBAL_CONTEXT_R = `self.${GLOBAL_CONTEXT_REFERENCES}`;
function getCrossReferenceHeader(id) {
  if (id == null) {
    return `${GLOBAL_CONTEXT_R}=${GLOBAL_CONTEXT_R}||[]`;
  }
  return `(${GLOBAL_CONTEXT_R}=${GLOBAL_CONTEXT_R}||{})["${serializeString(
    id
  )}"]=[]`;
}

// src/core/reference.ts
var REFERENCE = /* @__PURE__ */ new Map();
var INV_REFERENCE = /* @__PURE__ */ new Map();
function createReference(id, value) {
  REFERENCE.set(value, id);
  INV_REFERENCE.set(id, value);
  return value;
}
function hasReferenceID(value) {
  return REFERENCE.has(value);
}
function hasReference(id) {
  return INV_REFERENCE.has(id);
}
function getReferenceID(value) {
  if (hasReferenceID(value)) {
    return REFERENCE.get(value);
  }
  throw new SerovalMissingReferenceError(value);
}
function getReference(id) {
  if (hasReference(id)) {
    return INV_REFERENCE.get(id);
  }
  throw new SerovalMissingReferenceForIdError(id);
}
if (typeof globalThis !== "undefined") {
  Object.defineProperty(globalThis, REFERENCES_KEY, {
    value: INV_REFERENCE,
    configurable: true,
    writable: false,
    enumerable: false
  });
} else if (typeof window !== "undefined") {
  Object.defineProperty(window, REFERENCES_KEY, {
    value: INV_REFERENCE,
    configurable: true,
    writable: false,
    enumerable: false
  });
} else if (typeof self !== "undefined") {
  Object.defineProperty(self, REFERENCES_KEY, {
    value: INV_REFERENCE,
    configurable: true,
    writable: false,
    enumerable: false
  });
} else if (typeof global !== "undefined") {
  Object.defineProperty(global, REFERENCES_KEY, {
    value: INV_REFERENCE,
    configurable: true,
    writable: false,
    enumerable: false
  });
}

// src/core/utils/error.ts
function getErrorConstructor(error) {
  if (error instanceof EvalError) {
    return 1 /* EvalError */;
  }
  if (error instanceof RangeError) {
    return 2 /* RangeError */;
  }
  if (error instanceof ReferenceError) {
    return 3 /* ReferenceError */;
  }
  if (error instanceof SyntaxError) {
    return 4 /* SyntaxError */;
  }
  if (error instanceof TypeError) {
    return 5 /* TypeError */;
  }
  if (error instanceof URIError) {
    return 6 /* URIError */;
  }
  return 0 /* Error */;
}
function getInitialErrorOptions(error) {
  const construct = ERROR_CONSTRUCTOR_STRING[getErrorConstructor(error)];
  if (error.name !== construct) {
    return { name: error.name };
  }
  if (error.constructor.name !== construct) {
    return { name: error.constructor.name };
  }
  return {};
}
function getErrorOptions(error, features) {
  let options = getInitialErrorOptions(error);
  const names = Object.getOwnPropertyNames(error);
  for (let i = 0, len = names.length, name; i < len; i++) {
    name = names[i];
    if (name !== "name" && name !== "message") {
      if (name === "stack") {
        if (features & 4 /* ErrorPrototypeStack */) {
          options = options || {};
          options[name] = error[name];
        }
      } else {
        options = options || {};
        options[name] = error[name];
      }
    }
  }
  return options;
}

// src/core/utils/get-object-flag.ts
function getObjectFlag(obj) {
  if (Object.isFrozen(obj)) {
    return 3 /* Frozen */;
  }
  if (Object.isSealed(obj)) {
    return 2 /* Sealed */;
  }
  if (Object.isExtensible(obj)) {
    return 0 /* None */;
  }
  return 1 /* NonExtensible */;
}

// src/core/base-primitives.ts
function createNumberNode(value) {
  switch (value) {
    case Number.POSITIVE_INFINITY:
      return INFINITY_NODE;
    case Number.NEGATIVE_INFINITY:
      return NEG_INFINITY_NODE;
  }
  if (value !== value) {
    return NAN_NODE;
  }
  if (Object.is(value, -0)) {
    return NEG_ZERO_NODE;
  }
  return createSerovalNode(
    0 /* Number */,
    NIL,
    value,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function createStringNode(value) {
  return createSerovalNode(
    1 /* String */,
    NIL,
    serializeString(value),
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function createBigIntNode(current) {
  return createSerovalNode(
    3 /* BigInt */,
    NIL,
    "" + current,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function createIndexedValueNode(id) {
  return createSerovalNode(
    4 /* IndexedValue */,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function createDateNode(id, current) {
  const timestamp = current.valueOf();
  return createSerovalNode(
    5 /* Date */,
    id,
    timestamp !== timestamp ? "" : current.toISOString(),
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function createRegExpNode(id, current) {
  return createSerovalNode(
    6 /* RegExp */,
    id,
    NIL,
    serializeString(current.source),
    current.flags,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function createWKSymbolNode(id, current) {
  return createSerovalNode(
    17 /* WKSymbol */,
    id,
    INV_SYMBOL_REF[current],
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function createReferenceNode(id, ref) {
  return createSerovalNode(
    18 /* Reference */,
    id,
    serializeString(getReferenceID(ref)),
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function createPluginNode(id, tag, value) {
  return createSerovalNode(
    25 /* Plugin */,
    id,
    value,
    serializeString(tag),
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function createArrayNode(id, current, parsedItems) {
  return createSerovalNode(
    9 /* Array */,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    parsedItems,
    NIL,
    NIL,
    getObjectFlag(current),
    NIL
  );
}
function createBoxedNode(id, boxed) {
  return createSerovalNode(
    21 /* Boxed */,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    boxed,
    NIL,
    NIL,
    NIL
  );
}
function createTypedArrayNode(id, current, buffer) {
  return createSerovalNode(
    15 /* TypedArray */,
    id,
    NIL,
    current.constructor.name,
    NIL,
    NIL,
    NIL,
    NIL,
    buffer,
    current.byteOffset,
    NIL,
    current.length
  );
}
function createBigIntTypedArrayNode(id, current, buffer) {
  return createSerovalNode(
    16 /* BigIntTypedArray */,
    id,
    NIL,
    current.constructor.name,
    NIL,
    NIL,
    NIL,
    NIL,
    buffer,
    current.byteOffset,
    NIL,
    current.byteLength
  );
}
function createDataViewNode(id, current, buffer) {
  return createSerovalNode(
    20 /* DataView */,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    buffer,
    current.byteOffset,
    NIL,
    current.byteLength
  );
}
function createErrorNode(id, current, options) {
  return createSerovalNode(
    13 /* Error */,
    id,
    getErrorConstructor(current),
    NIL,
    serializeString(current.message),
    options,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function createAggregateErrorNode(id, current, options) {
  return createSerovalNode(
    14 /* AggregateError */,
    id,
    getErrorConstructor(current),
    NIL,
    serializeString(current.message),
    options,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function createSetNode(id, items) {
  return createSerovalNode(
    7 /* Set */,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    items,
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function createIteratorFactoryInstanceNode(factory, items) {
  return createSerovalNode(
    28 /* IteratorFactoryInstance */,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    [factory, items],
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function createAsyncIteratorFactoryInstanceNode(factory, items) {
  return createSerovalNode(
    30 /* AsyncIteratorFactoryInstance */,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    [factory, items],
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function createStreamConstructorNode(id, factory, sequence) {
  return createSerovalNode(
    31 /* StreamConstructor */,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    sequence,
    factory,
    NIL,
    NIL,
    NIL
  );
}
function createStreamNextNode(id, parsed) {
  return createSerovalNode(
    32 /* StreamNext */,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    parsed,
    NIL,
    NIL,
    NIL
  );
}
function createStreamThrowNode(id, parsed) {
  return createSerovalNode(
    33 /* StreamThrow */,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    parsed,
    NIL,
    NIL,
    NIL
  );
}
function createStreamReturnNode(id, parsed) {
  return createSerovalNode(
    34 /* StreamReturn */,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    parsed,
    NIL,
    NIL,
    NIL
  );
}
function createSequenceNode(id, sequence, throwAt, doneAt) {
  return createSerovalNode(
    35 /* Sequence */,
    id,
    throwAt,
    NIL,
    NIL,
    NIL,
    NIL,
    sequence,
    NIL,
    NIL,
    NIL,
    doneAt
  );
}

// src/core/errors.ts
var { toString: objectToString } = Object.prototype;
function getErrorMessageDev(type, cause) {
  if (cause instanceof Error) {
    return `Seroval caught an error during the ${type} process.

${cause.name}
${cause.message}

- For more information, please check the "cause" property of this error.
- If you believe this is an error in Seroval, please submit an issue at https://github.com/lxsmnsyc/seroval/issues/new`;
  }
  return `Seroval caught an error during the ${type} process.

"${objectToString.call(cause)}"

For more information, please check the "cause" property of this error.`;
}
var getErrorMessage = (type, cause) => false ? getErrorMessageProd(type) : getErrorMessageDev(type, cause);
var SerovalError = class extends Error {
  constructor(type, cause) {
    super(getErrorMessage(type, cause));
    this.cause = cause;
  }
};
var SerovalParserError = class extends SerovalError {
  constructor(cause) {
    super("parsing", cause);
  }
};
var SerovalSerializationError = class extends SerovalError {
  constructor(cause) {
    super("serialization", cause);
  }
};
var SerovalDeserializationError = class extends SerovalError {
  constructor(cause) {
    super("deserialization", cause);
  }
};
var SerovalUnsupportedTypeError = class extends Error {
  constructor(value) {
    super(
      false ? getSpecificErrorMessage(1 /* UnsupportedType */) : `The value ${objectToString.call(value)} of type "${typeof value}" cannot be parsed/serialized.
      
There are few workarounds for this problem:
- Transform the value in a way that it can be serialized.
- If the reference is present on multiple runtimes (isomorphic), you can use the Reference API to map the references.`
    );
    this.value = value;
  }
};
var SerovalUnsupportedNodeError = class extends Error {
  constructor(node) {
    super(
      false ? getSpecificErrorMessage(2 /* UnsupportedNode */) : 'Unsupported node type "' + node.t + '".'
    );
  }
};
var SerovalMissingPluginError = class extends Error {
  constructor(tag) {
    super(
      false ? getSpecificErrorMessage(3 /* MissingPlugin */) : 'Missing plugin for tag "' + tag + '".'
    );
  }
};
var SerovalMissingInstanceError = class extends Error {
  constructor(tag) {
    super(
      false ? getSpecificErrorMessage(4 /* MissingInstance */) : 'Missing "' + tag + '" instance.'
    );
  }
};
var SerovalMissingReferenceError = class extends Error {
  constructor(value) {
    super(
      false ? getSpecificErrorMessage(5 /* MissingReference */) : 'Missing reference for the value "' + objectToString.call(value) + '" of type "' + typeof value + '"'
    );
    this.value = value;
  }
};
var SerovalMissingReferenceForIdError = class extends Error {
  constructor(id) {
    super(
      false ? getSpecificErrorMessage(6 /* MissingReferenceForId */) : 'Missing reference for id "' + serializeString(id) + '"'
    );
  }
};
var SerovalUnknownTypedArrayError = class extends Error {
  constructor(name) {
    super(
      false ? getSpecificErrorMessage(7 /* UnknownTypedArray */) : 'Unknown TypedArray "' + name + '"'
    );
  }
};
var SerovalMalformedNodeError = class extends Error {
  constructor(node) {
    super(
      false ? getSpecificErrorMessage(8 /* MalformedNode */) : 'Malformed node type "' + node.t + '".'
    );
  }
};
var SerovalConflictedNodeIdError = class extends Error {
  constructor(node) {
    super(
      false ? getSpecificErrorMessage(9 /* ConflictedNodeId */) : 'Conflicted node id "' + node.i + '".'
    );
  }
};
var SerovalDepthLimitError = class extends Error {
  constructor(limit) {
    super(
      false ? getSpecificErrorMessage(9 /* ConflictedNodeId */) : "Depth limit of " + limit + " reached"
    );
  }
};

// src/core/opaque-reference.ts
var OpaqueReference = class {
  constructor(value, replacement) {
    this.value = value;
    this.replacement = replacement;
  }
};

// src/core/constructors.ts
var PROMISE_CONSTRUCTOR = () => {
  const resolver = {
    p: 0,
    s: 0,
    f: 0
  };
  resolver.p = new Promise((resolve, reject) => {
    resolver.s = resolve;
    resolver.f = reject;
  });
  return resolver;
};
var PROMISE_SUCCESS = (resolver, data) => {
  resolver.s(data);
  resolver.p.s = 1;
  resolver.p.v = data;
};
var PROMISE_FAILURE = (resolver, data) => {
  resolver.f(data);
  resolver.p.s = 2;
  resolver.p.v = data;
};
var SERIALIZED_PROMISE_CONSTRUCTOR = /* @__PURE__ */ PROMISE_CONSTRUCTOR.toString();
var SERIALIZED_PROMISE_SUCCESS = /* @__PURE__ */ PROMISE_SUCCESS.toString();
var SERIALIZED_PROMISE_FAILURE = /* @__PURE__ */ PROMISE_FAILURE.toString();
var STREAM_CONSTRUCTOR = () => {
  const buffer = [];
  const listeners = [];
  let alive = true;
  let success = false;
  let count = 0;
  const flush = (value, mode, x) => {
    for (x = 0; x < count; x++) {
      if (listeners[x]) {
        listeners[x][mode](value);
      }
    }
  };
  const up = (listener, x, z, current) => {
    for (x = 0, z = buffer.length; x < z; x++) {
      current = buffer[x];
      if (!alive && x === z - 1) {
        listener[success ? "return" : "throw"](current);
      } else {
        listener.next(current);
      }
    }
  };
  const on = (listener, temp) => {
    if (alive) {
      temp = count++;
      listeners[temp] = listener;
    }
    up(listener);
    return () => {
      if (alive) {
        listeners[temp] = listeners[count];
        listeners[count--] = void 0;
      }
    };
  };
  return {
    __SEROVAL_STREAM__: true,
    on: (listener) => on(listener),
    next: (value) => {
      if (alive) {
        buffer.push(value);
        flush(value, "next");
      }
    },
    throw: (value) => {
      if (alive) {
        buffer.push(value);
        flush(value, "throw");
        alive = false;
        success = false;
        listeners.length = 0;
      }
    },
    return: (value) => {
      if (alive) {
        buffer.push(value);
        flush(value, "return");
        alive = false;
        success = true;
        listeners.length = 0;
      }
    }
  };
};
var SERIALIZED_STREAM_CONSTRUCTOR = /* @__PURE__ */ STREAM_CONSTRUCTOR.toString();
var ITERATOR_CONSTRUCTOR = (symbol) => (sequence) => () => {
  let index = 0;
  const instance = {
    [symbol]: () => instance,
    next: () => {
      if (index > sequence.d) {
        return {
          done: true,
          value: void 0
        };
      }
      const currentIndex = index++;
      const data = sequence.v[currentIndex];
      if (currentIndex === sequence.t) {
        throw data;
      }
      return {
        done: currentIndex === sequence.d,
        value: data
      };
    }
  };
  return instance;
};
var SERIALIZED_ITERATOR_CONSTRUCTOR = /* @__PURE__ */ ITERATOR_CONSTRUCTOR.toString();
var ASYNC_ITERATOR_CONSTRUCTOR = (symbol, createPromise) => (stream) => () => {
  let count = 0;
  let doneAt = -1;
  let isThrow = false;
  const buffer = [];
  const pending = [];
  const finalize = (i = 0, len = pending.length) => {
    for (; i < len; i++) {
      pending[i].s({
        done: true,
        value: void 0
      });
    }
  };
  stream.on({
    next: (value) => {
      const temp = pending.shift();
      if (temp) {
        temp.s({ done: false, value });
      }
      buffer.push(value);
    },
    throw: (value) => {
      const temp = pending.shift();
      if (temp) {
        temp.f(value);
      }
      finalize();
      doneAt = buffer.length;
      isThrow = true;
      buffer.push(value);
    },
    return: (value) => {
      const temp = pending.shift();
      if (temp) {
        temp.s({ done: true, value });
      }
      finalize();
      doneAt = buffer.length;
      buffer.push(value);
    }
  });
  const instance = {
    [symbol]: () => instance,
    next: () => {
      if (doneAt === -1) {
        const index2 = count++;
        if (index2 >= buffer.length) {
          const temp = createPromise();
          pending.push(temp);
          return temp.p;
        }
        return {
          done: false,
          value: buffer[index2]
        };
      }
      if (count > doneAt) {
        return {
          done: true,
          value: void 0
        };
      }
      const index = count++;
      const value = buffer[index];
      if (index !== doneAt) {
        return {
          done: false,
          value
        };
      }
      if (isThrow) {
        throw value;
      }
      return {
        done: true,
        value
      };
    }
  };
  return instance;
};
var SERIALIZED_ASYNC_ITERATOR_CONSTRUCTOR = /* @__PURE__ */ ASYNC_ITERATOR_CONSTRUCTOR.toString();
var ARRAY_BUFFER_CONSTRUCTOR = (b64) => {
  const decoded = atob(b64);
  const length = decoded.length;
  const arr = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = decoded.charCodeAt(i);
  }
  return arr.buffer;
};
var SERIALIZED_ARRAY_BUFFER_CONSTRUCTOR = /* @__PURE__ */ ARRAY_BUFFER_CONSTRUCTOR.toString();

// src/core/sequence.ts
function isSequence(value) {
  return "__SEROVAL_SEQUENCE__" in value;
}
function createSequence(values, throwAt, doneAt) {
  return {
    __SEROVAL_SEQUENCE__: true,
    v: values,
    t: throwAt,
    d: doneAt
  };
}
function createSequenceFromIterable(source) {
  const values = [];
  let throwsAt = -1;
  let doneAt = -1;
  const iterator = source[SYM_ITERATOR]();
  while (true) {
    try {
      const value = iterator.next();
      values.push(value.value);
      if (value.done) {
        doneAt = values.length - 1;
        break;
      }
    } catch (error) {
      throwsAt = values.length;
      values.push(error);
    }
  }
  return createSequence(values, throwsAt, doneAt);
}
var createIterator = ITERATOR_CONSTRUCTOR(SYM_ITERATOR);
function sequenceToIterator(sequence) {
  return createIterator(sequence);
}

// src/core/special-reference.ts
var ITERATOR = {};
var ASYNC_ITERATOR = {};
var SPECIAL_REFS = {
  [0 /* MapSentinel */]: {},
  [1 /* PromiseConstructor */]: {},
  [2 /* PromiseSuccess */]: {},
  [3 /* PromiseFailure */]: {},
  [4 /* StreamConstructor */]: {},
  [5 /* ArrayBufferConstructor */]: {}
};
var SPECIAL_REF_STRING = {
  [0 /* MapSentinel */]: "[]",
  [1 /* PromiseConstructor */]: SERIALIZED_PROMISE_CONSTRUCTOR,
  [2 /* PromiseSuccess */]: SERIALIZED_PROMISE_SUCCESS,
  [3 /* PromiseFailure */]: SERIALIZED_PROMISE_FAILURE,
  [4 /* StreamConstructor */]: SERIALIZED_STREAM_CONSTRUCTOR,
  [5 /* ArrayBufferConstructor */]: SERIALIZED_ARRAY_BUFFER_CONSTRUCTOR
};

// src/core/stream.ts
function isStream(value) {
  return "__SEROVAL_STREAM__" in value;
}
function createStream() {
  return STREAM_CONSTRUCTOR();
}
function createStreamFromAsyncIterable(iterable) {
  const stream = createStream();
  const iterator = iterable[SYM_ASYNC_ITERATOR]();
  async function push() {
    try {
      const value = await iterator.next();
      if (value.done) {
        stream.return(value.value);
      } else {
        stream.next(value.value);
        await push();
      }
    } catch (error) {
      stream.throw(error);
    }
  }
  push().catch(() => {
  });
  return stream;
}
var createAsyncIterable = ASYNC_ITERATOR_CONSTRUCTOR(
  SYM_ASYNC_ITERATOR,
  PROMISE_CONSTRUCTOR
);
function streamToAsyncIterable(stream) {
  return createAsyncIterable(
    stream
  );
}

// src/core/utils/promise-to-result.ts
async function promiseToResult(current) {
  try {
    return [1, await current];
  } catch (e) {
    return [0, e];
  }
}

// src/core/context/parser.ts
function createBaseParserContext(mode, options) {
  return {
    plugins: options.plugins,
    mode,
    marked: /* @__PURE__ */ new Set(),
    features: ALL_ENABLED ^ (options.disabledFeatures || 0),
    refs: options.refs || /* @__PURE__ */ new Map(),
    depthLimit: options.depthLimit || 1e3
  };
}
function markParserRef(ctx, id) {
  ctx.marked.add(id);
}
function createIndexForValue(ctx, current) {
  const id = ctx.refs.size;
  ctx.refs.set(current, id);
  return id;
}
function getNodeForIndexedValue(ctx, current) {
  const registeredId = ctx.refs.get(current);
  if (registeredId != null) {
    markParserRef(ctx, registeredId);
    return {
      type: 1 /* Indexed */,
      value: createIndexedValueNode(registeredId)
    };
  }
  return {
    type: 0 /* Fresh */,
    value: createIndexForValue(ctx, current)
  };
}
function getReferenceNode(ctx, current) {
  const indexed = getNodeForIndexedValue(ctx, current);
  if (indexed.type === 1 /* Indexed */) {
    return indexed;
  }
  if (hasReferenceID(current)) {
    return {
      type: 2 /* Referenced */,
      value: createReferenceNode(indexed.value, current)
    };
  }
  return indexed;
}
function parseWellKnownSymbol(ctx, current) {
  const ref = getReferenceNode(ctx, current);
  if (ref.type !== 0 /* Fresh */) {
    return ref.value;
  }
  if (current in INV_SYMBOL_REF) {
    return createWKSymbolNode(ref.value, current);
  }
  throw new SerovalUnsupportedTypeError(current);
}
function parseSpecialReference(ctx, ref) {
  const result = getNodeForIndexedValue(ctx, SPECIAL_REFS[ref]);
  if (result.type === 1 /* Indexed */) {
    return result.value;
  }
  return createSerovalNode(
    26 /* SpecialReference */,
    result.value,
    ref,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function parseIteratorFactory(ctx) {
  const result = getNodeForIndexedValue(ctx, ITERATOR);
  if (result.type === 1 /* Indexed */) {
    return result.value;
  }
  return createSerovalNode(
    27 /* IteratorFactory */,
    result.value,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    parseWellKnownSymbol(ctx, SYM_ITERATOR),
    NIL,
    NIL,
    NIL
  );
}
function parseAsyncIteratorFactory(ctx) {
  const result = getNodeForIndexedValue(ctx, ASYNC_ITERATOR);
  if (result.type === 1 /* Indexed */) {
    return result.value;
  }
  return createSerovalNode(
    29 /* AsyncIteratorFactory */,
    result.value,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    [
      parseSpecialReference(ctx, 1 /* PromiseConstructor */),
      parseWellKnownSymbol(ctx, SYM_ASYNC_ITERATOR)
    ],
    NIL,
    NIL,
    NIL,
    NIL
  );
}
function createObjectNode(id, current, empty, record) {
  return createSerovalNode(
    empty ? 11 /* NullConstructor */ : 10 /* Object */,
    id,
    NIL,
    NIL,
    NIL,
    record,
    NIL,
    NIL,
    NIL,
    NIL,
    getObjectFlag(current),
    NIL
  );
}
function createMapNode(ctx, id, k, v) {
  return createSerovalNode(
    8 /* Map */,
    id,
    NIL,
    NIL,
    NIL,
    NIL,
    { k, v },
    NIL,
    parseSpecialReference(ctx, 0 /* MapSentinel */),
    NIL,
    NIL,
    NIL
  );
}
function createPromiseConstructorNode(ctx, id, resolver) {
  return createSerovalNode(
    22 /* PromiseConstructor */,
    id,
    resolver,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    parseSpecialReference(ctx, 1 /* PromiseConstructor */),
    NIL,
    NIL,
    NIL
  );
}
function createArrayBufferNode(ctx, id, current) {
  const bytes = new Uint8Array(current);
  let result = "";
  for (let i = 0, len = bytes.length; i < len; i++) {
    result += String.fromCharCode(bytes[i]);
  }
  return createSerovalNode(
    19 /* ArrayBuffer */,
    id,
    serializeString(btoa(result)),
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    parseSpecialReference(ctx, 5 /* ArrayBufferConstructor */),
    NIL,
    NIL,
    NIL
  );
}

// src/core/context/async-parser.ts
function createAsyncParserContext(mode, options) {
  return {
    base: createBaseParserContext(mode, options),
    child: void 0
  };
}
var AsyncParsePluginContext = class {
  constructor(_p, depth) {
    this._p = _p;
    this.depth = depth;
  }
  parse(current) {
    return parseAsync(this._p, this.depth, current);
  }
};
async function parseItems(ctx, depth, current) {
  const nodes = [];
  for (let i = 0, len = current.length; i < len; i++) {
    if (i in current) {
      nodes[i] = await parseAsync(ctx, depth, current[i]);
    } else {
      nodes[i] = 0;
    }
  }
  return nodes;
}
async function parseArray(ctx, depth, id, current) {
  return createArrayNode(id, current, await parseItems(ctx, depth, current));
}
async function parseProperties(ctx, depth, properties) {
  const entries = Object.entries(properties);
  const keyNodes = [];
  const valueNodes = [];
  for (let i = 0, len = entries.length; i < len; i++) {
    keyNodes.push(serializeString(entries[i][0]));
    valueNodes.push(await parseAsync(ctx, depth, entries[i][1]));
  }
  if (SYM_ITERATOR in properties) {
    keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_ITERATOR));
    valueNodes.push(
      createIteratorFactoryInstanceNode(
        parseIteratorFactory(ctx.base),
        await parseAsync(
          ctx,
          depth,
          createSequenceFromIterable(
            properties
          )
        )
      )
    );
  }
  if (SYM_ASYNC_ITERATOR in properties) {
    keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_ASYNC_ITERATOR));
    valueNodes.push(
      createAsyncIteratorFactoryInstanceNode(
        parseAsyncIteratorFactory(ctx.base),
        await parseAsync(
          ctx,
          depth,
          createStreamFromAsyncIterable(
            properties
          )
        )
      )
    );
  }
  if (SYM_TO_STRING_TAG in properties) {
    keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_TO_STRING_TAG));
    valueNodes.push(createStringNode(properties[SYM_TO_STRING_TAG]));
  }
  if (SYM_IS_CONCAT_SPREADABLE in properties) {
    keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_IS_CONCAT_SPREADABLE));
    valueNodes.push(
      properties[SYM_IS_CONCAT_SPREADABLE] ? TRUE_NODE : FALSE_NODE
    );
  }
  return {
    k: keyNodes,
    v: valueNodes
  };
}
async function parsePlainObject(ctx, depth, id, current, empty) {
  return createObjectNode(
    id,
    current,
    empty,
    await parseProperties(ctx, depth, current)
  );
}
async function parseBoxed(ctx, depth, id, current) {
  return createBoxedNode(id, await parseAsync(ctx, depth, current.valueOf()));
}
async function parseTypedArray(ctx, depth, id, current) {
  return createTypedArrayNode(
    id,
    current,
    await parseAsync(ctx, depth, current.buffer)
  );
}
async function parseBigIntTypedArray(ctx, depth, id, current) {
  return createBigIntTypedArrayNode(
    id,
    current,
    await parseAsync(ctx, depth, current.buffer)
  );
}
async function parseDataView(ctx, depth, id, current) {
  return createDataViewNode(
    id,
    current,
    await parseAsync(ctx, depth, current.buffer)
  );
}
async function parseError(ctx, depth, id, current) {
  const options = getErrorOptions(current, ctx.base.features);
  return createErrorNode(
    id,
    current,
    options ? await parseProperties(ctx, depth, options) : NIL
  );
}
async function parseAggregateError(ctx, depth, id, current) {
  const options = getErrorOptions(current, ctx.base.features);
  return createAggregateErrorNode(
    id,
    current,
    options ? await parseProperties(ctx, depth, options) : NIL
  );
}
async function parseMap(ctx, depth, id, current) {
  const keyNodes = [];
  const valueNodes = [];
  for (const [key, value] of current.entries()) {
    keyNodes.push(await parseAsync(ctx, depth, key));
    valueNodes.push(await parseAsync(ctx, depth, value));
  }
  return createMapNode(ctx.base, id, keyNodes, valueNodes);
}
async function parseSet(ctx, depth, id, current) {
  const items = [];
  for (const item of current.keys()) {
    items.push(await parseAsync(ctx, depth, item));
  }
  return createSetNode(id, items);
}
async function parsePlugin(ctx, depth, id, current) {
  const currentPlugins = ctx.base.plugins;
  if (currentPlugins) {
    for (let i = 0, len = currentPlugins.length; i < len; i++) {
      const plugin = currentPlugins[i];
      if (plugin.parse.async && plugin.test(current)) {
        return createPluginNode(
          id,
          plugin.tag,
          await plugin.parse.async(
            current,
            new AsyncParsePluginContext(ctx, depth),
            {
              id
            }
          )
        );
      }
    }
  }
  return NIL;
}
async function parsePromise(ctx, depth, id, current) {
  const [status, result] = await promiseToResult(current);
  return createSerovalNode(
    12 /* Promise */,
    id,
    status,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    await parseAsync(ctx, depth, result),
    NIL,
    NIL,
    NIL
  );
}
function parseStreamHandle(depth, id, current, resolve, reject) {
  const sequence = [];
  const cleanup = current.on({
    next: (value) => {
      markParserRef(this.base, id);
      parseAsync(this, depth, value).then(
        (data) => {
          sequence.push(createStreamNextNode(id, data));
        },
        (data) => {
          reject(data);
          cleanup();
        }
      );
    },
    throw: (value) => {
      markParserRef(this.base, id);
      parseAsync(this, depth, value).then(
        (data) => {
          sequence.push(createStreamThrowNode(id, data));
          resolve(sequence);
          cleanup();
        },
        (data) => {
          reject(data);
          cleanup();
        }
      );
    },
    return: (value) => {
      markParserRef(this.base, id);
      parseAsync(this, depth, value).then(
        (data) => {
          sequence.push(createStreamReturnNode(id, data));
          resolve(sequence);
          cleanup();
        },
        (data) => {
          reject(data);
          cleanup();
        }
      );
    }
  });
}
async function parseStream(ctx, depth, id, current) {
  return createStreamConstructorNode(
    id,
    parseSpecialReference(ctx.base, 4 /* StreamConstructor */),
    await new Promise(
      parseStreamHandle.bind(ctx, depth, id, current)
    )
  );
}
async function parseSequence(ctx, depth, id, current) {
  const nodes = [];
  for (let i = 0, len = current.v.length; i < len; i++) {
    nodes[i] = await parseAsync(ctx, depth, current.v[i]);
  }
  return createSequenceNode(id, nodes, current.t, current.d);
}
async function parseObjectAsync(ctx, depth, id, current) {
  if (Array.isArray(current)) {
    return parseArray(ctx, depth, id, current);
  }
  if (isStream(current)) {
    return parseStream(ctx, depth, id, current);
  }
  if (isSequence(current)) {
    return parseSequence(ctx, depth, id, current);
  }
  const currentClass = current.constructor;
  if (currentClass === OpaqueReference) {
    return parseAsync(
      ctx,
      depth,
      current.replacement
    );
  }
  const parsed = await parsePlugin(ctx, depth, id, current);
  if (parsed) {
    return parsed;
  }
  switch (currentClass) {
    case Object:
      return parsePlainObject(
        ctx,
        depth,
        id,
        current,
        false
      );
    case NIL:
      return parsePlainObject(
        ctx,
        depth,
        id,
        current,
        true
      );
    case Date:
      return createDateNode(id, current);
    case Error:
    case EvalError:
    case RangeError:
    case ReferenceError:
    case SyntaxError:
    case TypeError:
    case URIError:
      return parseError(ctx, depth, id, current);
    case Number:
    case Boolean:
    case String:
    case BigInt:
      return parseBoxed(ctx, depth, id, current);
    case ArrayBuffer:
      return createArrayBufferNode(
        ctx.base,
        id,
        current
      );
    case Int8Array:
    case Int16Array:
    case Int32Array:
    case Uint8Array:
    case Uint16Array:
    case Uint32Array:
    case Uint8ClampedArray:
    case Float32Array:
    case Float64Array:
      return parseTypedArray(
        ctx,
        depth,
        id,
        current
      );
    case DataView:
      return parseDataView(ctx, depth, id, current);
    case Map:
      return parseMap(
        ctx,
        depth,
        id,
        current
      );
    case Set:
      return parseSet(ctx, depth, id, current);
    default:
      break;
  }
  if (currentClass === Promise || current instanceof Promise) {
    return parsePromise(ctx, depth, id, current);
  }
  const currentFeatures = ctx.base.features;
  if (currentFeatures & 32 /* RegExp */ && currentClass === RegExp) {
    return createRegExpNode(id, current);
  }
  if (currentFeatures & 16 /* BigIntTypedArray */) {
    switch (currentClass) {
      case BigInt64Array:
      case BigUint64Array:
        return parseBigIntTypedArray(
          ctx,
          depth,
          id,
          current
        );
      default:
        break;
    }
  }
  if (currentFeatures & 1 /* AggregateError */ && typeof AggregateError !== "undefined" && (currentClass === AggregateError || current instanceof AggregateError)) {
    return parseAggregateError(
      ctx,
      depth,
      id,
      current
    );
  }
  if (current instanceof Error) {
    return parseError(ctx, depth, id, current);
  }
  if (SYM_ITERATOR in current || SYM_ASYNC_ITERATOR in current) {
    return parsePlainObject(ctx, depth, id, current, !!currentClass);
  }
  throw new SerovalUnsupportedTypeError(current);
}
async function parseFunctionAsync(ctx, depth, current) {
  const ref = getReferenceNode(ctx.base, current);
  if (ref.type !== 0 /* Fresh */) {
    return ref.value;
  }
  const plugin = await parsePlugin(ctx, depth, ref.value, current);
  if (plugin) {
    return plugin;
  }
  throw new SerovalUnsupportedTypeError(current);
}
async function parseAsync(ctx, depth, current) {
  switch (typeof current) {
    case "boolean":
      return current ? TRUE_NODE : FALSE_NODE;
    case "undefined":
      return UNDEFINED_NODE;
    case "string":
      return createStringNode(current);
    case "number":
      return createNumberNode(current);
    case "bigint":
      return createBigIntNode(current);
    case "object": {
      if (current) {
        const ref = getReferenceNode(ctx.base, current);
        return ref.type === 0 ? await parseObjectAsync(ctx, depth + 1, ref.value, current) : ref.value;
      }
      return NULL_NODE;
    }
    case "symbol":
      return parseWellKnownSymbol(ctx.base, current);
    case "function":
      return parseFunctionAsync(ctx, depth, current);
    default:
      throw new SerovalUnsupportedTypeError(current);
  }
}
async function parseTopAsync(ctx, current) {
  try {
    return await parseAsync(ctx, 0, current);
  } catch (error) {
    throw error instanceof SerovalParserError ? error : new SerovalParserError(error);
  }
}

// src/core/plugin.ts
var SerovalMode = /* @__PURE__ */ ((SerovalMode2) => {
  SerovalMode2[SerovalMode2["Vanilla"] = 1] = "Vanilla";
  SerovalMode2[SerovalMode2["Cross"] = 2] = "Cross";
  return SerovalMode2;
})(SerovalMode || {});
function createPlugin(plugin) {
  return plugin;
}
function dedupePlugins(deduped, plugins) {
  for (let i = 0, len = plugins.length; i < len; i++) {
    const current = plugins[i];
    if (!deduped.has(current)) {
      deduped.add(current);
      if (current.extends) {
        dedupePlugins(deduped, current.extends);
      }
    }
  }
}
function resolvePlugins(plugins) {
  if (plugins) {
    const deduped = /* @__PURE__ */ new Set();
    dedupePlugins(deduped, plugins);
    return [...deduped];
  }
  return void 0;
}

// src/core/utils/typed-array.ts
function getTypedArrayConstructor(name) {
  switch (name) {
    case "Int8Array":
      return Int8Array;
    case "Int16Array":
      return Int16Array;
    case "Int32Array":
      return Int32Array;
    case "Uint8Array":
      return Uint8Array;
    case "Uint16Array":
      return Uint16Array;
    case "Uint32Array":
      return Uint32Array;
    case "Uint8ClampedArray":
      return Uint8ClampedArray;
    case "Float32Array":
      return Float32Array;
    case "Float64Array":
      return Float64Array;
    case "BigInt64Array":
      return BigInt64Array;
    case "BigUint64Array":
      return BigUint64Array;
    default:
      throw new SerovalUnknownTypedArrayError(name);
  }
}

// src/core/context/deserializer.ts
var MAX_BASE64_LENGTH = 1e6;
var MAX_BIGINT_LENGTH = 1e4;
var MAX_REGEXP_SOURCE_LENGTH = 2e4;
function applyObjectFlag(obj, flag) {
  switch (flag) {
    case 3 /* Frozen */:
      return Object.freeze(obj);
    case 1 /* NonExtensible */:
      return Object.preventExtensions(obj);
    case 2 /* Sealed */:
      return Object.seal(obj);
    default:
      return obj;
  }
}
var DEFAULT_DEPTH_LIMIT = 1e3;
function createBaseDeserializerContext(mode, options) {
  var _a;
  return {
    mode,
    plugins: options.plugins,
    refs: options.refs || /* @__PURE__ */ new Map(),
    features: (_a = options.features) != null ? _a : ALL_ENABLED ^ (options.disabledFeatures || 0),
    depthLimit: options.depthLimit || DEFAULT_DEPTH_LIMIT
  };
}
function createVanillaDeserializerContext(options) {
  return {
    mode: 1 /* Vanilla */,
    base: createBaseDeserializerContext(1 /* Vanilla */, options),
    child: NIL,
    state: {
      marked: new Set(options.markedRefs)
    }
  };
}
function createCrossDeserializerContext(options) {
  return {
    mode: 2 /* Cross */,
    base: createBaseDeserializerContext(2 /* Cross */, options),
    child: NIL
  };
}
var DeserializePluginContext = class {
  constructor(_p, depth) {
    this._p = _p;
    this.depth = depth;
  }
  deserialize(node) {
    return deserialize(this._p, this.depth, node);
  }
};
function guardIndexedValue(ctx, id) {
  if (id < 0 || !Number.isFinite(id) || !Number.isInteger(id)) {
    throw new SerovalMalformedNodeError({
      t: 4 /* IndexedValue */,
      i: id
    });
  }
  if (ctx.refs.has(id)) {
    throw new Error("Conflicted ref id: " + id);
  }
}
function assignIndexedValueVanilla(ctx, id, value) {
  guardIndexedValue(ctx.base, id);
  if (ctx.state.marked.has(id)) {
    ctx.base.refs.set(id, value);
  }
  return value;
}
function assignIndexedValueCross(ctx, id, value) {
  guardIndexedValue(ctx.base, id);
  ctx.base.refs.set(id, value);
  return value;
}
function assignIndexedValue(ctx, id, value) {
  return ctx.mode === 1 /* Vanilla */ ? assignIndexedValueVanilla(ctx, id, value) : assignIndexedValueCross(ctx, id, value);
}
function deserializeKnownValue(node, record, key) {
  if (Object.hasOwn(record, key)) {
    return record[key];
  }
  throw new SerovalMalformedNodeError(node);
}
function deserializeReference(ctx, node) {
  return assignIndexedValue(
    ctx,
    node.i,
    getReference(deserializeString(node.s))
  );
}
function deserializeArray(ctx, depth, node) {
  const items = node.a;
  const len = items.length;
  const result = assignIndexedValue(
    ctx,
    node.i,
    new Array(len)
  );
  for (let i = 0, item; i < len; i++) {
    item = items[i];
    if (item) {
      result[i] = deserialize(ctx, depth, item);
    }
  }
  applyObjectFlag(result, node.o);
  return result;
}
function isValidKey(key) {
  switch (key) {
    case "constructor":
    case "__proto__":
    case "prototype":
    case "__defineGetter__":
    case "__defineSetter__":
    case "__lookupGetter__":
    case "__lookupSetter__":
      return false;
    default:
      return true;
  }
}
function isValidSymbol(symbol) {
  switch (symbol) {
    case SYM_ASYNC_ITERATOR:
    case SYM_IS_CONCAT_SPREADABLE:
    case SYM_TO_STRING_TAG:
    case SYM_ITERATOR:
      return true;
    default:
      return false;
  }
}
function assignStringProperty(object, key, value) {
  if (isValidKey(key)) {
    object[key] = value;
  } else {
    Object.defineProperty(object, key, {
      value,
      configurable: true,
      enumerable: true,
      writable: true
    });
  }
}
function assignProperty(ctx, depth, object, key, value) {
  if (typeof key === "string") {
    assignStringProperty(
      object,
      deserializeString(key),
      deserialize(ctx, depth, value)
    );
  } else {
    const actual = deserialize(ctx, depth, key);
    switch (typeof actual) {
      case "string":
        assignStringProperty(object, actual, deserialize(ctx, depth, value));
        break;
      case "symbol":
        if (isValidSymbol(actual)) {
          object[actual] = deserialize(ctx, depth, value);
        }
        break;
      default:
        throw new SerovalMalformedNodeError(key);
    }
  }
}
function deserializeProperties(ctx, depth, node, result) {
  const keys = node.k;
  const len = keys.length;
  if (len > 0) {
    for (let i = 0, vals = node.v, len2 = keys.length; i < len2; i++) {
      assignProperty(ctx, depth, result, keys[i], vals[i]);
    }
  }
  return result;
}
function deserializeObject(ctx, depth, node) {
  const result = assignIndexedValue(
    ctx,
    node.i,
    node.t === 10 /* Object */ ? {} : /* @__PURE__ */ Object.create(null)
  );
  deserializeProperties(ctx, depth, node.p, result);
  applyObjectFlag(result, node.o);
  return result;
}
function deserializeDate(ctx, node) {
  return assignIndexedValue(ctx, node.i, new Date(node.s));
}
function deserializeRegExp(ctx, node) {
  if (ctx.base.features & 32 /* RegExp */) {
    const source = deserializeString(node.c);
    if (source.length > MAX_REGEXP_SOURCE_LENGTH) {
      throw new SerovalMalformedNodeError(node);
    }
    return assignIndexedValue(ctx, node.i, new RegExp(source, node.m));
  }
  throw new SerovalUnsupportedNodeError(node);
}
function deserializeSet(ctx, depth, node) {
  const result = assignIndexedValue(ctx, node.i, /* @__PURE__ */ new Set());
  for (let i = 0, items = node.a, len = items.length; i < len; i++) {
    result.add(deserialize(ctx, depth, items[i]));
  }
  return result;
}
function deserializeMap(ctx, depth, node) {
  const result = assignIndexedValue(ctx, node.i, /* @__PURE__ */ new Map());
  for (let i = 0, keys = node.e.k, vals = node.e.v, len = keys.length; i < len; i++) {
    result.set(
      deserialize(ctx, depth, keys[i]),
      deserialize(ctx, depth, vals[i])
    );
  }
  return result;
}
function deserializeArrayBuffer(ctx, node) {
  if (node.s.length > MAX_BASE64_LENGTH) {
    throw new SerovalMalformedNodeError(node);
  }
  const result = assignIndexedValue(
    ctx,
    node.i,
    ARRAY_BUFFER_CONSTRUCTOR(deserializeString(node.s))
  );
  return result;
}
function deserializeTypedArray(ctx, depth, node) {
  var _a;
  const construct = getTypedArrayConstructor(node.c);
  const source = deserialize(ctx, depth, node.f);
  const offset = (_a = node.b) != null ? _a : 0;
  if (offset < 0 || offset > source.byteLength) {
    throw new SerovalMalformedNodeError(node);
  }
  const result = assignIndexedValue(
    ctx,
    node.i,
    new construct(source, offset, node.l)
  );
  return result;
}
function deserializeDataView(ctx, depth, node) {
  var _a;
  const source = deserialize(ctx, depth, node.f);
  const offset = (_a = node.b) != null ? _a : 0;
  if (offset < 0 || offset > source.byteLength) {
    throw new SerovalMalformedNodeError(node);
  }
  const result = assignIndexedValue(
    ctx,
    node.i,
    new DataView(source, offset, node.l)
  );
  return result;
}
function deserializeDictionary(ctx, depth, node, result) {
  if (node.p) {
    const fields = deserializeProperties(ctx, depth, node.p, {});
    Object.defineProperties(result, Object.getOwnPropertyDescriptors(fields));
  }
  return result;
}
function deserializeAggregateError(ctx, depth, node) {
  const result = assignIndexedValue(
    ctx,
    node.i,
    new AggregateError([], deserializeString(node.m))
  );
  return deserializeDictionary(ctx, depth, node, result);
}
function deserializeError(ctx, depth, node) {
  const construct = deserializeKnownValue(node, ERROR_CONSTRUCTOR, node.s);
  const result = assignIndexedValue(
    ctx,
    node.i,
    new construct(deserializeString(node.m))
  );
  return deserializeDictionary(ctx, depth, node, result);
}
function deserializePromise(ctx, depth, node) {
  const deferred = PROMISE_CONSTRUCTOR();
  const result = assignIndexedValue(ctx, node.i, deferred.p);
  const deserialized = deserialize(ctx, depth, node.f);
  if (node.s) {
    deferred.s(deserialized);
  } else {
    deferred.f(deserialized);
  }
  return result;
}
function deserializeBoxed(ctx, depth, node) {
  return assignIndexedValue(
    ctx,
    node.i,
    // biome-ignore lint/style/useConsistentBuiltinInstantiation: intended
    Object(deserialize(ctx, depth, node.f))
  );
}
function deserializePlugin(ctx, depth, node) {
  const currentPlugins = ctx.base.plugins;
  if (currentPlugins) {
    const tag = deserializeString(node.c);
    for (let i = 0, len = currentPlugins.length; i < len; i++) {
      const plugin = currentPlugins[i];
      if (plugin.tag === tag) {
        return assignIndexedValue(
          ctx,
          node.i,
          plugin.deserialize(node.s, new DeserializePluginContext(ctx, depth), {
            id: node.i
          })
        );
      }
    }
  }
  throw new SerovalMissingPluginError(node.c);
}
function deserializePromiseConstructor(ctx, node) {
  return assignIndexedValue(
    ctx,
    node.i,
    assignIndexedValue(ctx, node.s, PROMISE_CONSTRUCTOR()).p
  );
}
function deserializePromiseResolve(ctx, depth, node) {
  const deferred = ctx.base.refs.get(node.i);
  if (deferred) {
    deferred.s(deserialize(ctx, depth, node.a[1]));
    return NIL;
  }
  throw new SerovalMissingInstanceError("Promise");
}
function deserializePromiseReject(ctx, depth, node) {
  const deferred = ctx.base.refs.get(node.i);
  if (deferred) {
    deferred.f(deserialize(ctx, depth, node.a[1]));
    return NIL;
  }
  throw new SerovalMissingInstanceError("Promise");
}
function deserializeIteratorFactoryInstance(ctx, depth, node) {
  deserialize(ctx, depth, node.a[0]);
  const source = deserialize(ctx, depth, node.a[1]);
  return sequenceToIterator(source);
}
function deserializeAsyncIteratorFactoryInstance(ctx, depth, node) {
  deserialize(ctx, depth, node.a[0]);
  const source = deserialize(ctx, depth, node.a[1]);
  return streamToAsyncIterable(source);
}
function deserializeStreamConstructor(ctx, depth, node) {
  const result = assignIndexedValue(ctx, node.i, createStream());
  const items = node.a;
  const len = items.length;
  if (len) {
    for (let i = 0; i < len; i++) {
      deserialize(ctx, depth, items[i]);
    }
  }
  return result;
}
function deserializeStreamNext(ctx, depth, node) {
  const deferred = ctx.base.refs.get(node.i);
  if (deferred && isStream(deferred)) {
    deferred.next(deserialize(ctx, depth, node.f));
    return NIL;
  }
  throw new SerovalMissingInstanceError("Stream");
}
function deserializeStreamThrow(ctx, depth, node) {
  const deferred = ctx.base.refs.get(node.i);
  if (deferred && isStream(deferred)) {
    deferred.throw(deserialize(ctx, depth, node.f));
    return NIL;
  }
  throw new SerovalMissingInstanceError("Stream");
}
function deserializeStreamReturn(ctx, depth, node) {
  const deferred = ctx.base.refs.get(node.i);
  if (deferred && isStream(deferred)) {
    deferred.return(deserialize(ctx, depth, node.f));
    return NIL;
  }
  throw new SerovalMissingInstanceError("Stream");
}
function deserializeIteratorFactory(ctx, depth, node) {
  deserialize(ctx, depth, node.f);
  return NIL;
}
function deserializeAsyncIteratorFactory(ctx, depth, node) {
  deserialize(ctx, depth, node.a[1]);
  return NIL;
}
function deserializeSequence(ctx, depth, node) {
  const result = assignIndexedValue(
    ctx,
    node.i,
    createSequence([], node.s, node.l)
  );
  for (let i = 0, len = node.a.length; i < len; i++) {
    result.v[i] = deserialize(ctx, depth, node.a[i]);
  }
  return result;
}
function deserialize(ctx, depth, node) {
  if (depth > ctx.base.depthLimit) {
    throw new SerovalDepthLimitError(ctx.base.depthLimit);
  }
  depth += 1;
  switch (node.t) {
    case 2 /* Constant */:
      return deserializeKnownValue(node, CONSTANT_VAL, node.s);
    case 0 /* Number */:
      return Number(node.s);
    case 1 /* String */:
      return deserializeString(String(node.s));
    case 3 /* BigInt */:
      if (String(node.s).length > MAX_BIGINT_LENGTH) {
        throw new SerovalMalformedNodeError(node);
      }
      return BigInt(node.s);
    case 4 /* IndexedValue */:
      return ctx.base.refs.get(node.i);
    case 18 /* Reference */:
      return deserializeReference(ctx, node);
    case 9 /* Array */:
      return deserializeArray(ctx, depth, node);
    case 10 /* Object */:
    case 11 /* NullConstructor */:
      return deserializeObject(ctx, depth, node);
    case 5 /* Date */:
      return deserializeDate(ctx, node);
    case 6 /* RegExp */:
      return deserializeRegExp(ctx, node);
    case 7 /* Set */:
      return deserializeSet(ctx, depth, node);
    case 8 /* Map */:
      return deserializeMap(ctx, depth, node);
    case 19 /* ArrayBuffer */:
      return deserializeArrayBuffer(ctx, node);
    case 16 /* BigIntTypedArray */:
    case 15 /* TypedArray */:
      return deserializeTypedArray(ctx, depth, node);
    case 20 /* DataView */:
      return deserializeDataView(ctx, depth, node);
    case 14 /* AggregateError */:
      return deserializeAggregateError(ctx, depth, node);
    case 13 /* Error */:
      return deserializeError(ctx, depth, node);
    case 12 /* Promise */:
      return deserializePromise(ctx, depth, node);
    case 17 /* WKSymbol */:
      return deserializeKnownValue(node, SYMBOL_REF, node.s);
    case 21 /* Boxed */:
      return deserializeBoxed(ctx, depth, node);
    case 25 /* Plugin */:
      return deserializePlugin(ctx, depth, node);
    case 22 /* PromiseConstructor */:
      return deserializePromiseConstructor(ctx, node);
    case 23 /* PromiseSuccess */:
      return deserializePromiseResolve(ctx, depth, node);
    case 24 /* PromiseFailure */:
      return deserializePromiseReject(ctx, depth, node);
    case 28 /* IteratorFactoryInstance */:
      return deserializeIteratorFactoryInstance(ctx, depth, node);
    case 30 /* AsyncIteratorFactoryInstance */:
      return deserializeAsyncIteratorFactoryInstance(ctx, depth, node);
    case 31 /* StreamConstructor */:
      return deserializeStreamConstructor(ctx, depth, node);
    case 32 /* StreamNext */:
      return deserializeStreamNext(ctx, depth, node);
    case 33 /* StreamThrow */:
      return deserializeStreamThrow(ctx, depth, node);
    case 34 /* StreamReturn */:
      return deserializeStreamReturn(ctx, depth, node);
    case 27 /* IteratorFactory */:
      return deserializeIteratorFactory(ctx, depth, node);
    case 29 /* AsyncIteratorFactory */:
      return deserializeAsyncIteratorFactory(ctx, depth, node);
    // case SerovalNodeType.SpecialReference:
    case 35 /* Sequence */:
      return deserializeSequence(ctx, depth, node);
    default:
      throw new SerovalUnsupportedNodeError(node);
  }
}
function deserializeTop(ctx, node) {
  try {
    return deserialize(ctx, 0, node);
  } catch (error) {
    throw new SerovalDeserializationError(error);
  }
}

// src/core/function-string.ts
var RETURN = () => T;
var SERIALIZED_RETURN = /* @__PURE__ */ RETURN.toString();
var IS_MODERN = /* @__PURE__ */ /=>/.test(SERIALIZED_RETURN);
function createFunction(parameters, body) {
  if (IS_MODERN) {
    const joined = parameters.length === 1 ? parameters[0] : "(" + parameters.join(",") + ")";
    return joined + "=>" + (body.startsWith("{") ? "(" + body + ")" : body);
  }
  return "function(" + parameters.join(",") + "){return " + body + "}";
}
function createEffectfulFunction(parameters, body) {
  if (IS_MODERN) {
    const joined = parameters.length === 1 ? parameters[0] : "(" + parameters.join(",") + ")";
    return joined + "=>{" + body + "}";
  }
  return "function(" + parameters.join(",") + "){" + body + "}";
}

// src/core/utils/get-identifier.ts
var REF_START_CHARS = "hjkmoquxzABCDEFGHIJKLNPQRTUVWXYZ$_";
var REF_START_CHARS_LEN = REF_START_CHARS.length;
var REF_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$_";
var REF_CHARS_LEN = REF_CHARS.length;
function getIdentifier(index) {
  let mod = index % REF_START_CHARS_LEN;
  let ref = REF_START_CHARS[mod];
  index = (index - mod) / REF_START_CHARS_LEN;
  while (index > 0) {
    mod = index % REF_CHARS_LEN;
    ref += REF_CHARS[mod];
    index = (index - mod) / REF_CHARS_LEN;
  }
  return ref;
}

// src/core/utils/is-valid-identifier.ts
var IDENTIFIER_CHECK = /^[$A-Z_][0-9A-Z_$]*$/i;
function isValidIdentifier(name) {
  const char = name[0];
  return (char === "$" || char === "_" || char >= "A" && char <= "Z" || char >= "a" && char <= "z") && IDENTIFIER_CHECK.test(name);
}

// src/core/context/serializer.ts
function getAssignmentExpression(assignment) {
  switch (assignment.t) {
    case 0 /* Index */:
      return assignment.s + "=" + assignment.v;
    case 2 /* Set */:
      return assignment.s + ".set(" + assignment.k + "," + assignment.v + ")";
    case 1 /* Add */:
      return assignment.s + ".add(" + assignment.v + ")";
    case 3 /* Delete */:
      return assignment.s + ".delete(" + assignment.k + ")";
  }
}
function mergeAssignments(assignments) {
  const newAssignments = [];
  let current = assignments[0];
  for (let i = 1, len = assignments.length, item, prev = current; i < len; i++) {
    item = assignments[i];
    if (item.t === 0 /* Index */ && item.v === prev.v) {
      current = {
        t: 0 /* Index */,
        s: item.s,
        k: NIL,
        v: getAssignmentExpression(current)
      };
    } else if (item.t === 2 /* Set */ && item.s === prev.s) {
      current = {
        t: 2 /* Set */,
        s: getAssignmentExpression(current),
        k: item.k,
        v: item.v
      };
    } else if (item.t === 1 /* Add */ && item.s === prev.s) {
      current = {
        t: 1 /* Add */,
        s: getAssignmentExpression(current),
        k: NIL,
        v: item.v
      };
    } else if (item.t === 3 /* Delete */ && item.s === prev.s) {
      current = {
        t: 3 /* Delete */,
        s: getAssignmentExpression(current),
        k: item.k,
        v: NIL
      };
    } else {
      newAssignments.push(current);
      current = item;
    }
    prev = item;
  }
  newAssignments.push(current);
  return newAssignments;
}
function resolveAssignments(assignments) {
  if (assignments.length) {
    let result = "";
    const merged = mergeAssignments(assignments);
    for (let i = 0, len = merged.length; i < len; i++) {
      result += getAssignmentExpression(merged[i]) + ",";
    }
    return result;
  }
  return NIL;
}
var NULL_CONSTRUCTOR = "Object.create(null)";
var SET_CONSTRUCTOR = "new Set";
var MAP_CONSTRUCTOR = "new Map";
var PROMISE_RESOLVE = "Promise.resolve";
var PROMISE_REJECT = "Promise.reject";
var OBJECT_FLAG_CONSTRUCTOR = {
  [3 /* Frozen */]: "Object.freeze",
  [2 /* Sealed */]: "Object.seal",
  [1 /* NonExtensible */]: "Object.preventExtensions",
  [0 /* None */]: NIL
};
function createBaseSerializerContext(mode, options) {
  return {
    mode,
    plugins: options.plugins,
    features: options.features,
    marked: new Set(options.markedRefs),
    stack: [],
    flags: [],
    assignments: []
  };
}
function createVanillaSerializerState() {
  return {
    valid: /* @__PURE__ */ new Map(),
    vars: []
  };
}
function createVanillaSerializerContext(options) {
  return {
    mode: 1 /* Vanilla */,
    base: createBaseSerializerContext(1 /* Vanilla */, options),
    state: createVanillaSerializerState(),
    child: NIL
  };
}
function createCrossSerializerContext(options) {
  return {
    mode: 2 /* Cross */,
    base: createBaseSerializerContext(2 /* Cross */, options),
    state: options,
    child: NIL
  };
}
var SerializePluginContext = class {
  constructor(_p) {
    this._p = _p;
  }
  serialize(node) {
    return serialize(this._p, node);
  }
};
function getVanillaRefParam(state, index) {
  let actualIndex = state.valid.get(index);
  if (actualIndex == null) {
    actualIndex = state.valid.size;
    state.valid.set(index, actualIndex);
  }
  let identifier = state.vars[actualIndex];
  if (identifier == null) {
    identifier = getIdentifier(actualIndex);
    state.vars[actualIndex] = identifier;
  }
  return identifier;
}
function getCrossRefParam(id) {
  return GLOBAL_CONTEXT_REFERENCES + "[" + id + "]";
}
function getRefParam(ctx, id) {
  return ctx.mode === 1 /* Vanilla */ ? getVanillaRefParam(ctx.state, id) : getCrossRefParam(id);
}
function markSerializerRef(ctx, id) {
  ctx.marked.add(id);
}
function isSerializerRefMarked(ctx, id) {
  return ctx.marked.has(id);
}
function pushObjectFlag(ctx, flag, id) {
  if (flag !== 0 /* None */) {
    markSerializerRef(ctx.base, id);
    ctx.base.flags.push({
      type: flag,
      value: getRefParam(ctx, id)
    });
  }
}
function resolveFlags(ctx) {
  let result = "";
  for (let i = 0, current = ctx.flags, len = current.length; i < len; i++) {
    const flag = current[i];
    result += OBJECT_FLAG_CONSTRUCTOR[flag.type] + "(" + flag.value + "),";
  }
  return result;
}
function resolvePatches(ctx) {
  const assignments = resolveAssignments(ctx.assignments);
  const flags = resolveFlags(ctx);
  if (assignments) {
    if (flags) {
      return assignments + flags;
    }
    return assignments;
  }
  return flags;
}
function createAssignment(ctx, source, value) {
  ctx.assignments.push({
    t: 0 /* Index */,
    s: source,
    k: NIL,
    v: value
  });
}
function createAddAssignment(ctx, ref, value) {
  ctx.base.assignments.push({
    t: 1 /* Add */,
    s: getRefParam(ctx, ref),
    k: NIL,
    v: value
  });
}
function createSetAssignment(ctx, ref, key, value) {
  ctx.base.assignments.push({
    t: 2 /* Set */,
    s: getRefParam(ctx, ref),
    k: key,
    v: value
  });
}
function createDeleteAssignment(ctx, ref, key) {
  ctx.base.assignments.push({
    t: 3 /* Delete */,
    s: getRefParam(ctx, ref),
    k: key,
    v: NIL
  });
}
function createArrayAssign(ctx, ref, index, value) {
  createAssignment(ctx.base, getRefParam(ctx, ref) + "[" + index + "]", value);
}
function createObjectAssign(ctx, ref, key, value) {
  createAssignment(ctx.base, getRefParam(ctx, ref) + "." + key, value);
}
function createSequenceAssign(ctx, ref, index, value) {
  createAssignment(
    ctx.base,
    getRefParam(ctx, ref) + ".v[" + index + "]",
    value
  );
}
function isIndexedValueInStack(ctx, node) {
  return node.t === 4 /* IndexedValue */ && ctx.stack.includes(node.i);
}
function assignIndexedValue2(ctx, index, value) {
  if (ctx.mode === 1 /* Vanilla */ && !isSerializerRefMarked(ctx.base, index)) {
    return value;
  }
  return getRefParam(ctx, index) + "=" + value;
}
function serializeReference(node) {
  return REFERENCES_KEY + '.get("' + node.s + '")';
}
function serializeArrayItem(ctx, id, item, index) {
  if (item) {
    if (isIndexedValueInStack(ctx.base, item)) {
      markSerializerRef(ctx.base, id);
      createArrayAssign(
        ctx,
        id,
        index,
        getRefParam(ctx, item.i)
      );
      return "";
    }
    return serialize(ctx, item);
  }
  return "";
}
function serializeArray(ctx, node) {
  const id = node.i;
  const list = node.a;
  const len = list.length;
  if (len > 0) {
    ctx.base.stack.push(id);
    let values = serializeArrayItem(ctx, id, list[0], 0);
    let isHoley = values === "";
    for (let i = 1, item; i < len; i++) {
      item = serializeArrayItem(ctx, id, list[i], i);
      values += "," + item;
      isHoley = item === "";
    }
    ctx.base.stack.pop();
    pushObjectFlag(ctx, node.o, node.i);
    return "[" + values + (isHoley ? ",]" : "]");
  }
  return "[]";
}
function serializeProperty(ctx, source, key, val) {
  if (typeof key === "string") {
    const check = Number(key);
    const isIdentifier = (
      // Test if key is a valid positive number or JS identifier
      // so that we don't have to serialize the key and wrap with brackets
      check >= 0 && // It's also important to consider that if the key is
      // indeed numeric, we need to make sure that when
      // converted back into a string, it's still the same
      // to the original key. This allows us to differentiate
      // keys that has numeric formats but in a different
      // format, which can cause unintentional key declaration
      // Example: { 0x1: 1 } vs { '0x1': 1 }
      check.toString() === key || isValidIdentifier(key)
    );
    if (isIndexedValueInStack(ctx.base, val)) {
      const refParam = getRefParam(ctx, val.i);
      markSerializerRef(ctx.base, source.i);
      if (isIdentifier && check !== check) {
        createObjectAssign(ctx, source.i, key, refParam);
      } else {
        createArrayAssign(
          ctx,
          source.i,
          isIdentifier ? key : '"' + key + '"',
          refParam
        );
      }
      return "";
    }
    return (isIdentifier ? key : '"' + key + '"') + ":" + serialize(ctx, val);
  }
  return "[" + serialize(ctx, key) + "]:" + serialize(ctx, val);
}
function serializeProperties(ctx, source, record) {
  const keys = record.k;
  const len = keys.length;
  if (len > 0) {
    const values = record.v;
    ctx.base.stack.push(source.i);
    let result = serializeProperty(ctx, source, keys[0], values[0]);
    for (let i = 1, item = result; i < len; i++) {
      item = serializeProperty(ctx, source, keys[i], values[i]);
      result += (item && result && ",") + item;
    }
    ctx.base.stack.pop();
    return "{" + result + "}";
  }
  return "{}";
}
function serializeObject(ctx, node) {
  pushObjectFlag(ctx, node.o, node.i);
  return serializeProperties(ctx, node, node.p);
}
function serializeWithObjectAssign(ctx, source, value, serialized) {
  const fields = serializeProperties(ctx, source, value);
  if (fields !== "{}") {
    return "Object.assign(" + serialized + "," + fields + ")";
  }
  return serialized;
}
function serializeStringKeyAssignment(ctx, source, mainAssignments, key, value) {
  const base = ctx.base;
  const serialized = serialize(ctx, value);
  const check = Number(key);
  const isIdentifier = (
    // Test if key is a valid positive number or JS identifier
    // so that we don't have to serialize the key and wrap with brackets
    check >= 0 && // It's also important to consider that if the key is
    // indeed numeric, we need to make sure that when
    // converted back into a string, it's still the same
    // to the original key. This allows us to differentiate
    // keys that has numeric formats but in a different
    // format, which can cause unintentional key declaration
    // Example: { 0x1: 1 } vs { '0x1': 1 }
    check.toString() === key || isValidIdentifier(key)
  );
  if (isIndexedValueInStack(base, value)) {
    if (isIdentifier && check !== check) {
      createObjectAssign(ctx, source.i, key, serialized);
    } else {
      createArrayAssign(
        ctx,
        source.i,
        isIdentifier ? key : '"' + key + '"',
        serialized
      );
    }
  } else {
    const parentAssignment = base.assignments;
    base.assignments = mainAssignments;
    if (isIdentifier && check !== check) {
      createObjectAssign(ctx, source.i, key, serialized);
    } else {
      createArrayAssign(
        ctx,
        source.i,
        isIdentifier ? key : '"' + key + '"',
        serialized
      );
    }
    base.assignments = parentAssignment;
  }
}
function serializeAssignment(ctx, source, mainAssignments, key, value) {
  if (typeof key === "string") {
    serializeStringKeyAssignment(ctx, source, mainAssignments, key, value);
  } else {
    const base = ctx.base;
    const parent = base.stack;
    base.stack = [];
    const serialized = serialize(ctx, value);
    base.stack = parent;
    const parentAssignment = base.assignments;
    base.assignments = mainAssignments;
    createArrayAssign(ctx, source.i, serialize(ctx, key), serialized);
    base.assignments = parentAssignment;
  }
}
function serializeAssignments(ctx, source, node) {
  const keys = node.k;
  const len = keys.length;
  if (len > 0) {
    const mainAssignments = [];
    const values = node.v;
    ctx.base.stack.push(source.i);
    for (let i = 0; i < len; i++) {
      serializeAssignment(ctx, source, mainAssignments, keys[i], values[i]);
    }
    ctx.base.stack.pop();
    return resolveAssignments(mainAssignments);
  }
  return NIL;
}
function serializeDictionary(ctx, node, init) {
  if (node.p) {
    const base = ctx.base;
    if (base.features & 8 /* ObjectAssign */) {
      init = serializeWithObjectAssign(ctx, node, node.p, init);
    } else {
      markSerializerRef(base, node.i);
      const assignments = serializeAssignments(ctx, node, node.p);
      if (assignments) {
        return "(" + assignIndexedValue2(ctx, node.i, init) + "," + assignments + getRefParam(ctx, node.i) + ")";
      }
    }
  }
  return init;
}
function serializeNullConstructor(ctx, node) {
  pushObjectFlag(ctx, node.o, node.i);
  return serializeDictionary(ctx, node, NULL_CONSTRUCTOR);
}
function serializeDate(node) {
  return 'new Date("' + node.s + '")';
}
function serializeRegExp(ctx, node) {
  if (ctx.base.features & 32 /* RegExp */) {
    return "/" + node.c + "/" + node.m;
  }
  throw new SerovalUnsupportedNodeError(node);
}
function serializeSetItem(ctx, id, item) {
  const base = ctx.base;
  if (isIndexedValueInStack(base, item)) {
    markSerializerRef(base, id);
    createAddAssignment(
      ctx,
      id,
      getRefParam(ctx, item.i)
    );
    return "";
  }
  return serialize(ctx, item);
}
function serializeSet(ctx, node) {
  let serialized = SET_CONSTRUCTOR;
  const items = node.a;
  const size = items.length;
  const id = node.i;
  if (size > 0) {
    ctx.base.stack.push(id);
    let result = serializeSetItem(ctx, id, items[0]);
    for (let i = 1, item = result; i < size; i++) {
      item = serializeSetItem(ctx, id, items[i]);
      result += (item && result && ",") + item;
    }
    ctx.base.stack.pop();
    if (result) {
      serialized += "([" + result + "])";
    }
  }
  return serialized;
}
function serializeMapEntry(ctx, id, key, val, sentinel) {
  const base = ctx.base;
  if (isIndexedValueInStack(base, key)) {
    const keyRef = getRefParam(ctx, key.i);
    markSerializerRef(base, id);
    if (isIndexedValueInStack(base, val)) {
      const valueRef = getRefParam(ctx, val.i);
      createSetAssignment(ctx, id, keyRef, valueRef);
      return "";
    }
    if (val.t !== 4 /* IndexedValue */ && val.i != null && isSerializerRefMarked(base, val.i)) {
      const serialized = "(" + serialize(ctx, val) + ",[" + sentinel + "," + sentinel + "])";
      createSetAssignment(ctx, id, keyRef, getRefParam(ctx, val.i));
      createDeleteAssignment(ctx, id, sentinel);
      return serialized;
    }
    const parent = base.stack;
    base.stack = [];
    createSetAssignment(ctx, id, keyRef, serialize(ctx, val));
    base.stack = parent;
    return "";
  }
  if (isIndexedValueInStack(base, val)) {
    const valueRef = getRefParam(ctx, val.i);
    markSerializerRef(base, id);
    if (key.t !== 4 /* IndexedValue */ && key.i != null && isSerializerRefMarked(base, key.i)) {
      const serialized = "(" + serialize(ctx, key) + ",[" + sentinel + "," + sentinel + "])";
      createSetAssignment(ctx, id, getRefParam(ctx, key.i), valueRef);
      createDeleteAssignment(ctx, id, sentinel);
      return serialized;
    }
    const parent = base.stack;
    base.stack = [];
    createSetAssignment(ctx, id, serialize(ctx, key), valueRef);
    base.stack = parent;
    return "";
  }
  return "[" + serialize(ctx, key) + "," + serialize(ctx, val) + "]";
}
function serializeMap(ctx, node) {
  let serialized = MAP_CONSTRUCTOR;
  const keys = node.e.k;
  const size = keys.length;
  const id = node.i;
  const sentinel = node.f;
  const sentinelId = getRefParam(ctx, sentinel.i);
  const base = ctx.base;
  if (size > 0) {
    const vals = node.e.v;
    base.stack.push(id);
    let result = serializeMapEntry(ctx, id, keys[0], vals[0], sentinelId);
    for (let i = 1, item = result; i < size; i++) {
      item = serializeMapEntry(ctx, id, keys[i], vals[i], sentinelId);
      result += (item && result && ",") + item;
    }
    base.stack.pop();
    if (result) {
      serialized += "([" + result + "])";
    }
  }
  if (sentinel.t === 26 /* SpecialReference */) {
    markSerializerRef(base, sentinel.i);
    serialized = "(" + serialize(ctx, sentinel) + "," + serialized + ")";
  }
  return serialized;
}
function serializeArrayBuffer(ctx, node) {
  return getConstructor(ctx, node.f) + '("' + node.s + '")';
}
function serializeTypedArray(ctx, node) {
  return "new " + node.c + "(" + serialize(ctx, node.f) + "," + node.b + "," + node.l + ")";
}
function serializeDataView(ctx, node) {
  return "new DataView(" + serialize(ctx, node.f) + "," + node.b + "," + node.l + ")";
}
function serializeAggregateError(ctx, node) {
  const id = node.i;
  ctx.base.stack.push(id);
  const serialized = serializeDictionary(
    ctx,
    node,
    'new AggregateError([],"' + node.m + '")'
  );
  ctx.base.stack.pop();
  return serialized;
}
function serializeError(ctx, node) {
  return serializeDictionary(
    ctx,
    node,
    "new " + ERROR_CONSTRUCTOR_STRING[node.s] + '("' + node.m + '")'
  );
}
function serializePromise(ctx, node) {
  let serialized;
  const fulfilled = node.f;
  const id = node.i;
  const promiseConstructor = node.s ? PROMISE_RESOLVE : PROMISE_REJECT;
  const base = ctx.base;
  if (isIndexedValueInStack(base, fulfilled)) {
    const ref = getRefParam(ctx, fulfilled.i);
    serialized = promiseConstructor + (node.s ? "().then(" + createFunction([], ref) + ")" : "().catch(" + createEffectfulFunction([], "throw " + ref) + ")");
  } else {
    base.stack.push(id);
    const result = serialize(ctx, fulfilled);
    base.stack.pop();
    serialized = promiseConstructor + "(" + result + ")";
  }
  return serialized;
}
function serializeBoxed(ctx, node) {
  return "Object(" + serialize(ctx, node.f) + ")";
}
function getConstructor(ctx, node) {
  const current = serialize(ctx, node);
  return node.t === 4 /* IndexedValue */ ? current : "(" + current + ")";
}
function serializePromiseConstructor(ctx, node) {
  if (ctx.mode === 1 /* Vanilla */) {
    throw new SerovalUnsupportedNodeError(node);
  }
  const resolver = assignIndexedValue2(
    ctx,
    node.s,
    getConstructor(ctx, node.f) + "()"
  );
  return "(" + resolver + ").p";
}
function serializePromiseResolve(ctx, node) {
  if (ctx.mode === 1 /* Vanilla */) {
    throw new SerovalUnsupportedNodeError(node);
  }
  return getConstructor(ctx, node.a[0]) + "(" + getRefParam(ctx, node.i) + "," + serialize(ctx, node.a[1]) + ")";
}
function serializePromiseReject(ctx, node) {
  if (ctx.mode === 1 /* Vanilla */) {
    throw new SerovalUnsupportedNodeError(node);
  }
  return getConstructor(ctx, node.a[0]) + "(" + getRefParam(ctx, node.i) + "," + serialize(ctx, node.a[1]) + ")";
}
function serializePlugin(ctx, node) {
  const currentPlugins = ctx.base.plugins;
  if (currentPlugins) {
    for (let i = 0, len = currentPlugins.length; i < len; i++) {
      const plugin = currentPlugins[i];
      if (plugin.tag === node.c) {
        if (ctx.child == null) {
          ctx.child = new SerializePluginContext(ctx);
        }
        return plugin.serialize(node.s, ctx.child, {
          id: node.i
        });
      }
    }
  }
  throw new SerovalMissingPluginError(node.c);
}
function serializeIteratorFactory(ctx, node) {
  let result = "";
  let initialized = false;
  if (node.f.t !== 4 /* IndexedValue */) {
    markSerializerRef(ctx.base, node.f.i);
    result = "(" + serialize(ctx, node.f) + ",";
    initialized = true;
  }
  result += assignIndexedValue2(
    ctx,
    node.i,
    "(" + SERIALIZED_ITERATOR_CONSTRUCTOR + ")(" + getRefParam(ctx, node.f.i) + ")"
  );
  if (initialized) {
    result += ")";
  }
  return result;
}
function serializeIteratorFactoryInstance(ctx, node) {
  return getConstructor(ctx, node.a[0]) + "(" + serialize(ctx, node.a[1]) + ")";
}
function serializeAsyncIteratorFactory(ctx, node) {
  const promise = node.a[0];
  const symbol = node.a[1];
  const base = ctx.base;
  let result = "";
  if (promise.t !== 4 /* IndexedValue */) {
    markSerializerRef(base, promise.i);
    result += "(" + serialize(ctx, promise);
  }
  if (symbol.t !== 4 /* IndexedValue */) {
    markSerializerRef(base, symbol.i);
    result += (result ? "," : "(") + serialize(ctx, symbol);
  }
  if (result) {
    result += ",";
  }
  const iterator = assignIndexedValue2(
    ctx,
    node.i,
    "(" + SERIALIZED_ASYNC_ITERATOR_CONSTRUCTOR + ")(" + getRefParam(ctx, symbol.i) + "," + getRefParam(ctx, promise.i) + ")"
  );
  if (result) {
    return result + iterator + ")";
  }
  return iterator;
}
function serializeAsyncIteratorFactoryInstance(ctx, node) {
  return getConstructor(ctx, node.a[0]) + "(" + serialize(ctx, node.a[1]) + ")";
}
function serializeStreamConstructor(ctx, node) {
  const result = assignIndexedValue2(
    ctx,
    node.i,
    getConstructor(ctx, node.f) + "()"
  );
  const len = node.a.length;
  if (len) {
    let values = serialize(ctx, node.a[0]);
    for (let i = 1; i < len; i++) {
      values += "," + serialize(ctx, node.a[i]);
    }
    return "(" + result + "," + values + "," + getRefParam(ctx, node.i) + ")";
  }
  return result;
}
function serializeStreamNext(ctx, node) {
  return getRefParam(ctx, node.i) + ".next(" + serialize(ctx, node.f) + ")";
}
function serializeStreamThrow(ctx, node) {
  return getRefParam(ctx, node.i) + ".throw(" + serialize(ctx, node.f) + ")";
}
function serializeStreamReturn(ctx, node) {
  return getRefParam(ctx, node.i) + ".return(" + serialize(ctx, node.f) + ")";
}
function serializeSequenceItem(ctx, id, index, item) {
  const base = ctx.base;
  if (isIndexedValueInStack(base, item)) {
    markSerializerRef(base, id);
    createSequenceAssign(
      ctx,
      id,
      index,
      getRefParam(ctx, item.i)
    );
    return "";
  }
  return serialize(ctx, item);
}
function serializeSequence(ctx, node) {
  const items = node.a;
  const size = items.length;
  const id = node.i;
  if (size > 0) {
    ctx.base.stack.push(id);
    let result = serializeSequenceItem(ctx, id, 0, items[0]);
    for (let i = 1, item = result; i < size; i++) {
      item = serializeSequenceItem(ctx, id, i, items[i]);
      result += (item && result && ",") + item;
    }
    ctx.base.stack.pop();
    if (result) {
      return "{__SEROVAL_SEQUENCE__:!0,v:[" + result + "],t:" + node.s + ",d:" + node.l + "}";
    }
  }
  return "{__SEROVAL_SEQUENCE__:!0,v:[],t:-1,d:0}";
}
function serializeAssignable(ctx, node) {
  switch (node.t) {
    case 17 /* WKSymbol */:
      return SYMBOL_STRING[node.s];
    case 18 /* Reference */:
      return serializeReference(node);
    case 9 /* Array */:
      return serializeArray(ctx, node);
    case 10 /* Object */:
      return serializeObject(ctx, node);
    case 11 /* NullConstructor */:
      return serializeNullConstructor(ctx, node);
    case 5 /* Date */:
      return serializeDate(node);
    case 6 /* RegExp */:
      return serializeRegExp(ctx, node);
    case 7 /* Set */:
      return serializeSet(ctx, node);
    case 8 /* Map */:
      return serializeMap(ctx, node);
    case 19 /* ArrayBuffer */:
      return serializeArrayBuffer(ctx, node);
    case 16 /* BigIntTypedArray */:
    case 15 /* TypedArray */:
      return serializeTypedArray(ctx, node);
    case 20 /* DataView */:
      return serializeDataView(ctx, node);
    case 14 /* AggregateError */:
      return serializeAggregateError(ctx, node);
    case 13 /* Error */:
      return serializeError(ctx, node);
    case 12 /* Promise */:
      return serializePromise(ctx, node);
    case 21 /* Boxed */:
      return serializeBoxed(ctx, node);
    case 22 /* PromiseConstructor */:
      return serializePromiseConstructor(ctx, node);
    case 25 /* Plugin */:
      return serializePlugin(ctx, node);
    case 26 /* SpecialReference */:
      return SPECIAL_REF_STRING[node.s];
    case 35 /* Sequence */:
      return serializeSequence(ctx, node);
    default:
      throw new SerovalUnsupportedNodeError(node);
  }
}
function serialize(ctx, node) {
  switch (node.t) {
    case 2 /* Constant */:
      return CONSTANT_STRING[node.s];
    case 0 /* Number */:
      return "" + node.s;
    case 1 /* String */:
      return '"' + node.s + '"';
    case 3 /* BigInt */:
      return node.s + "n";
    case 4 /* IndexedValue */:
      return getRefParam(ctx, node.i);
    case 23 /* PromiseSuccess */:
      return serializePromiseResolve(ctx, node);
    case 24 /* PromiseFailure */:
      return serializePromiseReject(ctx, node);
    case 27 /* IteratorFactory */:
      return serializeIteratorFactory(ctx, node);
    case 28 /* IteratorFactoryInstance */:
      return serializeIteratorFactoryInstance(ctx, node);
    case 29 /* AsyncIteratorFactory */:
      return serializeAsyncIteratorFactory(ctx, node);
    case 30 /* AsyncIteratorFactoryInstance */:
      return serializeAsyncIteratorFactoryInstance(ctx, node);
    case 31 /* StreamConstructor */:
      return serializeStreamConstructor(ctx, node);
    case 32 /* StreamNext */:
      return serializeStreamNext(ctx, node);
    case 33 /* StreamThrow */:
      return serializeStreamThrow(ctx, node);
    case 34 /* StreamReturn */:
      return serializeStreamReturn(ctx, node);
    default:
      return assignIndexedValue2(ctx, node.i, serializeAssignable(ctx, node));
  }
}
function serializeTopVanilla(ctx, tree) {
  const result = serialize(ctx, tree);
  if (tree.i != null && ctx.state.vars.length) {
    const patches = resolvePatches(ctx.base);
    let body = result;
    if (patches) {
      const index = getRefParam(ctx, tree.i);
      body = result + "," + patches + index;
      if (!result.startsWith(index + "=")) {
        body = index + "=" + body;
      }
      body = "(" + body + ")";
    }
    return "(" + createFunction(ctx.state.vars, body) + ")()";
  }
  if (tree.t === 10 /* Object */) {
    return "(" + result + ")";
  }
  return result;
}
function serializeTopCross(ctx, tree) {
  const result = serialize(ctx, tree);
  const id = tree.i;
  if (id == null) {
    return result;
  }
  const patches = resolvePatches(ctx.base);
  const ref = getRefParam(ctx, id);
  const scopeId = ctx.state.scopeId;
  const params = scopeId == null ? "" : GLOBAL_CONTEXT_REFERENCES;
  const body = patches ? "(" + result + "," + patches + ref + ")" : result;
  if (params === "") {
    if (tree.t === 10 /* Object */ && !patches) {
      return "(" + body + ")";
    }
    return body;
  }
  const args = scopeId == null ? "()" : "(" + GLOBAL_CONTEXT_REFERENCES + '["' + serializeString(scopeId) + '"])';
  return "(" + createFunction([params], body) + ")" + args;
}

// src/core/context/sync-parser.ts
function createSyncParserContext(mode, options) {
  return {
    type: 1 /* Sync */,
    base: createBaseParserContext(mode, options),
    child: NIL
  };
}
var SyncParsePluginContext = class {
  constructor(_p, depth) {
    this._p = _p;
    this.depth = depth;
  }
  parse(current) {
    return parseSOS(this._p, this.depth, current);
  }
};
var StreamParsePluginContext = class {
  constructor(_p, depth) {
    this._p = _p;
    this.depth = depth;
  }
  parse(current) {
    return parseSOS(this._p, this.depth, current);
  }
  parseWithError(current) {
    return parseWithError(this._p, this.depth, current);
  }
  isAlive() {
    return this._p.state.alive;
  }
  pushPendingState() {
    pushPendingState(this._p);
  }
  popPendingState() {
    popPendingState(this._p);
  }
  onParse(node) {
    onParse(this._p, node);
  }
  onError(error) {
    onError(this._p, error);
  }
};
function createStreamParserState(options) {
  return {
    alive: true,
    pending: 0,
    initial: true,
    buffer: [],
    onParse: options.onParse,
    onError: options.onError,
    onDone: options.onDone
  };
}
function createStreamParserContext(options) {
  return {
    type: 2 /* Stream */,
    base: createBaseParserContext(2 /* Cross */, options),
    state: createStreamParserState(options)
  };
}
function parseItems2(ctx, depth, current) {
  const nodes = [];
  for (let i = 0, len = current.length; i < len; i++) {
    if (i in current) {
      nodes[i] = parseSOS(ctx, depth, current[i]);
    } else {
      nodes[i] = 0;
    }
  }
  return nodes;
}
function parseArray2(ctx, depth, id, current) {
  return createArrayNode(id, current, parseItems2(ctx, depth, current));
}
function parseProperties2(ctx, depth, properties) {
  const entries = Object.entries(properties);
  const keyNodes = [];
  const valueNodes = [];
  for (let i = 0, len = entries.length; i < len; i++) {
    keyNodes.push(serializeString(entries[i][0]));
    valueNodes.push(parseSOS(ctx, depth, entries[i][1]));
  }
  if (SYM_ITERATOR in properties) {
    keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_ITERATOR));
    valueNodes.push(
      createIteratorFactoryInstanceNode(
        parseIteratorFactory(ctx.base),
        parseSOS(
          ctx,
          depth,
          createSequenceFromIterable(
            properties
          )
        )
      )
    );
  }
  if (SYM_ASYNC_ITERATOR in properties) {
    keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_ASYNC_ITERATOR));
    valueNodes.push(
      createAsyncIteratorFactoryInstanceNode(
        parseAsyncIteratorFactory(ctx.base),
        parseSOS(
          ctx,
          depth,
          ctx.type === 1 /* Sync */ ? createStream() : createStreamFromAsyncIterable(
            properties
          )
        )
      )
    );
  }
  if (SYM_TO_STRING_TAG in properties) {
    keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_TO_STRING_TAG));
    valueNodes.push(createStringNode(properties[SYM_TO_STRING_TAG]));
  }
  if (SYM_IS_CONCAT_SPREADABLE in properties) {
    keyNodes.push(parseWellKnownSymbol(ctx.base, SYM_IS_CONCAT_SPREADABLE));
    valueNodes.push(
      properties[SYM_IS_CONCAT_SPREADABLE] ? TRUE_NODE : FALSE_NODE
    );
  }
  return {
    k: keyNodes,
    v: valueNodes
  };
}
function parsePlainObject2(ctx, depth, id, current, empty) {
  return createObjectNode(
    id,
    current,
    empty,
    parseProperties2(ctx, depth, current)
  );
}
function parseBoxed2(ctx, depth, id, current) {
  return createBoxedNode(id, parseSOS(ctx, depth, current.valueOf()));
}
function parseTypedArray2(ctx, depth, id, current) {
  return createTypedArrayNode(
    id,
    current,
    parseSOS(ctx, depth, current.buffer)
  );
}
function parseBigIntTypedArray2(ctx, depth, id, current) {
  return createBigIntTypedArrayNode(
    id,
    current,
    parseSOS(ctx, depth, current.buffer)
  );
}
function parseDataView2(ctx, depth, id, current) {
  return createDataViewNode(id, current, parseSOS(ctx, depth, current.buffer));
}
function parseError2(ctx, depth, id, current) {
  const options = getErrorOptions(current, ctx.base.features);
  return createErrorNode(
    id,
    current,
    options ? parseProperties2(ctx, depth, options) : NIL
  );
}
function parseAggregateError2(ctx, depth, id, current) {
  const options = getErrorOptions(current, ctx.base.features);
  return createAggregateErrorNode(
    id,
    current,
    options ? parseProperties2(ctx, depth, options) : NIL
  );
}
function parseMap2(ctx, depth, id, current) {
  const keyNodes = [];
  const valueNodes = [];
  for (const [key, value] of current.entries()) {
    keyNodes.push(parseSOS(ctx, depth, key));
    valueNodes.push(parseSOS(ctx, depth, value));
  }
  return createMapNode(ctx.base, id, keyNodes, valueNodes);
}
function parseSet2(ctx, depth, id, current) {
  const items = [];
  for (const item of current.keys()) {
    items.push(parseSOS(ctx, depth, item));
  }
  return createSetNode(id, items);
}
function parseStream2(ctx, depth, id, current) {
  const result = createStreamConstructorNode(
    id,
    parseSpecialReference(ctx.base, 4 /* StreamConstructor */),
    []
  );
  if (ctx.type === 1 /* Sync */) {
    return result;
  }
  pushPendingState(ctx);
  current.on({
    next: (value) => {
      if (ctx.state.alive) {
        const parsed = parseWithError(ctx, depth, value);
        if (parsed) {
          onParse(ctx, createStreamNextNode(id, parsed));
        }
      }
    },
    throw: (value) => {
      if (ctx.state.alive) {
        const parsed = parseWithError(ctx, depth, value);
        if (parsed) {
          onParse(ctx, createStreamThrowNode(id, parsed));
        }
      }
      popPendingState(ctx);
    },
    return: (value) => {
      if (ctx.state.alive) {
        const parsed = parseWithError(ctx, depth, value);
        if (parsed) {
          onParse(ctx, createStreamReturnNode(id, parsed));
        }
      }
      popPendingState(ctx);
    }
  });
  return result;
}
function handlePromiseSuccess(id, depth, data) {
  if (this.state.alive) {
    const parsed = parseWithError(this, depth, data);
    if (parsed) {
      onParse(
        this,
        createSerovalNode(
          23 /* PromiseSuccess */,
          id,
          NIL,
          NIL,
          NIL,
          NIL,
          NIL,
          [
            parseSpecialReference(this.base, 2 /* PromiseSuccess */),
            parsed
          ],
          NIL,
          NIL,
          NIL,
          NIL
        )
      );
    }
    popPendingState(this);
  }
}
function handlePromiseFailure(id, depth, data) {
  if (this.state.alive) {
    const parsed = parseWithError(this, depth, data);
    if (parsed) {
      onParse(
        this,
        createSerovalNode(
          24 /* PromiseFailure */,
          id,
          NIL,
          NIL,
          NIL,
          NIL,
          NIL,
          [
            parseSpecialReference(this.base, 3 /* PromiseFailure */),
            parsed
          ],
          NIL,
          NIL,
          NIL,
          NIL
        )
      );
    }
  }
  popPendingState(this);
}
function parsePromise2(ctx, depth, id, current) {
  const resolver = createIndexForValue(ctx.base, {});
  if (ctx.type === 2 /* Stream */) {
    pushPendingState(ctx);
    current.then(
      handlePromiseSuccess.bind(ctx, resolver, depth),
      handlePromiseFailure.bind(ctx, resolver, depth)
    );
  }
  return createPromiseConstructorNode(ctx.base, id, resolver);
}
function parsePluginSync(ctx, depth, id, current, currentPlugins) {
  for (let i = 0, len = currentPlugins.length; i < len; i++) {
    const plugin = currentPlugins[i];
    if (plugin.parse.sync && plugin.test(current)) {
      return createPluginNode(
        id,
        plugin.tag,
        plugin.parse.sync(current, new SyncParsePluginContext(ctx, depth), {
          id
        })
      );
    }
  }
  return NIL;
}
function parsePluginStream(ctx, depth, id, current, currentPlugins) {
  for (let i = 0, len = currentPlugins.length; i < len; i++) {
    const plugin = currentPlugins[i];
    if (plugin.parse.stream && plugin.test(current)) {
      return createPluginNode(
        id,
        plugin.tag,
        plugin.parse.stream(current, new StreamParsePluginContext(ctx, depth), {
          id
        })
      );
    }
  }
  return NIL;
}
function parsePlugin2(ctx, depth, id, current) {
  const currentPlugins = ctx.base.plugins;
  if (currentPlugins) {
    return ctx.type === 1 /* Sync */ ? parsePluginSync(ctx, depth, id, current, currentPlugins) : parsePluginStream(ctx, depth, id, current, currentPlugins);
  }
  return NIL;
}
function parseSequence2(ctx, depth, id, current) {
  const nodes = [];
  for (let i = 0, len = current.v.length; i < len; i++) {
    nodes[i] = parseSOS(ctx, depth, current.v[i]);
  }
  return createSequenceNode(id, nodes, current.t, current.d);
}
function parseObjectPhase2(ctx, depth, id, current, currentClass) {
  switch (currentClass) {
    case Object:
      return parsePlainObject2(
        ctx,
        depth,
        id,
        current,
        false
      );
    case NIL:
      return parsePlainObject2(
        ctx,
        depth,
        id,
        current,
        true
      );
    case Date:
      return createDateNode(id, current);
    case Error:
    case EvalError:
    case RangeError:
    case ReferenceError:
    case SyntaxError:
    case TypeError:
    case URIError:
      return parseError2(ctx, depth, id, current);
    case Number:
    case Boolean:
    case String:
    case BigInt:
      return parseBoxed2(ctx, depth, id, current);
    case ArrayBuffer:
      return createArrayBufferNode(
        ctx.base,
        id,
        current
      );
    case Int8Array:
    case Int16Array:
    case Int32Array:
    case Uint8Array:
    case Uint16Array:
    case Uint32Array:
    case Uint8ClampedArray:
    case Float32Array:
    case Float64Array:
      return parseTypedArray2(
        ctx,
        depth,
        id,
        current
      );
    case DataView:
      return parseDataView2(ctx, depth, id, current);
    case Map:
      return parseMap2(
        ctx,
        depth,
        id,
        current
      );
    case Set:
      return parseSet2(ctx, depth, id, current);
    default:
      break;
  }
  if (currentClass === Promise || current instanceof Promise) {
    return parsePromise2(ctx, depth, id, current);
  }
  const currentFeatures = ctx.base.features;
  if (currentFeatures & 32 /* RegExp */ && currentClass === RegExp) {
    return createRegExpNode(id, current);
  }
  if (currentFeatures & 16 /* BigIntTypedArray */) {
    switch (currentClass) {
      case BigInt64Array:
      case BigUint64Array:
        return parseBigIntTypedArray2(
          ctx,
          depth,
          id,
          current
        );
      default:
        break;
    }
  }
  if (currentFeatures & 1 /* AggregateError */ && typeof AggregateError !== "undefined" && (currentClass === AggregateError || current instanceof AggregateError)) {
    return parseAggregateError2(
      ctx,
      depth,
      id,
      current
    );
  }
  if (current instanceof Error) {
    return parseError2(ctx, depth, id, current);
  }
  if (SYM_ITERATOR in current || SYM_ASYNC_ITERATOR in current) {
    return parsePlainObject2(ctx, depth, id, current, !!currentClass);
  }
  throw new SerovalUnsupportedTypeError(current);
}
function parseObject(ctx, depth, id, current) {
  if (Array.isArray(current)) {
    return parseArray2(ctx, depth, id, current);
  }
  if (isStream(current)) {
    return parseStream2(ctx, depth, id, current);
  }
  if (isSequence(current)) {
    return parseSequence2(ctx, depth, id, current);
  }
  const currentClass = current.constructor;
  if (currentClass === OpaqueReference) {
    return parseSOS(
      ctx,
      depth,
      current.replacement
    );
  }
  const parsed = parsePlugin2(ctx, depth, id, current);
  if (parsed) {
    return parsed;
  }
  return parseObjectPhase2(ctx, depth, id, current, currentClass);
}
function parseFunction(ctx, depth, current) {
  const ref = getReferenceNode(ctx.base, current);
  if (ref.type !== 0 /* Fresh */) {
    return ref.value;
  }
  const plugin = parsePlugin2(ctx, depth, ref.value, current);
  if (plugin) {
    return plugin;
  }
  throw new SerovalUnsupportedTypeError(current);
}
function parseSOS(ctx, depth, current) {
  if (depth >= ctx.base.depthLimit) {
    throw new SerovalDepthLimitError(ctx.base.depthLimit);
  }
  switch (typeof current) {
    case "boolean":
      return current ? TRUE_NODE : FALSE_NODE;
    case "undefined":
      return UNDEFINED_NODE;
    case "string":
      return createStringNode(current);
    case "number":
      return createNumberNode(current);
    case "bigint":
      return createBigIntNode(current);
    case "object": {
      if (current) {
        const ref = getReferenceNode(ctx.base, current);
        return ref.type === 0 /* Fresh */ ? parseObject(ctx, depth + 1, ref.value, current) : ref.value;
      }
      return NULL_NODE;
    }
    case "symbol":
      return parseWellKnownSymbol(ctx.base, current);
    case "function": {
      return parseFunction(ctx, depth, current);
    }
    default:
      throw new SerovalUnsupportedTypeError(current);
  }
}
function parseTop(ctx, current) {
  try {
    return parseSOS(ctx, 0, current);
  } catch (error) {
    throw error instanceof SerovalParserError ? error : new SerovalParserError(error);
  }
}
function onParse(ctx, node) {
  if (ctx.state.initial) {
    ctx.state.buffer.push(node);
  } else {
    onParseInternal(ctx, node, false);
  }
}
function onError(ctx, error) {
  if (ctx.state.onError) {
    ctx.state.onError(error);
  } else {
    throw error instanceof SerovalParserError ? error : new SerovalParserError(error);
  }
}
function onDone(ctx) {
  if (ctx.state.onDone) {
    ctx.state.onDone();
  }
}
function onParseInternal(ctx, node, initial) {
  try {
    ctx.state.onParse(node, initial);
  } catch (error) {
    onError(ctx, error);
  }
}
function pushPendingState(ctx) {
  ctx.state.pending++;
}
function popPendingState(ctx) {
  if (--ctx.state.pending <= 0) {
    onDone(ctx);
  }
}
function parseWithError(ctx, depth, current) {
  try {
    return parseSOS(ctx, depth, current);
  } catch (err) {
    onError(ctx, err);
    return NIL;
  }
}
function startStreamParse(ctx, current) {
  const parsed = parseWithError(ctx, 0, current);
  if (parsed) {
    onParseInternal(ctx, parsed, true);
    ctx.state.initial = false;
    flushStreamParse(ctx, ctx.state);
    if (ctx.state.pending <= 0) {
      destroyStreamParse(ctx);
    }
  }
}
function flushStreamParse(ctx, state) {
  for (let i = 0, len = state.buffer.length; i < len; i++) {
    onParseInternal(ctx, state.buffer[i], false);
  }
}
function destroyStreamParse(ctx) {
  if (ctx.state.alive) {
    onDone(ctx);
    ctx.state.alive = false;
  }
}

// src/core/cross/index.ts
function crossSerialize(source, options = {}) {
  const plugins = resolvePlugins(options.plugins);
  const ctx = createSyncParserContext(2 /* Cross */, {
    plugins,
    disabledFeatures: options.disabledFeatures,
    refs: options.refs
  });
  const tree = parseTop(ctx, source);
  const serial = createCrossSerializerContext({
    plugins,
    features: ctx.base.features,
    scopeId: options.scopeId,
    markedRefs: ctx.base.marked
  });
  return serializeTopCross(serial, tree);
}
async function crossSerializeAsync(source, options = {}) {
  const plugins = resolvePlugins(options.plugins);
  const ctx = createAsyncParserContext(2 /* Cross */, {
    plugins,
    disabledFeatures: options.disabledFeatures,
    refs: options.refs
  });
  const tree = await parseTopAsync(ctx, source);
  const serial = createCrossSerializerContext({
    plugins,
    features: ctx.base.features,
    scopeId: options.scopeId,
    markedRefs: ctx.base.marked
  });
  return serializeTopCross(serial, tree);
}
function toCrossJSON(source, options = {}) {
  const plugins = resolvePlugins(options.plugins);
  const ctx = createSyncParserContext(2 /* Cross */, {
    plugins,
    disabledFeatures: options.disabledFeatures,
    refs: options.refs
  });
  return parseTop(ctx, source);
}
async function toCrossJSONAsync(source, options = {}) {
  const plugins = resolvePlugins(options.plugins);
  const ctx = createAsyncParserContext(2 /* Cross */, {
    plugins,
    disabledFeatures: options.disabledFeatures,
    refs: options.refs
  });
  return await parseTopAsync(ctx, source);
}
function crossSerializeStream(source, options) {
  const plugins = resolvePlugins(options.plugins);
  const ctx = createStreamParserContext({
    plugins,
    refs: options.refs,
    disabledFeatures: options.disabledFeatures,
    onParse(node, initial) {
      const serial = createCrossSerializerContext({
        plugins,
        features: ctx.base.features,
        scopeId: options.scopeId,
        markedRefs: ctx.base.marked
      });
      let serialized;
      try {
        serialized = serializeTopCross(serial, node);
      } catch (err) {
        if (options.onError) {
          options.onError(err);
        }
        return;
      }
      options.onSerialize(serialized, initial);
    },
    onError: options.onError,
    onDone: options.onDone
  });
  startStreamParse(ctx, source);
  return destroyStreamParse.bind(null, ctx);
}
function toCrossJSONStream(source, options) {
  const plugins = resolvePlugins(options.plugins);
  const ctx = createStreamParserContext({
    plugins,
    refs: options.refs,
    disabledFeatures: options.disabledFeatures,
    depthLimit: options.depthLimit,
    onParse: options.onParse,
    onError: options.onError,
    onDone: options.onDone
  });
  startStreamParse(ctx, source);
  return destroyStreamParse.bind(null, ctx);
}
function fromCrossJSON(source, options) {
  const plugins = resolvePlugins(options.plugins);
  const ctx = createCrossDeserializerContext({
    plugins,
    refs: options.refs,
    features: options.features,
    disabledFeatures: options.disabledFeatures,
    depthLimit: options.depthLimit
  });
  return deserializeTop(ctx, source);
}

// src/core/Serializer.ts
var Serializer = class {
  constructor(options) {
    this.options = options;
    this.alive = true;
    this.flushed = false;
    this.done = false;
    this.pending = 0;
    this.cleanups = [];
    this.refs = /* @__PURE__ */ new Map();
    this.keys = /* @__PURE__ */ new Set();
    this.ids = 0;
    this.plugins = resolvePlugins(options.plugins);
  }
  write(key, value) {
    if (this.alive && !this.flushed) {
      this.pending++;
      this.keys.add(key);
      this.cleanups.push(
        crossSerializeStream(value, {
          plugins: this.plugins,
          scopeId: this.options.scopeId,
          refs: this.refs,
          disabledFeatures: this.options.disabledFeatures,
          onError: this.options.onError,
          onSerialize: (data, initial) => {
            if (this.alive) {
              this.options.onData(
                initial ? this.options.globalIdentifier + '["' + serializeString(key) + '"]=' + data : data
              );
            }
          },
          onDone: () => {
            if (this.alive) {
              this.pending--;
              if (this.pending <= 0 && this.flushed && !this.done && this.options.onDone) {
                this.options.onDone();
                this.done = true;
              }
            }
          }
        })
      );
    }
  }
  getNextID() {
    while (this.keys.has("" + this.ids)) {
      this.ids++;
    }
    return "" + this.ids;
  }
  push(value) {
    const newID = this.getNextID();
    this.write(newID, value);
    return newID;
  }
  flush() {
    if (this.alive) {
      this.flushed = true;
      if (this.pending <= 0 && !this.done && this.options.onDone) {
        this.options.onDone();
        this.done = true;
      }
    }
  }
  close() {
    if (this.alive) {
      for (let i = 0, len = this.cleanups.length; i < len; i++) {
        this.cleanups[i]();
      }
      if (!this.done && this.options.onDone) {
        this.options.onDone();
        this.done = true;
      }
      this.alive = false;
    }
  }
};

// src/core/tree/index.ts
function serialize2(source, options = {}) {
  const plugins = resolvePlugins(options.plugins);
  const ctx = createSyncParserContext(1 /* Vanilla */, {
    plugins,
    disabledFeatures: options.disabledFeatures
  });
  const tree = parseTop(ctx, source);
  const serial = createVanillaSerializerContext({
    plugins,
    features: ctx.base.features,
    markedRefs: ctx.base.marked
  });
  return serializeTopVanilla(serial, tree);
}
async function serializeAsync(source, options = {}) {
  const plugins = resolvePlugins(options.plugins);
  const ctx = createAsyncParserContext(1 /* Vanilla */, {
    plugins,
    disabledFeatures: options.disabledFeatures
  });
  const tree = await parseTopAsync(ctx, source);
  const serial = createVanillaSerializerContext({
    plugins,
    features: ctx.base.features,
    markedRefs: ctx.base.marked
  });
  return serializeTopVanilla(serial, tree);
}
function deserialize2(source) {
  return (0, eval)(source);
}
function toJSON(source, options = {}) {
  const plugins = resolvePlugins(options.plugins);
  const ctx = createSyncParserContext(1 /* Vanilla */, {
    plugins,
    disabledFeatures: options.disabledFeatures
  });
  return {
    t: parseTop(ctx, source),
    f: ctx.base.features,
    m: Array.from(ctx.base.marked)
  };
}
async function toJSONAsync(source, options = {}) {
  const plugins = resolvePlugins(options.plugins);
  const ctx = createAsyncParserContext(1 /* Vanilla */, {
    plugins,
    disabledFeatures: options.disabledFeatures
  });
  return {
    t: await parseTopAsync(ctx, source),
    f: ctx.base.features,
    m: Array.from(ctx.base.marked)
  };
}
function compileJSON(source, options = {}) {
  const plugins = resolvePlugins(options.plugins);
  const ctx = createVanillaSerializerContext({
    plugins,
    features: source.f,
    markedRefs: source.m
  });
  return serializeTopVanilla(ctx, source.t);
}
function fromJSON(source, options = {}) {
  var _a;
  const plugins = resolvePlugins(options.plugins);
  const disabledFeatures = options.disabledFeatures || 0;
  const sourceFeatures = (_a = source.f) != null ? _a : ALL_ENABLED;
  const ctx = createVanillaDeserializerContext({
    plugins,
    markedRefs: source.m,
    features: sourceFeatures & ~disabledFeatures,
    disabledFeatures
  });
  return deserializeTop(ctx, source.t);
}
//# sourceMappingURL=index.cjs.map
