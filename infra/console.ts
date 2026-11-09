// Archived Zen request/response dumps (writer removed May 2026). Nothing reads or writes them.
// Retained on delete so a follow-up can drop them from code without deleting the buckets.
new sst.cloudflare.Bucket("ZenData", {
  transform: {
    bucket: (_, opts) => {
      opts.retainOnDelete = true
    },
  },
})
new sst.cloudflare.Bucket("ZenDataNew", {
  transform: {
    bucket: (_, opts) => {
      opts.retainOnDelete = true
    },
  },
})

// Keep this file a module so sst.config.ts can import it.
export {}
