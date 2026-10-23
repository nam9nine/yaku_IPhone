# 나팔꽃의 하루 — 실제 이미지와 출처

최신 요청에 따라 임시 생활 일러스트를 실제 이미지로 교체했다. 기본 배경은 나팔꽃 식사 장면, 연락처는 기존에 조사한 공식 인물 이미지다. 도시락·텃밭·바다는 실제 촬영 사진이며 **게임의 나팔꽃을 촬영한 사진이라고 표시하지 않는다**. 사진 제목·날짜·키류의 설명은 팬 창작이다. 가족 그림은 콘셉트에 맞춰 이 프로젝트에서 그린 창작 그림으로 남긴다.

| 사용 위치                    | 로컬 자산                                                    | 원본·제작자·조건                                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 기본 잠금·홈, 식사 사진      | `public/asagao/mealtime.jpg`                                 | [용과 같이 극3의 나팔꽃 일상](https://ryu-ga-gotoku.com/kiwami3/kr/kiwami3-adventure/kiwami3-adventure-life/)의 공식 식사 장면. ©SEGA                                                                                                                                             |
| 연락처 5명                   | `public/story/{haruka,majima,daigo,mine}.jpg`, `saejima.png` | 기존 [스토리 자료 색인](../references/story-sources.json)의 SEGA 공식 인물 자료. ©SEGA                                                                                                                                                                                            |
| 도시락 2장                   | `public/asagao/lunchbox.jpg`                                 | [Coronation Bento](https://commons.wikimedia.org/wiki/File:Coronation_Bento_-_Taro_2026-02-11.jpg), Andy Li, [CC0](https://creativecommons.org/publicdomain/zero/1.0/). 실제 식당 도시락 참고 사진이며 게임 이미지가 아니다. 두 번째 화면은 같은 원본에 CSS 흐림 효과를 적용한다. |
| 텃밭                         | `public/asagao/sprout-garden.jpg`                            | [Vegetable garden 1](https://commons.wikimedia.org/wiki/File:Vegetable_garden_1.JPG), P199, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). 실제 채소밭 참고 사진.                                                                                               |
| 저녁 바다·선택 배경          | `public/asagao/evening-sea.jpg`                              | [Tudumari-no-hama](https://commons.wikimedia.org/wiki/File:Tudumari-no-hama_Iriomote_Island_Japan01bs4440.jpg), 663highland, [CC BY 2.5](https://creativecommons.org/licenses/by/2.5/). 오키나와 이리오모테섬 츠키가하마 해변.                                                    |
| 아이들의 가족 그림·선택 배경 | `public/asagao/family-drawing.svg`                           | 프로젝트의 창작 그림. 게임 원본이나 실제 아이가 그린 기록이 아니다.                                                                                                                                                                                                               |

Commons 제작자·원본 URL·다운로드한 버전·파일 해시는 [사진 색인](../references/asagao-photo-sources.json)에 기록한다. 사진 상세의 ‘원본 출처’와 ‘이용 조건’에서 원문을 열 수 있다. 외부 핫링크로 이미지를 표시하지 않으며 모든 표시 자산은 로컬 파일이다. 코드의 라이선스를 SEGA 또는 CC 이미지에 일괄 적용하지 않는다. CC BY-SA 텃밭 이미지의 해당 라이선스를 유지한다.

## SEGA 자료의 확인 범위

2026-10-24에 [SEGA 가이드라인](https://www.sega.co.jp/en/streaming_guideline/index.html)의 2026-10-19 개정본을 확인했다. 게임플레이 콘텐츠·썸네일 등에 사용하는 공식 사이트 이미지와 개인 비영리 게시 조건을 설명한다. 이 인터랙티브 웹앱의 자산 재배포에 대한 개별 허가까지 확인되었다고 주장하지 않는다. ‘팬메이드’나 공식 사이트에서 공개된 자료라는 이유로 자유 이용 허가가 있다고 표시하지 않는다. 인물·게임 이미지 권리는 SEGA에 있으며 사용 허가 판단은 별도 확인 사항으로 남는다. 원문은 `references/local/asagao/sega-guideline.html`에 보관한다.

실제 게임 장면과 프로젝트의 대사·일정·사진 설명은 구분한다. 원본 이미지 바이트를 창작 게임 화면으로 수정하지 않고 표시 영역에서 크롭한다. 가족 식사처럼 가로로 넓은 원본은 위쪽에 흐린 연장 배경을 두고 사진 영역을 내려 시계·위젯이 얼굴을 덮지 않게 한다. 설정에서 사진별 위치를 조절할 수 있다. 홈은 같은 자산을 흐리고 어둡게 표시한다.

사용하지 않는 이전 게임 이미지는 `references/local/story-legacy/`에만 남겨 공개 앱 번들에서 제외한다. 게임 음원·성우 음성은 추가하지 않았다. 이미지 전체의 정확한 교체 지점은 `src/day/media.ts`이며 프로필은 `src/story/data.ts`다.
