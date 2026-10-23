# 실제 사용 화면과 제스처 — Issue 26

참고 자료는 [원문 색인](../references/real-device-sources.json)에 저자·버전·날짜·URL·해시·관찰·한계를 기록했다. 원본 사진/영상/HTML과 두 Swift 프로젝트 원문은 `references/local/real-device/`에 저장한다. 외부 저장소를 실행하거나 앱 의존성으로 넣지 않는다. 주요 원문은 기존 `npm run refs:fetch` manifest로 복원하며, 영상과 영상에서 추출한 프레임의 출처/타임코드는 별도 색인에 보존한다.

## 실제 조작을 확인한 자료

- Gary Rosenzweig / MacMost, “7 Ways To Switch Apps On An iPhone” (2024-02-09): 00:52–00:56 홈 복귀, 01:16–01:20 최근 앱 진입을 연속 프레임으로 직접 확인했다. 동일 앱이 축소되고 이전 앱이 왼쪽에서 나타나며 놓을 때 카드가 정착한다. 정확한 iOS 버전이 명시되지 않은 구형 영상이므로 최신 UI 치수 근거로 사용하지 않는다.
- Aaron Zollo / Zollotech, iOS 27 beta 8 실제 기기 hands-on: 현재 버전의 화면을 보조 비교했다. 확보된 10초 간격 storyboard로 프레임 속도나 타이밍을 측정하지 않는다.
- Apple WWDC18 “Designing Fluid Interfaces”: 10:41 감속에 의한 pause 판정, 12:01 대칭적인 화면 전환, 51:38 손가락 추적과 속도 전달을 참고했다. 광고 화면과 구별되는 개발자 기술 설명이며 현재 iOS의 비공개 수치를 제공하지 않는다.
- `nathangitter/fluid-interfaces`의 Acceleration/Rubberbanding/Spring, `FluidGroup/FluidInterfaceKit`의 Drag/contextualExpanding 원문을 커밋 고정으로 보관했다. 웹 구현은 별도 TypeScript이며 자체 조정한 값이다.

## 앱 화면에서 확인한 차이

iDownloadBlog의 iOS 27 메시지·사진 실제 사용 캡처와 MacRumors iOS 27 beta 5 연락처 캡처를 비교했다. 연락처 행의 사진·구분선, 메시지 이름 capsule·말풍선 꼬리, 메모 하단 검색·날짜별 목록, 사진 좌측 하단 탭·1px 격자를 조정한다. 메모와 연락처 목록의 보조 자료는 iOS 26이므로 이를 iOS 27 정식 화면의 증거로 바꾸어 쓰지 않는다. 제어 센터 캡처는 beta 4이며 beta 5에 바뀐 셀룰러 줄 설명과 구분한다.

## 적용할 동작

하단 이동을 프레임당 한 번 반영한다. 빠른 release는 홈, 느린 중간 release와 멈춤은 최근 앱으로 보낸다. 손가락이 중간에 있을 때도 현재 앱과 이전 앱의 실제 내용을 카드 형태로 보여 준다. 계속 위쪽까지 끌면 앱이 더 작아지고, 속도와 관계없이 홈으로 돌아간다. 짧거나 취소된 입력은 복귀한다.

드래그→종료 애니메이션은 실제 표시 중인 사각형에서 시작한다. 최근 앱을 누르면 홈 아이콘이 아니라 누른 카드 위치에서 확대한다. transform 기준점을 고정하고 정착은 미리 계산한 감쇠 곡선을 브라우저 애니메이션으로 실행한다. 카드의 폼 값·읽던 스크롤을 보존하고 가까운 카드만 복제한다.

왼쪽 가장자리 뒤로 가기는 현재 화면이 손가락을 따라 이동하고 취소 시 복귀한다. 실제 이전 화면을 드래그 아래에 실시간으로 겹쳐 그리지는 않으므로 네이티브 interactive pop과 같은 구현은 아니다.

실제 iPhone Safari·ProMotion과 실기기 키보드는 아직 검증하지 않았다. 웹의 별도 safe area, 사용자가 지정한 가짜 상태바/기기 프레임 제외, 구현하지 않은 통화·첨부·사진 검색 등의 차이가 있으므로 전체 iPhone UI와 완전히 동일하다고 판정하지 않는다. 성능 결과는 실제 실행 기록에 따로 남긴다.
