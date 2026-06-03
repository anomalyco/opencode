/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

// @ts-nocheck

import { Unit, Direction } from "./generated/YGEnums.js";
import YGEnums from "./generated/YGEnums.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function wrapAssembly(lib) {
  function patch(prototype, name, fn) {
    const original = prototype[name];
    prototype[name] = function () {
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      return fn.call(this, original, ...args);
    };
  }
  for (const fnName of ['setPosition', 'setMargin', 'setFlexBasis', 'setWidth', 'setHeight', 'setMinWidth', 'setMinHeight', 'setMaxWidth', 'setMaxHeight', 'setPadding', 'setGap']) {
    const methods = {
      [Unit.Point]: lib.Node.prototype[fnName],
      [Unit.Percent]: lib.Node.prototype[`${fnName}Percent`],
      [Unit.Auto]: lib.Node.prototype[`${fnName}Auto`]
    };
    patch(lib.Node.prototype, fnName, function (original) {
      for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
        args[_key2 - 1] = arguments[_key2];
      }
      // We patch all these functions to add support for the following calls:
      // .setWidth(100) / .setWidth("100%") / .setWidth(.getWidth()) / .setWidth("auto")

      const value = args.pop();
      let unit, asNumber;
      if (value === 'auto') {
        unit = Unit.Auto;
        asNumber = undefined;
      } else if (typeof value === 'object') {
        unit = value.unit;
        asNumber = value.valueOf();
      } else {
        unit = typeof value === 'string' && value.endsWith('%') ? Unit.Percent : Unit.Point;
        asNumber = parseFloat(value);
        if (value !== undefined && !Number.isNaN(value) && Number.isNaN(asNumber)) {
          throw new Error(`Invalid value ${value} for ${fnName}`);
        }
      }
      if (!methods[unit]) throw new Error(`Failed to execute "${fnName}": Unsupported unit '${value}'`);
      if (asNumber !== undefined) {
        return methods[unit].call(this, ...args, asNumber);
      } else {
        return methods[unit].call(this, ...args);
      }
    });
  }
  function wrapMeasureFunction(measureFunction) {
    return lib.MeasureCallback.implement({
      measure: function () {
        const {
          width,
          height
        } = measureFunction(...arguments);
        return {
          width: width ?? NaN,
          height: height ?? NaN
        };
      }
    });
  }
  patch(lib.Node.prototype, 'setMeasureFunc', function (original, measureFunc) {
    // This patch is just a convenience patch, since it helps write more
    // idiomatic source code (such as .setMeasureFunc(null))
    if (measureFunc) {
      return original.call(this, wrapMeasureFunction(measureFunc));
    } else {
      return this.unsetMeasureFunc();
    }
  });
  function wrapDirtiedFunc(dirtiedFunction) {
    return lib.DirtiedCallback.implement({
      dirtied: dirtiedFunction
    });
  }
  patch(lib.Node.prototype, 'setDirtiedFunc', function (original, dirtiedFunc) {
    original.call(this, wrapDirtiedFunc(dirtiedFunc));
  });
  patch(lib.Config.prototype, 'free', function () {
    // Since we handle the memory allocation ourselves (via lib.Config.create),
    // we also need to handle the deallocation
    lib.Config.destroy(this);
  });
  patch(lib.Node, 'create', (_, config) => {
    // We decide the constructor we want to call depending on the parameters
    return config ? lib.Node.createWithConfig(config) : lib.Node.createDefault();
  });
  patch(lib.Node.prototype, 'free', function () {
    // Since we handle the memory allocation ourselves (via lib.Node.create),
    // we also need to handle the deallocation
    lib.Node.destroy(this);
  });
  patch(lib.Node.prototype, 'freeRecursive', function () {
    for (let t = 0, T = this.getChildCount(); t < T; ++t) {
      this.getChild(0).freeRecursive();
    }
    this.free();
  });
  patch(lib.Node.prototype, 'calculateLayout', function (original) {
    let width = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : NaN;
    let height = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : NaN;
    let direction = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : Direction.LTR;
    // Just a small patch to add support for the function default parameters
    return original.call(this, width, height, direction);
  });
  return {
    Config: lib.Config,
    Node: lib.Node,
    ...YGEnums
  };
}
//# sourceMappingURL=wrapAssembly.js.map