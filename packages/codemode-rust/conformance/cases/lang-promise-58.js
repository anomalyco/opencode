const promise = Promise.resolve(1); return [promise].includes(Promise.resolve(promise))
