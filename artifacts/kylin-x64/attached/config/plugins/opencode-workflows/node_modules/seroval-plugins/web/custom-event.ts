import type { SerovalNode } from 'seroval';
import { createPlugin } from 'seroval';

function createCustomEventOptions(current: CustomEvent): CustomEventInit {
  return {
    detail: current.detail as unknown,
    bubbles: current.bubbles,
    cancelable: current.cancelable,
    composed: current.composed,
  };
}

type CustomEventNode = {
  type: SerovalNode;
  options: SerovalNode;
};

const CustomEventPlugin = /* @__PURE__ */ createPlugin<
  CustomEvent,
  CustomEventNode
>({
  tag: 'seroval-plugins/web/CustomEvent',
  test(value) {
    if (typeof CustomEvent === 'undefined') {
      return false;
    }
    return value instanceof CustomEvent;
  },
  parse: {
    sync(value, ctx) {
      return {
        type: ctx.parse(value.type),
        options: ctx.parse(createCustomEventOptions(value)),
      };
    },
    async async(value, ctx) {
      return {
        type: await ctx.parse(value.type),
        options: await ctx.parse(createCustomEventOptions(value)),
      };
    },
    stream(value, ctx) {
      return {
        type: ctx.parse(value.type),
        options: ctx.parse(createCustomEventOptions(value)),
      };
    },
  },
  serialize(node, ctx) {
    return (
      'new CustomEvent(' +
      ctx.serialize(node.type) +
      ',' +
      ctx.serialize(node.options) +
      ')'
    );
  },
  deserialize(node, ctx) {
    return new CustomEvent(
      ctx.deserialize(node.type) as string,
      ctx.deserialize(node.options) as CustomEventInit,
    );
  },
});

export default CustomEventPlugin;
