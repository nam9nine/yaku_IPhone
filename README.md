# yaku_IPhone

모바일에서 iPhone 같은 경험을 제공하는 웹 프로젝트입니다.

첫 접속에서 한국어 날짜·큰 시계의 잠금 화면을 표시합니다. 위로 쓸어올리거나 해제 안내 버튼을 누르면 사진·달력 위젯, 앱 격자와 Dock이 있는 홈으로 이동합니다. 좌우 스와이프·페이지 버튼·화살표 키로 홈 페이지를 탐색하고 다시 잠글 수 있습니다. 설정 앱에서는 가상 연결·화면 모드·밝기·배경·텍스트·동작 줄이기를 바꿀 수 있습니다. 설정·Safari 아이콘은 전체 앱 화면을 열고, 하단 스와이프·홈 버튼·Alt+Home으로 복귀합니다. Safari에서는 두 내부 페이지·제목 검색·주소 입력·탭·뒤로/앞으로·새로고침을 사용할 수 있습니다. 외부 주소는 안내 후 기기 브라우저로 열며, 가상 네트워크가 끊기면 현재 페이지를 유지하고 다시 시도할 수 있습니다. 스토리 콘텐츠는 후속 범위입니다.

화면과 앱 본문은 세로로 스크롤하지 않습니다. 긴 내용은 가로 페이지로 넘깁니다. 오른쪽 위에서 내리면 제어 센터, 왼쪽 위에서 내리면 알림 센터가 열립니다. 아래에서 올린 뒤 멈추면 최근 앱, 바로 놓으면 홈으로 이동합니다. 앱 안쪽 왼쪽 가장자리에서 오른쪽으로 밀면 한 단계 돌아갑니다. 자세한 동작과 실제 iPhone과의 차이는 [제스처 안내](docs/gestures.md)를 확인하세요.

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
