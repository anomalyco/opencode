const errors = []
try { { let item = item + 1 } } catch (error) { errors.push(error.name) }
try { { const item = item + 1 } } catch (error) { errors.push(error.name) }
try {
  {
    function assign() { item = 1 }
    assign()
    let item
  }
} catch (error) { errors.push(error.name) }
return errors
