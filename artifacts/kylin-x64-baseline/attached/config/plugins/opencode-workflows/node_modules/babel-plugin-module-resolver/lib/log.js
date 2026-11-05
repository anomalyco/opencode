"use strict";

exports.__esModule = true;
exports.warn = warn;
// This module exists only for abstracting logging away and making testing easier

// eslint-disable-next-line import/prefer-default-export
function warn(...args) {
  // eslint-disable-next-line no-console
  console.warn(...args);
}