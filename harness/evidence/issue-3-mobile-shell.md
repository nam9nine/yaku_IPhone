# Issue #3 검증 기록

확인일: 2026-10-23. 최종 검증 SHA와 독립 검토 판정은 [PR #7](https://github.com/nam9nine/yaku_IPhone/pull/7)의 `harness-evidence`를 원본으로 사용한다.

## 로컬 결과

환경: macOS 26.5.2 arm64, Node.js 24.22.0, npm 11.19.1, Playwright 1.64.1. Chromium과 데스크톱 WebKit을 사용했다.

- `npm run check`: 타입·lint·포맷·단위 검사 90개·빌드·하네스 통과.
- `npm run test:e2e`: 두 브라우저 합계 18개 통과. 세 크기의 화면 채움, 높이 변경, 네 방향 synthetic safe area, 200% 문자 확대와 짧은 화면의 스크롤, reduced motion, 한국 날짜 경계와 자산 로딩을 검사했다.
- `npm run test:visual`: 두 브라우저 × 세 크기, 6개 통과. 제안 기준은 명시적 `--update-snapshots=all` 실행으로 생성했고 이미지를 직접 검토한 후 일반 명령에서 기존 기준을 변경하지 않고 통과했다.
- 최초 e2e는 motion 토큰의 `0ms`를 빌드 도구가 `0s`로 정규화해 2개 실패했다. 테스트가 같은 의미의 두 단위를 인정하도록 수정한 뒤 18개 모두 통과했다. 실제 지속 애니메이션 없음도 검사한다.

## 직접 비교한 화면

고정 시간은 2026-10-23 09:41, locale은 ko-KR, timezone은 Asia/Seoul이다. 실제 제품 컴포넌트에 Playwright clock을 적용했다. 기준 경로는 `tests/visual/baselines/{darwin,linux}/{chromium,webkit}/foundation-{360x800,390x844,430x932}.png`다.

Apple 잠금·홈 원본과 macOS 6장을 직접 열었다. 준비 패널은 전 크기에서 잘리지 않고 문자를 읽을 수 있다. 브론즈·샴페인 상단, 은색 곡선, 보라·차콜 하단의 방향을 참고했으며 자체 SVG는 원본보다 면과 명암을 단순화했다. 원본 자산을 복사하거나 기기 프레임·시스템 상태바·Dynamic Island를 그리지 않았다.

기준 교체 이유는 기존 단색 준비 화면에 직접 제작한 배경·반투명 패널·한국어 날짜를 추가한 의도적 변경이다. 잠금 시계·앱 grid·Dock은 아직 없으므로 iOS 잠금/홈 완성도와 전체 일치도는 판정하지 않는다. 실제 iPhone Safari와 iOS Simulator는 미검증이다. Synthetic safe area와 viewport 높이 변경은 CSS 배치 검사이며 실기기 주소창 확인을 대신하지 않는다.

참조 ID: `apple-lock-screen-image`, `apple-home-screen-image`, `ios27-design-system`. 토큰 저장소의 kit·기기 치수와 미확인 이월 값은 실측값으로 채택하지 않았다.

## CI 실행에서 관찰한 제한

[첫 CI 실행](https://github.com/nam9nine/yaku_IPhone/actions/runs/39929213288)의 `quality`는 통과했다. 첫 browser job은 Ubuntu 미러에서 119MB 시스템 패키지를 받던 중 15분 제한으로 취소됐고, 앱 동작·시각 검사는 실행되지 않았다. 같은 SHA의 browser job을 재실행했다. 최종 증거 등록 전의 `evidence` 실패도 성공으로 기록하지 않는다. 설치 지연 개선은 [Issue #8](https://github.com/nam9nine/yaku_IPhone/issues/8)에 분리했다.

재실행(attempt 2)에서 Ubuntu 24.04 x64의 동작 검사 18개는 통과했고 시각 검사 6개는 기존 단색 기준과의 차이로 실패했다. 해당 실제 캡처를 별도 다운로드하고 6장을 직접 열어 새 Linux 기준으로 제안했다. artifact ID는 `12491089405`, ZIP SHA-256은 `dd5810033bedb2f581b01df3747c5fc81c60e14714f2d3bb78d959fc45b15aa9`이며 다운로드 바이트의 무결성을 확인했다. macOS 이미지를 복사하지 않았다.

Linux의 글꼴·안티앨리어싱은 macOS 및 엔진 사이에서 다르지만 패널 위치, 줄바꿈, 배경과 문자 가독성은 유지된다. 기존 단색 390×844 화면도 직접 열어 변경 전후를 비교했다. 최종 CI의 일반 시각 검사 결과는 PR에서 확인한다.
