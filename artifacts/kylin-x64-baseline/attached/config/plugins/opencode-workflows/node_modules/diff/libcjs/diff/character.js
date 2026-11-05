"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.characterDiff = void 0;
exports.diffChars = diffChars;
const base_js_1 = __importDefault(require("./base.js"));
class CharacterDiff extends base_js_1.default {
}
exports.characterDiff = new CharacterDiff();
function diffChars(oldStr, newStr, options) {
    return exports.characterDiff.diff(oldStr, newStr, options);
}
