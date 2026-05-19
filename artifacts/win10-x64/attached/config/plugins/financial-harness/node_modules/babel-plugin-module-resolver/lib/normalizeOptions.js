"use strict";

exports.__esModule = true;
exports.default = void 0;
var _fs = _interopRequireDefault(require("fs"));
var _path = _interopRequireDefault(require("path"));
var _reselect = require("reselect");
var _findBabelConfig = _interopRequireDefault(require("find-babel-config"));
var _glob = _interopRequireDefault(require("glob"));
var _pkgUp = _interopRequireDefault(require("pkg-up"));
var _utils = require("./utils");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
const defaultExtensions = ['.js', '.jsx', '.es', '.es6', '.mjs'];
const defaultTransformedFunctions = ['require', 'require.resolve', 'System.import',
// Jest methods
'jest.genMockFromModule', 'jest.mock', 'jest.unmock', 'jest.doMock', 'jest.dontMock', 'jest.setMock', 'jest.requireActual', 'jest.requireMock',
// Older Jest methods
'require.requireActual', 'require.requireMock'];
function isRegExp(string) {
  return string.startsWith('^') || string.endsWith('$');
}
const specialCwd = {
  babelrc: startPath => _findBabelConfig.default.sync(startPath).file,
  packagejson: startPath => _pkgUp.default.sync({
    cwd: startPath
  })
};
function normalizeCwd(optsCwd, currentFile) {
  let cwd;
  if (optsCwd in specialCwd) {
    const startPath = currentFile === 'unknown' ? './' : currentFile;
    const computedCwd = specialCwd[optsCwd](startPath);
    cwd = computedCwd ? _path.default.dirname(computedCwd) : null;
  } else {
    cwd = optsCwd;
  }
  return cwd || process.cwd();
}
function normalizeRoot(optsRoot, cwd) {
  if (!optsRoot) {
    return [];
  }
  const rootArray = Array.isArray(optsRoot) ? optsRoot : [optsRoot];
  return rootArray.map(dirPath => _path.default.resolve(cwd, dirPath)).reduce((resolvedDirs, absDirPath) => {
    if (_glob.default.hasMagic(absDirPath)) {
      const roots = _glob.default.sync(absDirPath).filter(resolvedPath => _fs.default.lstatSync(resolvedPath).isDirectory());
      return [...resolvedDirs, ...roots];
    }
    return [...resolvedDirs, absDirPath];
  }, []);
}
function getAliasTarget(key, isKeyRegExp) {
  const regExpPattern = isKeyRegExp ? key : `^${(0, _utils.escapeRegExp)(key)}(/.*|)$`;
  return new RegExp(regExpPattern);
}
function getAliasSubstitute(value, isKeyRegExp) {
  if (typeof value === 'function') {
    return value;
  }
  if (!isKeyRegExp) {
    return ([, match]) => {
      // Alias with array of paths
      if (Array.isArray(value)) {
        return value.map(v => `${v}${match}`);
      }
      return `${value}${match}`;
    };
  }
  const parts = value.split('\\\\');
  return execResult => parts.map(part => part.replace(/\\\d+/g, number => execResult[number.slice(1)] || '')).join('\\');
}
function normalizeAlias(optsAlias) {
  if (!optsAlias) {
    return [];
  }
  const aliasArray = Array.isArray(optsAlias) ? optsAlias : [optsAlias];
  return aliasArray.reduce((aliasPairs, alias) => {
    const aliasKeys = Object.keys(alias);
    aliasKeys.forEach(key => {
      const isKeyRegExp = isRegExp(key);
      aliasPairs.push([getAliasTarget(key, isKeyRegExp), getAliasSubstitute(alias[key], isKeyRegExp)]);
    });
    return aliasPairs;
  }, []);
}
function normalizeTransformedFunctions(optsTransformFunctions) {
  if (!optsTransformFunctions) {
    return defaultTransformedFunctions;
  }
  return [...defaultTransformedFunctions, ...optsTransformFunctions];
}
function normalizeLoglevel(optsLoglevel) {
  return optsLoglevel || 'warn';
}
var _default = exports.default = (0, _reselect.createSelector)(
// The currentFile should have an extension; otherwise it's considered a special value
currentFile => currentFile.includes('.') ? _path.default.dirname(currentFile) : currentFile, (_, opts) => opts, (currentFile, opts) => {
  const cwd = normalizeCwd(opts.cwd, currentFile);
  const root = normalizeRoot(opts.root, cwd);
  const alias = normalizeAlias(opts.alias);
  const loglevel = normalizeLoglevel(opts.loglevel);
  const transformFunctions = normalizeTransformedFunctions(opts.transformFunctions);
  const extensions = opts.extensions || defaultExtensions;
  const stripExtensions = opts.stripExtensions || extensions;
  return {
    cwd,
    root,
    alias,
    loglevel,
    transformFunctions,
    extensions,
    stripExtensions,
    customResolvePath: opts.resolvePath
  };
});