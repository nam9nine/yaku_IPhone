# Issue #1 검증 기록

확인일: 2026-10-23. 최종 검증 SHA와 독립 검토 판정은 [PR #2](https://github.com/nam9nine/yaku_IPhone/pull/2)의 `harness-evidence`를 원본으로 사용한다. 이 문서는 이미 관찰한 결과를 기록하며 향후 CI·배포의 성공을 예고하지 않는다.

## 로컬 결과

환경: macOS 26.5.2 arm64, Node.js 24.22.0, npm 11.19.1, Playwright 1.64.1. Chromium과 데스크톱 WebKit을 실행했다.

- `npm run check`: 타입·lint·포맷·단위 테스트 88개·빌드·하네스 검사 통과.
- `npm run test:e2e`: 프로젝트 base에서 준비 화면·JS·CSS 로딩과 화면 높이 변경, 두 브라우저 합계 4개 통과.
- `npm run test:visual`: 360×800, 390×844, 430×932의 두 브라우저 합계 6개 통과. 기존 기준 자동 변경 없음.
- `npm run refs:fetch -- --extract`: 출처 17개, artifact 22개, 추출 소스 파일 1,150개 무결성 확인.
- 레퍼런스 LICENSE 하나를 임시로 옮긴 뒤 기본 복원 명령을 실행해 신규 다운로드 경로도 확인했다. 고정 SHA-256과 원래 바이트가 일치했다.
- `visual-review`, `issue-delivery`의 공식 `quick_validate.py` 통과. 검증기용 PyYAML은 ignored `.tooling/`의 가상환경에만 설치했다.

## 실패를 거부하는지 확인

macOS Chromium의 390×844 기준을 잠시 분리하고 일반 `test:visual`을 실행했다. 기준 없음으로 exit 1이 발생했고 새 기준을 자동으로 쓰지 않았다. 원래 기준을 복원한 뒤 정상 6개 검사를 통과했다.

Vitest는 오래된 SHA, Issue 불일치, 자기 리뷰, 누락·미추적·비이미지 캡처, 미검토 baseline 변경, 실행 환경·명령·장면 누락, API 실패·조회 중 SHA 변경, 선행 job의 실패·취소·생략을 거부하는 경우를 포함한다. 레퍼런스의 확인일·해시·고정 커밋·LICENSE 보존 오류도 검사한다.

[최초 CI 실행](https://github.com/nam9nine/yaku_IPhone/actions/runs/39922754016)은 Linux 기준과 최종 PR 증거가 없는 통합 중 상태였다. 브라우저 동작 4개는 통과했고 Linux 시각 검사 6개는 기준 없음으로 실패했다. 최종 `merge-gate`도 실패했다. 당시 문서가 미통합되어 `quality`도 실패했으며 이를 통과 기록으로 사용하지 않는다.

## 실제 화면 검토

macOS 기준은 로컬에서, Linux 기준은 위 CI의 실제 Chromium·WebKit 실행에서 생성했다. Linux artifact ID는 `12486509861`, ZIP SHA-256은 `69a6f52f3d2f0f364cd4e1901a68b886a1b4a9fc09111054a5d7eff2d70e185b`다. 다운로드 무결성을 확인하고 화면 6장을 직접 연 뒤 Linux 기준으로 등록했다. macOS 이미지를 Linux 기준으로 복사하지 않았다.

기준 이미지 위치:

- `tests/visual/baselines/darwin/{chromium,webkit}/foundation-{360x800,390x844,430x932}.png`
- `tests/visual/baselines/linux/{chromium,webkit}/foundation-{360x800,390x844,430x932}.png`

주 에이전트와 구현에 참여하지 않은 `harness_review` 에이전트가 각 환경의 6장, 합계 12장을 직접 열었다. y 마크·제목·두 줄 안내가 중앙에 놓이고 잘리지 않는 것을 확인했다. OS·엔진별 글꼴 차이는 서로 다른 기준에 보존했다.

`apple-lock-screen-image`, `apple-home-screen-image` 원본도 직접 열었다. 현재 화면에는 시계·앱 격자·Dock·잠금 해제가 없다. 따라서 이 기준의 판정 범위는 준비 화면과 캡처 하네스이며 **iOS 디자인 일치도는 미평가**다. 실제 iPhone Safari·iOS Simulator 검증은 수행하지 않았다.

## 독립 검토에서 수정한 내용

최초 독립 검토는 레퍼런스 필수 메타데이터와 실행 환경·명령·장면의 누락을 지적했다. 이를 필수 검증과 실패 테스트로 보완했다. Issue 템플릿의 참고 자료·범위 항목도 필수화했다. 최종 SHA의 판정과 CI·배포 결과는 PR/Issue에서 확인한다.
