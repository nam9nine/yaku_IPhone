# Issue #20 시스템 화면과 홈 인디케이터 검증

현재 커밋의 독립 검토와 검사 결과는 [PR #21](https://github.com/nam9nine/yaku_IPhone/pull/21)의 `harness-evidence`에 연결한다. 이 파일 안에 자기 커밋 SHA를 넣지 않는다.

## 구현과 비교 기준

[Apple 자료 관찰 기록](../../docs/ios-system-design.md)과 로컬 원문을 실제로 열어 제어 센터, 최근 앱, 홈 인디케이터를 비교했다. 원문 URL·버전·해시·권리 범위는 `references/manifest.json`에 있다.

- `apple-control-center-image`: 연결/미디어 두 그룹, 원형 도구, Focus capsule, 세로 밝기·음량, 오른쪽 그룹 레일을 비교했다. 이전의 큰 제목·닫기 X·가로 range·설명 패널을 제거했다.
- `apple-app-switcher-image`: 긴 실제 앱 화면이 가로로 겹치는 카드, 카드 밖 앱 아이콘과 이름, 흐린 홈 배경을 비교했다. 카드별 X·현재 앱 배지·상시 하단 보조 바를 제거했다.
- `apple-home-indicator-visibility`, `apple-app-switcher-drag-gesture-image`: 막대 형태와 표시 정책·앱 전환 동작을 확인했다. 사용자 요청에 따라 막대를 표시하고 일정 거리 올리면 멈춤 없이 최근 앱을 연다.
- `apple-notifications-ios26-lock-image`: 날짜·시계·벽지를 참고했다. iOS 27 전체 이미지가 아니므로 **iOS 26 보조 자료**로 구분한다. 수신 알림은 지원하지 않으며 임의 알림을 만들지 않았다.

## 직접 확인한 장면

macOS 26.5.2 arm64, Node 24.22.0, Playwright 1.64.1의 Chromium·WebKit을 사용했다. 시간은 2026-10-23 09:41, `ko-KR`, `Asia/Seoul`, 배경·앱 순서·화면 상태를 고정했다. Linux Ubuntu 24.04는 GitHub Actions에서 같은 버전으로 별도 캡처했다.

각 OS의 62장을 contact sheet로 전체 확인하고 제어 센터·최근 앱·알림·작은 화면 큰 글자·밝고 어두운 앱의 대표 원본을 확대해 보았다. 기존 기준과 Apple 원본도 함께 비교했다. 대표 macOS 캡처 20장은 [images/issue-20](images/issue-20)에, 전체 기준은 `tests/visual/baselines/{darwin,linux}/{chromium,webkit}`에 보관한다.

| 장면                                                           | 조건                         |
| -------------------------------------------------------------- | ---------------------------- |
| 잠금, 홈 1·2페이지, 설정, Safari 시작·안내, 제어 센터, 최근 앱 | 360×800, 390×844, 430×932    |
| 다크·큰 글자 설정, Safari 두 탭, 알림 센터, 검색               | 390×844                      |
| 제어 센터 세 그룹                                              | 360×420, 루트 글자 크기 200% |

기존 잠금 6장은 OS마다 그대로 유지한다. 나머지 50장의 변경 이유는 시스템 UI와 홈 인디케이터이며 작은 화면 제어 센터 6장을 추가했다. 허용 오차를 변경하거나 화면을 가리지 않았다. Linux WebKit의 큰 글자 미디어 문구가 타일 상단으로 벗어난 것은 플랫폼 차이로 승인하지 않고 가용 폭과 세로 정렬을 보완했다.

## 검사와 수정 이력

- `npm run check`: 타입·lint·format·단위 181개·production build·harness를 검사한다. 최종 실행 로그는 `.tooling/issue20-final-quality.log`에 있다.
- `npm run test:e2e`: 두 엔진의 234개 동작을 검사한다. 홈 막대 상승, 카드 재개·탐색·닫기, 제어 조작, 취소·반복 입력·높이 변경, 세로 이동 금지, 큰 글자, 키보드와 포인터 전환을 포함한다. 로그는 `.tooling/issue20-final-e2e.log`에 있다.
- `npm run test:visual`: macOS 기준 62장을 일반 모드로 검사한다. Linux는 현재 SHA의 필수 `browser` 작업에서 정확 일치를 다시 확인한다.
- `npm run refs:fetch -- --verify-only`: 52개 자료의 해시와 크기를 확인했다. 레퍼런스 원문은 앱 번들에 포함하지 않는다.

첫 Linux 실행 [39985763580](https://github.com/nam9nine/yaku_IPhone/actions/runs/39985763580)은 동작 225/226, 시각 6/62였다. 시각 실패 56개는 의도된 변경 50개와 신규 장면 6개를 등록하기 전의 결과다. artifact `12516220762`의 SHA-256 `74b4fd0f60baa09bc81332997fc9307ee3496dfb89145ebf8fb4b706ee8cdc1d`를 확인하고 이미지를 검토했다.

동작 실패 1개는 매우 빠른 합성 터치 뒤 브라우저가 다음 tap을 관성 종료 입력으로 소비한 경우다. 실제 native touch의 `preventFling` 입력을 사용하고 trusted 이동 및 뒤따르는 카드 재진입 검증을 유지했다. 재시도·대기 시간 증가·assertion 삭제로 통과시키지 않았다. 이전 실패를 현재 성공으로 간주하지 않으며 최종 Linux 결과는 PR 필수 검사에서 확인한다.

두 번째 Linux 실행 [39988279513](https://github.com/nam9nine/yaku_IPhone/actions/runs/39988279513)은 최종 앱 코드 `e6e6d158da0cd3b8c07088d85a5a9293e6cca9c2`에서 **동작 234/234**, **시각 60/62**였다. 남은 두 장은 큰 글자 미디어 문구의 배치를 수정한 Chromium·WebKit 후보다. artifact `12517167014`의 SHA-256 `9f258d02f3420a672ea8720e82e2cba5f577fdefb8d81bc3e3ec5d913b6f8172`를 확인하고 직접 열었다. Chromium 두 줄·WebKit 세 줄 모두 타일 안에 들어오며 재생 버튼과 겹치지 않는다. 이 두 장의 독립 승인 후 최종 기준 62개를 다시 검사한다.

## 독립 검토

구현에 참여하지 않은 `agent:/root/touch_review`가 diff·완료 조건·동작을 검토했다. 좁은 하단 영역 밖에서 끝나는 짧은 입력, viewport 변경 경합, 상세 화면 Escape 포커스 복구, 최근 앱 키보드 선택과 포인터 선택 충돌, 보조 버튼의 키보드→마우스 전환, 작은 화면 설명 잘림을 지적하여 수정했다. 관련 회귀 검사를 추가했다.

`agent:/root/lock_home_review`가 두 OS의 이전·변경 화면과 Apple 원본을 독립 검토했다. Linux 큰 글자 미디어 문구 1장의 등록을 보류하고 수정을 요구했다. 수정 후 캡처와 최종 커밋에 대한 승인 여부는 PR 증거에 기록한다. 같은 GitHub 계정의 다른 사람 승인으로 표현하지 않는다.

## 남은 차이와 제한

- 연결·배터리 정보 줄, 기기 프레임·Dynamic Island·중복 상태바는 그리지 않는다. 연결·밝기·음량 등은 웹 체험 안의 가상 상태이며 하드웨어를 제어하지 않는다.
- CSS glass와 글꼴 합성은 실제 iOS 및 브라우저 사이에 차이가 있다. Chromium은 배경 blur가 더 강하게 보인다. Apple 원본을 그대로 붙인 UI가 아니다.
- 막대는 기본 흰색이고 밝은 앱에서는 대비를 위해 검정색이다. 항상 보이는 막대와 멈춤 없는 최근 앱 진입은 사용자 요청에 따른 차이다. 카드 배경·하단 상승·Escape로 닫으면 홈으로 간다.
- 앱 본문까지 모든 세로 스크롤을 금지한다. 긴 본문과 작은 높이의 제어 센터는 가로 페이지를 사용한다. 이 동작은 실제 iOS와 다르다.
- **실제 iPhone Safari와 소프트 키보드는 미검증이다.** 데스크톱 WebKit 결과를 실제 기기 결과로 기록하지 않는다. 배포 성공과 공개 URL 동작은 병합 후 Issue에 별도로 기록한다.
