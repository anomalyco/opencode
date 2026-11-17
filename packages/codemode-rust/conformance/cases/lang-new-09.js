try { new Number(1) } catch (error) { return [error.name, error instanceof TypeError] }
