/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

// @ts-ignore untyped from Emscripten
import loadYoga from '../binaries/yoga-wasm-base64-esm.js';
import wrapAssembly from './wrapAssembly.ts';

export type {
  Config,
  DirtiedFunction,
  MeasureFunction,
  Node,
} from './wrapAssembly.ts';

const Yoga = wrapAssembly(await loadYoga());
export default Yoga;
export * from './generated/YGEnums.ts';
