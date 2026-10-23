import { expect, test, type Locator, type Page } from '@playwright/test';

const safari = (page: Page) => page.getByTestId('safari-app');
const documentView = (page: Page) => safari(page).locator('.safari-document:not([hidden])');
const addressDisplay = (page: Page) =>
  safari(page).getByRole('button', { name: '주소 또는 검색어 입력', exact: true });

async function openHome(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-23T09:41:00+09:00'));
  await page.goto('./');
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
  await expect(page.getByTestId('home-screen')).toBeVisible();
}

async function launchSafari(page: Page) {
  await page.getByRole('button', { name: 'Safari', exact: true }).tap();
  await expect(safari(page)).toBeVisible();
  await expect(safari(page).getByRole('heading', { name: 'Safari', exact: true })).toBeFocused();
}

async function openSafari(page: Page) {
  await openHome(page);
  await launchSafari(page);
}

async function goHome(page: Page) {
  await page.getByRole('button', { name: '홈으로 돌아가기', exact: true }).tap();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Safari', exact: true })).toBeVisible();
}

async function enterAddress(page: Page, value: string) {
  await addressDisplay(page).tap();
  const input = safari(page).getByRole('textbox', { name: '주소 또는 검색어', exact: true });
  await expect(input).toBeFocused();
  await input.fill(value);
  await safari(page).getByRole('button', { name: '이동', exact: true }).tap();
}

async function menuAction(page: Page, name: string) {
  await safari(page).getByRole('button', { name: '페이지 메뉴', exact: true }).tap();
  await safari(page)
    .getByRole('dialog', { name: '페이지 메뉴' })
    .getByRole('button', { name, exact: true })
    .tap();
}

async function showTabs(page: Page, count: number) {
  await safari(page)
    .getByRole('button', { name: `탭 보기, ${count}개`, exact: true })
    .tap();
  const tabs = safari(page).getByRole('region', { name: '열린 탭', exact: true });
  await expect(tabs.getByRole('heading', { name: `탭 ${count}개`, exact: true })).toBeVisible();
  return tabs;
}

async function setAirplaneMode(page: Page, enabled: boolean) {
  await goHome(page);
  await page.getByRole('button', { name: '설정', exact: true }).tap();
  const back = page.getByRole('button', { name: '설정 목록으로 돌아가기', exact: true });
  if (await back.isVisible()) await back.tap();
  const airplane = page.getByRole('switch', { name: '에어플레인 모드', exact: true });
  await airplane.setChecked(enabled);
  if (enabled) await expect(airplane).toBeChecked();
  else await expect(airplane).not.toBeChecked();
  await goHome(page);
  await launchSafari(page);
}

async function expectTouchable(locator: Locator) {
  await expect(locator).toBeVisible();
  // Resize and visualViewport events settle asynchronously in WebKit. Read both
  // rectangles in one frame and retry the actual visible/reachable condition.
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const top = window.visualViewport?.offsetTop ?? 0;
        const height = window.visualViewport?.height ?? innerHeight;
        const width = window.visualViewport?.width ?? innerWidth;
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {
          withinViewport:
            rect.x >= 0 &&
            rect.right <= width + 1 &&
            rect.y >= top &&
            rect.bottom <= top + height + 1,
          reachable: hit !== null && element.contains(hit),
        };
      }),
    )
    .toEqual({ withinViewport: true, reachable: true });
}

test('Safari 진입은 키보드를 열지 않고 두 내부 페이지와 뒤로·앞으로·새로 고침을 제공한다', async ({
  page,
}) => {
  await openSafari(page);
  await expect(safari(page).getByRole('textbox')).toHaveCount(0);
  await expect(
    safari(page).getByRole('heading', { name: '시작 페이지', exact: true }),
  ).toBeVisible();
  await expect(safari(page).getByRole('button', { name: '뒤로', exact: true })).toBeDisabled();

  await safari(page).getByRole('button', { name: '시작 안내', exact: true }).tap();
  await expect(safari(page).getByRole('heading', { name: /작은 화면/ })).toBeVisible();
  await expect(addressDisplay(page)).toHaveText('yaku.test/guide');
  await documentView(page).evaluate((element) => {
    element.scrollTop = 240;
  });
  await expect.poll(() => documentView(page).evaluate((element) => element.scrollTop)).toBe(240);
  await safari(page).getByRole('button', { name: '새로 고침', exact: true }).tap();
  await expect.poll(() => documentView(page).evaluate((element) => element.scrollTop)).toBe(240);

  await enterAddress(page, 'https://yaku.test/example');
  await expect(safari(page).getByRole('heading', { name: /천천히/ })).toBeVisible();
  await expect.poll(() => documentView(page).evaluate((element) => element.scrollTop)).toBe(0);
  await safari(page).getByRole('button', { name: '뒤로', exact: true }).tap();
  await expect(addressDisplay(page)).toHaveText('yaku.test/guide');
  await expect.poll(() => documentView(page).evaluate((element) => element.scrollTop)).toBe(240);
  await menuAction(page, '앞으로');
  await expect(addressDisplay(page)).toHaveText('yaku.test/example');
  await safari(page).getByRole('button', { name: '뒤로', exact: true }).tap();
  await safari(page).getByRole('button', { name: '뒤로', exact: true }).tap();
  await expect(
    safari(page).getByRole('heading', { name: '시작 페이지', exact: true }),
  ).toBeVisible();
  await expect(safari(page).getByRole('button', { name: '뒤로', exact: true })).toBeDisabled();
});

test('검색은 내부 페이지 제목만 찾고 외부 주소는 명시적인 새 창 링크로 안내한다', async ({
  page,
}) => {
  await openSafari(page);
  await enterAddress(page, '예제');
  await expect(safari(page).getByText('검색 결과 1개', { exact: true })).toBeVisible();
  await safari(page)
    .getByRole('button', { name: /https:\/\/yaku.test\/example.*예제 페이지/ })
    .tap();
  await expect(addressDisplay(page)).toHaveText('yaku.test/example');
  await enterAddress(page, '없는 제목');
  await expect(
    safari(page).getByRole('heading', { name: '일치하는 페이지가 없어요' }),
  ).toBeVisible();
  await expect(safari(page).getByText('검색 결과 0개', { exact: true })).toBeVisible();

  await enterAddress(page, 'https://example.com/path?q=hello');
  await expect(
    safari(page).getByRole('heading', { name: '외부 웹사이트', exact: true }),
  ).toBeVisible();
  const external = safari(page).getByRole('link', { name: '외부 브라우저에서 열기', exact: true });
  await expect(external).toHaveAttribute('href', 'https://example.com/path?q=hello');
  await expect(external).toHaveAttribute('target', '_blank');
  await expect(external).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(safari(page).locator('iframe')).toHaveCount(0);
  expect(page.url()).toMatch(/\/yaku_IPhone\/$/);

  for (const unsafe of [
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///etc/passwd',
    'mailto:hello@example.com',
  ]) {
    await enterAddress(page, unsafe);
    await expect(
      safari(page).getByRole('heading', { name: '주소를 열 수 없습니다' }),
    ).toBeVisible();
    await expect(addressDisplay(page)).toHaveText('example.com');
    await safari(page).getByRole('button', { name: '닫기', exact: true }).tap();
    await expect(external).toBeVisible();
  }
  await safari(page).getByRole('button', { name: '뒤로', exact: true }).tap();
  await expect(
    safari(page).getByRole('heading', { name: '일치하는 페이지가 없어요' }),
  ).toBeVisible();
});

test('탭마다 페이지와 방문 위치가 남고 마지막 탭을 닫으면 빈 시작 탭이 생긴다', async ({
  page,
}) => {
  await openSafari(page);
  await safari(page).getByRole('button', { name: '시작 안내', exact: true }).tap();
  await documentView(page).evaluate((element) => {
    element.scrollTop = 240;
  });
  await expect.poll(() => documentView(page).evaluate((element) => element.scrollTop)).toBe(240);
  await menuAction(page, '새 탭');
  await expect(
    safari(page).getByRole('heading', { name: '시작 페이지', exact: true }),
  ).toBeVisible();
  await expect(safari(page).getByRole('textbox')).toHaveCount(0);
  await safari(page).getByRole('button', { name: '예제 페이지', exact: true }).tap();
  let tabs = await showTabs(page, 2);
  await tabs.getByRole('button', { name: '시작 안내 탭 선택', exact: true }).tap();
  await expect(addressDisplay(page)).toHaveText('yaku.test/guide');
  await expect.poll(() => documentView(page).evaluate((element) => element.scrollTop)).toBe(240);

  tabs = await showTabs(page, 2);
  await tabs.getByRole('button', { name: '예제 페이지 탭 닫기', exact: true }).tap();
  await expect(tabs.getByRole('heading', { name: '탭 1개', exact: true })).toBeVisible();
  await safari(page).getByRole('button', { name: '완료', exact: true }).tap();
  await expect(addressDisplay(page)).toHaveText('yaku.test/guide');
  tabs = await showTabs(page, 1);
  await tabs.getByRole('button', { name: '시작 안내 탭 닫기', exact: true }).tap();
  await expect(
    safari(page).getByRole('heading', { name: '시작 페이지', exact: true }),
  ).toBeVisible();
  await expect(safari(page).getByRole('button', { name: '뒤로', exact: true })).toBeDisabled();
  tabs = await showTabs(page, 1);
  await tabs.getByRole('button', { name: '새 탭', exact: true }).tap();
  await expect(
    safari(page).getByRole('button', { name: '탭 보기, 2개', exact: true }),
  ).toBeVisible();
});

test('홈을 거쳐 재진입하면 탭·스크롤이 유지되고 전체 새로 고침은 세션을 초기화한다', async ({
  page,
}) => {
  await openSafari(page);
  await menuAction(page, '새 탭');
  await safari(page).getByRole('button', { name: '시작 안내', exact: true }).tap();
  await documentView(page).evaluate((element) => {
    element.scrollTop = 240;
  });
  await expect.poll(() => documentView(page).evaluate((element) => element.scrollTop)).toBe(240);
  await goHome(page);
  await expect(safari(page)).toBeHidden();
  await launchSafari(page);
  await expect(addressDisplay(page)).toHaveText('yaku.test/guide');
  await expect(
    safari(page).getByRole('button', { name: '탭 보기, 2개', exact: true }),
  ).toBeVisible();
  await expect.poll(() => documentView(page).evaluate((element) => element.scrollTop)).toBe(240);
  await expect(safari(page).getByRole('textbox')).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: '잠금 해제', exact: true }).tap();
  await launchSafari(page);
  await expect(
    safari(page).getByRole('heading', { name: '시작 페이지', exact: true }),
  ).toBeVisible();
  await expect(
    safari(page).getByRole('button', { name: '탭 보기, 1개', exact: true }),
  ).toBeVisible();
});

test('설정의 오프라인 전환은 현재 페이지를 보존하고 Wi-Fi 복구 후 실패한 이동만 재시도한다', async ({
  page,
}) => {
  await openSafari(page);
  await safari(page).getByRole('button', { name: '시작 안내', exact: true }).tap();
  await setAirplaneMode(page, true);
  await expect(safari(page).getByText('오프라인', { exact: true })).toBeVisible();
  await expect(safari(page).getByRole('heading', { name: /작은 화면/ })).toBeVisible();
  await enterAddress(page, 'https://yaku.test/example');
  await expect(safari(page).getByRole('heading', { name: '연결할 수 없습니다' })).toBeVisible();
  await expect(addressDisplay(page)).toHaveText('yaku.test/guide');
  await safari(page).getByRole('button', { name: '다시 시도', exact: true }).tap();
  await expect(addressDisplay(page)).toHaveText('yaku.test/guide');

  await goHome(page);
  await page.getByRole('button', { name: '설정', exact: true }).tap();
  await expect(page.getByRole('switch', { name: '에어플레인 모드', exact: true })).toBeChecked();
  await page.getByRole('button', { name: /^Wi-Fi/ }).tap();
  await page.getByRole('switch', { name: 'Wi-Fi', exact: true }).check();
  await goHome(page);
  await launchSafari(page);
  await expect(safari(page).getByText('오프라인', { exact: true })).toHaveCount(0);
  await expect(safari(page).getByRole('heading', { name: '연결할 수 없습니다' })).toBeVisible();
  await safari(page).getByRole('button', { name: '다시 시도', exact: true }).tap();
  await expect(safari(page).getByRole('heading', { name: /천천히/ })).toBeVisible();
  await safari(page).getByRole('button', { name: '뒤로', exact: true }).tap();
  await expect(addressDisplay(page)).toHaveText('yaku.test/guide');
  await safari(page).getByRole('button', { name: '뒤로', exact: true }).tap();
  await expect(safari(page).getByRole('button', { name: '뒤로', exact: true })).toBeDisabled();
});

for (const operation of ['뒤로', '앞으로', '새로 고침'] as const) {
  test(`오프라인에서 ${operation} 요청은 현재 주소를 보존하고 연결 복구 후 원래 동작을 수행한다`, async ({
    page,
  }) => {
    await openSafari(page);
    await enterAddress(page, 'https://yaku.test/guide');
    await enterAddress(page, 'https://yaku.test/example');
    if (operation === '앞으로')
      await safari(page).getByRole('button', { name: '뒤로', exact: true }).tap();
    const previous = operation === '앞으로' ? 'yaku.test/guide' : 'yaku.test/example';
    await setAirplaneMode(page, true);
    if (operation === '앞으로') await menuAction(page, operation);
    else await safari(page).getByRole('button', { name: operation, exact: true }).tap();
    await expect(safari(page).getByRole('heading', { name: '연결할 수 없습니다' })).toBeVisible();
    await expect(addressDisplay(page)).toHaveText(previous);
    await setAirplaneMode(page, false);
    await expect(addressDisplay(page)).toHaveText(previous);
    await safari(page).getByRole('button', { name: '다시 시도', exact: true }).tap();
    await expect(safari(page).getByRole('heading', { name: '연결할 수 없습니다' })).toHaveCount(0);
    await expect(addressDisplay(page)).toHaveText(
      operation === '뒤로' ? 'yaku.test/guide' : 'yaku.test/example',
    );
    if (operation === '새로 고침') {
      await safari(page).getByRole('button', { name: '뒤로', exact: true }).tap();
      await expect(addressDisplay(page)).toHaveText('yaku.test/guide');
    }
  });
}

test('오프라인에서도 빈 탭 생성과 기존 탭 선택이 가능하고 실패한 이동은 해당 탭에 남는다', async ({
  page,
}) => {
  await openSafari(page);
  await safari(page).getByRole('button', { name: '시작 안내', exact: true }).tap();
  await menuAction(page, '새 탭');
  await safari(page).getByRole('button', { name: '예제 페이지', exact: true }).tap();
  await setAirplaneMode(page, true);
  const tabs = await showTabs(page, 2);
  await tabs.getByRole('button', { name: '시작 안내 탭 선택', exact: true }).tap();
  await expect(safari(page).getByRole('heading', { name: /작은 화면/ })).toBeVisible();
  await enterAddress(page, 'https://yaku.test/example');
  await expect(safari(page).getByRole('heading', { name: '연결할 수 없습니다' })).toBeVisible();
  await menuAction(page, '새 탭');
  await expect(
    safari(page).getByRole('heading', { name: '시작 페이지', exact: true }),
  ).toBeVisible();
  await expect(safari(page).getByRole('heading', { name: '연결할 수 없습니다' })).toHaveCount(0);
  await showTabs(page, 3);
  await safari(page).getByRole('button', { name: '시작 안내 탭 선택', exact: true }).tap();
  await expect(addressDisplay(page)).toHaveText('yaku.test/guide');
  await expect(safari(page).getByRole('heading', { name: '연결할 수 없습니다' })).toBeVisible();
});

for (const size of [
  { width: 360, height: 420 },
  { width: 390, height: 480 },
]) {
  test(`주소 편집 중 축소 viewport에서 이동·취소·홈 버튼을 가리지 않는다 ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await openSafari(page);
    await addressDisplay(page).tap();
    const input = safari(page).getByRole('textbox', { name: '주소 또는 검색어', exact: true });
    await expect(input).toBeFocused();
    // Desktop browser automation cannot open the physical iPhone keyboard.
    // Shrinking the viewport checks the controls that must remain usable above it.
    await page.setViewportSize(size);
    for (const control of [
      input,
      safari(page).getByRole('button', { name: '이동', exact: true }),
      safari(page).getByRole('button', { name: '취소', exact: true }),
      safari(page).getByRole('button', { name: '홈으로 돌아가기', exact: true }),
    ]) {
      await expectTouchable(control);
    }
    await input.fill('https://yaku.test/guide');
    await safari(page).getByRole('button', { name: '이동', exact: true }).tap();
    await expect(addressDisplay(page)).toHaveText('yaku.test/guide');
    await addressDisplay(page).tap();
    await input.fill('취소할 검색어');
    await safari(page).getByRole('button', { name: '취소', exact: true }).tap();
    await expect(addressDisplay(page)).toHaveText('yaku.test/guide');
    await expect(safari(page).getByRole('textbox')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
  });
}

test('키보드로 페이지와 주소 입력을 열고 Alt+Home으로 복귀한다', async ({ page }) => {
  await openSafari(page);
  await page.keyboard.press('Tab');
  await expect(safari(page).getByRole('button', { name: '시작 안내', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(addressDisplay(page)).toHaveText('yaku.test/guide');
  await page.keyboard.press('Alt+Home');
  await expect(page.getByRole('button', { name: 'Safari', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(safari(page).getByRole('heading', { name: 'Safari', exact: true })).toBeFocused();
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press('Tab');
    if (await addressDisplay(page).evaluate((el) => el === document.activeElement)) break;
  }
  await expect(addressDisplay(page)).toBeFocused();
  await page.keyboard.press('Enter');
  const input = safari(page).getByRole('textbox', { name: '주소 또는 검색어', exact: true });
  await expect(input).toBeFocused();
  await input.fill('예제');
  await page.keyboard.press('Enter');
  await expect(safari(page).getByText('검색 결과 1개', { exact: true })).toBeVisible();
  await page.keyboard.press('Alt+Home');
  await expect(safari(page)).toBeHidden();
});

test('페이지 메뉴가 열려 있어도 홈 버튼과 홈 스와이프를 사용할 수 있다', async ({ page }) => {
  await openSafari(page);
  await safari(page).getByRole('button', { name: '페이지 메뉴', exact: true }).tap();
  await expect(safari(page).getByRole('dialog')).toBeVisible();
  await goHome(page);
  await launchSafari(page);
  await expect(safari(page).getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(safari(page).getByRole('dialog')).toHaveCount(0);
  await expect(
    safari(page).getByRole('button', { name: '페이지 메뉴', exact: true }),
  ).toBeFocused();
  await safari(page).getByRole('button', { name: '페이지 메뉴', exact: true }).tap();
  const box = (await page.getByTestId('safari-home-gesture').boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 130, { steps: 8 });
  await page.mouse.up();
  await expect(safari(page)).toBeHidden();
  await expect(page.locator('[data-launch-app=safari]')).toBeFocused();
});
