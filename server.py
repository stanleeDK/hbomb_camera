import bisect
import os
import threading
import time

import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder='static', static_url_path='')

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
GEMINI_MODEL = 'gemini-3.1-flash-image'


class RateLimiter:
    """
    Sliding-window rate limiter.

    Tracks a sorted list of request timestamps per key (IP address).
    On each check it prunes timestamps older than the window, then
    either allows the request (appending the new timestamp) or rejects it.

    Periodic cleanup removes keys that have been idle longer than one
    full window, keeping memory bounded regardless of how many IPs visit.

    Thread-safe via a single lock — acceptable because the critical section
    is tiny (a bisect + list slice, no I/O).
    """

    def __init__(self, limit: int, window: int, cleanup_every: int = 300):
        self.limit = limit            # max requests allowed in `window` seconds
        self.window = window          # rolling window size in seconds
        self._cleanup_every = cleanup_every
        self._buckets: dict[str, list[float]] = {}
        self._lock = threading.Lock()
        self._last_cleanup = time.monotonic()

    def is_allowed(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - self.window

        with self._lock:
            self._cleanup_if_due(now)

            timestamps = self._buckets.setdefault(key, [])

            # Drop all timestamps outside the window.
            # The list is always sorted ascending, so bisect finds the
            # split point in O(log n) and the slice removes expired entries.
            expired_until = bisect.bisect_right(timestamps, cutoff)
            if expired_until:
                del timestamps[:expired_until]

            if len(timestamps) >= self.limit:
                return False

            timestamps.append(now)
            return True

    def _cleanup_if_due(self, now: float) -> None:
        if now - self._last_cleanup < self._cleanup_every:
            return
        cutoff = now - self.window
        stale_keys = [k for k, ts in self._buckets.items() if not ts or ts[-1] < cutoff]
        for k in stale_keys:
            del self._buckets[k]
        self._last_cleanup = now


# 10 transforms per IP per minute
limiter = RateLimiter(limit=10, window=60)


@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/api/transform', methods=['POST'])
def transform():
    if not limiter.is_allowed(request.remote_addr):
        return jsonify({'error': 'Too many requests — please wait a moment.'}), 429

    if not GEMINI_API_KEY:
        return jsonify({'error': 'GEMINI_API_KEY not set in .env'}), 500

    data = request.get_json()
    image_b64 = data.get('image_b64')
    prompt = (data.get('prompt') or '').strip()

    if not image_b64:
        return jsonify({'error': 'Missing image'}), 400
    if not prompt:
        return jsonify({'error': 'Missing prompt'}), 400

    url = (
        f'https://generativelanguage.googleapis.com/v1beta/models/'
        f'{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}'
    )

    payload = {
        'contents': [{
            'parts': [
                {'text': (
                    "Transform the person in the photo based on the request below. "
                    "Important rules:\n"
                    "- Keep the person's face exactly as it is — do not alter, distort, or manipulate it.\n"
                    "- This app is for children. Keep everything fun, friendly, and age-appropriate.\n"
                    "- No violence, gore, adult content, or anything unsuitable for kids.\n"
                    "- Do not place the person in any overly dangerous or inappropriate situation.\n\n"
                    f"Request: {prompt}"
                )},
                {'inline_data': {'mime_type': 'image/jpeg', 'data': image_b64}}
            ]
        }],
        'generationConfig': {
            'responseModalities': ['IMAGE', 'TEXT']
        }
    }

    try:
        resp = requests.post(url, json=payload, timeout=60)
    except requests.Timeout:
        return jsonify({'error': 'Gemini request timed out after 60s'}), 504

    if resp.status_code != 200:
        return jsonify({'error': f'Gemini API error: {resp.text}'}), resp.status_code

    result = resp.json()
    parts = (
        result.get('candidates', [{}])[0]
        .get('content', {})
        .get('parts', [])
    )

    for part in parts:
        if 'inlineData' in part:
            return jsonify({
                'image_b64': part['inlineData']['data'],
                'mime_type': part['inlineData']['mimeType']
            })

    # No image — surface Gemini's text explanation if there is one
    text_reply = ' '.join(p['text'] for p in parts if 'text' in p).strip()
    error_msg = text_reply if text_reply else 'Gemini returned no image'
    return jsonify({'error': error_msg}), 500


if __name__ == '__main__':
    app.run(debug=True, port=8000)
