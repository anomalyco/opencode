## ADDED Requirements

### Requirement: capacity is reported from the server's own queue depth
A provider capacity snapshot SHALL report `slots_total`, `in_flight`, and derived
`free_slots` taken from the provider's own inference telemetry whenever that telemetry is
available. GPU utilisation SHALL NOT be used as a busy signal when queue depth is
available.

#### Scenario: a resident but idle model is reported free
- **WHEN** a host reports `gpu_util_pct: 85` together with `inference: {busy: false, in_flight: 0, slots_total: 1}`
- **THEN** its snapshot reports one free slot and `busy: false`

#### Scenario: a genuinely serving host is reported busy
- **WHEN** a host reports `inference: {busy: true, in_flight: 1, slots_total: 1}`
- **THEN** its snapshot reports zero free slots

#### Scenario: multi-slot hosts report partial capacity
- **WHEN** a host reports `slots_total: 4, in_flight: 1`
- **THEN** its snapshot reports three free slots rather than a binary busy/idle verdict

### Requirement: every snapshot declares how it was derived
A snapshot SHALL carry a `signal` field distinguishing an exact queue-depth reading from
one inferred from GPU utilisation. Consumers SHALL be able to tell the two apart without
inspecting the underlying host.

#### Scenario: exact telemetry is labelled exact
- **WHEN** a host serves an `inference` block
- **THEN** its snapshot is labelled `exact`

#### Scenario: a host too old for queue telemetry is labelled inferred
- **WHEN** a host serves hardware data with no `inference` block
- **THEN** its snapshot is labelled `inferred` and its free-slot count is advisory

#### Scenario: exact wins over inferred
- **WHEN** both queue depth and GPU utilisation are available and disagree
- **THEN** the snapshot reflects queue depth

### Requirement: capacity readings carry their age
A snapshot SHALL report the age of the probe that produced it. A snapshot older than a
configured freshness bound SHALL be marked stale rather than presented as current.

#### Scenario: stale readings are not passed off as live
- **WHEN** a host has not responded to a probe within the freshness bound
- **THEN** its snapshot is marked stale and retains the age of the last successful probe

#### Scenario: an unreachable host is distinguishable from an idle one
- **WHEN** a host cannot be probed at all
- **THEN** its snapshot reports unreachable rather than zero in-flight requests
