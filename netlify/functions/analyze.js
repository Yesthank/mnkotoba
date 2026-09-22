// Gemini 프록시. API 키는 여기서만 쓰이고 브라우저로 나가지 않습니다.

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Gemini 응답을 기다리는 최대 시간.
// 일반(동기) Netlify 함수는 10초에 강제 종료되지만, 본문을 ReadableStream으로 돌려주는
// 스트리밍 함수는 60초까지 허용됩니다. 그래서 아래 handler는 응답을 스트림으로 내보내고,
// 그 안에서 이만큼 기다립니다. 60초 한도 안이면 더 늘려도 됩니다.
const GEMINI_TIMEOUT_MS = 17000;
const HEARTBEAT_MS = 3000; // 기다리는 동안 공백 한 칸씩 흘려 연결이 끊기지 않게 합니다

// 분당 한도(429)에 걸렸을 때 한 번은 기다렸다 다시 걸어봅니다.
// 구글이 RetryInfo 로 "몇 초 뒤에 오라"고 알려주는데, 보통 십몇 초입니다.
// 스트리밍 함수 한도가 60초이므로 총 예산을 그 안쪽으로 잡습니다.
const MAX_RETRY_WAIT_MS = 15000;
const TOTAL_BUDGET_MS = 50000;
const ENDPOINT = (m) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

const POS = [
  'noun', 'verb', 'adj-i', 'adj-na', 'adverb',
  'particle', 'auxiliary', 'conjunction', 'pronoun',
  'counter', 'interjection', 'expression', 'other',
];

// responseSchema를 주면 모델이 JSON 파싱 실패 없이 정해진 모양으로만 답합니다.
const schema = {
  type: 'object',
  properties: {
    original: { type: 'string', description: '정규화한 일본어 원문' },
    reading: { type: 'string', description: '전체 문장의 히라가나 읽기' },
    translation: { type: 'string', description: '자연스러운 한국어 번역' },
    literal: { type: 'string', description: '구조가 보이는 직역' },
    register: {
      type: 'string',
      description: '문체와 말투. 예: 반말 / 정중체(です・ます) / 겸양어 / 남성적 구어',
    },
    jlpt: { type: 'string', enum: ['N5', 'N4', 'N3', 'N2', 'N1', 'unknown'] },
    tokens: {
      type: 'array',
      description: '형태소 단위로 끊은 목록. 원문을 순서대로 빠짐없이 덮어야 함.',
      items: {
        type: 'object',
        properties: {
          surface: { type: 'string', description: '원문에 나타난 그대로의 표기' },
          reading: { type: 'string', description: 'surface의 히라가나 읽기' },
          lemma: { type: 'string', description: '사전형 기본형' },
          lemmaReading: { type: 'string' },
          pos: { type: 'string', enum: POS },
          meaning: {
            type: 'string',
            description: '사전형(lemma)의 한국어 뜻. 활용을 반영하지 않은 기본형 뜻.',
          },
          inContext: {
            type: 'string',
            description: '원문에 나온 이 활용형이 실제로 뜻하는 바. 활용이 없으면 빈 문자열.',
          },
          note: { type: 'string', description: '활용/변형 설명. 없으면 빈 문자열' },
          jlpt: { type: 'string', enum: ['N5', 'N4', 'N3', 'N2', 'N1', 'unknown'] },
          worth: {
            type: 'boolean',
            description: '따로 외울 가치가 있는 항목이면 true. 조사·기호는 false.',
          },
        },
        required: ['surface', 'reading', 'lemma', 'pos', 'meaning', 'worth'],
      },
    },
    grammar: {
      type: 'array',
      description: '문장에 쓰인 문법 패턴. 없으면 빈 배열.',
      items: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '예: 〜てしまう, 〜なければならない' },
          reading: { type: 'string' },
          meaning: { type: 'string', description: '한 줄 한국어 뜻' },
          explanation: { type: 'string', description: '언제 왜 쓰는지 2~3문장' },
          example: { type: 'string', description: '원문과 다른 새 예문' },
          exampleTranslation: { type: 'string' },
          jlpt: { type: 'string', enum: ['N5', 'N4', 'N3', 'N2', 'N1', 'unknown'] },
        },
        required: ['pattern', 'meaning', 'explanation', 'example', 'exampleTranslation'],
      },
    },
  },
  required: ['original', 'reading', 'translation', 'tokens', 'grammar'],
};

const SYSTEM = `너는 한국어 화자를 가르치는 일본어 교사다. 주어진 일본어를 분석한다.

규칙:
- tokens는 원문을 순서대로 빠짐없이 덮어야 한다. 조사와 구두점도 생략하지 말고 포함한다.
- 복합어와 관용구는 쪼개지 말고 하나의 token으로 둔다. 예를 들어 「食べ物」「気にする」는 각각 하나다.
- 동사와 형용사의 lemma는 반드시 사전형으로 되돌린다. 「食べました」의 lemma는 「食べる」다.
- note에는 어떤 활용을 거쳤는지 적는다. 예: "食べる의 정중 과거형".
- meaning은 반드시 lemma의 뜻이다. 활용을 반영하지 않는다.
  「届かなかった」의 meaning은 "닿다, 도달하다"이지 "닿지 않았다"가 아니다.
  뜻이 여러 개인 낱말은 이 문맥에 맞는 뜻 하나만 고르되, 형태는 기본형으로 쓴다.
- inContext에는 그 활용형이 문맥에서 실제로 뜻하는 바를 쓴다.
  「届かなかった」의 inContext는 "닿지 않았다"다. 활용이 없으면 빈 문자열로 둔다.
- worth는 조사·구두점·매우 기초적인 대명사에 false, 나머지는 true.
- reading은 한자에 대응하는 히라가나만 쓴다. 로마자를 쓰지 않는다.
- grammar에는 어휘가 아닌 문형만 넣는다. 예문은 원문을 재활용하지 말고 새로 만든다.
- 모든 설명은 한국어로 쓴다. 일본어 예문만 일본어로 둔다.
- 이미지가 주어지면 거기서 일본어 텍스트를 먼저 읽어내고, original에 그 텍스트를 넣는다.`;

export default async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'POST만 받습니다.' }, 405);
  }
  if (!process.env.GEMINI_API_KEY) {
    return json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: '요청 본문을 읽지 못했습니다.' }, 400);
  }

  const { text = '', image = null } = body;
  if (!text.trim() && !image) {
    return json({ error: '분석할 텍스트나 이미지가 필요합니다.' }, 400);
  }
  if (text.length > 2000) {
    return json({ error: '한 번에 2000자까지 분석합니다. 나눠서 넣어주세요.' }, 400);
  }

  const parts = [];
  if (image?.data && image?.mimeType) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  }
  parts.push({ text: text.trim() || '이 이미지 속 일본어를 읽고 분석해줘.' });

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      // 3.x 세대는 temperature를 무시합니다. 대신 생각하는 깊이를 낮춰 응답을 앞당깁니다.
      // 형태소를 쪼개는 일에 오래 숙고할 필요가 없습니다.
      thinkingConfig: { thinkingLevel: 'low' },
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  };

  // 스트리밍 응답. 헤더(200)는 바로 나가고, 본문은 Gemini 결과가 오면 채웁니다.
  // 상태 코드를 나중에 바꿀 수 없으니 실패도 본문의 {error}로 알립니다. 클라이언트가 이를 읽습니다.
  // 기다리는 동안 공백을 흘려도 JSON.parse는 앞쪽 공백을 무시하므로 결과는 그대로 읽힙니다.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const beat = setInterval(() => {
        try { controller.enqueue(encoder.encode(' ')); } catch { /* 이미 닫힘 */ }
      }, HEARTBEAT_MS);
      try {
        const result = await callGemini(payload);
        controller.enqueue(encoder.encode(JSON.stringify(result)));
      } catch (e) {
        controller.enqueue(encoder.encode(JSON.stringify({ error: `함수 내부 오류: ${e.message}` })));
      } finally {
        clearInterval(beat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
};

// Gemini를 부르고, 성공이면 정리된 결과를, 실패면 { error, status }를 돌려줍니다.
// 분당 한도는 잠깐 기다리면 풀리므로 한 번은 알아서 다시 겁니다.
async function callGemini(payload) {
  const started = Date.now();
  let retried = false;

  for (;;) {
    let res;
    try {
      res = await fetch(ENDPOINT(MODEL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      });
    } catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        return {
          error: `분석이 ${GEMINI_TIMEOUT_MS / 1000}초를 넘겨 중단했습니다. 문장을 짧게 나눠서 넣어보세요.`,
          status: 504,
        };
      }
      throw e;
    }

    const raw = await res.text();
    let data = null;
    try { data = JSON.parse(raw); } catch { /* JSON이 아님 */ }

    if (res.status === 429) {
      const q = readQuota(data);

      // 하루 한도는 기다려도 안 풀립니다. 태평양 시간 자정에 초기화됩니다.
      if (q.perDay) {
        return {
          error: `무료 티어 하루 한도(${q.limit || '?'}건)를 다 썼습니다. `
            + '태평양 시간 자정에 초기화됩니다. 계속 쓰려면 결제를 연결하거나 가벼운 모델로 바꾸세요.',
          status: 429,
        };
      }

      const wait = Math.min(q.retryMs ?? 12000, MAX_RETRY_WAIT_MS);
      const room = TOTAL_BUDGET_MS - (Date.now() - started) - wait - GEMINI_TIMEOUT_MS;
      if (!retried && room > 0) {
        retried = true;
        await sleep(wait);
        continue;
      }
      return {
        error: `무료 티어 분당 한도(${q.limit || '분당 요청 수'})에 걸렸습니다. `
          + `${Math.ceil(wait / 1000)}초쯤 뒤에 다시 시도하세요.`,
        status: 429,
      };
    }

    if (!res.ok) {
      return {
        error: data?.error?.message || `Gemini가 ${res.status}로 응답했습니다. ${raw.slice(0, 120)}`,
        status: 502,
      };
    }

    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!out) {
      const reason = data?.candidates?.[0]?.finishReason;
      const msg = reason === 'SAFETY'
        ? '안전 필터에 걸린 입력입니다.'
        : reason === 'MAX_TOKENS'
          ? '문장이 너무 길어 결과가 잘렸습니다. 짧게 나눠서 넣어주세요.'
          : `빈 응답을 받았습니다. (${reason || '이유 불명'})`;
      return { error: msg, status: 502 };
    }

    return normalize(JSON.parse(out));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 429 본문에서 어떤 한도에 걸렸는지 읽어냅니다.
 * 구글은 details 에 QuotaFailure(어떤 할당량을 얼마나) 와 RetryInfo(언제 다시) 를 같이 담아 보냅니다.
 * 분당인지 하루인지에 따라 할 수 있는 일이 다르므로 꼭 구분해야 합니다.
 */
function readQuota(data) {
  const details = data?.error?.details || [];
  const out = { perDay: false, limit: '', retryMs: null };

  for (const d of details) {
    const type = String(d['@type'] || '');
    if (type.endsWith('QuotaFailure')) {
      const v = d.violations?.[0];
      const id = String(v?.quotaId || v?.quotaMetric || '');
      if (/PerDay|per_day/i.test(id)) out.perDay = true;
      if (v?.quotaValue) out.limit = String(v.quotaValue);
    }
    if (type.endsWith('RetryInfo')) {
      const m = /([\d.]+)s/.exec(String(d.retryDelay || ''));
      if (m) out.retryMs = Math.ceil(Number(m[1]) * 1000);
    }
  }
  return out;
}

// 스키마가 있어도 선택 필드는 빠질 수 있으니 클라이언트가 믿고 쓸 모양으로 맞춰줍니다.
function normalize(r) {
  return {
    original: r.original || '',
    reading: r.reading || '',
    translation: r.translation || '',
    literal: r.literal || '',
    register: r.register || '',
    jlpt: r.jlpt || 'unknown',
    tokens: (r.tokens || []).map((t) => ({
      surface: t.surface || '',
      reading: t.reading || '',
      lemma: t.lemma || t.surface || '',
      lemmaReading: t.lemmaReading || t.reading || '',
      pos: POS.includes(t.pos) ? t.pos : 'other',
      meaning: t.meaning || '',
      inContext: t.inContext || '',
      note: t.note || '',
      jlpt: t.jlpt || 'unknown',
      worth: t.worth !== false,
    })),
    grammar: (r.grammar || []).map((g) => ({
      pattern: g.pattern || '',
      reading: g.reading || '',
      meaning: g.meaning || '',
      explanation: g.explanation || '',
      example: g.example || '',
      exampleTranslation: g.exampleTranslation || '',
      jlpt: g.jlpt || 'unknown',
    })),
  };
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export const config = { path: '/api/analyze' };