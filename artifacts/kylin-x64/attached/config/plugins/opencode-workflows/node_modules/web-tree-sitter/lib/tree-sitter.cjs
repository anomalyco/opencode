var Module = (() => {
  var _scriptName = typeof document != 'undefined' ? document.currentScript?.src : undefined;
  if (typeof __filename != 'undefined') _scriptName = _scriptName || __filename;
  return (
async function(moduleArg = {}) {
  var moduleRtn;

// include: shell.js
// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(moduleArg) => Promise<Module>
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module = moduleArg;

// Set up the promise that indicates the Module is initialized
var readyPromiseResolve, readyPromiseReject;

var readyPromise = new Promise((resolve, reject) => {
  readyPromiseResolve = resolve;
  readyPromiseReject = reject;
});

// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).
// Attempt to auto-detect the environment
var ENVIRONMENT_IS_WEB = typeof window == "object";

var ENVIRONMENT_IS_WORKER = typeof WorkerGlobalScope != "undefined";

// N.b. Electron.js environment is simultaneously a NODE-environment, but
// also a web environment.
var ENVIRONMENT_IS_NODE = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string" && process.type != "renderer";

var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;

if (ENVIRONMENT_IS_NODE) {}

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)
// include: lib/binding_web/lib/prefix.js
Module.currentQueryProgressCallback = null;

Module.currentProgressCallback = null;

Module.currentLogCallback = null;

Module.currentParseCallback = null;

// end include: lib/binding_web/lib/prefix.js
// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = Object.assign({}, Module);

var arguments_ = [];

var thisProgram = "./this.program";

var quit_ = (status, toThrow) => {
  throw toThrow;
};

// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = "";

function locateFile(path) {
  if (Module["locateFile"]) {
    return Module["locateFile"](path, scriptDirectory);
  }
  return scriptDirectory + path;
}

// Hooks that are implemented differently in different runtime environments.
var readAsync, readBinary;

if (ENVIRONMENT_IS_NODE) {
  if (typeof process == "undefined" || !process.release || process.release.name !== "node") throw new Error("not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)");
  var nodeVersion = process.versions.node;
  var numericVersion = nodeVersion.split(".").slice(0, 3);
  numericVersion = (numericVersion[0] * 1e4) + (numericVersion[1] * 100) + (numericVersion[2].split("-")[0] * 1);
  var minVersion = 16e4;
  if (numericVersion < 16e4) {
    throw new Error("This emscripten-generated code requires node v16.0.0 (detected v" + nodeVersion + ")");
  }
  // These modules will usually be used on Node.js. Load them eagerly to avoid
  // the complexity of lazy-loading.
  var fs = require("fs");
  var nodePath = require("path");
  scriptDirectory = __dirname + "/";
  // include: node_shell_read.js
  readBinary = filename => {
    // We need to re-wrap `file://` strings to URLs.
    filename = isFileURI(filename) ? new URL(filename) : filename;
    var ret = fs.readFileSync(filename);
    assert(Buffer.isBuffer(ret));
    return ret;
  };
  readAsync = async (filename, binary = true) => {
    // See the comment in the `readBinary` function.
    filename = isFileURI(filename) ? new URL(filename) : filename;
    var ret = fs.readFileSync(filename, binary ? undefined : "utf8");
    assert(binary ? Buffer.isBuffer(ret) : typeof ret == "string");
    return ret;
  };
  // end include: node_shell_read.js
  if (!Module["thisProgram"] && process.argv.length > 1) {
    thisProgram = process.argv[1].replace(/\\/g, "/");
  }
  arguments_ = process.argv.slice(2);
  // MODULARIZE will export the module in the proper place outside, we don't need to export here
  quit_ = (status, toThrow) => {
    process.exitCode = status;
    throw toThrow;
  };
} else if (ENVIRONMENT_IS_SHELL) {
  if ((typeof process == "object" && typeof require === "function") || typeof window == "object" || typeof WorkerGlobalScope != "undefined") throw new Error("not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)");
} else // Note that this includes Node.js workers when relevant (pthreads is enabled).
// Node.js workers are detected as a combination of ENVIRONMENT_IS_WORKER and
// ENVIRONMENT_IS_NODE.
if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  if (ENVIRONMENT_IS_WORKER) {
    // Check worker, not web, since window could be polyfilled
    scriptDirectory = self.location.href;
  } else if (typeof document != "undefined" && document.currentScript) {
    // web
    scriptDirectory = document.currentScript.src;
  }
  // When MODULARIZE, this JS may be executed later, after document.currentScript
  // is gone, so we saved it, and we use it here instead of any other info.
  if (_scriptName) {
    scriptDirectory = _scriptName;
  }
  // blob urls look like blob:http://site.com/etc/etc and we cannot infer anything from them.
  // otherwise, slice off the final part of the url to find the script directory.
  // if scriptDirectory does not contain a slash, lastIndexOf will return -1,
  // and scriptDirectory will correctly be replaced with an empty string.
  // If scriptDirectory contains a query (starting with ?) or a fragment (starting with #),
  // they are removed because they could contain a slash.
  if (scriptDirectory.startsWith("blob:")) {
    scriptDirectory = "";
  } else {
    scriptDirectory = scriptDirectory.slice(0, scriptDirectory.replace(/[?#].*/, "").lastIndexOf("/") + 1);
  }
  if (!(typeof window == "object" || typeof WorkerGlobalScope != "undefined")) throw new Error("not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)");
  {
    // include: web_or_worker_shell_read.js
    if (ENVIRONMENT_IS_WORKER) {
      readBinary = url => {
        var xhr = new XMLHttpRequest;
        xhr.open("GET", url, false);
        xhr.responseType = "arraybuffer";
        xhr.send(null);
        return new Uint8Array(/** @type{!ArrayBuffer} */ (xhr.response));
      };
    }
    readAsync = async url => {
      // Fetch has some additional restrictions over XHR, like it can't be used on a file:// url.
      // See https://github.com/github/fetch/pull/92#issuecomment-140665932
      // Cordova or Electron apps are typically loaded from a file:// url.
      // So use XHR on webview if URL is a file URL.
      if (isFileURI(url)) {
        return new Promise((resolve, reject) => {
          var xhr = new XMLHttpRequest;
          xhr.open("GET", url, true);
          xhr.responseType = "arraybuffer";
          xhr.onload = () => {
            if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) {
              // file URLs can return 0
              resolve(xhr.response);
              return;
            }
            reject(xhr.status);
          };
          xhr.onerror = reject;
          xhr.send(null);
        });
      }
      var response = await fetch(url, {
        credentials: "same-origin"
      });
      if (response.ok) {
        return response.arrayBuffer();
      }
      throw new Error(response.status + " : " + response.url);
    };
  }
} else {
  throw new Error("environment detection error");
}

var out = Module["print"] || console.log.bind(console);

var err = Module["printErr"] || console.error.bind(console);

// Merge back in the overrides
Object.assign(Module, moduleOverrides);

// Free the object hierarchy contained in the overrides, this lets the GC
// reclaim data used.
moduleOverrides = null;

checkIncomingModuleAPI();

// Emit code to handle expected values on the Module object. This applies Module.x
// to the proper local x. This has two benefits: first, we only emit it if it is
// expected to arrive, and second, by using a local everywhere else that can be
// minified.
if (Module["arguments"]) arguments_ = Module["arguments"];

legacyModuleProp("arguments", "arguments_");

if (Module["thisProgram"]) thisProgram = Module["thisProgram"];

legacyModuleProp("thisProgram", "thisProgram");

// perform assertions in shell.js after we set up out() and err(), as otherwise if an assertion fails it cannot print the message
// Assertions on removed incoming Module JS APIs.
assert(typeof Module["memoryInitializerPrefixURL"] == "undefined", "Module.memoryInitializerPrefixURL option was removed, use Module.locateFile instead");

assert(typeof Module["pthreadMainPrefixURL"] == "undefined", "Module.pthreadMainPrefixURL option was removed, use Module.locateFile instead");

assert(typeof Module["cdInitializerPrefixURL"] == "undefined", "Module.cdInitializerPrefixURL option was removed, use Module.locateFile instead");

assert(typeof Module["filePackagePrefixURL"] == "undefined", "Module.filePackagePrefixURL option was removed, use Module.locateFile instead");

assert(typeof Module["read"] == "undefined", "Module.read option was removed");

assert(typeof Module["readAsync"] == "undefined", "Module.readAsync option was removed (modify readAsync in JS)");

assert(typeof Module["readBinary"] == "undefined", "Module.readBinary option was removed (modify readBinary in JS)");

assert(typeof Module["setWindowTitle"] == "undefined", "Module.setWindowTitle option was removed (modify emscripten_set_window_title in JS)");

assert(typeof Module["TOTAL_MEMORY"] == "undefined", "Module.TOTAL_MEMORY has been renamed Module.INITIAL_MEMORY");

legacyModuleProp("asm", "wasmExports");

legacyModuleProp("readAsync", "readAsync");

legacyModuleProp("readBinary", "readBinary");

legacyModuleProp("setWindowTitle", "setWindowTitle");

var IDBFS = "IDBFS is no longer included by default; build with -lidbfs.js";

var PROXYFS = "PROXYFS is no longer included by default; build with -lproxyfs.js";

var WORKERFS = "WORKERFS is no longer included by default; build with -lworkerfs.js";

var FETCHFS = "FETCHFS is no longer included by default; build with -lfetchfs.js";

var ICASEFS = "ICASEFS is no longer included by default; build with -licasefs.js";

var JSFILEFS = "JSFILEFS is no longer included by default; build with -ljsfilefs.js";

var OPFS = "OPFS is no longer included by default; build with -lopfs.js";

var NODEFS = "NODEFS is no longer included by default; build with -lnodefs.js";

assert(!ENVIRONMENT_IS_SHELL, "shell environment detected but not enabled at build time.  Add `shell` to `-sENVIRONMENT` to enable.");

// end include: shell.js
// include: preamble.js
// === Preamble library stuff ===
// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html
var dynamicLibraries = Module["dynamicLibraries"] || [];

var wasmBinary = Module["wasmBinary"];

legacyModuleProp("wasmBinary", "wasmBinary");

if (typeof WebAssembly != "object") {
  err("no native wasm support detected");
}

// Wasm globals
var wasmMemory;

//========================================
// Runtime essentials
//========================================
// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS;

// In STRICT mode, we only define assert() when ASSERTIONS is set.  i.e. we
// don't define it at all in release modes.  This matches the behaviour of
// MINIMAL_RUNTIME.
// TODO(sbc): Make this the default even without STRICT enabled.
/** @type {function(*, string=)} */ function assert(condition, text) {
  if (!condition) {
    abort("Assertion failed" + (text ? ": " + text : ""));
  }
}

// We used to include malloc/free by default in the past. Show a helpful error in
// builds with assertions.
// Memory management
var HEAP, /** @type {!Int8Array} */ HEAP8, /** @type {!Uint8Array} */ HEAPU8, /** @type {!Int16Array} */ HEAP16, /** @type {!Uint16Array} */ HEAPU16, /** @type {!Int32Array} */ HEAP32, /** @type {!Uint32Array} */ HEAPU32, /** @type {!Float32Array} */ HEAPF32, /* BigInt64Array type is not correctly defined in closure
/** not-@type {!BigInt64Array} */ HEAP64, /* BigUint64Array type is not correctly defined in closure
/** not-t@type {!BigUint64Array} */ HEAPU64, /** @type {!Float64Array} */ HEAPF64;

var HEAP_DATA_VIEW;

var runtimeInitialized = false;

/**
 * Indicates whether filename is delivered via file protocol (as opposed to http/https)
 * @noinline
 */ var isFileURI = filename => filename.startsWith("file://");

// include: runtime_shared.js
// include: runtime_stack_check.js
// Initializes the stack cookie. Called at the startup of main and at the startup of each thread in pthreads mode.
function writeStackCookie() {
  var max = _emscripten_stack_get_end();
  assert((max & 3) == 0);
  // If the stack ends at address zero we write our cookies 4 bytes into the
  // stack.  This prevents interference with SAFE_HEAP and ASAN which also
  // monitor writes to address zero.
  if (max == 0) {
    max += 4;
  }
  // The stack grow downwards towards _emscripten_stack_get_end.
  // We write cookies to the final two words in the stack and detect if they are
  // ever overwritten.
  LE_HEAP_STORE_U32(((max) >> 2) * 4, 34821223);
  LE_HEAP_STORE_U32((((max) + (4)) >> 2) * 4, 2310721022);
}

function checkStackCookie() {
  if (ABORT) return;
  var max = _emscripten_stack_get_end();
  // See writeStackCookie().
  if (max == 0) {
    max += 4;
  }
  var cookie1 = LE_HEAP_LOAD_U32(((max) >> 2) * 4);
  var cookie2 = LE_HEAP_LOAD_U32((((max) + (4)) >> 2) * 4);
  if (cookie1 != 34821223 || cookie2 != 2310721022) {
    abort(`Stack overflow! Stack cookie has been overwritten at ${ptrToString(max)}, expected hex dwords 0x89BACDFE and 0x2135467, but received ${ptrToString(cookie2)} ${ptrToString(cookie1)}`);
  }
}

// end include: runtime_stack_check.js
// include: runtime_exceptions.js
// end include: runtime_exceptions.js
// include: runtime_debug.js
// Endianness check
if (Module["ENVIRONMENT"]) {
  throw new Error("Module.ENVIRONMENT has been deprecated. To force the environment, use the ENVIRONMENT compile-time option (for example, -sENVIRONMENT=web or -sENVIRONMENT=node)");
}

function legacyModuleProp(prop, newName, incoming = true) {
  if (!Object.getOwnPropertyDescriptor(Module, prop)) {
    Object.defineProperty(Module, prop, {
      configurable: true,
      get() {
        let extra = incoming ? " (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)" : "";
        abort(`\`Module.${prop}\` has been replaced by \`${newName}\`` + extra);
      }
    });
  }
}

function consumedModuleProp(prop) {
  if (!Object.getOwnPropertyDescriptor(Module, prop)) {
    Object.defineProperty(Module, prop, {
      configurable: true,
      set() {
        abort(`Attempt to set \`Module.${prop}\` after it has already been processed.  This can happen, for example, when code is injected via '--post-js' rather than '--pre-js'`);
      }
    });
  }
}

function ignoredModuleProp(prop) {
  if (Object.getOwnPropertyDescriptor(Module, prop)) {
    abort(`\`Module.${prop}\` was supplied but \`${prop}\` not included in INCOMING_MODULE_JS_API`);
  }
}

// forcing the filesystem exports a few things by default
function isExportedByForceFilesystem(name) {
  return name === "FS_createPath" || name === "FS_createDataFile" || name === "FS_createPreloadedFile" || name === "FS_unlink" || name === "addRunDependency" || // The old FS has some functionality that WasmFS lacks.
  name === "FS_createLazyFile" || name === "FS_createDevice" || name === "removeRunDependency";
}

/**
 * Intercept access to a global symbol.  This enables us to give informative
 * warnings/errors when folks attempt to use symbols they did not include in
 * their build, or no symbols that no longer exist.
 */ function hookGlobalSymbolAccess(sym, func) {}

function missingGlobal(sym, msg) {
  hookGlobalSymbolAccess(sym, () => {
    warnOnce(`\`${sym}\` is not longer defined by emscripten. ${msg}`);
  });
}

missingGlobal("buffer", "Please use HEAP8.buffer or wasmMemory.buffer");

missingGlobal("asm", "Please use wasmExports instead");

function missingLibrarySymbol(sym) {
  hookGlobalSymbolAccess(sym, () => {
    // Can't `abort()` here because it would break code that does runtime
    // checks.  e.g. `if (typeof SDL === 'undefined')`.
    var msg = `\`${sym}\` is a library symbol and not included by default; add it to your library.js __deps or to DEFAULT_LIBRARY_FUNCS_TO_INCLUDE on the command line`;
    // DEFAULT_LIBRARY_FUNCS_TO_INCLUDE requires the name as it appears in
    // library.js, which means $name for a JS name with no prefix, or name
    // for a JS name like _name.
    var librarySymbol = sym;
    if (!librarySymbol.startsWith("_")) {
      librarySymbol = "$" + sym;
    }
    msg += ` (e.g. -sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE='${librarySymbol}')`;
    if (isExportedByForceFilesystem(sym)) {
      msg += ". Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you";
    }
    warnOnce(msg);
  });
  // Any symbol that is not included from the JS library is also (by definition)
  // not exported on the Module object.
  unexportedRuntimeSymbol(sym);
}

function unexportedRuntimeSymbol(sym) {
  if (!Object.getOwnPropertyDescriptor(Module, sym)) {
    Object.defineProperty(Module, sym, {
      configurable: true,
      get() {
        var msg = `'${sym}' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the Emscripten FAQ)`;
        if (isExportedByForceFilesystem(sym)) {
          msg += ". Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you";
        }
        abort(msg);
      }
    });
  }
}

// Used by XXXXX_DEBUG settings to output debug messages.
function dbg(...args) {
  // TODO(sbc): Make this configurable somehow.  Its not always convenient for
  // logging to show up as warnings.
  console.warn(...args);
}

// end include: runtime_debug.js
// include: memoryprofiler.js
// end include: memoryprofiler.js
// include: runtime_safe_heap.js
/** @param {number|boolean=} isFloat */ function getSafeHeapType(bytes, isFloat) {
  switch (bytes) {
   case 1:
    return "i8";

   case 2:
    return "i16";

   case 4:
    return isFloat ? "float" : "i32";

   case 8:
    return isFloat ? "double" : "i64";

   default:
    abort(`getSafeHeapType() invalid bytes=${bytes}`);
  }
}

/** @param {number|boolean=} isFloat */ function SAFE_HEAP_STORE(dest, value, bytes, isFloat) {
  if (dest <= 0) abort(`segmentation fault storing ${bytes} bytes to address ${dest}`);
  if (dest % bytes !== 0) abort(`alignment error storing to address ${dest}, which was expected to be aligned to a multiple of ${bytes}`);
  if (runtimeInitialized) {
    var brk = _sbrk(0);
    if (dest + bytes > brk) abort(`segmentation fault, exceeded the top of the available dynamic heap when storing ${bytes} bytes to address ${dest}. DYNAMICTOP=${brk}`);
    if (brk < _emscripten_stack_get_base()) abort(`brk >= _emscripten_stack_get_base() (brk=${brk}, _emscripten_stack_get_base()=${_emscripten_stack_get_base()})`);
    // sbrk-managed memory must be above the stack
    if (brk > wasmMemory.buffer.byteLength) abort(`brk <= wasmMemory.buffer.byteLength (brk=${brk}, wasmMemory.buffer.byteLength=${wasmMemory.buffer.byteLength})`);
  }
  setValue_safe(dest, value, getSafeHeapType(bytes, isFloat));
  return value;
}

function SAFE_HEAP_STORE_D(dest, value, bytes) {
  return SAFE_HEAP_STORE(dest, value, bytes, true);
}

/** @param {number|boolean=} isFloat */ function SAFE_HEAP_LOAD(dest, bytes, unsigned, isFloat) {
  if (dest <= 0) abort(`segmentation fault loading ${bytes} bytes from address ${dest}`);
  if (dest % bytes !== 0) abort(`alignment error loading from address ${dest}, which was expected to be aligned to a multiple of ${bytes}`);
  if (runtimeInitialized) {
    var brk = _sbrk(0);
    if (dest + bytes > brk) abort(`segmentation fault, exceeded the top of the available dynamic heap when loading ${bytes} bytes from address ${dest}. DYNAMICTOP=${brk}`);
    if (brk < _emscripten_stack_get_base()) abort(`brk >= _emscripten_stack_get_base() (brk=${brk}, _emscripten_stack_get_base()=${_emscripten_stack_get_base()})`);
    // sbrk-managed memory must be above the stack
    if (brk > wasmMemory.buffer.byteLength) abort(`brk <= wasmMemory.buffer.byteLength (brk=${brk}, wasmMemory.buffer.byteLength=${wasmMemory.buffer.byteLength})`);
  }
  var type = getSafeHeapType(bytes, isFloat);
  var ret = getValue_safe(dest, type);
  if (unsigned) ret = unSign(ret, parseInt(type.slice(1), 10));
  return ret;
}

function SAFE_HEAP_LOAD_D(dest, bytes, unsigned) {
  return SAFE_HEAP_LOAD(dest, bytes, unsigned, true);
}

function SAFE_FT_MASK(value, mask) {
  var ret = value & mask;
  if (ret !== value) {
    abort(`Function table mask error: function pointer is ${value} which is masked by ${mask}, the likely cause of this is that the function pointer is being called by the wrong type.`);
  }
  return ret;
}

function segfault() {
  abort("segmentation fault");
}

function alignfault() {
  abort("alignment fault");
}

// end include: runtime_safe_heap.js
function updateMemoryViews() {
  var b = wasmMemory.buffer;
  Module["HEAP_DATA_VIEW"] = HEAP_DATA_VIEW = new DataView(b);
  Module["HEAP8"] = HEAP8 = new Int8Array(b);
  Module["HEAP16"] = HEAP16 = new Int16Array(b);
  Module["HEAPU8"] = HEAPU8 = new Uint8Array(b);
  Module["HEAPU16"] = HEAPU16 = new Uint16Array(b);
  Module["HEAP32"] = HEAP32 = new Int32Array(b);
  Module["HEAPU32"] = HEAPU32 = new Uint32Array(b);
  Module["HEAPF32"] = HEAPF32 = new Float32Array(b);
  Module["HEAPF64"] = HEAPF64 = new Float64Array(b);
  Module["HEAP64"] = HEAP64 = new BigInt64Array(b);
  Module["HEAPU64"] = HEAPU64 = new BigUint64Array(b);
}

// end include: runtime_shared.js
assert(!Module["STACK_SIZE"], "STACK_SIZE can no longer be set at runtime.  Use -sSTACK_SIZE at link time");

assert(typeof Int32Array != "undefined" && typeof Float64Array !== "undefined" && Int32Array.prototype.subarray != undefined && Int32Array.prototype.set != undefined, "JS engine does not provide full typed array support");

// In non-standalone/normal mode, we create the memory here.
// include: runtime_init_memory.js
// Create the wasm memory. (Note: this only applies if IMPORTED_MEMORY is defined)
// check for full engine support (use string 'subarray' to avoid closure compiler confusion)
if (Module["wasmMemory"]) {
  wasmMemory = Module["wasmMemory"];
} else {
  var INITIAL_MEMORY = Module["INITIAL_MEMORY"] || 33554432;
  legacyModuleProp("INITIAL_MEMORY", "INITIAL_MEMORY");
  assert(INITIAL_MEMORY >= 65536, "INITIAL_MEMORY should be larger than STACK_SIZE, was " + INITIAL_MEMORY + "! (STACK_SIZE=" + 65536 + ")");
  /** @suppress {checkTypes} */ wasmMemory = new WebAssembly.Memory({
    "initial": INITIAL_MEMORY / 65536,
    // In theory we should not need to emit the maximum if we want "unlimited"
    // or 4GB of memory, but VMs error on that atm, see
    // https://github.com/emscripten-core/emscripten/issues/14130
    // And in the pthreads case we definitely need to emit a maximum. So
    // always emit one.
    "maximum": 32768
  });
}

updateMemoryViews();

// end include: runtime_init_memory.js
var __RELOC_FUNCS__ = [];

function preRun() {
  if (Module["preRun"]) {
    if (typeof Module["preRun"] == "function") Module["preRun"] = [ Module["preRun"] ];
    while (Module["preRun"].length) {
      addOnPreRun(Module["preRun"].shift());
    }
  }
  consumedModuleProp("preRun");
  callRuntimeCallbacks(onPreRuns);
}

function initRuntime() {
  assert(!runtimeInitialized);
  runtimeInitialized = true;
  checkStackCookie();
  callRuntimeCallbacks(__RELOC_FUNCS__);
  wasmExports["__wasm_call_ctors"]();
  callRuntimeCallbacks(onPostCtors);
}

function preMain() {
  checkStackCookie();
}

function postRun() {
  checkStackCookie();
  if (Module["postRun"]) {
    if (typeof Module["postRun"] == "function") Module["postRun"] = [ Module["postRun"] ];
    while (Module["postRun"].length) {
      addOnPostRun(Module["postRun"].shift());
    }
  }
  consumedModuleProp("postRun");
  callRuntimeCallbacks(onPostRuns);
}

// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// Module.preRun (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;

var dependenciesFulfilled = null;

// overridden to take different actions when all run dependencies are fulfilled
var runDependencyTracking = {};

var runDependencyWatcher = null;

function getUniqueRunDependency(id) {
  var orig = id;
  while (1) {
    if (!runDependencyTracking[id]) return id;
    id = orig + Math.random();
  }
}

function addRunDependency(id) {
  runDependencies++;
  Module["monitorRunDependencies"]?.(runDependencies);
  if (id) {
    assert(!runDependencyTracking[id]);
    runDependencyTracking[id] = 1;
    if (runDependencyWatcher === null && typeof setInterval != "undefined") {
      // Check for missing dependencies every few seconds
      runDependencyWatcher = setInterval(() => {
        if (ABORT) {
          clearInterval(runDependencyWatcher);
          runDependencyWatcher = null;
          return;
        }
        var shown = false;
        for (var dep in runDependencyTracking) {
          if (!shown) {
            shown = true;
            err("still waiting on run dependencies:");
          }
          err(`dependency: ${dep}`);
        }
        if (shown) {
          err("(end of list)");
        }
      }, 1e4);
    }
  } else {
    err("warning: run dependency added without ID");
  }
}

function removeRunDependency(id) {
  runDependencies--;
  Module["monitorRunDependencies"]?.(runDependencies);
  if (id) {
    assert(runDependencyTracking[id]);
    delete runDependencyTracking[id];
  } else {
    err("warning: run dependency removed without ID");
  }
  if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
      clearInterval(runDependencyWatcher);
      runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback();
    }
  }
}

/** @param {string|number=} what */ function abort(what) {
  Module["onAbort"]?.(what);
  what = "Aborted(" + what + ")";
  // TODO(sbc): Should we remove printing and leave it up to whoever
  // catches the exception?
  err(what);
  ABORT = true;
  // Use a wasm runtime error, because a JS error might be seen as a foreign
  // exception, which means we'd run destructors on it. We need the error to
  // simply make the program stop.
  // FIXME This approach does not work in Wasm EH because it currently does not assume
  // all RuntimeErrors are from traps; it decides whether a RuntimeError is from
  // a trap or not based on a hidden field within the object. So at the moment
  // we don't have a way of throwing a wasm trap from JS. TODO Make a JS API that
  // allows this in the wasm spec.
  // Suppress closure compiler warning here. Closure compiler's builtin extern
  // definition for WebAssembly.RuntimeError claims it takes no arguments even
  // though it can.
  // TODO(https://github.com/google/closure-compiler/pull/3913): Remove if/when upstream closure gets fixed.
  /** @suppress {checkTypes} */ var e = new WebAssembly.RuntimeError(what);
  readyPromiseReject(e);
  // Throw the error whether or not MODULARIZE is set because abort is used
  // in code paths apart from instantiation where an exception is expected
  // to be thrown when abort is called.
  throw e;
}

// show errors on likely calls to FS when it was not included
var FS = {
  error() {
    abort("Filesystem support (FS) was not included. The problem is that you are using files from JS, but files were not used from C/C++, so filesystem support was not auto-included. You can force-include filesystem support with -sFORCE_FILESYSTEM");
  },
  init() {
    FS.error();
  },
  createDataFile() {
    FS.error();
  },
  createPreloadedFile() {
    FS.error();
  },
  createLazyFile() {
    FS.error();
  },
  open() {
    FS.error();
  },
  mkdev() {
    FS.error();
  },
  registerDevice() {
    FS.error();
  },
  analyzePath() {
    FS.error();
  },
  ErrnoError() {
    FS.error();
  }
};

Module["FS_createDataFile"] = FS.createDataFile;

Module["FS_createPreloadedFile"] = FS.createPreloadedFile;

function createExportWrapper(name, nargs) {
  return (...args) => {
    assert(runtimeInitialized, `native function \`${name}\` called before runtime initialization`);
    var f = wasmExports[name];
    assert(f, `exported native function \`${name}\` not found`);
    // Only assert for too many arguments. Too few can be valid since the missing arguments will be zero filled.
    assert(args.length <= nargs, `native function \`${name}\` called with ${args.length} args but expects ${nargs}`);
    return f(...args);
  };
}

var wasmBinaryFile;

function findWasmBinary() {
  return locateFile("tree-sitter.wasm");
}

function getBinarySync(file) {
  if (file == wasmBinaryFile && wasmBinary) {
    return new Uint8Array(wasmBinary);
  }
  if (readBinary) {
    return readBinary(file);
  }
  throw "both async and sync fetching of the wasm failed";
}

async function getWasmBinary(binaryFile) {
  // If we don't have the binary yet, load it asynchronously using readAsync.
  if (!wasmBinary) {
    // Fetch the binary using readAsync
    try {
      var response = await readAsync(binaryFile);
      return new Uint8Array(response);
    } catch {}
  }
  // Otherwise, getBinarySync should be able to get it synchronously
  return getBinarySync(binaryFile);
}

async function instantiateArrayBuffer(binaryFile, imports) {
  try {
    var binary = await getWasmBinary(binaryFile);
    var instance = await WebAssembly.instantiate(binary, imports);
    return instance;
  } catch (reason) {
    err(`failed to asynchronously prepare wasm: ${reason}`);
    // Warn on some common problems.
    if (isFileURI(wasmBinaryFile)) {
      err(`warning: Loading from a file URI (${wasmBinaryFile}) is not supported in most browsers. See https://emscripten.org/docs/getting_started/FAQ.html#how-do-i-run-a-local-webserver-for-testing-why-does-my-program-stall-in-downloading-or-preparing`);
    }
    abort(reason);
  }
}

async function instantiateAsync(binary, binaryFile, imports) {
  if (!binary && typeof WebAssembly.instantiateStreaming == "function" && !isFileURI(binaryFile) && !ENVIRONMENT_IS_NODE) {
    try {
      var response = fetch(binaryFile, {
        credentials: "same-origin"
      });
      var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
      return instantiationResult;
    } catch (reason) {
      // We expect the most common failure cause to be a bad MIME type for the binary,
      // in which case falling back to ArrayBuffer instantiation should work.
      err(`wasm streaming compile failed: ${reason}`);
      err("falling back to ArrayBuffer instantiation");
    }
  }
  return instantiateArrayBuffer(binaryFile, imports);
}

function getWasmImports() {
  // prepare imports
  return {
    "env": wasmImports,
    "wasi_snapshot_preview1": wasmImports,
    "GOT.mem": new Proxy(wasmImports, GOTHandler),
    "GOT.func": new Proxy(wasmImports, GOTHandler)
  };
}

// Create the wasm instance.
// Receives the wasm imports, returns the exports.
async function createWasm() {
  // Load the wasm module and create an instance of using native support in the JS engine.
  // handle a generated wasm instance, receiving its exports and
  // performing other necessary setup
  /** @param {WebAssembly.Module=} module*/ function receiveInstance(instance, module) {
    wasmExports = instance.exports;
    wasmExports = relocateExports(wasmExports, 1024);
    var metadata = getDylinkMetadata(module);
    if (metadata.neededDynlibs) {
      dynamicLibraries = metadata.neededDynlibs.concat(dynamicLibraries);
    }
    mergeLibSymbols(wasmExports, "main");
    LDSO.init();
    loadDylibs();
    __RELOC_FUNCS__.push(wasmExports["__wasm_apply_data_relocs"]);
    removeRunDependency("wasm-instantiate");
    return wasmExports;
  }
  // wait for the pthread pool (if any)
  addRunDependency("wasm-instantiate");
  // Prefer streaming instantiation if available.
  // Async compilation can be confusing when an error on the page overwrites Module
  // (for example, if the order of elements is wrong, and the one defining Module is
  // later), so we save Module and check it later.
  var trueModule = Module;
  function receiveInstantiationResult(result) {
    // 'result' is a ResultObject object which has both the module and instance.
    // receiveInstance() will swap in the exports (to Module.asm) so they can be called
    assert(Module === trueModule, "the Module object should not be replaced during async compilation - perhaps the order of HTML elements is wrong?");
    trueModule = null;
    return receiveInstance(result["instance"], result["module"]);
  }
  var info = getWasmImports();
  // User shell pages can write their own Module.instantiateWasm = function(imports, successCallback) callback
  // to manually instantiate the Wasm module themselves. This allows pages to
  // run the instantiation parallel to any other async startup actions they are
  // performing.
  // Also pthreads and wasm workers initialize the wasm instance through this
  // path.
  if (Module["instantiateWasm"]) {
    return new Promise((resolve, reject) => {
      try {
        Module["instantiateWasm"](info, (mod, inst) => {
          receiveInstance(mod, inst);
          resolve(mod.exports);
        });
      } catch (e) {
        err(`Module.instantiateWasm callback failed with error: ${e}`);
        reject(e);
      }
    });
  }
  wasmBinaryFile ??= findWasmBinary();
  try {
    var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
    var exports = receiveInstantiationResult(result);
    return exports;
  } catch (e) {
    // If instantiation fails, reject the module ready promise.
    readyPromiseReject(e);
    return Promise.reject(e);
  }
}

// === Body ===
var ASM_CONSTS = {};

// end include: preamble.js
class ExitStatus {
  name="ExitStatus";
  constructor(status) {
    this.message = `Program terminated with exit(${status})`;
    this.status = status;
  }
}

var GOT = {};

var currentModuleWeakSymbols = new Set([]);

var GOTHandler = {
  get(obj, symName) {
    var rtn = GOT[symName];
    if (!rtn) {
      rtn = GOT[symName] = new WebAssembly.Global({
        "value": "i32",
        "mutable": true
      });
    }
    if (!currentModuleWeakSymbols.has(symName)) {
      // Any non-weak reference to a symbol marks it as `required`, which
      // enabled `reportUndefinedSymbols` to report undefined symbol errors
      // correctly.
      rtn.required = true;
    }
    return rtn;
  }
};

var LE_HEAP_LOAD_F32 = byteOffset => HEAP_DATA_VIEW.getFloat32(byteOffset, true);

var LE_HEAP_LOAD_F64 = byteOffset => HEAP_DATA_VIEW.getFloat64(byteOffset, true);

var LE_HEAP_LOAD_I16 = byteOffset => HEAP_DATA_VIEW.getInt16(byteOffset, true);

var LE_HEAP_LOAD_I32 = byteOffset => HEAP_DATA_VIEW.getInt32(byteOffset, true);

var LE_HEAP_LOAD_U16 = byteOffset => HEAP_DATA_VIEW.getUint16(byteOffset, true);

var LE_HEAP_LOAD_U32 = byteOffset => HEAP_DATA_VIEW.getUint32(byteOffset, true);

var LE_HEAP_STORE_F32 = (byteOffset, value) => HEAP_DATA_VIEW.setFloat32(byteOffset, value, true);

var LE_HEAP_STORE_F64 = (byteOffset, value) => HEAP_DATA_VIEW.setFloat64(byteOffset, value, true);

var LE_HEAP_STORE_I16 = (byteOffset, value) => HEAP_DATA_VIEW.setInt16(byteOffset, value, true);

var LE_HEAP_STORE_I32 = (byteOffset, value) => HEAP_DATA_VIEW.setInt32(byteOffset, value, true);

var LE_HEAP_STORE_U16 = (byteOffset, value) => HEAP_DATA_VIEW.setUint16(byteOffset, value, true);

var LE_HEAP_STORE_U32 = (byteOffset, value) => HEAP_DATA_VIEW.setUint32(byteOffset, value, true);

var callRuntimeCallbacks = callbacks => {
  while (callbacks.length > 0) {
    // Pass the module as the first argument.
    callbacks.shift()(Module);
  }
};

var onPostRuns = [];

var addOnPostRun = cb => onPostRuns.unshift(cb);

var onPreRuns = [];

var addOnPreRun = cb => onPreRuns.unshift(cb);

var UTF8Decoder = typeof TextDecoder != "undefined" ? new TextDecoder : undefined;

/**
     * Given a pointer 'idx' to a null-terminated UTF8-encoded string in the given
     * array that contains uint8 values, returns a copy of that string as a
     * Javascript String object.
     * heapOrArray is either a regular array, or a JavaScript typed array view.
     * @param {number=} idx
     * @param {number=} maxBytesToRead
     * @return {string}
     */ var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead = NaN) => {
  var endIdx = idx + maxBytesToRead;
  var endPtr = idx;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on
  // null terminator by itself.  Also, use the length info to avoid running tiny
  // strings through TextDecoder, since .subarray() allocates garbage.
  // (As a tiny code save trick, compare endPtr against endIdx using a negation,
  // so that undefined/NaN means Infinity)
  while (heapOrArray[endPtr] && !(endPtr >= endIdx)) ++endPtr;
  if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
    return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
  }
  var str = "";
  // If building with TextDecoder, we have already computed the string length
  // above, so test loop end condition against that
  while (idx < endPtr) {
    // For UTF8 byte structure, see:
    // http://en.wikipedia.org/wiki/UTF-8#Description
    // https://www.ietf.org/rfc/rfc2279.txt
    // https://tools.ietf.org/html/rfc3629
    var u0 = heapOrArray[idx++];
    if (!(u0 & 128)) {
      str += String.fromCharCode(u0);
      continue;
    }
    var u1 = heapOrArray[idx++] & 63;
    if ((u0 & 224) == 192) {
      str += String.fromCharCode(((u0 & 31) << 6) | u1);
      continue;
    }
    var u2 = heapOrArray[idx++] & 63;
    if ((u0 & 240) == 224) {
      u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
    } else {
      if ((u0 & 248) != 240) warnOnce("Invalid UTF-8 leading byte " + ptrToString(u0) + " encountered when deserializing a UTF-8 string in wasm memory to a JS string!");
      u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (heapOrArray[idx++] & 63);
    }
    if (u0 < 65536) {
      str += String.fromCharCode(u0);
    } else {
      var ch = u0 - 65536;
      str += String.fromCharCode(55296 | (ch >> 10), 56320 | (ch & 1023));
    }
  }
  return str;
};

var getDylinkMetadata = binary => {
  var offset = 0;
  var end = 0;
  function getU8() {
    return binary[offset++];
  }
  function getLEB() {
    var ret = 0;
    var mul = 1;
    while (1) {
      var byte = binary[offset++];
      ret += ((byte & 127) * mul);
      mul *= 128;
      if (!(byte & 128)) break;
    }
    return ret;
  }
  function getString() {
    var len = getLEB();
    offset += len;
    return UTF8ArrayToString(binary, offset - len, len);
  }
  /** @param {string=} message */ function failIf(condition, message) {
    if (condition) throw new Error(message);
  }
  var name = "dylink.0";
  if (binary instanceof WebAssembly.Module) {
    var dylinkSection = WebAssembly.Module.customSections(binary, name);
    if (dylinkSection.length === 0) {
      name = "dylink";
      dylinkSection = WebAssembly.Module.customSections(binary, name);
    }
    failIf(dylinkSection.length === 0, "need dylink section");
    binary = new Uint8Array(dylinkSection[0]);
    end = binary.length;
  } else {
    var int32View = new Uint32Array(new Uint8Array(binary.subarray(0, 24)).buffer);
    var magicNumberFound = int32View[0] == 1836278016 || int32View[0] == 6386541;
    failIf(!magicNumberFound, "need to see wasm magic number");
    // \0asm
    // we should see the dylink custom section right after the magic number and wasm version
    failIf(binary[8] !== 0, "need the dylink section to be first");
    offset = 9;
    var section_size = getLEB();
    //section size
    end = offset + section_size;
    name = getString();
  }
  var customSection = {
    neededDynlibs: [],
    tlsExports: new Set,
    weakImports: new Set
  };
  if (name == "dylink") {
    customSection.memorySize = getLEB();
    customSection.memoryAlign = getLEB();
    customSection.tableSize = getLEB();
    customSection.tableAlign = getLEB();
    // shared libraries this module needs. We need to load them first, so that
    // current module could resolve its imports. (see tools/shared.py
    // WebAssembly.make_shared_library() for "dylink" section extension format)
    var neededDynlibsCount = getLEB();
    for (var i = 0; i < neededDynlibsCount; ++i) {
      var libname = getString();
      customSection.neededDynlibs.push(libname);
    }
  } else {
    failIf(name !== "dylink.0");
    var WASM_DYLINK_MEM_INFO = 1;
    var WASM_DYLINK_NEEDED = 2;
    var WASM_DYLINK_EXPORT_INFO = 3;
    var WASM_DYLINK_IMPORT_INFO = 4;
    var WASM_SYMBOL_TLS = 256;
    var WASM_SYMBOL_BINDING_MASK = 3;
    var WASM_SYMBOL_BINDING_WEAK = 1;
    while (offset < end) {
      var subsectionType = getU8();
      var subsectionSize = getLEB();
      if (subsectionType === WASM_DYLINK_MEM_INFO) {
        customSection.memorySize = getLEB();
        customSection.memoryAlign = getLEB();
        customSection.tableSize = getLEB();
        customSection.tableAlign = getLEB();
      } else if (subsectionType === WASM_DYLINK_NEEDED) {
        var neededDynlibsCount = getLEB();
        for (var i = 0; i < neededDynlibsCount; ++i) {
          libname = getString();
          customSection.neededDynlibs.push(libname);
        }
      } else if (subsectionType === WASM_DYLINK_EXPORT_INFO) {
        var count = getLEB();
        while (count--) {
          var symname = getString();
          var flags = getLEB();
          if (flags & WASM_SYMBOL_TLS) {
            customSection.tlsExports.add(symname);
          }
        }
      } else if (subsectionType === WASM_DYLINK_IMPORT_INFO) {
        var count = getLEB();
        while (count--) {
          var modname = getString();
          var symname = getString();
          var flags = getLEB();
          if ((flags & WASM_SYMBOL_BINDING_MASK) == WASM_SYMBOL_BINDING_WEAK) {
            customSection.weakImports.add(symname);
          }
        }
      } else {
        err(`unknown dylink.0 subsection: ${subsectionType}`);
        // unknown subsection
        offset += subsectionSize;
      }
    }
  }
  var tableAlign = Math.pow(2, customSection.tableAlign);
  assert(tableAlign === 1, `invalid tableAlign ${tableAlign}`);
  assert(offset == end);
  return customSection;
};

/**
     * @param {number} ptr
     * @param {string} type
     */ function getValue(ptr, type = "i8") {
  if (type.endsWith("*")) type = "*";
  switch (type) {
   case "i1":
    return SAFE_HEAP_LOAD(ptr, 1, 0);

   case "i8":
    return SAFE_HEAP_LOAD(ptr, 1, 0);

   case "i16":
    return LE_HEAP_LOAD_I16(((ptr) >> 1) * 2);

   case "i32":
    return LE_HEAP_LOAD_I32(((ptr) >> 2) * 4);

   case "i64":
    return HEAP64[((ptr) >> 3)];

   case "float":
    return LE_HEAP_LOAD_F32(((ptr) >> 2) * 4);

   case "double":
    return LE_HEAP_LOAD_F64(((ptr) >> 3) * 8);

   case "*":
    return LE_HEAP_LOAD_U32(((ptr) >> 2) * 4);

   default:
    abort(`invalid type for getValue: ${type}`);
  }
}

function getValue_safe(ptr, type = "i8") {
  if (type.endsWith("*")) type = "*";
  switch (type) {
   case "i1":
    return HEAP8[ptr];

   case "i8":
    return HEAP8[ptr];

   case "i16":
    return LE_HEAP_LOAD_I16(((ptr) >> 1) * 2);

   case "i32":
    return LE_HEAP_LOAD_I32(((ptr) >> 2) * 4);

   case "i64":
    return HEAP64[((ptr) >> 3)];

   case "float":
    return LE_HEAP_LOAD_F32(((ptr) >> 2) * 4);

   case "double":
    return LE_HEAP_LOAD_F64(((ptr) >> 3) * 8);

   case "*":
    return LE_HEAP_LOAD_U32(((ptr) >> 2) * 4);

   default:
    abort(`invalid type for getValue: ${type}`);
  }
}

var newDSO = (name, handle, syms) => {
  var dso = {
    refcount: Infinity,
    name,
    exports: syms,
    global: true
  };
  LDSO.loadedLibsByName[name] = dso;
  if (handle != undefined) {
    LDSO.loadedLibsByHandle[handle] = dso;
  }
  return dso;
};

var LDSO = {
  loadedLibsByName: {},
  loadedLibsByHandle: {},
  init() {
    // This function needs to run after the initial wasmImports object
    // as been created.
    assert(wasmImports);
    newDSO("__main__", 0, wasmImports);
  }
};

var ___heap_base = 78208;

var alignMemory = (size, alignment) => {
  assert(alignment, "alignment argument is required");
  return Math.ceil(size / alignment) * alignment;
};

var getMemory = size => {
  // After the runtime is initialized, we must only use sbrk() normally.
  if (runtimeInitialized) {
    // Currently we don't support freeing of static data when modules are
    // unloaded via dlclose.  This function is tagged as `noleakcheck` to
    // avoid having this reported as leak.
    return _calloc(size, 1);
  }
  var ret = ___heap_base;
  // Keep __heap_base stack aligned.
  var end = ret + alignMemory(size, 16);
  assert(end <= HEAP8.length, "failure to getMemory - memory growth etc. is not supported there, call malloc/sbrk directly or increase INITIAL_MEMORY");
  ___heap_base = end;
  GOT["__heap_base"].value = end;
  return ret;
};

var isInternalSym = symName => [ "__cpp_exception", "__c_longjmp", "__wasm_apply_data_relocs", "__dso_handle", "__tls_size", "__tls_align", "__set_stack_limits", "_emscripten_tls_init", "__wasm_init_tls", "__wasm_call_ctors", "__start_em_asm", "__stop_em_asm", "__start_em_js", "__stop_em_js" ].includes(symName) || symName.startsWith("__em_js__");

var uleb128Encode = (n, target) => {
  assert(n < 16384);
  if (n < 128) {
    target.push(n);
  } else {
    target.push((n % 128) | 128, n >> 7);
  }
};

var sigToWasmTypes = sig => {
  var typeNames = {
    "i": "i32",
    "j": "i64",
    "f": "f32",
    "d": "f64",
    "e": "externref",
    "p": "i32"
  };
  var type = {
    parameters: [],
    results: sig[0] == "v" ? [] : [ typeNames[sig[0]] ]
  };
  for (var i = 1; i < sig.length; ++i) {
    assert(sig[i] in typeNames, "invalid signature char: " + sig[i]);
    type.parameters.push(typeNames[sig[i]]);
  }
  return type;
};

var generateFuncType = (sig, target) => {
  var sigRet = sig.slice(0, 1);
  var sigParam = sig.slice(1);
  var typeCodes = {
    "i": 127,
    // i32
    "p": 127,
    // i32
    "j": 126,
    // i64
    "f": 125,
    // f32
    "d": 124,
    // f64
    "e": 111
  };
  // Parameters, length + signatures
  target.push(96);
  uleb128Encode(sigParam.length, target);
  for (var i = 0; i < sigParam.length; ++i) {
    assert(sigParam[i] in typeCodes, "invalid signature char: " + sigParam[i]);
    target.push(typeCodes[sigParam[i]]);
  }
  // Return values, length + signatures
  // With no multi-return in MVP, either 0 (void) or 1 (anything else)
  if (sigRet == "v") {
    target.push(0);
  } else {
    target.push(1, typeCodes[sigRet]);
  }
};

var convertJsFunctionToWasm = (func, sig) => {
  // If the type reflection proposal is available, use the new
  // "WebAssembly.Function" constructor.
  // Otherwise, construct a minimal wasm module importing the JS function and
  // re-exporting it.
  if (typeof WebAssembly.Function == "function") {
    return new WebAssembly.Function(sigToWasmTypes(sig), func);
  }
  // The module is static, with the exception of the type section, which is
  // generated based on the signature passed in.
  var typeSectionBody = [ 1 ];
  generateFuncType(sig, typeSectionBody);
  // Rest of the module is static
  var bytes = [ 0, 97, 115, 109, // magic ("\0asm")
  1, 0, 0, 0, // version: 1
  1 ];
  // Write the overall length of the type section followed by the body
  uleb128Encode(typeSectionBody.length, bytes);
  bytes.push(...typeSectionBody);
  // The rest of the module is static
  bytes.push(2, 7, // import section
  // (import "e" "f" (func 0 (type 0)))
  1, 1, 101, 1, 102, 0, 0, 7, 5, // export section
  // (export "f" (func 0 (type 0)))
  1, 1, 102, 0, 0);
  // We can compile this wasm module synchronously because it is very small.
  // This accepts an import (at "e.f"), that it reroutes to an export (at "f")
  var module = new WebAssembly.Module(new Uint8Array(bytes));
  var instance = new WebAssembly.Instance(module, {
    "e": {
      "f": func
    }
  });
  var wrappedFunc = instance.exports["f"];
  return wrappedFunc;
};

var wasmTableMirror = [];

/** @type {WebAssembly.Table} */ var wasmTable = new WebAssembly.Table({
  "initial": 31,
  "element": "anyfunc"
});

var getWasmTableEntry = funcPtr => {
  var func = wasmTableMirror[funcPtr];
  if (!func) {
    if (funcPtr >= wasmTableMirror.length) wasmTableMirror.length = funcPtr + 1;
    /** @suppress {checkTypes} */ wasmTableMirror[funcPtr] = func = wasmTable.get(funcPtr);
  }
  /** @suppress {checkTypes} */ assert(wasmTable.get(funcPtr) == func, "JavaScript-side Wasm function table mirror is out of date!");
  return func;
};

var updateTableMap = (offset, count) => {
  if (functionsInTableMap) {
    for (var i = offset; i < offset + count; i++) {
      var item = getWasmTableEntry(i);
      // Ignore null values.
      if (item) {
        functionsInTableMap.set(item, i);
      }
    }
  }
};

var functionsInTableMap;

var getFunctionAddress = func => {
  // First, create the map if this is the first use.
  if (!functionsInTableMap) {
    functionsInTableMap = new WeakMap;
    updateTableMap(0, wasmTable.length);
  }
  return functionsInTableMap.get(func) || 0;
};

var freeTableIndexes = [];

var getEmptyTableSlot = () => {
  // Reuse a free index if there is one, otherwise grow.
  if (freeTableIndexes.length) {
    return freeTableIndexes.pop();
  }
  // Grow the table
  try {
    /** @suppress {checkTypes} */ wasmTable.grow(1);
  } catch (err) {
    if (!(err instanceof RangeError)) {
      throw err;
    }
    throw "Unable to grow wasm table. Set ALLOW_TABLE_GROWTH.";
  }
  return wasmTable.length - 1;
};

var setWasmTableEntry = (idx, func) => {
  /** @suppress {checkTypes} */ wasmTable.set(idx, func);
  // With ABORT_ON_WASM_EXCEPTIONS wasmTable.get is overridden to return wrapped
  // functions so we need to call it here to retrieve the potential wrapper correctly
  // instead of just storing 'func' directly into wasmTableMirror
  /** @suppress {checkTypes} */ wasmTableMirror[idx] = wasmTable.get(idx);
};

/** @param {string=} sig */ var addFunction = (func, sig) => {
  assert(typeof func != "undefined");
  // Check if the function is already in the table, to ensure each function
  // gets a unique index.
  var rtn = getFunctionAddress(func);
  if (rtn) {
    return rtn;
  }
  // It's not in the table, add it now.
  var ret = getEmptyTableSlot();
  // Set the new value.
  try {
    // Attempting to call this with JS function will cause of table.set() to fail
    setWasmTableEntry(ret, func);
  } catch (err) {
    if (!(err instanceof TypeError)) {
      throw err;
    }
    assert(typeof sig != "undefined", "Missing signature argument to addFunction: " + func);
    var wrapped = convertJsFunctionToWasm(func, sig);
    setWasmTableEntry(ret, wrapped);
  }
  functionsInTableMap.set(func, ret);
  return ret;
};

var updateGOT = (exports, replace) => {
  for (var symName in exports) {
    if (isInternalSym(symName)) {
      continue;
    }
    var value = exports[symName];
    GOT[symName] ||= new WebAssembly.Global({
      "value": "i32",
      "mutable": true
    });
    if (replace || GOT[symName].value == 0) {
      if (typeof value == "function") {
        GOT[symName].value = addFunction(value);
      } else if (typeof value == "number") {
        GOT[symName].value = value;
      } else {
        err(`unhandled export type for '${symName}': ${typeof value}`);
      }
    }
  }
};

/** @param {boolean=} replace */ var relocateExports = (exports, memoryBase, replace) => {
  var relocated = {};
  for (var e in exports) {
    var value = exports[e];
    if (typeof value == "object") {
      // a breaking change in the wasm spec, globals are now objects
      // https://github.com/WebAssembly/mutable-global/issues/1
      value = value.value;
    }
    if (typeof value == "number") {
      value += memoryBase;
    }
    relocated[e] = value;
  }
  updateGOT(relocated, replace);
  return relocated;
};

var isSymbolDefined = symName => {
  // Ignore 'stub' symbols that are auto-generated as part of the original
  // `wasmImports` used to instantiate the main module.
  var existing = wasmImports[symName];
  if (!existing || existing.stub) {
    return false;
  }
  return true;
};

var dynCall = (sig, ptr, args = []) => {
  assert(getWasmTableEntry(ptr), `missing table entry in dynCall: ${ptr}`);
  var rtn = getWasmTableEntry(ptr)(...args);
  return rtn;
};

var stackSave = () => _emscripten_stack_get_current();

var stackRestore = val => __emscripten_stack_restore(val);

var createInvokeFunction = sig => (ptr, ...args) => {
  var sp = stackSave();
  try {
    return dynCall(sig, ptr, args);
  } catch (e) {
    stackRestore(sp);
    // Create a try-catch guard that rethrows the Emscripten EH exception.
    // Exceptions thrown from C++ will be a pointer (number) and longjmp
    // will throw the number Infinity. Use the compact and fast "e !== e+0"
    // test to check if e was not a Number.
    if (e !== e + 0) throw e;
    _setThrew(1, 0);
    // In theory this if statement could be done on
    // creating the function, but I just added this to
    // save wasting code space as it only happens on exception.
    if (sig[0] == "j") return 0n;
  }
};

var resolveGlobalSymbol = (symName, direct = false) => {
  var sym;
  if (isSymbolDefined(symName)) {
    sym = wasmImports[symName];
  } else if (symName.startsWith("invoke_")) {
    // Create (and cache) new invoke_ functions on demand.
    sym = wasmImports[symName] = createInvokeFunction(symName.split("_")[1]);
  }
  return {
    sym,
    name: symName
  };
};

var onPostCtors = [];

var addOnPostCtor = cb => onPostCtors.unshift(cb);

/**
     * Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the
     * emscripten HEAP, returns a copy of that string as a Javascript String object.
     *
     * @param {number} ptr
     * @param {number=} maxBytesToRead - An optional length that specifies the
     *   maximum number of bytes to read. You can omit this parameter to scan the
     *   string until the first 0 byte. If maxBytesToRead is passed, and the string
     *   at [ptr, ptr+maxBytesToReadr[ contains a null byte in the middle, then the
     *   string will cut short at that byte index (i.e. maxBytesToRead will not
     *   produce a string of exact length [ptr, ptr+maxBytesToRead[) N.B. mixing
     *   frequent uses of UTF8ToString() with and without maxBytesToRead may throw
     *   JS JIT optimizations off, so it is worth to consider consistently using one
     * @return {string}
     */ var UTF8ToString = (ptr, maxBytesToRead) => {
  assert(typeof ptr == "number", `UTF8ToString expects a number (got ${typeof ptr})`);
  return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
};

/**
      * @param {string=} libName
      * @param {Object=} localScope
      * @param {number=} handle
      */ var loadWebAssemblyModule = (binary, flags, libName, localScope, handle) => {
  var metadata = getDylinkMetadata(binary);
  currentModuleWeakSymbols = metadata.weakImports;
  var originalTable = wasmTable;
  // loadModule loads the wasm module after all its dependencies have been loaded.
  // can be called both sync/async.
  function loadModule() {
    // alignments are powers of 2
    var memAlign = Math.pow(2, metadata.memoryAlign);
    // prepare memory
    var memoryBase = metadata.memorySize ? alignMemory(getMemory(metadata.memorySize + memAlign), memAlign) : 0;
    // TODO: add to cleanups
    var tableBase = metadata.tableSize ? wasmTable.length : 0;
    if (handle) {
      SAFE_HEAP_STORE((handle) + (8), 1, 1);
      LE_HEAP_STORE_U32((((handle) + (12)) >> 2) * 4, memoryBase);
      LE_HEAP_STORE_I32((((handle) + (16)) >> 2) * 4, metadata.memorySize);
      LE_HEAP_STORE_U32((((handle) + (20)) >> 2) * 4, tableBase);
      LE_HEAP_STORE_I32((((handle) + (24)) >> 2) * 4, metadata.tableSize);
    }
    if (metadata.tableSize) {
      assert(wasmTable.length == tableBase, `unexpected table size while loading ${libName}: ${wasmTable.length}`);
      wasmTable.grow(metadata.tableSize);
    }
    // This is the export map that we ultimately return.  We declare it here
    // so it can be used within resolveSymbol.  We resolve symbols against
    // this local symbol map in the case there they are not present on the
    // global Module object.  We need this fallback because Modules sometime
    // need to import their own symbols
    var moduleExports;
    function resolveSymbol(sym) {
      var resolved = resolveGlobalSymbol(sym).sym;
      if (!resolved && localScope) {
        resolved = localScope[sym];
      }
      if (!resolved) {
        resolved = moduleExports[sym];
      }
      assert(resolved, `undefined symbol '${sym}'. perhaps a side module was not linked in? if this global was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment`);
      return resolved;
    }
    // TODO kill ↓↓↓ (except "symbols local to this module", it will likely be
    // not needed if we require that if A wants symbols from B it has to link
    // to B explicitly: similarly to -Wl,--no-undefined)
    // wasm dynamic libraries are pure wasm, so they cannot assist in
    // their own loading. When side module A wants to import something
    // provided by a side module B that is loaded later, we need to
    // add a layer of indirection, but worse, we can't even tell what
    // to add the indirection for, without inspecting what A's imports
    // are. To do that here, we use a JS proxy (another option would
    // be to inspect the binary directly).
    var proxyHandler = {
      get(stubs, prop) {
        // symbols that should be local to this module
        switch (prop) {
         case "__memory_base":
          return memoryBase;

         case "__table_base":
          return tableBase;
        }
        if (prop in wasmImports && !wasmImports[prop].stub) {
          // No stub needed, symbol already exists in symbol table
          var res = wasmImports[prop];
          return res;
        }
        // Return a stub function that will resolve the symbol
        // when first called.
        if (!(prop in stubs)) {
          var resolved;
          stubs[prop] = (...args) => {
            resolved ||= resolveSymbol(prop);
            return resolved(...args);
          };
        }
        return stubs[prop];
      }
    };
    var proxy = new Proxy({}, proxyHandler);
    var info = {
      "GOT.mem": new Proxy({}, GOTHandler),
      "GOT.func": new Proxy({}, GOTHandler),
      "env": proxy,
      "wasi_snapshot_preview1": proxy
    };
    function postInstantiation(module, instance) {
      // the table should be unchanged
      assert(wasmTable === originalTable);
      // add new entries to functionsInTableMap
      updateTableMap(tableBase, metadata.tableSize);
      moduleExports = relocateExports(instance.exports, memoryBase);
      if (!flags.allowUndefined) {
        reportUndefinedSymbols();
      }
      function addEmAsm(addr, body) {
        var args = [];
        var arity = 0;
        for (;arity < 16; arity++) {
          if (body.indexOf("$" + arity) != -1) {
            args.push("$" + arity);
          } else {
            break;
          }
        }
        args = args.join(",");
        var func = `(${args}) => { ${body} };`;
        ASM_CONSTS[start] = eval(func);
      }
      // Add any EM_ASM function that exist in the side module
      if ("__start_em_asm" in moduleExports) {
        var start = moduleExports["__start_em_asm"];
        var stop = moduleExports["__stop_em_asm"];
        while (start < stop) {
          var jsString = UTF8ToString(start);
          addEmAsm(start, jsString);
          start = HEAPU8.indexOf(0, start) + 1;
        }
      }
      function addEmJs(name, cSig, body) {
        // The signature here is a C signature (e.g. "(int foo, char* bar)").
        // See `create_em_js` in emcc.py` for the build-time version of this
        // code.
        var jsArgs = [];
        cSig = cSig.slice(1, -1);
        if (cSig != "void") {
          cSig = cSig.split(",");
          for (var i in cSig) {
            var jsArg = cSig[i].split(" ").pop();
            jsArgs.push(jsArg.replace("*", ""));
          }
        }
        var func = `(${jsArgs}) => ${body};`;
        moduleExports[name] = eval(func);
      }
      for (var name in moduleExports) {
        if (name.startsWith("__em_js__")) {
          var start = moduleExports[name];
          var jsString = UTF8ToString(start);
          // EM_JS strings are stored in the data section in the form
          // SIG<::>BODY.
          var parts = jsString.split("<::>");
          addEmJs(name.replace("__em_js__", ""), parts[0], parts[1]);
          delete moduleExports[name];
        }
      }
      // initialize the module
      var applyRelocs = moduleExports["__wasm_apply_data_relocs"];
      if (applyRelocs) {
        if (runtimeInitialized) {
          applyRelocs();
        } else {
          __RELOC_FUNCS__.push(applyRelocs);
        }
      }
      var init = moduleExports["__wasm_call_ctors"];
      if (init) {
        if (runtimeInitialized) {
          init();
        } else {
          // we aren't ready to run compiled code yet
          addOnPostCtor(init);
        }
      }
      return moduleExports;
    }
    if (flags.loadAsync) {
      if (binary instanceof WebAssembly.Module) {
        var instance = new WebAssembly.Instance(binary, info);
        return Promise.resolve(postInstantiation(binary, instance));
      }
      return WebAssembly.instantiate(binary, info).then(result => postInstantiation(result.module, result.instance));
    }
    var module = binary instanceof WebAssembly.Module ? binary : new WebAssembly.Module(binary);
    var instance = new WebAssembly.Instance(module, info);
    return postInstantiation(module, instance);
  }
  // now load needed libraries and the module itself.
  if (flags.loadAsync) {
    return metadata.neededDynlibs.reduce((chain, dynNeeded) => chain.then(() => loadDynamicLibrary(dynNeeded, flags, localScope)), Promise.resolve()).then(loadModule);
  }
  metadata.neededDynlibs.forEach(needed => loadDynamicLibrary(needed, flags, localScope));
  return loadModule();
};

var mergeLibSymbols = (exports, libName) => {
  // add symbols into global namespace TODO: weak linking etc.
  for (var [sym, exp] of Object.entries(exports)) {
    // When RTLD_GLOBAL is enabled, the symbols defined by this shared object
    // will be made available for symbol resolution of subsequently loaded
    // shared objects.
    // We should copy the symbols (which include methods and variables) from
    // SIDE_MODULE to MAIN_MODULE.
    const setImport = target => {
      if (!isSymbolDefined(target)) {
        wasmImports[target] = exp;
      }
    };
    setImport(sym);
    // Special case for handling of main symbol:  If a side module exports
    // `main` that also acts a definition for `__main_argc_argv` and vice
    // versa.
    const main_alias = "__main_argc_argv";
    if (sym == "main") {
      setImport(main_alias);
    }
    if (sym == main_alias) {
      setImport("main");
    }
  }
};

var asyncLoad = async url => {
  var arrayBuffer = await readAsync(url);
  assert(arrayBuffer, `Loading data file "${url}" failed (no arrayBuffer).`);
  return new Uint8Array(arrayBuffer);
};

/**
       * @param {number=} handle
       * @param {Object=} localScope
       */ function loadDynamicLibrary(libName, flags = {
  global: true,
  nodelete: true
}, localScope, handle) {
  // when loadDynamicLibrary did not have flags, libraries were loaded
  // globally & permanently
  var dso = LDSO.loadedLibsByName[libName];
  if (dso) {
    // the library is being loaded or has been loaded already.
    assert(dso.exports !== "loading", `Attempt to load '${libName}' twice before the first load completed`);
    if (!flags.global) {
      if (localScope) {
        Object.assign(localScope, dso.exports);
      }
    } else if (!dso.global) {
      // The library was previously loaded only locally but not
      // we have a request with global=true.
      dso.global = true;
      mergeLibSymbols(dso.exports, libName);
    }
    // same for "nodelete"
    if (flags.nodelete && dso.refcount !== Infinity) {
      dso.refcount = Infinity;
    }
    dso.refcount++;
    if (handle) {
      LDSO.loadedLibsByHandle[handle] = dso;
    }
    return flags.loadAsync ? Promise.resolve(true) : true;
  }
  // allocate new DSO
  dso = newDSO(libName, handle, "loading");
  dso.refcount = flags.nodelete ? Infinity : 1;
  dso.global = flags.global;
  // libName -> libData
  function loadLibData() {
    // for wasm, we can use fetch for async, but for fs mode we can only imitate it
    if (handle) {
      var data = LE_HEAP_LOAD_U32((((handle) + (28)) >> 2) * 4);
      var dataSize = LE_HEAP_LOAD_U32((((handle) + (32)) >> 2) * 4);
      if (data && dataSize) {
        var libData = HEAP8.slice(data, data + dataSize);
        return flags.loadAsync ? Promise.resolve(libData) : libData;
      }
    }
    var libFile = locateFile(libName);
    if (flags.loadAsync) {
      return asyncLoad(libFile);
    }
    // load the binary synchronously
    if (!readBinary) {
      throw new Error(`${libFile}: file not found, and synchronous loading of external files is not available`);
    }
    return readBinary(libFile);
  }
  // libName -> exports
  function getExports() {
    // module not preloaded - load lib data and create new module from it
    if (flags.loadAsync) {
      return loadLibData().then(libData => loadWebAssemblyModule(libData, flags, libName, localScope, handle));
    }
    return loadWebAssemblyModule(loadLibData(), flags, libName, localScope, handle);
  }
  // module for lib is loaded - update the dso & global namespace
  function moduleLoaded(exports) {
    if (dso.global) {
      mergeLibSymbols(exports, libName);
    } else if (localScope) {
      Object.assign(localScope, exports);
    }
    dso.exports = exports;
  }
  if (flags.loadAsync) {
    return getExports().then(exports => {
      moduleLoaded(exports);
      return true;
    });
  }
  moduleLoaded(getExports());
  return true;
}

var reportUndefinedSymbols = () => {
  for (var [symName, entry] of Object.entries(GOT)) {
    if (entry.value == 0) {
      var value = resolveGlobalSymbol(symName, true).sym;
      if (!value && !entry.required) {
        // Ignore undefined symbols that are imported as weak.
        continue;
      }
      assert(value, `undefined symbol '${symName}'. perhaps a side module was not linked in? if this global was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment`);
      if (typeof value == "function") {
        /** @suppress {checkTypes} */ entry.value = addFunction(value, value.sig);
      } else if (typeof value == "number") {
        entry.value = value;
      } else {
        throw new Error(`bad export type for '${symName}': ${typeof value}`);
      }
    }
  }
};

var loadDylibs = () => {
  if (!dynamicLibraries.length) {
    reportUndefinedSymbols();
    return;
  }
  // Load binaries asynchronously
  addRunDependency("loadDylibs");
  dynamicLibraries.reduce((chain, lib) => chain.then(() => loadDynamicLibrary(lib, {
    loadAsync: true,
    global: true,
    nodelete: true,
    allowUndefined: true
  })), Promise.resolve()).then(() => {
    // we got them all, wonderful
    reportUndefinedSymbols();
    removeRunDependency("loadDylibs");
  });
};

var noExitRuntime = Module["noExitRuntime"] || true;

var ptrToString = ptr => {
  assert(typeof ptr === "number");
  // With CAN_ADDRESS_2GB or MEMORY64, pointers are already unsigned.
  ptr >>>= 0;
  return "0x" + ptr.toString(16).padStart(8, "0");
};

/**
     * @param {number} ptr
     * @param {number} value
     * @param {string} type
     */ function setValue(ptr, value, type = "i8") {
  if (type.endsWith("*")) type = "*";
  switch (type) {
   case "i1":
    SAFE_HEAP_STORE(ptr, value, 1);
    break;

   case "i8":
    SAFE_HEAP_STORE(ptr, value, 1);
    break;

   case "i16":
    LE_HEAP_STORE_I16(((ptr) >> 1) * 2, value);
    break;

   case "i32":
    LE_HEAP_STORE_I32(((ptr) >> 2) * 4, value);
    break;

   case "i64":
    HEAP64[((ptr) >> 3)] = BigInt(value);
    break;

   case "float":
    LE_HEAP_STORE_F32(((ptr) >> 2) * 4, value);
    break;

   case "double":
    LE_HEAP_STORE_F64(((ptr) >> 3) * 8, value);
    break;

   case "*":
    LE_HEAP_STORE_U32(((ptr) >> 2) * 4, value);
    break;

   default:
    abort(`invalid type for setValue: ${type}`);
  }
}

function setValue_safe(ptr, value, type = "i8") {
  if (type.endsWith("*")) type = "*";
  switch (type) {
   case "i1":
    HEAP8[ptr] = value;
    break;

   case "i8":
    HEAP8[ptr] = value;
    break;

   case "i16":
    LE_HEAP_STORE_I16(((ptr) >> 1) * 2, value);
    break;

   case "i32":
    LE_HEAP_STORE_I32(((ptr) >> 2) * 4, value);
    break;

   case "i64":
    HEAP64[((ptr) >> 3)] = BigInt(value);
    break;

   case "float":
    LE_HEAP_STORE_F32(((ptr) >> 2) * 4, value);
    break;

   case "double":
    LE_HEAP_STORE_F64(((ptr) >> 3) * 8, value);
    break;

   case "*":
    LE_HEAP_STORE_U32(((ptr) >> 2) * 4, value);
    break;

   default:
    abort(`invalid type for setValue: ${type}`);
  }
}

var unSign = (value, bits) => {
  if (value >= 0) {
    return value;
  }
  // Need some trickery, since if bits == 32, we are right at the limit of the
  // bits JS uses in bitshifts
  return bits <= 32 ? 2 * Math.abs(1 << (bits - 1)) + value : Math.pow(2, bits) + value;
};

var warnOnce = text => {
  warnOnce.shown ||= {};
  if (!warnOnce.shown[text]) {
    warnOnce.shown[text] = 1;
    if (ENVIRONMENT_IS_NODE) text = "warning: " + text;
    err(text);
  }
};

var ___memory_base = new WebAssembly.Global({
  "value": "i32",
  "mutable": false
}, 1024);

var ___stack_high = 78208;

var ___stack_low = 12672;

var ___stack_pointer = new WebAssembly.Global({
  "value": "i32",
  "mutable": true
}, 78208);

var ___table_base = new WebAssembly.Global({
  "value": "i32",
  "mutable": false
}, 1);

var __abort_js = () => abort("native code called abort()");

__abort_js.sig = "v";

var _emscripten_get_now = () => performance.now();

_emscripten_get_now.sig = "d";

var _emscripten_date_now = () => Date.now();

_emscripten_date_now.sig = "d";

var nowIsMonotonic = 1;

var checkWasiClock = clock_id => clock_id >= 0 && clock_id <= 3;

var INT53_MAX = 9007199254740992;

var INT53_MIN = -9007199254740992;

var bigintToI53Checked = num => (num < INT53_MIN || num > INT53_MAX) ? NaN : Number(num);

function _clock_time_get(clk_id, ignored_precision, ptime) {
  ignored_precision = bigintToI53Checked(ignored_precision);
  if (!checkWasiClock(clk_id)) {
    return 28;
  }
  var now;
  // all wasi clocks but realtime are monotonic
  if (clk_id === 0) {
    now = _emscripten_date_now();
  } else if (nowIsMonotonic) {
    now = _emscripten_get_now();
  } else {
    return 52;
  }
  // "now" is in ms, and wasi times are in ns.
  var nsec = Math.round(now * 1e3 * 1e3);
  HEAP64[((ptime) >> 3)] = BigInt(nsec);
  return 0;
}

_clock_time_get.sig = "iijp";

var getHeapMax = () => // Stay one Wasm page short of 4GB: while e.g. Chrome is able to allocate
// full 4GB Wasm memories, the size will wrap back to 0 bytes in Wasm side
// for any code that deals with heap sizes, which would require special
// casing all heap size related code to treat 0 specially.
2147483648;

var growMemory = size => {
  var b = wasmMemory.buffer;
  var pages = ((size - b.byteLength + 65535) / 65536) | 0;
  try {
    // round size grow request up to wasm page size (fixed 64KB per spec)
    wasmMemory.grow(pages);
    // .grow() takes a delta compared to the previous size
    updateMemoryViews();
    return 1;
  } catch (e) {
    err(`growMemory: Attempted to grow heap from ${b.byteLength} bytes to ${size} bytes, but got error: ${e}`);
  }
};

var _emscripten_resize_heap = requestedSize => {
  var oldSize = HEAPU8.length;
  // With CAN_ADDRESS_2GB or MEMORY64, pointers are already unsigned.
  requestedSize >>>= 0;
  // With multithreaded builds, races can happen (another thread might increase the size
  // in between), so return a failure, and let the caller retry.
  assert(requestedSize > oldSize);
  // Memory resize rules:
  // 1.  Always increase heap size to at least the requested size, rounded up
  //     to next page multiple.
  // 2a. If MEMORY_GROWTH_LINEAR_STEP == -1, excessively resize the heap
  //     geometrically: increase the heap size according to
  //     MEMORY_GROWTH_GEOMETRIC_STEP factor (default +20%), At most
  //     overreserve by MEMORY_GROWTH_GEOMETRIC_CAP bytes (default 96MB).
  // 2b. If MEMORY_GROWTH_LINEAR_STEP != -1, excessively resize the heap
  //     linearly: increase the heap size by at least
  //     MEMORY_GROWTH_LINEAR_STEP bytes.
  // 3.  Max size for the heap is capped at 2048MB-WASM_PAGE_SIZE, or by
  //     MAXIMUM_MEMORY, or by ASAN limit, depending on which is smallest
  // 4.  If we were unable to allocate as much memory, it may be due to
  //     over-eager decision to excessively reserve due to (3) above.
  //     Hence if an allocation fails, cut down on the amount of excess
  //     growth, in an attempt to succeed to perform a smaller allocation.
  // A limit is set for how much we can grow. We should not exceed that
  // (the wasm binary specifies it, so if we tried, we'd fail anyhow).
  var maxHeapSize = getHeapMax();
  if (requestedSize > maxHeapSize) {
    err(`Cannot enlarge memory, requested ${requestedSize} bytes, but the limit is ${maxHeapSize} bytes!`);
    return false;
  }
  // Loop through potential heap size increases. If we attempt a too eager
  // reservation that fails, cut down on the attempted size and reserve a
  // smaller bump instead. (max 3 times, chosen somewhat arbitrarily)
  for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
    var overGrownHeapSize = oldSize * (1 + .2 / cutDown);
    // ensure geometric growth
    // but limit overreserving (default to capping at +96MB overgrowth at most)
    overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
    var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
    var replacement = growMemory(newSize);
    if (replacement) {
      return true;
    }
  }
  err(`Failed to grow the heap from ${oldSize} bytes to ${newSize} bytes, not enough memory!`);
  return false;
};

_emscripten_resize_heap.sig = "ip";

var SYSCALLS = {
  varargs: undefined,
  getStr(ptr) {
    var ret = UTF8ToString(ptr);
    return ret;
  }
};

var _fd_close = fd => {
  abort("fd_close called without SYSCALLS_REQUIRE_FILESYSTEM");
};

_fd_close.sig = "ii";

function _fd_seek(fd, offset, whence, newOffset) {
  offset = bigintToI53Checked(offset);
  return 70;
}

_fd_seek.sig = "iijip";

var printCharBuffers = [ null, [], [] ];

var printChar = (stream, curr) => {
  var buffer = printCharBuffers[stream];
  assert(buffer);
  if (curr === 0 || curr === 10) {
    (stream === 1 ? out : err)(UTF8ArrayToString(buffer));
    buffer.length = 0;
  } else {
    buffer.push(curr);
  }
};

var flush_NO_FILESYSTEM = () => {
  // flush anything remaining in the buffers during shutdown
  _fflush(0);
  if (printCharBuffers[1].length) printChar(1, 10);
  if (printCharBuffers[2].length) printChar(2, 10);
};

var _fd_write = (fd, iov, iovcnt, pnum) => {
  // hack to support printf in SYSCALLS_REQUIRE_FILESYSTEM=0
  var num = 0;
  for (var i = 0; i < iovcnt; i++) {
    var ptr = LE_HEAP_LOAD_U32(((iov) >> 2) * 4);
    var len = LE_HEAP_LOAD_U32((((iov) + (4)) >> 2) * 4);
    iov += 8;
    for (var j = 0; j < len; j++) {
      printChar(fd, SAFE_HEAP_LOAD(ptr + j, 1, 1));
    }
    num += len;
  }
  LE_HEAP_STORE_U32(((pnum) >> 2) * 4, num);
  return 0;
};

_fd_write.sig = "iippp";

function _tree_sitter_log_callback(isLexMessage, messageAddress) {
  if (Module.currentLogCallback) {
    const message = UTF8ToString(messageAddress);
    Module.currentLogCallback(message, isLexMessage !== 0);
  }
}

function _tree_sitter_parse_callback(inputBufferAddress, index, row, column, lengthAddress) {
  const INPUT_BUFFER_SIZE = 10 * 1024;
  const string = Module.currentParseCallback(index, {
    row,
    column
  });
  if (typeof string === "string") {
    setValue(lengthAddress, string.length, "i32");
    stringToUTF16(string, inputBufferAddress, INPUT_BUFFER_SIZE);
  } else {
    setValue(lengthAddress, 0, "i32");
  }
}

function _tree_sitter_progress_callback(currentOffset, hasError) {
  if (Module.currentProgressCallback) {
    return Module.currentProgressCallback({
      currentOffset,
      hasError
    });
  }
  return false;
}

function _tree_sitter_query_progress_callback(currentOffset) {
  if (Module.currentQueryProgressCallback) {
    return Module.currentQueryProgressCallback({
      currentOffset
    });
  }
  return false;
}

var runtimeKeepaliveCounter = 0;

var keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0;

var _proc_exit = code => {
  EXITSTATUS = code;
  if (!keepRuntimeAlive()) {
    Module["onExit"]?.(code);
    ABORT = true;
  }
  quit_(code, new ExitStatus(code));
};

_proc_exit.sig = "vi";

/** @param {boolean|number=} implicit */ var exitJS = (status, implicit) => {
  EXITSTATUS = status;
  checkUnflushedContent();
  // if exit() was called explicitly, warn the user if the runtime isn't actually being shut down
  if (keepRuntimeAlive() && !implicit) {
    var msg = `program exited (with status: ${status}), but keepRuntimeAlive() is set (counter=${runtimeKeepaliveCounter}) due to an async operation, so halting execution but not exiting the runtime or preventing further async execution (you can use emscripten_force_exit, if you want to force a true shutdown)`;
    readyPromiseReject(msg);
    err(msg);
  }
  _proc_exit(status);
};

var handleException = e => {
  // Certain exception types we do not treat as errors since they are used for
  // internal control flow.
  // 1. ExitStatus, which is thrown by exit()
  // 2. "unwind", which is thrown by emscripten_unwind_to_js_event_loop() and others
  //    that wish to return to JS event loop.
  if (e instanceof ExitStatus || e == "unwind") {
    return EXITSTATUS;
  }
  checkStackCookie();
  if (e instanceof WebAssembly.RuntimeError) {
    if (_emscripten_stack_get_current() <= 0) {
      err("Stack overflow detected.  You can try increasing -sSTACK_SIZE (currently set to 65536)");
    }
  }
  quit_(1, e);
};

var lengthBytesUTF8 = str => {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code
    // unit, not a Unicode code point of the character! So decode
    // UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var c = str.charCodeAt(i);
    // possibly a lead surrogate
    if (c <= 127) {
      len++;
    } else if (c <= 2047) {
      len += 2;
    } else if (c >= 55296 && c <= 57343) {
      len += 4;
      ++i;
    } else {
      len += 3;
    }
  }
  return len;
};

var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
  assert(typeof str === "string", `stringToUTF8Array expects a string (got ${typeof str})`);
  // Parameter maxBytesToWrite is not optional. Negative values, 0, null,
  // undefined and false each don't write out any bytes.
  if (!(maxBytesToWrite > 0)) return 0;
  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1;
  // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code
    // unit, not a Unicode code point of the character! So decode
    // UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description
    // and https://www.ietf.org/rfc/rfc2279.txt
    // and https://tools.ietf.org/html/rfc3629
    var u = str.charCodeAt(i);
    // possibly a lead surrogate
    if (u >= 55296 && u <= 57343) {
      var u1 = str.charCodeAt(++i);
      u = 65536 + ((u & 1023) << 10) | (u1 & 1023);
    }
    if (u <= 127) {
      if (outIdx >= endIdx) break;
      heap[outIdx++] = u;
    } else if (u <= 2047) {
      if (outIdx + 1 >= endIdx) break;
      heap[outIdx++] = 192 | (u >> 6);
      heap[outIdx++] = 128 | (u & 63);
    } else if (u <= 65535) {
      if (outIdx + 2 >= endIdx) break;
      heap[outIdx++] = 224 | (u >> 12);
      heap[outIdx++] = 128 | ((u >> 6) & 63);
      heap[outIdx++] = 128 | (u & 63);
    } else {
      if (outIdx + 3 >= endIdx) break;
      if (u > 1114111) warnOnce("Invalid Unicode code point " + ptrToString(u) + " encountered when serializing a JS string to a UTF-8 string in wasm memory! (Valid unicode code points should be in range 0-0x10FFFF).");
      heap[outIdx++] = 240 | (u >> 18);
      heap[outIdx++] = 128 | ((u >> 12) & 63);
      heap[outIdx++] = 128 | ((u >> 6) & 63);
      heap[outIdx++] = 128 | (u & 63);
    }
  }
  // Null-terminate the pointer to the buffer.
  heap[outIdx] = 0;
  return outIdx - startIdx;
};

var stringToUTF8 = (str, outPtr, maxBytesToWrite) => {
  assert(typeof maxBytesToWrite == "number", "stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!");
  return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
};

var stackAlloc = sz => __emscripten_stack_alloc(sz);

var stringToUTF8OnStack = str => {
  var size = lengthBytesUTF8(str) + 1;
  var ret = stackAlloc(size);
  stringToUTF8(str, ret, size);
  return ret;
};

var AsciiToString = ptr => {
  var str = "";
  while (1) {
    var ch = SAFE_HEAP_LOAD(ptr++, 1, 1);
    if (!ch) return str;
    str += String.fromCharCode(ch);
  }
};

var stringToUTF16 = (str, outPtr, maxBytesToWrite) => {
  assert(outPtr % 2 == 0, "Pointer passed to stringToUTF16 must be aligned to two bytes!");
  assert(typeof maxBytesToWrite == "number", "stringToUTF16(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!");
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  maxBytesToWrite ??= 2147483647;
  if (maxBytesToWrite < 2) return 0;
  maxBytesToWrite -= 2;
  // Null terminator.
  var startPtr = outPtr;
  var numCharsToWrite = (maxBytesToWrite < str.length * 2) ? (maxBytesToWrite / 2) : str.length;
  for (var i = 0; i < numCharsToWrite; ++i) {
    // charCodeAt returns a UTF-16 encoded code unit, so it can be directly written to the HEAP.
    var codeUnit = str.charCodeAt(i);
    // possibly a lead surrogate
    LE_HEAP_STORE_I16(((outPtr) >> 1) * 2, codeUnit);
    outPtr += 2;
  }
  // Null-terminate the pointer to the HEAP.
  LE_HEAP_STORE_I16(((outPtr) >> 1) * 2, 0);
  return outPtr - startPtr;
};

function checkIncomingModuleAPI() {
  ignoredModuleProp("fetchSettings");
}

var wasmImports = {
  /** @export */ __heap_base: ___heap_base,
  /** @export */ __indirect_function_table: wasmTable,
  /** @export */ __memory_base: ___memory_base,
  /** @export */ __stack_high: ___stack_high,
  /** @export */ __stack_low: ___stack_low,
  /** @export */ __stack_pointer: ___stack_pointer,
  /** @export */ __table_base: ___table_base,
  /** @export */ _abort_js: __abort_js,
  /** @export */ alignfault,
  /** @export */ clock_time_get: _clock_time_get,
  /** @export */ emscripten_resize_heap: _emscripten_resize_heap,
  /** @export */ fd_close: _fd_close,
  /** @export */ fd_seek: _fd_seek,
  /** @export */ fd_write: _fd_write,
  /** @export */ memory: wasmMemory,
  /** @export */ segfault,
  /** @export */ tree_sitter_log_callback: _tree_sitter_log_callback,
  /** @export */ tree_sitter_parse_callback: _tree_sitter_parse_callback,
  /** @export */ tree_sitter_progress_callback: _tree_sitter_progress_callback,
  /** @export */ tree_sitter_query_progress_callback: _tree_sitter_query_progress_callback
};

var wasmExports = await createWasm();

var ___wasm_call_ctors = createExportWrapper("__wasm_call_ctors", 0);

var _malloc = Module["_malloc"] = createExportWrapper("malloc", 1);

var _calloc = Module["_calloc"] = createExportWrapper("calloc", 2);

var _realloc = Module["_realloc"] = createExportWrapper("realloc", 2);

var _free = Module["_free"] = createExportWrapper("free", 1);

var _ts_language_symbol_count = Module["_ts_language_symbol_count"] = createExportWrapper("ts_language_symbol_count", 1);

var _ts_language_state_count = Module["_ts_language_state_count"] = createExportWrapper("ts_language_state_count", 1);

var _ts_language_version = Module["_ts_language_version"] = createExportWrapper("ts_language_version", 1);

var _ts_language_abi_version = Module["_ts_language_abi_version"] = createExportWrapper("ts_language_abi_version", 1);

var _ts_language_metadata = Module["_ts_language_metadata"] = createExportWrapper("ts_language_metadata", 1);

var _ts_language_name = Module["_ts_language_name"] = createExportWrapper("ts_language_name", 1);

var _ts_language_field_count = Module["_ts_language_field_count"] = createExportWrapper("ts_language_field_count", 1);

var _ts_language_next_state = Module["_ts_language_next_state"] = createExportWrapper("ts_language_next_state", 3);

var _ts_language_symbol_name = Module["_ts_language_symbol_name"] = createExportWrapper("ts_language_symbol_name", 2);

var _ts_language_symbol_for_name = Module["_ts_language_symbol_for_name"] = createExportWrapper("ts_language_symbol_for_name", 4);

var _strncmp = Module["_strncmp"] = createExportWrapper("strncmp", 3);

var _ts_language_symbol_type = Module["_ts_language_symbol_type"] = createExportWrapper("ts_language_symbol_type", 2);

var _ts_language_field_name_for_id = Module["_ts_language_field_name_for_id"] = createExportWrapper("ts_language_field_name_for_id", 2);

var _ts_lookahead_iterator_new = Module["_ts_lookahead_iterator_new"] = createExportWrapper("ts_lookahead_iterator_new", 2);

var _ts_lookahead_iterator_delete = Module["_ts_lookahead_iterator_delete"] = createExportWrapper("ts_lookahead_iterator_delete", 1);

var _ts_lookahead_iterator_reset_state = Module["_ts_lookahead_iterator_reset_state"] = createExportWrapper("ts_lookahead_iterator_reset_state", 2);

var _ts_lookahead_iterator_reset = Module["_ts_lookahead_iterator_reset"] = createExportWrapper("ts_lookahead_iterator_reset", 3);

var _ts_lookahead_iterator_next = Module["_ts_lookahead_iterator_next"] = createExportWrapper("ts_lookahead_iterator_next", 1);

var _ts_lookahead_iterator_current_symbol = Module["_ts_lookahead_iterator_current_symbol"] = createExportWrapper("ts_lookahead_iterator_current_symbol", 1);

var _ts_parser_delete = Module["_ts_parser_delete"] = createExportWrapper("ts_parser_delete", 1);

var _ts_parser_set_language = Module["_ts_parser_set_language"] = createExportWrapper("ts_parser_set_language", 2);

var _ts_parser_reset = Module["_ts_parser_reset"] = createExportWrapper("ts_parser_reset", 1);

var _ts_parser_timeout_micros = Module["_ts_parser_timeout_micros"] = createExportWrapper("ts_parser_timeout_micros", 1);

var _ts_parser_set_timeout_micros = Module["_ts_parser_set_timeout_micros"] = createExportWrapper("ts_parser_set_timeout_micros", 2);

var _ts_parser_set_included_ranges = Module["_ts_parser_set_included_ranges"] = createExportWrapper("ts_parser_set_included_ranges", 3);

var _ts_query_new = Module["_ts_query_new"] = createExportWrapper("ts_query_new", 5);

var _ts_query_delete = Module["_ts_query_delete"] = createExportWrapper("ts_query_delete", 1);

var _iswspace = Module["_iswspace"] = createExportWrapper("iswspace", 1);

var _ts_query_pattern_count = Module["_ts_query_pattern_count"] = createExportWrapper("ts_query_pattern_count", 1);

var _ts_query_capture_count = Module["_ts_query_capture_count"] = createExportWrapper("ts_query_capture_count", 1);

var _ts_query_string_count = Module["_ts_query_string_count"] = createExportWrapper("ts_query_string_count", 1);

var _ts_query_capture_name_for_id = Module["_ts_query_capture_name_for_id"] = createExportWrapper("ts_query_capture_name_for_id", 3);

var _ts_query_capture_quantifier_for_id = Module["_ts_query_capture_quantifier_for_id"] = createExportWrapper("ts_query_capture_quantifier_for_id", 3);

var _ts_query_string_value_for_id = Module["_ts_query_string_value_for_id"] = createExportWrapper("ts_query_string_value_for_id", 3);

var _ts_query_predicates_for_pattern = Module["_ts_query_predicates_for_pattern"] = createExportWrapper("ts_query_predicates_for_pattern", 3);

var _ts_query_start_byte_for_pattern = Module["_ts_query_start_byte_for_pattern"] = createExportWrapper("ts_query_start_byte_for_pattern", 2);

var _ts_query_end_byte_for_pattern = Module["_ts_query_end_byte_for_pattern"] = createExportWrapper("ts_query_end_byte_for_pattern", 2);

var _ts_query_is_pattern_rooted = Module["_ts_query_is_pattern_rooted"] = createExportWrapper("ts_query_is_pattern_rooted", 2);

var _ts_query_is_pattern_non_local = Module["_ts_query_is_pattern_non_local"] = createExportWrapper("ts_query_is_pattern_non_local", 2);

var _ts_query_is_pattern_guaranteed_at_step = Module["_ts_query_is_pattern_guaranteed_at_step"] = createExportWrapper("ts_query_is_pattern_guaranteed_at_step", 2);

var _ts_query_disable_capture = Module["_ts_query_disable_capture"] = createExportWrapper("ts_query_disable_capture", 3);

var _ts_query_disable_pattern = Module["_ts_query_disable_pattern"] = createExportWrapper("ts_query_disable_pattern", 2);

var _memcmp = Module["_memcmp"] = createExportWrapper("memcmp", 3);

var _ts_tree_copy = Module["_ts_tree_copy"] = createExportWrapper("ts_tree_copy", 1);

var _ts_tree_delete = Module["_ts_tree_delete"] = createExportWrapper("ts_tree_delete", 1);

var _iswalnum = Module["_iswalnum"] = createExportWrapper("iswalnum", 1);

var _ts_init = Module["_ts_init"] = createExportWrapper("ts_init", 0);

var _ts_parser_new_wasm = Module["_ts_parser_new_wasm"] = createExportWrapper("ts_parser_new_wasm", 0);

var _ts_parser_enable_logger_wasm = Module["_ts_parser_enable_logger_wasm"] = createExportWrapper("ts_parser_enable_logger_wasm", 2);

var _ts_parser_parse_wasm = Module["_ts_parser_parse_wasm"] = createExportWrapper("ts_parser_parse_wasm", 5);

var _ts_parser_included_ranges_wasm = Module["_ts_parser_included_ranges_wasm"] = createExportWrapper("ts_parser_included_ranges_wasm", 1);

var _ts_language_type_is_named_wasm = Module["_ts_language_type_is_named_wasm"] = createExportWrapper("ts_language_type_is_named_wasm", 2);

var _ts_language_type_is_visible_wasm = Module["_ts_language_type_is_visible_wasm"] = createExportWrapper("ts_language_type_is_visible_wasm", 2);

var _ts_language_supertypes_wasm = Module["_ts_language_supertypes_wasm"] = createExportWrapper("ts_language_supertypes_wasm", 1);

var _ts_language_subtypes_wasm = Module["_ts_language_subtypes_wasm"] = createExportWrapper("ts_language_subtypes_wasm", 2);

var _ts_tree_root_node_wasm = Module["_ts_tree_root_node_wasm"] = createExportWrapper("ts_tree_root_node_wasm", 1);

var _ts_tree_root_node_with_offset_wasm = Module["_ts_tree_root_node_with_offset_wasm"] = createExportWrapper("ts_tree_root_node_with_offset_wasm", 1);

var _ts_tree_edit_wasm = Module["_ts_tree_edit_wasm"] = createExportWrapper("ts_tree_edit_wasm", 1);

var _ts_tree_included_ranges_wasm = Module["_ts_tree_included_ranges_wasm"] = createExportWrapper("ts_tree_included_ranges_wasm", 1);

var _ts_tree_get_changed_ranges_wasm = Module["_ts_tree_get_changed_ranges_wasm"] = createExportWrapper("ts_tree_get_changed_ranges_wasm", 2);

var _ts_tree_cursor_new_wasm = Module["_ts_tree_cursor_new_wasm"] = createExportWrapper("ts_tree_cursor_new_wasm", 1);

var _ts_tree_cursor_copy_wasm = Module["_ts_tree_cursor_copy_wasm"] = createExportWrapper("ts_tree_cursor_copy_wasm", 1);

var _ts_tree_cursor_delete_wasm = Module["_ts_tree_cursor_delete_wasm"] = createExportWrapper("ts_tree_cursor_delete_wasm", 1);

var _ts_tree_cursor_reset_wasm = Module["_ts_tree_cursor_reset_wasm"] = createExportWrapper("ts_tree_cursor_reset_wasm", 1);

var _ts_tree_cursor_reset_to_wasm = Module["_ts_tree_cursor_reset_to_wasm"] = createExportWrapper("ts_tree_cursor_reset_to_wasm", 2);

var _ts_tree_cursor_goto_first_child_wasm = Module["_ts_tree_cursor_goto_first_child_wasm"] = createExportWrapper("ts_tree_cursor_goto_first_child_wasm", 1);

var _ts_tree_cursor_goto_last_child_wasm = Module["_ts_tree_cursor_goto_last_child_wasm"] = createExportWrapper("ts_tree_cursor_goto_last_child_wasm", 1);

var _ts_tree_cursor_goto_first_child_for_index_wasm = Module["_ts_tree_cursor_goto_first_child_for_index_wasm"] = createExportWrapper("ts_tree_cursor_goto_first_child_for_index_wasm", 1);

var _ts_tree_cursor_goto_first_child_for_position_wasm = Module["_ts_tree_cursor_goto_first_child_for_position_wasm"] = createExportWrapper("ts_tree_cursor_goto_first_child_for_position_wasm", 1);

var _ts_tree_cursor_goto_next_sibling_wasm = Module["_ts_tree_cursor_goto_next_sibling_wasm"] = createExportWrapper("ts_tree_cursor_goto_next_sibling_wasm", 1);

var _ts_tree_cursor_goto_previous_sibling_wasm = Module["_ts_tree_cursor_goto_previous_sibling_wasm"] = createExportWrapper("ts_tree_cursor_goto_previous_sibling_wasm", 1);

var _ts_tree_cursor_goto_descendant_wasm = Module["_ts_tree_cursor_goto_descendant_wasm"] = createExportWrapper("ts_tree_cursor_goto_descendant_wasm", 2);

var _ts_tree_cursor_goto_parent_wasm = Module["_ts_tree_cursor_goto_parent_wasm"] = createExportWrapper("ts_tree_cursor_goto_parent_wasm", 1);

var _ts_tree_cursor_current_node_type_id_wasm = Module["_ts_tree_cursor_current_node_type_id_wasm"] = createExportWrapper("ts_tree_cursor_current_node_type_id_wasm", 1);

var _ts_tree_cursor_current_node_state_id_wasm = Module["_ts_tree_cursor_current_node_state_id_wasm"] = createExportWrapper("ts_tree_cursor_current_node_state_id_wasm", 1);

var _ts_tree_cursor_current_node_is_named_wasm = Module["_ts_tree_cursor_current_node_is_named_wasm"] = createExportWrapper("ts_tree_cursor_current_node_is_named_wasm", 1);

var _ts_tree_cursor_current_node_is_missing_wasm = Module["_ts_tree_cursor_current_node_is_missing_wasm"] = createExportWrapper("ts_tree_cursor_current_node_is_missing_wasm", 1);

var _ts_tree_cursor_current_node_id_wasm = Module["_ts_tree_cursor_current_node_id_wasm"] = createExportWrapper("ts_tree_cursor_current_node_id_wasm", 1);

var _ts_tree_cursor_start_position_wasm = Module["_ts_tree_cursor_start_position_wasm"] = createExportWrapper("ts_tree_cursor_start_position_wasm", 1);

var _ts_tree_cursor_end_position_wasm = Module["_ts_tree_cursor_end_position_wasm"] = createExportWrapper("ts_tree_cursor_end_position_wasm", 1);

var _ts_tree_cursor_start_index_wasm = Module["_ts_tree_cursor_start_index_wasm"] = createExportWrapper("ts_tree_cursor_start_index_wasm", 1);

var _ts_tree_cursor_end_index_wasm = Module["_ts_tree_cursor_end_index_wasm"] = createExportWrapper("ts_tree_cursor_end_index_wasm", 1);

var _ts_tree_cursor_current_field_id_wasm = Module["_ts_tree_cursor_current_field_id_wasm"] = createExportWrapper("ts_tree_cursor_current_field_id_wasm", 1);

var _ts_tree_cursor_current_depth_wasm = Module["_ts_tree_cursor_current_depth_wasm"] = createExportWrapper("ts_tree_cursor_current_depth_wasm", 1);

var _ts_tree_cursor_current_descendant_index_wasm = Module["_ts_tree_cursor_current_descendant_index_wasm"] = createExportWrapper("ts_tree_cursor_current_descendant_index_wasm", 1);

var _ts_tree_cursor_current_node_wasm = Module["_ts_tree_cursor_current_node_wasm"] = createExportWrapper("ts_tree_cursor_current_node_wasm", 1);

var _ts_node_symbol_wasm = Module["_ts_node_symbol_wasm"] = createExportWrapper("ts_node_symbol_wasm", 1);

var _ts_node_field_name_for_child_wasm = Module["_ts_node_field_name_for_child_wasm"] = createExportWrapper("ts_node_field_name_for_child_wasm", 2);

var _ts_node_field_name_for_named_child_wasm = Module["_ts_node_field_name_for_named_child_wasm"] = createExportWrapper("ts_node_field_name_for_named_child_wasm", 2);

var _ts_node_children_by_field_id_wasm = Module["_ts_node_children_by_field_id_wasm"] = createExportWrapper("ts_node_children_by_field_id_wasm", 2);

var _ts_node_first_child_for_byte_wasm = Module["_ts_node_first_child_for_byte_wasm"] = createExportWrapper("ts_node_first_child_for_byte_wasm", 1);

var _ts_node_first_named_child_for_byte_wasm = Module["_ts_node_first_named_child_for_byte_wasm"] = createExportWrapper("ts_node_first_named_child_for_byte_wasm", 1);

var _ts_node_grammar_symbol_wasm = Module["_ts_node_grammar_symbol_wasm"] = createExportWrapper("ts_node_grammar_symbol_wasm", 1);

var _ts_node_child_count_wasm = Module["_ts_node_child_count_wasm"] = createExportWrapper("ts_node_child_count_wasm", 1);

var _ts_node_named_child_count_wasm = Module["_ts_node_named_child_count_wasm"] = createExportWrapper("ts_node_named_child_count_wasm", 1);

var _ts_node_child_wasm = Module["_ts_node_child_wasm"] = createExportWrapper("ts_node_child_wasm", 2);

var _ts_node_named_child_wasm = Module["_ts_node_named_child_wasm"] = createExportWrapper("ts_node_named_child_wasm", 2);

var _ts_node_child_by_field_id_wasm = Module["_ts_node_child_by_field_id_wasm"] = createExportWrapper("ts_node_child_by_field_id_wasm", 2);

var _ts_node_next_sibling_wasm = Module["_ts_node_next_sibling_wasm"] = createExportWrapper("ts_node_next_sibling_wasm", 1);

var _ts_node_prev_sibling_wasm = Module["_ts_node_prev_sibling_wasm"] = createExportWrapper("ts_node_prev_sibling_wasm", 1);

var _ts_node_next_named_sibling_wasm = Module["_ts_node_next_named_sibling_wasm"] = createExportWrapper("ts_node_next_named_sibling_wasm", 1);

var _ts_node_prev_named_sibling_wasm = Module["_ts_node_prev_named_sibling_wasm"] = createExportWrapper("ts_node_prev_named_sibling_wasm", 1);

var _ts_node_descendant_count_wasm = Module["_ts_node_descendant_count_wasm"] = createExportWrapper("ts_node_descendant_count_wasm", 1);

var _ts_node_parent_wasm = Module["_ts_node_parent_wasm"] = createExportWrapper("ts_node_parent_wasm", 1);

var _ts_node_child_with_descendant_wasm = Module["_ts_node_child_with_descendant_wasm"] = createExportWrapper("ts_node_child_with_descendant_wasm", 1);

var _ts_node_descendant_for_index_wasm = Module["_ts_node_descendant_for_index_wasm"] = createExportWrapper("ts_node_descendant_for_index_wasm", 1);

var _ts_node_named_descendant_for_index_wasm = Module["_ts_node_named_descendant_for_index_wasm"] = createExportWrapper("ts_node_named_descendant_for_index_wasm", 1);

var _ts_node_descendant_for_position_wasm = Module["_ts_node_descendant_for_position_wasm"] = createExportWrapper("ts_node_descendant_for_position_wasm", 1);

var _ts_node_named_descendant_for_position_wasm = Module["_ts_node_named_descendant_for_position_wasm"] = createExportWrapper("ts_node_named_descendant_for_position_wasm", 1);

var _ts_node_start_point_wasm = Module["_ts_node_start_point_wasm"] = createExportWrapper("ts_node_start_point_wasm", 1);

var _ts_node_end_point_wasm = Module["_ts_node_end_point_wasm"] = createExportWrapper("ts_node_end_point_wasm", 1);

var _ts_node_start_index_wasm = Module["_ts_node_start_index_wasm"] = createExportWrapper("ts_node_start_index_wasm", 1);

var _ts_node_end_index_wasm = Module["_ts_node_end_index_wasm"] = createExportWrapper("ts_node_end_index_wasm", 1);

var _ts_node_to_string_wasm = Module["_ts_node_to_string_wasm"] = createExportWrapper("ts_node_to_string_wasm", 1);

var _ts_node_children_wasm = Module["_ts_node_children_wasm"] = createExportWrapper("ts_node_children_wasm", 1);

var _ts_node_named_children_wasm = Module["_ts_node_named_children_wasm"] = createExportWrapper("ts_node_named_children_wasm", 1);

var _ts_node_descendants_of_type_wasm = Module["_ts_node_descendants_of_type_wasm"] = createExportWrapper("ts_node_descendants_of_type_wasm", 7);

var _ts_node_is_named_wasm = Module["_ts_node_is_named_wasm"] = createExportWrapper("ts_node_is_named_wasm", 1);

var _ts_node_has_changes_wasm = Module["_ts_node_has_changes_wasm"] = createExportWrapper("ts_node_has_changes_wasm", 1);

var _ts_node_has_error_wasm = Module["_ts_node_has_error_wasm"] = createExportWrapper("ts_node_has_error_wasm", 1);

var _ts_node_is_error_wasm = Module["_ts_node_is_error_wasm"] = createExportWrapper("ts_node_is_error_wasm", 1);

var _ts_node_is_missing_wasm = Module["_ts_node_is_missing_wasm"] = createExportWrapper("ts_node_is_missing_wasm", 1);

var _ts_node_is_extra_wasm = Module["_ts_node_is_extra_wasm"] = createExportWrapper("ts_node_is_extra_wasm", 1);

var _ts_node_parse_state_wasm = Module["_ts_node_parse_state_wasm"] = createExportWrapper("ts_node_parse_state_wasm", 1);

var _ts_node_next_parse_state_wasm = Module["_ts_node_next_parse_state_wasm"] = createExportWrapper("ts_node_next_parse_state_wasm", 1);

var _ts_query_matches_wasm = Module["_ts_query_matches_wasm"] = createExportWrapper("ts_query_matches_wasm", 11);

var _ts_query_captures_wasm = Module["_ts_query_captures_wasm"] = createExportWrapper("ts_query_captures_wasm", 11);

var _memset = Module["_memset"] = createExportWrapper("memset", 3);

var _memcpy = Module["_memcpy"] = createExportWrapper("memcpy", 3);

var _memmove = Module["_memmove"] = createExportWrapper("memmove", 3);

var _fflush = createExportWrapper("fflush", 1);

var _strlen = Module["_strlen"] = createExportWrapper("strlen", 1);

var _iswalpha = Module["_iswalpha"] = createExportWrapper("iswalpha", 1);

var _iswblank = Module["_iswblank"] = createExportWrapper("iswblank", 1);

var _iswdigit = Module["_iswdigit"] = createExportWrapper("iswdigit", 1);

var _iswlower = Module["_iswlower"] = createExportWrapper("iswlower", 1);

var _iswupper = Module["_iswupper"] = createExportWrapper("iswupper", 1);

var _iswxdigit = Module["_iswxdigit"] = createExportWrapper("iswxdigit", 1);

var _memchr = Module["_memchr"] = createExportWrapper("memchr", 3);

var _strcmp = Module["_strcmp"] = createExportWrapper("strcmp", 2);

var _strncat = Module["_strncat"] = createExportWrapper("strncat", 3);

var _strncpy = Module["_strncpy"] = createExportWrapper("strncpy", 3);

var _towlower = Module["_towlower"] = createExportWrapper("towlower", 1);

var _towupper = Module["_towupper"] = createExportWrapper("towupper", 1);

var _sbrk = createExportWrapper("sbrk", 1);

var _emscripten_get_sbrk_ptr = createExportWrapper("emscripten_get_sbrk_ptr", 0);

var _setThrew = createExportWrapper("setThrew", 2);

var _emscripten_stack_set_limits = wasmExports["emscripten_stack_set_limits"];

var _emscripten_stack_get_free = wasmExports["emscripten_stack_get_free"];

var _emscripten_stack_get_base = wasmExports["emscripten_stack_get_base"];

var _emscripten_stack_get_end = wasmExports["emscripten_stack_get_end"];

var __emscripten_stack_restore = wasmExports["_emscripten_stack_restore"];

var __emscripten_stack_alloc = wasmExports["_emscripten_stack_alloc"];

var _emscripten_stack_get_current = wasmExports["emscripten_stack_get_current"];

var ___wasm_apply_data_relocs = createExportWrapper("__wasm_apply_data_relocs", 0);

// include: postamble.js
// === Auto-generated postamble setup entry stuff ===
Module["setValue"] = setValue;

Module["getValue"] = getValue;

Module["UTF8ToString"] = UTF8ToString;

Module["stringToUTF8"] = stringToUTF8;

Module["lengthBytesUTF8"] = lengthBytesUTF8;

Module["AsciiToString"] = AsciiToString;

Module["stringToUTF16"] = stringToUTF16;

Module["loadWebAssemblyModule"] = loadWebAssemblyModule;

var missingLibrarySymbols = [ "writeI53ToI64", "writeI53ToI64Clamped", "writeI53ToI64Signaling", "writeI53ToU64Clamped", "writeI53ToU64Signaling", "readI53FromI64", "readI53FromU64", "convertI32PairToI53", "convertI32PairToI53Checked", "convertU32PairToI53", "getTempRet0", "setTempRet0", "zeroMemory", "strError", "inetPton4", "inetNtop4", "inetPton6", "inetNtop6", "readSockaddr", "writeSockaddr", "emscriptenLog", "readEmAsmArgs", "runEmAsmFunction", "runMainThreadEmAsm", "jstoi_q", "getExecutableName", "listenOnce", "autoResumeAudioContext", "getDynCaller", "runtimeKeepalivePush", "runtimeKeepalivePop", "callUserCallback", "maybeExit", "asmjsMangle", "mmapAlloc", "HandleAllocator", "getNativeTypeSize", "addOnInit", "addOnPreMain", "addOnExit", "STACK_SIZE", "STACK_ALIGN", "POINTER_SIZE", "ASSERTIONS", "getCFunc", "ccall", "cwrap", "removeFunction", "reallyNegative", "strLen", "reSign", "formatString", "intArrayFromString", "intArrayToString", "stringToAscii", "UTF16ToString", "lengthBytesUTF16", "UTF32ToString", "stringToUTF32", "lengthBytesUTF32", "stringToNewUTF8", "writeArrayToMemory", "registerKeyEventCallback", "maybeCStringToJsString", "findEventTarget", "getBoundingClientRect", "fillMouseEventData", "registerMouseEventCallback", "registerWheelEventCallback", "registerUiEventCallback", "registerFocusEventCallback", "fillDeviceOrientationEventData", "registerDeviceOrientationEventCallback", "fillDeviceMotionEventData", "registerDeviceMotionEventCallback", "screenOrientation", "fillOrientationChangeEventData", "registerOrientationChangeEventCallback", "fillFullscreenChangeEventData", "registerFullscreenChangeEventCallback", "JSEvents_requestFullscreen", "JSEvents_resizeCanvasForFullscreen", "registerRestoreOldStyle", "hideEverythingExceptGivenElement", "restoreHiddenElements", "setLetterbox", "softFullscreenResizeWebGLRenderTarget", "doRequestFullscreen", "fillPointerlockChangeEventData", "registerPointerlockChangeEventCallback", "registerPointerlockErrorEventCallback", "requestPointerLock", "fillVisibilityChangeEventData", "registerVisibilityChangeEventCallback", "registerTouchEventCallback", "fillGamepadEventData", "registerGamepadEventCallback", "registerBeforeUnloadEventCallback", "fillBatteryEventData", "battery", "registerBatteryEventCallback", "setCanvasElementSize", "getCanvasElementSize", "jsStackTrace", "getCallstack", "convertPCtoSourceLocation", "getEnvStrings", "wasiRightsToMuslOFlags", "wasiOFlagsToMuslOFlags", "initRandomFill", "randomFill", "safeSetTimeout", "setImmediateWrapped", "safeRequestAnimationFrame", "clearImmediateWrapped", "registerPostMainLoop", "registerPreMainLoop", "getPromise", "makePromise", "idsToPromises", "makePromiseCallback", "Browser_asyncPrepareDataCounter", "isLeapYear", "ydayFromDate", "arraySum", "addDays", "getSocketFromFD", "getSocketAddress", "dlopenInternal", "heapObjectForWebGLType", "toTypedArrayIndex", "webgl_enable_ANGLE_instanced_arrays", "webgl_enable_OES_vertex_array_object", "webgl_enable_WEBGL_draw_buffers", "webgl_enable_WEBGL_multi_draw", "webgl_enable_EXT_polygon_offset_clamp", "webgl_enable_EXT_clip_control", "webgl_enable_WEBGL_polygon_mode", "emscriptenWebGLGet", "computeUnpackAlignedImageSize", "colorChannelsInGlTextureFormat", "emscriptenWebGLGetTexPixelData", "emscriptenWebGLGetUniform", "webglGetUniformLocation", "webglPrepareUniformLocationsBeforeFirstUse", "webglGetLeftBracePos", "emscriptenWebGLGetVertexAttrib", "__glGetActiveAttribOrUniform", "writeGLArray", "registerWebGlEventCallback", "runAndAbortIfError", "ALLOC_NORMAL", "ALLOC_STACK", "allocate", "writeStringToMemory", "writeAsciiToMemory", "setErrNo", "demangle", "stackTrace" ];

missingLibrarySymbols.forEach(missingLibrarySymbol);

var unexportedSymbols = [ "run", "addRunDependency", "removeRunDependency", "out", "err", "callMain", "abort", "wasmMemory", "wasmExports", "writeStackCookie", "checkStackCookie", "INT53_MAX", "INT53_MIN", "bigintToI53Checked", "stackSave", "stackRestore", "stackAlloc", "ptrToString", "exitJS", "getHeapMax", "growMemory", "ENV", "ERRNO_CODES", "DNS", "Protocols", "Sockets", "timers", "warnOnce", "readEmAsmArgsArray", "jstoi_s", "dynCall", "handleException", "keepRuntimeAlive", "asyncLoad", "alignMemory", "wasmTable", "noExitRuntime", "addOnPreRun", "addOnPostCtor", "addOnPostRun", "uleb128Encode", "sigToWasmTypes", "generateFuncType", "convertJsFunctionToWasm", "freeTableIndexes", "functionsInTableMap", "getEmptyTableSlot", "updateTableMap", "getFunctionAddress", "addFunction", "unSign", "PATH", "PATH_FS", "UTF8Decoder", "UTF8ArrayToString", "stringToUTF8Array", "UTF16Decoder", "stringToUTF8OnStack", "JSEvents", "specialHTMLTargets", "findCanvasEventTarget", "currentFullscreenStrategy", "restoreOldWindowedStyle", "UNWIND_CACHE", "ExitStatus", "checkWasiClock", "flush_NO_FILESYSTEM", "emSetImmediate", "emClearImmediate_deps", "emClearImmediate", "promiseMap", "Browser", "getPreloadedImageData__data", "wget", "MONTH_DAYS_REGULAR", "MONTH_DAYS_LEAP", "MONTH_DAYS_REGULAR_CUMULATIVE", "MONTH_DAYS_LEAP_CUMULATIVE", "SYSCALLS", "isSymbolDefined", "GOT", "currentModuleWeakSymbols", "LDSO", "getMemory", "mergeLibSymbols", "newDSO", "loadDynamicLibrary", "tempFixedLengthArray", "miniTempWebGLFloatBuffers", "miniTempWebGLIntBuffers", "GL", "AL", "GLUT", "EGL", "GLEW", "IDBStore", "SDL", "SDL_gfx", "allocateUTF8", "allocateUTF8OnStack", "print", "printErr", "LE_HEAP_STORE_U16", "LE_HEAP_STORE_I16", "LE_HEAP_STORE_U32", "LE_HEAP_STORE_I32", "LE_HEAP_STORE_F32", "LE_HEAP_STORE_F64", "LE_HEAP_LOAD_U16", "LE_HEAP_LOAD_I16", "LE_HEAP_LOAD_U32", "LE_HEAP_LOAD_I32", "LE_HEAP_LOAD_F32", "LE_HEAP_LOAD_F64" ];

unexportedSymbols.forEach(unexportedRuntimeSymbol);

var calledRun;

function callMain(args = []) {
  assert(runDependencies == 0, 'cannot call main when async dependencies remain! (listen on Module["onRuntimeInitialized"])');
  assert(typeof onPreRuns === "undefined" || onPreRuns.length == 0, "cannot call main when preRun functions remain to be called");
  var entryFunction = resolveGlobalSymbol("main").sym;
  // Main modules can't tell if they have main() at compile time, since it may
  // arrive from a dynamic library.
  if (!entryFunction) return;
  args.unshift(thisProgram);
  var argc = args.length;
  var argv = stackAlloc((argc + 1) * 4);
  var argv_ptr = argv;
  args.forEach(arg => {
    LE_HEAP_STORE_U32(((argv_ptr) >> 2) * 4, stringToUTF8OnStack(arg));
    argv_ptr += 4;
  });
  LE_HEAP_STORE_U32(((argv_ptr) >> 2) * 4, 0);
  try {
    var ret = entryFunction(argc, argv);
    // if we're not running an evented main loop, it's time to exit
    exitJS(ret, /* implicit = */ true);
    return ret;
  } catch (e) {
    return handleException(e);
  }
}

function stackCheckInit() {
  // This is normally called automatically during __wasm_call_ctors but need to
  // get these values before even running any of the ctors so we call it redundantly
  // here.
  _emscripten_stack_set_limits(78208, 12672);
  // TODO(sbc): Move writeStackCookie to native to to avoid this.
  writeStackCookie();
}

function run(args = arguments_) {
  if (runDependencies > 0) {
    dependenciesFulfilled = run;
    return;
  }
  stackCheckInit();
  preRun();
  // a preRun added a dependency, run will be called later
  if (runDependencies > 0) {
    dependenciesFulfilled = run;
    return;
  }
  function doRun() {
    // run may have just been called through dependencies being fulfilled just in this very frame,
    // or while the async setStatus time below was happening
    assert(!calledRun);
    calledRun = true;
    Module["calledRun"] = true;
    if (ABORT) return;
    initRuntime();
    preMain();
    readyPromiseResolve(Module);
    Module["onRuntimeInitialized"]?.();
    consumedModuleProp("onRuntimeInitialized");
    var noInitialRun = Module["noInitialRun"];
    legacyModuleProp("noInitialRun", "noInitialRun");
    if (!noInitialRun) callMain(args);
    postRun();
  }
  if (Module["setStatus"]) {
    Module["setStatus"]("Running...");
    setTimeout(() => {
      setTimeout(() => Module["setStatus"](""), 1);
      doRun();
    }, 1);
  } else {
    doRun();
  }
  checkStackCookie();
}

function checkUnflushedContent() {
  // Compiler settings do not allow exiting the runtime, so flushing
  // the streams is not possible. but in ASSERTIONS mode we check
  // if there was something to flush, and if so tell the user they
  // should request that the runtime be exitable.
  // Normally we would not even include flush() at all, but in ASSERTIONS
  // builds we do so just for this check, and here we see if there is any
  // content to flush, that is, we check if there would have been
  // something a non-ASSERTIONS build would have not seen.
  // How we flush the streams depends on whether we are in SYSCALLS_REQUIRE_FILESYSTEM=0
  // mode (which has its own special function for this; otherwise, all
  // the code is inside libc)
  var oldOut = out;
  var oldErr = err;
  var has = false;
  out = err = x => {
    has = true;
  };
  try {
    // it doesn't matter if it fails
    flush_NO_FILESYSTEM();
  } catch (e) {}
  out = oldOut;
  err = oldErr;
  if (has) {
    warnOnce("stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the Emscripten FAQ), or make sure to emit a newline when you printf etc.");
    warnOnce("(this may also be due to not including full filesystem support - try building with -sFORCE_FILESYSTEM)");
  }
}

if (Module["preInit"]) {
  if (typeof Module["preInit"] == "function") Module["preInit"] = [ Module["preInit"] ];
  while (Module["preInit"].length > 0) {
    Module["preInit"].pop()();
  }
}

consumedModuleProp("preInit");

run();

// end include: postamble.js
// include: postamble_modularize.js
// In MODULARIZE mode we wrap the generated code in a factory function
// and return either the Module itself, or a promise of the module.
// We assign to the `moduleRtn` global here and configure closure to see
// this as and extern so it won't get minified.
moduleRtn = readyPromise;

// Assertion for attempting to access module properties on the incoming
// moduleArg.  In the past we used this object as the prototype of the module
// and assigned properties to it, but now we return a distinct object.  This
// keeps the instance private until it is ready (i.e the promise has been
// resolved).
for (const prop of Object.keys(Module)) {
  if (!(prop in moduleArg)) {
    Object.defineProperty(moduleArg, prop, {
      configurable: true,
      get() {
        abort(`Access to module property ('${prop}') is no longer possible via the module constructor argument; Instead, use the result of the module constructor.`);
      }
    });
  }
}


  return moduleRtn;
}
);
})();
(() => {
  // Create a small, never-async wrapper around Module which
  // checks for callers incorrectly using it with `new`.
  var real_Module = Module;
  Module = function(arg) {
    if (new.target) throw new Error("Module() should not be called with `new Module()`");
    return real_Module(arg);
  }
})();
if (typeof exports === 'object' && typeof module === 'object') {
  module.exports = Module;
  // This default export looks redundant, but it allows TS to import this
  // commonjs style module.
  module.exports.default = Module;
} else if (typeof define === 'function' && define['amd'])
  define([], () => Module);
