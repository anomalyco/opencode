import type { SerovalNode } from 'seroval';
import { createPlugin } from 'seroval';
import FilePlugin from './file';

type FormDataInit = [key: string, value: FormDataEntryValue][];

function convertFormData(instance: FormData): FormDataInit {
  const items: FormDataInit = [];
  instance.forEach((value, key) => {
    items.push([key, value]);
  });
  return items;
}

const FORM_DATA_FACTORY = {};

const FORM_DATA_FACTORY_CONSTRUCTOR = (
  e: [key: string, value: FormDataEntryValue][],
  f = new FormData(),
  i = 0,
  s = e.length,
  t?: [key: string, value: FormDataEntryValue],
) => {
  for (; i < s; i++) {
    t = e[i];
    f.append(t[0], t[1]);
  }
  return f;
};

const FormDataFactoryPlugin = /* @__PURE__ */ createPlugin<object, {}>({
  tag: 'seroval-plugins/web/FormDataFactory',
  test(value) {
    return value === FORM_DATA_FACTORY;
  },
  parse: {
    sync() {
      return FORM_DATA_FACTORY;
    },
    async async() {
      return await Promise.resolve(FORM_DATA_FACTORY);
    },
    stream() {
      return FORM_DATA_FACTORY;
    },
  },
  serialize() {
    return FORM_DATA_FACTORY_CONSTRUCTOR.toString();
  },
  deserialize() {
    return FORM_DATA_FACTORY;
  },
});

type FormDataNode = {
  factory: SerovalNode;
  entries: SerovalNode;
};

const FormDataPlugin = /* @__PURE__ */ createPlugin<FormData, FormDataNode>({
  tag: 'seroval-plugins/web/FormData',
  extends: [FilePlugin, FormDataFactoryPlugin],
  test(value) {
    if (typeof FormData === 'undefined') {
      return false;
    }
    return value instanceof FormData;
  },
  parse: {
    sync(value, ctx) {
      return {
        factory: ctx.parse(FORM_DATA_FACTORY),
        entries: ctx.parse(convertFormData(value)),
      };
    },
    async async(value, ctx) {
      return {
        factory: await ctx.parse(FORM_DATA_FACTORY),
        entries: await ctx.parse(convertFormData(value)),
      };
    },
    stream(value, ctx) {
      return {
        factory: ctx.parse(FORM_DATA_FACTORY),
        entries: ctx.parse(convertFormData(value)),
      };
    },
  },
  serialize(node, ctx) {
    return (
      '(' +
      ctx.serialize(node.factory) +
      ')(' +
      ctx.serialize(node.entries) +
      ')'
    );
  },
  deserialize(node, ctx) {
    return FORM_DATA_FACTORY_CONSTRUCTOR(
      ctx.deserialize(node.entries) as FormDataInit,
    );
  },
});

export default FormDataPlugin;
