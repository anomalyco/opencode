import type { SerovalNode } from 'seroval';
import { createPlugin } from 'seroval';

type FileNode = {
  name: SerovalNode;
  options: SerovalNode;
  buffer: SerovalNode;
};

const FilePlugin = /* @__PURE__ */ createPlugin<File, FileNode>({
  tag: 'seroval-plugins/web/File',
  test(value) {
    if (typeof File === 'undefined') {
      return false;
    }
    return value instanceof File;
  },
  parse: {
    async async(value, ctx) {
      return {
        name: await ctx.parse(value.name),
        options: await ctx.parse({
          type: value.type,
          lastModified: value.lastModified,
        }),
        buffer: await ctx.parse(await value.arrayBuffer()),
      };
    },
  },
  serialize(node, ctx) {
    return (
      'new File([' +
      ctx.serialize(node.buffer) +
      '],' +
      ctx.serialize(node.name) +
      ',' +
      ctx.serialize(node.options) +
      ')'
    );
  },
  deserialize(node, ctx) {
    return new File(
      [ctx.deserialize(node.buffer) as ArrayBuffer],
      ctx.deserialize(node.name) as string,
      ctx.deserialize(node.options) as FilePropertyBag,
    );
  },
});

export default FilePlugin;
