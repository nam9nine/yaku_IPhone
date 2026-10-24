# Issue 49 검증 기록

대상은 [Issue 49](https://github.com/nam9nine/yaku_IPhone/issues/49)다. PR #48의 첫 main 배포에서 발견한 화면 크기 변경 후 지연된 뒤로 탐색을 수정한다. 최종 검토 SHA와 실행 결과는 PR의 `harness-evidence`에 기록한다.

## 실패와 원인 범위

[Pages 첫 실행](https://github.com/nam9nine/yaku_IPhone/actions/runs/40082528092)은 동작 검사 433/434 통과 후 WebKit `app-navigation.spec.ts:600`에서 실패했다. 시각 검사와 배포는 실행되지 않았다. artifact 12556470396의 SHA-256은 `cad3061ee16672bdfd6768b62c077cafc1c5151d9a1394d5a820bf6c506b4d27`이며 로컬에 원본을 보존했다.

trace의 mouseUp은 268170.181~268179.494ms, setViewportSize는 268185.228~268247.159ms였다. 268270.412ms snapshot의 `window.innerWidth/innerHeight`는 이미 360×800이다. 이후에도 `leaving`이 남고 268594ms에 `arriving`으로 바뀌면서 설정 목록으로 이동했다. resize 명령이 애니메이션 종료 후 도착했다는 설명은 이 기록과 맞지 않는다. 실제 resize 이벤트의 전달 시점은 trace에 없으므로 특정 WebKit 결함으로 단정하지 않는다.

독립적인 읽기 전용 진단에서 macOS WebKit의 자연 resize는 5/5 정상 취소됐다. resize callback을 500ms 늦추는 fault injection에서는 viewport 변경 뒤 페이지 이동이 먼저 완료되는 경로가 재현됐다. 알림에만 의존하지 않고 완료 직전 현재 크기를 확인할 필요가 있음을 보여 준다.

## 검증 범위

시각 배치·모션 시간·동작 임계값·검사 허용 오차는 변경하지 않는다. 화면 크기 변경 후 완료 취소, 취소 후 다음 정상 입력, 기존 뒤로·앞으로 동작을 확인한다. 정상 viewport 캡처와 기존 기준 이미지의 회귀 검사를 구분한다. 실제 iPhone Safari는 미검증이다.

구현과 검증은 `fix/49-edge-viewport` 전용 worktree에서 수행하며 기본 작업 폴더와 다른 작업자의 미커밋 파일을 수정하지 않는다.

## 실제 검사와 화면

새 fault-injection 회귀 검사는 제품 수정 전 Chromium·WebKit의 뒤로/앞으로 4조건 모두 실패했다. 수정 후 취소 자체는 모두 통과했으나 검사 준비 과정에서 두 문제가 드러났다. 차단한 resize 알림을 다음 제스처 전에 전달하지 않아 shell 폭이 갱신되지 않았고, 비동기 이벤트 개수를 너무 일찍 읽어 12회 중 2회가 실패했다. 알림 전달 및 실제 폭 복구를 확인하고 이벤트 도착을 기다리도록 검사만 보완했다. 최종 반복은 12/12, 기존 검사 포함 app-navigation 전체는 58/58 통과했다. 제품 임계값·시간·기대 탐색 결과를 완화하지 않았다.

`npm run check`는 타입·lint·포맷·단위 273개·빌드·하네스를 통과했다. 기존 `완료 모션 도중 resize` 검사는 `--repeat-each=5 --workers=2`로 양 엔진 10/10 통과했다. `npm run test:visual -- --workers=2`는 기존 macOS 기준 180/180 통과했다. 로컬 E2E의 이번 수정 범위는 app-navigation이며 전체 E2E 실행 여부와 Linux 결과는 PR CI에서 별도로 확인한다.

macOS 26.5.2 arm64, Node 24.22.0, Playwright 1.64.1에서 production build를 캡처했다. locale ko-KR·Asia/Seoul, 고정 날짜 2026-10-23이며 제품의 가상 시간은 16:40이다. Chromium·WebKit 각각 360×800, 390×844, 430×932에서 실제 크기 변경으로 뒤로 이동이 취소되고 이후 정상 뒤로 가기가 성공했다. `issue-49/observations.json`과 8개 PNG에 결과를 보관했다.

첫 즉시 캡처 중 WebKit 두 장에는 아직 반영 중인 이전 폭·이동 위치가 보였다. 원본을 ignored 진단 경로에 보존하고, 최종 캡처에서는 실제 앱 폭·임시 translate 복구와 두 animation frame을 확인했다. 최종 화면에는 가로 잘림·하단 표시 막대·잔여 이동이 없었다. Apple의 로컬 `apple-settings-wifi-image`와 기존 설정 화면을 직접 비교했으며 기존 목록의 그룹·가독성·여백을 유지했다. 이번 수정은 실제 iPhone과의 새로운 디자인 일치도를 주장하는 작업이 아니다. 기준 이미지는 변경하지 않는다.
