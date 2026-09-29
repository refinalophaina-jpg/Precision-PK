#!/usr/bin/env python3
"""Serve index.html under the EXACT production CSP (hash-pinned, no
'unsafe-inline', no 'unsafe-hashes'), recomputing the hash per request.

    python3 docs/audit/serve-csp.py [port]      (default 8777; ROOT env overrides the repo root)

A UI check that does not run under this policy has not checked the UI: inline
handlers die silently in production (CLAUDE.md, UI work)."""
import http.server, socketserver, hashlib, base64, re, os, sys
ROOT = os.environ.get("ROOT", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
def script_hash():
    html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    body = re.search(r"<script>([\s\S]*?)</script>", html).group(1)
    return "sha256-" + base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode()
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=ROOT, **kw)
    def end_headers(self):
        self.send_header("Content-Security-Policy",
            "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
            "form-action 'self'; img-src 'self' data:; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            f"script-src 'self' '{script_hash()}'; connect-src 'self'")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(("", PORT), H).serve_forever()
