"use strict";

let parse = require("./parser-sync");
let pack = require("./packer-sync");

exports.read = function (buffer, options) {
  return parse(buffer, options || {});
};

exports.write = function (png, options) {
  return pack(png, options);
};
