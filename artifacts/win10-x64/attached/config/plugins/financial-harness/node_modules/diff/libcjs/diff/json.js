"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonDiff = void 0;
exports.diffJson = diffJson;
exports.canonicalize = canonicalize;
var base_js_1 = require("./base.js");
var line_js_1 = require("./line.js");
var JsonDiff = /** @class */ (function (_super) {
    __extends(JsonDiff, _super);
    function JsonDiff() {
        var _this = _super !== null && _super.apply(this, arguments) || this;
        _this.tokenize = line_js_1.tokenize;
        return _this;
    }
    Object.defineProperty(JsonDiff.prototype, "useLongestToken", {
        get: function () {
            // Discriminate between two lines of pretty-printed, serialized JSON where one of them has a
            // dangling comma and the other doesn't. Turns out including the dangling comma yields the nicest output:
            return true;
        },
        enumerable: false,
        configurable: true
    });
    JsonDiff.prototype.castInput = function (value, options) {
        var undefinedReplacement = options.undefinedReplacement, _a = options.stringifyReplacer, stringifyReplacer = _a === void 0 ? function (k, v) { return typeof v === 'undefined' ? undefinedReplacement : v; } : _a;
        return typeof value === 'string' ? value : JSON.stringify(canonicalize(value, null, null, stringifyReplacer), null, '  ');
    };
    JsonDiff.prototype.equals = function (left, right, options) {
        return _super.prototype.equals.call(this, left.replace(/,([\r\n])/g, '$1'), right.replace(/,([\r\n])/g, '$1'), options);
    };
    return JsonDiff;
}(base_js_1.default));
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
    var i;
    for (i = 0; i < stack.length; i += 1) {
        if (stack[i] === obj) {
            return replacementStack[i];
        }
    }
    var canonicalizedObj;
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
        var sortedKeys = [];
        var key_1;
        for (key_1 in obj) {
            /* istanbul ignore else */
            if (Object.prototype.hasOwnProperty.call(obj, key_1)) {
                sortedKeys.push(key_1);
            }
        }
        sortedKeys.sort();
        for (i = 0; i < sortedKeys.length; i += 1) {
            key_1 = sortedKeys[i];
            canonicalizedObj[key_1] = canonicalize(obj[key_1], stack, replacementStack, replacer, key_1);
        }
        stack.pop();
        replacementStack.pop();
    }
    else {
        canonicalizedObj = obj;
    }
    return canonicalizedObj;
}
