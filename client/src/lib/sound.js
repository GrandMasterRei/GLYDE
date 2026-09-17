// Dosya gerektirmeyen kısa uyarı sesleri.
// Tarayıcılar sesi ancak sayfada bir etkileşimden sonra açar; ilk tıklamada ses motoru hazırlanır.
let ctx;

function getContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx ??= new Ctx();
  return ctx;
}

function unlock() {
  const c = getContext();
  if (c?.state === 'suspended') c.resume();
}
['pointerdown', 'keydown', 'touchstart'].forEach((e) =>
  window.addEventListener(e, unlock, { passive: true })
);

const TONES = {
  danger: [880, 660, 880],
  warning: [740, 988],
  task: [660, 880, 1175],
  info: [988, 1319],
};

function play(c, freqs) {
  freqs.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const t = c.currentTime + i * 0.16;
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  });
}

export function playAlert(level = 'warning') {
  try {
    const c = getContext();
    if (!c) return;
    const freqs = TONES[level] || TONES.warning;
    if (c.state === 'running') play(c, freqs);
    else c.resume().then(() => play(c, freqs)).catch(() => {});
  } catch {
    /* ses desteklenmiyorsa sessiz geç */
  }
}
