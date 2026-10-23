# 제품 범위와 구조

## 제품 목표

모바일 브라우저에서 iPhone을 탐색하는 듯한 경험을 만든다. 기준 디자인은 iPhone 18 Pro / iOS 27이다. 실제 iOS를 실행하거나 기기의 운영체제를 바꾸는 앱은 아니다.

1차 기능은 잠금 화면, 홈 화면, 잠금 해제 전환이다. 메시지·수신 전화·사진·메모를 통한 스토리 체험은 후속 Issue에서 진행한다. 개발 기반용 화면은 이 제품 범위의 완성으로 간주하지 않는다.

현재 실제 iPhone Safari에서 확인한 결과는 없다. 브라우저 에뮬레이션, 데스크톱 WebKit, 실제 iPhone Safari의 검증 결과를 구분한다.

## 구현 방향

Vite의 정적 React 앱과 TypeScript strict를 사용한다. GitHub Pages의 프로젝트 경로 `/yaku_IPhone/`에서 동작해야 하므로 자산 URL은 Vite base를 존중한다. 현재 서버·계정·외부 API·복잡한 라우터는 필요하지 않다.

공통 컨테이너는 `src/components/MobileShell.tsx`, 디자인 토큰은 `src/styles/tokens.css`, 날짜·시계 데이터는 `src/display/`에 구현했다. `src/App.tsx`가 잠금 여부를 소유하며 `src/lock/LockScreen.tsx`와 홈 도착 상태를 조합한다. 홈 앱 격자·Dock은 Issue #5에서 통합한다.

| 책임                 | 내용                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 화면 컨테이너        | viewport, safe area, 배경, 화면 상태                                                                                       |
| 잠금 화면            | 날짜·시계·하단 제어·해제 안내                                                                                              |
| 홈 화면              | 앱 grid, Dock, 페이지 표시                                                                                                 |
| 브라우저와 화면 경계 | safe area, viewport, 앱 내부 조작 영역; 실제 기기가 제공하는 상태바·Dynamic Island·기기 프레임을 웹에 중복으로 그리지 않음 |
| 토큰·데이터          | 색상, 치수, motion, 앱 이름·아이콘, 표시할 콘텐츠                                                                          |

초기 화면 상태는 `locked → unlocking → home` 정도로 시작한다. 실패하거나 취소한 gesture가 중간 상태에 남지 않도록 한다. 실제 Face ID·카메라·전화 동작이 없으면 동작하는 것처럼 보고하지 않는다.

실제 해제 reducer는 `locked → dragging → unlocked`이며 96px 이상 위로 이동한 뒤 놓으면 완료한다. 수평 우세·짧은 이동·pointercancel·capture 손실·포커스 손실은 취소한다. ref가 동기 전이를 보존해 반복 입력으로 콜백이 중복 실행되지 않는다. React 화면 교체는 애니메이션 종료 이벤트에 의존하지 않으며 reduced motion에서도 즉시 완료한다.

모바일 전용 경험을 우선한다. 큰 화면에서도 별도의 macOS UI를 만들지 않으며, 모바일 화면의 배치와 비율을 보존하는 미리보기로 다룬다.

## 레퍼런스 사용

macos-portfolio는 홈 grid·Dock·상태바의 구조와 후속 앱의 참고 자료다. 전체 Next.js 앱, desktop window store, Siri, 날씨 연동을 가져오지 않는다. 그 코드의 `LockScreenTimeWidget`는 홈 안의 시계이며 완성된 잠금 화면이 아니다.

BymanOS는 작은 앱 registry와 모바일 컴포넌트 구조를 참고한다. 포트폴리오 hero card·검색 버튼을 실제 iPhone 홈 기준으로 오인하지 않는다.

ios27-design-system은 재질·색상·치수 참고 자료다. React 패키지는 잠금/홈 완성 화면을 제공하지 않는다. 일부 recipe는 이전 OS·기기 자료를 이어받으므로 이름에 iOS 27이 있다는 이유만으로 최신 화면의 정확한 사양으로 채택하지 않는다.

프레임·glass 라이브러리는 필요한 표현만 검토한다. 사용자의 선택에 따라 웹 화면에 가짜 상태바·Dynamic Island·기기 프레임을 추가하지 않는다. 공식 참고 이미지에 이 요소가 포함되어 있어도 복제 대상에서 제외한다. 화면 아래의 실제 시스템 제스처 영역은 safe area로 보존하며, 잠금 해제 안내 등 제품 내부 요소와 구분한다.

## 자산과 접근성

`public/wallpapers/silver-fold.svg`는 프로젝트에서 직접 작성한 SVG다. Apple 자료의 은색·샴페인 곡면과 낮은 채도를 관찰했으며 원본 이미지·경로·외부 코드를 복사하지 않았다. 잠금 화면에서는 같은 경로의 `silver-fold-front.svg`를 시계 위에 겹친다. 두 SVG의 전경 경로·gradient는 함께 변경해야 한다. 짧은 화면에서는 전경 덮개를 숨겨 콘텐츠 가독성을 지킨다. 정확한 Apple 배경 복제품은 아니다. 색은 SVG 내부 gradient에, 화면 UI 값은 CSS 토큰에 둔다.

컨테이너는 `100vh → 100svh → 100dvh` 순서의 fallback과 `min-height`를 사용한다. 지원 브라우저에서는 주소창에 따라 바뀌는 높이를 채우고, 문자가 커지면 본문이 늘어나 스크롤할 수 있다. 네 방향 `env(safe-area-inset-*)`에 기본 여백을 더하며 고정 기기 inset을 가정하지 않는다. 장식 배경만 clip한다. 관련 기준: [MDN viewport 단위](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length), [WebKit safe area 안내](https://webkit.org/blog/7929/designing-websites-for-iphone-x/).

표시 날짜·시계는 브라우저 언어·시간대와 관계없이 `ko-KR` / `Asia/Seoul`로 포맷한다. 실제 분 경계에 맞춘 timeout과 탭 표시 상태 변경에서 갱신한다. 시계는 시스템 글꼴을 SVG에서 세로 확대한 웹 근사이며 Apple의 SF 폰트를 배포하지 않는다. 고정 장면은 Playwright의 `page.clock`으로 실제 앱의 시간을 주입한다. 별도 검증 화면이나 공개 URL 디버그 모드는 없다.

앱에 사용하는 이미지·아이콘·폰트의 출처를 기록한다. 외부 저장소의 MIT 코드 라이선스와 개별 자산의 출처를 구분한다. 기본 시스템 폰트 및 필요한 원본 자산만 사용하고, 레퍼런스 전체를 `public/`에 복사하지 않는다.

터치 외에 키보드로 수행할 수 있는 대체 동작, 아이콘의 접근성 이름, 충분한 터치 영역, reduced motion을 제공한다. 전체 배경에 무거운 glass 효과를 겹쳐 적용하지 않고 작은 제어 영역에서 가독성과 성능을 확인한다.
