import gamePhotos from './gamePhotos.json';
/** Official game images; descriptions are separate, fictional personal notes. */
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
export const dayPhotos: DayPhoto[] = gamePhotos.map((photo) => ({
  ...photo,
  src: `${import.meta.env.BASE_URL}asagao/${photo.src}`,
  placeholder: false,
  sourceLabel: '용과 같이 극3 공식 게임 장면 · ©SEGA · 사진 설명은 팬 창작',
  sourceUrl: 'https://ryu-ga-gotoku.com/kiwami3/kr/',
}));
const drawing: DayPhoto = {
  id: 'family-drawing',
  title: '아저씨와 우리',
  src: `${import.meta.env.BASE_URL}asagao/family-drawing.svg`,
  date: '',
  caption: '프로젝트의 창작 그림',
  placeholder: false,
  position: '50% 50%',
};
function wallpaper(id: string, title: string, photo: DayPhoto) {
  return {
    id,
    title,
    photoId: photo.id,
    src: photo.src,
    position: photo.position,
    placeholder: photo.placeholder,
    landscape: photo.landscape,
    blur: photo.blur,
  };
}
export const wallpaperChoices = [
  wallpaper('default', '나팔꽃의 식사 시간', dayPhotos[0]),
  wallpaper('drawing', '아저씨와 우리', drawing),
  wallpaper(
    'sea',
    '나팔꽃 앞 저녁 바다',
    dayPhotos.find((photo) => photo.id === 'evening-sea')!,
  ),
];
export const wallpaperIds = [
  'solid',
  ...wallpaperChoices.map((choice) => choice.id),
  ...dayPhotos.map((photo) => photo.id),
  'family-drawing',
  'lunchbox',
  'lunchbox-blur',
  'sprout-garden',
];
export function getWallpaper(id: string) {
  const choice = wallpaperChoices.find((item) => item.id === id);
  if (choice) return choice;
  if (id === 'family-drawing') return wallpaper(id, drawing.title, drawing);
  const legacy: Record<string, string> = {
    lunchbox: 'cooking',
    'lunchbox-blur': 'cooking',
    'sprout-garden': 'asagao-family',
  };
  const photo = dayPhotos.find((item) => item.id === (legacy[id] ?? id));
  return photo ? wallpaper(id, photo.title, photo) : wallpaperChoices[0];
}
