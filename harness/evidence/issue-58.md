# Issue 58 — 생활 앱과 누락된 연락처·캘린더 수정

사용자의 명시적 요청으로 이번 배포는 전체 CI와 스크린샷 회귀 검사를 생략한다. 아래 로컬 검사만 실제 수행했다. CI 및 미갱신 시각 기준을 통과했다고 기록하지 않는다.

## 변경

- 기본 연락처 8명과 내 카드의 관계·메모 데이터/표시 제거. 추가한 전화번호와 메시지 이동 유지.
- 캘린더 제목·상세·접근성 라벨의 연도 제거. 현실 날짜와 무관한 고정 10월 24일 유지.
- 음악: 3곡 보관함·검색·상세와 Apple Music 감상 링크. 내부 음원 재생은 구현하지 않음.
- 택시: 나팔꽃 출발/목적지 선택/경로 카드. 위치 권한·실제 호출·결제 없음.
- 드래곤 카레: 레시피 2개, 재료, 조리 단계, 기존 카레 메모 연결.
- 가라오케관: 사용자 지정 공식 App Store 로고의 로컬 아이콘. 내부 화면 없음.
- 세 앱은 기존 AppWindow와 홈/최근 앱/뒤로 제스처를 사용하고 세션 내 화면을 보존한다.

## 관찰한 검증

macOS arm64, Node 24.22.0, Playwright 1.64.1. 실제 iPhone Safari 미검증.

- TypeScript, 변경 코드 ESLint, production build 통과.
- `vitest run src/home/homeLayout.test.ts`: 4개 통과.
- `test:e2e -- tests/browser/lifestyle.spec.ts tests/browser/home.spec.ts --workers=4`: Chromium/WebKit 52개 통과.
- 상세 스크롤/포커스 수정 후 `test:e2e -- tests/browser/lifestyle.spec.ts --workers=4`: 8개 통과. 높이 400 포함.
- 직접 캡처: 연락처, 달력, 일정, 홈, 음악 목록/곡, 택시, 요리 재료/단계. 이미지·폰트와 두 프레임을 기다린 뒤 확인.
- 2030년으로 브라우저 시계를 고정해도 달력은 연도 없이 10월 24일로 유지됨.
- 9개 연락처 상세에 설명 없음, 추가 전화번호 노출, 하루카 메시지 이동 정상.
- 캡처 위치: `harness/evidence/issue-58/`. 출처: `references/karaokekan-app.json`, `references/music-library.json`.

## 배포 예외와 남은 검사

수동 Pages의 `local_verified`는 기본 false다. 이번에만 true로 지정하여 설치·빌드·발행만 실행한다. 일반 push는 기존 전체 검사를 유지한다. 사용자 요청에 따른 이번 PR은 CI 성공 증거를 작성하지 않는다.

기존 홈·연락처·캘린더 시각 baseline은 이전 화면이다. 다음 정상 CI 이전에 OS별 후보 캡처와 독립 비교를 수행해 갱신해야 한다. 이번에는 baseline 파일/허용 오차/마스크를 변경하지 않았다.
