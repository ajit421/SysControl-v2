"""
JWT-based auth — no Telegram tokens, no .env files.
Password verified → JWT issued → used for all API calls.
"""
import time
import jwt

SECRET_KEY = None
TOKEN_EXPIRY = 86400  # 24 hours


def init_secret():
    global SECRET_KEY
    import config
    cfg = config.get_config()
    SECRET_KEY = cfg.get("jwt_secret") or cfg["password_hash"][:32] if cfg else "fallback-key"


def create_token(device_id):
    if not SECRET_KEY:
        init_secret()
    payload = {
        "device_id": device_id,
        "iat": int(time.time()),
        "exp": int(time.time()) + TOKEN_EXPIRY,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def verify_token(token):
    if not SECRET_KEY:
        init_secret()
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def get_token_from_headers(headers):
    auth = headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None
