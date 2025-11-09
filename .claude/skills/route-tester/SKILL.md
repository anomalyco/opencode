---
name: route-tester
description: Test authenticated routes in the your project using cookie-based authentication. Use this skill when testing API endpoints, validating route functionality, or debugging authentication issues. Includes patterns for using test-auth-route.js and mock authentication.
---

# your project Route Tester Skill

## Purpose
This skill provides patterns for testing authenticated routes in the your project using cookie-based JWT authentication.

## When to Use This Skill
- Testing new API endpoints
- Validating route functionality after changes
- Debugging authentication issues
- Testing POST/PUT/DELETE operations
- Verifying request/response data

## your project Authentication Overview

The your project uses:
- **Keycloak** for SSO (realm: yourRealm)
- **Cookie-based JWT** tokens (not Bearer headers)
- **Cookie name**: `refresh_token`
- **JWT signing**: Using secret from `config.ini`

## Testing Methods

### Method 1: test-auth-route.js (RECOMMENDED)

The `test-auth-route.js` script handles all authentication complexity automatically.

**Location**: `/root/git/your project_pre/scripts/test-auth-route.js`

#### Basic GET Request

```bash
node scripts/test-auth-route.js http://localhost:3000/blog-api/api/endpoint
```

#### POST Request with JSON Data

```bash
node scripts/test-auth-route.js \
    http://localhost:3000/blog-api/777/submit \
    POST \
    '{"responses":{"4577":"13295"},"submissionID":5,"stepInstanceId":"11"}'
```

#### What the Script Does

1. Gets a refresh token from Keycloak
   - Username: `testuser`
   - Password: `testpassword`
2. Signs the token with JWT secret from `config.ini`
3. Creates cookie header: `refresh_token=<signed-token>`
4. Makes the authenticated request
5. Shows the exact curl command to reproduce manually

#### Script Output

The script outputs:
- The request details
- The response status and body
- A curl command for manual reproduction

**Note**: The script is verbose - look for the actual response in the output.

### Method 2: Manual curl with Token

Use the curl command from the test-auth-route.js output:

```bash
# The script outputs something like:
# 💡 To test manually with curl:
# curl -b "refresh_token=eyJhbGci..." http://localhost:3000/blog-api/api/endpoint

# Copy and modify that curl command:
curl -X POST http://localhost:3000/blog-api/777/submit \
  -H "Content-Type: application/json" \
  -b "refresh_token=<COPY_TOKEN_FROM_SCRIPT_OUTPUT>" \
  -d '{"your": "data"}'
```

### Method 3: Mock Authentication (Development Only - EASIEST)

For development, bypass Keycloak entirely using mock auth.

#### Setup

```bash
# Add to service .env file (e.g., blog-api/.env)
MOCK_AUTH=true
MOCK_USER_ID=test-user
MOCK_USER_ROLES=admin,operations
```

#### Usage

```bash
curl -H "X-Mock-Auth: true" \
     -H "X-Mock-User: test-user" \
     -H "X-Mock-Roles: admin,operations" \
     http://localhost:3002/api/protected
```

#### Mock Auth Requirements

Mock auth ONLY works when:
- `NODE_ENV` is `development` or `test`
- The `mockAuth` middleware is added to the route
- Will NEVER work in production (security feature)

## Common Testing Patterns

### Test Form Submission

```bash
node scripts/test-auth-route.js \
    http://localhost:3000/blog-api/777/submit \
    POST \
    '{"responses":{"4577":"13295"},"submissionID":5,"stepInstanceId":"11"}'
```

### Test Workflow Start

```bash
node scripts/test-auth-route.js \
    http://localhost:3002/api/workflow/start \
    POST \
    '{"workflowCode":"DHS_CLOSEOUT","entityType":"Submission","entityID":123}'
```

### Test Workflow Step Completion

```bash
node scripts/test-auth-route.js \
    http://localhost:3002/api/workflow/step/complete \
    POST \
    '{"stepInstanceID":789,"answers":{"decision":"approved","comments":"Looks good"}}'
```

### Test GET with Query Parameters

```bash
node scripts/test-auth-route.js \
    "http://localhost:3002/api/workflows?status=active&limit=10"
```

### Test File Upload

```bash
# Get token from test-auth-route.js first, then:
curl -X POST http://localhost:5000/upload \
  -H "Content-Type: multipart/form-data" \
  -b "refresh_token=<TOKEN>" \
  -F "file=@/path/to/file.pdf" \
  -F "metadata={\"description\":\"Test file\"}"
```

## Hardcoded Test Credentials

The `test-auth-route.js` script uses these credentials:

- **Username**: `testuser`
- **Password**: `testpassword`
- **Keycloak URL**: From `config.ini` (usually `http://localhost:8081`)
- **Realm**: `yourRealm`
- **Client ID**: From `config.ini`

## Service Ports

| Service | Port | Base URL |
|---------|------|----------|
| Users   | 3000 | http://localhost:3000 |
| Projects| 3001 | http://localhost:3001 |
| Form    | 3002 | http://localhost:3002 |
| Email   | 3003 | http://localhost:3003 |
| Uploads | 5000 | http://localhost:5000 |

## Route Prefixes

Check `/src/app.ts` in each service for route prefixes:

```typescript
// Example from blog-api/src/app.ts
app.use('/blog-api/api', formRoutes);          // Prefix: /blog-api/api
app.use('/api/workflow', workflowRoutes);  // Prefix: /api/workflow
```

**Full Route** = Base URL + Prefix + Route Path

Example:
- Base: `http://localhost:3002`
- Prefix: `/form`
- Route: `/777/submit`
- **Full URL**: `http://localhost:3000/blog-api/777/submit`

## Testing Checklist

Before testing a route:

- [ ] Identify the service (form, email, users, etc.)
- [ ] Find the correct port
- [ ] Check route prefixes in `app.ts`
- [ ] Construct the full URL
- [ ] Prepare request body (if POST/PUT)
- [ ] Determine authentication method
- [ ] Run the test
- [ ] Verify response status and data
- [ ] Check database changes if applicable

## Verifying Database Changes

After testing routes that modify data:

```bash
# Connect to MySQL
docker exec -i local-mysql mysql -u root -ppassword1 blog_dev

# Check specific table
mysql> SELECT * FROM WorkflowInstance WHERE id = 123;
mysql> SELECT * FROM WorkflowStepInstance WHERE instanceId = 123;
mysql> SELECT * FROM WorkflowNotification WHERE recipientUserId = 'user-123';
```

## Debugging Failed Tests

### 401 Unauthorized

**Possible causes**:
1. Token expired (regenerate with test-auth-route.js)
2. Incorrect cookie format
3. JWT secret mismatch
4. Keycloak not running

**Solutions**:
```bash
# Check Keycloak is running
docker ps | grep keycloak

# Regenerate token
node scripts/test-auth-route.js http://localhost:3002/api/health

# Verify config.ini has correct jwtSecret
```

### 403 Forbidden

**Possible causes**:
1. User lacks required role
2. Resource permissions incorrect
3. Route requires specific permissions

**Solutions**:
```bash
# Use mock auth with admin role
curl -H "X-Mock-Auth: true" \
     -H "X-Mock-User: test-admin" \
     -H "X-Mock-Roles: admin" \
     http://localhost:3002/api/protected
```

### 404 Not Found

**Possible causes**:
1. Incorrect URL
2. Missing route prefix
3. Route not registered

**Solutions**:
1. Check `app.ts` for route prefixes
2. Verify route registration
3. Check service is running (`pm2 list`)

### 500 Internal Server Error

**Possible causes**:
1. Database connection issue
2. Missing required fields
3. Validation error
4. Application error

**Solutions**:
1. Check service logs (`pm2 logs <service>`)
2. Check Sentry for error details
3. Verify request body matches expected schema
4. Check database connectivity

## Using auth-route-tester Agent

For comprehensive route testing after making changes:

1. **Identify affected routes**
2. **Gather route information**:
   - Full route path (with prefix)
   - Expected POST data
   - Tables to verify
3. **Invoke auth-route-tester agent**

The agent will:
- Test the route with proper authentication
- Verify database changes
- Check response format
- Report any issues

## Example Test Scenarios

### After Creating a New Route

```bash
# 1. Test with valid data
node scripts/test-auth-route.js \
    http://localhost:3002/api/my-new-route \
    POST \
    '{"field1":"value1","field2":"value2"}'

# 2. Verify database
docker exec -i local-mysql mysql -u root -ppassword1 blog_dev \
    -e "SELECT * FROM MyTable ORDER BY createdAt DESC LIMIT 1;"

# 3. Test with invalid data
node scripts/test-auth-route.js \
    http://localhost:3002/api/my-new-route \
    POST \
    '{"field1":"invalid"}'

# 4. Test without authentication
curl http://localhost:3002/api/my-new-route
# Should return 401
```

### After Modifying a Route

```bash
# 1. Test existing functionality still works
node scripts/test-auth-route.js \
    http://localhost:3002/api/existing-route \
    POST \
    '{"existing":"data"}'

# 2. Test new functionality
node scripts/test-auth-route.js \
    http://localhost:3002/api/existing-route \
    POST \
    '{"new":"field","existing":"data"}'

# 3. Verify backward compatibility
# Test with old request format (if applicable)
```

## Configuration Files

### config.ini (each service)

```ini
[keycloak]
url = http://localhost:8081
realm = yourRealm
clientId = app-client

[jwt]
jwtSecret = your-jwt-secret-here
```

### .env (each service)

```bash
NODE_ENV=development
MOCK_AUTH=true           # Optional: Enable mock auth
MOCK_USER_ID=test-user   # Optional: Default mock user
MOCK_USER_ROLES=admin    # Optional: Default mock roles
```

## Key Files

- `/root/git/your project_pre/scripts/test-auth-route.js` - Main testing script
- `/blog-api/src/app.ts` - Form service routes
- `/notifications/src/app.ts` - Email service routes
- `/auth/src/app.ts` - Users service routes
- `/config.ini` - Service configuration
- `/.env` - Environment variables

## Related Skills

- Use **database-verification** to verify database changes
- Use **error-tracking** to check for captured errors
- Use **workflow-builder** for workflow route testing
- Use **notification-sender** to verify notifications sent
