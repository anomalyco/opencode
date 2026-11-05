import type { SerovalNode } from 'seroval';
import { createPlugin } from 'seroval';

type BlobNode = {
  type: SerovalNode;
  buffer: SerovalNode;
};

const BlobPlugin = /* @__PURE__ */ createPlugin<Blob, BlobNode>({
  tag: 'seroval-plugins/web/Blob',
  test(value) {
    if (typeof Blob === 'undefined') {
      return false;
    }
    return value instanceof Blob;
  },
  parse: {
    async async(value, ctx) {
      return {
        type: await ctx.parse(value.type),
        buffer: await ctx.parse(await value.arrayBuffer()),
      };
    },
  },
  serialize(node, ctx) {
    return (
      'new Blob([' +
      ctx.serialize(node.buffer) +
      '],{type:' +
      ctx.serialize(node.type) +
      '})'
    );
  },
  deserialize(node, ctx) {
    return new Blob([ctx.deserialize(node.buffer) as ArrayBuffer], {
      type: ctx.deserialize(node.type) as string,
    });
  },
});

export default BlobPlugin;
