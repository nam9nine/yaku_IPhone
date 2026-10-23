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
    { id: 'photos', name: '사진' },
    { id: 'calendar', name: '캘린더' },
    { id: 'reminders', name: '미리 알림' },
    { id: 'settings', name: '설정' },
  ],
];
export const dockApps: readonly HomeApp[] = [
  { id: 'phone', name: '전화' },
  { id: 'messages', name: '메시지' },
  { id: 'safari', name: 'Safari' },
  { id: 'notes', name: '메모' },
];
