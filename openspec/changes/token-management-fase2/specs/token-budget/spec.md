# Delta for token-budget

## ADDED Requirements

### Requirement: Pre-Request Model Resolution

When a user initiates an LLM request, the system MUST resolve the requested model against the user's current token balance before executing the request.

Zen models (where `providerID.startsWith("opencode")`) MUST always pass without balance check.

For paid models, the system MUST check the user's current balance. If balance is ≤ 0, the system MUST attempt to find an available Zen model from the same provider family. If a Zen model is available, the system SHOULD substitute it transparently. If no Zen model is available, the system MUST fail with `BudgetExhaustedError`.

#### Scenario: Paid model with sufficient balance

- GIVEN user has balance > 0
- WHEN a paid model is requested
- THEN the original model proceeds to execution
- AND no model swap occurs

#### Scenario: Paid model with zero balance, Zen fallback available

- GIVEN user has balance ≤ 0
- AND a Zen model exists for the same family
- WHEN a paid model is requested
- THEN the request is transparently routed to the Zen model
- AND no balance deduction occurs

#### Scenario: Paid model with zero balance, no Zen fallback

- GIVEN user has balance ≤ 0
- AND no Zen model is available
- WHEN a paid model is requested
- THEN `BudgetExhaustedError` is raised
- AND the error includes `message` suitable for upsell

#### Scenario: Zen model requested

- GIVEN user has balance = 0
- WHEN a Zen model (`providerID.startsWith("opencode")`) is requested
- THEN the request proceeds without balance check
- AND no deduction occurs

### Requirement: Post-Request Usage Deduction

After an LLM response completes, the system MUST deduct the real usage cost from the user's token balance and record the transaction.

#### Scenario: Successful paid completion

- GIVEN a paid model was used for the request
- AND `Session.getUsage()` returns real token/cost data
- WHEN `step-finish` event fires
- THEN the system deducts `usage.cost` from the user's `token_balance`
- AND appends a row to `token_transaction` with `amount = -cost`, `model`, `tokensUsed`, `costUsd`

#### Scenario: Deduction with insufficient remaining balance

- GIVEN paid model usage exceeds remaining balance
- WHEN deduction is attempted
- THEN balance MAY go negative (no hard block on deduction)
- AND the transaction is still recorded

### Requirement: Free-First Routing

Free models (providerID starts with "opencode") MUST never trigger balance deduction.

#### Scenario: Zen model, no deduction

- GIVEN a Zen model processes a request
- WHEN the request completes
- THEN `deduct` MUST NOT be called
- AND no transaction row is created

### Requirement: BudgetExhaustedError Integration

The `BudgetExhaustedError` MUST propagate through the session retry system as an upsell message.

#### Scenario: Budget exhausted in session

- GIVEN `BudgetExhaustedError` is raised during a session
- WHEN the error reaches the retry handler
- THEN the message `"Free usage exceeded, subscribe to Go"` SHOULD be displayed
- AND the user sees a link to `https://opencode.ai/go`
