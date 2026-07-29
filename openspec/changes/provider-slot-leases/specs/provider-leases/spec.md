## ADDED Requirements

### Requirement: leases expire without their holder
A lease SHALL carry a TTL and SHALL expire without action from its holder. A crashed or
killed holder SHALL NOT be able to hold a provider slot indefinitely.

#### Scenario: a killed instance releases its slot
- **WHEN** an instance holding a lease is killed without releasing it
- **THEN** the lease expires at its TTL and the slot becomes available to others

#### Scenario: an active holder can extend
- **WHEN** a holder is still using a slot as its lease nears expiry
- **THEN** it can renew, and the slot is not offered to another instance meanwhile

### Requirement: same-host contention is resolved exactly
Concurrent instances on one host SHALL NOT both acquire the last free slot on a provider.
Same-host acquisition SHALL be atomic.

#### Scenario: four local processes race for one slot
- **WHEN** four instances on the same host simultaneously attempt to lease the single free slot of a provider
- **THEN** exactly one acquires it and the other three fall back

### Requirement: capacity is re-verified immediately before dispatch
Holding a lease SHALL NOT be sufficient to dispatch. Placement SHALL re-read live provider
capacity immediately before dispatch and abandon the placement if no slot is free,
falling back to the existing inherit-parent behaviour.

#### Scenario: a lost cross-host race falls back instead of queuing
- **WHEN** an instance holds a lease but another host has meanwhile filled the provider's only slot
- **THEN** the placement is abandoned and the subagent inherits the parent's model rather than queuing

#### Scenario: verification uses queue depth, not GPU utilisation
- **WHEN** the pre-dispatch check runs against a host reporting high GPU utilisation and zero in-flight requests
- **THEN** the slot is treated as free and dispatch proceeds

### Requirement: the lease store degrades without failing
Lease acquisition SHALL fall back through same-host, cross-host, and in-memory tiers.
Absence of a cross-host registry SHALL NOT cause an error or block placement.

#### Scenario: no coordinator present
- **WHEN** no cross-host claim registry is reachable
- **THEN** placement still works, using same-host exclusion and pre-dispatch verification

#### Scenario: standalone operation is unaffected
- **WHEN** a single instance runs with no peers and no registry
- **THEN** placement behaves as it did before leases existed, with no added latency in the common path

### Requirement: leases are observable
Active leases SHALL be exposed alongside provider capacity, identifying holder instance,
session, and expiry. A free-but-leased slot SHALL be distinguishable from a free slot.

#### Scenario: the fleet view explains an apparent contradiction
- **WHEN** a provider reports a free slot that another instance has leased but not yet dispatched to
- **THEN** the fleet view shows the slot as leased, naming the holder and expiry, rather than simply free
