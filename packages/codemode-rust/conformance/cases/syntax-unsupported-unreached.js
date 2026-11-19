// Unsupported syntax fails only where it runs: unreached classes, with, debugger, new.target, import.meta and super
// leave the rest of the program running.
const r = []
if (false) { class A {} }
if (false) with (o) {}
if (false) debugger
function f() { return new.target }
function g() { return import.meta }
const o = { m() { return super.x } }
const h = () => class {}
r.push(typeof f, typeof g, typeof o.m, typeof h)
switch (1) { case 2: class B {} }
return r
