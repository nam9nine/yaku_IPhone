import { unlockPhone } from '../helpers/unlock';
import { expect, test } from '@playwright/test';
import { launchHomeApp } from '../helpers/home';

const friends = [
  {
    id: 'akiyama',
    name: '아키야마 슌',
    search: '아키야마',
    width: 900,
    reply: '고맙다. 하루카에게 물어보고 알려 주겠다. 네 몫도 챙겨라.',
    response: '하하, 제 몫까지요? 알겠습니다. 연락 기다릴게요.',
  },
  {
    id: 'nishiki',
    name: '니시키야마 아키라',
    search: '니시키',
    width: 1440,
    reply: '알았다. 너도 와라. 같이 먹으면 된다.',
    response: '좋지. 설거지는 같이 해 줄 테니까 남겨 둬.',
  },
] as const;
for (const friend of friends) {
  for (const width of [360, 390, 430]) {
    test(`${friend.search} 연락처·전화·답장 저장 ${width}`, async ({ page }) => {
      await page.setViewportSize({
        width,
        height: width === 360 ? 800 : width === 390 ? 844 : 932,
      });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('./');
      await unlockPhone(page);
      await launchHomeApp(page, 'contacts');
      await page.getByRole('searchbox', { name: '연락처 검색' }).fill(friend.search);
      await page.locator(`[data-contact=${friend.id}]`).tap();
      const portrait = page.getByRole('img', { name: `${friend.name} 프로필` });
      await expect(portrait).toHaveAttribute('src', `/yaku_IPhone/story/${friend.id}.jpg`);
      await expect
        .poll(() => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBe(friend.width);
      await page.getByRole('button', { name: `${friend.name}에게 메시지 보내기` }).tap();
      const thread = page.getByRole('log', { name: `${friend.name}와의 대화` });
      await page.getByRole('button', { name: `${friend.reply} 보내기`, exact: true }).tap();
      await expect(thread.getByText(friend.reply, { exact: true })).toHaveCount(1);
      await expect(thread).toContainText(friend.response);
      await page.reload();
      await unlockPhone(page);
      await expect(page.getByLabel('읽지 않은 대화 7개')).toBeVisible();
      await launchHomeApp(page, 'phone');
      await page.getByRole('button', { name: '연락처', exact: true }).tap();
      await page.getByRole('searchbox', { name: '연락처 검색' }).fill(friend.search);
      await page.locator(`[data-contact=${friend.id}]`).tap();
      await page.getByRole('button', { name: `${friend.name}에게 메시지 보내기` }).tap();
      await expect(thread.getByText(friend.reply, { exact: true })).toHaveCount(1);
      await expect(
        page.getByRole('button', { name: `${friend.reply} 보내기`, exact: true }),
      ).toHaveCount(0);
    });
  }
}

test('기존 여섯 대화의 읽음과 답장을 보존하고 두 새 대화만 읽지 않음으로 표시한다', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await page.evaluate(() =>
    localStorage.setItem(
      'yaku-iphone.day.v1',
      JSON.stringify({
        ingredients: { potato: true, onion: false, meat: false, curry: false },
        reminders: { garden: true, mame: false },
        readThreads: ['haruka', 'majima', 'daigo', 'saejima', 'mine', 'date'],
        replies: ['date'],
        replySent: false,
        missedCall: false,
        missedCallRead: false,
        callStatus: null,
      }),
    ),
  );
  await page.reload();
  await unlockPhone(page);
  await expect(page.getByLabel('읽지 않은 대화 2개')).toBeVisible();
  await launchHomeApp(page, 'messages');
  await page.getByRole('button', { name: '읽지 않은 메시지만 보기' }).tap();
  await expect(page.locator('[data-conversation]')).toHaveCount(2);
  await page.locator('[data-conversation=akiyama]').tap();
  await page.keyboard.press('Alt+Home');
  await launchHomeApp(page, 'contacts');
  await page.locator('[data-contact=nishiki]').tap();
  await page.getByRole('button', { name: '니시키야마 아키라에게 메시지 보내기' }).tap();
  await page.keyboard.press('Alt+Home');
  await expect(page.locator('[data-launch-app=messages] .home-badge')).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('yaku-iphone.day.v1')!)),
  ).toMatchObject({
    ingredients: { potato: true },
    reminders: { garden: true },
    replies: ['date'],
    readThreads: ['haruka', 'majima', 'daigo', 'saejima', 'mine', 'date', 'akiyama', 'nishiki'],
  });
});
