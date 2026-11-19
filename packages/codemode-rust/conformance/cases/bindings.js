// @bindings {"n": 2, "cfg": {"name": "demo", "tags": ["a", "b"]}, "flag": false, "nothing": null}
return { doubled: n * 2, name: cfg.name.toUpperCase(), tags: cfg.tags.length, flag, nothing }
