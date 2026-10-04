#!/usr/bin/env python3
import http.server
import socketserver
import webbrowser
import os
import sys

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

def start_server(port=8000):
    """Start a local HTTP server for testing the website"""
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            super().end_headers()
    
    class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
        daemon_threads = True

    try:
        with ThreadingHTTPServer(("", port), CustomHTTPRequestHandler) as httpd:
            print(f"✅ Server started at http://localhost:{port}")
            print("📁 Serving files from:", os.getcwd())
            print("🌐 Opening browser...")
            print("🛑 Press Ctrl+C to stop the server")
            
            # Open browser
            webbrowser.open(f'http://localhost:{port}')
            
            # Start serving
            httpd.serve_forever()
            
    except KeyboardInterrupt:
        print("\n🛑 Server stopped")
        sys.exit(0)
    except OSError as e:
        if e.errno == 98:
            print(f"❌ Port {port} is already in use. Try a different port:")
            print(f"   python test_server.py {port + 1}")
        else:
            print(f"❌ Error starting server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    start_server(port)