export async function analyze({ text, image, signal }) {
  let res;
  try {
    res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, image }),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('서버에 닿지 못했습니다. 네트워크를 확인하세요.');
  }

  // 실패 원인을 뭉개지 않으려고 본문을 글자로 먼저 받습니다.
  // Netlify가 함수를 강제 종료하거나 함수 로딩에 실패하면 우리 형식이 아닌 응답이 옵니다.
  const raw = await res.text();
  let data = null;
  try { data = JSON.parse(raw); } catch { /* JSON이 아님 */ }

  if (!res.ok) {
    const detail =
      data?.error ||                 // 우리 함수가 보낸 메시지
      data?.errorMessage ||          // Netlify 런타임이 보낸 메시지
      data?.message ||
      raw.replace(/<[^>]*>/g, ' ').trim().slice(0, 160) ||
      '본문 없음';
    throw new Error(`[${res.status}] ${detail}`);
  }

  if (!data) throw new Error('응답을 해석하지 못했습니다.');
  return data;
}

/** 이미지 파일을 Gemini가 받는 base64 형태로 바꿉니다. */
export function fileToInline(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ mimeType: file.type, data: String(r.result).split(',')[1] });
    r.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    r.readAsDataURL(file);
  });
}
