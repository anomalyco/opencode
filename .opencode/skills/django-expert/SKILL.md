---
name: django-expert
description: "Use when building Django web applications or REST APIs with Django REST Framework. Invoke when working with settings.py, models.py, manage.py, or any Django project file. Creates Django models with proper indexes, optimizes ORM queries using select_related/prefetch_related, builds DRF serializers and viewsets, and configures JWT authentication. Trigger terms: Django, DRF, Django REST Framework, Django ORM, Django model, serializer, viewset, Python web."
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: backend
  triggers: Django, DRF, Django REST Framework, Django ORM, Django model, serializer, viewset, Python web
  role: specialist
  scope: implementation
  output-format: code
  related-skills: fullstack-guardian, fastapi-expert, test-master, django-storages-s3
---

# Django Expert

Senior Django specialist with deep expertise in Django 5.0, Django REST Framework, and production-grade web applications.

## When to Use This Skill

- Building Django web applications or REST APIs
- Designing Django models with proper relationships
- Implementing DRF serializers and viewsets
- Optimizing Django ORM queries
- Setting up authentication (JWT, session)
- Django admin customization

## Core Workflow

1. **Analyze requirements** — Identify models, relationships, API endpoints
2. **Design models** — Create models with proper fields, indexes, managers → run `manage.py makemigrations` and `manage.py migrate`; verify schema before proceeding
3. **Implement views** — DRF viewsets or Django 5.0 async views
4. **Validate endpoints** — Confirm each endpoint returns expected status codes with a quick `APITestCase` or `curl` check before adding auth
5. **Add auth** — Permissions, JWT authentication
6. **Test** — Django TestCase, APITestCase

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Models | `references/models-orm.md` | Creating models, ORM queries, optimization |
| Serializers | `references/drf-serializers.md` | DRF serializers, validation |
| ViewSets | `references/viewsets-views.md` | Views, viewsets, async views |
| Authentication | `references/authentication.md` | JWT, permissions, SimpleJWT |
| Testing | `references/testing-django.md` | APITestCase, fixtures, factories |

## Minimal Working Example

The snippet below demonstrates the core MUST DO constraints: indexed fields, `select_related`, serializer validation, and endpoint permissions.

```python
# models.py
from django.db import models

class Article(models.Model):
    title = models.CharField(max_length=255, db_index=True)
    author = models.ForeignKey(
        "auth.User", on_delete=models.CASCADE, related_name="articles"
    )
    published_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-published_at"]
        indexes = [models.Index(fields=["author", "published_at"])]

    def __str__(self):
        return self.title

# serializers.py
from rest_framework import serializers
from .models import Article

class ArticleSerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(source="author.username", read_only=True)

    class Meta:
        model = Article
        fields = ["id", "title", "author_username", "published_at"]

    def validate_title(self, value):
        if len(value.strip()) < 3:
            raise serializers.ValidationError("Title must be at least 3 characters.")
        return value.strip()

# views.py
from rest_framework import viewsets, permissions
from .models import Article
from .serializers import ArticleSerializer

class ArticleViewSet(viewsets.ModelViewSet):
    """
    Uses select_related to avoid N+1 on author lookups.
    IsAuthenticatedOrReadOnly: safe methods are public, writes require auth.
    """
    serializer_class = ArticleSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        return Article.objects.select_related("author").all()

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)
```

```python
# tests.py
from rest_framework.test import APITestCase
from rest_framework import status
from django.contrib.auth.models import User

class ArticleAPITest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("alice", password="pass")

    def test_list_public(self):
        res = self.client.get("/api/articles/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

    def test_create_requires_auth(self):
        res = self.client.post("/api/articles/", {"title": "Test"})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_create_authenticated(self):
        self.client.force_authenticate(self.user)
        res = self.client.post("/api/articles/", {"title": "Hello Django"})
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
```

## Constraints

### MUST DO
- Use `select_related`/`prefetch_related` for related objects
- Add database indexes for frequently queried fields
- Use environment variables for secrets
- Implement proper permissions on all endpoints
- Write tests for models and API endpoints
- Use Django's built-in security features (CSRF, etc.)

### MUST NOT DO
- Use raw SQL without parameterization
- Skip database migrations
- Store secrets in settings.py
- Use DEBUG=True in production
- Trust user input without validation
- Ignore query optimization

## Output Templates

When implementing Django features, provide:
1. Model definitions with indexes
2. Serializers with validation
3. ViewSet or views with permissions
4. Brief note on query optimization

## Knowledge Reference

Django 5.0, DRF, async views, ORM, QuerySet, select_related, prefetch_related, SimpleJWT, django-filter, drf-spectacular, pytest-django

[Documentation](https://jeffallan.github.io/claude-skills/skills/backend/django-expert/)
