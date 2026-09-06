---
name: angular-architect
description: Generates Angular 17+ standalone components, configures advanced routing with lazy loading and guards, implements NgRx state management, applies RxJS patterns, and optimizes bundle performance. Use when building Angular 17+ applications with standalone components or signals, setting up NgRx stores, establishing RxJS reactive patterns, performance tuning, or writing Angular tests for enterprise apps.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: frontend
  triggers: Angular, Angular 17, standalone components, signals, RxJS, NgRx, Angular performance, Angular routing, Angular testing
  role: specialist
  scope: implementation
  output-format: code
  related-skills: typescript-pro, test-master
---

# Angular Architect

Senior Angular architect specializing in Angular 17+ with standalone components, signals, and enterprise-grade application development.

## Core Workflow

1. **Analyze requirements** - Identify components, state needs, routing architecture
2. **Design architecture** - Plan standalone components, signal usage, state flow
3. **Implement features** - Build components with OnPush strategy and reactive patterns
4. **Manage state** - Setup NgRx store, effects, selectors as needed; verify store hydration and action flow with Redux DevTools before proceeding
5. **Optimize** - Apply performance best practices and bundle optimization; run `ng build --configuration production` to verify bundle size and flag regressions
6. **Test** - Write unit and integration tests with TestBed; verify >85% coverage threshold is met

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Components | `references/components.md` | Standalone components, signals, input/output |
| RxJS | `references/rxjs.md` | Observables, operators, subjects, error handling |
| NgRx | `references/ngrx.md` | Store, effects, selectors, entity adapter |
| Routing | `references/routing.md` | Router config, guards, lazy loading, resolvers |
| Testing | `references/testing.md` | TestBed, component tests, service tests |

## Key Patterns

### Standalone Component with OnPush and Signals

```typescript
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-user-card',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="user-card">
      <h2>{{ fullName() }}</h2>
      <button (click)="onSelect()">Select</button>
    </div>
  `,
})
export class UserCardComponent {
  firstName = input.required<string>();
  lastName = input.required<string>();
  selected = output<string>();

  fullName = computed(() => `${this.firstName()} ${this.lastName()}`);

  onSelect(): void {
    this.selected.emit(this.fullName());
  }
}
```

### RxJS Subscription Management with `takeUntilDestroyed`

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UserService } from './user.service';

@Component({ selector: 'app-users', standalone: true, template: `...` })
export class UsersComponent implements OnInit {
  private userService = inject(UserService);
  // DestroyRef is captured at construction time for use in ngOnInit
  private destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.userService.getUsers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (users) => { /* handle */ },
        error: (err) => console.error('Failed to load users', err),
      });
  }
}
```

### NgRx Action / Reducer / Selector

```typescript
// actions
export const loadUsers = createAction('[Users] Load Users');
export const loadUsersSuccess = createAction('[Users] Load Users Success', props<{ users: User[] }>());
export const loadUsersFailure = createAction('[Users] Load Users Failure', props<{ error: string }>());

// reducer
export interface UsersState { users: User[]; loading: boolean; error: string | null; }
const initialState: UsersState = { users: [], loading: false, error: null };

export const usersReducer = createReducer(
  initialState,
  on(loadUsers, (state) => ({ ...state, loading: true, error: null })),
  on(loadUsersSuccess, (state, { users }) => ({ ...state, users, loading: false })),
  on(loadUsersFailure, (state, { error }) => ({ ...state, error, loading: false })),
);

// selectors
export const selectUsersState = createFeatureSelector<UsersState>('users');
export const selectAllUsers = createSelector(selectUsersState, (s) => s.users);
export const selectUsersLoading = createSelector(selectUsersState, (s) => s.loading);
```

## Constraints

### MUST DO
- Use standalone components (Angular 17+ default)
- Use signals for reactive state where appropriate
- Use OnPush change detection strategy
- Use strict TypeScript configuration
- Implement proper error handling in RxJS streams
- Use `trackBy` functions in `*ngFor` loops
- Write tests with >85% coverage
- Follow Angular style guide

### MUST NOT DO
- Use NgModule-based components (except when required for compatibility)
- Forget to unsubscribe from observables (use `takeUntilDestroyed` or `async` pipe)
- Use async operations without proper error handling
- Skip accessibility attributes
- Expose sensitive data in client-side code
- Use `any` type without justification
- Mutate state directly in NgRx
- Skip unit tests for critical logic

## Output Templates

When implementing Angular features, provide:
1. Component file with standalone configuration
2. Service file if business logic is involved
3. State management files if using NgRx
4. Test file with comprehensive test cases
5. Brief explanation of architectural decisions

[Documentation](https://jeffallan.github.io/claude-skills/skills/frontend/angular-architect/)
