import {
  aiCharacters,
  AiRequestError,
  createSession,
  getHealth,
  getHistory,
  getJob,
  generationError,
  messageWithinLimits,
  postChat,
  type AiCharacter,
  type AiMessage,
} from './client';
import {
  configuredEndpoint,
  readAiConnection,
  readAiResetId,
  saveAiConnection,
  type AiConnection,
} from './connection';

export interface PendingMessage {
  requestId: string;
  message: string;
  time: string | null;
  jobId: string | null;
  historyId?: string;
  phase: 'submitting' | 'generating' | 'failed';
}
export interface AiThread {
  messages: AiMessage[];
  pending: PendingMessage | null;
  failedMessage: {
    message: string;
    time: string | null;
    historyId?: string;
    reason: 'input' | 'reply';
  } | null;
  loaded: boolean;
  loading: boolean;
  loadingOlder: boolean;
  nextCursor: string | null;
  olderLoaded: boolean;
  error: string | null;
}
interface AiSnapshot {
  connection: AiConnection | null;
  status: 'idle' | 'checking' | 'ready' | 'loading' | 'error';
  error: string | null;
  storageUnavailable: boolean;
  storageError: string | null;
  threads: Record<AiCharacter, AiThread>;
}
const emptyThread = (): AiThread => ({
  messages: [],
  pending: null,
  failedMessage: null,
  loaded: false,
  loading: false,
  loadingOlder: false,
  nextCursor: null,
  olderLoaded: false,
  error: null,
});
const emptyThreads = () => ({ haruka: emptyThread(), majima: emptyThread() });
const errorText = (error: unknown) =>
  error instanceof AiRequestError
    ? error.message
    : '지금은 대화에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.';
const authError = (error: unknown) => error instanceof AiRequestError && error.code === 'auth';
function mergeMessages(previous: AiMessage[], incoming: AiMessage[]): AiMessage[] {
  const merged = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) merged.set(message.id, message);
  return [...merged.values()];
}

/** A single Messages instance owns requests. Switching contacts never changes their owner. */
export class AiMessenger {
  private snapshot: AiSnapshot;
  private listeners = new Set<() => void>();
  private controller = new AbortController();
  private generation = 0;
  private timers = new Map<AiCharacter, ReturnType<typeof setTimeout>>();
  private polling = new Set<AiCharacter>();
  private online = true;
  private visible = true;
  private activeCharacter: AiCharacter | null = null;
  private refreshTask: Promise<void> | null = null;
  private renewed = false;
  private resetId = readAiResetId();

  constructor(connection = readAiConnection()) {
    this.snapshot = {
      connection,
      status: 'idle',
      error: null,
      storageUnavailable: false,
      storageError: null,
      threads: emptyThreads(),
    };
  }
  getSnapshot = (): AiSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(update: Partial<AiSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    this.listeners.forEach((listener) => listener());
  }
  private thread(character: AiCharacter, update: Partial<AiThread>): void {
    this.update({
      threads: {
        ...this.snapshot.threads,
        [character]: { ...this.snapshot.threads[character], ...update },
      },
    });
  }
  stop = (): void => {
    this.generation += 1;
    this.refreshTask = null;
    this.controller.abort();
    this.controller = new AbortController();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.polling.clear();
    const threads = { ...this.snapshot.threads };
    for (const character of aiCharacters)
      threads[character] = { ...threads[character], loading: false, loadingOlder: false };
    this.update({ status: 'idle', threads });
  };
  private current(generation: number): boolean {
    return this.generation === generation && this.online && this.resetId === readAiResetId();
  }

  syncReset = (resume = true): void => {
    if (this.resetId === readAiResetId()) return;
    this.stop();
    this.resetId = readAiResetId();
    this.renewed = false;
    this.update({ connection: readAiConnection(), threads: emptyThreads(), error: null });
    if (resume && this.activeCharacter) void this.refresh();
  };

  activate = async (character: AiCharacter | null): Promise<void> => {
    this.activeCharacter = character;
    if (!character || !this.online) return;
    if (this.snapshot.status !== 'ready') await this.refresh();
    if (this.activeCharacter !== character || this.snapshot.status !== 'ready') return;
    if (!this.snapshot.threads[character].loaded && !this.snapshot.threads[character].loading) {
      const generation = this.generation;
      try {
        await this.loadThread(character, generation);
      } catch (error) {
        if (this.current(generation)) await this.failConnection(error);
      }
    }
  };

  setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    if (!online) {
      this.stop();
      for (const character of aiCharacters) {
        const pending = this.snapshot.threads[character].pending;
        this.thread(character, {
          loading: false,
          loadingOlder: false,
          ...(pending ? { pending: { ...pending, phase: 'failed' } } : {}),
        });
      }
    } else if (this.activeCharacter) void this.refresh();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (
      visible &&
      this.activeCharacter &&
      aiCharacters.some((id) => this.snapshot.threads[id].pending?.phase === 'failed')
    ) {
      void this.refresh();
      return;
    }
    for (const character of aiCharacters) {
      const pending = this.snapshot.threads[character].pending;
      if (!pending?.jobId || pending.phase === 'failed' || this.polling.has(character)) continue;
      const timer = this.timers.get(character);
      if (timer) clearTimeout(timer);
      this.timers.delete(character);
      this.schedule(character, pending.jobId, this.generation, visible ? 0 : 15_000, 0);
    }
  }

  private remember(connection: AiConnection): void {
    if (this.resetId !== readAiResetId()) return;
    const saved = saveAiConnection(connection, this.resetId);
    this.update({
      connection,
      storageUnavailable: !saved,
      storageError: saved
        ? null
        : '브라우저에 대화 연결을 저장할 수 없어 이 화면에서만 유지됩니다.',
    });
  }

  private async connect(endpoint: string, generation: number): Promise<void> {
    const connect = async () => {
      if (!this.current(generation)) return;
      // Other open tabs may already have created the new session while this
      // tab waited for health or the lock. Reuse that scope after rechecking it.
      const connection =
        readAiConnection() ?? (await createSession(endpoint, this.controller.signal));
      if (this.current(generation)) this.remember(connection);
    };
    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request(
        'yaku-iphone-ai-session',
        { signal: this.controller.signal },
        connect,
      );
    } else await connect();
  }

  refresh = (renew = false): Promise<void> => {
    if (!this.online || !this.activeCharacter) return Promise.resolve();
    if (this.refreshTask) return this.refreshTask;
    const task = this.runRefresh(renew).finally(() => {
      if (this.refreshTask === task) this.refreshTask = null;
    });
    this.refreshTask = task;
    return task;
  };

  private async runRefresh(renew: boolean): Promise<void> {
    this.stop();
    const generation = this.generation;
    const endpoint = configuredEndpoint();
    this.update({ status: 'checking', error: null });
    for (const character of aiCharacters) {
      const pending = this.snapshot.threads[character].pending;
      if (pending) this.thread(character, { pending: { ...pending, phase: 'failed' } });
    }
    if (!endpoint) {
      this.update({
        status: 'error',
        error: '지금은 대화에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      });
      return;
    }
    try {
      const status = await getHealth(endpoint, this.controller.signal);
      if (!this.current(generation)) return;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (renew) {
            if (this.renewed)
              throw new AiRequestError(
                '대화 연결을 갱신하지 못했습니다. 잠시 후 다시 시도해 주세요.',
              );
            this.renewed = true;
            // No accepted request is silently resent under a different visitor.
            const threads = emptyThreads();
            for (const character of aiCharacters) {
              const pending = this.snapshot.threads[character].pending;
              if (pending?.message)
                threads[character].failedMessage = {
                  message: pending.message,
                  time: pending.time,
                  reason: 'input',
                };
            }
            this.update({ connection: null, threads });
            saveAiConnection(null, this.resetId);
          }
          if (!this.snapshot.connection) {
            await this.connect(endpoint, generation);
            if (!this.current(generation)) return;
          }
          this.update({
            status,
            error:
              status === 'loading'
                ? '답장을 준비하고 있습니다. 잠시 후 다시 시도해 주세요.'
                : status === 'error'
                  ? '지금은 답장을 받을 수 없습니다. 잠시 후 다시 시도해 주세요.'
                  : null,
          });
          const targets = aiCharacters.filter(
            (character) =>
              character === this.activeCharacter || this.snapshot.threads[character].pending,
          );
          for (const character of targets) {
            if (!this.current(generation)) return;
            await this.loadThread(character, generation);
          }
          if (!this.current(generation)) return;
          if (this.snapshot.connection) this.remember(this.snapshot.connection);
          return;
        } catch (error) {
          if (!this.current(generation)) return;
          if (authError(error) && !this.renewed && attempt === 0) {
            renew = true;
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      if (this.current(generation)) this.update({ status: 'error', error: errorText(error) });
    }
  }

  private async failConnection(error: unknown): Promise<void> {
    if (authError(error) && !this.renewed) {
      if (this.refreshTask) await this.refreshTask;
      await this.refresh(true);
    } else this.update({ status: 'error', error: errorText(error) });
  }

  private async loadThread(character: AiCharacter, generation: number): Promise<void> {
    const connection = this.snapshot.connection;
    if (!connection) return;
    this.thread(character, { loading: true, error: null });
    try {
      const result = await getHistory(connection, character, this.controller.signal);
      if (!this.current(generation)) return;
      const thread = this.snapshot.threads[character];
      const existing = thread.pending;
      const accepted = result.messages.find(
        (message) =>
          message.role === 'user' &&
          ((existing?.requestId && message.request_id === existing.requestId) ||
            (result.pending_job && message.job_id === result.pending_job)),
      );
      const resolved =
        accepted && !['queued', 'generating'].includes(accepted.status ?? 'complete');
      const pending = result.pending_job
        ? {
            requestId: accepted?.request_id ?? existing?.requestId ?? '',
            message: accepted?.content ?? existing?.message ?? '',
            time: accepted?.time ?? existing?.time ?? null,
            jobId: result.pending_job,
            historyId: accepted?.id,
            phase: 'generating' as const,
          }
        : resolved
          ? null
          : existing;
      this.thread(character, {
        messages: mergeMessages(thread.messages, result.messages),
        loaded: true,
        loading: false,
        nextCursor: thread.olderLoaded ? thread.nextCursor : result.next_cursor,
        pending,
        ...(resolved && accepted.status !== 'complete'
          ? {
              failedMessage: {
                message: accepted.content,
                time: accepted.time,
                historyId: accepted.id,
                reason: 'reply' as const,
              },
              error: generationError(),
            }
          : {}),
      });
      if (pending?.jobId) void this.poll(character, pending.jobId, generation, 0);
    } catch (error) {
      if (this.current(generation))
        this.thread(character, { loaded: false, loading: false, error: errorText(error) });
      throw error;
    }
  }

  loadOlder = async (character: AiCharacter): Promise<void> => {
    const thread = this.snapshot.threads[character];
    const connection = this.snapshot.connection;
    if (!connection || !thread.nextCursor || thread.loadingOlder || !this.online) return;
    const generation = this.generation;
    this.thread(character, { loadingOlder: true });
    try {
      const result = await getHistory(
        connection,
        character,
        this.controller.signal,
        thread.nextCursor,
      );
      if (!this.current(generation)) return;
      this.thread(character, {
        messages: mergeMessages(result.messages, this.snapshot.threads[character].messages),
        nextCursor: result.next_cursor,
        olderLoaded: true,
        loadingOlder: false,
      });
    } catch (error) {
      if (!this.current(generation)) return;
      this.thread(character, { loadingOlder: false, error: errorText(error) });
      if (authError(error)) await this.failConnection(error);
    }
  };

  send(character: AiCharacter, text: string, active: boolean, online: boolean): boolean {
    const thread = this.snapshot.threads[character];
    const message = text.trim();
    if (
      !active ||
      !online ||
      !this.online ||
      !this.current(this.generation) ||
      !message ||
      !messageWithinLimits(message) ||
      this.snapshot.status !== 'ready' ||
      !thread.loaded ||
      thread.loading ||
      aiCharacters.some((id) => this.snapshot.threads[id].pending)
    )
      return false;
    const pending: PendingMessage = {
      requestId: crypto.randomUUID(),
      message,
      time: new Date().toISOString(),
      jobId: null,
      phase: 'submitting',
    };
    this.thread(character, { pending, error: null });
    void this.submit(character, pending, this.generation);
    return true;
  }

  takeFailedMessage(character: AiCharacter, active: boolean): AiThread['failedMessage'] {
    if (!active) return null;
    const failed = this.snapshot.threads[character].failedMessage;
    if (failed) this.thread(character, { failedMessage: null, error: null });
    return failed;
  }

  retry(character: AiCharacter, active: boolean, online: boolean): void {
    const pending = this.snapshot.threads[character].pending;
    if (
      !active ||
      !online ||
      !this.online ||
      !this.current(this.generation) ||
      this.snapshot.status !== 'ready' ||
      !pending ||
      pending.phase !== 'failed'
    )
      return;
    this.thread(character, {
      pending: { ...pending, phase: pending.jobId ? 'generating' : 'submitting' },
      error: null,
    });
    if (pending.jobId) void this.poll(character, pending.jobId, this.generation, 0);
    else void this.submit(character, pending, this.generation);
  }

  private async submit(
    character: AiCharacter,
    pending: PendingMessage,
    generation: number,
  ): Promise<void> {
    const connection = this.snapshot.connection;
    if (!connection) return;
    try {
      const jobId = await postChat(
        connection,
        character,
        pending.message,
        pending.requestId,
        this.controller.signal,
      );
      if (!this.current(generation)) return;
      this.thread(character, { pending: { ...pending, jobId, phase: 'generating' } });
      void this.poll(character, jobId, generation, 0);
    } catch (error) {
      if (!this.current(generation)) return;
      if (
        error instanceof AiRequestError &&
        ['invalid_input', 'input_limit'].includes(error.code)
      ) {
        this.thread(character, {
          pending: null,
          failedMessage: { message: pending.message, time: pending.time, reason: 'input' },
          error: errorText(error),
        });
      } else {
        this.thread(character, {
          pending: { ...pending, phase: 'failed' },
          error: errorText(error),
        });
        if (authError(error)) await this.failConnection(error);
      }
    }
  }

  private schedule(
    character: AiCharacter,
    jobId: string,
    generation: number,
    delay: number,
    queued: number,
  ): void {
    const timer = setTimeout(() => {
      this.timers.delete(character);
      void this.poll(character, jobId, generation, queued);
    }, delay);
    this.timers.set(character, timer);
  }

  private async poll(
    character: AiCharacter,
    jobId: string,
    generation: number,
    queued: number,
  ): Promise<void> {
    const connection = this.snapshot.connection;
    if (!connection || !this.current(generation) || this.polling.has(character)) return;
    this.polling.add(character);
    try {
      const job = await getJob(connection, jobId, character, this.controller.signal);
      if (!this.current(generation)) return;
      const previous = this.snapshot.threads[character].pending;
      if (job.request && previous?.jobId === jobId)
        this.thread(character, {
          pending: {
            ...previous,
            requestId: job.request.id,
            message: job.request.message,
            time: job.request.time,
          },
        });
      if (job.status === 'complete' || job.status === 'error') {
        const result = await getHistory(connection, character, this.controller.signal);
        if (!this.current(generation)) return;
        const thread = this.snapshot.threads[character];
        const pending = thread.pending;
        const failedText = job.request?.message || pending?.message;
        const accepted = result.messages.find(
          (message) =>
            message.id === `${jobId}-user` || (message.role === 'user' && message.job_id === jobId),
        );
        this.thread(character, {
          messages: mergeMessages(thread.messages, result.messages),
          pending: null,
          nextCursor: thread.olderLoaded ? thread.nextCursor : result.next_cursor,
          ...(job.status === 'error' && failedText
            ? {
                failedMessage: {
                  message: failedText,
                  time: accepted?.time ?? job.request?.time ?? pending?.time ?? null,
                  historyId: accepted?.id,
                  reason: 'reply' as const,
                },
              }
            : {}),
          error: job.status === 'error' ? generationError(job.error?.code) : null,
        });
        return;
      }
      const count = job.status === 'queued' ? queued + 1 : 0;
      const delay = !this.visible
        ? 15_000
        : job.status === 'queued'
          ? Math.min(5000, 1000 * 2 ** Math.min(count - 1, 3))
          : 1000;
      this.schedule(character, jobId, generation, delay, count);
    } catch (error) {
      if (!this.current(generation)) return;
      const pending = this.snapshot.threads[character].pending;
      this.thread(character, {
        pending: pending ? { ...pending, phase: 'failed' } : null,
        error: errorText(error),
      });
      if (authError(error)) await this.failConnection(error);
    } finally {
      if (this.current(generation)) this.polling.delete(character);
    }
  }
}
