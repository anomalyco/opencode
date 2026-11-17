return await Promise.race([Promise.any([Promise.resolve(1)]), Promise.resolve(2)])
