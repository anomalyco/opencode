return await Promise.race([tools.host.pending({ id: 1 }), "immediate"])
