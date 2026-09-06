---
name: system-design-primer
description: Guide system design for scalable, reliable services using trade-off analysis, capacity estimates, architecture patterns, and worked examples from the System Design Primer.
---

# System Design Primer

Use this skill when designing or reviewing distributed systems, preparing a system-design interview answer, or evaluating scalability and reliability trade-offs.

## Process

1. Clarify functional requirements, users, request patterns, consistency needs, and failure expectations.
2. State non-functional requirements and assumptions explicitly.
3. Estimate scale: traffic, storage, bandwidth, peak-to-average ratio, and latency targets.
4. Define the API and core data model before choosing infrastructure.
5. Draw the simplest viable architecture, then identify bottlenecks and single points of failure.
6. Evaluate appropriate combinations of load balancing, caching, queues, replication, partitioning, CDNs, databases, and observability.
7. Explain alternatives and trade-offs, including consistency, availability, latency, cost, and operational complexity.
8. Validate the design against failure modes, hot keys/partitions, growth, recovery, and security.

## Reference material

The `README.md` file contains the primer's topic index and concise explanations. Worked examples are under `solutions/`.

Use the local reference material as supporting knowledge, not as a substitute for project-specific requirements or current service documentation. Distinguish estimates and assumptions from verified facts.
