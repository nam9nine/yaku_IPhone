import { expect, type Locator } from '@playwright/test';

/** Reach a control using the same page buttons that a touch user has. */
export async function revealPagedControl(target: Locator) {
  const pager = target.locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " paged-content ")][1]',
  );
  if (!(await pager.count())) return;
  for (let step = 0; step < 60; step += 1) {
    const position = await target.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const viewport = element
        .closest('.paged-content')!
        .querySelector('.paged-viewport')!
        .getBoundingClientRect();
      if (
        bounds.left >= viewport.left - 1 &&
        bounds.right <= viewport.right + 1 &&
        bounds.top >= viewport.top - 1 &&
        bounds.bottom <= viewport.bottom + 1
      )
        return 'visible';
      return bounds.right < viewport.right ? 'previous' : 'next';
    });
    if (position === 'visible') return;
    const button = pager.getByRole('button', {
      name: position === 'previous' ? / 이전 페이지$/ : / 다음 페이지$/,
    });
    await expect(button).toBeEnabled();
    await button.tap();
  }
  throw new Error('가로 페이지를 탐색해도 조작 요소를 찾지 못했습니다.');
}

export async function tapPaged(target: Locator) {
  await revealPagedControl(target);
  await target.tap();
}

export async function checkPaged(target: Locator) {
  await revealPagedControl(target.locator('..'));
  await target.check();
}

export async function firstContentPage(pager: Locator) {
  const previous = pager.getByRole('button', { name: / 이전 페이지$/ });
  while (await previous.isEnabled()) await previous.tap();
  await expect(pager).toHaveAttribute('data-page', '1');
}
