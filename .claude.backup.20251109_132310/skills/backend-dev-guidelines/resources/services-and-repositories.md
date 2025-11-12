# Services and Repositories - Business Logic Layer

Complete guide to organizing business logic with services and data access with repositories.

## Table of Contents

- [Service Layer Overview](#service-layer-overview)
- [Dependency Injection Pattern](#dependency-injection-pattern)
- [Singleton Pattern](#singleton-pattern)
- [Repository Pattern](#repository-pattern)
- [Service Design Principles](#service-design-principles)
- [Caching Strategies](#caching-strategies)
- [Testing Services](#testing-services)

---

## Service Layer Overview

### Purpose of Services

**Services contain business logic** - the 'what' and 'why' of your application:

```
Controller asks: "Should I do this?"
Service answers: "Yes/No, here's why, and here's what happens"
Repository executes: "Here's the data you requested"
```

**Services are responsible for:**
- ✅ Business rules enforcement
- ✅ Orchestrating multiple repositories
- ✅ Transaction management
- ✅ Complex calculations
- ✅ External service integration
- ✅ Business validations

**Services should NOT:**
- ❌ Know about HTTP (Request/Response)
- ❌ Direct Prisma access (use repositories)
- ❌ Handle route-specific logic
- ❌ Format HTTP responses

---

## Dependency Injection Pattern

### Why Dependency Injection?

**Benefits:**
- Easy to test (inject mocks)
- Clear dependencies
- Flexible configuration
- Promotes loose coupling

### Excellent Example: NotificationService

**File:** `/blog-api/src/services/NotificationService.ts`

```typescript
// Define dependencies interface for clarity
export interface NotificationServiceDependencies {
    prisma: PrismaClient;
    batchingService: BatchingService;
    emailComposer: EmailComposer;
}

// Service with dependency injection
export class NotificationService {
    private prisma: PrismaClient;
    private batchingService: BatchingService;
    private emailComposer: EmailComposer;
    private preferencesCache: Map<string, { preferences: UserPreference; timestamp: number }> = new Map();
    private CACHE_TTL = (notificationConfig.preferenceCacheTTLMinutes || 5) * 60 * 1000;

    // Dependencies injected via constructor
    constructor(dependencies: NotificationServiceDependencies) {
        this.prisma = dependencies.prisma;
        this.batchingService = dependencies.batchingService;
        this.emailComposer = dependencies.emailComposer;
    }

    /**
     * Create a notification and route it appropriately
     */
    async createNotification(params: CreateNotificationParams) {
        const { recipientID, type, title, message, link, context = {}, channel = 'both', priority = NotificationPriority.NORMAL } = params;

        try {
            // Get template and render content
            const template = getNotificationTemplate(type);
            const rendered = renderNotificationContent(template, context);

            // Create in-app notification record
            const notificationId = await createNotificationRecord({
                instanceId: parseInt(context.instanceId || '0', 10),
                template: type,
                recipientUserId: recipientID,
                channel: channel === 'email' ? 'email' : 'inApp',
                contextData: context,
                title: finalTitle,
                message: finalMessage,
                link: finalLink,
            });

            // Route notification based on channel
            if (channel === 'email' || channel === 'both') {
                await this.routeNotification({
                    notificationId,
                    userId: recipientID,
                    type,
                    priority,
                    title: finalTitle,
                    message: finalMessage,
                    link: finalLink,
                    context,
                });
            }

            return notification;
        } catch (error) {
            ErrorLogger.log(error, {
                context: {
                    '[NotificationService] createNotification': {
                        type: params.type,
                        recipientID: params.recipientID,
                    },
                },
            });
            throw error;
        }
    }

    /**
     * Route notification based on user preferences
     */
    private async routeNotification(params: { notificationId: number; userId: string; type: string; priority: NotificationPriority; title: string; message: string; link?: string; context?: Record<string, any> }) {
        // Get user preferences with caching
        const preferences = await this.getUserPreferences(params.userId);

        // Check if we should batch or send immediately
        if (this.shouldBatchEmail(preferences, params.type, params.priority)) {
            await this.batchingService.queueNotificationForBatch({
                notificationId: params.notificationId,
                userId: params.userId,
                userPreference: preferences,
                priority: params.priority,
            });
        } else {
            // Send immediately via EmailComposer
            await this.sendImmediateEmail({
                userId: params.userId,
                title: params.title,
                message: params.message,
                link: params.link,
                context: params.context,
                type: params.type,
            });
        }
    }

    /**
     * Determine if email should be batched
     */
    shouldBatchEmail(preferences: UserPreference, notificationType: string, priority: NotificationPriority): boolean {
        // HIGH priority always immediate
        if (priority === NotificationPriority.HIGH) {
            return false;
        }

        // Check batch mode
        const batchMode = preferences.emailBatchMode || BatchMode.IMMEDIATE;
        return batchMode !== BatchMode.IMMEDIATE;
    }

    /**
     * Get user preferences with caching
     */
    async getUserPreferences(userId: string): Promise<UserPreference> {
        // Check cache first
        const cached = this.preferencesCache.get(userId);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.preferences;
        }

        const preference = await this.prisma.userPreference.findUnique({
            where: { userID: userId },
        });

        const finalPreferences = preference || DEFAULT_PREFERENCES;

        // Update cache
        this.preferencesCache.set(userId, {
            preferences: finalPreferences,
            timestamp: Date.now(),
        });

        return finalPreferences;
    }
}
```

**Usage in Controller:**

```typescript
// Instantiate with dependencies
const notificationService = new NotificationService({
    prisma: PrismaService.main,
    batchingService: new BatchingService(PrismaService.main),
    emailComposer: new EmailComposer(),
});

// Use in controller
const notification = await notificationService.createNotification({
    recipientID: 'user-123',
    type: 'AFRLWorkflowNotification',
    context: { workflowName: 'AFRL Monthly Report' },
});
```

**Key Takeaways:**
- Dependencies passed via constructor
- Clear interface defines required dependencies
- Easy to test (inject mocks)
- Encapsulated caching logic
- Business rules isolated from HTTP

---

## Singleton Pattern

### When to Use Singletons

**Use for:**
- Services with expensive initialization
- Services with shared state (caching)
- Services accessed from many places
- Permission services
- Configuration services

### Example: PermissionService (Singleton)

**File:** `/blog-api/src/services/permissionService.ts`

```typescript
import { PrismaClient } from '@prisma/client';

class PermissionService {
    private static instance: PermissionService;
    private prisma: PrismaClient;
    private permissionCache: Map<string, { canAccess: boolean; timestamp: number }> = new Map();
    private CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    // Private constructor prevents direct instantiation
    private constructor() {
        this.prisma = PrismaService.main;
    }

    // Get singleton instance
    public static getInstance(): PermissionService {
        if (!PermissionService.instance) {
            PermissionService.instance = new PermissionService();
        }
        return PermissionService.instance;
    }

    /**
     * Check if user can complete a workflow step
     */
    async canCompleteStep(userId: string, stepInstanceId: number): Promise<boolean> {
        const cacheKey = `${userId}:${stepInstanceId}`;

        // Check cache
        const cached = this.permissionCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.canAccess;
        }

        try {
            const post = await this.prisma.post.findUnique({
                where: { id: postId },
                include: {
                    author: true,
                    comments: {
                        include: {
                            user: true,
                        },
                    },
                },
            });

            if (!post) {
                return false;
            }

            // Check if user has permission
            const canEdit = post.authorId === userId ||
                await this.isUserAdmin(userId);

            // Cache result
            this.permissionCache.set(cacheKey, {
                canAccess: isAssigned,
                timestamp: Date.now(),
            });

            return isAssigned;
        } catch (error) {
            console.error('[PermissionService] Error checking step permission:', error);
            return false;
        }
    }

    /**
     * Clear cache for user
     */
    clearUserCache(userId: string): void {
        for (const [key] of this.permissionCache) {
            if (key.startsWith(`${userId}:`)) {
                this.permissionCache.delete(key);
            }
        }
    }

    /**
     * Clear all cache
     */
    clearCache(): void {
        this.permissionCache.clear();
    }
}

// Export singleton instance
export const permissionService = PermissionService.getInstance();
```

**Usage:**

```typescript
import { permissionService } from '../services/permissionService';

// Use anywhere in the codebase
const canComplete = await permissionService.canCompleteStep(userId, stepId);

if (!canComplete) {
    throw new ForbiddenError('You do not have permission to complete this step');
}
```

---

## Repository Pattern

### Purpose of Repositories

**Repositories abstract data access** - the 'how' of data operations:

```
Service: "Get me all active users sorted by name"
Repository: "Here's the Prisma query that does that"
```

**Repositories are responsible for:**
- ✅ All Prisma operations
- ✅ Query construction
- ✅ Query optimization (select, include)
- ✅ Database error handling
- ✅ Caching database results

**Repositories should NOT:**
- ❌ Contain business logic
- ❌ Know about HTTP
- ❌ Make decisions (that's service layer)

### Repository Template

```typescript
// repositories/UserRepository.ts
import { PrismaService } from '@project-lifecycle-portal/database';
import type { User, Prisma } from '@project-lifecycle-portal/database';

export class UserRepository {
    /**
     * Find user by ID with optimized query
     */
    async findById(userId: string): Promise<User | null> {
        try {
            return await PrismaService.main.user.findUnique({
                where: { userID: userId },
                select: {
                    userID: true,
                    email: true,
                    name: true,
                    isActive: true,
                    roles: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
        } catch (error) {
            console.error('[UserRepository] Error finding user by ID:', error);
            throw new Error(`Failed to find user: ${userId}`);
        }
    }

    /**
     * Find all active users
     */
    async findActive(options?: { orderBy?: Prisma.UserOrderByWithRelationInput }): Promise<User[]> {
        try {
            return await PrismaService.main.user.findMany({
                where: { isActive: true },
                orderBy: options?.orderBy || { name: 'asc' },
                select: {
                    userID: true,
                    email: true,
                    name: true,
                    roles: true,
                },
            });
        } catch (error) {
            console.error('[UserRepository] Error finding active users:', error);
            throw new Error('Failed to find active users');
        }
    }

    /**
     * Find user by email
     */
    async findByEmail(email: string): Promise<User | null> {
        try {
            return await PrismaService.main.user.findUnique({
                where: { email },
            });
        } catch (error) {
            console.error('[UserRepository] Error finding user by email:', error);
            throw new Error(`Failed to find user with email: ${email}`);
        }
    }

    /**
     * Create new user
     */
    async create(data: Prisma.UserCreateInput): Promise<User> {
        try {
            return await PrismaService.main.user.create({ data });
        } catch (error) {
            console.error('[UserRepository] Error creating user:', error);
            throw new Error('Failed to create user');
        }
    }

    /**
     * Update user
     */
    async update(userId: string, data: Prisma.UserUpdateInput): Promise<User> {
        try {
            return await PrismaService.main.user.update({
                where: { userID: userId },
                data,
            });
        } catch (error) {
            console.error('[UserRepository] Error updating user:', error);
            throw new Error(`Failed to update user: ${userId}`);
        }
    }

    /**
     * Delete user (soft delete by setting isActive = false)
     */
    async delete(userId: string): Promise<User> {
        try {
            return await PrismaService.main.user.update({
                where: { userID: userId },
                data: { isActive: false },
            });
        } catch (error) {
            console.error('[UserRepository] Error deleting user:', error);
            throw new Error(`Failed to delete user: ${userId}`);
        }
    }

    /**
     * Check if email exists
     */
    async emailExists(email: string): Promise<boolean> {
        try {
            const count = await PrismaService.main.user.count({
                where: { email },
            });
            return count > 0;
        } catch (error) {
            console.error('[UserRepository] Error checking email exists:', error);
            throw new Error('Failed to check if email exists');
        }
    }
}

// Export singleton instance
export const userRepository = new UserRepository();
```

**Using Repository in Service:**

```typescript
// services/userService.ts
import { userRepository } from '../repositories/UserRepository';
import { ConflictError, NotFoundError } from '../utils/errors';

export class UserService {
    /**
     * Create new user with business rules
     */
    async createUser(data: { email: string; name: string; roles: string[] }): Promise<User> {
        // Business rule: Check if email already exists
        const emailExists = await userRepository.emailExists(data.email);
        if (emailExists) {
            throw new ConflictError('Email already exists');
        }

        // Business rule: Validate roles
        const validRoles = ['admin', 'operations', 'user'];
        const invalidRoles = data.roles.filter((role) => !validRoles.includes(role));
        if (invalidRoles.length > 0) {
            throw new ValidationError(`Invalid roles: ${invalidRoles.join(', ')}`);
        }

        // Create user via repository
        return await userRepository.create({
            email: data.email,
            name: data.name,
            roles: data.roles,
            isActive: true,
        });
    }

    /**
     * Get user by ID
     */
    async getUser(userId: string): Promise<User> {
        const user = await userRepository.findById(userId);

        if (!user) {
            throw new NotFoundError(`User not found: ${userId}`);
        }

        return user;
    }
}
```

---

## Service Design Principles

### 1. Single Responsibility

Each service should have ONE clear purpose:

```typescript
// ✅ GOOD - Single responsibility
class UserService {
    async createUser() {}
    async updateUser() {}
    async deleteUser() {}
}

class EmailService {
    async sendEmail() {}
    async sendBulkEmails() {}
}

// ❌ BAD - Too many responsibilities
class UserService {
    async createUser() {}
    async sendWelcomeEmail() {}  // Should be EmailService
    async logUserActivity() {}   // Should be AuditService
    async processPayment() {}    // Should be PaymentService
}
```

### 2. Clear Method Names

Method names should describe WHAT they do:

```typescript
// ✅ GOOD - Clear intent
async createNotification()
async getUserPreferences()
async shouldBatchEmail()
async routeNotification()

// ❌ BAD - Vague or misleading
async process()
async handle()
async doIt()
async execute()
```

### 3. Return Types

Always use explicit return types:

```typescript
// ✅ GOOD - Explicit types
async createUser(data: CreateUserDTO): Promise<User> {}
async findUsers(): Promise<User[]> {}
async deleteUser(id: string): Promise<void> {}

// ❌ BAD - Implicit any
async createUser(data) {}  // No types!
```

### 4. Error Handling

Services should throw meaningful errors:

```typescript
// ✅ GOOD - Meaningful errors
if (!user) {
    throw new NotFoundError(`User not found: ${userId}`);
}

if (emailExists) {
    throw new ConflictError('Email already exists');
}

// ❌ BAD - Generic errors
if (!user) {
    throw new Error('Error');  // What error?
}
```

### 5. Avoid God Services

Don't create services that do everything:

```typescript
// ❌ BAD - God service
class WorkflowService {
    async startWorkflow() {}
    async completeStep() {}
    async assignRoles() {}
    async sendNotifications() {}  // Should be NotificationService
    async validatePermissions() {}  // Should be PermissionService
    async logAuditTrail() {}  // Should be AuditService
    // ... 50 more methods
}

// ✅ GOOD - Focused services
class WorkflowService {
    constructor(
        private notificationService: NotificationService,
        private permissionService: PermissionService,
        private auditService: AuditService
    ) {}

    async startWorkflow() {
        // Orchestrate other services
        await this.permissionService.checkPermission();
        await this.workflowRepository.create();
        await this.notificationService.notify();
        await this.auditService.log();
    }
}
```

---

## Caching Strategies

### 1. In-Memory Caching

```typescript
class UserService {
    private cache: Map<string, { user: User; timestamp: number }> = new Map();
    private CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    async getUser(userId: string): Promise<User> {
        // Check cache
        const cached = this.cache.get(userId);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.user;
        }

        // Fetch from database
        const user = await userRepository.findById(userId);

        // Update cache
        if (user) {
            this.cache.set(userId, { user, timestamp: Date.now() });
        }

        return user;
    }

    clearUserCache(userId: string): void {
        this.cache.delete(userId);
    }
}
```

### 2. Cache Invalidation

```typescript
class UserService {
    async updateUser(userId: string, data: UpdateUserDTO): Promise<User> {
        // Update in database
        const user = await userRepository.update(userId, data);

        // Invalidate cache
        this.clearUserCache(userId);

        return user;
    }
}
```

---

## Testing Services

### Unit Tests

```typescript
// tests/userService.test.ts
import { UserService } from '../services/userService';
import { userRepository } from '../repositories/UserRepository';
import { ConflictError } from '../utils/errors';

// Mock repository
jest.mock('../repositories/UserRepository');

describe('UserService', () => {
    let userService: UserService;

    beforeEach(() => {
        userService = new UserService();
        jest.clearAllMocks();
    });

    describe('createUser', () => {
        it('should create user when email does not exist', async () => {
            // Arrange
            const userData = {
                email: 'test@example.com',
                name: 'Test User',
                roles: ['user'],
            };

            (userRepository.emailExists as jest.Mock).mockResolvedValue(false);
            (userRepository.create as jest.Mock).mockResolvedValue({
                userID: '123',
                ...userData,
            });

            // Act
            const user = await userService.createUser(userData);

            // Assert
            expect(user).toBeDefined();
            expect(user.email).toBe(userData.email);
            expect(userRepository.emailExists).toHaveBeenCalledWith(userData.email);
            expect(userRepository.create).toHaveBeenCalled();
        });

        it('should throw ConflictError when email exists', async () => {
            // Arrange
            const userData = {
                email: 'existing@example.com',
                name: 'Test User',
                roles: ['user'],
            };

            (userRepository.emailExists as jest.Mock).mockResolvedValue(true);

            // Act & Assert
            await expect(userService.createUser(userData)).rejects.toThrow(ConflictError);
            expect(userRepository.create).not.toHaveBeenCalled();
        });
    });
});
```

---

**Related Files:**
- [SKILL.md](SKILL.md) - Main guide
- [routing-and-controllers.md](routing-and-controllers.md) - Controllers that use services
- [database-patterns.md](database-patterns.md) - Prisma and repository patterns
- [complete-examples.md](complete-examples.md) - Full service/repository examples
