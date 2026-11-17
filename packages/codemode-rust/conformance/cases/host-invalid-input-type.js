try { await tools.echo({ id: "7" }) } catch (e) { return [e.name, e.message] }
