function* squares(n) { for (let i = 0; i < n; i++) yield i * i }
return [...squares(5)]
