const errors = []
try { let item = [1]; for (let item of item) {} } catch (error) { errors.push(error.name) }
try { let item = { value: 1 }; for (let item in item) {} } catch (error) { errors.push(error.name) }
return errors
