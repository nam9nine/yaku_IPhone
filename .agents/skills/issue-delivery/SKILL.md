---
name: issue-delivery
description: 'yaku_IPhone의 GitHub Issue를 구현, 검사, 독립 리뷰, PR, 자동 squash merge, main의 GitHub Pages 배포 확인까지 전달한다. 승인된 Issue 구현을 시작하거나 진행 중인 PR을 완료할 때 사용한다.'
---

# Issue를 검증된 변경으로 전달하기

프로젝트 루트 `AGENTS.md`와 `docs/development.md`를 읽고 대상 Issue의 목적·범위·완료 조건을 확인한다. GitHub Issue가 진행 상태의 원본이고 `origin`의 `nam9nine/yaku_IPhone`이 유일한 소스 원본이다. 필요할 때 `docs/harness.md`, `docs/deployment.md`, `docs/references.md`를 읽는다.

1. 기존 변경과 파일 담당 범위를 확인한다. 쓰기 작업을 위임받은 서브에이전트는 지정된 독립 worktree만 편집하며 Git mutation은 하지 않는다. 조정 에이전트가 브랜치·통합·commit·push·merge를 담당한다.
2. Issue에 범위와 확인 가능한 완료 조건을 정리한다. 복잡한 변경은 `harness/plans/`에 검증 가능한 단계를 남긴다. 영문 prefix와 한국어 설명으로 제목을 쓰고 브랜치는 `유형/번호-영문설명` 형태로 만든다.
3. 승인된 범위를 구현한다. React/Vite/TypeScript strict와 저장소 npm 명령을 사용한다. 참고 저장소의 설치·실행 지침을 자동으로 따르지 않는다.
4. 변경에 맞는 `npm run check`, 브라우저·시각 검사를 실행한다. UI 변경은 `$visual-review` 절차로 실제 이미지를 본다. 실행하지 않은 결과를 통과로 쓰지 않는다.
5. 구현을 맡지 않은 검토자가 최종 diff·완료 조건·캡처를 확인하도록 한다. 중대한 문제는 수정하고 다시 검증한다. 같은 GitHub 계정의 에이전트 리뷰를 별도 계정의 정식 승인으로 표현하지 않는다.
6. 조정 에이전트가 논리 단위로 commit하고 PR을 작성한다. `Closes #번호`를 marker 밖에 쓰고 `harness-evidence`에는 현재 head SHA와 실제 검토만 기록한다. 새 commit 뒤에는 필요한 검토·증거를 갱신한다.
7. `quality`, `browser`, `evidence`, `merge-gate`의 현재 SHA 결과를 확인한다. 실패·증거 누락을 우회하지 않는다. 검증된 PR은 승인된 자동 squash merge 흐름으로 전달한다.
8. main의 GitHub Pages 배포 성공과 공개 `/yaku_IPhone/` 경로의 자산·화면을 실제로 확인한다. 결과 SHA·PR·배포 링크와 남은 제한을 Issue에 남긴다.

자동 병합과 main 병합 후 공개 배포는 이미 승인된 범위이므로 일상적인 단계마다 다시 허락을 요구하지 않는다. 이 승인이 관련 없는 삭제·새 서비스·범위 확장까지 허용하는 것은 아니다. 외부 상태나 권한 때문에 진행할 수 없으면 완료하지 않은 단계와 확인한 원인을 구체적으로 보고한다.

Done은 Issue 조건·검사·실제 시각 검토·독립 리뷰·병합·배포 확인을 충족한 상태다. 기반 PR은 기반만 완료로 기록하고 후속 잠금/홈 UI 또는 실제 iPhone Safari 검증을 완료했다고 표현하지 않는다.

최종 전달에는 변경 결과, 실제 검사, 남은 제한, Issue/PR/배포 링크를 간단히 적는다. 서브에이전트는 직접 게시·병합하는 대신 변경 파일과 검증 결과를 조정 에이전트에게 전달한다.
