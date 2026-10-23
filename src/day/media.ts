/** Local images and fictional captions are separate from their source attribution. */
export type DayPhoto = {
  id: string;
  src: string;
  title: string;
  date: string;
  caption: string;
  placeholder: boolean;
  sourceLabel?: string;
  sourceUrl?: string;
  licenseUrl?: string;
  landscape?: boolean;
  blur?: boolean;
  position: string;
};

const asset = (name: string, extension = 'svg') =>
  `${import.meta.env.BASE_URL}asagao/${name}.${extension}`;

export const dayPhotos: DayPhoto[] = [
  {
    id: 'mealtime',
    src: asset('mealtime', 'jpg'),
    title: '나팔꽃의 식사 시간',
    date: '토요일 12:10',
    caption: '모두 모였다.\n오늘도 밥솥이 비었다.',
    placeholder: false,
    sourceLabel: '용과 같이 극3 공식 생활 장면 · ©SEGA · 사진 설명은 팬 창작',
    sourceUrl: 'https://ryu-ga-gotoku.com/kiwami3/kr/kiwami3-adventure/kiwami3-adventure-life/',
    landscape: true,
    position: '50% 50%',
  },
  {
    id: 'family-drawing',
    src: asset('family-drawing'),
    title: '아이들이 그려준 가족 그림',
    date: '토요일 13:20',
    caption: '아저씨도 같이 그렸다.\n내가 이렇게 무섭게 생겼나.',
    placeholder: false,
    sourceLabel: '프로젝트에서 그린 창작 가족 그림 · 게임 원본이 아닙니다',
    position: '50% 50%',
  },
  {
    id: 'lunchbox',
    src: asset('lunchbox', 'jpg'),
    title: '완성한 도시락',
    date: '금요일 07:32',
    caption: '다 먹고 오면 좋겠다.',
    placeholder: false,
    sourceLabel: '실제 도시락 참고 사진 · Andy Li · CC0 · 설명은 팬 창작',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Coronation_Bento_-_Taro_2026-02-11.jpg',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    position: '50% 50%',
  },
  {
    id: 'lunchbox-blur',
    src: asset('lunchbox', 'jpg'),
    title: '도시락, 한 번 더',
    date: '금요일 07:33',
    caption: '조금 흔들렸다. 그래도 남겨 둔다.',
    placeholder: false,
    blur: true,
    sourceLabel: 'Andy Li · CC0 · 같은 원본에 화면 흐림 효과를 적용한 창작 장면',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Coronation_Bento_-_Taro_2026-02-11.jpg',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    position: '50% 50%',
  },
  {
    id: 'sprout-garden',
    src: asset('sprout-garden', 'jpg'),
    title: '텃밭',
    date: '금요일 16:05',
    caption: '어제보다 조금 자랐다.',
    placeholder: false,
    sourceLabel: '실제 텃밭 참고 사진 · P199 · CC BY-SA 3.0 · 설명은 팬 창작',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Vegetable_garden_1.JPG',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    position: '50% 55%',
  },
  {
    id: 'evening-sea',
    src: asset('evening-sea', 'jpg'),
    title: '저녁 바다',
    date: '목요일 18:12',
    caption: '다음에는 아이들과 같이.',
    placeholder: false,
    sourceLabel: '오키나와 이리오모테 해변 · 663highland · CC BY 2.5 · 게임 장면이 아닙니다',
    sourceUrl:
      'https://commons.wikimedia.org/wiki/File:Tudumari-no-hama_Iriomote_Island_Japan01bs4440.jpg',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.5/',
    position: '50% 45%',
  },
];

function wallpaper(id: string, title: string, photoId: string) {
  const photo = dayPhotos.find((item) => item.id === photoId)!;
  return {
    id,
    title,
    photoId,
    src: photo.src,
    position: photo.position,
    placeholder: photo.placeholder,
    landscape: photo.landscape,
    blur: photo.blur,
  };
}

export const wallpaperChoices = [
  wallpaper('default', '나팔꽃의 식사 시간', 'mealtime'),
  wallpaper('drawing', '아저씨와 우리', 'family-drawing'),
  wallpaper('sea', '저녁 바다', 'evening-sea'),
];

export function getWallpaper(id: string) {
  const choice = wallpaperChoices.find((item) => item.id === id);
  if (choice) return choice;
  const photo = dayPhotos.find((item) => item.id === id);
  return photo ? wallpaper(photo.id, photo.title, photo.id) : wallpaperChoices[0];
}
