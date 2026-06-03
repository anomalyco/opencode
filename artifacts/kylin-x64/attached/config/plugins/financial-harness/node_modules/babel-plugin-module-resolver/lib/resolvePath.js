"use strict";

exports.__esModule = true;
exports.default = resolvePath;
var _path = _interopRequireDefault(require("path"));
var _log = require("./log");
var _mapToRelative = _interopRequireDefault(require("./mapToRelative"));
var _normalizeOptions = _interopRequireDefault(require("./normalizeOptions"));
var _utils = require("./utils");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function getRelativePath(sourcePath, currentFile, absFileInRoot, opts) {
  const realSourceFileExtension = _path.default.extname(absFileInRoot);
  const sourceFileExtension = _path.default.extname(sourcePath);
  let relativePath = (0, _mapToRelative.default)(opts.cwd, currentFile, absFileInRoot);
  if (realSourceFileExtension !== sourceFileExtension) {
    relativePath = (0, _utils.replaceExtension)(relativePath, opts);
  }
  return (0, _utils.toLocalPath)((0, _utils.toPosixPath)(relativePath));
}
function findPathInRoots(sourcePath, {
  extensions,
  root
}) {
  // Search the source path inside every custom root directory
  let resolvedSourceFile;
  root.some(basedir => {
    resolvedSourceFile = (0, _utils.nodeResolvePath)(`./${sourcePath}`, basedir, extensions);
    return resolvedSourceFile !== null;
  });
  return resolvedSourceFile;
}
function resolvePathFromRootConfig(sourcePath, currentFile, opts) {
  const absFileInRoot = findPathInRoots(sourcePath, opts);
  if (!absFileInRoot) {
    return null;
  }
  return getRelativePath(sourcePath, currentFile, absFileInRoot, opts);
}
function checkIfPackageExists(modulePath, currentFile, extensions, loglevel) {
  const resolvedPath = (0, _utils.nodeResolvePath)(modulePath, currentFile, extensions);
  if (resolvedPath === null && loglevel !== 'silent') {
    (0, _log.warn)(`Could not resolve "${modulePath}" in file ${currentFile}.`);
  }
}
function resolvePathFromAliasConfig(sourcePath, currentFile, opts) {
  let aliasedSourceFile;
  opts.alias.find(([regExp, substitute]) => {
    const execResult = regExp.exec(sourcePath);
    if (execResult === null) {
      return false;
    }
    aliasedSourceFile = substitute(execResult);
    return true;
  });
  if (!aliasedSourceFile) {
    return null;
  }

  // Alias with array of paths
  if (Array.isArray(aliasedSourceFile)) {
    return aliasedSourceFile.map(asf => {
      if ((0, _utils.isRelativePath)(asf)) {
        return (0, _utils.toLocalPath)((0, _utils.toPosixPath)((0, _mapToRelative.default)(opts.cwd, currentFile, asf)));
      }
      return asf;
    }).find(src => (0, _utils.nodeResolvePath)(src, _path.default.dirname(currentFile), opts.extensions));
  }
  if ((0, _utils.isRelativePath)(aliasedSourceFile)) {
    return (0, _utils.toLocalPath)((0, _utils.toPosixPath)((0, _mapToRelative.default)(opts.cwd, currentFile, aliasedSourceFile)));
  }
  if (process.env.NODE_ENV !== 'production') {
    checkIfPackageExists(aliasedSourceFile, currentFile, opts.extensions, opts.loglevel);
  }
  return aliasedSourceFile;
}
const resolvers = [resolvePathFromAliasConfig, resolvePathFromRootConfig];
function resolvePath(sourcePath, currentFile, opts) {
  if ((0, _utils.isRelativePath)(sourcePath)) {
    return sourcePath;
  }
  const normalizedOpts = (0, _normalizeOptions.default)(currentFile, opts);

  // File param is a relative path from the environment current working directory
  // (not from cwd param)
  const absoluteCurrentFile = _path.default.resolve(currentFile);
  let resolvedPath = null;
  resolvers.some(resolver => {
    resolvedPath = resolver(sourcePath, absoluteCurrentFile, normalizedOpts);
    return resolvedPath !== null;
  });
  return resolvedPath;
}