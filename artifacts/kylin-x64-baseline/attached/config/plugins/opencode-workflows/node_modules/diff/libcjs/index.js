"use strict";
/* See LICENSE file for terms of use */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalize = exports.convertChangesToXML = exports.convertChangesToDMP = exports.reversePatch = exports.parsePatch = exports.applyPatches = exports.applyPatch = exports.OMIT_HEADERS = exports.FILE_HEADERS_ONLY = exports.INCLUDE_HEADERS = exports.formatPatch = exports.createPatch = exports.createTwoFilesPatch = exports.structuredPatch = exports.arrayDiff = exports.diffArrays = exports.jsonDiff = exports.diffJson = exports.cssDiff = exports.diffCss = exports.sentenceDiff = exports.diffSentences = exports.diffTrimmedLines = exports.lineDiff = exports.diffLines = exports.wordsWithSpaceDiff = exports.diffWordsWithSpace = exports.wordDiff = exports.diffWords = exports.characterDiff = exports.diffChars = exports.Diff = void 0;
/*
 * Text diff implementation.
 *
 * This library supports the following APIs:
 * Diff.diffChars: Character by character diff
 * Diff.diffWords: Word (as defined by \b regex) diff which ignores whitespace
 * Diff.diffLines: Line based diff
 *
 * Diff.diffCss: Diff targeted at CSS content
 *
 * These methods are based on the implementation proposed in
 * "An O(ND) Difference Algorithm and its Variations" (Myers, 1986).
 * http://citeseerx.ist.psu.edu/viewdoc/summary?doi=10.1.1.4.6927
 */
const base_js_1 = __importDefault(require("./diff/base.js"));
exports.Diff = base_js_1.default;
const character_js_1 = require("./diff/character.js");
Object.defineProperty(exports, "diffChars", { enumerable: true, get: function () { return character_js_1.diffChars; } });
Object.defineProperty(exports, "characterDiff", { enumerable: true, get: function () { return character_js_1.characterDiff; } });
const word_js_1 = require("./diff/word.js");
Object.defineProperty(exports, "diffWords", { enumerable: true, get: function () { return word_js_1.diffWords; } });
Object.defineProperty(exports, "diffWordsWithSpace", { enumerable: true, get: function () { return word_js_1.diffWordsWithSpace; } });
Object.defineProperty(exports, "wordDiff", { enumerable: true, get: function () { return word_js_1.wordDiff; } });
Object.defineProperty(exports, "wordsWithSpaceDiff", { enumerable: true, get: function () { return word_js_1.wordsWithSpaceDiff; } });
const line_js_1 = require("./diff/line.js");
Object.defineProperty(exports, "diffLines", { enumerable: true, get: function () { return line_js_1.diffLines; } });
Object.defineProperty(exports, "diffTrimmedLines", { enumerable: true, get: function () { return line_js_1.diffTrimmedLines; } });
Object.defineProperty(exports, "lineDiff", { enumerable: true, get: function () { return line_js_1.lineDiff; } });
const sentence_js_1 = require("./diff/sentence.js");
Object.defineProperty(exports, "diffSentences", { enumerable: true, get: function () { return sentence_js_1.diffSentences; } });
Object.defineProperty(exports, "sentenceDiff", { enumerable: true, get: function () { return sentence_js_1.sentenceDiff; } });
const css_js_1 = require("./diff/css.js");
Object.defineProperty(exports, "diffCss", { enumerable: true, get: function () { return css_js_1.diffCss; } });
Object.defineProperty(exports, "cssDiff", { enumerable: true, get: function () { return css_js_1.cssDiff; } });
const json_js_1 = require("./diff/json.js");
Object.defineProperty(exports, "diffJson", { enumerable: true, get: function () { return json_js_1.diffJson; } });
Object.defineProperty(exports, "canonicalize", { enumerable: true, get: function () { return json_js_1.canonicalize; } });
Object.defineProperty(exports, "jsonDiff", { enumerable: true, get: function () { return json_js_1.jsonDiff; } });
const array_js_1 = require("./diff/array.js");
Object.defineProperty(exports, "diffArrays", { enumerable: true, get: function () { return array_js_1.diffArrays; } });
Object.defineProperty(exports, "arrayDiff", { enumerable: true, get: function () { return array_js_1.arrayDiff; } });
const apply_js_1 = require("./patch/apply.js");
Object.defineProperty(exports, "applyPatch", { enumerable: true, get: function () { return apply_js_1.applyPatch; } });
Object.defineProperty(exports, "applyPatches", { enumerable: true, get: function () { return apply_js_1.applyPatches; } });
const parse_js_1 = require("./patch/parse.js");
Object.defineProperty(exports, "parsePatch", { enumerable: true, get: function () { return parse_js_1.parsePatch; } });
const reverse_js_1 = require("./patch/reverse.js");
Object.defineProperty(exports, "reversePatch", { enumerable: true, get: function () { return reverse_js_1.reversePatch; } });
const create_js_1 = require("./patch/create.js");
Object.defineProperty(exports, "structuredPatch", { enumerable: true, get: function () { return create_js_1.structuredPatch; } });
Object.defineProperty(exports, "createTwoFilesPatch", { enumerable: true, get: function () { return create_js_1.createTwoFilesPatch; } });
Object.defineProperty(exports, "createPatch", { enumerable: true, get: function () { return create_js_1.createPatch; } });
Object.defineProperty(exports, "formatPatch", { enumerable: true, get: function () { return create_js_1.formatPatch; } });
Object.defineProperty(exports, "INCLUDE_HEADERS", { enumerable: true, get: function () { return create_js_1.INCLUDE_HEADERS; } });
Object.defineProperty(exports, "FILE_HEADERS_ONLY", { enumerable: true, get: function () { return create_js_1.FILE_HEADERS_ONLY; } });
Object.defineProperty(exports, "OMIT_HEADERS", { enumerable: true, get: function () { return create_js_1.OMIT_HEADERS; } });
const dmp_js_1 = require("./convert/dmp.js");
Object.defineProperty(exports, "convertChangesToDMP", { enumerable: true, get: function () { return dmp_js_1.convertChangesToDMP; } });
const xml_js_1 = require("./convert/xml.js");
Object.defineProperty(exports, "convertChangesToXML", { enumerable: true, get: function () { return xml_js_1.convertChangesToXML; } });
