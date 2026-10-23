# Issue #1 — 개발 기반과 검증 하네스

관련 Issue: [#1](https://github.com/nam9nine/yaku_IPhone/issues/1)

## 목적과 범위

잠금/홈 화면을 만들기 전에 재현 가능한 개발 환경, 실제 결과를 남기는 하네스, 리뷰·배포 경로를 갖춘다.

포함: Node.js 24.22.0 로컬 도구, React/Vite/TypeScript strict 기반, npm 검사 명령, browser/visual 기반, 증거 검증, GitHub 템플릿·규칙 문서·스킬, 다섯 MIT 레퍼런스 보관, GitHub Pages 배포 경로.

제외: iPhone 잠금/홈 UI의 완성, 문자·전화·사진·메모 기능, 실제 iPhone Safari 검증 완료 주장. 제품 UI는 별도 Issue에서 구현한다.

## 구현 순서

1. 도구와 최소 앱 기반을 준비한다.
2. 품질·browser·visual·harness 검사 명령을 연결한다.
3. 실제 실행 증거와 SHA를 PR에 연결하는 형식을 구현한다.
4. 개발 규칙, 시각 QA, 전달 스킬과 GitHub 템플릿을 작성한다.
5. 커밋이 고정된 레퍼런스를 로컬에 보관하고 manifest·라이선스를 추적한다.
6. 검증·독립 리뷰 후 PR을 병합하고 main의 Pages 배포를 확인한다.

## 검증

- 검사 명령이 존재하는 것과 실제 성공한 것을 구분한다.
- CI의 `quality`, `browser`, `evidence`, `merge-gate`가 요구 조건을 전달한다.
- 증거 없음·현재 SHA 불일치·실패한 선행 job이 최종 통과로 바뀌지 않는다.
- macOS와 Linux screenshot baseline을 분리하고 실제로 이미지를 확인한다.
- 기반 화면의 검증 결과는 기반 화면에만 적용한다.
- GitHub Pages의 프로젝트 base 경로에서 자산이 로드된다.

## 결정과 제약

진행 상태와 완료 여부는 Issue가 원본이다. 이 문서는 계획이며 성공 결과가 아니다. 실제 실행 내역·실패·배포 SHA는 evidence와 GitHub 기록에 남긴다.

자동 squash merge와 main 병합 후 공개 배포가 승인되었다. 같은 GitHub 계정의 정식 승인 대신 의미 있는 독립 에이전트 검토를 기록한다. 승인되지 않은 범위 확대는 이 계획에 포함하지 않는다.
