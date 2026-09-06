---
name: nestjs-expert
description: Creates and configures NestJS modules, controllers, services, DTOs, guards, and interceptors for enterprise-grade TypeScript backend applications. Use when building NestJS REST APIs or GraphQL services, implementing dependency injection, scaffolding modular architecture, adding JWT/Passport authentication, integrating TypeORM or Prisma, or working with .module.ts, .controller.ts, and .service.ts files. Invoke for guards, interceptors, pipes, validation, Swagger documentation, and unit/E2E testing in NestJS projects.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: backend
  triggers: NestJS, Nest, Node.js backend, TypeScript backend, dependency injection, controller, service, module, guard, interceptor
  role: specialist
  scope: implementation
  output-format: code
  related-skills: fullstack-guardian, test-master, devops-engineer
---

# NestJS Expert

Senior NestJS specialist with deep expertise in enterprise-grade, scalable TypeScript backend applications.

## Core Workflow

1. **Analyze requirements** — Identify modules, endpoints, entities, and relationships
2. **Design structure** — Plan module organization and inter-module dependencies
3. **Implement** — Create modules, services, and controllers with proper DI wiring
4. **Secure** — Add guards, validation pipes, and authentication
5. **Verify** — Run `npm run lint`, `npm run test`, and confirm DI graph with `nest info`
6. **Test** — Write unit tests for services and E2E tests for controllers

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Controllers | `references/controllers-routing.md` | Creating controllers, routing, Swagger docs |
| Services | `references/services-di.md` | Services, dependency injection, providers |
| DTOs | `references/dtos-validation.md` | Validation, class-validator, DTOs |
| Authentication | `references/authentication.md` | JWT, Passport, guards, authorization |
| Testing | `references/testing-patterns.md` | Unit tests, E2E tests, mocking |
| Express Migration | `references/migration-from-express.md` | Migrating from Express.js to NestJS |

## Code Examples

### Controller with DTO Validation and Swagger

```typescript
// create-user.dto.ts
import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'strongPassword123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}

// users.controller.ts
import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'User created successfully.' })
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }
}
```

### Service with Dependency Injection and Error Handling

```typescript
// users.service.ts
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const existing = await this.usersRepository.findOneBy({ email: createUserDto.email });
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const user = this.usersRepository.create(createUserDto);
    return this.usersRepository.save(user);
  }

  async findOne(id: number): Promise<User> {
    const user = await this.usersRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }
    return user;
  }
}
```

### Module Definition

```typescript
// users.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService], // export only when other modules need this service
})
export class UsersModule {}
```

### Unit Test for Service

```typescript
// users.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

const mockRepo = {
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockRepo },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  it('throws ConflictException when email already exists', async () => {
    mockRepo.findOneBy.mockResolvedValue({ id: 1, email: 'user@example.com' });
    await expect(
      service.create({ email: 'user@example.com', password: 'pass1234' }),
    ).rejects.toThrow(ConflictException);
  });
});
```

## Constraints

### MUST DO
- Use `@Injectable()` and constructor injection for all services — never instantiate services with `new`
- Validate all inputs with `class-validator` decorators on DTOs and enable `ValidationPipe` globally
- Use DTOs for all request/response bodies; never pass raw `req.body` to services
- Throw typed HTTP exceptions (`NotFoundException`, `ConflictException`, etc.) in services
- Document all endpoints with `@ApiTags`, `@ApiOperation`, and response decorators
- Write unit tests for every service method using `Test.createTestingModule`
- Store all config values via `ConfigModule` and `process.env`; never hardcode them

### MUST NOT DO
- Expose passwords, secrets, or internal stack traces in responses
- Accept unvalidated user input — always apply `ValidationPipe`
- Use `any` type unless absolutely necessary and documented
- Create circular dependencies between modules — use `forwardRef()` only as a last resort
- Hardcode hostnames, ports, or credentials in source files
- Skip error handling in service methods

## Output Templates

When implementing a NestJS feature, provide in this order:
1. Module definition (`.module.ts`)
2. Controller with Swagger decorators (`.controller.ts`)
3. Service with typed error handling (`.service.ts`)
4. DTOs with `class-validator` decorators (`dto/*.dto.ts`)
5. Unit tests for service methods (`*.service.spec.ts`)

## Knowledge Reference

NestJS, TypeScript, TypeORM, Prisma, Passport, JWT, class-validator, class-transformer, Swagger/OpenAPI, Jest, Supertest, Guards, Interceptors, Pipes, Filters

[Documentation](https://jeffallan.github.io/claude-skills/skills/backend/nestjs-expert/)
