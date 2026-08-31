from __future__ import annotations

from standalone_crawler.cleaners import (
    clean_paragraphs,
    clean_text_block,
    clean_whitespace,
    dedupe_preserve_order,
)


class TestCleanWhitespace:
    def test_collapses_repeated_spaces(self):
        assert clean_whitespace("a    b") == "a b"

    def test_collapses_tabs(self):
        assert clean_whitespace("a\t\tb") == "a b"

    def test_collapses_excessive_blank_lines(self):
        assert clean_whitespace("a\n\n\n\n\nb") == "a\n\nb"

    def test_strips_leading_trailing_whitespace(self):
        assert clean_whitespace("   a b   ") == "a b"

    def test_empty_string_returns_empty(self):
        assert clean_whitespace("") == ""

    def test_none_like_falsy_returns_empty(self):
        assert clean_whitespace("") == ""


class TestDedupePreserveOrder:
    def test_removes_exact_duplicates(self):
        assert dedupe_preserve_order(["a", "b", "a", "c"]) == ["a", "b", "c"]

    def test_preserves_first_occurrence_order(self):
        assert dedupe_preserve_order(["c", "b", "a", "b"]) == ["c", "b", "a"]

    def test_drops_empty_strings(self):
        assert dedupe_preserve_order(["a", "", "  ", "b"]) == ["a", "b"]


class TestCleanParagraphs:
    def test_drops_empty_paragraphs(self):
        assert clean_paragraphs(["Hello", "", "   ", "World"]) == ["Hello", "World"]

    def test_dedupes_paragraphs(self):
        assert clean_paragraphs(["Same text.", "Same text."]) == ["Same text."]

    def test_cleans_internal_whitespace(self):
        result = clean_paragraphs(["Too    many   spaces."])
        assert result == ["Too many spaces."]

    def test_does_not_alter_meaning(self):
        original = "The quick brown fox jumps over the lazy dog."
        assert clean_paragraphs([original]) == [original]


class TestCleanTextBlock:
    def test_preserves_paragraph_breaks(self):
        text = "Para one.\n\nPara two."
        assert clean_text_block(text) == "Para one.\n\nPara two."

    def test_collapses_excess_blank_lines(self):
        text = "Para one.\n\n\n\nPara two."
        assert clean_text_block(text) == "Para one.\n\nPara two."
