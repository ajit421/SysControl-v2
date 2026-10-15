"""Webcam capture + live streaming via OpenCV — no ffmpeg needed."""
import threading
import time

import cv2

_cam = None
_cam_lock = threading.Lock()
_live = False
_live_thread = None
_latest_raw = None
_frame_lock = threading.Lock()

QUALITY_MAP = {
    "low":  (45, 0.5),
    "med":  (70, 0.75),
    "high": (90, 1.0),
}


def _open_camera(index=0):
    cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap = cv2.VideoCapture(index)
    if not cap.isOpened():
        return None
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    return cap


def _encode(frame, q="med"):
    jpeg_q, scale = QUALITY_MAP.get(q, QUALITY_MAP["med"])
    if scale < 1.0:
        h, w = frame.shape[:2]
        frame = cv2.resize(frame, (int(w * scale), int(h * scale)))
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, jpeg_q])
    return buf.tobytes()


def capture_jpeg(quality=70):
    with _cam_lock:
        if _live and _cam and _cam.isOpened():
            ret, frame = _cam.read()
            if ret and frame is not None:
                _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
                return buf.tobytes()
            return None

    cap = _open_camera()
    if not cap:
        return None
    try:
        for _ in range(5):
            cap.read()
        ret, frame = cap.read()
        if not ret or frame is None:
            return None
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
        return buf.tobytes()
    finally:
        cap.release()


def start_live():
    global _cam, _live, _live_thread, _latest_raw
    with _cam_lock:
        if _live:
            return True
        cam = _open_camera()
        if not cam:
            return False
        _cam = cam
        _live = True
        _latest_raw = None
        _live_thread = threading.Thread(target=_capture_loop, daemon=True)
        _live_thread.start()
    for _ in range(50):
        time.sleep(0.1)
        with _frame_lock:
            if _latest_raw is not None:
                return True
    return True


def _capture_loop():
    global _cam, _live, _latest_raw
    while _live:
        with _cam_lock:
            cam = _cam
        if not cam or not cam.isOpened():
            break
        ret, frame = cam.read()
        if not ret:
            time.sleep(0.01)
            continue
        with _frame_lock:
            _latest_raw = frame
    with _cam_lock:
        if _cam:
            _cam.release()
            _cam = None


def read_live_frame(q="med"):
    with _frame_lock:
        frame = _latest_raw
    if frame is None:
        return None
    return _encode(frame, q)


def stop_live():
    global _live, _cam, _latest_raw
    with _cam_lock:
        _live = False
        if _cam:
            _cam.release()
            _cam = None
        _latest_raw = None


def is_available():
    cap = _open_camera()
    if cap:
        cap.release()
        return True
    return False
