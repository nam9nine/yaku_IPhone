import { expect, it } from 'vitest';
import { homePages } from './apps';
import { homeLayout } from './homeLayout';
it('짧은 높이와 큰 글자에서도 앱 순서와 모든 앱을 가로 페이지에 보존한다', () => {
  for (const height of [150, 300, 600])
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
