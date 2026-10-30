import { ReplyPresentation } from './presentation';
import { displayedMessageTime } from './messageOrder';
import {
  aiCharacters,
  AiRequestError,
  createSession,
  getHealth,
  getHistory,
  getJob,
  generationError,
  messageWithinLimits,
  isRelationshipTone,
  isPhoneEvents,
  isCallEvents,
  postChat,
  postCallFollowup,
  type CallFollowupTrigger,
  type AiRequestKind,
  type AiEpisodeReference,
  type AiCharacter,
  type AiMessage,
  type RelationshipTone,
  type PhoneEventId,
} from './client';
import {
  configuredEndpoint,
  readAiConnection,
  readAiResetId,
  saveAiConnection,
  type AiConnection,
} from './connection';

export interface PendingMessage {
  kind?: AiRequestKind;
  episode?: AiEpisodeReference;
  /** Known from an authenticated episode action before the first job poll returns. */
  episodeOwned?: boolean;
  trigger?: CallFollowupTrigger;
  requestId: string;
  message: string;
  time: string | null;
  jobId: string | null;
  historyId?: string;
  phase: 'submitting' | 'generating' | 'failed';
  relationshipTone: RelationshipTone;
  phoneEvents: PhoneEventId[];
}
export interface AiThread {
  messages: AiMessage[];
  completedCount: number;
  displayedMessages: AiMessage[];
  typing: boolean;
  readRequestIds: string[];
  deliveryPending: boolean;
  proactiveDeliveryPending?: boolean;
  unread: boolean;
  pending: PendingMessage | null;
  failedMessage: {
    message: string;
    time: string | null;
    historyId?: string;
    reason: 'input' | 'reply';
    phoneEvents?: PhoneEventId[];
  } | null;
  loaded: boolean;
  loading: boolean;
  loadingOlder: boolean;
  nextCursor: string | null;
  olderLoaded: boolean;
  error: string | null;
}
export interface AiReplyNotification {
  id: string;
  character: AiCharacter;
  text: string;
}
export interface AiReplyDelivery extends AiReplyNotification {
  jobId?: string;
  playSound: boolean;
  sound: 'conversation' | 'notification';
  deliveredAt?: number;
}
export interface AiReplyArrival extends AiReplyDelivery {
  /** A bounded event journal keeps React-batched deliveries from overwriting each other. */
  deliveries?: AiReplyDelivery[];
  deliveredJobIds?: string[];
}
export function blocksUserInput(
  thread: Pick<AiThread, 'pending' | 'deliveryPending' | 'proactiveDeliveryPending'>,
): boolean {
  return (
    (!!thread.pending &&
      thread.pending.kind !== 'proactive_episode' &&
      !thread.pending.episode &&
      !thread.pending.episodeOwned) ||
    (thread.deliveryPending && !thread.proactiveDeliveryPending)
  );
}
interface AiSnapshot {
  arrival: AiReplyArrival | null;
  notification: AiReplyNotification | null;
  unreadReplies: AiReplyNotification[];
  connection: AiConnection | null;
  status: 'idle' | 'checking' | 'ready' | 'loading' | 'error';
  error: string | null;
  storageUnavailable: boolean;
  storageError: string | null;
  threads: Record<AiCharacter, AiThread>;
}
const emptyThread = (): AiThread => ({
  messages: [],
  completedCount: 0,
  displayedMessages: [],
  typing: false,
  readRequestIds: [],
  deliveryPending: false,
  unread: false,
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

function knownCompletedCount(messages: AiMessage[]): number {
  return messages.filter(
    (message) =>
      message.role === 'user' &&
      !isCallEvents(message.phone_events) &&
      (message.status === undefined || message.status === 'complete'),
  ).length;
}

/** A single Messages instance owns requests. Switching contacts never changes their owner. */
export class AiMessenger {
  private snapshot: AiSnapshot;
  private presentation = new ReplyPresentation();
  private presentationTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private controller = new AbortController();
  private generation = 0;
  private timers = new Map<AiCharacter, ReturnType<typeof setTimeout>>();
  private polling = new Set<string>();
  private episodesProtocol = false;
  private online = true;
  private visible = true;
  private activeCharacter: AiCharacter | null = null;
  private refreshTask: Promise<void> | null = null;
  private renewed = false;
  private resetId = readAiResetId();
  private notificationQueue: AiReplyNotification[] = [];
  private deliveries: AiReplyDelivery[] = [];
  private backgroundCharacters = new Set<AiCharacter>();
  private followupSubmissions = new Map<string, Promise<boolean>>();

  constructor(connection = readAiConnection()) {
    this.presentation.use(connection);
    this.snapshot = {
      arrival: null,
      notification: null,
      unreadReplies: [],
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
    const thread = { ...this.snapshot.threads[character], ...update };
    this.snapshot = {
      ...this.snapshot,
      threads: { ...this.snapshot.threads, [character]: thread },
    };
    this.presentation.observe(character, thread.messages);
    this.present();
  }
  private present(): void {
    if (this.resetId !== readAiResetId()) return;
    if (this.presentationTimer) clearTimeout(this.presentationTimer);
    this.presentationTimer = null;
    const now = Date.now();
    let next = Infinity;
    let notification = this.snapshot.notification;
    let arrival = this.snapshot.arrival;
    let delivered = false;
    for (const receipt of this.presentation.receipts) {
      const callReply = this.snapshot.threads[receipt.character].messages.find(
        (m) => m.id === receipt.replyId,
      );
      if (isCallEvents(callReply?.phone_events)) receipt.read = true;
      if (receipt.delivered || !receipt.replyId || now < receipt.deliverAt) continue;
      receipt.delivered = true;
      receipt.read =
        isCallEvents(callReply?.phone_events) ||
        (this.visible && this.activeCharacter === receipt.character);
      const reply = this.snapshot.threads[receipt.character].messages.find(
        (m) => m.id === receipt.replyId,
      );
      if (reply && !isCallEvents(reply.phone_events)) {
        arrival = {
          id: reply.id,
          character: receipt.character,
          text: reply.content,
          jobId: receipt.jobId,
          // A suspended page/history catch-up is visual recovery, not a new tone.
          playSound: this.visible && now - receipt.deliverAt < 2000,
          sound: receipt.read ? 'conversation' : 'notification',
          deliveredAt: now,
        };
        delivered = true;
        this.deliveries = [...this.deliveries, arrival].slice(-64);
        if (!receipt.read) this.notificationQueue.push(arrival);
      }
    }
    if (delivered && arrival)
      arrival = {
        ...arrival,
        deliveries: this.deliveries,
        deliveredJobIds: this.deliveries.flatMap((item) => (item.jobId ? [item.jobId] : [])),
      };
    notification ??= this.notificationQueue.shift() ?? null;
    const threads = { ...this.snapshot.threads };
    const unreadReplies: AiReplyNotification[] = [];
    for (const character of aiCharacters) {
      const receipts = this.presentation.receipts.filter((r) => r.character === character);
      const waiting = receipts.filter((r) => !r.delivered);
      const thread = threads[character];
      for (const receipt of waiting) {
        if (now < receipt.typingAt) next = Math.min(next, receipt.typingAt);
        if (receipt.replyId && now < receipt.deliverAt) next = Math.min(next, receipt.deliverAt);
      }
      for (const receipt of receipts.filter((r) => r.delivered && !r.read)) {
        const reply = thread.messages.find((m) => m.id === receipt.replyId);
        if (reply) unreadReplies.push({ id: reply.id, character, text: reply.content });
      }
      threads[character] = {
        ...thread,
        displayedMessages: thread.messages
          .filter((message) => !waiting.some((receipt) => receipt.replyId === message.id))
          .map((message) => ({
            ...message,
            displayedAt: displayedMessageTime(
              message,
              receipts.find((receipt) =>
                message.role === 'assistant'
                  ? receipt.replyId === message.id ||
                    (!!message.request_id && receipt.requestId === message.request_id)
                  : !!message.request_id && receipt.requestId === message.request_id,
              ),
            ),
          })),
        readRequestIds: receipts
          .filter(
            (r) =>
              !r.fast &&
              now >= r.typingAt &&
              (r.replyId || thread.pending?.requestId === r.requestId),
          )
          .map((r) => r.requestId),
        typing:
          waiting.some(
            (r) =>
              !r.fast &&
              now >= r.typingAt &&
              (r.replyId || thread.pending?.requestId === r.requestId),
          ) && thread.pending?.phase !== 'failed',
        deliveryPending: waiting.some((r) => !!r.replyId),
        proactiveDeliveryPending:
          waiting.some((r) => !!r.replyId) &&
          waiting.filter((r) => !!r.replyId).every((r) => r.unsolicited),
        unread: receipts.some((r) => r.delivered && !r.read),
      };
    }
    this.presentation.save();
    this.update({ threads, unreadReplies, notification, arrival });
    if (next !== Infinity)
      this.presentationTimer = setTimeout(() => this.present(), Math.max(0, next - now));
  }

  markRead = (character: AiCharacter): void => {
    this.notificationQueue = this.notificationQueue.filter((item) => item.character !== character);
    for (const receipt of this.presentation.receipts)
      if (receipt.character === character && receipt.delivered) receipt.read = true;
    if (this.snapshot.notification?.character === character)
      this.snapshot = { ...this.snapshot, notification: null };
    this.present();
  };
  dismissNotification = (): void => {
    this.update({ notification: this.notificationQueue.shift() ?? null });
  };
  receivePush = async (character: AiCharacter): Promise<boolean> => {
    if (
      !this.snapshot.connection ||
      !this.online ||
      !this.presentation.receipts.some((r) => r.character === character && !r.delivered)
    )
      return false;
    const generation = this.generation;
    try {
      await this.loadThread(character, generation);
      return this.current(generation);
    } catch {
      return false;
    }
  };
  resume = (): void => {
    if (this.snapshot.connection && this.presentation.receipts.some((r) => !r.read))
      void this.refresh();
  };

  stop = (): void => {
    this.generation += 1;
    this.refreshTask = null;
    this.controller.abort();
    this.controller = new AbortController();
    if (this.presentationTimer) clearTimeout(this.presentationTimer);
    this.presentationTimer = null;
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
    const connection = readAiConnection();
    this.presentation.use(connection);
    this.notificationQueue = [];
    this.deliveries = [];
    this.update({
      connection,
      threads: emptyThreads(),
      arrival: null,
      notification: null,
      unreadReplies: [],
      error: null,
    });
    if (resume && this.activeCharacter) void this.refresh();
  };

  activate = async (character: AiCharacter | null): Promise<void> => {
    this.activeCharacter = character;
    if (character && this.visible) this.markRead(character);
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
    } else if (this.activeCharacter || this.presentation.receipts.some((r) => !r.read))
      void this.refresh();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (visible && this.activeCharacter) this.markRead(this.activeCharacter);
    if (
      visible &&
      this.online &&
      aiCharacters.some((id) => this.snapshot.threads[id].pending?.phase === 'failed')
    ) {
      void this.refresh();
      return;
    }
    for (const character of aiCharacters) {
      const pending = this.snapshot.threads[character].pending;
      if (!pending?.jobId || pending.phase === 'failed' || this.polling.has(pending.jobId))
        continue;
      const timer = this.timers.get(character);
      if (timer) clearTimeout(timer);
      this.timers.delete(character);
      this.schedule(character, pending.jobId, this.generation, visible ? 0 : 15_000, 0);
    }
  }

  private remember(connection: AiConnection): void {
    if (this.resetId !== readAiResetId()) return;
    const saved = saveAiConnection(connection, this.resetId);
    this.presentation.use(connection);
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
    if (
      !this.online ||
      (!this.activeCharacter &&
        !this.backgroundCharacters.size &&
        !this.presentation.receipts.some((r) => !r.read))
    )
      return Promise.resolve();
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
            this.notificationQueue = [];
            this.deliveries = [];
            this.update({
              connection: null,
              threads,
              notification: null,
              arrival: null,
              unreadReplies: [],
            });
            saveAiConnection(null, this.resetId);
          }
          if (!this.snapshot.connection) {
            await this.connect(endpoint, generation);
            if (!this.current(generation)) return;
          }
          const targets = aiCharacters.filter(
            (character) =>
              character === this.activeCharacter ||
              this.backgroundCharacters.has(character) ||
              this.snapshot.threads[character].pending ||
              this.presentation.receipts.some((r) => r.character === character && !r.read),
          );
          for (const character of targets) {
            if (!this.current(generation)) return;
            await this.loadThread(character, generation);
          }
          if (!this.current(generation)) return;
          if (this.snapshot.connection) this.remember(this.snapshot.connection);
          this.update({
            status,
            error:
              status === 'loading'
                ? '답장을 준비하고 있습니다. 잠시 후 다시 시도해 주세요.'
                : status === 'error'
                  ? '지금은 답장을 받을 수 없습니다. 잠시 후 다시 시도해 주세요.'
                  : null,
          });
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
    const initialPending = this.snapshot.threads[character].pending;
    this.thread(character, { loading: true, error: null });
    try {
      const result = await getHistory(
        connection,
        character,
        this.controller.signal,
        undefined,
        this.episodesProtocol,
      );
      if (!this.current(generation)) return;
      const thread = this.snapshot.threads[character];
      if (thread.pending !== initialPending) {
        this.thread(character, { loading: false });
        return;
      }
      const existing = thread.pending;
      const accepted = result.messages.find(
        (message) =>
          (message.role === 'user' ||
            message.request_kind === 'call_followup' ||
            message.request_kind === 'proactive_episode') &&
          ((existing?.requestId && message.request_id === existing.requestId) ||
            (result.pending_job && message.job_id === result.pending_job)),
      );
      const resolved =
        accepted && !['queued', 'generating'].includes(accepted.status ?? 'complete');
      const pending = result.pending_job
        ? {
            requestId: accepted?.request_id ?? existing?.requestId ?? '',
            message:
              accepted?.request_kind === 'call_followup' ||
              accepted?.request_kind === 'proactive_episode'
                ? ''
                : (accepted?.content ?? existing?.message ?? ''),
            kind: accepted?.request_kind ?? existing?.kind,
            episode: existing?.episode,
            episodeOwned: existing?.episodeOwned,
            trigger: existing?.trigger,
            time: accepted?.time ?? existing?.time ?? null,
            jobId: result.pending_job,
            historyId: accepted?.id,
            phase: 'generating' as const,
            relationshipTone:
              accepted?.relationship_tone ?? existing?.relationshipTone ?? 'neutral',
            phoneEvents: [...(accepted?.phone_events ?? existing?.phoneEvents ?? [])],
          }
        : resolved
          ? null
          : existing;
      if (pending?.requestId) {
        const started = pending.time ? Date.parse(pending.time) : Date.now();
        this.presentation.begin(
          character,
          pending.requestId,
          Number.isFinite(started) ? started : Date.now(),
          pending.kind === 'call_followup',
          pending.kind === 'proactive_episode' || !!pending.episode || !!pending.episodeOwned,
        );
      }
      this.thread(character, {
        messages: mergeMessages(thread.messages, result.messages),
        completedCount: Math.max(
          thread.completedCount,
          result.completed_exchanges ??
            knownCompletedCount(mergeMessages(thread.messages, result.messages)),
        ),
        loaded: true,
        loading: false,
        nextCursor: thread.olderLoaded ? thread.nextCursor : result.next_cursor,
        pending,
        ...(resolved &&
        accepted.status !== 'complete' &&
        accepted.request_kind !== 'call_followup' &&
        accepted.request_kind !== 'proactive_episode'
          ? {
              failedMessage: {
                message: accepted.content,
                time: accepted.time,
                historyId: accepted.id,
                reason: 'reply' as const,
                phoneEvents: [...(accepted?.phone_events ?? pending?.phoneEvents ?? [])],
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
        this.episodesProtocol,
      );
      if (!this.current(generation)) return;
      this.thread(character, {
        messages: mergeMessages(result.messages, this.snapshot.threads[character].messages),
        completedCount: Math.max(
          this.snapshot.threads[character].completedCount,
          result.completed_exchanges ?? this.snapshot.threads[character].completedCount,
        ),
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

  send(
    character: AiCharacter,
    text: string,
    active: boolean,
    online: boolean,
    options: { relationshipTone?: RelationshipTone; phoneEvents?: readonly PhoneEventId[] } = {},
  ): boolean {
    const thread = this.snapshot.threads[character];
    const message = text.trim();
    const relationshipTone = options.relationshipTone ?? 'neutral';
    const phoneEvents = options.phoneEvents === undefined ? [] : options.phoneEvents;
    if (
      !active ||
      !online ||
      !this.online ||
      !this.current(this.generation) ||
      !message ||
      !messageWithinLimits(message) ||
      !isRelationshipTone(relationshipTone) ||
      !isPhoneEvents(character, phoneEvents) ||
      this.snapshot.status !== 'ready' ||
      !thread.loaded ||
      thread.loading ||
      blocksUserInput(thread)
    )
      return false;
    if (
      thread.pending &&
      (thread.pending.kind === 'proactive_episode' ||
        thread.pending.episode ||
        thread.pending.episodeOwned)
    )
      this.presentation.settleBeforeInput(thread.pending.requestId);
    for (const receipt of [...this.presentation.receipts])
      if (receipt.character === character && receipt.unsolicited && !receipt.delivered)
        this.presentation.settleBeforeInput(receipt.requestId);
    const oldTimer = this.timers.get(character);
    if (oldTimer) clearTimeout(oldTimer);
    this.timers.delete(character);
    const pending: PendingMessage = {
      requestId: crypto.randomUUID(),
      message,
      time: new Date().toISOString(),
      jobId: null,
      phase: 'submitting',
      relationshipTone,
      phoneEvents: [...phoneEvents],
    };
    this.presentation.begin(character, pending.requestId);
    this.thread(character, { pending, error: null });
    void this.submit(character, pending, this.generation);
    return true;
  }

  /** App event only. Never invent or persist a user message for this request. */
  followUp(
    character: AiCharacter,
    requestId: string,
    trigger: CallFollowupTrigger,
    relationshipTone: RelationshipTone,
  ): Promise<boolean> {
    const existing = this.followupSubmissions.get(requestId);
    if (existing) return existing;
    const task = this.submitFollowup(character, requestId, trigger, relationshipTone).finally(
      () => {
        this.followupSubmissions.delete(requestId);
        this.backgroundCharacters.delete(character);
      },
    );
    this.followupSubmissions.set(requestId, task);
    return task;
  }

  private async submitFollowup(
    character: AiCharacter,
    requestId: string,
    trigger: CallFollowupTrigger,
    relationshipTone: RelationshipTone,
  ): Promise<boolean> {
    if (!this.online) return false;
    this.backgroundCharacters.add(character);
    if (this.snapshot.status !== 'ready') await this.refresh();
    const generation = this.generation;
    if (!this.current(generation) || this.snapshot.status !== 'ready') return false;
    if (!this.snapshot.threads[character].loaded) {
      try {
        await this.loadThread(character, generation);
      } catch {
        return false;
      }
    }
    if (!this.current(generation)) return false;
    const earlier = this.snapshot.threads[character].pending;
    // A lost status response must not hold an accepted job forever. Read its
    // existing result before admitting the next event; never generate it again.
    if (earlier?.phase === 'failed' && earlier.jobId) {
      await this.poll(character, earlier.jobId, generation, 0);
      if (!this.current(generation)) return false;
    }
    const thread = this.snapshot.threads[character];
    if (thread.pending) {
      if (thread.pending.requestId !== requestId) return false;
      if (thread.pending.jobId) return true;
      if (thread.pending.phase !== 'failed') return false;
      return this.submit(character, thread.pending, generation);
    }
    if (thread.loading || thread.deliveryPending) return false;
    const pending: PendingMessage = {
      kind: 'call_followup',
      trigger,
      requestId,
      message: '',
      time: new Date().toISOString(),
      jobId: null,
      phase: 'submitting',
      relationshipTone,
      phoneEvents: [],
    };
    this.presentation.begin(character, requestId, Date.now(), true);
    this.thread(character, { pending, error: null });
    return this.submit(character, pending, generation);
  }

  /** Establish a background session without marking the conversation read. */
  prepareEpisodes = async (): Promise<AiConnection | null> => {
    if (!this.online) return null;
    this.episodesProtocol = true;
    this.backgroundCharacters.add('majima');
    if (this.snapshot.status !== 'ready') await this.refresh();
    return this.snapshot.status === 'ready' ? this.snapshot.connection : null;
  };

  setEpisodeProtocol(enabled: boolean): void {
    if (this.episodesProtocol === enabled) return;
    this.episodesProtocol = enabled;
    if (!enabled) this.backgroundCharacters.delete('majima');
    else if (this.snapshot.status === 'ready' && this.snapshot.threads.majima.loaded) {
      // Restore old assistant-only invitations even when the feature has since been disabled.
      const generation = this.generation;
      void this.loadThread('majima', generation).catch((error: unknown) => {
        if (this.current(generation)) void this.failConnection(error);
      });
    }
  }

  episodeDelivered(jobId: string): boolean {
    return this.presentation.receipts.some(
      (receipt) => receipt.jobId === jobId && receipt.delivered,
    );
  }

  /** Adopt a server-owned assistant-only request, never submit a synthetic user turn. */
  watchEpisodeJob = async (jobId: string): Promise<void> => {
    const generation = this.generation;
    if (!this.current(generation) || !this.snapshot.connection) return;
    const thread = this.snapshot.threads.majima;
    if (thread.pending && thread.pending.jobId !== jobId) return;
    if (thread.pending?.jobId === jobId || this.episodeDelivered(jobId)) return;
    this.episodesProtocol = true;
    this.thread('majima', {
      loaded: true,
      pending: {
        kind: 'proactive_episode',
        episodeOwned: true,
        requestId: '',
        message: '',
        time: null,
        jobId,
        phase: 'generating',
        relationshipTone: 'neutral',
        phoneEvents: [],
      },
      error: null,
    });
    await this.poll('majima', jobId, generation, 0);
  };

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
  ): Promise<boolean> {
    const connection = this.snapshot.connection;
    if (!connection) return false;
    try {
      const jobId =
        pending.kind === 'call_followup' && pending.trigger
          ? await postCallFollowup(
              connection,
              character,
              pending.requestId,
              pending.trigger,
              pending.relationshipTone,
              this.controller.signal,
            )
          : await postChat(
              connection,
              character,
              pending.message,
              pending.requestId,
              this.controller.signal,
              pending.relationshipTone,
              pending.phoneEvents,
            );
      if (
        !this.current(generation) ||
        this.snapshot.threads[character].pending?.requestId !== pending.requestId
      )
        return false;
      this.thread(character, { pending: { ...pending, jobId, phase: 'generating' } });
      void this.poll(character, jobId, generation, 0);
      return true;
    } catch (error) {
      if (
        !this.current(generation) ||
        this.snapshot.threads[character].pending?.requestId !== pending.requestId
      )
        return false;
      if (
        pending.kind === 'call_followup' &&
        error instanceof AiRequestError &&
        error.code === 'busy'
      ) {
        this.presentation.cancel(pending.requestId);
        this.thread(character, { pending: null, error: null });
        try {
          await this.loadThread(character, generation);
        } catch {
          /* Durable event will retry. */
        }
        return false;
      }
      if (
        error instanceof AiRequestError &&
        ['invalid_input', 'input_limit', 'content_blocked'].includes(error.code)
      ) {
        this.presentation.cancel(pending.requestId);
        this.thread(character, {
          pending: null,
          failedMessage:
            pending.kind === 'call_followup'
              ? null
              : {
                  message: pending.message,
                  time: pending.time,
                  reason: 'input',
                  phoneEvents: [...pending.phoneEvents],
                },
          error: errorText(error),
        });
      } else {
        this.thread(character, {
          pending: { ...pending, phase: 'failed' },
          error: errorText(error),
        });
        if (authError(error)) await this.failConnection(error);
      }
      return false;
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
    if (!connection || !this.current(generation) || this.polling.has(jobId)) return;
    if (this.snapshot.threads[character].pending?.jobId !== jobId) return;
    this.polling.add(jobId);
    try {
      const job = await getJob(
        connection,
        jobId,
        character,
        this.controller.signal,
        this.episodesProtocol,
      );
      if (!this.current(generation) || this.snapshot.threads[character].pending?.jobId !== jobId)
        return;
      const previous = this.snapshot.threads[character].pending;
      if (job.request?.kind === 'call_followup' || job.request?.kind === 'proactive_episode') {
        if (previous?.requestId && previous.requestId !== job.request.id)
          this.presentation.cancel(previous.requestId);
        this.presentation.begin(
          character,
          job.request.id,
          Date.now(),
          job.request.kind === 'call_followup',
          job.request.kind === 'proactive_episode' ||
            !!job.request.episode ||
            !!job.episode ||
            !!previous?.episodeOwned,
        );
      }
      if (job.request && previous?.jobId === jobId)
        this.thread(character, {
          pending: {
            ...previous,
            requestId: job.request.id,
            message: job.request.message ?? '',
            kind: job.request.kind,
            episode: job.request.episode ?? job.episode ?? previous.episode,
            episodeOwned: !!job.request.episode || !!job.episode || previous.episodeOwned,
            trigger: job.request.trigger,
            time: job.request.time,
            relationshipTone: job.request.relationship_tone ?? previous.relationshipTone,
            phoneEvents: [...(job.request.phone_events ?? previous.phoneEvents)],
          },
        });
      if (job.status === 'complete' || job.status === 'error') {
        const result = await getHistory(
          connection,
          character,
          this.controller.signal,
          undefined,
          this.episodesProtocol,
        );
        if (!this.current(generation) || this.snapshot.threads[character].pending?.jobId !== jobId)
          return;
        const thread = this.snapshot.threads[character];
        const pending = thread.pending;
        const failedText = job.request?.message || pending?.message;
        const accepted = result.messages.find(
          (message) =>
            message.id === `${jobId}-user` || (message.role === 'user' && message.job_id === jobId),
        );
        if (job.status === 'error' && pending) this.presentation.cancel(pending.requestId);
        this.thread(character, {
          messages: mergeMessages(thread.messages, result.messages),
          completedCount: Math.max(
            thread.completedCount,
            result.completed_exchanges ??
              knownCompletedCount(mergeMessages(thread.messages, result.messages)),
          ),
          pending: null,
          nextCursor: thread.olderLoaded ? thread.nextCursor : result.next_cursor,
          ...(job.status === 'error' && failedText
            ? {
                failedMessage: {
                  message: failedText,
                  time: accepted?.time ?? job.request?.time ?? pending?.time ?? null,
                  historyId: accepted?.id,
                  reason: 'reply' as const,
                  phoneEvents: [...(accepted?.phone_events ?? pending?.phoneEvents ?? [])],
                },
              }
            : {}),
          error:
            job.status === 'error' &&
            !['episode_superseded', 'episode_inactive'].includes(job.error?.code ?? '')
              ? generationError(job.error?.code)
              : null,
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
      if (!this.current(generation) || this.snapshot.threads[character].pending?.jobId !== jobId)
        return;
      const pending = this.snapshot.threads[character].pending;
      this.thread(character, {
        pending: pending ? { ...pending, phase: 'failed' } : null,
        error: errorText(error),
      });
      if (authError(error)) await this.failConnection(error);
    } finally {
      if (this.current(generation)) this.polling.delete(jobId);
    }
  }
}
