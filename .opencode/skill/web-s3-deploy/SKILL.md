---
name: web-s3-deploy
description: Build the web frontend, sync to S3, and invalidate CloudFront
---

## What I do
Provide a repeatable workflow to publish the web frontend to a public S3 bucket and refresh a CloudFront distribution so HTTPS updates are visible.

## When to use me
Use this when you need to ship a new web UI build for OpenCode and make sure CloudFront serves the latest assets.

## Checklist
1. Build the frontend locally.
2. Sync the build output to the S3 bucket.
3. Trigger a CloudFront invalidation to refresh cached assets.

## Commands
```bash
bun run --cwd packages/app build
aws s3 sync packages/app/dist s3://opencode-hmsy --delete --exact-timestamps
aws cloudfront create-invalidation --distribution-id E30UYS44QZ0UX4 --paths "/*"
```

## Notes
- S3 website URL: http://opencode-hmsy.s3-website-ap-southeast-1.amazonaws.com
- CloudFront HTTPS URL: https://d3ir6x3lfy3u68.cloudfront.net
- OPENCODE_WEB_URL=https://d3ir6x3lfy3u68.cloudfront.net
- For S3 website hosting, ensure the bucket policy allows public read.
- The CloudFront distribution should use the S3 website endpoint as its origin for SPA routing.
- If you only need cache refresh after content changes, you can skip the build step.
