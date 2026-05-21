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
exports.arrayDiff = void 0;
exports.diffArrays = diffArrays;
var base_js_1 = require("./base.js");
var ArrayDiff = /** @class */ (function (_super) {
    __extends(ArrayDiff, _super);
    function ArrayDiff() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    ArrayDiff.prototype.tokenize = function (value) {
        return value.slice();
    };
    ArrayDiff.prototype.join = function (value) {
        return value;
    };
    ArrayDiff.prototype.removeEmpty = function (value) {
        return value;
    };
    return ArrayDiff;
}(base_js_1.default));
exports.arrayDiff = new ArrayDiff();
function diffArrays(oldArr, newArr, options) {
    return exports.arrayDiff.diff(oldArr, newArr, options);
}
