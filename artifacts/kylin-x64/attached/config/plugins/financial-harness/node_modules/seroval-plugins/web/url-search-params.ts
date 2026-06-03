import type { SerovalNode } from 'seroval';
import { createPlugin } from 'seroval';

const URLSearchParamsPlugin = /* @__PURE__ */ createPlugin<
  URLSearchParams,
  { value: SerovalNode }
>({
  tag: 'seroval-plugins/web/URLSearchParams',
  test(value) {
    if (typeof URLSearchParams === 'undefined') {
      return false;
    }
    return value instanceof URLSearchParams;
  },
  parse: {
    sync(value, ctx) {
      return {
        value: ctx.parse(value.toString()),
      };
    },
    async async(value, ctx) {
      return {
        value: await ctx.parse(value.toString()),
      };
    },
    stream(value, ctx) {
      return {
        value: ctx.parse(value.toString()),
      };
    },
  },
  serialize(node, ctx) {
    return 'new URLSearchParams(' + ctx.serialize(node.value) + ')';
  },
  deserialize(node, ctx) {
    return new URLSearchParams(ctx.deserialize(node.value) as string);
  },
});

export default URLSearchParamsPlugin;
