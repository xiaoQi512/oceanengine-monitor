"""
巨量引擎 Token 交换 + 配置文件生成
用 auth_code 换取 access_token，写入工作区配置
"""
import requests
import json
import sys
import os

CONFIG_PATH = os.path.expanduser(r"~\workbuddy\oceanengine_config.json")

def get_token(app_id, app_secret, auth_code):
    """用 auth_code 换取 access_token"""
    url = "https://api.oceanengine.com/open_api/oauth2/access_token/"
    payload = {
        "app_id": int(app_id),
        "secret": app_secret,
        "auth_code": auth_code,
        "grant_type": "auth_code"
    }
    headers = {"Content-Type": "application/json"}

    resp = requests.post(url, json=payload, headers=headers)
    data = resp.json()
    print(f"\n📡 API 响应:\n{json.dumps(data, indent=2, ensure_ascii=False)}")

    if data.get("code") == 0:
        result = data["data"]
        return {
            "access_token": result["access_token"],
            "refresh_token": result["refresh_token"],
            "expires_in": result.get("expires_in", 86400),
            "advertiser_ids": result.get("advertiser_ids", []),
        }
    else:
        print(f"\n❌ 换取 Token 失败: {data.get('message', '未知错误')}")
        return None

def save_config(app_id, app_secret, token_data):
    """保存配置到本地"""
    config = {
        "app_id": int(app_id),
        "app_secret": app_secret,
        "access_token": token_data["access_token"],
        "refresh_token": token_data["refresh_token"],
        "expires_in": token_data["expires_in"],
        "account_ids": token_data.get("advertiser_ids", [])
    }

    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

    print(f"✅ 配置已保存到: {CONFIG_PATH}")
    print(f"\n📋 关联的广告账户: {config['account_ids']}")
    return config

if __name__ == '__main__':
    # 从命令行参数或交互输入获取
    app_id = sys.argv[1] if len(sys.argv) > 1 else input("App ID: ")
    app_secret = sys.argv[2] if len(sys.argv) > 2 else input("App Secret: ")

    # 读取 auth_code
    auth_code_file = "auth_code.txt"
    if os.path.exists(auth_code_file):
        with open(auth_code_file) as f:
            auth_code = f.read().strip()
        print(f"📖 从 {auth_code_file} 读取到 auth_code")
    else:
        auth_code = input("Authorization Code: ")

    token_data = get_token(app_id, app_secret, auth_code)
    if token_data:
        save_config(app_id, app_secret, token_data)
        print("\n🎉 配置完成！现在可以开始调用巨量引擎 API 了。")
