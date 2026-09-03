export async function analyze({ text, image, signal }) {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, image }),
    signal,
  });
  const data = await res.json().catch(() => ({ error: '응답을 읽지 못했습니다.' }));
  if (!res.ok) throw new Error(data.error || '분석에 실패했습니다.');
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
