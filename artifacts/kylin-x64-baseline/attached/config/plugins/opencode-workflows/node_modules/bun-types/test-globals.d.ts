// Do not include this file in ./index.d.ts
//
// This file gets loaded by developers including the following triple slash directive:
//
// ```ts
// /// <reference types="bun-types/test-globals" />
// ```

declare var test: typeof import("bun:test").test;
declare var it: typeof import("bun:test").it;
declare var describe: typeof import("bun:test").describe;
declare var expect: typeof import("bun:test").expect;
declare var expectTypeOf: typeof import("bun:test").expectTypeOf;
declare var beforeAll: typeof import("bun:test").beforeAll;
declare var beforeEach: typeof import("bun:test").beforeEach;
declare var afterEach: typeof import("bun:test").afterEach;
declare var afterAll: typeof import("bun:test").afterAll;
declare var jest: typeof import("bun:test").jest;
declare var vi: typeof import("bun:test").vi;
declare var xit: typeof import("bun:test").xit;
declare var xtest: typeof import("bun:test").xtest;
declare var xdescribe: typeof import("bun:test").xdescribe;
