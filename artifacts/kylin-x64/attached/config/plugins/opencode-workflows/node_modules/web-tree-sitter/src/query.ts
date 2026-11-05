import { Point, ZERO_POINT, SIZE_OF_INT, C } from './constants';
import { Node } from './node';
import { marshalNode, unmarshalCaptures } from './marshal';
import { TRANSFER_BUFFER } from './parser';
import { Language } from './language';

const PREDICATE_STEP_TYPE_CAPTURE = 1;

const PREDICATE_STEP_TYPE_STRING = 2;

const QUERY_WORD_REGEX = /[\w-]+/g;

/**
 * Options for query execution
 */
export interface QueryOptions {
  /** The start position of the range to query */
  startPosition?: Point;

  /** The end position of the range to query */
  endPosition?: Point;

  /** The start index of the range to query */
  startIndex?: number;

  /** The end index of the range to query */
  endIndex?: number;

  /**
   * The maximum number of in-progress matches for this query.
   * The limit must be > 0 and <= 65536.
   */
  matchLimit?: number;

  /**
   * The maximum start depth for a query cursor.
   *
   * This prevents cursors from exploring children nodes at a certain depth.
   * Note if a pattern includes many children, then they will still be
   * checked.
   *
   * The zero max start depth value can be used as a special behavior and
   * it helps to destructure a subtree by staying on a node and using
   * captures for interested parts. Note that the zero max start depth
   * only limit a search depth for a pattern's root node but other nodes
   * that are parts of the pattern may be searched at any depth what
   * defined by the pattern structure.
   *
   * Set to `null` to remove the maximum start depth.
   */
  maxStartDepth?: number;

  /**
   * The maximum duration in microseconds that query execution should be allowed to
   * take before halting.
   *
   * If query execution takes longer than this, it will halt early, returning an empty array.
   */
  timeoutMicros?: number;

  /**
   * A function that will be called periodically during the execution of the query to check
   * if query execution should be cancelled. You can also use this to instrument query execution
   * and check where the query is at in the document. The progress callback takes a single argument,
   * which is a {@link QueryState} representing the current state of the query.
   */
  progressCallback?: (state: QueryState) => void;
}

/**
 * A stateful object that is passed into the progress callback {@link QueryOptions#progressCallback}
 * to provide the current state of the query.
 */
export interface QueryState {
  /** The byte offset in the document that the query is at. */
  currentOffset: number;
}

/** A record of key-value pairs associated with a particular pattern in a {@link Query}. */
export type QueryProperties = Record<string, string | null>;

/**
 * A predicate that contains an operator and list of operands.
 */
export interface QueryPredicate {
  /** The operator of the predicate, like `match?`, `eq?`, `set!`, etc. */
  operator: string;

  /** The operands of the predicate, which are either captures or strings. */
  operands: PredicateStep[];
}

/**
 * A particular {@link Node} that has been captured with a particular name within a
 * {@link Query}.
 */
export interface QueryCapture {
  /** The index of the pattern that matched. */
  patternIndex: number;

  /** The name of the capture */
  name: string;

  /** The captured node */
  node: Node;

  /** The properties for predicates declared with the operator `set!`. */
  setProperties?: QueryProperties;

  /** The properties for predicates declared with the operator `is?`. */
  assertedProperties?: QueryProperties;

  /** The properties for predicates declared with the operator `is-not?`. */
  refutedProperties?: QueryProperties;
}

/** A match of a {@link Query} to a particular set of {@link Node}s. */
export interface QueryMatch {
  /** @deprecated since version 0.25.0, use `patternIndex` instead. */
  pattern: number;

  /** The index of the pattern that matched. */
  patternIndex: number;

  /** The captures associated with the match. */
  captures: QueryCapture[];

  /** The properties for predicates declared with the operator `set!`. */
  setProperties?: QueryProperties;

  /** The properties for predicates declared with the operator `is?`. */
  assertedProperties?: QueryProperties;

  /** The properties for predicates declared with the operator `is-not?`. */
  refutedProperties?: QueryProperties;
}

/** A quantifier for captures */
export const CaptureQuantifier = {
  Zero: 0,
  ZeroOrOne: 1,
  ZeroOrMore: 2,
  One: 3,
  OneOrMore: 4
} as const;

/** A quantifier for captures */
export type CaptureQuantifier = typeof CaptureQuantifier[keyof typeof CaptureQuantifier];

/**
 * Predicates are represented as a single array of steps. There are two
 * types of steps, which correspond to the two legal values for
 * the `type` field:
 *
 * - `CapturePredicateStep` - Steps with this type represent names
 *    of captures.
 *
 * - `StringPredicateStep` - Steps with this type represent literal
 *    strings.
 */
export type PredicateStep = CapturePredicateStep | StringPredicateStep;

/**
 * A step in a predicate that refers to a capture.
 *
 * The `name` field is the name of the capture.
 */
export interface CapturePredicateStep { type: 'capture', name: string }

/**
 * A step in a predicate that refers to a string.
 *
 * The `value` field is the string value.
 */
export interface StringPredicateStep { type: 'string', value: string }

const isCaptureStep = (step: PredicateStep): step is Extract<PredicateStep, { type: 'capture' }> =>
  step.type === 'capture';

const isStringStep = (step: PredicateStep): step is Extract<PredicateStep, { type: 'string' }> =>
  step.type === 'string';

/**
 * @internal
 *
 * A function that checks if a given set of captures matches a particular
 * condition. This is used in the built-in `eq?`, `match?`, and `any-of?`
 * predicates.
 */
export type TextPredicate = (captures: QueryCapture[]) => boolean;

/** Error codes returned from tree-sitter query parsing */
export const QueryErrorKind = {
  Syntax: 1,
  NodeName: 2,
  FieldName: 3,
  CaptureName: 4,
  PatternStructure: 5,
} as const;

/** An error that occurred while parsing a query string. */
export type QueryErrorKind = typeof QueryErrorKind[keyof typeof QueryErrorKind];

/** Information about a {@link QueryError}. */
export interface QueryErrorInfo {
  [QueryErrorKind.NodeName]: { word: string };
  [QueryErrorKind.FieldName]: { word: string };
  [QueryErrorKind.CaptureName]: { word: string };
  [QueryErrorKind.PatternStructure]: { suffix: string };
  [QueryErrorKind.Syntax]: { suffix: string };
}

/** Error thrown when parsing a tree-sitter query fails */
export class QueryError extends Error {
  constructor(
    public kind: QueryErrorKind,
    public info: QueryErrorInfo[typeof kind],
    public index: number,
    public length: number
  ) {
    super(QueryError.formatMessage(kind, info));
    this.name = 'QueryError';
  }

  /** Formats an error message based on the error kind and info */
  private static formatMessage(kind: QueryErrorKind, info: QueryErrorInfo[QueryErrorKind]): string {
    switch (kind) {
      case QueryErrorKind.NodeName:
        return `Bad node name '${(info as QueryErrorInfo[2]).word}'`;
      case QueryErrorKind.FieldName:
        return `Bad field name '${(info as QueryErrorInfo[3]).word}'`;
      case QueryErrorKind.CaptureName:
        return `Bad capture name @${(info as QueryErrorInfo[4]).word}`;
      case QueryErrorKind.PatternStructure:
        return `Bad pattern structure at offset ${(info as QueryErrorInfo[5]).suffix}`;
      case QueryErrorKind.Syntax:
        return `Bad syntax at offset ${(info as QueryErrorInfo[1]).suffix}`;
    }
  }
}

/**
 * Parses the `eq?` and `not-eq?` predicates in a query, and updates the text predicates.
 */
function parseAnyPredicate(
  steps: PredicateStep[],
  index: number,
  operator: string,
  textPredicates: TextPredicate[][],
) {
  if (steps.length !== 3) {
    throw new Error(
      `Wrong number of arguments to \`#${operator}\` predicate. Expected 2, got ${steps.length - 1}`
    );
  }

  if (!isCaptureStep(steps[1])) {
    throw new Error(
      `First argument of \`#${operator}\` predicate must be a capture. Got "${steps[1].value}"`
    );
  }

  const isPositive = operator === 'eq?' || operator === 'any-eq?';
  const matchAll = !operator.startsWith('any-');

  if (isCaptureStep(steps[2])) {
    const captureName1 = steps[1].name;
    const captureName2 = steps[2].name;
    textPredicates[index].push((captures) => {
      const nodes1: Node[] = [];
      const nodes2: Node[] = [];
      for (const c of captures) {
        if (c.name === captureName1) nodes1.push(c.node);
        if (c.name === captureName2) nodes2.push(c.node);
      }
      const compare = (n1: { text: string }, n2: { text: string }, positive: boolean) => {
        return positive ? n1.text === n2.text : n1.text !== n2.text;
      };
      return matchAll
        ? nodes1.every((n1) => nodes2.some((n2) => compare(n1, n2, isPositive)))
        : nodes1.some((n1) => nodes2.some((n2) => compare(n1, n2, isPositive)));
    });
  } else {
    const captureName = steps[1].name;
    const stringValue = steps[2].value;
    const matches = (n: Node) => n.text === stringValue;
    const doesNotMatch = (n: Node) => n.text !== stringValue;
    textPredicates[index].push((captures) => {
      const nodes = [];
      for (const c of captures) {
        if (c.name === captureName) nodes.push(c.node);
      }
      const test = isPositive ? matches : doesNotMatch;
      return matchAll ? nodes.every(test) : nodes.some(test);
    });
  }
}

/**
 * Parses the `match?` and `not-match?` predicates in a query, and updates the text predicates.
 */
function parseMatchPredicate(
  steps: PredicateStep[],
  index: number,
  operator: string,
  textPredicates: TextPredicate[][],
) {
  if (steps.length !== 3) {
    throw new Error(
      `Wrong number of arguments to \`#${operator}\` predicate. Expected 2, got ${steps.length - 1}.`,
    );
  }

  if (steps[1].type !== 'capture') {
    throw new Error(
      `First argument of \`#${operator}\` predicate must be a capture. Got "${steps[1].value}".`,
    );
  }

  if (steps[2].type !== 'string') {
    throw new Error(
      `Second argument of \`#${operator}\` predicate must be a string. Got @${steps[2].name}.`,
    );
  }

  const isPositive = operator === 'match?' || operator === 'any-match?';
  const matchAll = !operator.startsWith('any-');
  const captureName = steps[1].name;
  const regex = new RegExp(steps[2].value);
  textPredicates[index].push((captures) => {
    const nodes = [];
    for (const c of captures) {
      if (c.name === captureName) nodes.push(c.node.text);
    }
    const test = (text: string, positive: boolean) => {
      return positive ?
        regex.test(text) :
        !regex.test(text);
    };
    if (nodes.length === 0) return !isPositive;
    return matchAll ?
      nodes.every((text) => test(text, isPositive)) :
      nodes.some((text) => test(text, isPositive));
  });
}

/**
 * Parses the `any-of?` and `not-any-of?` predicates in a query, and updates the text predicates.
 */
function parseAnyOfPredicate(
  steps: PredicateStep[],
  index: number,
  operator: string,
  textPredicates: TextPredicate[][],
) {
  if (steps.length < 2) {
    throw new Error(
      `Wrong number of arguments to \`#${operator}\` predicate. Expected at least 1. Got ${steps.length - 1}.`,
    );
  }

  if (steps[1].type !== 'capture') {
    throw new Error(
      `First argument of \`#${operator}\` predicate must be a capture. Got "${steps[1].value}".`,
    );
  }

  const isPositive = operator === 'any-of?';
  const captureName = steps[1].name;

  const stringSteps = steps.slice(2);
  if (!stringSteps.every(isStringStep)) {
    throw new Error(
      `Arguments to \`#${operator}\` predicate must be strings.".`,
    );
  }
  const values = stringSteps.map((s) => s.value);

  textPredicates[index].push((captures) => {
    const nodes = [];
    for (const c of captures) {
      if (c.name === captureName) nodes.push(c.node.text);
    }
    if (nodes.length === 0) return !isPositive;
    return nodes.every((text) => values.includes(text)) === isPositive;
  });
}

/**
 * Parses the `is?` and `is-not?` predicates in a query, and updates the asserted or refuted properties,
 * depending on if the operator is positive or negative.
 */
function parseIsPredicate(
  steps: PredicateStep[],
  index: number,
  operator: string,
  assertedProperties: QueryProperties[],
  refutedProperties: QueryProperties[],
) {
  if (steps.length < 2 || steps.length > 3) {
    throw new Error(
      `Wrong number of arguments to \`#${operator}\` predicate. Expected 1 or 2. Got ${steps.length - 1}.`,
    );
  }

  if (!steps.every(isStringStep)) {
    throw new Error(
      `Arguments to \`#${operator}\` predicate must be strings.".`,
    );
  }

  const properties = operator === 'is?' ? assertedProperties : refutedProperties;
  if (!properties[index]) properties[index] = {};
  properties[index][steps[1].value] = steps[2]?.value ?? null;
}

/**
 * Parses the `set!` directive in a query, and updates the set properties.
 */
function parseSetDirective(
  steps: PredicateStep[],
  index: number,
  setProperties: QueryProperties[],
) {
  if (steps.length < 2 || steps.length > 3) {
    throw new Error(`Wrong number of arguments to \`#set!\` predicate. Expected 1 or 2. Got ${steps.length - 1}.`);
  }
  if (!steps.every(isStringStep)) {
    throw new Error(`Arguments to \`#set!\` predicate must be strings.".`);
  }
  if (!setProperties[index]) setProperties[index] = {};
  setProperties[index][steps[1].value] = steps[2]?.value ?? null;
}

/**
 * Parses the predicate at a given step in a pattern, and updates the appropriate
 * predicates or properties.
 */
function parsePattern(
  index: number,
  stepType: number,
  stepValueId: number,
  captureNames: string[],
  stringValues: string[],
  steps: PredicateStep[],
  textPredicates: TextPredicate[][],
  predicates: QueryPredicate[][],
  setProperties: QueryProperties[],
  assertedProperties: QueryProperties[],
  refutedProperties: QueryProperties[],
) {
  if (stepType === PREDICATE_STEP_TYPE_CAPTURE) {
    const name = captureNames[stepValueId];
    steps.push({ type: 'capture', name });
  } else if (stepType === PREDICATE_STEP_TYPE_STRING) {
    steps.push({ type: 'string', value: stringValues[stepValueId] });
  } else if (steps.length > 0) {
    if (steps[0].type !== 'string') {
      throw new Error('Predicates must begin with a literal value');
    }

    const operator = steps[0].value;
    switch (operator) {
      case 'any-not-eq?':
      case 'not-eq?':
      case 'any-eq?':
      case 'eq?':
        parseAnyPredicate(steps, index, operator, textPredicates);
        break;

      case 'any-not-match?':
      case 'not-match?':
      case 'any-match?':
      case 'match?':
        parseMatchPredicate(steps, index, operator, textPredicates);
        break;

      case 'not-any-of?':
      case 'any-of?':
        parseAnyOfPredicate(steps, index, operator, textPredicates);
        break;

      case 'is?':
      case 'is-not?':
        parseIsPredicate(steps, index, operator, assertedProperties, refutedProperties);
        break;

      case 'set!':
        parseSetDirective(steps, index, setProperties);
        break;

      default:
        predicates[index].push({ operator, operands: steps.slice(1) });
    }

    steps.length = 0;
  }
}

export class Query {
  /** @internal */
  private [0] = 0; // Internal handle for WASM

  /** @internal */
  private exceededMatchLimit: boolean;

  /** @internal */
  private textPredicates: TextPredicate[][];

  /** The names of the captures used in the query. */
  readonly captureNames: string[];

  /** The quantifiers of the captures used in the query. */
  readonly captureQuantifiers: CaptureQuantifier[][];

  /**
   * The other user-defined predicates associated with the given index.
   *
   * This includes predicates with operators other than:
   * - `match?`
   * - `eq?` and `not-eq?`
   * - `any-of?` and `not-any-of?`
   * - `is?` and `is-not?`
   * - `set!`
   */
  readonly predicates: QueryPredicate[][];

  /** The properties for predicates with the operator `set!`. */
  readonly setProperties: QueryProperties[];

  /** The properties for predicates with the operator `is?`. */
  readonly assertedProperties: QueryProperties[];

  /** The properties for predicates with the operator `is-not?`. */
  readonly refutedProperties: QueryProperties[];

  /** The maximum number of in-progress matches for this cursor. */
  matchLimit?: number;

  /**
   * Create a new query from a string containing one or more S-expression
   * patterns.
   *
   * The query is associated with a particular language, and can only be run
   * on syntax nodes parsed with that language. References to Queries can be
   * shared between multiple threads.
   *
   * @link {@see https://tree-sitter.github.io/tree-sitter/using-parsers/queries}
   */
  constructor(language: Language, source: string) {
    const sourceLength = C.lengthBytesUTF8(source);
    const sourceAddress = C._malloc(sourceLength + 1);
    C.stringToUTF8(source, sourceAddress, sourceLength + 1);
    const address = C._ts_query_new(
      language[0],
      sourceAddress,
      sourceLength,
      TRANSFER_BUFFER,
      TRANSFER_BUFFER + SIZE_OF_INT
    );

    if (!address) {
      const errorId = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, 'i32') as QueryErrorKind;
      const errorByte = C.getValue(TRANSFER_BUFFER, 'i32');
      const errorIndex = C.UTF8ToString(sourceAddress, errorByte).length;
      const suffix = source.slice(errorIndex, errorIndex + 100).split('\n')[0];
      const word = suffix.match(QUERY_WORD_REGEX)?.[0] ?? '';
      C._free(sourceAddress);

      switch (errorId) {
        case QueryErrorKind.Syntax:
          throw new QueryError(QueryErrorKind.Syntax, { suffix: `${errorIndex}: '${suffix}'...` }, errorIndex, 0);
        case QueryErrorKind.NodeName:
          throw new QueryError(errorId, { word }, errorIndex, word.length);
        case QueryErrorKind.FieldName:
          throw new QueryError(errorId, { word }, errorIndex, word.length);
        case QueryErrorKind.CaptureName:
          throw new QueryError(errorId, { word }, errorIndex, word.length);
        case QueryErrorKind.PatternStructure:
          throw new QueryError(errorId, { suffix: `${errorIndex}: '${suffix}'...` }, errorIndex, 0);
      }
    }

    const stringCount = C._ts_query_string_count(address);
    const captureCount = C._ts_query_capture_count(address);
    const patternCount = C._ts_query_pattern_count(address);
    const captureNames = new Array<string>(captureCount);
    const captureQuantifiers = new Array<CaptureQuantifier[]>(patternCount);
    const stringValues = new Array<string>(stringCount);

    // Fill in the capture names
    for (let i = 0; i < captureCount; i++) {
      const nameAddress = C._ts_query_capture_name_for_id(
        address,
        i,
        TRANSFER_BUFFER
      );
      const nameLength = C.getValue(TRANSFER_BUFFER, 'i32');
      captureNames[i] = C.UTF8ToString(nameAddress, nameLength);
    }

    // Fill in the capture quantifiers
    for (let i = 0; i < patternCount; i++) {
      const captureQuantifiersArray = new Array<CaptureQuantifier>(captureCount);
      for (let j = 0; j < captureCount; j++) {
        const quantifier = C._ts_query_capture_quantifier_for_id(address, i, j);
        captureQuantifiersArray[j] = quantifier as CaptureQuantifier;
      }
      captureQuantifiers[i] = captureQuantifiersArray;
    }

    // Fill in the string values
    for (let i = 0; i < stringCount; i++) {
      const valueAddress = C._ts_query_string_value_for_id(
        address,
        i,
        TRANSFER_BUFFER
      );
      const nameLength = C.getValue(TRANSFER_BUFFER, 'i32');
      stringValues[i] = C.UTF8ToString(valueAddress, nameLength);
    }

    const setProperties = new Array<QueryProperties>(patternCount);
    const assertedProperties = new Array<QueryProperties>(patternCount);
    const refutedProperties = new Array<QueryProperties>(patternCount);
    const predicates = new Array<QueryPredicate[]>(patternCount);
    const textPredicates = new Array<TextPredicate[]>(patternCount);

    // Parse the predicates, and add the appropriate predicates or properties
    for (let i = 0; i < patternCount; i++) {
      const predicatesAddress = C._ts_query_predicates_for_pattern(address, i, TRANSFER_BUFFER);
      const stepCount = C.getValue(TRANSFER_BUFFER, 'i32');

      predicates[i] = [];
      textPredicates[i] = [];

      const steps = new Array<PredicateStep>();

      let stepAddress = predicatesAddress;
      for (let j = 0; j < stepCount; j++) {
        const stepType = C.getValue(stepAddress, 'i32');
        stepAddress += SIZE_OF_INT;

        const stepValueId = C.getValue(stepAddress, 'i32');
        stepAddress += SIZE_OF_INT;

        parsePattern(
          i,
          stepType,
          stepValueId,
          captureNames,
          stringValues,
          steps,
          textPredicates,
          predicates,
          setProperties,
          assertedProperties,
          refutedProperties,
        );
      }

      Object.freeze(textPredicates[i]);
      Object.freeze(predicates[i]);
      Object.freeze(setProperties[i]);
      Object.freeze(assertedProperties[i]);
      Object.freeze(refutedProperties[i]);
    }

    C._free(sourceAddress);


    this[0] = address;
    this.captureNames = captureNames;
    this.captureQuantifiers = captureQuantifiers;
    this.textPredicates = textPredicates;
    this.predicates = predicates;
    this.setProperties = setProperties;
    this.assertedProperties = assertedProperties;
    this.refutedProperties = refutedProperties;
    this.exceededMatchLimit = false;
  }

  /** Delete the query, freeing its resources. */
  delete(): void {
    C._ts_query_delete(this[0]);
    this[0] = 0;
  }

  /**
   * Iterate over all of the matches in the order that they were found.
   *
   * Each match contains the index of the pattern that matched, and a list of
   * captures. Because multiple patterns can match the same set of nodes,
   * one match may contain captures that appear *before* some of the
   * captures from a previous match.
   *
   * @param {Node} node - The node to execute the query on.
   *
   * @param {QueryOptions} options - Options for query execution.
   */
  matches(
    node: Node,
    options: QueryOptions = {}
  ): QueryMatch[] {
    const startPosition = options.startPosition ?? ZERO_POINT;
    const endPosition = options.endPosition ?? ZERO_POINT;
    const startIndex = options.startIndex ?? 0;
    const endIndex = options.endIndex ?? 0;
    const matchLimit = options.matchLimit ?? 0xFFFFFFFF;
    const maxStartDepth = options.maxStartDepth ?? 0xFFFFFFFF;
    const timeoutMicros = options.timeoutMicros ?? 0;
    const progressCallback = options.progressCallback;

    if (typeof matchLimit !== 'number') {
      throw new Error('Arguments must be numbers');
    }
    this.matchLimit = matchLimit;

    if (endIndex !== 0 && startIndex > endIndex) {
      throw new Error('`startIndex` cannot be greater than `endIndex`');
    }

    if (endPosition !== ZERO_POINT && (
      startPosition.row > endPosition.row ||
      (startPosition.row === endPosition.row && startPosition.column > endPosition.column)
    )) {
      throw new Error('`startPosition` cannot be greater than `endPosition`');
    }

    if (progressCallback) {
      C.currentQueryProgressCallback = progressCallback;
    }

    marshalNode(node);

    C._ts_query_matches_wasm(
      this[0],
      node.tree[0],
      startPosition.row,
      startPosition.column,
      endPosition.row,
      endPosition.column,
      startIndex,
      endIndex,
      matchLimit,
      maxStartDepth,
      timeoutMicros,
    );

    const rawCount = C.getValue(TRANSFER_BUFFER, 'i32');
    const startAddress = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, 'i32');
    const didExceedMatchLimit = C.getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, 'i32');
    const result = new Array<QueryMatch>(rawCount);
    this.exceededMatchLimit = Boolean(didExceedMatchLimit);

    let filteredCount = 0;
    let address = startAddress;
    for (let i = 0; i < rawCount; i++) {
      const patternIndex = C.getValue(address, 'i32');
      address += SIZE_OF_INT;
      const captureCount = C.getValue(address, 'i32');
      address += SIZE_OF_INT;

      const captures = new Array<QueryCapture>(captureCount);
      address = unmarshalCaptures(this, node.tree, address, patternIndex, captures);

      if (this.textPredicates[patternIndex].every((p) => p(captures))) {
        result[filteredCount] = { pattern: patternIndex, patternIndex, captures };
        const setProperties = this.setProperties[patternIndex];
        result[filteredCount].setProperties = setProperties;
        const assertedProperties = this.assertedProperties[patternIndex];
        result[filteredCount].assertedProperties = assertedProperties;
        const refutedProperties = this.refutedProperties[patternIndex];
        result[filteredCount].refutedProperties = refutedProperties;
        filteredCount++;
      }
    }
    result.length = filteredCount;

    C._free(startAddress);
    C.currentQueryProgressCallback = null;
    return result;
  }

  /**
   * Iterate over all of the individual captures in the order that they
   * appear.
   *
   * This is useful if you don't care about which pattern matched, and just
   * want a single, ordered sequence of captures.
   *
   * @param {Node} node - The node to execute the query on.
   *
   * @param {QueryOptions} options - Options for query execution.
   */
  captures(
    node: Node,
    options: QueryOptions = {}
  ): QueryCapture[] {
    const startPosition = options.startPosition ?? ZERO_POINT;
    const endPosition = options.endPosition ?? ZERO_POINT;
    const startIndex = options.startIndex ?? 0;
    const endIndex = options.endIndex ?? 0;
    const matchLimit = options.matchLimit ?? 0xFFFFFFFF;
    const maxStartDepth = options.maxStartDepth ?? 0xFFFFFFFF;
    const timeoutMicros = options.timeoutMicros ?? 0;
    const progressCallback = options.progressCallback;

    if (typeof matchLimit !== 'number') {
      throw new Error('Arguments must be numbers');
    }
    this.matchLimit = matchLimit;

    if (endIndex !== 0 && startIndex > endIndex) {
      throw new Error('`startIndex` cannot be greater than `endIndex`');
    }

    if (endPosition !== ZERO_POINT && (
      startPosition.row > endPosition.row ||
      (startPosition.row === endPosition.row && startPosition.column > endPosition.column)
    )) {
      throw new Error('`startPosition` cannot be greater than `endPosition`');
    }

    if (progressCallback) {
      C.currentQueryProgressCallback = progressCallback;
    }

    marshalNode(node);

    C._ts_query_captures_wasm(
      this[0],
      node.tree[0],
      startPosition.row,
      startPosition.column,
      endPosition.row,
      endPosition.column,
      startIndex,
      endIndex,
      matchLimit,
      maxStartDepth,
      timeoutMicros,
    );

    const count = C.getValue(TRANSFER_BUFFER, 'i32');
    const startAddress = C.getValue(TRANSFER_BUFFER + SIZE_OF_INT, 'i32');
    const didExceedMatchLimit = C.getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, 'i32');
    const result = new Array<QueryCapture>();
    this.exceededMatchLimit = Boolean(didExceedMatchLimit);

    const captures = new Array<QueryCapture>();
    let address = startAddress;
    for (let i = 0; i < count; i++) {
      const patternIndex = C.getValue(address, 'i32');
      address += SIZE_OF_INT;
      const captureCount = C.getValue(address, 'i32');
      address += SIZE_OF_INT;
      const captureIndex = C.getValue(address, 'i32');
      address += SIZE_OF_INT;

      captures.length = captureCount;
      address = unmarshalCaptures(this, node.tree, address, patternIndex, captures);

      if (this.textPredicates[patternIndex].every(p => p(captures))) {
        const capture = captures[captureIndex];
        const setProperties = this.setProperties[patternIndex];
        capture.setProperties = setProperties;
        const assertedProperties = this.assertedProperties[patternIndex];
        capture.assertedProperties = assertedProperties;
        const refutedProperties = this.refutedProperties[patternIndex];
        capture.refutedProperties = refutedProperties;
        result.push(capture);
      }
    }

    C._free(startAddress);
    C.currentQueryProgressCallback = null;
    return result;
  }

  /** Get the predicates for a given pattern. */
  predicatesForPattern(patternIndex: number): QueryPredicate[] {
    return this.predicates[patternIndex];
  }

  /**
   * Disable a certain capture within a query.
   *
   * This prevents the capture from being returned in matches, and also
   * avoids any resource usage associated with recording the capture.
   */
  disableCapture(captureName: string): void {
    const captureNameLength = C.lengthBytesUTF8(captureName);
    const captureNameAddress = C._malloc(captureNameLength + 1);
    C.stringToUTF8(captureName, captureNameAddress, captureNameLength + 1);
    C._ts_query_disable_capture(this[0], captureNameAddress, captureNameLength);
    C._free(captureNameAddress);
  }

  /**
   * Disable a certain pattern within a query.
   *
   * This prevents the pattern from matching, and also avoids any resource
   * usage associated with the pattern. This throws an error if the pattern
   * index is out of bounds.
   */
  disablePattern(patternIndex: number): void {
    if (patternIndex >= this.predicates.length) {
      throw new Error(
        `Pattern index is ${patternIndex} but the pattern count is ${this.predicates.length}`
      );
    }
    C._ts_query_disable_pattern(this[0], patternIndex);
  }

  /**
   * Check if, on its last execution, this cursor exceeded its maximum number
   * of in-progress matches.
   */
  didExceedMatchLimit(): boolean {
    return this.exceededMatchLimit;
  }

  /** Get the byte offset where the given pattern starts in the query's source. */
  startIndexForPattern(patternIndex: number): number {
    if (patternIndex >= this.predicates.length) {
      throw new Error(
        `Pattern index is ${patternIndex} but the pattern count is ${this.predicates.length}`
      );
    }
    return C._ts_query_start_byte_for_pattern(this[0], patternIndex);
  }

  /** Get the byte offset where the given pattern ends in the query's source. */
  endIndexForPattern(patternIndex: number): number {
    if (patternIndex >= this.predicates.length) {
      throw new Error(
        `Pattern index is ${patternIndex} but the pattern count is ${this.predicates.length}`
      );
    }
    return C._ts_query_end_byte_for_pattern(this[0], patternIndex);
  }

  /** Get the number of patterns in the query. */
  patternCount(): number {
    return C._ts_query_pattern_count(this[0]);
  }

  /** Get the index for a given capture name. */
  captureIndexForName(captureName: string): number {
    return this.captureNames.indexOf(captureName);
  }

  /** Check if a given pattern within a query has a single root node. */
  isPatternRooted(patternIndex: number): boolean {
    return C._ts_query_is_pattern_rooted(this[0], patternIndex) === 1;
  }

  /** Check if a given pattern within a query has a single root node. */
  isPatternNonLocal(patternIndex: number): boolean {
    return C._ts_query_is_pattern_non_local(this[0], patternIndex) === 1;
  }

  /**
   * Check if a given step in a query is 'definite'.
   *
   * A query step is 'definite' if its parent pattern will be guaranteed to
   * match successfully once it reaches the step.
   */
  isPatternGuaranteedAtStep(byteIndex: number): boolean {
    return C._ts_query_is_pattern_guaranteed_at_step(this[0], byteIndex) === 1;
  }
}
