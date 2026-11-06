// Where the docs are mounted on the site. Docs code builds its URLs from this, and MDX content reads it
// as `import.meta.env.BASE_URL` (vite.ts), as it did when the docs were their own app.
export const base = "/v2/"
