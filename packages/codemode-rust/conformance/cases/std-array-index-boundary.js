const a = []; a[4294967295] = "x"; a[4294967296] = "y"; a["-1"] = "z"; return [a.length, a[4294967295], a[4294967296], a[-1], Object.keys(a), JSON.stringify(a)]
