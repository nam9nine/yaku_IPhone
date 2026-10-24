# Issue 37 검증

- 환경: macOS arm64, Node 24.22.0, Playwright 1.64.1, Chromium / WebKit.
- 원인: native touch의 implicit capture가 자식에서 shell로 이전될 때 자식의 lostpointercapture를 전체 제스처 취소로 처리했다. root 소유 capture 상실만 취소하도록 수정했다.
- 수정 전 native Chromium touch는 잠금·홈·설정 모두 열기 실패. 수정 후 360×800, 390×844, 430×932 각 화면에서 열기·빈 배경 닫기 확인.
- 상태바와 낮춘 시작 영역, 버튼/사진 위젯 위 시작, 짧은 드래그, 실제 root capture 상실 후 재입력, 날씨 modal 뒤 잠금/단축키 차단을 확인했다.
- `npm run check`: 통과, 단위 테스트 224개.
- `npm run test:e2e`: 통과, 378개. Chromium native touch / WebKit desktop pointer를 구분한다.
- `npm run test:visual`: 일반 실행 통과, 168개. macOS baseline 40장은 설정 설명·사진 출처·Safari 설명 제거 및 해당 앱 미리보기 변경이다.
- 직접 비교: 이전/이후 40장과 Apple `apple-control-center-image`를 열어 확인했다. 제어 센터 배치·버튼·슬라이더는 유지된다. 설정의 설명과 데모 행, 사진 출처·공식 화면 문구는 사라지고 기존 조작은 유지된다. Safari는 하루카의 휴대폰 사용법으로 정리했다.
- 출처·권리·가상 시각 기록은 저장소에 유지한다. 실제 iPhone Safari 및 OS 제어는 검증하지 않았다.
- Linux 기준과 최종 SHA 독립 검토는 PR 증거 및 CI 결과에 별도로 기록한다.
