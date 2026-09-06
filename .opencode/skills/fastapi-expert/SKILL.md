---
name: fastapi-expert
description: "Use when building high-performance async Python APIs with FastAPI and Pydantic V2. Invoke to create REST endpoints, define Pydantic models, implement authentication flows, set up async SQLAlchemy database operations, add JWT authentication, build WebSocket endpoints, or generate OpenAPI documentation. Trigger terms: FastAPI, Pydantic, async Python, Python API, REST API Python, SQLAlchemy async, JWT authentication, OpenAPI, Swagger Python."
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: backend
  triggers: FastAPI, Pydantic, async Python, Python API, REST API Python, SQLAlchemy async, JWT authentication, OpenAPI, Swagger Python
  role: specialist
  scope: implementation
  output-format: code
  related-skills: fullstack-guardian, django-expert, test-master
---

# FastAPI Expert

Deep expertise in async Python, Pydantic V2, and production-grade API development with FastAPI.

## When to Use This Skill

- Building REST APIs with FastAPI
- Implementing Pydantic V2 validation schemas
- Setting up async database operations
- Implementing JWT authentication/authorization
- Creating WebSocket endpoints
- Optimizing API performance

## Core Workflow

1. **Analyze requirements** — Identify endpoints, data models, auth needs
2. **Design schemas** — Create Pydantic V2 models for validation
3. **Implement** — Write async endpoints with proper dependency injection
4. **Secure** — Add authentication, authorization, rate limiting
5. **Test** — Write async tests with pytest and httpx; run `pytest` after each endpoint group and verify OpenAPI docs at `/docs`

> **Checkpoint after each step:** confirm schemas validate correctly, endpoints return expected HTTP status codes, and `/docs` reflects the intended API surface before proceeding.

## Minimal Complete Example

Schema + endpoint + dependency injection in one cohesive unit:

```python
# schemas.py
from pydantic import BaseModel, EmailStr, field_validator, model_config

class UserCreate(BaseModel):
    model_config = model_config(str_strip_whitespace=True)

    email: EmailStr
    password: str
    name: str | None = None

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

class UserResponse(BaseModel):
    model_config = model_config(from_attributes=True)

    id: int
    email: EmailStr
    name: str | None = None
```

```python
# routers/users.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated

from app.database import get_db
from app.schemas import UserCreate, UserResponse
from app import crud

router = APIRouter(prefix="/users", tags=["users"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate, db: DbDep) -> UserResponse:
    existing = await crud.get_user_by_email(db, payload.email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    return await crud.create_user(db, payload)
```

```python
# crud.py
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import User
from app.schemas import UserCreate
from app.security import hash_password

async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()

async def create_user(db: AsyncSession, payload: UserCreate) -> User:
    user = User(email=payload.email, hashed_password=hash_password(payload.password), name=payload.name)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
```

## JWT Authentication Snippet

```python
# security.py
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from typing import Annotated

SECRET_KEY = "read-from-env"  # use os.environ / settings
ALGORITHM = "HS256"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")

def create_access_token(subject: str, expires_delta: timedelta = timedelta(minutes=30)) -> str:
    payload = {"sub": subject, "exp": datetime.now(timezone.utc) + expires_delta}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> str:
    try:
        data = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        subject: str | None = data.get("sub")
        if subject is None:
            raise ValueError
        return subject
    except (JWTError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

CurrentUser = Annotated[str, Depends(get_current_user)]
```

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Pydantic V2 | `references/pydantic-v2.md` | Creating schemas, validation, model_config |
| SQLAlchemy | `references/async-sqlalchemy.md` | Async database, models, CRUD operations |
| Endpoints | `references/endpoints-routing.md` | APIRouter, dependencies, routing |
| Authentication | `references/authentication.md` | JWT, OAuth2, get_current_user |
| Testing | `references/testing-async.md` | pytest-asyncio, httpx, fixtures |
| Django Migration | `references/migration-from-django.md` | Migrating from Django/DRF to FastAPI |

## Constraints

### MUST DO
- Use type hints everywhere (FastAPI requires them)
- Use Pydantic V2 syntax (`field_validator`, `model_validator`, `model_config`)
- Use `Annotated` pattern for dependency injection
- Use async/await for all I/O operations
- Use `X | None` instead of `Optional[X]`
- Return proper HTTP status codes
- Document endpoints (auto-generated OpenAPI)

### MUST NOT DO
- Use synchronous database operations
- Skip Pydantic validation
- Store passwords in plain text
- Expose sensitive data in responses
- Use Pydantic V1 syntax (`@validator`, `class Config`)
- Mix sync and async code improperly
- Hardcode configuration values

## Output Templates

When implementing FastAPI features, provide:
1. Schema file (Pydantic models)
2. Endpoint file (router with endpoints)
3. CRUD operations if database involved
4. Brief explanation of key decisions

## Knowledge Reference

FastAPI, Pydantic V2, async SQLAlchemy, Alembic migrations, JWT/OAuth2, pytest-asyncio, httpx, BackgroundTasks, WebSockets, dependency injection, OpenAPI/Swagger

[Documentation](https://jeffallan.github.io/claude-skills/skills/backend/fastapi-expert/)
