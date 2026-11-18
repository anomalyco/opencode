export const Resource = new Proxy($resource, {
  get(target, prop) {
    if (!(prop in target)) {
      throw new Error(`"${prop}" is not linked`);
    }
    return target[prop];
  },
});
