import gamePhotos from './gamePhotos.json';
import personalPhotos from './personalPhotos.json';
/** Game images; descriptions are separate, fictional personal notes. */
export type DayPhoto = {
  id: string;
  src: string;
  title: string;
  date: string;
  caption: string;
  placeholder: boolean;
  landscape?: boolean;
  blur?: boolean;
  position: string;
};
export const dayPhotos: DayPhoto[] = personalPhotos.map((photo) => ({
  ...photo,
  src: `${import.meta.env.BASE_URL}asagao/${photo.src}`,
  placeholder: false,
}));
// Previously selected wallpapers and favorites survive a curated library change.
// These images are no longer shown in the photo library.
const previousPhotos: DayPhoto[] = gamePhotos.map((photo) => ({
  ...photo,
  src: `${import.meta.env.BASE_URL}asagao/${photo.src}`,
  placeholder: false,
}));
export const galleryKnownIds = [
  ...dayPhotos.map((photo) => photo.id),
  ...previousPhotos.map((photo) => photo.id),
];
const drawing: DayPhoto = {
  id: 'family-drawing',
  title: '아저씨와 우리',
  src: `${import.meta.env.BASE_URL}asagao/family-drawing.svg`,
  date: '',
  caption: '아저씨도 같이 그렸다. 내가 이렇게 무섭게 생겼나.',
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
  wallpaper('default', '나팔꽃의 식사 시간', previousPhotos[0]),
  wallpaper('drawing', '아저씨와 우리', drawing),
  wallpaper(
    'sea',
    '나팔꽃 앞 저녁 바다',
    previousPhotos.find((photo) => photo.id === 'evening-sea')!,
  ),
];
export const wallpaperIds = [
  'solid',
  ...wallpaperChoices.map((choice) => choice.id),
  ...galleryKnownIds,
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
  const photo = [...dayPhotos, ...previousPhotos].find((item) => item.id === (legacy[id] ?? id));
  return photo ? wallpaper(id, photo.title, photo) : wallpaperChoices[0];
}
