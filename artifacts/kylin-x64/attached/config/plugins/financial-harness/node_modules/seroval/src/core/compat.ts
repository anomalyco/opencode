/**
 * References
 * - https://compat-table.github.io/compat-table/es6/
 * - MDN
 */

export enum Feature {
  AggregateError = 0x01,
  // @deprecated
  ArrowFunction = 0x02,
  ErrorPrototypeStack = 0x04,
  ObjectAssign = 0x08,
  BigIntTypedArray = 0x10,
  RegExp = 0x20,
}

export const ALL_ENABLED =
  Feature.AggregateError |
  Feature.ArrowFunction |
  Feature.ErrorPrototypeStack |
  Feature.ObjectAssign |
  Feature.BigIntTypedArray |
  Feature.RegExp;
