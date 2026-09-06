---
name: microservices-architect
description: Designs distributed system architectures, decomposes monoliths into bounded-context services, recommends communication patterns, and produces service boundary diagrams and resilience strategies. Use when designing distributed systems, decomposing monoliths, or implementing microservices patterns — including service boundaries, DDD, saga patterns, event sourcing, CQRS, service mesh, or distributed tracing.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: api-architecture
  triggers: microservices, service mesh, distributed systems, service boundaries, domain-driven design, event sourcing, CQRS, saga pattern, Kubernetes microservices, Istio, distributed tracing
  role: architect
  scope: system-design
  output-format: architecture
  related-skills: devops-engineer, kubernetes-specialist, graphql-architect, architecture-designer, monitoring-expert
---

# Microservices Architect

Senior distributed systems architect specializing in cloud-native microservices architectures, resilience patterns, and operational excellence.

## Core Workflow

1. **Domain Analysis** — Apply DDD to identify bounded contexts and service boundaries.
   - *Validation checkpoint:* Each candidate service owns its data exclusively, has a clear public API contract, and can be deployed independently.
2. **Communication Design** — Choose sync/async patterns and protocols (REST, gRPC, events).
   - *Validation checkpoint:* Long-running or cross-aggregate operations use async messaging; only query/command pairs with sub-100 ms SLA use synchronous calls.
3. **Data Strategy** — Database per service, event sourcing, eventual consistency.
   - *Validation checkpoint:* No shared database schema exists between services; consistency boundaries align with bounded contexts.
4. **Resilience** — Circuit breakers, retries, timeouts, bulkheads, fallbacks.
   - *Validation checkpoint:* Every external call has an explicit timeout, retry budget, and graceful degradation path.
5. **Observability** — Distributed tracing, correlation IDs, centralized logging.
   - *Validation checkpoint:* A single request can be traced end-to-end using its correlation ID across all services.
6. **Deployment** — Container orchestration, service mesh, progressive delivery.
   - *Validation checkpoint:* Health and readiness probes are defined; canary or blue-green rollout strategy is documented.

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Service Boundaries | `references/decomposition.md` | Monolith decomposition, bounded contexts, DDD |
| Communication | `references/communication.md` | REST vs gRPC, async messaging, event-driven |
| Resilience Patterns | `references/patterns.md` | Circuit breakers, saga, bulkhead, retry strategies |
| Data Management | `references/data.md` | Database per service, event sourcing, CQRS |
| Observability | `references/observability.md` | Distributed tracing, correlation IDs, metrics |

## Implementation Examples

### Correlation ID Middleware (Node.js / Express)
```js
const { v4: uuidv4 } = require('uuid');

function correlationMiddleware(req, res, next) {
  req.correlationId = req.headers['x-correlation-id'] || uuidv4();
  res.setHeader('x-correlation-id', req.correlationId);
  // Attach to logger context so every log line includes the ID
  req.log = logger.child({ correlationId: req.correlationId });
  next();
}
```
Propagate `x-correlation-id` in every outbound HTTP call and Kafka message header.

### Circuit Breaker (Python / `pybreaker`)
```python
import pybreaker

# Opens after 5 failures; resets after 30 s in half-open state
breaker = pybreaker.CircuitBreaker(fail_max=5, reset_timeout=30)

@breaker
def call_inventory_service(order_id: str):
    response = requests.get(f"{INVENTORY_URL}/stock/{order_id}", timeout=2)
    response.raise_for_status()
    return response.json()

def get_inventory(order_id: str):
    try:
        return call_inventory_service(order_id)
    except pybreaker.CircuitBreakerError:
        return {"status": "unavailable", "fallback": True}
```

### Saga Orchestration Skeleton (TypeScript)
```ts
// Each step defines execute() and compensate() so rollback is automatic.
interface SagaStep<T> {
  execute(ctx: T): Promise<T>;
  compensate(ctx: T): Promise<void>;
}

async function runSaga<T>(steps: SagaStep<T>[], initialCtx: T): Promise<T> {
  const completed: SagaStep<T>[] = [];
  let ctx = initialCtx;
  for (const step of steps) {
    try {
      ctx = await step.execute(ctx);
      completed.push(step);
    } catch (err) {
      for (const done of completed.reverse()) {
        await done.compensate(ctx).catch(console.error);
      }
      throw err;
    }
  }
  return ctx;
}

// Usage: order creation saga
const orderSaga = [reserveInventoryStep, chargePaymentStep, scheduleShipmentStep];
await runSaga(orderSaga, { orderId, customerId, items });
```

### Health & Readiness Probe (Kubernetes)
```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 15
readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
```
`/health/live` — returns 200 if the process is running.  
`/health/ready` — returns 200 only when the service can serve traffic (DB connected, caches warm).

## Constraints

### MUST DO
- Apply domain-driven design for service boundaries
- Use database per service pattern
- Implement circuit breakers for external calls
- Add correlation IDs to all requests
- Use async communication for cross-aggregate operations
- Design for failure and graceful degradation
- Implement health checks and readiness probes
- Use API versioning strategies

### MUST NOT DO
- Create distributed monoliths
- Share databases between services
- Use synchronous calls for long-running operations
- Skip distributed tracing implementation
- Ignore network latency and partial failures
- Create chatty service interfaces
- Store shared state without proper patterns
- Deploy without observability

## Output Templates

When designing microservices architecture, provide:
1. Service boundary diagram with bounded contexts
2. Communication patterns (sync/async, protocols)
3. Data ownership and consistency model
4. Resilience patterns for each integration point
5. Deployment and infrastructure requirements

## Knowledge Reference

Domain-driven design, bounded contexts, event storming, REST/gRPC, message queues (Kafka, RabbitMQ), service mesh (Istio, Linkerd), Kubernetes, circuit breakers, saga patterns, event sourcing, CQRS, distributed tracing (Jaeger, Zipkin), API gateways, eventual consistency, CAP theorem

[Documentation](https://jeffallan.github.io/claude-skills/skills/api-architecture/microservices-architect/)
