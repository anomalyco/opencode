"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.arrayDiff = void 0;
exports.diffArrays = diffArrays;
const base_js_1 = __importDefault(require("./base.js"));
class ArrayDiff extends base_js_1.default {
    tokenize(value) {
        return value.slice();
    }
    join(value) {
        return value;
    }
    removeEmpty(value) {
        return value;
    }
}
exports.arrayDiff = new ArrayDiff();
function diffArrays(oldArr, newArr, options) {
    return exports.arrayDiff.diff(oldArr, newArr, options);
}
