import { type MainModule } from '../lib/tree-sitter';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ParseState, type Parser } from './parser';

/**
 * A position in a multi-line text document, in terms of rows and columns.
 *
 * Rows and columns are zero-based.
 */
export interface Point {
  /** The zero-based row number. */
  row: number;

  /** The zero-based column number. */
  column: number;
}

/**
 *  A range of positions in a multi-line text document, both in terms of bytes
 *  and of rows and columns.
 */
export interface Range {
  /** The start position of the range. */
  startPosition: Point;

  /** The end position of the range. */
  endPosition: Point;

  /** The start index of the range. */
  startIndex: number;

  /** The end index of the range. */
  endIndex: number;
}

/**
 * A summary of a change to a text document.
 */
export interface Edit {
  /** The start position of the change. */
  startPosition: Point;

  /** The end position of the change before the edit. */
  oldEndPosition: Point;

  /** The end position of the change after the edit. */
  newEndPosition: Point;

  /** The start index of the change. */
  startIndex: number;

  /** The end index of the change before the edit. */
  oldEndIndex: number;

  /** The end index of the change after the edit. */
  newEndIndex: number;
}

/** @internal */
export const SIZE_OF_SHORT = 2;

/** @internal */
export const SIZE_OF_INT = 4;

/** @internal */
export const SIZE_OF_CURSOR = 4 * SIZE_OF_INT;

/** @internal */
export const SIZE_OF_NODE = 5 * SIZE_OF_INT;

/** @internal */
export const SIZE_OF_POINT = 2 * SIZE_OF_INT;

/** @internal */
export const SIZE_OF_RANGE = 2 * SIZE_OF_INT + 2 * SIZE_OF_POINT;

/** @internal */
export const ZERO_POINT: Point = { row: 0, column: 0 };

/**
 * A callback for parsing that takes an index and point, and should return a string.
 */
export type ParseCallback = (index: number, position: Point) => string | undefined;

/**
  * A callback that receives the parse state during parsing.
  */
export type ProgressCallback = (progress: ParseState) => boolean;

/**
 * A callback for logging messages.
 *
 * If `isLex` is `true`, the message is from the lexer, otherwise it's from the parser.
 */
export type LogCallback = (message: string, isLex: boolean) => void;

// Helper type for internal use
/** @internal */
export const INTERNAL = Symbol('INTERNAL');
/** @internal */
export type Internal = typeof INTERNAL;

// Helper functions for type checking
/** @internal */
export function assertInternal(x: unknown): asserts x is Internal {
  if (x !== INTERNAL) throw new Error('Illegal constructor');
}

/** @internal */
export function isPoint(point?: Point): point is Point {
  return (
    !!point &&
    typeof (point).row === 'number' &&
    typeof (point).column === 'number'
  );
}

/**
 * @internal
 *
 * Sets the Tree-sitter WASM module. This should only be called by the {@link Parser} class via {@link Parser.init}.
 */
export function setModule(module: MainModule) {
  C = module;
}

/**
 * @internal
 *
 * `C` is a convenient shorthand for the Tree-sitter WASM module,
 * which allows us to call all of the exported functions.
 */
export let C: MainModule;
