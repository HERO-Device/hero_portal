#!/usr/bin/env python3
"""Threaded HTTP server for HERO Clinical Dashboard.
Run from hero_portal/ directory: python server.py"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8081

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress request logging to keep terminal clean
        pass

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with ThreadingHTTPServer(('', PORT), Handler) as httpd:
        print(f"HERO Dashboard → http://localhost:{PORT}/hero_dashboard/")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
