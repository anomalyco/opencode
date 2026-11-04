import {
  SYM_ASYNC_ITERATOR,
  SYM_HAS_INSTANCE,
  SYM_IS_CONCAT_SPREADABLE,
  SYM_ITERATOR,
  SYM_MATCH,
  SYM_MATCH_ALL,
  SYM_REPLACE,
  SYM_SEARCH,
  SYM_SPECIES,
  SYM_SPLIT,
  SYM_TO_PRIMITIVE,
  SYM_TO_STRING_TAG,
  SYM_UNSCOPABLES,
} from './symbols';

export const enum SerovalConstant {
  Null = 0,
  Undefined = 1,
  True = 2,
  False = 3,
  NegZero = 4,
  Inf = 5,
  NegInf = 6,
  Nan = 7,
}

export const enum SerovalNodeType {
  Number = 0,
  String = 1,
  Constant = 2,
  BigInt = 3,
  IndexedValue = 4,
  Date = 5,
  RegExp = 6,
  Set = 7,
  Map = 8,
  Array = 9,
  Object = 10,
  NullConstructor = 11,
  Promise = 12,
  Error = 13,
  AggregateError = 14,
  TypedArray = 15,
  BigIntTypedArray = 16,
  WKSymbol = 17,
  Reference = 18,
  ArrayBuffer = 19,
  DataView = 20,
  Boxed = 21,
  PromiseConstructor = 22,
  PromiseSuccess = 23,
  PromiseFailure = 24,
  Plugin = 25,
  SpecialReference = 26,
  IteratorFactory = 27,
  IteratorFactoryInstance = 28,
  AsyncIteratorFactory = 29,
  AsyncIteratorFactoryInstance = 30,
  StreamConstructor = 31,
  StreamNext = 32,
  StreamThrow = 33,
  StreamReturn = 34,
  Sequence = 35,
}

export const enum SerovalObjectFlags {
  None = 0,
  NonExtensible = 1,
  Sealed = 2,
  Frozen = 3,
}

export const enum Symbols {
  AsyncIterator = 0,
  HasInstance = 1,
  IsConcatSpreadable = 2,
  Iterator = 3,
  Match = 4,
  MatchAll = 5,
  Replace = 6,
  Search = 7,
  Species = 8,
  Split = 9,
  ToPrimitive = 10,
  ToStringTag = 11,
  Unscopables = 12,
}

export const SYMBOL_STRING: Record<Symbols, string> = {
  [Symbols.AsyncIterator]: 'Symbol.asyncIterator',
  [Symbols.HasInstance]: 'Symbol.hasInstance',
  [Symbols.IsConcatSpreadable]: 'Symbol.isConcatSpreadable',
  [Symbols.Iterator]: 'Symbol.iterator',
  [Symbols.Match]: 'Symbol.match',
  [Symbols.MatchAll]: 'Symbol.matchAll',
  [Symbols.Replace]: 'Symbol.replace',
  [Symbols.Search]: 'Symbol.search',
  [Symbols.Species]: 'Symbol.species',
  [Symbols.Split]: 'Symbol.split',
  [Symbols.ToPrimitive]: 'Symbol.toPrimitive',
  [Symbols.ToStringTag]: 'Symbol.toStringTag',
  [Symbols.Unscopables]: 'Symbol.unscopables',
};

export const INV_SYMBOL_REF = /* @__PURE__ */ {
  [SYM_ASYNC_ITERATOR]: Symbols.AsyncIterator,
  [SYM_HAS_INSTANCE]: Symbols.HasInstance,
  [SYM_IS_CONCAT_SPREADABLE]: Symbols.IsConcatSpreadable,
  [SYM_ITERATOR]: Symbols.Iterator,
  [SYM_MATCH]: Symbols.Match,
  [SYM_MATCH_ALL]: Symbols.MatchAll,
  [SYM_REPLACE]: Symbols.Replace,
  [SYM_SEARCH]: Symbols.Search,
  [SYM_SPECIES]: Symbols.Species,
  [SYM_SPLIT]: Symbols.Split,
  [SYM_TO_PRIMITIVE]: Symbols.ToPrimitive,
  [SYM_TO_STRING_TAG]: Symbols.ToStringTag,
  [SYM_UNSCOPABLES]: Symbols.Unscopables,
};

export type WellKnownSymbols = keyof typeof INV_SYMBOL_REF;

export const SYMBOL_REF: Record<Symbols, WellKnownSymbols> = {
  [Symbols.AsyncIterator]: SYM_ASYNC_ITERATOR,
  [Symbols.HasInstance]: SYM_HAS_INSTANCE,
  [Symbols.IsConcatSpreadable]: SYM_IS_CONCAT_SPREADABLE,
  [Symbols.Iterator]: SYM_ITERATOR,
  [Symbols.Match]: SYM_MATCH,
  [Symbols.MatchAll]: SYM_MATCH_ALL,
  [Symbols.Replace]: SYM_REPLACE,
  [Symbols.Search]: SYM_SEARCH,
  [Symbols.Species]: SYM_SPECIES,
  [Symbols.Split]: SYM_SPLIT,
  [Symbols.ToPrimitive]: SYM_TO_PRIMITIVE,
  [Symbols.ToStringTag]: SYM_TO_STRING_TAG,
  [Symbols.Unscopables]: SYM_UNSCOPABLES,
};

export const CONSTANT_STRING: Record<SerovalConstant, string> = {
  [SerovalConstant.True]: '!0',
  [SerovalConstant.False]: '!1',
  [SerovalConstant.Undefined]: 'void 0',
  [SerovalConstant.Null]: 'null',
  [SerovalConstant.NegZero]: '-0',
  [SerovalConstant.Inf]: '1/0',
  [SerovalConstant.NegInf]: '-1/0',
  [SerovalConstant.Nan]: '0/0',
};

export const NIL = void 0;

export const CONSTANT_VAL: Record<SerovalConstant, unknown> = {
  [SerovalConstant.True]: true,
  [SerovalConstant.False]: false,
  [SerovalConstant.Undefined]: NIL,
  [SerovalConstant.Null]: null,
  [SerovalConstant.NegZero]: -0,
  [SerovalConstant.Inf]: Number.POSITIVE_INFINITY,
  [SerovalConstant.NegInf]: Number.NEGATIVE_INFINITY,
  [SerovalConstant.Nan]: Number.NaN,
};

export const enum ErrorConstructorTag {
  Error = 0,
  EvalError = 1,
  RangeError = 2,
  ReferenceError = 3,
  SyntaxError = 4,
  TypeError = 5,
  URIError = 6,
}

export const ERROR_CONSTRUCTOR_STRING: Record<ErrorConstructorTag, string> = {
  [ErrorConstructorTag.Error]: 'Error',
  [ErrorConstructorTag.EvalError]: 'EvalError',
  [ErrorConstructorTag.RangeError]: 'RangeError',
  [ErrorConstructorTag.ReferenceError]: 'ReferenceError',
  [ErrorConstructorTag.SyntaxError]: 'SyntaxError',
  [ErrorConstructorTag.TypeError]: 'TypeError',
  [ErrorConstructorTag.URIError]: 'URIError',
};

type ErrorConstructors =
  | ErrorConstructor
  | EvalErrorConstructor
  | RangeErrorConstructor
  | ReferenceErrorConstructor
  | SyntaxErrorConstructor
  | TypeErrorConstructor
  | URIErrorConstructor;

export const ERROR_CONSTRUCTOR: Record<ErrorConstructorTag, ErrorConstructors> =
  {
    [ErrorConstructorTag.Error]: Error,
    [ErrorConstructorTag.EvalError]: EvalError,
    [ErrorConstructorTag.RangeError]: RangeError,
    [ErrorConstructorTag.ReferenceError]: ReferenceError,
    [ErrorConstructorTag.SyntaxError]: SyntaxError,
    [ErrorConstructorTag.TypeError]: TypeError,
    [ErrorConstructorTag.URIError]: URIError,
  };
