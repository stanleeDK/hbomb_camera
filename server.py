import os
import requests
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder='static', static_url_path='')

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
GEMINI_MODEL = 'gemini-3.1-flash-image'


@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/api/transform', methods=['POST'])
def transform():
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
                    "- This app is for  children. Keep everything fun, friendly, and age-appropriate.\n"
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

    # No image — check if Gemini returned a text explanation instead
    text_reply = ' '.join(p['text'] for p in parts if 'text' in p).strip()
    error_msg = text_reply if text_reply else 'Gemini returned no image'
    return jsonify({'error': error_msg}), 500


if __name__ == '__main__':
    app.run(debug=True, port=8000)
