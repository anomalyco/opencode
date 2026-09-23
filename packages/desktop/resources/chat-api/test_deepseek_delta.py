import unittest

from deepseek_delta import DeltaDecoder


class DeltaDecoderTest(unittest.TestCase):
    def test_snapshot_tracks_revisions_that_cannot_be_streamed_as_appends(self):
        decoder = DeltaDecoder()
        first = {
            "p": "",
            "o": "SET",
            "v": {"response": {"fragments": [{"type": "RESPONSE", "content": "first draft"}]}},
        }
        revised = {
            "p": "response/fragments/0/content",
            "o": "SET",
            "v": "final answer",
        }

        self.assertEqual(decoder.feed(first), "first draft")
        self.assertEqual(decoder.feed(revised), "")
        self.assertEqual(decoder.snapshot(), "final answer")

    def test_snapshot_ignores_non_response_fragments(self):
        decoder = DeltaDecoder()
        decoder.feed(
            {
                "p": "",
                "o": "SET",
                "v": {
                    "response": {
                        "fragments": [
                            {"type": "THINK", "content": "private reasoning"},
                            {"type": "RESPONSE", "content": "visible answer"},
                        ]
                    }
                },
            }
        )

        self.assertEqual(decoder.snapshot(), "visible answer")


if __name__ == "__main__":
    unittest.main()
