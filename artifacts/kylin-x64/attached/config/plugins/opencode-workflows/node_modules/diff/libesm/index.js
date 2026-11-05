/* See LICENSE file for terms of use */
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
import Diff from './diff/base.js';
import { diffChars, characterDiff } from './diff/character.js';
import { diffWords, diffWordsWithSpace, wordDiff, wordsWithSpaceDiff } from './diff/word.js';
import { diffLines, diffTrimmedLines, lineDiff } from './diff/line.js';
import { diffSentences, sentenceDiff } from './diff/sentence.js';
import { diffCss, cssDiff } from './diff/css.js';
import { diffJson, canonicalize, jsonDiff } from './diff/json.js';
import { diffArrays, arrayDiff } from './diff/array.js';
import { applyPatch, applyPatches } from './patch/apply.js';
import { parsePatch } from './patch/parse.js';
import { reversePatch } from './patch/reverse.js';
import { structuredPatch, createTwoFilesPatch, createPatch, formatPatch, INCLUDE_HEADERS, FILE_HEADERS_ONLY, OMIT_HEADERS } from './patch/create.js';
import { convertChangesToDMP } from './convert/dmp.js';
import { convertChangesToXML } from './convert/xml.js';
export { Diff, diffChars, characterDiff, diffWords, wordDiff, diffWordsWithSpace, wordsWithSpaceDiff, diffLines, lineDiff, diffTrimmedLines, diffSentences, sentenceDiff, diffCss, cssDiff, diffJson, jsonDiff, diffArrays, arrayDiff, structuredPatch, createTwoFilesPatch, createPatch, formatPatch, INCLUDE_HEADERS, FILE_HEADERS_ONLY, OMIT_HEADERS, applyPatch, applyPatches, parsePatch, reversePatch, convertChangesToDMP, convertChangesToXML, canonicalize };
