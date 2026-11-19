try { JSON.parse("{bad") } catch (e) { return [e instanceof SyntaxError, e.name] }
