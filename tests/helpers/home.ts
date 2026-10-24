import { expect, type Page } from '@playwright/test';
export async function launchHomeApp(
  page: Page,
  app:
    | 'music'
    | 'taxi'
    | 'cooking'
    | 'karaoke'
    | 'settings'
    | 'safari'
    | 'contacts'
    | 'messages'
    | 'notes'
    | 'photos'
    | 'reminders'
    | 'calendar'
    | 'phone',
) {
  if (app === 'contacts') {
    await page.keyboard.press('Alt+s');
    await page.getByRole('textbox', { name: '앱 검색' }).fill('연락처');
    await page.getByRole('button', { name: '연락처', exact: true }).tap();
    return;
  }
  const icon = page.locator(`[data-launch-app=${app}]`);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  for (let step = 0; step < 20; step++) {
    const hidden = await icon.evaluate((el) => Boolean(el.closest('[inert]')));
    if (!hidden) {
      await expect(icon).toBeInViewport();
      await icon.tap();
      return;
    }
    const current = Number(await page.getByTestId('home-pages').getAttribute('data-page'));
    const targetPage = await icon.evaluate(
      (el) => [...el.closest('.home-page-track')!.children].indexOf(el.closest('.home-page')!) + 1,
    );
    const direction = targetPage > current ? 1 : -1;
    const next = page.getByRole('button', {
      name: direction === 1 ? '다음 홈 페이지' : '이전 홈 페이지',
      exact: true,
    });
    if (await next.count()) await next.tap();
    else
      await page
        .getByRole('button', { name: `${current + direction}페이지로 이동`, exact: true })
        .tap();
  }
  throw new Error(`홈 가로 페이지에서 ${app}를 찾지 못했습니다.`);
}
