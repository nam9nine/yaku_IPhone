# 로컬 레퍼런스

[manifest.json](manifest.json)이 출처·정확한 커밋·확인일·라이선스·용도·주요 파일·다운로드 주소·SHA-256의 색인입니다. 원문은 로컬 `upstream/`에만 보관하며 Git과 공개 앱 빌드에서 제외합니다. 보존한 코드 라이선스는 `licenses/`에 있습니다.

```sh
npm run refs:fetch
npm run refs:fetch -- --verify-only
npm run refs:fetch -- --extract
npm run harness:check
```

기본 명령은 누락 자료를 다운로드하고 기존 자료의 해시를 확인합니다. `--verify-only`는 네트워크 없이 원문을 확인합니다. `--extract`는 고정된 전체 아카이브를 `upstream/sources/`에 안전하게 풀어 읽을 수 있게 합니다. 외부 프로젝트 설치나 코드는 실행하지 않습니다. 원문이 바뀌거나 기존 파일이 수정되면 자동 덮어쓰기 대신 오류를 반환합니다.

`harness:check`는 색인 ID·URL·날짜·라이선스·artifact 경로·해시 형식을 검사합니다. 원문 바이트 검사는 `refs:fetch -- --verify-only`가 담당합니다. ignored 원문이 없는 새 worktree에서는 기본 fetch를 먼저 실행해야 합니다. 같은 파일을 복원할 수 없는 upstream 변경은 실패로 기록하고, 확인 없이 해시나 버전을 최신 내용으로 바꾸지 않습니다.

현재 보관 대상은 macos-portfolio, BymanOS, ios27-design-system, liquidframe, liquid-glass-react, 사용자가 제시한 chajuhann 사이트 및 Apple 공식 화면·문서입니다. 다섯 코드 저장소의 MIT LICENSE와 Apple·원본 사이트의 자료 이용 범위는 구분합니다. Apple 이미지는 로컬 시각 참고용이며 앱 자산으로 옮기지 않습니다.

이 기반 작업에서는 외부 구현 코드를 앱에 채택하지 않았습니다. 앞으로 채택할 때에는 필요한 파일만 앱 소스로 옮기고 출처·라이선스를 기록합니다. 자세한 활용 기준은 [레퍼런스 문서](../docs/references.md)를 따릅니다.

## Issue 20 공식 시스템 화면 자료

2026-10-24 재조사에서 기존 `apple-control-center`/`apple-control-center-image`, `apple-app-switcher`/`apple-app-switcher-image` ID와 원문을 재사용했습니다. `reviewedOn`은 다시 확인한 날이며 기존 `retrievedOn`을 임의로 바꾸지 않습니다. `version`은 문서 선택 버전 또는 공식 이미지 파일명의 확인 범위를 표시합니다.

새 원문은 `upstream/ios-system-20/`에 보관합니다. `apple-notifications-support`, `apple-notifications-ios26-lock-image`, `apple-notifications-ios26-options-image`, `apple-app-switcher-drag-gesture-image`, `apple-home-indicator-visibility`, `apple-quit-app`, `apple-copyright`가 추가 출처입니다. 동일한 내용의 기존 문서는 기존 색인 경로를 유지하며 중복 다운로드 사본을 별도 reference ID로 늘리지 않습니다.

알림 이미지는 현재 Apple Support 문서에 있어도 파일명이 **iOS 26 / iPhone 16 Pro**입니다. iOS 27 전체 알림 화면을 확정하는 자료로 쓰지 않습니다. 홈 인디케이터 API 문서는 표시 정책의 근거이며 iOS 27 모든 화면에 흰 막대가 항상 표시된다는 증거가 아닙니다. 구체적인 도형 관찰과 이번 사용자의 변경 요구는 [시스템 디자인 근거](../docs/ios-system-design.md)를 따릅니다.

공식 문서·이미지는 Apple 저작권 자료입니다. 앱에 스크린샷·벽지·추출 아이콘을 붙이지 않고 구조와 표현을 React/CSS로 재현합니다. 원본 보관·색인 검증과 제품의 시각 일치·실기기 검증은 별도 작업입니다.
