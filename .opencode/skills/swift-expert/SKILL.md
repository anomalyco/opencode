---
name: swift-expert
description: Builds iOS/macOS/watchOS/tvOS applications, implements SwiftUI views and state management, designs protocol-oriented architectures, handles async/await concurrency, implements actors for thread safety, and debugs Swift-specific issues. Use when building iOS/macOS applications with Swift 5.9+, SwiftUI, or async/await concurrency. Invoke for protocol-oriented programming, SwiftUI state management, actors, server-side Swift, UIKit integration, Combine, or Vapor.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: language
  triggers: Swift, SwiftUI, iOS development, macOS development, async/await Swift, Combine, UIKit, Vapor
  role: specialist
  scope: implementation
  output-format: code
  related-skills: 
---

# Swift Expert

## Core Workflow

1. **Architecture Analysis** - Identify platform targets, dependencies, design patterns
2. **Design Protocols** - Create protocol-first APIs with associated types
3. **Implement** - Write type-safe code with async/await and value semantics
4. **Optimize** - Profile with Instruments, ensure thread safety
5. **Test** - Write comprehensive tests with XCTest and async patterns

> **Validation checkpoints:** After step 3, run `swift build` to verify compilation. After step 4, run `swift build -warnings-as-errors` to surface actor isolation and Sendable warnings. After step 5, run `swift test` and confirm all async tests pass.

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| SwiftUI | `references/swiftui-patterns.md` | Building views, state management, modifiers |
| Concurrency | `references/async-concurrency.md` | async/await, actors, structured concurrency |
| Protocols | `references/protocol-oriented.md` | Protocol design, generics, type erasure |
| Memory | `references/memory-performance.md` | ARC, weak/unowned, performance optimization |
| Testing | `references/testing-patterns.md` | XCTest, async tests, mocking strategies |

## Code Patterns

### async/await — Correct vs. Incorrect

```swift
// ✅ DO: async/await with structured error handling
func fetchUser(id: String) async throws -> User {
    let url = URL(string: "https://api.example.com/users/\(id)")!
    let (data, _) = try await URLSession.shared.data(from: url)
    return try JSONDecoder().decode(User.self, from: data)
}

// ❌ DON'T: mixing completion handlers with async context
func fetchUser(id: String) async throws -> User {
    return try await withCheckedThrowingContinuation { continuation in
        // Avoid wrapping existing async APIs this way when a native async version exists
        legacyFetch(id: id) { result in
            continuation.resume(with: result)
        }
    }
}
```

### SwiftUI State Management

```swift
// ✅ DO: use @Observable (Swift 5.9+) for view models
@Observable
final class CounterViewModel {
    var count = 0
    func increment() { count += 1 }
}

struct CounterView: View {
    @State private var vm = CounterViewModel()

    var body: some View {
        VStack {
            Text("\(vm.count)")
            Button("Increment", action: vm.increment)
        }
    }
}

// ❌ DON'T: reach for ObservableObject/Published when @Observable suffices
class LegacyViewModel: ObservableObject {
    @Published var count = 0  // Unnecessary boilerplate in Swift 5.9+
}
```

### Protocol-Oriented Architecture

```swift
// ✅ DO: define capability protocols with associated types
protocol Repository<Entity> {
    associatedtype Entity: Identifiable
    func fetch(id: Entity.ID) async throws -> Entity
    func save(_ entity: Entity) async throws
}

struct UserRepository: Repository {
    typealias Entity = User
    func fetch(id: UUID) async throws -> User { /* … */ }
    func save(_ user: User) async throws { /* … */ }
}

// ❌ DON'T: use classes as base types when a protocol fits
class BaseRepository {  // Avoid class inheritance for shared behavior
    func fetch(id: UUID) async throws -> Any { fatalError("Override required") }
}
```

### Actor for Thread Safety

```swift
// ✅ DO: isolate mutable shared state in an actor
actor ImageCache {
    private var cache: [URL: UIImage] = [:]

    func image(for url: URL) -> UIImage? { cache[url] }
    func store(_ image: UIImage, for url: URL) { cache[url] = image }
}

// ❌ DON'T: use a class with manual locking
class UnsafeImageCache {
    private var cache: [URL: UIImage] = [:]
    private let lock = NSLock()  // Error-prone; prefer actor isolation
    func image(for url: URL) -> UIImage? {
        lock.lock(); defer { lock.unlock() }
        return cache[url]
    }
}
```

## Constraints

### MUST DO
- Use type hints and inference appropriately
- Follow Swift API Design Guidelines
- Use `async/await` for asynchronous operations (see pattern above)
- Ensure `Sendable` compliance for concurrency
- Use value types (`struct`/`enum`) by default
- Document APIs with markup comments (`/// …`)
- Use property wrappers for cross-cutting concerns
- Profile with Instruments before optimizing

### MUST NOT DO
- Use force unwrapping (`!`) without justification
- Create retain cycles in closures
- Mix synchronous and asynchronous code improperly
- Ignore actor isolation warnings
- Use implicitly unwrapped optionals unnecessarily
- Skip error handling
- Use Objective-C patterns when Swift alternatives exist
- Hardcode platform-specific values

## Output Templates

When implementing Swift features, provide:
1. Protocol definitions and type aliases
2. Model types (structs/classes with value semantics)
3. View implementations (SwiftUI) or view controllers
4. Tests demonstrating usage
5. Brief explanation of architectural decisions

[Documentation](https://jeffallan.github.io/claude-skills/skills/language/swift-expert/)
