"""Screenshot + live screen streaming using mss + Pillow (no opencv)."""
import io
import mss
from PIL import Image

QUALITY_MAP = {"low": (45, 0.5), "med": (70, 0.75), "high": (90, 1.0)}


def screenshot_png():
    with mss.mss() as sct:
        img = sct.grab(sct.monitors[1])
        png = mss.tools.to_png(img.rgb, img.size)
    return png


def screenshot_jpeg(quality=70):
    with mss.mss() as sct:
        raw = sct.grab(sct.monitors[1])
        img = Image.frombytes("RGB", raw.size, raw.rgb)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def live_frame(quality_key="med"):
    q, scale = QUALITY_MAP.get(quality_key, (55, 0.6))
    with mss.mss() as sct:
        raw = sct.grab(sct.monitors[1])
        img = Image.frombytes("RGB", raw.size, raw.rgb)
    if scale < 1.0:
        w, h = img.size
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=q)
    return buf.getvalue()
