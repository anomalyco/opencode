import { Feature } from '../compat';
import { ERROR_CONSTRUCTOR_STRING, ErrorConstructorTag } from '../constants';

type ErrorValue =
  | Error
  | AggregateError
  | EvalError
  | RangeError
  | ReferenceError
  | TypeError
  | SyntaxError
  | URIError;

export function getErrorConstructor(error: ErrorValue): ErrorConstructorTag {
  if (error instanceof EvalError) {
    return ErrorConstructorTag.EvalError;
  }
  if (error instanceof RangeError) {
    return ErrorConstructorTag.RangeError;
  }
  if (error instanceof ReferenceError) {
    return ErrorConstructorTag.ReferenceError;
  }
  if (error instanceof SyntaxError) {
    return ErrorConstructorTag.SyntaxError;
  }
  if (error instanceof TypeError) {
    return ErrorConstructorTag.TypeError;
  }
  if (error instanceof URIError) {
    return ErrorConstructorTag.URIError;
  }
  return ErrorConstructorTag.Error;
}

function getInitialErrorOptions(
  error: Error,
): Record<string, unknown> | undefined {
  const construct = ERROR_CONSTRUCTOR_STRING[getErrorConstructor(error)];
  // Name has been modified
  if (error.name !== construct) {
    return { name: error.name };
  }
  if (error.constructor.name !== construct) {
    // Otherwise, name is overriden because
    // the Error class is extended
    return { name: error.constructor.name };
  }
  return {};
}

export function getErrorOptions(
  error: Error,
  features: number,
): Record<string, unknown> | undefined {
  let options = getInitialErrorOptions(error);
  const names = Object.getOwnPropertyNames(error);
  for (let i = 0, len = names.length, name: string; i < len; i++) {
    name = names[i];
    if (name !== 'name' && name !== 'message') {
      if (name === 'stack') {
        if (features & Feature.ErrorPrototypeStack) {
          options = options || {};
          options[name] = error[name as keyof Error];
        }
      } else {
        options = options || {};
        options[name] = error[name as keyof Error];
      }
    }
  }
  return options;
}
