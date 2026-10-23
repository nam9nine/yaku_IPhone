import { expect, it } from 'vitest';
import { dockApps, homePages } from './apps';
import { homeLayout } from './homeLayout';

it('실행 가능한 앱 9개를 홈과 Dock에 한 번씩 배치한다', () => {
  expect(homePages.flat().map((app) => app.id)).toEqual([
    'photos',
    'calendar',
    'reminders',
    'settings',
    'contacts',
  ]);
  expect(dockApps.map((app) => app.id)).toEqual(['phone', 'messages', 'safari', 'notes']);
  expect(new Set([...homePages.flat(), ...dockApps].map((app) => app.id)).size).toBe(9);
});
it('짧은 높이와 큰 글자에서도 앱 순서와 모든 앱을 가로 페이지에 보존한다', () => {
  for (const height of [150, 200, 300, 600])
    for (const row of [80, 120]) {
      const result = homeLayout(height, row, 180);
      expect(result.flatMap((page) => page.apps)).toEqual(homePages.flat());
      for (const page of result) {
        const rows = Math.ceil(page.apps.length / 4);
        const used =
          rows * row + Math.max(0, rows - 1) * 10 + (page.widgets ? 180 + (rows ? 14 : 0) : 0);
        expect(used).toBeLessThanOrEqual(height);
      }
    }
});
it('사진은 들어가지만 앱 행까지 넣을 수 없는 높이에서는 두 페이지로 나눈다', () => {
  expect(homeLayout(230, 80, 180)).toEqual([
    { widgets: true, apps: [] },
    { widgets: false, apps: homePages[0] },
  ]);
  expect(homeLayout(600, 80, 180)).toEqual([{ widgets: true, apps: homePages[0] }]);
});
it('사진 위젯도 들어가지 않는 극소 높이에서는 앱 접근을 유지한다', () => {
  expect(homeLayout(150, 80, 180)).toEqual([
    { widgets: false, apps: homePages[0].slice(0, 4) },
    { widgets: false, apps: homePages[0].slice(4) },
  ]);
});
