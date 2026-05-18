'use strict';

var h = require('solid-js/h');

function Fragment(props) {
  return props.children;
}
function jsx(type, props) {
  return h(type, props);
}

exports.Fragment = Fragment;
exports.jsx = jsx;
exports.jsxDEV = jsx;
exports.jsxs = jsx;
