import { SYM_ASYNC_ITERATOR, SYM_HAS_INSTANCE, SYM_IS_CONCAT_SPREADABLE, SYM_ITERATOR, SYM_MATCH, SYM_MATCH_ALL, SYM_REPLACE, SYM_SEARCH, SYM_SPECIES, SYM_SPLIT, SYM_TO_PRIMITIVE, SYM_TO_STRING_TAG, SYM_UNSCOPABLES } from './symbols';
export declare const enum SerovalConstant {
    Null = 0,
    Undefined = 1,
    True = 2,
    False = 3,
    NegZero = 4,
    Inf = 5,
    NegInf = 6,
    Nan = 7
}
export declare const enum SerovalNodeType {
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
    Sequence = 35
}
export declare const enum SerovalObjectFlags {
    None = 0,
    NonExtensible = 1,
    Sealed = 2,
    Frozen = 3
}
export declare const enum Symbols {
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
    Unscopables = 12
}
export declare const SYMBOL_STRING: Record<Symbols, string>;
export declare const INV_SYMBOL_REF: {
    [Symbol.asyncIterator]: Symbols;
    [Symbol.hasInstance]: Symbols;
    [Symbol.isConcatSpreadable]: Symbols;
    [Symbol.iterator]: Symbols;
    [Symbol.match]: Symbols;
    [Symbol.matchAll]: Symbols;
    [Symbol.replace]: Symbols;
    [Symbol.search]: Symbols;
    [Symbol.species]: Symbols;
    [Symbol.split]: Symbols;
    [Symbol.toPrimitive]: Symbols;
    [Symbol.toStringTag]: Symbols;
    [Symbol.unscopables]: Symbols;
};
export type WellKnownSymbols = keyof typeof INV_SYMBOL_REF;
export declare const SYMBOL_REF: Record<Symbols, WellKnownSymbols>;
export declare const CONSTANT_STRING: Record<SerovalConstant, string>;
export declare const NIL: undefined;
export declare const CONSTANT_VAL: Record<SerovalConstant, unknown>;
export declare const enum ErrorConstructorTag {
    Error = 0,
    EvalError = 1,
    RangeError = 2,
    ReferenceError = 3,
    SyntaxError = 4,
    TypeError = 5,
    URIError = 6
}
export declare const ERROR_CONSTRUCTOR_STRING: Record<ErrorConstructorTag, string>;
type ErrorConstructors = ErrorConstructor | EvalErrorConstructor | RangeErrorConstructor | ReferenceErrorConstructor | SyntaxErrorConstructor | TypeErrorConstructor | URIErrorConstructor;
export declare const ERROR_CONSTRUCTOR: Record<ErrorConstructorTag, ErrorConstructors>;
export {};
//# sourceMappingURL=constants.d.ts.map