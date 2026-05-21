import type { SerovalNode } from 'seroval';
import { createPlugin } from 'seroval';

const URLPlugin = /* @__PURE__ */ createPlugin<URL, { value: SerovalNode }>({
  tag: 'seroval-plugins/web/URL',
  test(value) {
    if (typeof URL === 'undefined') {
      return false;
    }
    return value instanceof URL;
  },
  parse: {
    sync(value, ctx) {
      return {
        value: ctx.parse(value.href),
      };
    },
    async async(value, ctx) {
      return {
        value: await ctx.parse(value.href),
      };
    },
    stream(value, ctx) {
      return {
        value: ctx.parse(value.href),
      };
    },
  },
  serialize(node, ctx) {
    return 'new URL(' + ctx.serialize(node.value) + ')';
  },
  deserialize(node, ctx) {
    return new URL(ctx.deserialize(node.value) as string);
  },
});

export default URLPlugin;
