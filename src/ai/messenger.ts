import {
  aiCharacters,
  AiRequestError,
  getHealth,
  getHistory,
  getJob,
  generationError,
  messageWithinLimits,
  postChat,
  type AiCharacter,
  type AiMessage,
} from './client';
import { readAiConnection, saveAiConnection, type AiConnection } from './connection';

export interface PendingMessage {
  requestId: string;
  message: string;
  time: string;
  jobId: string | null;
  historyId?: string;
  phase: 'submitting' | 'generating' | 'failed';
}
export interface AiThread {
  messages: AiMessage[];
  pending: PendingMessage | null;
  failedMessage: {
    message: string;
    time: string;
    historyId?: string;
    reason: 'input' | 'reply';
  } | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
}
interface AiSnapshot {
  connection: AiConnection | null;
  status: 'disconnected' | 'checking' | 'ready' | 'loading' | 'error';
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
  error: null,
});
const emptyThreads = () => ({ haruka: emptyThread(), majima: emptyThread() });
const errorText = (error: unknown) =>
  error instanceof AiRequestError
    ? error.message
    : 'Mac에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.';

/** One Messages mount owns its requests; changing the selected contact never changes their owner. */
export class AiMessenger {
  private snapshot: AiSnapshot;
  private listeners = new Set<() => void>();
  private controller = new AbortController();
  private generation = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private online = true;

  constructor(connection = readAiConnection()) {
    this.snapshot = {
      connection,
      status: connection ? 'checking' : 'disconnected',
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
    this.controller.abort();
    this.controller = new AbortController();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  };
  private current(generation: number): boolean {
    return this.generation === generation && this.online && !!this.snapshot.connection;
  }

  setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    if (!online) {
      this.stop();
      for (const character of aiCharacters) {
        const pending = this.snapshot.threads[character].pending;
        this.thread(character, {
          loading: false,
          ...(pending ? { pending: { ...pending, phase: 'failed' } } : {}),
        });
      }
    } else {
      void this.refresh();
    }
  }

  connect(connection: AiConnection): void {
    this.stop();
    const saved = saveAiConnection(connection);
    this.update({
      connection,
      threads: emptyThreads(),
      error: null,
      storageUnavailable: !saved,
      storageError: saved ? null : 'Mac 접속 정보를 저장할 수 없어 현재 화면에서만 연결됩니다.',
    });
    void this.refresh();
  }

  disconnect = (): void => {
    this.stop();
    const removed = saveAiConnection(null);
    this.update({
      connection: null,
      status: 'disconnected',
      error: null,
      threads: emptyThreads(),
      storageUnavailable: !removed,
      storageError: removed
        ? null
        : '연결은 해제했지만 저장된 접속 정보를 지우지 못했습니다. 브라우저의 사이트 데이터를 삭제해 주세요.',
    });
  };

  refresh = async (): Promise<void> => {
    const connection = this.snapshot.connection;
    if (!connection || !this.online) return;
    this.stop();
    const generation = this.generation;
    for (const character of aiCharacters) {
      const pending = this.snapshot.threads[character].pending;
      if (pending) this.thread(character, { pending: { ...pending, phase: 'failed' } });
    }
    this.update({ status: 'checking', error: null });
    try {
      const status = await getHealth(connection.endpoint, this.controller.signal);
      if (!this.current(generation)) return;
      this.update({
        status,
        error:
          status === 'loading'
            ? 'Mac에서 모델을 불러오는 중입니다.'
            : status === 'error'
              ? 'Mac의 모델을 사용할 수 없습니다. 서버 상태를 확인해 주세요.'
              : null,
      });
      if (status !== 'ready') return;
      await Promise.all(aiCharacters.map((character) => this.loadThread(character, generation)));
    } catch (error) {
      if (this.current(generation)) this.update({ status: 'error', error: errorText(error) });
    }
  };

  private async loadThread(character: AiCharacter, generation: number): Promise<void> {
    const connection = this.snapshot.connection;
    if (!connection) return;
    this.thread(character, { loading: true, error: null });
    try {
      const result = await getHistory(connection, character, this.controller.signal);
      if (!this.current(generation)) return;
      const existing = this.snapshot.threads[character].pending;
      const historyId = result.messages.find(
        (message) => message.id === `${result.pending_job}-user`,
      )?.id;
      const pending = result.pending_job
        ? {
            requestId: existing?.requestId ?? '',
            message: existing?.message ?? '',
            time: existing?.time ?? '',
            jobId: result.pending_job,
            historyId,
            phase: 'generating' as const,
          }
        : existing;
      this.thread(character, {
        messages: result.messages,
        loaded: true,
        loading: false,
        pending,
      });
      if (pending?.jobId) void this.poll(character, pending.jobId, generation);
    } catch (error) {
      if (this.current(generation))
        this.thread(character, { loaded: false, loading: false, error: errorText(error) });
    }
  }

  send(character: AiCharacter, text: string, active: boolean, online: boolean): boolean {
    const thread = this.snapshot.threads[character];
    const message = text.trim();
    if (
      !active ||
      !online ||
      !this.online ||
      !message ||
      !messageWithinLimits(message) ||
      this.snapshot.status !== 'ready' ||
      !thread.loaded ||
      thread.loading ||
      thread.pending
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
      this.snapshot.status !== 'ready' ||
      !pending ||
      pending.phase !== 'failed'
    )
      return;
    this.thread(character, {
      pending: { ...pending, phase: pending.jobId ? 'generating' : 'submitting' },
      error: null,
    });
    if (pending.jobId) void this.poll(character, pending.jobId, this.generation);
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
      void this.poll(character, jobId, generation);
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
      }
    }
  }

  private async poll(character: AiCharacter, jobId: string, generation: number): Promise<void> {
    const connection = this.snapshot.connection;
    if (!connection || !this.current(generation)) return;
    try {
      const job = await getJob(connection, jobId, character, this.controller.signal);
      if (!this.current(generation)) return;
      const previousPending = this.snapshot.threads[character].pending;
      if (job.request && previousPending?.jobId === jobId) {
        this.thread(character, {
          pending: {
            ...previousPending,
            requestId: job.request.id,
            message: job.request.message,
            time: job.request.time,
          },
        });
      }
      if (job.status === 'complete' || job.status === 'error') {
        const result = job.messages
          ? { messages: job.messages }
          : await getHistory(connection, character, this.controller.signal);
        if (!this.current(generation)) return;
        const pending = this.snapshot.threads[character].pending;
        const failedText = job.request?.message || pending?.message;
        const historyMessage = result.messages.find((message) => message.id === `${jobId}-user`);
        this.thread(character, {
          messages: result.messages,
          pending: null,
          ...(job.status === 'error' && failedText
            ? {
                failedMessage: {
                  message: failedText,
                  time: historyMessage?.time || pending?.time || new Date().toISOString(),
                  historyId: historyMessage?.id,
                  reason: 'reply' as const,
                },
              }
            : {}),
          error: job.status === 'error' ? generationError(job.error?.code) : null,
        });
        return;
      }
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        void this.poll(character, jobId, generation);
      }, 750);
      this.timers.add(timer);
    } catch (error) {
      if (!this.current(generation)) return;
      const pending = this.snapshot.threads[character].pending;
      this.thread(character, {
        pending: pending ? { ...pending, phase: 'failed' } : null,
        error: errorText(error),
      });
    }
  }
}
