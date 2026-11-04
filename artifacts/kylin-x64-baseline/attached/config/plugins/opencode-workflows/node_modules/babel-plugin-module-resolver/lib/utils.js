"use strict";

exports.__esModule = true;
exports.escapeRegExp = escapeRegExp;
exports.isImportCall = isImportCall;
exports.isRelativePath = isRelativePath;
exports.matchesPattern = matchesPattern;
exports.nodeResolvePath = nodeResolvePath;
exports.replaceExtension = replaceExtension;
exports.stripExtension = stripExtension;
exports.toLocalPath = toLocalPath;
exports.toPosixPath = toPosixPath;
var _path = _interopRequireDefault(require("path"));
var _resolve = _interopRequireDefault(require("resolve"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function nodeResolvePath(modulePath, basedir, extensions) {
  try {
    return _resolve.default.sync(modulePath, {
      basedir,
      extensions
    });
  } catch (e) {
    return null;
  }
}
function isRelativePath(nodePath) {
  return nodePath.match(/^\.?\.\//);
}
function toPosixPath(modulePath) {
  return modulePath.replace(/\\/g, '/');
}
function toLocalPath(modulePath) {
  let localPath = modulePath.replace(/\/index$/, ''); // remove trailing /index
  if (!isRelativePath(localPath)) {
    localPath = `./${localPath}`; // insert `./` to make it a relative path
  }
  return localPath;
}
function stripExtension(modulePath, stripExtensions) {
  let name = _path.default.basename(modulePath);
  stripExtensions.some(extension => {
    if (name.endsWith(extension)) {
      name = name.slice(0, name.length - extension.length);
      return true;
    }
    return false;
  });
  return name;
}
function replaceExtension(modulePath, opts) {
  const filename = stripExtension(modulePath, opts.stripExtensions);
  return _path.default.join(_path.default.dirname(modulePath), filename);
}
function matchesPattern(types, calleePath, pattern) {
  const {
    node
  } = calleePath;
  if (types.isMemberExpression(node)) {
    return calleePath.matchesPattern(pattern);
  }
  if (!types.isIdentifier(node) || pattern.includes('.')) {
    return false;
  }
  const name = pattern.split('.')[0];
  return node.name === name;
}
function isImportCall(types, calleePath) {
  return types.isImport(calleePath.node.callee);
}
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}