# 코토바 노트 — 작업 메모

새 세션이 저장소를 처음부터 훑지 않아도 되도록 적어 둡니다.
길어지면 매 턴 토큰을 먹으니 짧게 유지하세요. 자세한 설정은 `README.md`.

## 구조

```
src/lib/srs.js          복습 스케줄러 (Anki v3 SM-2 이식). 이 파일이 핵심
src/lib/import.js       txt → 카드. apkg 는 scripts/apkg2txt.py 로 먼저 변환
src/lib/store.js        Firestore 읽기/쓰기. 배치 400개씩
src/lib/romaji.js       로마자 → 가나 (IME 규칙)
src/lib/handwriting.js  KanjiCanvas 인식 래퍼. 한자만, 가나는 romaji.js
src/components/Review.jsx      세션 풀을 마운트 때 만듭니다. App 에서 key={activeDeckId}
src/components/Analyzer.jsx    붙여넣기 → 분석 → 카드 담기
src/components/Handwriting.jsx 바닥 시트 UI. 모바일 키보드/스크롤 보정이 들어 있음
netlify/functions/analyze.js   Gemini 호출. 스트리밍 응답
public/kanji/           인식 데이터 2.1MB. 건드릴 일 없음
scripts/build-kanji-data.mjs   위 데이터 재생성
```

## 지켜야 할 것

- 브랜치는 `claude/upbeat-allen-9terzl`. 다른 브랜치 푸시 금지, PR 은 요청 있을 때만.
- 클라우드 설정(`firestore.rules`, Firestore 색인, Netlify 함수 설정)은 건드리지 않습니다.
- `GEMINI_API_KEY` 는 서버 전용. `VITE_` 접두사를 붙이면 번들에 노출됩니다.
- 변환한 교재·덱 `.txt` 는 커밋하지 않습니다(저작물).
- 설명·주석·커밋 메시지는 한국어.

## 복습 로직

Anki v3 스케줄러의 SM-2 경로를 옮긴 것입니다. FSRS 는 넣지 않았습니다.
`ankitects/anki` 의 `rslib/src/scheduler/states/{learning,review,relearning,steps,fuzz}.rs`
가 원본이고, 바꿀 일이 있으면 그쪽을 먼저 확인하세요.

- 카드 상태: new → learning → review → relearning
- 학습 단계 `[1, 10]`분, 재학습 `[10]`분, 졸업 1일 / 쉬움 4일
- 졸업 ease 는 언제나 2.5. 학습 중 몇 번 틀렸는지는 원본도 반영하지 않습니다
  (그걸 반영하는 게 FSRS 인데, 지금 카드 데이터에 stability/difficulty 가 없습니다)
- fuzz, hard 상한, leech 주기까지 원본과 맞춰 뒀습니다. 임의로 바꾸지 마세요

검증 스크립트는 커밋하지 않았습니다. 스케줄러를 고쳤다면 Anki 의 단위 테스트
(`rslib/src/scheduler/answering/` 아래 `mod tests`)와 대조해 직접 확인하세요.

## 명령

```bash
npm run dev     # Netlify CLI. vite 만 띄우면 /api/analyze 가 안 붙습니다
npm run build   # 고치고 나면 최소한 이건 돌려보세요
```
