/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <yoga/Yoga.h>

struct Value {
  static Value fromYGValue(YGValue const& ygValue) {
    return Value(static_cast<int>(ygValue.unit), ygValue.value);
  }

  int unit;
  double value;

  Value(void) : unit(YGUnitUndefined), value(0.0) {}

  Value(int unit, double value) : unit(unit), value(value) {}
};
