<!-- Context: development/api-design | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

# API Design Patterns

**Category**: development  
**Purpose**: REST API design principles, GraphQL patterns, and API versioning strategies  
**Used by**: opencoder

---

## Overview

This guide covers best practices for designing robust, scalable, and maintainable APIs, including REST, GraphQL, and versioning strategies.

## REST API Design

### 1. Resource-Based URLs

**Use nouns, not verbs**:
```
# Bad
GET  /getUsers
POST /createUser
POST /updateUser/123

# Good
GET    /users
POST   /users
PUT    /users/123
PATCH  /users/123
DELETE /users/123
```

### 2. HTTP Methods

**Use appropriate HTTP methods**:
- `GET` - Retrieve resources (idempotent, safe)
- `POST` - Create new resources
- `PUT` - Replace entire resource (idempotent)
- `PATCH` - Partial update (idempotent)
- `DELETE` - Remove resource (idempotent)

### 3. Status Codes

**Use standard HTTP status codes**:
```
2xx Success
  200 OK - Successful GET, PUT, PATCH
  201 Created - Successful POST
  204 No Content - Successful DELETE

4xx Client Errors
  400 Bad Request - Invalid input
  401 Unauthorized - Missing/invalid auth
  403 Forbidden - Authenticated but not authorized
  404 Not Found - Resource doesn't exist
  409 Conflict - Resource conflict (e.g., duplicate)
  422 Unprocessable Entity - Validation errors

5xx Server Errors
  500 Internal Server Error - Unexpected error
  503 Service Unavailable - Temporary unavailability
```

### 4. Consistent Response Format

**Standardize response structure**:
```json
// Success response
{
  "data": {
    "id": "123",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00Z"
  }
}

// Error response
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00Z",
    "requestId": "abc-123"
  }
}

// Collection response
{
  "data": [...],
  "meta": {
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "totalPages": 5
  },
  "links": {
    "self": "/users?page=1",
    "next": "/users?page=2",
    "prev": null,
    "first": "/users?page=1",
    "last": "/users?page=5"
  }
}
```

### 5. Filtering, Sorting, Pagination

**Support common query operations**:
```
# Filtering
GET /users?status=active&role=admin

# Sorting
GET /users?sort=createdAt:desc,name:asc

# Pagination
GET /users?page=2&pageSize=20

# Field selection
GET /users?fields=id,name,email

# Search
GET /users?q=john
```

### 6. Nested Resources

**Handle relationships appropriately**:
```
# Good - Shallow nesting
GET /users/123/posts
GET /posts?userId=123

# Avoid - Deep nesting
GET /users/123/posts/456/comments/789
# Better
GET /comments/789
```

## GraphQL Patterns

### 1. Schema Design

**Design clear, intuitive schemas**:
```graphql
type User {
  id: ID!
  name: String!
  email: String!
  posts: [Post!]!
  createdAt: DateTime!
}

type Post {
  id: ID!
  title: String!
  content: String!
  author: User!
  comments: [Comment!]!
  publishedAt: DateTime
}

type Query {
  user(id: ID!): User
  users(filter: UserFilter, page: Int, pageSize: Int): UserConnection!
  post(id: ID!): Post
}

type Mutation {
  createUser(input: CreateUserInput!): User!
  updateUser(id: ID!, input: UpdateUserInput!): User!
  deleteUser(id: ID!): Boolean!
}

input CreateUserInput {
  name: String!
  email: String!
}

input UserFilter {
  status: UserStatus
  role: UserRole
  search: String
}
```

### 2. Resolver Patterns

**Implement efficient resolvers**:
```javascript
const resolvers = {
  Query: {
    user: async (_, { id }, { dataSources }) => {
      return dataSources.userAPI.getUser(id);
    },
    users: async (_, { filter, page, pageSize }, { dataSources }) => {
      return dataSources.userAPI.getUsers({ filter, page, pageSize });
    }
  },
  
  User: {
    posts: async (user, _, { dataSources }) => {
      // Use DataLoader to batch requests
      return dataSources.postAPI.getPostsByUserId(user.id);
    }
  },
  
  Mutation: {
    createUser: async (_, { input }, { dataSources, user }) => {
      // Check authorization
      if (!user) throw new AuthenticationError('Not authenticated');
      
      // Validate input
      const validatedInput = validateUserInput(input);
      
      // Create user
      return dataSources.userAPI.createUser(validatedInput);
    }
  }
};
```

### 3. DataLoader for N+1 Prevention

**Batch and cache database queries**:
```javascript
import DataLoader from 'dataloader';

const userLoader = new DataLoader(async (userIds) => {
  const users = await db.users.findMany({
    where: { id: { in: userIds } }
  });
  
  // Return in same order as input
  return userIds.map(id => users.find(u => u.id === id));
});

// Usage in resolver
const user = await userLoader.load(userId);
```

## Frontend API Client Patterns (TanStack Query)

**Use TanStack Query for optimal client-side API consumption**:

### REST Integration
```javascript
// Optimal REST client with TanStack Query v5
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const apiClient = {
  getUsers: (filters) => 
    fetch(`/api/v1/users?${new URLSearchParams(filters)}`).then(r => r.json())
};

function UsersList() {
  const { data, isPending, error } = useQuery({
    queryKey: ['users', filters],
    queryFn: () => apiClient.getUsers(filters),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return (
    <div>
      {isPending && <div>Loading...</div>}
      {error && <div>Error: {error.message}</div>}
      {data?.data.map(user => <UserCard key={user.id} user={user} />)}
    </div>
  );
}


## API Versioning

### 1. URL Versioning

**Version in the URL path**:
```
GET /v1/users
GET /v2/users
```

**Pros**: Clear, easy to route  
**Cons**: URL changes, harder to maintain multiple versions

### 2. Header Versioning

**Version in Accept header**:
```
GET /users
Accept: application/vnd.myapi.v2+json
```

**Pros**: Clean URLs, flexible  
**Cons**: Less visible, harder to test

### 3. Deprecation Strategy

**Communicate deprecation clearly**:
```javascript
// Response headers
Deprecation: true
Sunset: Sat, 31 Dec 2024 23:59:59 GMT
Link: <https://api.example.com/v2/users>; rel="successor-version"

// Response body
{
  "data": {...},
  "meta": {
    "deprecated": true,
    "deprecationDate": "2024-12-31",
    "migrationGuide": "https://docs.example.com/migration/v1-to-v2"
  }
}
```

## Authentication & Authorization

### 1. JWT Tokens

**Use JWT for stateless auth**:
```javascript
// Token structure
{
  "sub": "user-123",
  "email": "user@example.com",
  "role": "admin",
  "iat": 1516239022,
  "exp": 1516242622
}

// Middleware
function authenticateToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
```

### 2. Role-Based Access Control

**Implement RBAC**:
```javascript
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
}

// Usage
app.delete('/users/:id', 
  authenticateToken, 
  authorize('admin'), 
  deleteUser
);
```

## Best Practices

1. **Use HTTPS everywhere** - Encrypt all API traffic
2. **Implement rate limiting** - Prevent abuse and ensure fair usage
3. **Validate all inputs** - Never trust client data
4. **Use proper error handling** - Return meaningful error messages
5. **Document your API** - Use OpenAPI/Swagger or GraphQL introspection
6. **Version your API** - Plan for breaking changes
7. **Implement CORS properly** - Configure allowed origins carefully
8. **Log requests and errors** - Enable debugging and monitoring
9. **Use caching** - Implement ETags, Cache-Control headers
10. **Test thoroughly** - Unit, integration, and contract tests

## Anti-Patterns

- ❌ **Exposing internal IDs** - Use UUIDs or opaque identifiers
- ❌ **Returning too much data** - Support field selection
- ❌ **Ignoring idempotency** - PUT/PATCH/DELETE should be idempotent
- ❌ **Inconsistent naming** - Use camelCase or snake_case consistently
- ❌ **Missing pagination** - Always paginate collections
- ❌ **No rate limiting** - Protect against abuse
- ❌ **Verbose error messages** - Don't leak implementation details
- ❌ **Synchronous long operations** - Use async jobs for long tasks

## References

- REST API Design Rulebook by Mark Masse
- GraphQL Best Practices (graphql.org)
- API Design Patterns by JJ Geewax
- OpenAPI Specification (swagger.io)
