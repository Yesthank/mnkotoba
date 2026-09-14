#!/usr/bin/env node
// KanjiCanvas 의 인식 엔진과 참조 패턴을 public/kanji/ 로 받아옵니다.
//
//     node scripts/build-kanji-data.mjs
//
// 원본 ref-patterns.js 는 6.4MB 인데, 좌표가 전부 소수점 열몇 자리까지 적혀 있습니다.
// 소수 한 자리로 반올림하면 2.0MB 로 줄고 인식 결과는 사실상 그대로입니다(scripts 아래 검증 참고).
// 받아온 결과를 저장소에 커밋해 두면 배포할 때 네트워크가 필요 없습니다.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';

const RAW = 'https://raw.githubusercontent.com/asdfjkl/kanjicanvas/master';
const FILES = {
  engine: `${RAW}/docs/resources/javascript/kanji-canvas.min.js`,
  patterns: `${RAW}/docs/resources/javascript/ref-patterns.js`,
  license: `${RAW}/LICENSE.TXT`,
};
const OUT = path.resolve('public/kanji');
const DECIMALS = 1;

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
const kb = (n) => `${Math.round(n / 1024)} KB`;

const [engine, patterns, license] = await Promise.all(
  [FILES.engine, FILES.patterns, FILES.license].map(get),
);

// 패턴 파일은 전역에 배열을 붙이는 스크립트라, 엔진과 함께 돌려서 값만 꺼냅니다.
const sandbox = {
  console: { log() {}, error() {} },
  document: { getElementById: () => null, addEventListener() {}, createElement: () => ({}) },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(engine, sandbox);
vm.runInContext(patterns, sandbox);

const refPatterns = sandbox.KanjiCanvas.refPatterns;
if (!Array.isArray(refPatterns) || refPatterns.length < 2000) {
  throw new Error(`참조 패턴이 이상합니다: ${refPatterns?.length}개`);
}

const json = JSON.stringify(refPatterns, (key, value) =>
  typeof value === 'number' && !Number.isInteger(value) ? Number(value.toFixed(DECIMALS)) : value,
);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'kanji-canvas.min.js'), engine);
fs.writeFileSync(path.join(OUT, 'ref-patterns.json'), json);
fs.writeFileSync(
  path.join(OUT, 'LICENSE.txt'),
  `${license.trim()}\n\n---\n출처: https://github.com/asdfjkl/kanjicanvas\n` +
    `ref-patterns.json 은 위 저장소의 ref-patterns.js 를 좌표 소수 ${DECIMALS}자리로 반올림해 JSON 으로 옮긴 것입니다.\n` +
    `scripts/build-kanji-data.mjs 로 다시 만들 수 있습니다.\n`,
);

const br = (s) => zlib.brotliCompressSync(Buffer.from(s)).length;
console.log(`public/kanji/kanji-canvas.min.js  ${kb(engine.length)}`);
console.log(`public/kanji/ref-patterns.json    ${mb(json.length)}  (brotli ${kb(br(json))}, 문자 ${refPatterns.length}자)`);
console.log('public/kanji/LICENSE.txt');
