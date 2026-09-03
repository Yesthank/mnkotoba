// 브라우저 내장 TTS. 무료이고 네트워크도 안 탑니다.
let voice = null;

function pickVoice() {
  const all = speechSynthesis.getVoices();
  return all.find((v) => v.lang === 'ja-JP') || all.find((v) => v.lang?.startsWith('ja')) || null;
}

if (typeof speechSynthesis !== 'undefined') {
  voice = pickVoice();
  speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); };
}

export function speak(text) {
  if (!text || typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  u.rate = 0.9;
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

export const canSpeak = () => typeof speechSynthesis !== 'undefined';
