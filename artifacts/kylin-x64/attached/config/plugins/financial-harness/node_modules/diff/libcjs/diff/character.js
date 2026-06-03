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
exports.characterDiff = void 0;
exports.diffChars = diffChars;
var base_js_1 = require("./base.js");
var CharacterDiff = /** @class */ (function (_super) {
    __extends(CharacterDiff, _super);
    function CharacterDiff() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    return CharacterDiff;
}(base_js_1.default));
exports.characterDiff = new CharacterDiff();
function diffChars(oldStr, newStr, options) {
    return exports.characterDiff.diff(oldStr, newStr, options);
}
