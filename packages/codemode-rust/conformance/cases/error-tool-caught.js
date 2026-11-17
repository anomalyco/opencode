try { await tools.fail({}) } catch (e) { return [e instanceof Error, e.message] }
