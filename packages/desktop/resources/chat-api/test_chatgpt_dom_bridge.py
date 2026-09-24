import http.client
import json
import threading
import time
import unittest
from http.server import ThreadingHTTPServer

from chatgpt_dom_bridge import Broker, make_handler


class ExtensionDiscoveryTest(unittest.TestCase):
    def test_activation_is_coalesced_without_changing_chat_ownership(self):
        broker = Broker()
        broker.owner_session = "existing-session"
        broker.active_chat = "existing-job"
        self.assertFalse(broker.activate())
        self.assertFalse(broker.activate())
        self.assertEqual(broker.jobs.qsize(), 1)
        self.assertEqual(broker.next_job(), {"operation": "activate"})
        self.assertEqual(broker.owner_session, "existing-session")
        self.assertEqual(broker.active_chat, "existing-job")
        self.assertTrue(broker.activate())
        self.assertEqual(broker.jobs.qsize(), 1)

    def test_activation_endpoint_requires_bridge_key(self):
        broker = Broker()
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(broker))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for key, expected in [("incorrect", 403), (broker.key, 200)]:
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
                connection.request("POST", "/activate", body="{}", headers={"X-Chat-Bridge-Key": key})
                response = connection.getresponse()
                self.assertEqual(response.status, expected)
                body = response.read()
                if expected == 200:
                    self.assertEqual(json.loads(body), {"ok": True, "connected": False})
                connection.close()
            self.assertEqual(broker.jobs.qsize(), 1)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


class EventBufferTest(unittest.TestCase):
    def test_discards_acknowledged_events_without_reusing_sequence_numbers(self):
        broker = Broker()
        broker.last_poll = time.monotonic()
        broker.owner_session = "session"
        job_id = broker.start({"operation": "chat", "client_session_id": "session"})

        broker.publish(job_id, {"type": "chat.accepted"})
        broker.publish(job_id, {"type": "chat.delta", "text": "first"})
        self.assertEqual([event["seq"] for event in broker.events(job_id, 0)], [1, 2])
        broker.publish(job_id, {"type": "chat.delta", "text": "second"})
        self.assertEqual([event["seq"] for event in broker.events(job_id, 2)], [3])
        self.assertEqual([event["seq"] for event in broker.pending[job_id]["events"]], [3])

        broker.publish(job_id, {"type": "chat.completed"})
        self.assertEqual([event["seq"] for event in broker.events(job_id, 2)], [3, 4])

    def test_long_stream_does_not_overflow_when_client_keeps_consuming(self):
        broker = Broker()
        broker.last_poll = time.monotonic()
        broker.owner_session = "session"
        job_id = broker.start({"operation": "chat", "client_session_id": "session"})
        after = 0

        for index in range(800):
            broker.publish(job_id, {"type": "chat.delta", "text": str(index)})
            if index % 16 == 15:
                events = broker.events(job_id, after)
                after = events[-1]["seq"]

        broker.publish(job_id, {"type": "chat.completed"})
        events = broker.events(job_id, after)
        self.assertEqual(events[-1]["type"], "chat.completed")
        self.assertEqual(events[-1]["seq"], 801)
        self.assertNotIn("EVENT_OVERFLOW", {event.get("code") for event in events})

    def test_extension_fetch_without_origin_can_discover_bridge(self):
        broker = Broker()
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(broker))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            def request(headers):
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
                connection.request("GET", "/extension/config", headers=headers)
                response = connection.getresponse()
                result = response.status, response.read()
                connection.close()
                return result

            status, body = request({"Sec-Fetch-Site": "none"})
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["key"], broker.key)
            self.assertEqual(request({})[0], 403)
            self.assertEqual(request({"Origin": "https://chatgpt.com", "Sec-Fetch-Site": "cross-site"})[0], 403)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
