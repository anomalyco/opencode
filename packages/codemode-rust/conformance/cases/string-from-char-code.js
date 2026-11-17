let s = ""
for (let i = 0; i < 5; i++) s += String.fromCharCode(97 + i)
return [s, String.fromCharCode(72, 105), "€".length, "z".charCodeAt(0), String(123), String(null), String([1, [2, 3]]), (12).toString(), (255).toString(16)]
