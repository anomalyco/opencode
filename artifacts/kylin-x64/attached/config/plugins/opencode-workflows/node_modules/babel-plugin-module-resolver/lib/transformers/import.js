"use strict";

exports.__esModule = true;
exports.default = transformImport;
var _mapPath = _interopRequireDefault(require("../mapPath"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function transformImport(nodePath, state) {
  if (state.moduleResolverVisited.has(nodePath)) {
    return;
  }
  state.moduleResolverVisited.add(nodePath);
  (0, _mapPath.default)(nodePath.get('source'), state);
}