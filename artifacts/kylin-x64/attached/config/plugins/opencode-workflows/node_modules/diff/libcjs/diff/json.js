"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonDiff = void 0;
exports.diffJson = diffJson;
exports.canonicalize = canonicalize;
const base_js_1 = __importDefault(require("./base.js"));
const line_js_1 = require("./line.js");
class JsonDiff extends base_js_1.default {
    constructor() {
        super(...arguments);
        this.tokenize = line_js_1.tokenize;
    }
    get useLongestToken() {
        // Discriminate between two lines of pretty-printed, serialized JSON where one of them has a
        // dangling comma and the other doesn't. Turns out including the dangling comma yields the nicest output:
        return true;
    }
    castInput(value, options) {
        const { undefinedReplacement, stringifyReplacer = (k, v) => typeof v === 'undefined' ? undefinedReplacement : v } = options;
        return typeof value === 'string' ? value : JSON.stringify(canonicalize(value, null, null, stringifyReplacer), null, '  ');
    }
    equals(left, right, options) {
        return super.equals(left.replace(/,([\r\n])/g, '$1'), right.replace(/,([\r\n])/g, '$1'), options);
    }
}
exports.jsonDiff = new JsonDiff();
function diffJson(oldStr, newStr, options) {
    return exports.jsonDiff.diff(oldStr, newStr, options);
}
// This function handles the presence of circular references by bailing out when encountering an
// object that is already on the "stack" of items being processed. Accepts an optional replacer
function canonicalize(obj, stack, replacementStack, replacer, key) {
    stack = stack || [];
    replacementStack = replacementStack || [];
    if (replacer) {
        obj = replacer(key === undefined ? '' : key, obj);
    }
    let i;
    for (i = 0; i < stack.length; i += 1) {
        if (stack[i] === obj) {
            return replacementStack[i];
        }
    }
    let canonicalizedObj;
    if ('[object Array]' === Object.prototype.toString.call(obj)) {
        stack.push(obj);
        canonicalizedObj = new Array(obj.length);
        replacementStack.push(canonicalizedObj);
        for (i = 0; i < obj.length; i += 1) {
            canonicalizedObj[i] = canonicalize(obj[i], stack, replacementStack, replacer, String(i));
        }
        stack.pop();
        replacementStack.pop();
        return canonicalizedObj;
    }
    if (obj && obj.toJSON) {
        obj = obj.toJSON();
    }
    if (typeof obj === 'object' && obj !== null) {
        stack.push(obj);
        canonicalizedObj = {};
        replacementStack.push(canonicalizedObj);
        const sortedKeys = [];
        let key;
        for (key in obj) {
            /* istanbul ignore else */
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                sortedKeys.push(key);
            }
        }
        sortedKeys.sort();
        for (i = 0; i < sortedKeys.length; i += 1) {
            key = sortedKeys[i];
            canonicalizedObj[key] = canonicalize(obj[key], stack, replacementStack, replacer, key);
        }
        stack.pop();
        replacementStack.pop();
    }
    else {
        canonicalizedObj = obj;
    }
    return canonicalizedObj;
}
