# yaku_IPhone

**키류의 iPhone — 나팔꽃의 평범한 하루.** 하루카가 정리해 준 키류의 개인 휴대폰을 눌러 살펴보는 팬메이드 웹 체험입니다. 기존 iPhone 스타일과 제스처를 유지합니다. 모바일에서는 화면을 채우고, PC에서는 중앙 휴대폰 프레임으로 표시합니다.

잠금 화면의 하루카 알림 → 힌트 없는 암호 입력 → 대화의 장보기 링크 → 카레 재료 네 개 체크 → 미리 알림 완료와 할 일 3→2 → ‘다 샀다.’ 답장으로 이어집니다. 마지마의 수신 전화는 한 번 발생하며 응답하거나 거절할 수 있습니다. 거절·무응답은 부재중 알림과 최근 통화에 남습니다. 전화·연락처·메시지·사진·메모·미리 알림·캘린더·Safari·설정의 아홉 앱을 사용할 수 있습니다. 체크·읽음·선택형 답장·배경은 브라우저에 저장하며 저장 실패에도 현재 세션은 작동합니다. 설정에서 확인 후 처음 상태로 되돌릴 수 있습니다.

화면 전체와 홈은 고정되고 설정·생활 앱의 본문은 세로로 스크롤합니다. Safari의 긴 내용은 가로 페이지로 넘깁니다. 오른쪽 위에서 내리면 제어 센터, 왼쪽 위에서 내리면 알림 센터가 열립니다. 아래에서 빠르게 올리면 홈, 중간에서 멈추면 최근 앱, 끝까지 올리면 홈으로 이동합니다. 앱 안쪽 왼쪽 가장자리에서 오른쪽으로 밀면 한 단계 돌아갑니다. 키보드 대체 조작과 동작 줄이기를 지원합니다. [제스처 안내](docs/gestures.md)

토요일 16:40과 27°는 고정된 가상 데이터입니다. 상단에는 시간·통신 신호·Wi-Fi와 배터리 80% 데모를 표시합니다. 대사·메모·일정은 창작이며 원작의 정확한 연도나 공식 기록을 주장하지 않습니다. 실제 통화·SMS·인터넷 검색·기기 설정 변경을 하지 않고 권한·로그인·서버를 사용하지 않습니다. 사용자 지정 마지마 벨소리만 로컬 파일로 재생하며 성우 음성은 사용하지 않습니다. [콘셉트와 상태](docs/asagao-day.md) · [이미지 출처와 교체 안내](docs/asagao-assets.md) · [실사용 캡처 적용](docs/iphone-capture-refresh.md)

암호 잠금·선별 사진 6장·벨소리 동작은 [개인 휴대폰 구성](docs/personal-phone.md)에 정리했습니다.

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
