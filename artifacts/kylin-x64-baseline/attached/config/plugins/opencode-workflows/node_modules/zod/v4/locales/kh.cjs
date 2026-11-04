"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const km_js_1 = __importDefault(require("./km.cjs"));
/** @deprecated Use `km` instead. */
function default_1() {
    return (0, km_js_1.default)();
}
module.exports = exports.default;
