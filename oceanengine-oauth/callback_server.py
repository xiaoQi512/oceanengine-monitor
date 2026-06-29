"""
巨量引擎 OAuth 本地回调服务器
启动后等待浏览器回调，自动捕获 authorization_code
"""
import http.server
import urllib.parse
import sys
import json

AUTH_CODE = None

class OAuthHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global AUTH_CODE
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if 'auth_code' in params:
            AUTH_CODE = params['auth_code'][0]
            self.send_response(200)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.end_headers()
            html = """
            <html>
            <head><meta charset="utf-8"><title>授权成功</title>
            <style>
                body { font-family: 'PingFang SC','Microsoft YaHei',sans-serif;
                       display:flex; justify-content:center; align-items:center;
                       height:100vh; margin:0; background:#f5f5f5; }
                .card { background:white; padding:48px; border-radius:12px;
                        box-shadow:0 4px 24px rgba(0,0,0,0.1); text-align:center; }
                .icon { font-size:64px; margin-bottom:16px; }
                h2 { color:#333; margin:0 0 8px 0; }
                p { color:#666; margin:0; }
            </style></head>
            <body>
                <div class="card">
                    <div class="icon">✅</div>
                    <h2>授权成功！</h2>
                    <p>Authorization Code 已捕获，可以关闭此页面。</p>
                </div>
            </body></html>"""
            self.wfile.write(html.encode('utf-8'))
            print(f"\n✅ 成功捕获 Authorization Code:\n{AUTH_CODE}\n")
        else:
            self.send_response(400)
            self.send_header('Content-type', 'text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'Bad Request: missing auth_code')

    def log_message(self, format, *args):
        pass  # 静默日志

def main():
    port = 8080
    server = http.server.HTTPServer(('127.0.0.1', port), OAuthHandler)
    print(f"🚀 回调服务器已启动: http://127.0.0.1:{port}")
    print("⏳ 等待巨量引擎回调中... (收到 code 后自动关闭)")
    server.handle_request()
    server.server_close()

    if AUTH_CODE:
        # 保存到文件供后续使用
        with open('auth_code.txt', 'w') as f:
            f.write(AUTH_CODE)
        print(f"📝 auth_code 已保存到 auth_code.txt")
        return AUTH_CODE
    return None

if __name__ == '__main__':
    code = main()
    if code:
        sys.exit(0)
    else:
        sys.exit(1)
