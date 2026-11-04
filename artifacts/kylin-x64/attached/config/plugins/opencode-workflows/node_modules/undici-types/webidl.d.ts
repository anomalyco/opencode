// These types are not exported, and are only used internally

/**
 * Take in an unknown value and return one that is of type T
 */
type Converter<T> = (object: unknown) => T

type SequenceConverter<T> = (object: unknown, iterable?: IterableIterator<T>) => T[]

type RecordConverter<K extends string, V> = (object: unknown) => Record<K, V>

interface ConvertToIntOpts {
  clamp?: boolean
  enforceRange?: boolean
}

interface WebidlErrors {
  exception (opts: { header: string, message: string }): TypeError
  /**
   * @description Throw an error when conversion from one type to another has failed
   */
  conversionFailed (opts: {
    prefix: string
    argument: string
    types: string[]
  }): TypeError
  /**
   * @description Throw an error when an invalid argument is provided
   */
  invalidArgument (opts: {
    prefix: string
    value: string
    type: string
  }): TypeError
}

interface WebidlUtil {
  /**
   * @see https://tc39.es/ecma262/#sec-ecmascript-data-types-and-values
   */
  Type (object: unknown):
    | 'Undefined'
    | 'Boolean'
    | 'String'
    | 'Symbol'
    | 'Number'
    | 'BigInt'
    | 'Null'
    | 'Object'

  /**
   * @see https://webidl.spec.whatwg.org/#abstract-opdef-converttoint
   */
  ConvertToInt (
    V: unknown,
    bitLength: number,
    signedness: 'signed' | 'unsigned',
    opts?: ConvertToIntOpts
  ): number

  /**
   * @see https://webidl.spec.whatwg.org/#abstract-opdef-converttoint
   */
  IntegerPart (N: number): number

  /**
   * Stringifies {@param V}
   */
  Stringify (V: any): string

  /**
   * Mark a value as uncloneable for Node.js.
   * This is only effective in some newer Node.js versions.
   */
  markAsUncloneable (V: any): void
}

interface WebidlConverters {
  /**
   * @see https://webidl.spec.whatwg.org/#es-DOMString
   */
  DOMString (V: unknown, prefix: string, argument: string, opts?: {
    legacyNullToEmptyString: boolean
  }): string

  /**
   * @see https://webidl.spec.whatwg.org/#es-ByteString
   */
  ByteString (V: unknown, prefix: string, argument: string): string

  /**
   * @see https://webidl.spec.whatwg.org/#es-USVString
   */
  USVString (V: unknown): string

  /**
   * @see https://webidl.spec.whatwg.org/#es-boolean
   */
  boolean (V: unknown): boolean

  /**
   * @see https://webidl.spec.whatwg.org/#es-any
   */
  any <Value>(V: Value): Value

  /**
   * @see https://webidl.spec.whatwg.org/#es-long-long
   */
  ['long long'] (V: unknown): number

  /**
   * @see https://webidl.spec.whatwg.org/#es-unsigned-long-long
   */
  ['unsigned long long'] (V: unknown): number

  /**
   * @see https://webidl.spec.whatwg.org/#es-unsigned-long
   */
  ['unsigned long'] (V: unknown): number

  /**
   * @see https://webidl.spec.whatwg.org/#es-unsigned-short
   */
  ['unsigned short'] (V: unknown, opts?: ConvertToIntOpts): number

  /**
   * @see https://webidl.spec.whatwg.org/#idl-ArrayBuffer
   */
  ArrayBuffer (V: unknown): ArrayBufferLike
  ArrayBuffer (V: unknown, opts: { allowShared: false }): ArrayBuffer

  /**
   * @see https://webidl.spec.whatwg.org/#es-buffer-source-types
   */
  TypedArray (
    V: unknown,
    TypedArray: NodeJS.TypedArray | ArrayBufferLike
  ): NodeJS.TypedArray | ArrayBufferLike
  TypedArray (
    V: unknown,
    TypedArray: NodeJS.TypedArray | ArrayBufferLike,
    opts?: { allowShared: false }
  ): NodeJS.TypedArray | ArrayBuffer

  /**
   * @see https://webidl.spec.whatwg.org/#es-buffer-source-types
   */
  DataView (V: unknown, opts?: { allowShared: boolean }): DataView

  /**
   * @see https://webidl.spec.whatwg.org/#BufferSource
   */
  BufferSource (
    V: unknown,
    opts?: { allowShared: boolean }
  ): NodeJS.TypedArray | ArrayBufferLike | DataView

  ['sequence<ByteString>']: SequenceConverter<string>
  
  ['sequence<sequence<ByteString>>']: SequenceConverter<string[]>

  ['record<ByteString, ByteString>']: RecordConverter<string, string>

  [Key: string]: (...args: any[]) => unknown
}

export interface Webidl {
  errors: WebidlErrors
  util: WebidlUtil
  converters: WebidlConverters

  /**
   * @description Performs a brand-check on {@param V} to ensure it is a
   * {@param cls} object.
   */
  brandCheck <Interface>(V: unknown, cls: Interface, opts?: { strict?: boolean }): asserts V is Interface

  /**
   * @see https://webidl.spec.whatwg.org/#es-sequence
   * @description Convert a value, V, to a WebIDL sequence type.
   */
  sequenceConverter <Type>(C: Converter<Type>): SequenceConverter<Type>

  illegalConstructor (): never

  /**
   * @see https://webidl.spec.whatwg.org/#es-to-record
   * @description Convert a value, V, to a WebIDL record type.
   */
  recordConverter <K extends string, V>(
    keyConverter: Converter<K>,
    valueConverter: Converter<V>
  ): RecordConverter<K, V>

  /**
   * Similar to {@link Webidl.brandCheck} but allows skipping the check if third party
   * interfaces are allowed.
   */
  interfaceConverter <Interface>(cls: Interface): (
    V: unknown,
    opts?: { strict: boolean }
  ) => asserts V is typeof cls

  // TODO(@KhafraDev): a type could likely be implemented that can infer the return type
  // from the converters given?
  /**
   * Converts a value, V, to a WebIDL dictionary types. Allows limiting which keys are
   * allowed, values allowed, optional and required keys. Auto converts the value to
   * a type given a converter.
   */
  dictionaryConverter (converters: {
    key: string,
    defaultValue?: () => unknown,
    required?: boolean,
    converter: (...args: unknown[]) => unknown,
    allowedValues?: unknown[]
  }[]): (V: unknown) => Record<string, unknown>

  /**
   * @see https://webidl.spec.whatwg.org/#idl-nullable-type
   * @description allows a type, V, to be null
   */
  nullableConverter <T>(
    converter: Converter<T>
  ): (V: unknown) => ReturnType<typeof converter> | null

  argumentLengthCheck (args: { length: number }, min: number, context: string): void
}
