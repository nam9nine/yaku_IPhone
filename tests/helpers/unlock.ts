import { expect, type Page } from '@playwright/test';

export async function enterPasscode(page: Page) {
  const dialog = page.getByRole('dialog', { name: '암호 입력', exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.type('1225');
  await expect(dialog).toHaveCount(0);
}

export async function unlockPhone(page: Page) {
  await page.getByRole('button', { name: '잠금 해제', exact: true }).click();
  await enterPasscode(page);
}
