import { ErrorConstructorTag } from '../constants';
type ErrorValue = Error | AggregateError | EvalError | RangeError | ReferenceError | TypeError | SyntaxError | URIError;
export declare function getErrorConstructor(error: ErrorValue): ErrorConstructorTag;
export declare function getErrorOptions(error: Error, features: number): Record<string, unknown> | undefined;
export {};
//# sourceMappingURL=error.d.ts.map