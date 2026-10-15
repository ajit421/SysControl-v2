"""Text-to-Speech (offline, pyttsx3) + Live Microphone streaming."""
import io
import wave
import queue
import threading

import pyttsx3

try:
    import sounddevice as sd
    SOUNDDEVICE_OK = True
except Exception:
    SOUNDDEVICE_OK = False

_tts_lock = threading.Lock()

# Mic state
_mic_stream = None
_mic_queue = queue.Queue(maxsize=25)
_mic_rate = 16000
_mic_channels = 1


def speak(text, rate=175):
    def _do():
        with _tts_lock:
            engine = pyttsx3.init()
            engine.setProperty("rate", rate)
            engine.say(text)
            engine.runAndWait()
            engine.stop()
    threading.Thread(target=_do, daemon=True).start()
    return True


def mic_start(sample_rate=16000, channels=1):
    global _mic_stream, _mic_rate, _mic_channels
    if not SOUNDDEVICE_OK:
        return {"ok": False, "error": "sounddevice not available"}
    if _mic_stream is not None:
        return {"ok": True, "sample_rate": _mic_rate}
    _mic_rate = sample_rate
    _mic_channels = channels

    while not _mic_queue.empty():
        try:
            _mic_queue.get_nowait()
        except queue.Empty:
            break

    def callback(indata, frames, time_info, status):
        pcm = (indata * 32767).astype("int16").tobytes()
        try:
            _mic_queue.put_nowait(pcm)
        except queue.Full:
            try:
                _mic_queue.get_nowait()
                _mic_queue.put_nowait(pcm)
            except queue.Empty:
                pass

    try:
        _mic_stream = sd.InputStream(
            samplerate=_mic_rate,
            channels=_mic_channels,
            dtype="float32",
            blocksize=int(_mic_rate * 0.4),
            callback=callback,
        )
        _mic_stream.start()
        return {"ok": True, "sample_rate": _mic_rate}
    except Exception as e:
        _mic_stream = None
        return {"ok": False, "error": str(e)}


def mic_chunk():
    try:
        pcm = _mic_queue.get(timeout=1)
    except queue.Empty:
        return None
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(_mic_channels)
        wf.setsampwidth(2)
        wf.setframerate(_mic_rate)
        wf.writeframes(pcm)
    return buf.getvalue()


def mic_stop():
    global _mic_stream
    if _mic_stream:
        _mic_stream.stop()
        _mic_stream.close()
        _mic_stream = None
    return {"ok": True}


def mic_available():
    return SOUNDDEVICE_OK
