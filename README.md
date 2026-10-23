# yaku_IPhone

모바일에서 iPhone 같은 경험을 제공하는 웹 프로젝트입니다.

개발 규칙·검증 하네스와 모바일 공통 컨테이너를 구성했습니다. 앱에는 직접 제작한 배경과 한국어 날짜를 표시하는 준비 화면이 있습니다. 잠금 화면·홈 화면은 후속 Issue에서 구현합니다.

## 시작하기

Node.js **24.22.0**을 사용합니다. Node가 없으면 다음 명령으로 프로젝트 내부 `.tooling/`에 설치합니다.

```sh
sh scripts/bootstrap-node.sh
# 설치 결과에 표시된 bin 경로를 PATH에 추가합니다.
# macOS Apple Silicon 예시:
export PATH="$PWD/.tooling/node-v24.22.0-darwin-arm64/bin:$PATH"
npm ci
npm run dev
```

개발 주소는 `http://localhost:5173/yaku_IPhone/`입니다. 모바일에서 확인할 때에는 같은 네트워크의 개발 PC 주소를 사용합니다.

## 검사와 참고 자료

```sh
npm run check
npx playwright install chromium webkit
npm run test:e2e
npm run test:visual
npm run harness:check
npm run refs:fetch
```

시각 검사는 macOS와 Linux의 기준 이미지를 분리합니다. 자동 기준 갱신은 하지 않으며 이미지 직접 검토는 별도로 수행합니다. 로컬에 보관하는 전체 레퍼런스는 `references/upstream/`에 복원하며 앱에 포함하지 않습니다.

- [작업 규칙](AGENTS.md)
- [개발 절차](docs/development.md) · [하네스](docs/harness.md) · [시각 QA](docs/visual-qa.md)
- [구조](docs/architecture.md) · [레퍼런스](docs/references.md) · [배포](docs/deployment.md)
- [GitHub Issues](https://github.com/nam9nine/yaku_IPhone/issues)
- 배포 대상: [GitHub Pages](https://nam9nine.github.io/yaku_IPhone/)

데스크톱 Playwright WebKit의 성공을 실제 iPhone Safari 확인으로 표현하지 않습니다.
