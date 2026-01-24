# api-form-test-2 - Technical Design Document

> Generated from specification by DesignCraft
> Version: 1.0
> Date: 2026-01-12

## 1. Executive Summary

This document describes the technical design for **api-form-test-2**, a web application featuring user authentication and a dashboard with key metrics. The system follows a classic three-tier architecture with a React/TypeScript frontend, Node.js/Express backend, PostgreSQL database, and Redis caching layer.

**Key Architectural Decisions:**

- Monolithic backend for simplicity and faster development
- Containerized deployment for horizontal scaling
- Session-based authentication with Redis for distributed session storage
- PostgreSQL for reliable, ACID-compliant data storage

## 2. Application Type & Context

### 2.1 Application Classification

**Web Application** - Single Page Application (SPA) with REST API backend

### 2.2 Key Characteristics

- **Target Platform(s)**: Modern web browsers (Chrome, Firefox, Safari, Edge)
- **Deployment Model**: Containerized deployment (Docker) with orchestration support
- **Scale Expectations**: 100 concurrent users, with horizontal scaling capability
- **Connectivity Requirements**: Always-online (no offline support required)

## 3. System Architecture

### 3.1 Architecture Style

**Monolithic Backend with SPA Frontend**

Rationale: The application scope is well-defined with a small feature set (auth + dashboard). A monolith provides:

- Simpler deployment and operations
- Easier debugging and development
- Lower latency (no inter-service communication)
- Sufficient for 100 concurrent users

### 3.2 System Context Diagram (C4 Level 1)

```
┌─────────────────────────────────────────────────────────────────┐
│                        SYSTEM CONTEXT                           │
└─────────────────────────────────────────────────────────────────┘

    ┌──────────┐
    │   User   │
    │ (Browser)│
    └────┬─────┘
         │ HTTPS
         ▼
┌─────────────────────────────────────┐
│                                     │
│         api-form-test-2             │
│                                     │
│   [Web Application System]          │
│                                     │
│   - User registration/login         │
│   - Dashboard with metrics          │
│   - Activity tracking               │
│                                     │
└─────────────────────────────────────┘
         │
         ▼
    ┌──────────┐
    │  Email   │
    │  Service │
    │(External)│
    └──────────┘
```

### 3.3 Container Diagram (C4 Level 2)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CONTAINER DIAGRAM                                │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────┐
│   User   │
│ (Browser)│
└────┬─────┘
     │ HTTPS
     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Load Balancer / Reverse Proxy (nginx)                                  │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
         ┌───────────────────┴───────────────────┐
         │                                       │
         ▼                                       ▼
┌─────────────────────┐               ┌─────────────────────┐
│   Frontend SPA      │               │   Backend API       │
│   [React/TS]        │               │   [Node.js/Express] │
│                     │               │                     │
│   - Login/Register  │──── API ────▶│   - Auth endpoints  │
│   - Dashboard UI    │    calls      │   - User CRUD       │
│   - Activity feed   │               │   - Metrics API     │
└─────────────────────┘               └─────────┬───────────┘
                                                │
                        ┌───────────────────────┼───────────────────────┐
                        │                       │                       │
                        ▼                       ▼                       ▼
               ┌───────────────┐      ┌───────────────┐      ┌───────────────┐
               │   PostgreSQL  │      │     Redis     │      │  Email Service│
               │   [Database]  │      │   [Cache/     │      │   (SMTP)      │
               │               │      │    Sessions]  │      │               │
               │   - Users     │      │               │      │   - Verify    │
               │   - Activity  │      │   - Sessions  │      │   - Reset pwd │
               │   - Metrics   │      │   - Cache     │      │               │
               └───────────────┘      └───────────────┘      └───────────────┘
```

## 4. Component Design

### 4.1 Component Overview

| Component            | Description                                            |
| -------------------- | ------------------------------------------------------ |
| **Frontend SPA**     | React application handling all user interactions       |
| **API Server**       | Express server handling business logic and data access |
| **Auth Module**      | Handles registration, login, password reset, sessions  |
| **User Module**      | User profile management                                |
| **Dashboard Module** | Metrics aggregation and activity feed                  |
| **Database Layer**   | PostgreSQL with connection pooling                     |
| **Cache Layer**      | Redis for sessions and frequently accessed data        |

### 4.2 Component Diagram (C4 Level 3)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      BACKEND API COMPONENTS                              │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                           Express Application                            │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      Middleware Layer                            │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │    │
│  │  │  CORS    │ │  Rate    │ │  Auth    │ │  Input   │            │    │
│  │  │          │ │  Limiter │ │  Guard   │ │  Validator│           │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                       Route Layer                                │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │    │
│  │  │  Auth Routes │  │  User Routes │  │ Dashboard    │           │    │
│  │  │  /api/auth/* │  │  /api/users/*│  │ Routes       │           │    │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │    │
│  └─────────┼─────────────────┼─────────────────┼───────────────────┘    │
│            │                 │                 │                         │
│  ┌─────────▼─────────────────▼─────────────────▼───────────────────┐    │
│  │                      Service Layer                               │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │    │
│  │  │ AuthService  │  │ UserService  │  │ Dashboard    │           │    │
│  │  │              │  │              │  │ Service      │           │    │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │    │
│  └─────────┼─────────────────┼─────────────────┼───────────────────┘    │
│            │                 │                 │                         │
│  ┌─────────▼─────────────────▼─────────────────▼───────────────────┐    │
│  │                    Repository Layer                              │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │    │
│  │  │ UserRepo     │  │ SessionRepo  │  │ ActivityRepo │           │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
         │                       │
         ▼                       ▼
   ┌───────────┐           ┌───────────┐
   │ PostgreSQL│           │   Redis   │
   └───────────┘           └───────────┘
```

### 4.3 Component Details

#### 4.3.1 Frontend SPA

- **Responsibility**: User interface, client-side routing, form handling, API communication
- **Technology**: React 18, TypeScript, React Router, React Query (TanStack Query)
- **Dependencies**: Backend API
- **Interfaces**: Consumes REST API endpoints

#### 4.3.2 Auth Module

- **Responsibility**: User registration, login, logout, password reset, email verification, session management
- **Technology**: Express routes, bcrypt for password hashing, express-session with Redis store
- **Dependencies**: User Repository, Session Repository, Email Service
- **Interfaces**:
  - `POST /api/auth/register` - Create new user
  - `POST /api/auth/login` - Authenticate user
  - `POST /api/auth/logout` - Destroy session
  - `POST /api/auth/reset-password` - Initiate password reset

#### 4.3.3 User Module

- **Responsibility**: User profile CRUD operations
- **Technology**: Express routes, validation middleware
- **Dependencies**: User Repository, Auth Guard middleware
- **Interfaces**:
  - `GET /api/users/me` - Get current user profile
  - `PUT /api/users/me` - Update current user
  - `DELETE /api/users/me` - Delete account

#### 4.3.4 Dashboard Module

- **Responsibility**: Aggregate and serve metrics, recent activity
- **Technology**: Express routes, data aggregation queries
- **Dependencies**: Activity Repository, Redis cache
- **Interfaces**:
  - `GET /api/dashboard/metrics` - Key metrics
  - `GET /api/dashboard/activity` - Recent activity feed

## 5. Data Architecture

### 5.1 Data Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ENTITY RELATIONSHIP DIAGRAM                   │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│        users         │
├──────────────────────┤
│ id (PK)         UUID │
│ email        VARCHAR │◄─────────────────┐
│ password_hash VARCHAR│                  │
│ email_verified  BOOL │                  │
│ created_at TIMESTAMP │                  │
│ updated_at TIMESTAMP │                  │
└──────────────────────┘                  │
          │                               │
          │ 1:N                           │
          ▼                               │
┌──────────────────────┐                  │
│     activities       │                  │
├──────────────────────┤                  │
│ id (PK)         UUID │                  │
│ user_id (FK)    UUID │──────────────────┘
│ action       VARCHAR │
│ metadata       JSONB │
│ created_at TIMESTAMP │
└──────────────────────┘

┌──────────────────────┐
│   password_resets    │
├──────────────────────┤
│ id (PK)         UUID │
│ user_id (FK)    UUID │
│ token          VARCHAR│
│ expires_at  TIMESTAMP│
│ used              BOOL│
│ created_at TIMESTAMP │
└──────────────────────┘

┌──────────────────────┐
│  email_verifications │
├──────────────────────┤
│ id (PK)         UUID │
│ user_id (FK)    UUID │
│ token          VARCHAR│
│ expires_at  TIMESTAMP│
│ created_at TIMESTAMP │
└──────────────────────┘
```

### 5.2 Data Storage Strategy

- **Primary Database**: PostgreSQL 15
  - ACID compliance for user data integrity
  - JSONB for flexible activity metadata
  - Connection pooling via `pg-pool` (max 20 connections)
- **Caching Strategy**: Redis 7
  - Session storage (TTL: 24 hours)
  - Dashboard metrics cache (TTL: 5 minutes)
  - Rate limiting counters
- **File Storage**: N/A (no file uploads in scope)
- **Data Retention**:
  - User data: Until account deletion + 30 days grace period
  - Activity logs: 90 days rolling window
  - Password reset tokens: Auto-expire after 1 hour

### 5.3 Data Flow

```
User Action Flow (Login Example):
─────────────────────────────────

1. User submits credentials
   │
   ▼
2. Frontend validates form → POST /api/auth/login
   │
   ▼
3. Backend validates input (express-validator)
   │
   ▼
4. AuthService queries UserRepository
   │
   ▼
5. PostgreSQL returns user record
   │
   ▼
6. bcrypt.compare() validates password
   │
   ▼
7. Session created in Redis (express-session)
   │
   ▼
8. Activity logged to PostgreSQL
   │
   ▼
9. Session cookie returned to frontend
```

## 6. API Design

### 6.1 API Style

**REST API** with JSON payloads

Conventions:

- Versioned via URL path (`/api/v1/...` for future versions)
- Standard HTTP status codes
- Consistent error response format

### 6.2 Key Endpoints

| Method | Endpoint                           | Description                     | Auth Required |
| ------ | ---------------------------------- | ------------------------------- | ------------- |
| POST   | `/api/auth/register`               | Create new user account         | No            |
| POST   | `/api/auth/login`                  | Authenticate and create session | No            |
| POST   | `/api/auth/logout`                 | Destroy current session         | Yes           |
| POST   | `/api/auth/reset-password`         | Request password reset email    | No            |
| POST   | `/api/auth/reset-password/confirm` | Complete password reset         | No            |
| GET    | `/api/auth/verify-email/:token`    | Verify email address            | No            |
| GET    | `/api/users/me`                    | Get current user profile        | Yes           |
| PUT    | `/api/users/me`                    | Update current user profile     | Yes           |
| DELETE | `/api/users/me`                    | Delete current user account     | Yes           |
| GET    | `/api/dashboard/metrics`           | Get dashboard metrics           | Yes           |
| GET    | `/api/dashboard/activity`          | Get recent activity             | Yes           |

### 6.3 Authentication & Authorization

**Session-based Authentication:**

- Sessions stored in Redis with 24-hour TTL
- HTTP-only, Secure, SameSite=Strict cookies
- Session regeneration on login to prevent fixation

**Authorization:**

- Single role (authenticated user) for MVP
- Middleware-based route protection
- Users can only access their own data (enforced at service layer)

## 7. Security Considerations

### 7.1 Security Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        SECURITY LAYERS                                   │
└─────────────────────────────────────────────────────────────────────────┘

  Internet
      │
      ▼
┌─────────────────────────────────────────┐
│  TLS Termination (nginx/load balancer)  │  ◄── HTTPS only
└─────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────┐
│  Rate Limiting (express-rate-limit)     │  ◄── 100 req/15min per IP
└─────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────┐
│  CORS (restricted origins)              │  ◄── Frontend origin only
└─────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────┐
│  Input Validation (express-validator)   │  ◄── All inputs sanitized
└─────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────┐
│  Session Authentication                 │  ◄── Redis-backed sessions
└─────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────┐
│  Parameterized Queries (pg library)     │  ◄── SQL injection prevention
└─────────────────────────────────────────┘
```

### 7.2 Data Protection

- **At Rest**: Database encryption via PostgreSQL TDE or disk encryption
- **In Transit**: TLS 1.3 for all connections (client-server, server-database)
- **Sensitive Data Handling**:
  - Passwords: bcrypt with cost factor 12
  - Email: Validated format, stored in lowercase
  - Sessions: Random UUIDs, Redis-only storage

### 7.3 Access Control

- Session-based authentication required for protected routes
- User isolation: Users can only access/modify their own data
- CSRF protection via SameSite cookies

## 8. Infrastructure & Deployment

### 8.1 Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        PRODUCTION DEPLOYMENT                             │
└─────────────────────────────────────────────────────────────────────────┘

                        ┌──────────────────┐
                        │   CDN (Static)   │
                        │   CloudFront/    │
                        │   Cloudflare     │
                        └────────┬─────────┘
                                 │
    ┌────────────────────────────┼────────────────────────────┐
    │                            ▼                            │
    │                   ┌──────────────────┐                  │
    │                   │  Load Balancer   │                  │
    │                   │     (nginx)      │                  │
    │                   └────────┬─────────┘                  │
    │                            │                            │
    │            ┌───────────────┼───────────────┐            │
    │            ▼               ▼               ▼            │
    │    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐      │
    │    │  Backend    │ │  Backend    │ │  Backend    │      │
    │    │  Container  │ │  Container  │ │  Container  │      │
    │    │  (Node.js)  │ │  (Node.js)  │ │  (Node.js)  │      │
    │    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘      │
    │           │               │               │             │
    │           └───────────────┼───────────────┘             │
    │                           │                             │
    │         ┌─────────────────┴─────────────────┐           │
    │         ▼                                   ▼           │
    │  ┌─────────────────┐               ┌─────────────────┐  │
    │  │   PostgreSQL    │               │     Redis       │  │
    │  │   (Primary +    │               │   (Cluster/     │  │
    │  │    Replica)     │               │    Sentinel)    │  │
    │  └─────────────────┘               └─────────────────┘  │
    │                                                         │
    │                    Cloud Provider VPC                   │
    └─────────────────────────────────────────────────────────┘
```

### 8.2 Environment Strategy

| Environment     | Purpose                | Infrastructure                             |
| --------------- | ---------------------- | ------------------------------------------ |
| **Development** | Local development      | Docker Compose (postgres, redis, app)      |
| **Staging**     | Pre-production testing | Single container per service, shared DB    |
| **Production**  | Live users             | Multi-container, managed DB, Redis cluster |

### 8.3 CI/CD Approach

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│   Push   │───▶│   Lint   │───▶│   Test   │───▶│  Build   │───▶│  Deploy  │
│  to Git  │    │  & Type  │    │  Unit +  │    │  Docker  │    │  Staging │
│          │    │  Check   │    │  Integ.  │    │  Image   │    │  / Prod  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

**Pipeline Steps:**

1. Code push triggers pipeline (GitHub Actions / GitLab CI)
2. ESLint + TypeScript type checking
3. Unit tests (Jest) + integration tests
4. Build Docker image, tag with commit SHA
5. Push to container registry
6. Deploy to staging (automatic)
7. Deploy to production (manual approval)

## 9. Technology Stack

### 9.1 Technology Choices

| Layer              | Technology           | Rationale                                     |
| ------------------ | -------------------- | --------------------------------------------- |
| Frontend Framework | React 18             | Spec requirement, large ecosystem, well-known |
| Frontend Language  | TypeScript           | Spec requirement, type safety, better DX      |
| State Management   | TanStack Query       | Server-state caching, reduces boilerplate     |
| UI Components      | Tailwind CSS         | Rapid styling, small bundle size              |
| Backend Runtime    | Node.js 20 LTS       | Spec requirement, npm ecosystem               |
| Backend Framework  | Express 4            | Spec requirement, simple, proven              |
| Database           | PostgreSQL 15        | Spec requirement, ACID, mature                |
| Cache/Sessions     | Redis 7              | Spec requirement, fast, reliable              |
| ORM/Query Builder  | None (pg library)    | Simple queries, avoid ORM overhead            |
| Validation         | express-validator    | Input sanitization, SQL injection prevention  |
| Password Hashing   | bcrypt               | Industry standard, timing-safe                |
| Container Runtime  | Docker               | Containerized deployment per spec             |
| Orchestration      | Docker Compose / K8s | Scaling support per spec                      |

### 9.2 Key Dependencies

**Backend:**

- `express` - Web framework
- `pg` - PostgreSQL client
- `redis` - Redis client
- `express-session` + `connect-redis` - Session management
- `bcrypt` - Password hashing
- `express-validator` - Input validation
- `express-rate-limit` - Rate limiting
- `helmet` - Security headers
- `pino` - Structured logging

**Frontend:**

- `react` + `react-dom` - UI framework
- `react-router-dom` - Client routing
- `@tanstack/react-query` - Server state
- `tailwindcss` - Styling
- `zod` - Form validation

## 10. Non-Functional Requirements

### 10.1 Performance

- **Response Time Targets**:
  - API responses: p95 < 200ms
  - Page load (LCP): < 2 seconds (per spec)
- **Throughput Expectations**: 100 concurrent users (per spec)
- **Optimization Strategies**:
  - Redis caching for dashboard metrics
  - Database connection pooling
  - Frontend code splitting
  - Static asset CDN

### 10.2 Scalability

- Horizontal scaling via container replication (stateless backend)
- Redis for distributed sessions (no sticky sessions needed)
- Database read replicas for read-heavy workloads (future)

### 10.3 Reliability

- **Availability Target**: 99.9% (per spec) = ~8.7 hours downtime/year
- **Disaster Recovery**:
  - Daily automated database backups
  - Point-in-time recovery enabled
  - Multi-AZ database deployment
- **Backup Strategy**:
  - PostgreSQL: Daily full backup, continuous WAL archiving
  - Redis: AOF persistence, periodic RDB snapshots

### 10.4 Observability

- **Logging**:
  - Structured JSON logs (pino)
  - Log aggregation via Loki/CloudWatch
  - Request ID correlation
- **Metrics**:
  - Request latency, error rates, throughput
  - Database connection pool usage
  - Redis memory/hit rates
  - Node.js event loop lag
- **Tracing**: OpenTelemetry instrumentation (future)
- **Alerting**:
  - Error rate > 1% - Warning
  - Error rate > 5% - Critical
  - P95 latency > 500ms - Warning
  - Database connection exhaustion - Critical

## 11. Risks & Mitigations

| Risk                                       | Impact | Likelihood | Mitigation                                            |
| ------------------------------------------ | ------ | ---------- | ----------------------------------------------------- |
| PostgreSQL becomes bottleneck at scale     | H      | L          | Connection pooling, read replicas, query optimization |
| Redis session loss causes mass logouts     | M      | L          | Redis persistence (AOF), Sentinel for HA              |
| Email delivery failures block registration | M      | M          | Async email queue, retry logic, fallback provider     |
| DDoS attack                                | H      | M          | Rate limiting, CDN with DDoS protection, WAF          |
| Password database breach                   | H      | L          | bcrypt hashing, breach notification process           |
| Dependency vulnerability                   | M      | M          | Automated dependency scanning (Dependabot/Snyk)       |

## 12. Open Questions & Decisions Needed

1. **Email Provider**: Which email service to use for verification/password reset? (SendGrid, SES, Mailgun?)

2. **Cloud Provider**: AWS, GCP, or Azure? (Affects managed DB/Redis choices)

3. **Metrics Dashboard**: What specific metrics should be displayed? Need business input on KPIs.

4. **Activity Types**: What user activities should be tracked and displayed in the activity feed?

5. **Session Duration**: 24-hour session TTL acceptable, or should we implement "remember me"?

6. **Account Deletion**: Soft delete with grace period, or immediate hard delete?

7. **Rate Limit Values**: 100 requests per 15 minutes per IP - is this appropriate for expected usage patterns?

---

_This design document is subject to review by the LLM Council for architectural soundness, security, and practicality._
