"""Vercel entrypoint that delegates dashboard API requests to the shared server."""
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "dashboard"))

from server import Handler  # noqa: E402


class handler(Handler):
    def do_GET(self):
        parsed = urlparse(self.path)
        # The root vercel.json passes the original /api/* suffix as `path`.
        # Restore it before delegating to the same handler used locally.
        if parsed.path == "/api/index":
            params = parse_qs(parsed.query, keep_blank_values=True)
            api_path = params.pop("path", [""])[0].strip("/")
            query = urlencode(params, doseq=True)
            self.path = "/api/" + api_path + ("?" + query if query else "")
        return super().do_GET()
