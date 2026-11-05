"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasMagic = exports.Glob = exports.unescape = exports.escape = exports.sync = exports.iterate = exports.iterateSync = exports.stream = exports.streamSync = exports.globIterate = exports.globIterateSync = exports.glob = exports.globSync = exports.globStream = exports.globStreamSync = void 0;
const minimatch_1 = require("minimatch");
const glob_js_1 = require("./glob.js");
const has_magic_js_1 = require("./has-magic.js");
function globStreamSync(pattern, options = {}) {
    return new glob_js_1.Glob(pattern, options).streamSync();
}
exports.globStreamSync = globStreamSync;
function globStream(pattern, options = {}) {
    return new glob_js_1.Glob(pattern, options).stream();
}
exports.globStream = globStream;
function globSync(pattern, options = {}) {
    return new glob_js_1.Glob(pattern, options).walkSync();
}
exports.globSync = globSync;
async function glob(pattern, options = {}) {
    return new glob_js_1.Glob(pattern, options).walk();
}
exports.glob = glob;
function globIterateSync(pattern, options = {}) {
    return new glob_js_1.Glob(pattern, options).iterateSync();
}
exports.globIterateSync = globIterateSync;
function globIterate(pattern, options = {}) {
    return new glob_js_1.Glob(pattern, options).iterate();
}
exports.globIterate = globIterate;
// aliases: glob.sync.stream() glob.stream.sync() glob.sync() etc
exports.streamSync = globStreamSync;
exports.stream = Object.assign(globStream, { sync: globStreamSync });
exports.iterateSync = globIterateSync;
exports.iterate = Object.assign(globIterate, {
    sync: globIterateSync,
});
exports.sync = Object.assign(globSync, {
    stream: globStreamSync,
    iterate: globIterateSync,
});
/* c8 ignore start */
var minimatch_2 = require("minimatch");
Object.defineProperty(exports, "escape", { enumerable: true, get: function () { return minimatch_2.escape; } });
Object.defineProperty(exports, "unescape", { enumerable: true, get: function () { return minimatch_2.unescape; } });
var glob_js_2 = require("./glob.js");
Object.defineProperty(exports, "Glob", { enumerable: true, get: function () { return glob_js_2.Glob; } });
var has_magic_js_2 = require("./has-magic.js");
Object.defineProperty(exports, "hasMagic", { enumerable: true, get: function () { return has_magic_js_2.hasMagic; } });
/* c8 ignore stop */
exports.default = Object.assign(glob, {
    glob,
    globSync,
    sync: exports.sync,
    globStream,
    stream: exports.stream,
    globStreamSync,
    streamSync: exports.streamSync,
    globIterate,
    iterate: exports.iterate,
    globIterateSync,
    iterateSync: exports.iterateSync,
    Glob: glob_js_1.Glob,
    hasMagic: has_magic_js_1.hasMagic,
    escape: minimatch_1.escape,
    unescape: minimatch_1.unescape,
});
//# sourceMappingURL=index.js.map