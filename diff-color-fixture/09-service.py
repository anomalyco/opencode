"""Baseline Python service: decorators, f-strings, indentation, comments."""

import asyncio
from dataclasses import dataclass


@dataclass
class Review:
    id: str
    title: str
    approved: bool = False


class ReviewService:
    def __init__(self, timeout: float = 2.0) -> None:
        self.timeout = timeout
        self.cache: dict[str, Review] = {}

    async def load(self, review_id: str) -> Review | None:
        # Return cached reviews before touching the network.
        if review_id in self.cache:
            return self.cache[review_id]
        await asyncio.sleep(self.timeout)
        return None

    def summary(self, review: Review) -> str:
        status = "approved" if review.approved else "pending"
        return f"Review {review.id}: {review.title} ({status})"


def main() -> None:
    service = ReviewService()
    review = Review(id="r-1", title="Checkout")
    print(service.summary(review))


if __name__ == "__main__":
    main()
