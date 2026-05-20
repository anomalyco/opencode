"use strict";

exports.__esModule = true;
exports.default = mapPathString;
var _resolvePath = _interopRequireDefault(require("./resolvePath"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function mapPathString(nodePath, state) {
  if (!state.types.isStringLiteral(nodePath)) {
    return;
  }
  const sourcePath = nodePath.node.value;
  const currentFile = state.file.opts.filename;
  const resolvePath = state.normalizedOpts.customResolvePath || _resolvePath.default;
  const modulePath = resolvePath(sourcePath, currentFile, state.opts);
  if (modulePath) {
    if (nodePath.node.pathResolved) {
      return;
    }
    nodePath.replaceWith(state.types.stringLiteral(modulePath));
    nodePath.node.pathResolved = true;
  }
}