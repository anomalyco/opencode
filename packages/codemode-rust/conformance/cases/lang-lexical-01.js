const errors = []
try { programLet; let programLet } catch (error) { errors.push(error.name) }
try { programConst; const programConst = 1 } catch (error) { errors.push(error.name) }
try { { blockLet; let blockLet } } catch (error) { errors.push(error.name) }
try { { blockConst; const blockConst = 1 } } catch (error) { errors.push(error.name) }
return errors
