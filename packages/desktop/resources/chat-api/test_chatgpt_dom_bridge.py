import http.client
import json
import threading
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
