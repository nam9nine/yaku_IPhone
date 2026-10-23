export type AppId =
  | 'contacts'
  | 'facetime'
  | 'calendar'
  | 'photos'
  | 'camera'
  | 'mail'
  | 'notes'
  | 'reminders'
  | 'clock'
  | 'books'
  | 'tv'
  | 'games'
  | 'appstore'
  | 'maps'
  | 'health'
  | 'wallet'
  | 'settings'
  | 'weather'
  | 'files'
  | 'podcasts'
  | 'calculator'
  | 'compass'
  | 'voice'
  | 'shortcuts'
  | 'findmy'
  | 'phone'
  | 'safari'
  | 'messages'
  | 'music';

export interface HomeApp {
  id: AppId;
  name: string;
}

export const homePages: readonly (readonly HomeApp[])[] = [
  [
    { id: 'facetime', name: 'FaceTime' },
    { id: 'calendar', name: '캘린더' },
    { id: 'photos', name: '사진' },
    { id: 'camera', name: '카메라' },
    { id: 'mail', name: 'Mail' },
    { id: 'notes', name: '메모' },
    { id: 'reminders', name: '미리 알림' },
    { id: 'clock', name: '시계' },
    { id: 'books', name: '도서' },
    { id: 'tv', name: 'TV' },
    { id: 'games', name: '게임' },
    { id: 'appstore', name: 'App Store' },
    { id: 'maps', name: '지도' },
    { id: 'health', name: '건강' },
    { id: 'wallet', name: '지갑' },
    { id: 'settings', name: '설정' },
  ],
  [
    { id: 'weather', name: '날씨' },
    { id: 'files', name: '파일' },
    { id: 'podcasts', name: '팟캐스트' },
    { id: 'calculator', name: '계산기' },
    { id: 'compass', name: '나침반' },
    { id: 'voice', name: '음성 메모' },
    { id: 'shortcuts', name: '단축어' },
    { id: 'findmy', name: '나의 찾기' },
    { id: 'contacts', name: '연락처' },
  ],
];

export const dockApps: readonly HomeApp[] = [
  { id: 'phone', name: '전화' },
  { id: 'safari', name: 'Safari' },
  { id: 'messages', name: '메시지' },
  { id: 'music', name: '음악' },
];
