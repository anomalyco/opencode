let sum = 0
for (let i = 0; i < 300000; i++) sum = (sum + i * 3) % 1000003
return sum
