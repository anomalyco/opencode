let escaped
new Promise((resolve) => { escaped = resolve })
return { escaped, kind: typeof escaped }
