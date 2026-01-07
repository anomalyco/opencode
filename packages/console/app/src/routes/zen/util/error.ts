export class AuthError extends Error {}
export class CreditsError extends Error {}
export class MonthlyLimitError extends Error {}
export class SubscriptionError extends Error {
  retryAfter?: number
  constructor(message: string, retryAfter?: number) {
    super(message)
    this.retryAfter = retryAfter
  }
}
export class UserLimitError extends Error {}
export class ModelError extends Error {}
export class RateLimitError extends Error {}
