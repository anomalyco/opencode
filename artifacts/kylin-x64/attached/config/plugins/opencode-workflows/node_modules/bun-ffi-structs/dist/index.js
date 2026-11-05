// src/ffi.ts
var FFI_LOAD_ERROR = "bun-ffi-structs requires Bun or Node.js with node:ffi enabled (--experimental-ffi --allow-ffi).";
var backend = await loadBackend();
function unavailable(cause) {
  throw new Error(FFI_LOAD_ERROR, {
    cause: cause instanceof Error ? cause : undefined
  });
}
function createUnsupportedBackend(cause) {
  return {
    ptr() {
      return unavailable(cause);
    },
    toArrayBuffer() {
      return unavailable(cause);
    }
  };
}
async function loadBackend() {
  if (typeof process !== "undefined" && "bun" in process.versions) {
    return createBunBackend(await importModule("bun:ffi"));
  }
  try {
    return createNodeBackend(await importModule("node:ffi"));
  } catch (error) {
    return createUnsupportedBackend(error);
  }
}
function importModule(specifier) {
  return import(specifier).then((module) => module.default ?? module);
}
function createBunBackend(bun) {
  return {
    ptr: bun.ptr,
    toArrayBuffer(pointer, offset, length) {
      return bun.toArrayBuffer(toBunPointer(pointer), offset, length);
    }
  };
}
function createNodeBackend(nodeFfi) {
  return {
    ptr(value) {
      if (ArrayBuffer.isView(value)) {
        return nodeFfi.getRawPointer(value.buffer) + BigInt(value.byteOffset);
      }
      if (value instanceof ArrayBuffer) {
        return nodeFfi.getRawPointer(value);
      }
      throw new TypeError("node:ffi ptr() only supports ArrayBuffer and ArrayBufferView values.");
    },
    toArrayBuffer(pointer, offset, length) {
      return nodeFfi.toArrayBuffer(toBigIntPointer(pointer) + BigInt(offset ?? 0), length, false);
    }
  };
}
function toBigIntPointer(pointer) {
  return typeof pointer === "bigint" ? pointer : BigInt(pointer);
}
function toBunPointer(pointer) {
  return typeof pointer === "bigint" ? Number(pointer) : pointer;
}
var ptr = backend.ptr;
var toArrayBuffer = backend.toArrayBuffer;

// src/structs_ffi.ts
function fatalError(...args) {
  const message = args.join(" ");
  console.error("FATAL ERROR:", message);
  throw new Error(message);
}
var pointerSize = process.arch === "x64" || process.arch === "arm64" ? 8 : 4;
var isBun = typeof process !== "undefined" && "bun" in process.versions;
var typeSizes = {
  u8: 1,
  bool_u8: 1,
  bool_u32: 4,
  u16: 2,
  i16: 2,
  u32: 4,
  u64: 8,
  f32: 4,
  f64: 8,
  pointer: pointerSize,
  i32: 4,
  i64: 8
};
var primitiveKeys = Object.keys(typeSizes);
function isPrimitiveType(type) {
  return typeof type === "string" && primitiveKeys.includes(type);
}
var typeAlignments = { ...typeSizes };
var typeGetters = {
  u8: (view, offset) => view.getUint8(offset),
  bool_u8: (view, offset) => Boolean(view.getUint8(offset)),
  bool_u32: (view, offset) => Boolean(view.getUint32(offset, true)),
  u16: (view, offset) => view.getUint16(offset, true),
  i16: (view, offset) => view.getInt16(offset, true),
  u32: (view, offset) => view.getUint32(offset, true),
  u64: (view, offset) => view.getBigUint64(offset, true),
  f32: (view, offset) => view.getFloat32(offset, true),
  f64: (view, offset) => view.getFloat64(offset, true),
  i32: (view, offset) => view.getInt32(offset, true),
  i64: (view, offset) => view.getBigInt64(offset, true),
  pointer: (view, offset) => pointerSize === 8 ? view.getBigUint64(offset, true) : BigInt(view.getUint32(offset, true))
};
function objectPtr() {
  return {
    __type: "objectPointer"
  };
}
function isObjectPointerDef(type) {
  return typeof type === "object" && type !== null && type.__type === "objectPointer";
}
function allocStruct(structDef, options) {
  const buffer = new ArrayBuffer(structDef.size);
  const view = new DataView(buffer);
  const result = { buffer, view };
  const { pack: pointerPacker } = primitivePackers("pointer");
  if (options?.lengths) {
    const subBuffers = {};
    for (const [arrayFieldName, length] of Object.entries(options.lengths)) {
      const arrayMeta = structDef.arrayFields.get(arrayFieldName);
      if (!arrayMeta) {
        throw new Error(`Field '${arrayFieldName}' is not an array field with a lengthOf field`);
      }
      const subBuffer = new ArrayBuffer(length * arrayMeta.elementSize);
      subBuffers[arrayFieldName] = subBuffer;
      const pointer = length > 0 ? ptr(subBuffer) : null;
      pointerPacker(view, arrayMeta.arrayOffset, pointer);
      retainPointerTarget(buffer, subBuffer);
      arrayMeta.lengthPack(view, arrayMeta.lengthOffset, length);
    }
    if (Object.keys(subBuffers).length > 0) {
      result.subBuffers = subBuffers;
    }
  }
  return result;
}
function alignOffset(offset, align) {
  return offset + (align - 1) & ~(align - 1);
}
function enumTypeError(value) {
  throw new TypeError(`Invalid enum value: ${value}`);
}
function defineEnum(mapping, base = "u32") {
  const reverse = Object.fromEntries(Object.entries(mapping).map(([k, v]) => [v, k]));
  return {
    __type: "enum",
    type: base,
    to(value) {
      return typeof value === "number" ? value : mapping[value] ?? enumTypeError(String(value));
    },
    from(value) {
      return reverse[value] ?? enumTypeError(String(value));
    },
    enum: mapping
  };
}
function isEnum(type) {
  return typeof type === "object" && type.__type === "enum";
}
function isStruct(type) {
  return typeof type === "object" && type.__type === "struct";
}
function primitivePackers(type) {
  let pack;
  let unpack;
  switch (type) {
    case "u8":
      pack = (view, off, val) => view.setUint8(off, val);
      unpack = (view, off) => view.getUint8(off);
      break;
    case "bool_u8":
      pack = (view, off, val) => view.setUint8(off, val ? 1 : 0);
      unpack = (view, off) => Boolean(view.getUint8(off));
      break;
    case "bool_u32":
      pack = (view, off, val) => view.setUint32(off, val ? 1 : 0, true);
      unpack = (view, off) => Boolean(view.getUint32(off, true));
      break;
    case "u16":
      pack = (view, off, val) => view.setUint16(off, val, true);
      unpack = (view, off) => view.getUint16(off, true);
      break;
    case "i16":
      pack = (view, off, val) => view.setInt16(off, val, true);
      unpack = (view, off) => view.getInt16(off, true);
      break;
    case "u32":
      pack = (view, off, val) => view.setUint32(off, val, true);
      unpack = (view, off) => view.getUint32(off, true);
      break;
    case "i32":
      pack = (view, off, val) => view.setInt32(off, val, true);
      unpack = (view, off) => view.getInt32(off, true);
      break;
    case "i64":
      pack = (view, off, val) => view.setBigInt64(off, BigInt(val), true);
      unpack = (view, off) => view.getBigInt64(off, true);
      break;
    case "u64":
      pack = (view, off, val) => view.setBigUint64(off, BigInt(val), true);
      unpack = (view, off) => view.getBigUint64(off, true);
      break;
    case "f32":
      pack = (view, off, val) => view.setFloat32(off, val, true);
      unpack = (view, off) => view.getFloat32(off, true);
      break;
    case "f64":
      pack = (view, off, val) => view.setFloat64(off, val, true);
      unpack = (view, off) => view.getFloat64(off, true);
      break;
    case "pointer":
      pack = (view, off, val) => {
        pointerSize === 8 ? view.setBigUint64(off, val ? BigInt(val) : 0n, true) : view.setUint32(off, val ? Number(val) : 0, true);
      };
      unpack = (view, off) => {
        if (pointerSize === 8) {
          const value = view.getBigUint64(off, true);
          return isBun ? Number(value) : value;
        }
        return view.getUint32(off, true);
      };
      break;
    default:
      fatalError(`Unsupported primitive type: ${type}`);
  }
  return { pack, unpack };
}
var { pack: pointerPacker, unpack: pointerUnpacker } = primitivePackers("pointer");
var retainedPointerTargets = new WeakMap;
function retainPointerTarget(owner, target) {
  const retained = retainedPointerTargets.get(owner);
  if (retained) {
    retained.push(target);
  } else {
    retainedPointerTargets.set(owner, [target]);
  }
}
function retainIfPointerTargets(owner, target) {
  if (retainedPointerTargets.has(target)) {
    retainPointerTarget(owner, target);
  }
}
function isNullPointer(pointer) {
  return pointer == null || pointer === 0 || pointer === 0n;
}
function toItemCount(length) {
  return typeof length === "bigint" ? Number(length) : length;
}
function packObjectArray(val) {
  const buffer = new ArrayBuffer(val.length * pointerSize);
  const bufferView = new DataView(buffer);
  for (let i = 0;i < val.length; i++) {
    const instance = val[i];
    const ptrValue = instance?.ptr ?? null;
    pointerPacker(bufferView, i * pointerSize, ptrValue);
  }
  return bufferView;
}
var encoder = new TextEncoder;
var decoder = new TextDecoder;
function defineStruct(fields, structDefOptions) {
  let offset = 0;
  let maxAlign = 1;
  const layout = [];
  const lengthOfFields = {};
  const lengthOfRequested = [];
  const arrayFieldsMetadata = {};
  for (const [name, typeOrStruct, options = {}] of fields) {
    if (options.condition && !options.condition()) {
      continue;
    }
    let size = 0, align = 0;
    let pack;
    let unpack;
    let needsLengthOf = false;
    let lengthOfDef = null;
    if (isPrimitiveType(typeOrStruct)) {
      size = typeSizes[typeOrStruct];
      align = typeAlignments[typeOrStruct];
      ({ pack, unpack } = primitivePackers(typeOrStruct));
      if (typeOrStruct === "pointer") {
        pack = (view, off, val) => {
          if (val instanceof ArrayBuffer || ArrayBuffer.isView(val)) {
            if (val.byteLength === 0) {
              pointerPacker(view, off, null);
              return;
            }
            pointerPacker(view, off, ptr(val));
            retainPointerTarget(view.buffer, val);
            return;
          }
          pointerPacker(view, off, val);
        };
      }
    } else if (typeof typeOrStruct === "string" && typeOrStruct === "cstring") {
      size = pointerSize;
      align = pointerSize;
      pack = (view, off, val) => {
        if (!val) {
          pointerPacker(view, off, null);
          return;
        }
        const bytes = encoder.encode(val + "\x00");
        const bufPtr = ptr(bytes);
        pointerPacker(view, off, bufPtr);
        retainPointerTarget(view.buffer, bytes);
      };
      unpack = (view, off) => {
        const ptrVal = pointerUnpacker(view, off);
        return ptrVal;
      };
    } else if (typeof typeOrStruct === "string" && typeOrStruct === "char*") {
      size = pointerSize;
      align = pointerSize;
      pack = (view, off, val) => {
        if (!val) {
          pointerPacker(view, off, null);
          return;
        }
        const bytes = encoder.encode(val);
        const bufPtr = ptr(bytes);
        pointerPacker(view, off, bufPtr);
        retainPointerTarget(view.buffer, bytes);
      };
      unpack = (view, off) => {
        const ptrVal = pointerUnpacker(view, off);
        return ptrVal;
      };
      needsLengthOf = true;
    } else if (isEnum(typeOrStruct)) {
      const base = typeOrStruct.type;
      size = typeSizes[base];
      align = typeAlignments[base];
      const { pack: packEnum } = primitivePackers(base);
      pack = (view, off, val) => {
        const num = typeOrStruct.to(val);
        packEnum(view, off, num);
      };
      unpack = (view, off) => {
        const raw = typeGetters[base](view, off);
        return typeOrStruct.from(raw);
      };
    } else if (isStruct(typeOrStruct)) {
      if (options.asPointer === true) {
        size = pointerSize;
        align = pointerSize;
        pack = (view, off, val, obj, options2) => {
          if (!val) {
            pointerPacker(view, off, null);
            return;
          }
          const nestedBuf = typeOrStruct.pack(val, options2);
          pointerPacker(view, off, ptr(nestedBuf));
          retainPointerTarget(view.buffer, nestedBuf);
        };
        unpack = (view, off) => {
          throw new Error("Not implemented yet");
        };
      } else {
        size = typeOrStruct.size;
        align = typeOrStruct.align;
        pack = (view, off, val, obj, options2) => {
          const nestedBuf = typeOrStruct.pack(val, options2);
          const nestedView = new Uint8Array(nestedBuf);
          const dView = new Uint8Array(view.buffer);
          dView.set(nestedView, off);
          retainIfPointerTargets(view.buffer, nestedBuf);
        };
        unpack = (view, off) => {
          const slice = view.buffer.slice(off, off + size);
          return typeOrStruct.unpack(slice);
        };
      }
    } else if (isObjectPointerDef(typeOrStruct)) {
      size = pointerSize;
      align = pointerSize;
      pack = (view, off, value) => {
        const ptrValue = value?.ptr ?? null;
        if (ptrValue === undefined) {
          console.warn(`Field '${name}' expected object with '.ptr' property, but got undefined pointer value from:`, value);
          pointerPacker(view, off, null);
        } else {
          pointerPacker(view, off, ptrValue);
        }
      };
      unpack = (view, off) => {
        return pointerUnpacker(view, off);
      };
    } else if (Array.isArray(typeOrStruct) && typeOrStruct.length === 1 && typeOrStruct[0] !== undefined) {
      const [def] = typeOrStruct;
      size = pointerSize;
      align = pointerSize;
      let arrayElementSize;
      if (isEnum(def)) {
        arrayElementSize = typeSizes[def.type];
        pack = (view, off, val, obj) => {
          if (!val || val.length === 0) {
            pointerPacker(view, off, null);
            return;
          }
          const buffer = new ArrayBuffer(val.length * arrayElementSize);
          const bufferView = new DataView(buffer);
          for (let i = 0;i < val.length; i++) {
            const num = def.to(val[i]);
            bufferView.setUint32(i * arrayElementSize, num, true);
          }
          pointerPacker(view, off, ptr(buffer));
          retainPointerTarget(view.buffer, buffer);
        };
        unpack = null;
        needsLengthOf = true;
        lengthOfDef = def;
      } else if (isStruct(def)) {
        arrayElementSize = def.size;
        pack = (view, off, val, obj, options2) => {
          if (!val || val.length === 0) {
            pointerPacker(view, off, null);
            return;
          }
          const buffer = new ArrayBuffer(val.length * arrayElementSize);
          const bufferView = new DataView(buffer);
          for (let i = 0;i < val.length; i++) {
            def.packInto(val[i], bufferView, i * arrayElementSize, options2);
          }
          pointerPacker(view, off, ptr(buffer));
          retainPointerTarget(view.buffer, buffer);
        };
        unpack = (view, off) => {
          throw new Error("Not implemented yet");
        };
      } else if (isPrimitiveType(def)) {
        arrayElementSize = typeSizes[def];
        const { pack: primitivePack } = primitivePackers(def);
        pack = (view, off, val) => {
          if (!val || val.length === 0) {
            pointerPacker(view, off, null);
            return;
          }
          const buffer = new ArrayBuffer(val.length * arrayElementSize);
          const bufferView = new DataView(buffer);
          for (let i = 0;i < val.length; i++) {
            primitivePack(bufferView, i * arrayElementSize, val[i]);
          }
          pointerPacker(view, off, ptr(buffer));
          retainPointerTarget(view.buffer, buffer);
        };
        unpack = null;
        needsLengthOf = true;
        lengthOfDef = def;
      } else if (isObjectPointerDef(def)) {
        arrayElementSize = pointerSize;
        pack = (view, off, val) => {
          if (!val || val.length === 0) {
            pointerPacker(view, off, null);
            return;
          }
          const packedView = packObjectArray(val);
          pointerPacker(view, off, ptr(packedView.buffer));
          retainPointerTarget(view.buffer, packedView.buffer);
        };
        unpack = () => {
          throw new Error("not implemented yet");
        };
      } else {
        throw new Error(`Unsupported array element type for ${name}: ${JSON.stringify(def)}`);
      }
      const lengthOfField = Object.values(lengthOfFields).find((f) => f.lengthOf === name);
      if (lengthOfField && isPrimitiveType(lengthOfField.type)) {
        const { pack: lengthPack } = primitivePackers(lengthOfField.type);
        arrayFieldsMetadata[name] = {
          elementSize: arrayElementSize,
          arrayOffset: offset,
          lengthOffset: lengthOfField.offset,
          lengthPack
        };
      }
    } else {
      throw new Error(`Unsupported field type for ${name}: ${JSON.stringify(typeOrStruct)}`);
    }
    offset = alignOffset(offset, align);
    if (options.unpackTransform) {
      const originalUnpack = unpack;
      unpack = (view, off) => options.unpackTransform(originalUnpack(view, off));
    }
    if (options.packTransform) {
      const originalPack = pack;
      pack = (view, off, val, obj, packOptions) => originalPack(view, off, options.packTransform(val), obj, packOptions);
    }
    if (options.optional) {
      const originalPack = pack;
      if (isStruct(typeOrStruct) && !options.asPointer) {
        pack = (view, off, val, obj, packOptions) => {
          if (val || options.mapOptionalInline) {
            originalPack(view, off, val, obj, packOptions);
          }
        };
      } else {
        pack = (view, off, val, obj, packOptions) => originalPack(view, off, val ?? 0, obj, packOptions);
      }
    }
    if (options.lengthOf) {
      const originalPack = pack;
      pack = (view, off, val, obj, packOptions) => {
        const targetValue = obj[options.lengthOf];
        let length = 0;
        if (targetValue) {
          if (typeof targetValue === "string") {
            length = Buffer.byteLength(targetValue);
          } else {
            length = targetValue.length;
          }
        }
        return originalPack(view, off, length, obj, packOptions);
      };
    }
    let validateFunctions;
    if (options.validate) {
      validateFunctions = Array.isArray(options.validate) ? options.validate : [options.validate];
    }
    const layoutField = {
      name,
      offset,
      size,
      align,
      validate: validateFunctions,
      optional: !!options.optional || !!options.lengthOf || options.default !== undefined,
      default: options.default,
      pack,
      unpack,
      type: typeOrStruct,
      lengthOf: options.lengthOf
    };
    layout.push(layoutField);
    if (options.lengthOf) {
      lengthOfFields[options.lengthOf] = layoutField;
    }
    if (needsLengthOf) {
      const def = typeof typeOrStruct === "string" && typeOrStruct === "char*" ? "char*" : lengthOfDef;
      if (!def)
        fatalError(`Internal error: needsLengthOf=true but def is null for ${name}`);
      lengthOfRequested.push({ requester: layoutField, def });
    }
    offset += size;
    maxAlign = Math.max(maxAlign, align);
  }
  for (const { requester, def } of lengthOfRequested) {
    const lengthOfField = lengthOfFields[requester.name];
    if (!lengthOfField) {
      if (def === "char*") {
        continue;
      }
      throw new Error(`lengthOf field not found for array field ${requester.name}`);
    }
    if (def === "char*") {
      const relativeOffset = lengthOfField.offset - requester.offset;
      requester.unpack = (view, off) => {
        const ptrAddress = pointerUnpacker(view, off);
        const length = lengthOfField.unpack(view, off + relativeOffset);
        if (isNullPointer(ptrAddress)) {
          return null;
        }
        const byteLength = toItemCount(length);
        if (byteLength === 0) {
          return "";
        }
        const buffer = toArrayBuffer(ptrAddress, 0, byteLength);
        return decoder.decode(buffer);
      };
    } else if (isPrimitiveType(def)) {
      const elemSize = typeSizes[def];
      const { unpack: primitiveUnpack } = primitivePackers(def);
      const relativeOffset = lengthOfField.offset - requester.offset;
      requester.unpack = (view, off) => {
        const result = [];
        const length = lengthOfField.unpack(view, off + relativeOffset);
        const itemCount = toItemCount(length);
        const ptrAddress = pointerUnpacker(view, off);
        if (isNullPointer(ptrAddress) && itemCount > 0) {
          throw new Error(`Array field ${requester.name} has null pointer but length ${length}.`);
        }
        if (isNullPointer(ptrAddress) || itemCount === 0) {
          return [];
        }
        const buffer = toArrayBuffer(ptrAddress, 0, itemCount * elemSize);
        const bufferView = new DataView(buffer);
        for (let i = 0;i < itemCount; i++) {
          result.push(primitiveUnpack(bufferView, i * elemSize));
        }
        return result;
      };
    } else {
      const elemSize = def.type === "u32" ? 4 : 8;
      const relativeOffset = lengthOfField.offset - requester.offset;
      requester.unpack = (view, off) => {
        const result = [];
        const length = lengthOfField.unpack(view, off + relativeOffset);
        const itemCount = toItemCount(length);
        const ptrAddress = pointerUnpacker(view, off);
        if (isNullPointer(ptrAddress) && itemCount > 0) {
          throw new Error(`Array field ${requester.name} has null pointer but length ${length}.`);
        }
        if (isNullPointer(ptrAddress) || itemCount === 0) {
          return [];
        }
        const buffer = toArrayBuffer(ptrAddress, 0, itemCount * elemSize);
        const bufferView = new DataView(buffer);
        for (let i = 0;i < itemCount; i++) {
          result.push(def.from(bufferView.getUint32(i * elemSize, true)));
        }
        return result;
      };
    }
  }
  const totalSize = alignOffset(offset, maxAlign);
  const description = layout.map((f) => ({
    name: f.name,
    offset: f.offset,
    size: f.size,
    align: f.align,
    optional: f.optional,
    type: f.type,
    lengthOf: f.lengthOf
  }));
  const layoutByName = new Map(description.map((f) => [f.name, f]));
  const arrayFields = new Map(Object.entries(arrayFieldsMetadata));
  return {
    __type: "struct",
    size: totalSize,
    align: maxAlign,
    hasMapValue: !!structDefOptions?.mapValue,
    layoutByName,
    arrayFields,
    pack(obj, options) {
      const buf = new ArrayBuffer(totalSize);
      const view = new DataView(buf);
      let mappedObj = obj;
      if (structDefOptions?.mapValue) {
        mappedObj = structDefOptions.mapValue(obj);
      }
      for (const field of layout) {
        const value = mappedObj[field.name] ?? field.default;
        if (!field.optional && value === undefined) {
          fatalError(`Packing non-optional field '${field.name}' but value is undefined (and no default provided)`);
        }
        if (field.validate) {
          for (const validateFn of field.validate) {
            validateFn(value, field.name, {
              hints: options?.validationHints,
              input: mappedObj
            });
          }
        }
        field.pack(view, field.offset, value, mappedObj, options);
      }
      return view.buffer;
    },
    packInto(obj, view, offset2, options) {
      let mappedObj = obj;
      if (structDefOptions?.mapValue) {
        mappedObj = structDefOptions.mapValue(obj);
      }
      for (const field of layout) {
        const value = mappedObj[field.name] ?? field.default;
        if (!field.optional && value === undefined) {
          console.warn(`packInto missing value for non-optional field '${field.name}' at offset ${offset2 + field.offset}. Writing default or zero.`);
        }
        if (field.validate) {
          for (const validateFn of field.validate) {
            validateFn(value, field.name, {
              hints: options?.validationHints,
              input: mappedObj
            });
          }
        }
        field.pack(view, offset2 + field.offset, value, mappedObj, options);
      }
    },
    unpack(buf) {
      if (buf.byteLength < totalSize) {
        fatalError(`Buffer size (${buf.byteLength}) is smaller than struct size (${totalSize}) for unpacking.`);
      }
      const view = new DataView(buf);
      const result = structDefOptions?.default ? { ...structDefOptions.default } : {};
      for (const field of layout) {
        if (!field.unpack) {
          continue;
        }
        try {
          result[field.name] = field.unpack(view, field.offset);
        } catch (e) {
          console.error(`Error unpacking field '${field.name}' at offset ${field.offset}:`, e);
          throw e;
        }
      }
      if (structDefOptions?.reduceValue) {
        return structDefOptions.reduceValue(result);
      }
      return result;
    },
    packList(objects, options) {
      if (objects.length === 0) {
        return new ArrayBuffer(0);
      }
      const buffer = new ArrayBuffer(totalSize * objects.length);
      const view = new DataView(buffer);
      for (let i = 0;i < objects.length; i++) {
        let mappedObj = objects[i];
        if (structDefOptions?.mapValue) {
          mappedObj = structDefOptions.mapValue(objects[i]);
        }
        for (const field of layout) {
          const value = mappedObj[field.name] ?? field.default;
          if (!field.optional && value === undefined) {
            fatalError(`Packing non-optional field '${field.name}' at index ${i} but value is undefined (and no default provided)`);
          }
          if (field.validate) {
            for (const validateFn of field.validate) {
              validateFn(value, field.name, {
                hints: options?.validationHints,
                input: mappedObj
              });
            }
          }
          field.pack(view, i * totalSize + field.offset, value, mappedObj, options);
        }
      }
      return buffer;
    },
    unpackList(buf, count) {
      if (count === 0) {
        return [];
      }
      const expectedSize = totalSize * count;
      if (buf.byteLength < expectedSize) {
        fatalError(`Buffer size (${buf.byteLength}) is smaller than expected size (${expectedSize}) for unpacking ${count} structs.`);
      }
      const view = new DataView(buf);
      const results = [];
      for (let i = 0;i < count; i++) {
        const offset2 = i * totalSize;
        const result = structDefOptions?.default ? { ...structDefOptions.default } : {};
        for (const field of layout) {
          if (!field.unpack) {
            continue;
          }
          try {
            result[field.name] = field.unpack(view, offset2 + field.offset);
          } catch (e) {
            console.error(`Error unpacking field '${field.name}' at index ${i}, offset ${offset2 + field.offset}:`, e);
            throw e;
          }
        }
        if (structDefOptions?.reduceValue) {
          results.push(structDefOptions.reduceValue(result));
        } else {
          results.push(result);
        }
      }
      return results;
    },
    describe() {
      return description;
    }
  };
}
export {
  pointerSize,
  packObjectArray,
  objectPtr,
  defineStruct,
  defineEnum,
  allocStruct
};
