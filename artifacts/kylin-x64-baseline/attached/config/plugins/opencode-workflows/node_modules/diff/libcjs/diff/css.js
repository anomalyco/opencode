"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cssDiff = void 0;
exports.diffCss = diffCss;
const base_js_1 = __importDefault(require("./base.js"));
class CssDiff extends base_js_1.default {
    tokenize(value) {
        return value.split(/([{}:;,]|\s+)/);
    }
}
exports.cssDiff = new CssDiff();
function diffCss(oldStr, newStr, options) {
    return exports.cssDiff.diff(oldStr, newStr, options);
}
