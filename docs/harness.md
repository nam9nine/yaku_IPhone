# 검증 하네스

## 목적과 실행 환경

하네스는 검사 명령, 실제 화면 검토, 독립 코드 리뷰, PR의 정확한 SHA를 연결한다. 파일이나 명령이 존재하는 것만으로 작업 성공을 뜻하지 않는다. GitHub Issue가 요구사항과 진행 상태의 원본이며, `harness/plans/`는 실행 전 계획을 보관한다.

Node.js 24.22.0과 npm을 사용한다. `sh scripts/bootstrap-node.sh`로 로컬 도구를 ignored `.tooling/`에 준비한다. `.tooling/node-v24.22.0-<platform>-<arch>/bin`을 PATH 앞에 추가한 셸에서 명령을 실행한다. 예를 들어 Apple Silicon macOS 경로는 `.tooling/node-v24.22.0-darwin-arm64/bin`이다. `package-lock.json`을 추적하고 재현 설치는 `npm ci`로 수행한다.

## 명령

| 명령                       | 확인하는 내용                                      |
| -------------------------- | -------------------------------------------------- |
| `npm run typecheck`        | TypeScript strict 타입 검사                        |
| `npm run lint`             | 코드 규칙과 정적 오류                              |
| `npm run format:check`     | 추적 대상 코드·문서의 포맷                         |
| `npm run test`             | 동작과 하네스 검증 로직의 단위 테스트              |
| `npm run build`            | GitHub Pages base를 반영한 정적 빌드               |
| `npm run harness:check`    | 필수 문서·스킬·검사 파일과 reference manifest 구조 |
| `npm run check`            | 위의 품질 검사를 순서대로 실행                     |
| `npm run test:e2e`         | Chromium·WebKit에서 주요 브라우저 동작             |
| `npm run test:visual`      | 플랫폼별 승인 기준 이미지와 화면 비교              |
| `npm run evidence:check`   | PR 본문 증거, Issue 연결, 현재 head SHA 검증       |
| `npm run merge-gate:check` | 선행 CI job이 모두 명시적으로 성공했는지 검증      |
| `npm run refs:fetch`       | manifest에 고정된 참고 자료 다운로드와 무결성 확인 |

일상 검사는 `check`와 변경에 맞는 브라우저·시각 검사다. `evidence:check`는 GitHub PR 이벤트 또는 명시적인 로컬 인자가 필요하다. `merge-gate:check`는 CI job 결과가 필요하므로 일반 로컬 품질 검사에 넣지 않는다. 명령을 실행하지 않았으면 미실행으로, 실패했으면 실패 원인과 함께 기록한다.

Playwright는 개발 서버 대신 production build와 preview로 앱을 `/yaku_IPhone/` 경로에서 실행한다. 기반 화면은 너비 360·390·430에서 Chromium·WebKit 각각 확인한다. 정확한 viewport·locale·timezone은 Playwright 설정과 테스트가 원본이다. 기준 화면은 [시각 QA](visual-qa.md)의 절차로 검토한다.

## CI와 병합 조건

| job          | 책임                                                    |
| ------------ | ------------------------------------------------------- |
| `quality`    | 설치, 타입·lint·format·unit·build·harness 검사          |
| `browser`    | 브라우저 동작과 Linux 시각 기준 검사, 실패 증거 보관    |
| `evidence`   | GitHub에서 현재 PR 본문·head·변경 파일을 읽고 증거 검증 |
| `merge-gate` | 선행 세 job의 결과가 모두 `success`인지 확인            |

`merge-gate`는 선행 실패·취소 뒤에도 실행해야 한다. `skipped`, `neutral`, `cancelled`, 결과 누락은 성공으로 바꾸지 않는다. 저장소 ruleset의 필수 check가 통과하기 전에는 자동 병합하지 않는다. 검사 실패를 없애려고 gate를 건너뛰거나 요구 조건을 완화하지 않는다.

문서·계획·스킬·참고 자료 등 workflow의 명시적인 허용 목록만 바뀐 PR은 browser job 안에서 브라우저 실행 단계를 생략하고 그 이유를 요약할 수 있다. 이 경우에도 job 자체는 분류 결과를 검증해 성공해야 한다. UI·설정 파일이 섞였으면 실제 브라우저 검사를 실행한다.

PR 검사는 기본 `contents: read`를 사용하고 GitHub PR/Issue 조회에 필요한 읽기 권한만 추가한다. 증거 검사는 PR head를 checkout하며 merge commit이나 오래된 head를 대신 검사하지 않는다. PR 코드를 쓰기 권한이 있는 `pull_request_target` 실행으로 옮기지 않는다. main의 Pages 배포 권한은 [배포 문서](deployment.md)를 따른다.

## PR 증거 계약

PR 본문에는 `<!-- harness-evidence -->`와 `<!-- /harness-evidence -->` 사이에 JSON 객체를 정확히 하나 둔다. 선택적으로 `json` 코드 블록으로 감쌀 수 있다. marker 밖에는 `Closes #번호`와 같은 GitHub Issue 종료 연결을 적는다. JSON의 Issue 번호와 실제 종료 대상이 일치해야 한다.

| 필드                     | 규칙                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `schemaVersion`          | 숫자 `1`                                                                              |
| `headSha`                | 검토한 현재 PR head의 전체 40자리 SHA                                                 |
| `issue`                  | 이 저장소에 존재하는 Issue 번호; PR 번호는 불가                                       |
| `environment`            | 실제 실행 환경의 `platform`, `node`, `playwright` 버전·값; 각각 비어 있지 않은 문자열 |
| `checks`                 | 실제 검사별 `command`, `result: "pass" / "fail" / "not-run"`, 구체적인 `details` 배열 |
| `review`                 | 실제 독립 검토자의 `reviewer`, `verdict: "pass"`, 구체적인 `summary`                  |
| `visual.status`          | UI 변경은 `pass`; UI와 무관한 변경만 `not-applicable`                                 |
| `visual.reason`          | 미적용이면 그 이유를 반드시 명시; 적용이면 범위를 설명                                |
| `visual.scenes`          | `pass`일 때 실제 확인한 화면·상태·viewport를 식별하는 비어 있지 않은 문자열 배열      |
| `visual.references`      | 실제 비교에 사용한 `references/manifest.json`의 source ID 배열                        |
| `visual.artifacts`       | 실제로 확인한 PNG·JPEG·WebP의 저장소 상대 경로 배열                                   |
| `visual.comparison`      | 실제 비교한 대상·조건·차이·해결 결과·남은 제한                                        |
| `visual.baselineChanged` | 변경 파일에 baseline/snapshot 경로가 있으면 `true`, 없으면 `false`                    |
| `visual.baselineReview`  | baseline 변경 시 별도 독립 검토의 `reviewer`, `verdict: "pass"`, `summary`            |

캡처는 현재 head에 추적되는 실제 이미지 파일이어야 한다. 외부 URL, ignored 테스트 결과 경로, 문서 파일, 없는 파일로 대체하지 않는다. 공유할 캡처는 `harness/evidence/issue-<번호>/`처럼 명확한 위치에 보관한다. CI의 실패 screenshot·trace·HTML report는 디버깅 자료이며 이 추적 이미지 요건을 자동으로 대신하지 않는다.

`src/`, `public/`, 스타일·HTML·컴포넌트, 앱 의존성, 브라우저 검사·기준 이미지 등 화면에 영향을 줄 수 있는 변경은 시각 검토가 필요하다. 정확한 분류는 `scripts/lib/evidence.mjs`가 결정한다. 기반 화면을 추가한 PR도 캡처와 실제 비교를 남긴다. 이때 기반 화면의 검증을 iPhone 시각 목표 달성으로 확대하지 않는다.

`checks`에는 `npm run check`의 실제 통과 결과가 필수다. UI 변경은 `npm run test:e2e`와 `npm run test:visual`의 통과 결과도 필요하다. 추가 인자로 실행했다면 `command`에는 이 기준 명령을, `details`에는 실제 인자·환경·확인 결과를 적는다. 실패하거나 실행하지 않은 검사를 숨기지 않는다. 다시 실행해 해결한 경우 결과와 해결 내용을 함께 기록한다.

PR 템플릿은 의도적으로 `pending`, `not-run`과 빈 값을 사용한다. 실제 검토가 끝나기 전에는 유효한 통과 증거가 아니다. 검증기는 필드·파일·SHA의 일관성을 확인할 뿐, 사람이 이미지를 봤는지 또는 리뷰의 품질을 증명하지 못한다. 그 책임은 실행자와 독립 검토자에게 있다.

## SHA를 갱신하는 순서

1. 구현과 검사를 마치고 캡처를 실제로 연다. 필요한 수정을 반복한다.
2. 보관할 캡처를 포함한 변경을 commit하고 PR head를 확정한다.
3. 구현을 맡지 않은 검토자가 최종 diff·완료 조건·화면 증거를 확인한다.
4. 관찰한 결과와 현재 SHA를 PR 본문에 기록한다. 본문 수정 자체는 새 commit을 만들지 않는다.
5. 현재 head에 대한 `evidence`와 나머지 필수 job의 성공을 확인한다.

이후 코드나 캡처에 새 commit이 생기면 기존 SHA 증거는 무효다. 변경분에 필요한 검사·검토를 수행하고 본문을 갱신한다. SHA 문자열만 바꾸고 이전 검토를 재사용하지 않는다. 같은 GitHub 계정에서 별도 에이전트가 검토할 수 있으나, 검토자 식별자와 실제 검토 범위를 남기며 다른 계정의 정식 승인으로 표현하지 않는다.

로컬 사전 검증에는 JSON 증거 파일, GitHub PR 전체 변경 경로의 JSON 배열, 현재 본문 Markdown을 준비한다. 아래의 파일명과 SHA는 실제 값으로 바꿔 사용한다.

```sh
npm run evidence:check -- --evidence /tmp/evidence.json --head-sha FULL_PR_HEAD_SHA --changed-files /tmp/changed-files.json --pr-body /tmp/pr-body.md --author PR_AUTHOR_LOGIN
```

로컬 입력은 사전 점검용이다. CI는 GitHub에서 조회한 현재 PR 정보로 다시 검증한다. 병합 후에는 main의 배포 결과와 공개 URL을 확인하고 Issue에 실제 결과를 남긴다.

## 설계 근거

짧은 진입 지침과 별도 절차는 [OpenAI 저장소 맞춤화 지침](https://learn.chatgpt.com/docs/customization/overview)을, 계획과 실행 증거의 분리는 [개발 워크플로 사례](https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex)를 참고했다. 플랫폼별 화면 기준은 [Playwright 시각 비교 지침](https://playwright.dev/docs/test-snapshots)을 따른다. [GitHub 필수 검사 동작](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)을 바탕으로 최종 gate가 실패와 생략을 명시적으로 판정하며, [Pages 공식 workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)를 기반으로 배포 권한을 분리한다.
