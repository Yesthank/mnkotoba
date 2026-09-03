// PDF에서 복사한 일본어를 원문 모양으로 되돌립니다.
//
// 후리가나가 달린 세로쓰기 PDF는 한자마다 줄을 끊어서 내보내는 일이 잦습니다.
//   景
//   をはっきりと
//   思
//   いだすことができる
// 일본어는 낱말을 공백으로 나누지 않으므로, 줄만 이어붙이면 원문이 그대로 돌아옵니다.

const JP =
  '\\u3000-\\u303F' + // 구두점
  '\\u3040-\\u309F' + // 히라가나
  '\\u30A0-\\u30FF' + // 가타카나
  '\\u4E00-\\u9FFF' + // 한자
  '\\u31F0-\\u31FF' + // 작은 가타카나
  '\\uFF01-\\uFF60';  // 전각 기호

const isJp = new RegExp(`[${JP}]`);
const jpGap = new RegExp(`([${JP}]) +([${JP}])`, 'g');

// 이 글자로 끝나면 진짜 문장이 끝난 것이므로 줄바꿈을 남깁니다.
const ENDS_SENTENCE = /[。．！？!?」』）\)]$/;

export function cleanJapanese(input) {
  if (!input) return '';

  let s = String(input)
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '') // 폭 없는 문자, 소프트 하이픈
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u3000]/g, ' '); // 탭과 전각 공백을 보통 공백으로

  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';

  let out = lines[0];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const prev = out[out.length - 1];

    if (ENDS_SENTENCE.test(out)) {
      out += '\n' + line; // 문단 구분은 살립니다
    } else if (isJp.test(prev) || isJp.test(line[0])) {
      out += line; // 일본어끼리는 그냥 붙입니다
    } else {
      out += ' ' + line; // 알파벳끼리는 공백이 필요합니다
    }
  }

  // 글자 사이에 낀 공백 제거. 겹치는 자리가 있어 더 줄지 않을 때까지 반복합니다.
  for (let i = 0; i < 4; i++) {
    const next = out.replace(jpGap, '$1$2');
    if (next === out) break;
    out = next;
  }

  return out.replace(/ {2,}/g, ' ').trim();
}

/** 정리해서 달라지는 게 있는지. 알림을 띄울지 판단하는 데 씁니다. */
export const needsCleaning = (t) => Boolean(t) && cleanJapanese(t) !== t.trim();