# 코토바 노트

일본어를 붙여넣으면 통째로 풀어 읽고, 밑줄 그은 단어나 문법을 눌러 내 단어장에 담는 개인용 도구.

Vite + React · Firebase(Auth + Firestore) · Netlify Functions → Gemini Flash

---

## 1. Firebase 준비

기존 프로젝트를 그대로 써도 됩니다. 콘솔에서 두 가지만 켜면 됩니다.

1. **Authentication → Sign-in method → Google** 사용 설정
2. **Firestore Database** 생성 후, 규칙 탭에 `firestore.rules` 내용을 붙여넣고 게시

규칙의 핵심은 이 한 줄입니다. 다른 사람 데이터 경로는 전부 막힙니다.

```
match /users/{uid}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

**색인 하나만 추가로 필요합니다.** 앱을 처음 켜면 콘솔에 색인 생성 링크가 뜨는데, 그걸 누르면 자동으로 만들어집니다. 미리 만들려면 `cards` 컬렉션에 `deckId` (오름차순) + `createdAt` (내림차순) 복합 색인을 넣으세요.

## 2. Gemini 키 받기

[Google AI Studio](https://aistudio.google.com/apikey)에서 키를 발급합니다. 신용카드는 필요 없습니다.

**모델 ID는 확인하고 넣으세요.** 무료 티어에 남아 있는 모델은 자주 바뀝니다. 2026년 들어 Pro 계열은 유료로 넘어갔고 무료는 Flash 계열만 남았습니다. AI Studio 요금 페이지에서 지금 Free Tier 표시가 붙어 있는 모델 ID를 확인해 `GEMINI_MODEL`에 넣으면 됩니다.

무료 티어는 분당 요청 수가 빡빡합니다. 함수 쪽에 지수 백오프를 넣어뒀지만, 연달아 빠르게 누르면 한도에 걸릴 수 있습니다.

## 3. 로컬 실행

```bash
npm install
cp .env.example .env      # 값 채우기
npm i -g netlify-cli      # 없다면
npm run dev               # http://localhost:8888
```

`npm run dev`는 Netlify CLI로 띄웁니다. Vite만 띄우면 `/api/analyze` 함수가 안 붙으니 주의하세요.

## 4. Netlify 배포

GitHub에 올린 뒤 Netlify에서 저장소를 연결하면 `netlify.toml`에 적힌 설정을 그대로 읽습니다. 대시보드에서 환경변수만 넣어주세요.

| 이름 | 설명 |
|---|---|
| `GEMINI_API_KEY` | **서버 전용.** `VITE_` 접두사를 붙이면 브라우저 번들에 노출됩니다 |
| `GEMINI_MODEL` | 예: `gemini-2.5-flash` |
| `VITE_FB_*` | Firebase 웹 config 여섯 개 |

배포 후 Firebase 콘솔 → Authentication → Settings → **승인된 도메인**에 Netlify 주소를 추가해야 구글 로그인이 열립니다. 이걸 빠뜨리면 로그인 팝업이 바로 닫힙니다.

---

## 담긴 기능

| | |
|---|---|
| **전체 해석** | 자연스러운 번역 + 구조가 보이는 직역 + 문체(반말/정중체) 판별 |
| **형태소 분리** | 활용형을 사전형으로 되돌려 보여줍니다. 「食べました」를 눌러도 「食べる」로 담깁니다 |
| **후리가나** | 한자에만 루비를 답니다. 껐다 켤 수 있고, 내보낼 때도 `<ruby>` 태그로 따라갑니다 |
| **문법 카드** | 문형을 따로 뽑아 설명과 새 예문까지 만들어 담습니다 |
| **단어장 관리** | 만들기 · 이름 변경(이름 더블클릭) · 순서 바꾸기(드래그) · 카드 여러 개 골라 한 번에 이동 |
| **중복 표시** | 이미 담은 단어는 원문에서 붉은 점이 찍혀 바로 보입니다 |
| **이미지 입력** | 만화 컷이나 메뉴판 스크린샷을 그대로 붙여넣으면(⌘V) 읽어냅니다 |
| **발음** | 브라우저 내장 TTS라 API 호출도, 비용도 없습니다 |
| **간격 반복 복습** | SM-2를 줄인 스케줄러. Space로 뒤집고 1–4로 채점 |
| **오프라인** | Firestore 로컬 캐시. 신호 없는 지하철에서도 단어장은 넘겨집니다 |
| **내보내기** | Anki TSV · 읽는 용도 txt · 진도까지 포함한 JSON 백업 |

## Anki로 가져가기

`Anki로 내보내기`를 누르면 `.txt`가 떨어집니다. Anki에서 **파일 → 가져오기**로 열면 끝입니다. 파일 첫머리의 지시어가 구분자·덱 이름·태그 위치를 알아서 지정합니다.

```
#separator:tab
#html:true
#notetype:Basic
#deck:일본어::기본
#tags column:3
```

컬럼은 `앞면 / 뒷면 / 태그` 세 개이고, 앞면엔 `<ruby>` 후리가나가 들어갑니다. 태그는 `단어`/`문법`, 품사, JLPT 레벨이 자동으로 붙어서 Anki에서 `tag:문법` 같은 걸로 걸러 볼 수 있습니다.

한국어판 Anki를 쓰면 기본 노트 유형 이름이 `Basic`이 아닐 수 있습니다. 가져오기 창에서 노트 유형만 직접 골라주면 나머지는 그대로 먹습니다.

카드를 체크박스로 고르면 고른 것만, 아무것도 안 고르면 화면에 보이는 전부가 나갑니다. 검색이나 필터를 걸어둔 상태면 그 결과만 나가니 "이번 주에 담은 문법만" 같은 것도 됩니다.
