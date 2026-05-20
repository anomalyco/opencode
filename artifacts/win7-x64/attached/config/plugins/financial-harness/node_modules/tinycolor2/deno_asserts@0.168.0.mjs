// deno-fmt-ignore-file
// deno-lint-ignore-file
// This code was bundled using `deno bundle` and it's not recommended to edit it manually
// Using `deno bundle https://deno.land/std@0.168.0/testing/asserts.ts > npm/deno_asserts@0.168.0.mjs`

const { Deno  } = globalThis;
const noColor = typeof Deno?.noColor === "boolean" ? Deno.noColor : true;
let enabled = !noColor;
function code(open, close) {
    return {
        open: `\x1b[${open.join(";")}m`,
        close: `\x1b[${close}m`,
        regexp: new RegExp(`\\x1b\\[${close}m`, "g")
    };
}
function run(str, code) {
    return enabled ? `${code.open}${str.replace(code.regexp, code.open)}${code.close}` : str;
}
function bold(str) {
    return run(str, code([
        1
    ], 22));
}
function red(str) {
    return run(str, code([
        31
    ], 39));
}
function green(str) {
    return run(str, code([
        32
    ], 39));
}
function white(str) {
    return run(str, code([
        37
    ], 39));
}
function gray(str) {
    return brightBlack(str);
}
function brightBlack(str) {
    return run(str, code([
        90
    ], 39));
}
function bgRed(str) {
    return run(str, code([
        41
    ], 49));
}
function bgGreen(str) {
    return run(str, code([
        42
    ], 49));
}
const ANSI_PATTERN = new RegExp([
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))"
].join("|"), "g");
function stripColor(string) {
    return string.replace(ANSI_PATTERN, "");
}
var DiffType;
(function(DiffType) {
    DiffType["removed"] = "removed";
    DiffType["common"] = "common";
    DiffType["added"] = "added";
})(DiffType || (DiffType = {}));
const REMOVED = 1;
const COMMON = 2;
const ADDED = 3;
function createCommon(A, B, reverse) {
    const common = [];
    if (A.length === 0 || B.length === 0) return [];
    for(let i = 0; i < Math.min(A.length, B.length); i += 1){
        if (A[reverse ? A.length - i - 1 : i] === B[reverse ? B.length - i - 1 : i]) {
            common.push(A[reverse ? A.length - i - 1 : i]);
        } else {
            return common;
        }
    }
    return common;
}
function diff(A, B) {
    const prefixCommon = createCommon(A, B);
    const suffixCommon = createCommon(A.slice(prefixCommon.length), B.slice(prefixCommon.length), true).reverse();
    A = suffixCommon.length ? A.slice(prefixCommon.length, -suffixCommon.length) : A.slice(prefixCommon.length);
    B = suffixCommon.length ? B.slice(prefixCommon.length, -suffixCommon.length) : B.slice(prefixCommon.length);
    const swapped = B.length > A.length;
    [A, B] = swapped ? [
        B,
        A
    ] : [
        A,
        B
    ];
    const M = A.length;
    const N = B.length;
    if (!M && !N && !suffixCommon.length && !prefixCommon.length) return [];
    if (!N) {
        return [
            ...prefixCommon.map((c)=>({
                    type: DiffType.common,
                    value: c
                })),
            ...A.map((a)=>({
                    type: swapped ? DiffType.added : DiffType.removed,
                    value: a
                })),
            ...suffixCommon.map((c)=>({
                    type: DiffType.common,
                    value: c
                }))
        ];
    }
    const offset = N;
    const delta = M - N;
    const size = M + N + 1;
    const fp = Array.from({
        length: size
    }, ()=>({
            y: -1,
            id: -1
        }));
    const routes = new Uint32Array((M * N + size + 1) * 2);
    const diffTypesPtrOffset = routes.length / 2;
    let ptr = 0;
    let p = -1;
    function backTrace(A, B, current, swapped) {
        const M = A.length;
        const N = B.length;
        const result = [];
        let a = M - 1;
        let b = N - 1;
        let j = routes[current.id];
        let type = routes[current.id + diffTypesPtrOffset];
        while(true){
            if (!j && !type) break;
            const prev = j;
            if (type === 1) {
                result.unshift({
                    type: swapped ? DiffType.removed : DiffType.added,
                    value: B[b]
                });
                b -= 1;
            } else if (type === 3) {
                result.unshift({
                    type: swapped ? DiffType.added : DiffType.removed,
                    value: A[a]
                });
                a -= 1;
            } else {
                result.unshift({
                    type: DiffType.common,
                    value: A[a]
                });
                a -= 1;
                b -= 1;
            }
            j = routes[prev];
            type = routes[prev + diffTypesPtrOffset];
        }
        return result;
    }
    function createFP(slide, down, k, M) {
        if (slide && slide.y === -1 && down && down.y === -1) {
            return {
                y: 0,
                id: 0
            };
        }
        if (down && down.y === -1 || k === M || (slide && slide.y) > (down && down.y) + 1) {
            const prev = slide.id;
            ptr++;
            routes[ptr] = prev;
            routes[ptr + diffTypesPtrOffset] = ADDED;
            return {
                y: slide.y,
                id: ptr
            };
        } else {
            const prev1 = down.id;
            ptr++;
            routes[ptr] = prev1;
            routes[ptr + diffTypesPtrOffset] = REMOVED;
            return {
                y: down.y + 1,
                id: ptr
            };
        }
    }
    function snake(k, slide, down, _offset, A, B) {
        const M = A.length;
        const N = B.length;
        if (k < -N || M < k) return {
            y: -1,
            id: -1
        };
        const fp = createFP(slide, down, k, M);
        while(fp.y + k < M && fp.y < N && A[fp.y + k] === B[fp.y]){
            const prev = fp.id;
            ptr++;
            fp.id = ptr;
            fp.y += 1;
            routes[ptr] = prev;
            routes[ptr + diffTypesPtrOffset] = COMMON;
        }
        return fp;
    }
    while(fp[delta + offset].y < N){
        p = p + 1;
        for(let k = -p; k < delta; ++k){
            fp[k + offset] = snake(k, fp[k - 1 + offset], fp[k + 1 + offset], offset, A, B);
        }
        for(let k1 = delta + p; k1 > delta; --k1){
            fp[k1 + offset] = snake(k1, fp[k1 - 1 + offset], fp[k1 + 1 + offset], offset, A, B);
        }
        fp[delta + offset] = snake(delta, fp[delta - 1 + offset], fp[delta + 1 + offset], offset, A, B);
    }
    return [
        ...prefixCommon.map((c)=>({
                type: DiffType.common,
                value: c
            })),
        ...backTrace(A, B, fp[delta + offset], swapped),
        ...suffixCommon.map((c)=>({
                type: DiffType.common,
                value: c
            }))
    ];
}
function diffstr(A, B) {
    function unescape(string) {
        return string.replaceAll("\b", "\\b").replaceAll("\f", "\\f").replaceAll("\t", "\\t").replaceAll("\v", "\\v").replaceAll(/\r\n|\r|\n/g, (str)=>str === "\r" ? "\\r" : str === "\n" ? "\\n\n" : "\\r\\n\r\n");
    }
    function tokenize(string, { wordDiff =false  } = {}) {
        if (wordDiff) {
            const tokens = string.split(/([^\S\r\n]+|[()[\]{}'"\r\n]|\b)/);
            const words = /^[a-zA-Z\u{C0}-\u{FF}\u{D8}-\u{F6}\u{F8}-\u{2C6}\u{2C8}-\u{2D7}\u{2DE}-\u{2FF}\u{1E00}-\u{1EFF}]+$/u;
            for(let i = 0; i < tokens.length - 1; i++){
                if (!tokens[i + 1] && tokens[i + 2] && words.test(tokens[i]) && words.test(tokens[i + 2])) {
                    tokens[i] += tokens[i + 2];
                    tokens.splice(i + 1, 2);
                    i--;
                }
            }
            return tokens.filter((token)=>token);
        } else {
            const tokens1 = [], lines = string.split(/(\n|\r\n)/);
            if (!lines[lines.length - 1]) {
                lines.pop();
            }
            for(let i1 = 0; i1 < lines.length; i1++){
                if (i1 % 2) {
                    tokens1[tokens1.length - 1] += lines[i1];
                } else {
                    tokens1.push(lines[i1]);
                }
            }
            return tokens1;
        }
    }
    function createDetails(line, tokens) {
        return tokens.filter(({ type  })=>type === line.type || type === DiffType.common).map((result, i, t)=>{
            if (result.type === DiffType.common && t[i - 1] && t[i - 1]?.type === t[i + 1]?.type && /\s+/.test(result.value)) {
                result.type = t[i - 1].type;
            }
            return result;
        });
    }
    const diffResult = diff(tokenize(`${unescape(A)}\n`), tokenize(`${unescape(B)}\n`));
    const added = [], removed = [];
    for (const result of diffResult){
        if (result.type === DiffType.added) {
            added.push(result);
        }
        if (result.type === DiffType.removed) {
            removed.push(result);
        }
    }
    const aLines = added.length < removed.length ? added : removed;
    const bLines = aLines === removed ? added : removed;
    for (const a of aLines){
        let tokens = [], b;
        while(bLines.length){
            b = bLines.shift();
            tokens = diff(tokenize(a.value, {
                wordDiff: true
            }), tokenize(b?.value ?? "", {
                wordDiff: true
            }));
            if (tokens.some(({ type , value  })=>type === DiffType.common && value.trim().length)) {
                break;
            }
        }
        a.details = createDetails(a, tokens);
        if (b) {
            b.details = createDetails(b, tokens);
        }
    }
    return diffResult;
}
function createColor(diffType, { background =false  } = {}) {
    background = false;
    switch(diffType){
        case DiffType.added:
            return (s)=>background ? bgGreen(white(s)) : green(bold(s));
        case DiffType.removed:
            return (s)=>background ? bgRed(white(s)) : red(bold(s));
        default:
            return white;
    }
}
function createSign(diffType) {
    switch(diffType){
        case DiffType.added:
            return "+   ";
        case DiffType.removed:
            return "-   ";
        default:
            return "    ";
    }
}
function buildMessage(diffResult, { stringDiff =false  } = {}) {
    const messages = [], diffMessages = [];
    messages.push("");
    messages.push("");
    messages.push(`    ${gray(bold("[Diff]"))} ${red(bold("Actual"))} / ${green(bold("Expected"))}`);
    messages.push("");
    messages.push("");
    diffResult.forEach((result)=>{
        const c = createColor(result.type);
        const line = result.details?.map((detail)=>detail.type !== DiffType.common ? createColor(detail.type, {
                background: true
            })(detail.value) : detail.value).join("") ?? result.value;
        diffMessages.push(c(`${createSign(result.type)}${line}`));
    });
    messages.push(...stringDiff ? [
        diffMessages.join("")
    ] : diffMessages);
    messages.push("");
    return messages;
}
function format(v) {
    const { Deno  } = globalThis;
    return typeof Deno?.inspect === "function" ? Deno.inspect(v, {
        depth: Infinity,
        sorted: true,
        trailingComma: true,
        compact: false,
        iterableLimit: Infinity,
        getters: true
    }) : `"${String(v).replace(/(?=["\\])/g, "\\")}"`;
}
const CAN_NOT_DISPLAY = "[Cannot display]";
class AssertionError extends Error {
    name = "AssertionError";
    constructor(message){
        super(message);
    }
}
function isKeyedCollection(x) {
    return [
        Symbol.iterator,
        "size"
    ].every((k)=>k in x);
}
function equal(c, d) {
    const seen = new Map();
    return function compare(a, b) {
        if (a && b && (a instanceof RegExp && b instanceof RegExp || a instanceof URL && b instanceof URL)) {
            return String(a) === String(b);
        }
        if (a instanceof Date && b instanceof Date) {
            const aTime = a.getTime();
            const bTime = b.getTime();
            if (Number.isNaN(aTime) && Number.isNaN(bTime)) {
                return true;
            }
            return aTime === bTime;
        }
        if (typeof a === "number" && typeof b === "number") {
            return Number.isNaN(a) && Number.isNaN(b) || a === b;
        }
        if (Object.is(a, b)) {
            return true;
        }
        if (a && typeof a === "object" && b && typeof b === "object") {
            if (a && b && !constructorsEqual(a, b)) {
                return false;
            }
            if (a instanceof WeakMap || b instanceof WeakMap) {
                if (!(a instanceof WeakMap && b instanceof WeakMap)) return false;
                throw new TypeError("cannot compare WeakMap instances");
            }
            if (a instanceof WeakSet || b instanceof WeakSet) {
                if (!(a instanceof WeakSet && b instanceof WeakSet)) return false;
                throw new TypeError("cannot compare WeakSet instances");
            }
            if (seen.get(a) === b) {
                return true;
            }
            if (Object.keys(a || {}).length !== Object.keys(b || {}).length) {
                return false;
            }
            seen.set(a, b);
            if (isKeyedCollection(a) && isKeyedCollection(b)) {
                if (a.size !== b.size) {
                    return false;
                }
                let unmatchedEntries = a.size;
                for (const [aKey, aValue] of a.entries()){
                    for (const [bKey, bValue] of b.entries()){
                        if (aKey === aValue && bKey === bValue && compare(aKey, bKey) || compare(aKey, bKey) && compare(aValue, bValue)) {
                            unmatchedEntries--;
                            break;
                        }
                    }
                }
                return unmatchedEntries === 0;
            }
            const merged = {
                ...a,
                ...b
            };
            for (const key of [
                ...Object.getOwnPropertyNames(merged),
                ...Object.getOwnPropertySymbols(merged)
            ]){
                if (!compare(a && a[key], b && b[key])) {
                    return false;
                }
                if (key in a && !(key in b) || key in b && !(key in a)) {
                    return false;
                }
            }
            if (a instanceof WeakRef || b instanceof WeakRef) {
                if (!(a instanceof WeakRef && b instanceof WeakRef)) return false;
                return compare(a.deref(), b.deref());
            }
            return true;
        }
        return false;
    }(c, d);
}
function constructorsEqual(a, b) {
    return a.constructor === b.constructor || a.constructor === Object && !b.constructor || !a.constructor && b.constructor === Object;
}
function assert(expr, msg = "") {
    if (!expr) {
        throw new AssertionError(msg);
    }
}
function assertFalse(expr, msg = "") {
    if (expr) {
        throw new AssertionError(msg);
    }
}
function assertEquals(actual, expected, msg) {
    if (equal(actual, expected)) {
        return;
    }
    let message = "";
    const actualString = format(actual);
    const expectedString = format(expected);
    try {
        const stringDiff = typeof actual === "string" && typeof expected === "string";
        const diffResult = stringDiff ? diffstr(actual, expected) : diff(actualString.split("\n"), expectedString.split("\n"));
        const diffMsg = buildMessage(diffResult, {
            stringDiff
        }).join("\n");
        message = `Values are not equal:\n${diffMsg}`;
    } catch  {
        message = `\n${red(CAN_NOT_DISPLAY)} + \n\n`;
    }
    if (msg) {
        message = msg;
    }
    throw new AssertionError(message);
}
function assertNotEquals(actual, expected, msg) {
    if (!equal(actual, expected)) {
        return;
    }
    let actualString;
    let expectedString;
    try {
        actualString = String(actual);
    } catch  {
        actualString = "[Cannot display]";
    }
    try {
        expectedString = String(expected);
    } catch  {
        expectedString = "[Cannot display]";
    }
    if (!msg) {
        msg = `actual: ${actualString} expected not to be: ${expectedString}`;
    }
    throw new AssertionError(msg);
}
function assertStrictEquals(actual, expected, msg) {
    if (Object.is(actual, expected)) {
        return;
    }
    let message;
    if (msg) {
        message = msg;
    } else {
        const actualString = format(actual);
        const expectedString = format(expected);
        if (actualString === expectedString) {
            const withOffset = actualString.split("\n").map((l)=>`    ${l}`).join("\n");
            message = `Values have the same structure but are not reference-equal:\n\n${red(withOffset)}\n`;
        } else {
            try {
                const stringDiff = typeof actual === "string" && typeof expected === "string";
                const diffResult = stringDiff ? diffstr(actual, expected) : diff(actualString.split("\n"), expectedString.split("\n"));
                const diffMsg = buildMessage(diffResult, {
                    stringDiff
                }).join("\n");
                message = `Values are not strictly equal:\n${diffMsg}`;
            } catch  {
                message = `\n${red(CAN_NOT_DISPLAY)} + \n\n`;
            }
        }
    }
    throw new AssertionError(message);
}
function assertNotStrictEquals(actual, expected, msg) {
    if (!Object.is(actual, expected)) {
        return;
    }
    throw new AssertionError(msg ?? `Expected "actual" to be strictly unequal to: ${format(actual)}\n`);
}
function assertAlmostEquals(actual, expected, tolerance = 1e-7, msg) {
    if (Object.is(actual, expected)) {
        return;
    }
    const delta = Math.abs(expected - actual);
    if (delta <= tolerance) {
        return;
    }
    const f = (n)=>Number.isInteger(n) ? n : n.toExponential();
    throw new AssertionError(msg ?? `actual: "${f(actual)}" expected to be close to "${f(expected)}": \
delta "${f(delta)}" is greater than "${f(tolerance)}"`);
}
function assertInstanceOf(actual, expectedType, msg = "") {
    if (!msg) {
        const expectedTypeStr = expectedType.name;
        let actualTypeStr = "";
        if (actual === null) {
            actualTypeStr = "null";
        } else if (actual === undefined) {
            actualTypeStr = "undefined";
        } else if (typeof actual === "object") {
            actualTypeStr = actual.constructor?.name ?? "Object";
        } else {
            actualTypeStr = typeof actual;
        }
        if (expectedTypeStr == actualTypeStr) {
            msg = `Expected object to be an instance of "${expectedTypeStr}".`;
        } else if (actualTypeStr == "function") {
            msg = `Expected object to be an instance of "${expectedTypeStr}" but was not an instanced object.`;
        } else {
            msg = `Expected object to be an instance of "${expectedTypeStr}" but was "${actualTypeStr}".`;
        }
    }
    assert(actual instanceof expectedType, msg);
}
function assertNotInstanceOf(actual, unexpectedType, msg = `Expected object to not be an instance of "${typeof unexpectedType}"`) {
    assertFalse(actual instanceof unexpectedType, msg);
}
function assertExists(actual, msg) {
    if (actual === undefined || actual === null) {
        if (!msg) {
            msg = `actual: "${actual}" expected to not be null or undefined`;
        }
        throw new AssertionError(msg);
    }
}
function assertStringIncludes(actual, expected, msg) {
    if (!actual.includes(expected)) {
        if (!msg) {
            msg = `actual: "${actual}" expected to contain: "${expected}"`;
        }
        throw new AssertionError(msg);
    }
}
function assertArrayIncludes(actual, expected, msg) {
    const missing = [];
    for(let i = 0; i < expected.length; i++){
        let found = false;
        for(let j = 0; j < actual.length; j++){
            if (equal(expected[i], actual[j])) {
                found = true;
                break;
            }
        }
        if (!found) {
            missing.push(expected[i]);
        }
    }
    if (missing.length === 0) {
        return;
    }
    if (!msg) {
        msg = `actual: "${format(actual)}" expected to include: "${format(expected)}"\nmissing: ${format(missing)}`;
    }
    throw new AssertionError(msg);
}
function assertMatch(actual, expected, msg) {
    if (!expected.test(actual)) {
        if (!msg) {
            msg = `actual: "${actual}" expected to match: "${expected}"`;
        }
        throw new AssertionError(msg);
    }
}
function assertNotMatch(actual, expected, msg) {
    if (expected.test(actual)) {
        if (!msg) {
            msg = `actual: "${actual}" expected to not match: "${expected}"`;
        }
        throw new AssertionError(msg);
    }
}
function assertObjectMatch(actual, expected) {
    function filter(a, b) {
        const seen = new WeakMap();
        return fn(a, b);
        function fn(a, b) {
            if (seen.has(a) && seen.get(a) === b) {
                return a;
            }
            seen.set(a, b);
            const filtered = {};
            const entries = [
                ...Object.getOwnPropertyNames(a),
                ...Object.getOwnPropertySymbols(a)
            ].filter((key)=>key in b).map((key)=>[
                    key,
                    a[key]
                ]);
            for (const [key, value] of entries){
                if (Array.isArray(value)) {
                    const subset = b[key];
                    if (Array.isArray(subset)) {
                        filtered[key] = fn({
                            ...value
                        }, {
                            ...subset
                        });
                        continue;
                    }
                } else if (value instanceof RegExp) {
                    filtered[key] = value;
                    continue;
                } else if (typeof value === "object") {
                    const subset1 = b[key];
                    if (typeof subset1 === "object" && subset1) {
                        if (value instanceof Map && subset1 instanceof Map) {
                            filtered[key] = new Map([
                                ...value
                            ].filter(([k])=>subset1.has(k)).map(([k, v])=>[
                                    k,
                                    typeof v === "object" ? fn(v, subset1.get(k)) : v
                                ]));
                            continue;
                        }
                        if (value instanceof Set && subset1 instanceof Set) {
                            filtered[key] = new Set([
                                ...value
                            ].filter((v)=>subset1.has(v)));
                            continue;
                        }
                        filtered[key] = fn(value, subset1);
                        continue;
                    }
                }
                filtered[key] = value;
            }
            return filtered;
        }
    }
    return assertEquals(filter(actual, expected), filter(expected, expected));
}
function fail(msg) {
    assert(false, `Failed assertion${msg ? `: ${msg}` : "."}`);
}
function assertIsError(error, ErrorClass, msgIncludes, msg) {
    if (error instanceof Error === false) {
        throw new AssertionError(`Expected "error" to be an Error object.`);
    }
    if (ErrorClass && !(error instanceof ErrorClass)) {
        msg = `Expected error to be instance of "${ErrorClass.name}", but was "${typeof error === "object" ? error?.constructor?.name : "[not an object]"}"${msg ? `: ${msg}` : "."}`;
        throw new AssertionError(msg);
    }
    if (msgIncludes && (!(error instanceof Error) || !stripColor(error.message).includes(stripColor(msgIncludes)))) {
        msg = `Expected error message to include "${msgIncludes}", but got "${error instanceof Error ? error.message : "[not an Error]"}"${msg ? `: ${msg}` : "."}`;
        throw new AssertionError(msg);
    }
}
function assertThrows(fn, errorClassOrMsg, msgIncludesOrMsg, msg) {
    let ErrorClass = undefined;
    let msgIncludes = undefined;
    let err;
    if (typeof errorClassOrMsg !== "string") {
        if (errorClassOrMsg === undefined || errorClassOrMsg.prototype instanceof Error || errorClassOrMsg.prototype === Error.prototype) {
            ErrorClass = errorClassOrMsg;
            msgIncludes = msgIncludesOrMsg;
        } else {
            msg = msgIncludesOrMsg;
        }
    } else {
        msg = errorClassOrMsg;
    }
    let doesThrow = false;
    const msgToAppendToError = msg ? `: ${msg}` : ".";
    try {
        fn();
    } catch (error) {
        if (ErrorClass) {
            if (error instanceof Error === false) {
                throw new AssertionError("A non-Error object was thrown.");
            }
            assertIsError(error, ErrorClass, msgIncludes, msg);
        }
        err = error;
        doesThrow = true;
    }
    if (!doesThrow) {
        msg = `Expected function to throw${msgToAppendToError}`;
        throw new AssertionError(msg);
    }
    return err;
}
async function assertRejects(fn, errorClassOrMsg, msgIncludesOrMsg, msg) {
    let ErrorClass = undefined;
    let msgIncludes = undefined;
    let err;
    if (typeof errorClassOrMsg !== "string") {
        if (errorClassOrMsg === undefined || errorClassOrMsg.prototype instanceof Error || errorClassOrMsg.prototype === Error.prototype) {
            ErrorClass = errorClassOrMsg;
            msgIncludes = msgIncludesOrMsg;
        }
    } else {
        msg = errorClassOrMsg;
    }
    let doesThrow = false;
    let isPromiseReturned = false;
    const msgToAppendToError = msg ? `: ${msg}` : ".";
    try {
        const possiblePromise = fn();
        if (possiblePromise && typeof possiblePromise === "object" && typeof possiblePromise.then === "function") {
            isPromiseReturned = true;
            await possiblePromise;
        }
    } catch (error) {
        if (!isPromiseReturned) {
            throw new AssertionError(`Function throws when expected to reject${msgToAppendToError}`);
        }
        if (ErrorClass) {
            if (error instanceof Error === false) {
                throw new AssertionError("A non-Error object was rejected.");
            }
            assertIsError(error, ErrorClass, msgIncludes, msg);
        }
        err = error;
        doesThrow = true;
    }
    if (!doesThrow) {
        throw new AssertionError(`Expected function to reject${msgToAppendToError}`);
    }
    return err;
}
function unimplemented(msg) {
    throw new AssertionError(msg || "unimplemented");
}
function unreachable() {
    throw new AssertionError("unreachable");
}
export { AssertionError as AssertionError };
export { equal as equal };
export { assert as assert };
export { assertFalse as assertFalse };
export { assertEquals as assertEquals };
export { assertNotEquals as assertNotEquals };
export { assertStrictEquals as assertStrictEquals };
export { assertNotStrictEquals as assertNotStrictEquals };
export { assertAlmostEquals as assertAlmostEquals };
export { assertInstanceOf as assertInstanceOf };
export { assertNotInstanceOf as assertNotInstanceOf };
export { assertExists as assertExists };
export { assertStringIncludes as assertStringIncludes };
export { assertArrayIncludes as assertArrayIncludes };
export { assertMatch as assertMatch };
export { assertNotMatch as assertNotMatch };
export { assertObjectMatch as assertObjectMatch };
export { fail as fail };
export { assertIsError as assertIsError };
export { assertThrows as assertThrows };
export { assertRejects as assertRejects };
export { unimplemented as unimplemented };
export { unreachable as unreachable };

