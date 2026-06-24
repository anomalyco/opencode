"""Rotating voice phrase templates — swappable without LLM calls."""

from __future__ import annotations

import random

ACK_PHRASES = (
    "Working on that.",
    "Checking that for you.",
    "I'll be back with an answer.",
)

OFFER_PHRASES = (
    "Want me to give you more details?",
    "Should I go into more detail?",
    "Would you like to hear more?",
)

DECLINE_ACK = "Okay."

_ack_index = 0


def next_ack_phrase() -> str:
    global _ack_index
    phrase = ACK_PHRASES[_ack_index % len(ACK_PHRASES)]
    _ack_index += 1
    return phrase


def pick_offer_phrase() -> str:
    return random.choice(OFFER_PHRASES)
