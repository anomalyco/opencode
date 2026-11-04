// Polyfills for the explicit resource management types added in TypeScript 5.2.
// TODO: remove once this package no longer supports TS 5.1, and replace with a
// <reference> to TypeScript's disposable library in index.d.ts.

interface SymbolConstructor {
    readonly dispose: unique symbol;
    readonly asyncDispose: unique symbol;
}

interface Disposable {
    [Symbol.dispose](): void;
}

interface AsyncDisposable {
    [Symbol.asyncDispose](): PromiseLike<void>;
}
