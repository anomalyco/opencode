/**
 * Redacts sensitive tokens from a string.
 * Used for error messages that may contain command-line arguments or environment info.
 */
export declare function redactSensitiveData(input: string): string;
/**
 * Redacts sensitive data from an Error object, returning a new Error.
 * Preserves the stack trace but redacts the message.
 */
export declare function redactErrorSensitiveData(error: Error): Error;
