# 나팔꽃의 하루 — 실제 이미지와 출처

사진 보관함은 용과 같이 극3의 실제 공식 게임 이미지 26장으로 구성한다. 나팔꽃의 식사·재봉·요리·아이들·거리·바다 등 키류와 관련된 장면이며, 사진 제목·날짜·키류의 설명은 팬 창작이다. 생성한 게임 화면이나 임의의 생활 사진은 보관함에 포함하지 않는다.

| 사용 위치                | 로컬 자산                                                    | 출처                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 기본 배경·식사 사진      | `public/asagao/mealtime.jpg`                                 | [극3 나팔꽃 일상](https://ryu-ga-gotoku.com/kiwami3/kr/kiwami3-adventure/kiwami3-adventure-life/), ©SEGA                              |
| 게임 사진 25장           | `public/asagao/game/*.jpg`                                   | [극3 공식 사이트](https://ryu-ga-gotoku.com/kiwami3/kr/), ©SEGA. 정확한 URL·해시는 [게임 사진 색인](../references/kiryu-gallery.json) |
| 키류 설정 프로필·내 카드 | `public/story/kiryu.jpg`                                     | 공식 cast01_ss.jpg. 갤러리 `kiryu-portrait.jpg`와 같은 원본                                                                           |
| 연락처 5명               | `public/story/{haruka,majima,daigo,mine}.jpg`, `saejima.png` | [스토리 자료 색인](../references/story-sources.json)의 공식 인물 자료. ©SEGA                                                          |
| 선택 배경 그림           | `public/asagao/family-drawing.svg`                           | 프로젝트에서 그린 창작 그림. 게임 원본이나 실제 아이가 그린 기록이 아니다. 갤러리에는 포함하지 않는다                                 |

콘텐츠 교체 지점은 `src/day/gamePhotos.json`, 배경 선택·이전 ID 호환은 `src/day/media.ts`, 인물 정보는 `src/story/data.ts`다. 사진은 프로젝트의 정적 파일을 사용하며 외부 주소에 의존해 표시하지 않는다. 상세 화면은 게임 원본과 팬 창작 설명을 구분한다.

Issue 30에서 사용했던 실제 도시락(Andy Li, CC0)·텃밭(P199, CC BY-SA 3.0)·해변(663highland, CC BY 2.5) 참고 사진은 공개 앱에서 제거했다. 원본과 출처는 `references/local/issue33/replaced-stock/`과 [이전 사진 색인](../references/asagao-photo-sources.json)에 보관한다. 기존에 저장한 도시락·텃밭 배경 ID는 유효한 게임 사진으로 연결한다. 가족 그림은 기존 선택 배경으로 유지한다.

## SEGA 자료의 확인 범위

2026-10-24에 확인한 [SEGA 가이드라인](https://www.sega.co.jp/en/streaming_guideline/index.html)의 개정일은 2026-10-19다. 게임플레이 콘텐츠·썸네일 등에 사용하는 공식 사이트 이미지와 개인 비영리 게시 조건을 설명하지만, 이 인터랙티브 웹앱의 자산 재배포에 대한 개별 허가까지 확인되었다고 주장하지 않는다. 공개 공식 이미지 또는 팬메이드라는 이유로 오픈 라이선스로 취급하지 않는다. 원문은 `references/local/asagao/sega-guideline.html`에 보관한다.

게임 장면의 원본 바이트는 유지하며 표시 영역에서 크롭한다. 설정에서 배경별 위치를 조절할 수 있다. 홈은 같은 사진을 흐리고 어둡게 표시한다. 게임 음원·성우 음성·벨소리는 추가하지 않는다.
