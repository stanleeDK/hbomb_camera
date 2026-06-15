const screens = {
  permission: document.getElementById('screen-permission'),
  denied: document.getElementById('screen-denied'),
  main: document.getElementById('screen-main'),
};

const webcam = document.getElementById('webcam');
const canvas = document.getElementById('snapshot');
const btnRequestPermission = document.getElementById('btn-request-permission');
const btnRetryPermission = document.getElementById('btn-retry-permission');
const btnSpeak = document.getElementById('btn-speak');
const recordingIndicator = document.getElementById('recording-indicator');
const speechArea = document.getElementById('speech-area');
const transcriptArea = document.getElementById('transcript-area');
const transcriptInput = document.getElementById('transcript-input');
const noSpeechArea = document.getElementById('no-speech-area');
const manualInput = document.getElementById('manual-input');
const btnTransform = document.getElementById('btn-transform');
const btnTransformManual = document.getElementById('btn-transform-manual');
const btnReRecord = document.getElementById('btn-re-record');
const loadingArea = document.getElementById('loading-area');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNumber = document.getElementById('countdown-number');
const flashOverlay = document.getElementById('flash-overlay');
const galleryArea = document.getElementById('gallery-area');
const galleryStrip = document.getElementById('gallery-strip');
const btnDownloadAll = document.getElementById('btn-download-all');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function playShutterSound() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const duration = 0.08;
  const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.9, ctx.currentTime);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start();
}

async function runCountdown() {
  countdownOverlay.style.display = 'flex';
  for (const n of [3, 2, 1]) {
    countdownNumber.textContent = n;
    countdownNumber.style.animation = 'none';
    countdownNumber.offsetHeight; // force reflow to restart animation
    countdownNumber.style.animation = '';
    await sleep(1000);
  }
  countdownOverlay.style.display = 'none';
}

function triggerFlash() {
  flashOverlay.style.display = 'block';
  flashOverlay.style.animation = 'none';
  flashOverlay.offsetHeight;
  flashOverlay.style.animation = 'flash-out 0.35s ease-out forwards';
  setTimeout(() => { flashOverlay.style.display = 'none'; }, 350);
}

function addToGallery(src) {
  const thumb = document.createElement('img');
  thumb.src = src;
  thumb.className = 'gallery-thumb';
  thumb.alt = 'Transformed photo';
  thumb.addEventListener('click', () => openLightbox(src));
  galleryStrip.prepend(thumb);
  galleryArea.style.display = '';
  // Scroll to the newest thumbnail (left edge)
  galleryStrip.scrollTo({ left: 0, behavior: 'smooth' });
}

function openLightbox(src) {
  lightboxImg.src = src;
  lightbox.classList.add('open');
}

function closeLightbox() {
  lightbox.classList.remove('open');
  lightboxImg.src = '';
}

btnDownloadAll.addEventListener('click', () => {
  const thumbs = galleryStrip.querySelectorAll('.gallery-thumb');
  thumbs.forEach((img, i) => {
    const a = document.createElement('a');
    a.href = img.src;
    a.download = `hbomb-transform-${thumbs.length - i}.jpg`;
    a.click();
  });
});

lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

let mediaStream = null;
let recognition = null;
const hasSpeechRecognition = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

async function requestPermissions() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert(
      'Camera access is not available in this browser context.\n\n' +
      'This usually means the page is not served over a secure origin. ' +
      'Open the app at http://localhost:8000 or http://127.0.0.1:8000 ' +
      '(not your machine IP address).'
    );
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    webcam.srcObject = mediaStream;
    showScreen('main');
    setupUI();
  } catch (err) {
    console.error('getUserMedia failed:', err);
    showScreen('denied');
  }
}

function setupUI() {
  if (hasSpeechRecognition) {
    speechArea.style.display = '';
    noSpeechArea.style.display = 'none';
    setupSpeechRecognition();
  } else {
    speechArea.style.display = 'none';
    noSpeechArea.style.display = '';
  }
}

function setupSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    const text = Array.from(event.results).map(r => r[0].transcript).join('');
    transcriptInput.value = text;
  };

  recognition.onend = () => {
    recordingIndicator.style.display = 'none';
    btnSpeak.disabled = false;
    if (transcriptInput.value.trim()) {
      transcriptArea.style.display = '';
      speechArea.querySelector('button').style.display = 'none';
    }
  };

  recognition.onerror = (event) => {
    recordingIndicator.style.display = 'none';
    btnSpeak.disabled = false;
    if (event.error !== 'no-speech') {
      alert('Speech recognition error: ' + event.error);
    }
  };
}

btnSpeak.addEventListener('mousedown', startRecording);
btnSpeak.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
btnSpeak.addEventListener('mouseup', stopRecording);
btnSpeak.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); });
btnSpeak.addEventListener('mouseleave', stopRecording);

function startRecording() {
  if (!recognition) return;
  transcriptInput.value = '';
  recordingIndicator.style.display = 'inline';
  btnSpeak.disabled = true;
  recognition.start();
}

function stopRecording() {
  if (!recognition) return;
  recognition.stop();
}

btnReRecord.addEventListener('click', () => {
  transcriptArea.style.display = 'none';
  speechArea.querySelector('button').style.display = '';
  transcriptInput.value = '';
  speechArea.style.display = '';
});

btnTransform.addEventListener('click', () => {
  const prompt = transcriptInput.value.trim();
  if (!prompt) { alert('Please record a prompt first.'); return; }
  sendTransform(prompt);
});

btnTransformManual.addEventListener('click', () => {
  const prompt = manualInput.value.trim();
  if (!prompt) { alert('Please type a prompt.'); return; }
  sendTransform(prompt);
});

function resetPromptUI() {
  transcriptInput.value = '';
  transcriptArea.style.display = 'none';
  speechArea.querySelector('button').style.display = '';
  speechArea.style.display = '';
  manualInput.value = '';
}

async function sendTransform(prompt) {
  btnTransform.disabled = true;
  btnTransformManual.disabled = true;

  await runCountdown();

  // Capture frame at the moment the shutter fires
  const ctx = canvas.getContext('2d');
  canvas.width = webcam.videoWidth;
  canvas.height = webcam.videoHeight;
  ctx.drawImage(webcam, 0, 0);
  const imageB64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

  playShutterSound();
  triggerFlash();

  loadingArea.style.display = '';

  try {
    const resp = await fetch('/api/transform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_b64: imageB64, prompt })
    });

    const data = await resp.json();

    if (!resp.ok) {
      alert('Error: ' + (data.error || resp.statusText));
      return;
    }

    const src = `data:${data.mime_type};base64,${data.image_b64}`;
    addToGallery(src);
    resetPromptUI();
    openLightbox(src);
  } catch (err) {
    alert('Network error: ' + err.message);
  } finally {
    loadingArea.style.display = 'none';
    btnTransform.disabled = false;
    btnTransformManual.disabled = false;
  }
}

btnRequestPermission.addEventListener('click', requestPermissions);
btnRetryPermission.addEventListener('click', requestPermissions);
