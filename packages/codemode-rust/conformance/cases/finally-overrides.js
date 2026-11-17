const f = () => { try { return "try" } finally { return "finally" } }
const g = () => { for (let i = 0; i < 3; i++) { try { if (i === 1) break } finally { } } return "done" }
return [f(), g()]
