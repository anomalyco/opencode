import { NIL, SerovalConstant, SerovalNodeType } from './constants';
import { createSerovalNode } from './node';
import type { SerovalConstantNode } from './types';

function createConstantNode(value: SerovalConstant): SerovalConstantNode {
  return createSerovalNode(
    SerovalNodeType.Constant,
    NIL,
    value,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
    NIL,
  );
}

export const TRUE_NODE = /* @__PURE__ */ createConstantNode(
  SerovalConstant.True,
);
export const FALSE_NODE = /* @__PURE__ */ createConstantNode(
  SerovalConstant.False,
);
export const UNDEFINED_NODE = /* @__PURE__ */ createConstantNode(
  SerovalConstant.Undefined,
);
export const NULL_NODE = /* @__PURE__ */ createConstantNode(
  SerovalConstant.Null,
);
export const NEG_ZERO_NODE = /* @__PURE__ */ createConstantNode(
  SerovalConstant.NegZero,
);
export const INFINITY_NODE = /* @__PURE__ */ createConstantNode(
  SerovalConstant.Inf,
);
export const NEG_INFINITY_NODE = /* @__PURE__ */ createConstantNode(
  SerovalConstant.NegInf,
);
export const NAN_NODE = /* @__PURE__ */ createConstantNode(SerovalConstant.Nan);
