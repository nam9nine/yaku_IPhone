import { installAiClock } from './ai-clock';
import { expect, type Page } from '@playwright/test';
import { AI_ENDPOINT } from '../../src/ai/config';
import { isCallEvents, type PhoneEventId } from '../../src/ai/client';
import type { CallFollowupTrigger } from '../../src/ai/client';

/** Deterministic HTTP fixture for legacy phone/story flows; never calls the local model. */
export async function mockStoryAi(
  page: Page,
  { majimaCompletedExchanges = 0 }: { majimaCompletedExchanges?: number } = {},
) {
  await installAiClock(page);
  type Character = 'haruka' | 'majima';
  type Message = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    time: string;
    status: 'complete';
    job_id: string;
    request_id?: string;
    phone_events?: PhoneEventId[];
    request_kind?: 'chat' | 'call_followup';
  };
  const histories: Record<Character, Message[]> = {
    haruka: [],
    majima: Array.from({ length: majimaCompletedExchanges }, (_, index): Message[] => [
      {
        id: `seed-${index}-user`,
        role: 'user',
        content: `이전 질문 ${index + 1}`,
        time: '2026-10-25T00:00:00Z',
        status: 'complete',
        job_id: `seed-${index}`,
        request_id: `seed-${index}`,
      },
      {
        id: `seed-${index}-assistant`,
        role: 'assistant',
        content: `이전 답장 ${index + 1}`,
        time: '2026-10-25T00:00:01Z',
        status: 'complete',
        job_id: `seed-${index}`,
        request_id: `seed-${index}`,
      },
    ]).flat(),
  };
  const jobs = new Map<
    string,
    { character: Character; message: string; id: string; trigger?: CallFollowupTrigger }
  >();
  await page.route(`${AI_ENDPOINT}/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let result: unknown;
    if (request.method() === 'OPTIONS') result = {};
    else if (url.pathname === '/v1/health') result = { status: 'ready' };
    else if (url.pathname === '/v1/sessions') result = { token: 'story-fixture-session' };
    else if (url.pathname === '/v1/episodes/majima')
      result = { protocol: 1, enabled: false, episode: null, action: null };
    else if (url.pathname === '/v1/history')
      result = {
        messages: histories[url.searchParams.get('character') as Character],
        completed_exchanges: histories[url.searchParams.get('character') as Character].filter(
          (message) =>
            message.role === 'user' &&
            message.status === 'complete' &&
            !isCallEvents(message.phone_events),
        ).length,
        pending_job: null,
        next_cursor: null,
      };
    else if (url.pathname === '/v1/call-followups') {
      const body = request.postDataJSON();
      const id = String(body.request_id);
      if (!jobs.has(id)) {
        const trigger = { call_id: body.call_id, reason: body.reason, direction: body.direction };
        jobs.set(id, { character: body.character, message: '', id, trigger });
        histories[body.character as Character].push({
          id: `${id}-assistant`,
          role: 'assistant',
          content: `검증용 ${body.character === 'majima' ? '마지마' : '하루카'} 전화 후속 문자`,
          time: new Date().toISOString(),
          status: 'complete',
          request_id: id,
          job_id: id,
          request_kind: 'call_followup',
          phone_events: [],
        });
      }
      result = { job_id: id, status: 'queued' };
    } else if (url.pathname === '/v1/chat') {
      const body = request.postDataJSON();
      const id = String(body.request_id);
      if (!jobs.has(id)) {
        jobs.set(id, { character: body.character, message: body.message, id });
        histories[body.character as Character].push(
          {
            id: `${id}-user`,
            role: 'user',
            content: body.message,
            time: '2026-10-26T00:00:00Z',
            request_id: id,
            job_id: id,
            phone_events: body.phone_events ?? [],
            status: 'complete',
          },
          {
            id: `${id}-assistant`,
            role: 'assistant',
            content: `검증용 ${body.character === 'haruka' ? '하루카' : '마지마'} 답장`,
            time: '2026-10-26T00:00:01Z',
            request_id: id,
            job_id: id,
            phone_events: body.phone_events ?? [],
            status: 'complete',
          },
        );
      }
      result = { job_id: id, status: 'queued' };
    } else {
      const job = jobs.get(url.pathname.split('/').at(-1)!)!;
      result = {
        job_id: job.id,
        character: job.character,
        status: 'complete',
        ...(job.trigger ? { request_kind: 'call_followup' } : {}),
        request: job.trigger
          ? {
              id: job.id,
              kind: 'call_followup',
              trigger: job.trigger,
              time: new Date().toISOString(),
            }
          : { id: job.id, message: job.message, time: '2026-10-26T00:00:00Z' },
      };
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(result),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
    });
  });
}

/** Wait for the mocked initial history to render before taking a stable screenshot. */
export async function openStoryAi(
  page: Page,
  open: () => Promise<void>,
  character: 'haruka' | 'majima' = 'haruka',
) {
  await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.origin === new URL(AI_ENDPOINT).origin &&
        url.pathname === '/v1/history' &&
        url.searchParams.get('character') === character &&
        response.ok()
      );
    }),
    open(),
  ]);
  await expect(page.getByText('대화를 불러오는 중…', { exact: true })).toHaveCount(0);
}
