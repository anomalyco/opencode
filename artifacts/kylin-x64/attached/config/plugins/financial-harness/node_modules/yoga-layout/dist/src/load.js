/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

// @ts-ignore untyped from Emscripten
import loadYogaImpl from '../binaries/yoga-wasm-base64-esm.js';
import wrapAssembly from "./wrapAssembly.js";
export async function loadYoga() {
  return wrapAssembly(await loadYogaImpl());
}
export * from "./generated/YGEnums.js";
//# sourceMappingURL=load.js.map