---
name: django-storages-s3
description: "Use when configuring Django to store static and media files on AWS S3 with django-storages. Invoke when working with the STORAGES setting, S3 buckets, presigned URLs, CloudFront, or boto3-backed file storage in settings.py. Configures the Django 4.2+ STORAGES dict, public/private custom backends, presigned GET/POST URLs, IAM policies, and S3 mocking for tests. Trigger terms: django-storages, S3, boto3, S3Boto3Storage, STORAGES, presigned URL, CloudFront, media files, collectstatic, AWS_STORAGE_BUCKET_NAME."
license: MIT
metadata:
  author: https://github.com/awais786
  version: "1.0.0"
  domain: backend
  triggers: django-storages, S3, boto3, S3Boto3Storage, STORAGES, presigned URL, CloudFront, media files, collectstatic
  role: specialist
  scope: implementation
  output-format: code
  related-skills: django-expert
---

# Django Storages S3

Senior Django specialist for production-grade file storage on AWS S3 via `django-storages` and `boto3` — public and private media, static files, presigned URLs, and CloudFront.

## When to Use This Skill

- Serving static and/or media files from AWS S3 instead of the local filesystem
- Configuring the Django 4.2+ `STORAGES` dict or legacy `DEFAULT_FILE_STORAGE`
- Separating public (CDN-served) and private (presigned) file backends
- Generating presigned download or direct browser-to-S3 upload URLs
- Fronting S3 with CloudFront and writing a least-privilege IAM policy
- Migrating local `FileField`/`ImageField` storage to S3 without code changes
- Testing storage code without hitting S3

## Core Workflow

1. **Install & register** — `pip install django-storages[s3] boto3`; add `"storages"` to `INSTALLED_APPS`
2. **Configure credentials** — Load from env vars or rely on an attached IAM role; never hardcode
3. **Wire the `STORAGES` dict** — Set `default` (media) and `staticfiles` backends with separate `location` prefixes
4. **Add named backends** — Split public vs. private buckets/ACLs as additional `STORAGES` entries when needed
5. **Verify & test** — Run `collectstatic`, confirm uploads land in S3, and mock S3 in tests with `InMemoryStorage` or `moto`

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Settings & STORAGES | `references/configuration.md` | Core settings, 4.2+ vs legacy, CloudFront |
| Custom backends | `references/custom-backends.md` | Public vs. private buckets, per-field storage |
| Presigned URLs | `references/presigned-urls.md` | Download links, direct browser uploads |
| Testing & IAM | `references/testing-storages.md` | Mocking S3, IAM policy, common pitfalls |

## Minimal Working Example

The snippet below demonstrates the core MUST DO constraints: env-loaded credentials, `STORAGES` dict, separate media/static locations, and `default_acl=None` on the media backend.

```python
# settings.py
import os

AWS_STORAGE_BUCKET_NAME = os.environ["AWS_STORAGE_BUCKET_NAME"]
AWS_S3_REGION_NAME = os.environ.get("AWS_S3_REGION_NAME", "us-east-1")
AWS_S3_CUSTOM_DOMAIN = f"{AWS_STORAGE_BUCKET_NAME}.s3.{AWS_S3_REGION_NAME}.amazonaws.com"
# On EC2/ECS/Lambda, omit keys entirely — boto3 uses the attached IAM role.

STORAGES = {
    "default": {  # media uploads
        "BACKEND": "storages.backends.s3boto3.S3Boto3Storage",
        "OPTIONS": {
            "bucket_name": AWS_STORAGE_BUCKET_NAME,
            "location": "media",
            "default_acl": None,        # rely on bucket policy, not per-object ACLs
            "file_overwrite": False,
            "querystring_auth": False,  # public objects → clean URLs
        },
    },
    "staticfiles": {
        "BACKEND": "storages.backends.s3boto3.S3StaticStorage",
        "OPTIONS": {
            "bucket_name": AWS_STORAGE_BUCKET_NAME,
            "location": "static",
        },
    },
}

MEDIA_URL = f"https://{AWS_S3_CUSTOM_DOMAIN}/media/"
STATIC_URL = f"https://{AWS_S3_CUSTOM_DOMAIN}/static/"
```

```python
# models.py — uploads go straight to S3 on save()
from django.db import models

class Document(models.Model):
    file = models.FileField(upload_to="docs/")  # uses STORAGES["default"]
```

## Auditing an Existing Configuration

When reviewing a project that already uses S3 (not greenfield), walk this
checklist — each item is a constraint below rephrased as "find X, confirm Y":

1. **Credentials** — `grep -rn "AWS_SECRET_ACCESS_KEY\|aws_secret" settings/` → confirm values come from `os.environ`/`django-environ` or an IAM role, never literals committed to the repo.
2. **ACLs** — `grep -rn "default_acl\|AWS_DEFAULT_ACL" .` → on buckets created after April 2023, every value must be `None`. Any `"public-read"`/`"private"` will raise `AccessControlListNotSupported`; public access belongs in a bucket policy.
3. **Storage backend** — confirm Django 4.2+ uses the `STORAGES` dict, not `DEFAULT_FILE_STORAGE`/`STATICFILES_STORAGE` (removed in Django 5.1, so silently ignored on 5.1/5.2/6.0); confirm the static class is `S3StaticStorage`, not a fabricated name.
4. **Locations** — confirm `default` (media) and `staticfiles` have distinct `location` prefixes or buckets so `collectstatic` never collides with uploads.
5. **Region** — confirm `region_name` (or the global `AWS_S3_REGION_NAME`) matches the bucket's real region and that `AWS_S3_CUSTOM_DOMAIN` includes the region segment for non-`us-east-1` buckets.
6. **Presigning** — for private backends, confirm `querystring_auth=True` **and** `custom_domain=None`; confirm presigned `.url()` results aren't cached past `AWS_QUERYSTRING_EXPIRE`.
7. **Overwrite cleanup** — where `file_overwrite=False`, confirm replaced files are explicitly deleted (otherwise superseded objects leak).
8. **IAM** — confirm the policy grants only `Get/Put/Delete/ListBucket` on the bucket ARN, not broader S3 access.

## Constraints

### MUST DO
- Load AWS credentials from environment variables or an attached IAM role
- Set `default_acl=None` so bucket policies (not object ACLs) control access
- Give static and media files separate `location` prefixes or separate buckets
- Use the `STORAGES` dict on Django 4.2+ (same config through 5.2 LTS and 6.0); `DEFAULT_FILE_STORAGE`/`STATICFILES_STORAGE` were removed in 5.1, so reserve them for < 4.2 only
- Set `custom_domain=None` on any backend that issues presigned URLs
- Mock S3 (`InMemoryStorage` or `moto`) in tests instead of hitting real buckets

### MUST NOT DO
- Hardcode `AWS_SECRET_ACCESS_KEY` in `settings.py` or commit it
- Mix `querystring_auth=True` with a `custom_domain` (presigning breaks)
- Mix static and media files under the same prefix
- Grant the IAM user broader than `Get/Put/Delete/ListBucket` on the bucket ARN
- Rely on per-object ACLs on buckets created after April 2023 (ACLs disabled by default)

## Knowledge Reference

django-storages, S3Boto3Storage, S3StaticStorage, boto3, STORAGES dict, presigned URLs, generate_presigned_post, CloudFront, IAM policy, InMemoryStorage, moto

## Related Skills

- `django-expert` — core Django models, DRF, and ORM that produce the files this skill persists to S3
- `fullstack-guardian` — secure end-to-end upload flows and access control around stored files
- `devops-engineer` — provisioning the S3 buckets, IAM roles, and CloudFront distributions this skill targets

[Documentation](https://jeffallan.github.io/claude-skills/skills/backend/django-storages-s3/)
