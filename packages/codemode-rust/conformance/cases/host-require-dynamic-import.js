const errors = []
try { require("fs") } catch (e) { errors.push(e.message) }
try { await import("child_process") } catch (e) { errors.push(e.message) }
try { require(1) } catch (e) { errors.push(e.name) }
return errors
