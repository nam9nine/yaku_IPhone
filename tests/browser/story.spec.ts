import { finishAiReply } from '../helpers/ai-clock';
import { mockStoryAi } from '../helpers/mock-story-ai';
import { unlockPhone } from '../helpers/unlock';
import { expect, test, type Page } from '../helpers/browser-test';
import { launchHomeApp } from '../helpers/home';

test.beforeEach(async ({ page }) => {
  await mockStoryAi(page, { majimaCompletedExchanges: 3 });
});

async function start(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await unlockPhone(page);
}
async function home(page: Page) {
  await page.keyboard.press('Alt+Home');
  await expect(page.locator('.app-host:not([hidden])')).toHaveCount(0);
}
async function back(page: Page) {
  await page.mouse.move(8, 240);
  await page.mouse.down();
  await page.mouse.move(160, 242, { steps: 12 });
  await page.mouse.up();
}

test('다섯 프로필의 과거 대화·선택 답장·자유 입력을 구분하고 재접속 후 보존한다', async ({
  page,
}) => {
  await start(page);
  await launchHomeApp(page, 'notes');
  await page.locator('[data-note-id=curry]').tap();
  for (const item of ['감자', '양파', '고기', '카레'])
    await page.getByRole('checkbox', { name: `${item} 완료`, exact: true }).check();
  await page.getByRole('button', { name: '전화 거절' }).tap();
  await home(page);
  for (const name of [
    '도지마 다이고',
    '마지마 고로',
    '미네 요시타카',
    '사에지마 타이가',
    '사와무라 하루카',
  ]) {
    await launchHomeApp(page, 'contacts');
    if (await page.getByRole('button', { name: '연락처 목록으로 돌아가기' }).count())
      await page.getByRole('button', { name: '연락처 목록으로 돌아가기' }).tap();
    await page.getByRole('button', { name, exact: true }).tap();
    await expect(page.getByRole('img', { name: `${name} 프로필` })).toBeVisible();
    await page.getByRole('button', { name: `${name}에게 메시지 보내기` }).tap();
    if (name === '미네 요시타카' || name === '사에지마 타이가') {
      const history =
        name === '미네 요시타카'
          ? [
              '이해해 달라고 할 생각은 없다. 다이고의 뜻은 존중해 줘라.',
              '다이고 씨의 뜻이라면 따릅니다. 당신에게 동의했다는 뜻은 아닙니다.',
            ]
          : ['형님답군. 사에지마, 너는 별일 없나?', '나는 괜찮다. 니한테는 괜히 숨길 것도 없고.'];
      for (const text of history)
        await expect(page.locator('.message-bubble').getByText(text, { exact: true })).toHaveCount(
          1,
        );
      await expect(page.locator('.message-story-reply')).toHaveCount(0);
      await expect(page.locator('.message-ai-input')).toHaveCount(0);
    } else {
      let text: string;
      if (name === '마지마 고로') {
        text = '형님, 볼 일이 끝나면 연락드리겠습니다.';
        await expect(page.locator('.message-story-reply')).toHaveCount(0);
        await page.getByRole('textbox', { name: '마지마에게 메시지 입력', exact: true }).fill(text);
        const send = page.getByRole('button', { name: '메시지 보내기', exact: true });
        await expect(send).toBeEnabled();
        await send.tap();
      } else {
        const choice = page.locator('.message-choice-list .message-story-reply').first();
        text = await choice.innerText();
        await expect(choice).toBeEnabled();
        await choice.tap();
      }
      await expect(page.locator('.message-bubble').getByText(text, { exact: true })).toBeVisible();
      if (name === '마지마 고로' || name === '사와무라 하루카') {
        await finishAiReply(page, name === '사와무라 하루카' ? 'haruka' : 'majima');
        await expect(
          page.getByText(`검증용 ${name === '사와무라 하루카' ? '하루카' : '마지마'} 답장`, {
            exact: true,
          }),
        ).toBeVisible();
      } else {
        await expect(page.getByRole('status')).toContainText('답장 대기 중');
        await page.clock.runFor(12_000);
        await expect(page.getByRole('status').filter({ hasText: '답장 대기 중' })).toHaveCount(0);
      }
      await expect(page.getByRole('button', { name: `${text} 보내기`, exact: true })).toHaveCount(
        0,
      );
    }
    await home(page);
  }
  await start(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=haruka]').tap();
  await expect(page.getByText('메모에 적힌 카레 재료는 다 샀다.', { exact: true })).toBeVisible();
  await expect(page.getByText('검증용 하루카 답장', { exact: true })).toBeVisible();
  await expect(page.locator('.message-choice-list .message-story-reply')).toHaveCount(0);
});

test('메모의 체크·편집·생성·삭제와 사진 즐겨찾기를 보존한다', async ({ page }) => {
  await start(page);
  await launchHomeApp(page, 'notes');
  await page.locator('[data-note-id=curry]').tap();
  await page.getByRole('checkbox', { name: '감자 완료' }).check();
  await page.getByRole('button', { name: '메모 목록으로 돌아가기' }).tap();
  await page.locator('[data-note-id=gym]').tap();
  await page
    .getByRole('textbox', { name: '메모 내용', exact: true })
    .fill('하루카에게 우유가 남았는지 물어볼 것.');
  await page.getByRole('button', { name: '새로운 메모' }).tap();
  await page.getByRole('textbox', { name: '메모 제목' }).fill('내일 할 일');
  await page.getByRole('textbox', { name: '메모 내용', exact: true }).fill('아이들과 시장에 가자.');
  await page.getByRole('button', { name: '메모 삭제' }).tap();
  await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).tap();
  await expect(page.getByText('내일 할 일', { exact: true })).toHaveCount(0);
  await home(page);
  await launchHomeApp(page, 'photos');
  await page.getByRole('button', { name: '아이들과 함께', exact: true }).tap();
  await page.getByRole('button', { name: '즐겨찾기', exact: true }).tap();
  await expect(page.getByRole('button', { name: '즐겨찾기', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '다음 사진' }).tap();
  await page.getByRole('button', { name: '이전 사진' }).tap();
  await back(page);
  await expect(page.getByRole('button', { name: '보관함', exact: true })).toBeVisible();
  await start(page);
  await launchHomeApp(page, 'notes');
  await page.locator('[data-note-id=curry]').tap();
  await expect(page.getByRole('checkbox', { name: '감자 완료' })).toBeChecked();
  await page.getByRole('button', { name: '메모 목록으로 돌아가기' }).tap();
  await page.locator('[data-note-id=gym]').tap();
  await expect(page.getByRole('textbox', { name: '메모 내용', exact: true })).toHaveValue(
    '하루카에게 우유가 남았는지 물어볼 것.',
  );
  await home(page);
  await launchHomeApp(page, 'photos');
  await page.getByRole('button', { name: '모음', exact: true }).tap();
  await page.getByRole('button', { name: /즐겨찾는 항목/ }).tap();
  await expect(page.getByRole('button', { name: '아이들과 함께', exact: true })).toBeVisible();
});

for (const size of [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`스토리 앱의 뒤로·최근 앱·화면 고정 ${size.width}`, async ({ page }) => {
    await page.setViewportSize(size);
    await start(page);
    await launchHomeApp(page, 'contacts');
    await page.getByRole('button', { name: '사와무라 하루카', exact: true }).tap();
    await back(page);
    await expect(page.getByRole('searchbox', { name: '연락처 검색' })).toBeVisible();
    await page.keyboard.press('Alt+a');
    await page.getByRole('button', { name: '연락처 앱으로 전환', exact: true }).tap();
    await expect(page.getByRole('searchbox', { name: '연락처 검색' })).toBeVisible();
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });
  });
}

test('연결이 끊기면 자유 입력 전송을 막고 초안을 유지해 복구 후 한 번 보낸다', async ({ page }) => {
  await start(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=majima]').tap();
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/chat')
      posts.push(request.postDataJSON().message);
  });
  const input = page.getByRole('textbox', { name: '마지마에게 메시지 입력', exact: true });
  const send = page.getByRole('button', { name: '메시지 보내기', exact: true });
  const text = '형님, 시간 되면 한 판 하시죠.';
  await expect(page.locator('.message-story-reply')).toHaveCount(0);
  await input.fill(text);
  await expect(send).toBeEnabled();
  await home(page);
  await launchHomeApp(page, 'settings');
  await page.getByRole('switch', { name: '에어플레인 모드', exact: true }).check();
  await home(page);
  await launchHomeApp(page, 'messages');
  await expect(input).toHaveValue(text);
  await expect(send).toBeDisabled();
  expect(posts).toEqual([]);
  await home(page);
  await launchHomeApp(page, 'settings');
  await page.getByRole('switch', { name: '에어플레인 모드', exact: true }).uncheck();
  await page.getByRole('button', { name: /Wi-Fi/ }).tap();
  await page.getByRole('switch', { name: 'Wi-Fi', exact: true }).check();
  await home(page);
  await launchHomeApp(page, 'messages');
  await expect(input).toHaveValue(text);
  await expect(send).toBeEnabled();
  expect(posts).toEqual([]);
  await send.tap();
  await finishAiReply(page, 'majima');
  await expect(page.locator('.message-bubble').getByText(text, { exact: true })).toHaveCount(1);
  await expect.poll(() => posts).toEqual([text]);
});

test('저장소 쓰기 거부와 낮은 화면에서도 메모·메시지를 사용할 수 있다', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('denied');
    };
  });
  await page.setViewportSize({ width: 360, height: 430 });
  await start(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=majima]').tap();
  await page
    .getByRole('textbox', { name: '마지마에게 메시지 입력', exact: true })
    .fill('형님, 시간 되면 한 판 하시죠.');
  const send = page.getByRole('button', { name: '메시지 보내기', exact: true });
  await expect(send).toBeInViewport();
  await send.tap();
  await expect(
    page.locator('.message-bubble').getByText('형님, 시간 되면 한 판 하시죠.', { exact: true }),
  ).toBeVisible();
  await home(page);
  await launchHomeApp(page, 'notes');
  await page.getByRole('button', { name: '새로운 메모' }).tap();
  await page.getByRole('textbox', { name: '메모 제목' }).fill('저장 실패에도 작성');
  await page.getByRole('button', { name: '메모 목록으로 돌아가기' }).tap();
  await expect(page.getByText('저장 실패에도 작성', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('사진과 말풍선을 터치해 포커스를 잃어도 Escape는 활성 앱만 뒤로 간다', async ({ page }) => {
  await start(page);
  await launchHomeApp(page, 'contacts');
  await page.getByRole('button', { name: '사와무라 하루카', exact: true }).tap();
  await page.getByRole('img', { name: '사와무라 하루카 프로필' }).tap();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('searchbox', { name: '연락처 검색' })).toBeVisible();
  await home(page);
  await launchHomeApp(page, 'messages');
  await page.locator('[data-conversation=haruka]').tap();
  await page.getByText('좋다. 장은 내가 봐 오겠다.', { exact: true }).tap();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('searchbox', { name: '메시지 검색' })).toBeVisible();
});
