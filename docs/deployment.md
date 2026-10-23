# GitHub Pages 배포

## 원본과 배포 대상

- 소스 원본: [nam9nine/yaku_IPhone](https://github.com/nam9nine/yaku_IPhone)
- 기본 브랜치: `main`
- 공개 주소: [nam9nine.github.io/yaku_IPhone/](https://nam9nine.github.io/yaku_IPhone/)
- Vite base: `/yaku_IPhone/`
- 배포 방식: GitHub Actions의 GitHub Pages artifact

공개 주소는 배포 대상이다. 주소를 문서에 적었다는 이유만으로 발행·접속 확인이 완료된 것은 아니다. 실제 성공 결과와 SHA는 Actions/배포 기록에서 확인한다.

GitHub Pages를 사용하기로 결정했으므로 Sites remote·Sites 프로젝트를 새로 만들지 않는다. `origin` URL을 바꾸지 않으며, 개발·리뷰·병합의 기준은 원본 GitHub 저장소다.

## 배포 조건

main에 병합된 commit만 공개 배포한다. PR은 검사만 수행한다. 사용자에게 자동 병합과 main 병합 후 공개 배포가 승인되어 있으므로 정상 배포마다 추가 확인을 요구하지 않는다.

배포 workflow는 main의 정확한 SHA를 checkout하고 lockfile 기반 설치·검사·build를 거친 산출물을 사용한다. Pages용 `pages: write`, `id-token: write`는 배포 job에만 부여하고 PR 검사에는 쓰기 권한을 주지 않는다. 환경은 `github-pages`이며 배포 브랜치를 main으로 제한한다.

배포 concurrency로 동시 배포를 제한한다. 이 설정만으로 오래된 실행의 재실행까지 차단되는 것은 아니므로 발행한 원본 SHA, Actions run, 공개 URL을 확인한다. 복구 목적 없이 과거 main 실행을 다시 배포하지 않는다.

## 배포 후 확인

1. Actions와 Pages 배포가 성공했는지 확인한다.
2. 공개 주소를 실제로 열어 본다.
3. `/yaku_IPhone/` 아래에서 JS·CSS·이미지가 정상 로드되는지 확인한다.
4. 현재 범위의 주요 조작을 수행한다. 기반 화면 단계에서는 기반 화면의 로딩만 확인하고 잠금/홈 완성으로 표현하지 않는다.
5. 확인 환경과 남은 제한을 Issue 또는 PR에 남긴다.

실패한 배포는 성공으로 보고하지 않는다. 먼저 로그와 실패 지점을 확인하고 기존 공개 버전의 상태를 보존한다. 복구가 필요하면 원본 main에서 수정 또는 revert PR을 통해 다시 배포한다.
