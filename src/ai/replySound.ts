export type ReplySoundKind = 'notification' | 'conversation';
export const MESSAGE_SENT_SOUND = 'kiryu:message-sent';
/** Dispatch only after a valid, non-duplicate local send is accepted. */
export function messageSentSound(): void {
  window.dispatchEvent(new Event(MESSAGE_SENT_SOUND));
}
const soundFiles = { notification: 'iphone-note.wav', conversation: 'iphone-received-message.wav' };
/** Apple system recordings; provenance: docs/reply-notifications.md. */
const loadTone = async (context: AudioContext, kind: ReplySoundKind): Promise<AudioBuffer> => {
  const response = await fetch(`${import.meta.env.BASE_URL}audio/${soundFiles[kind]}`);
  if (!response.ok) throw new Error('Message tone unavailable');
  return context.decodeAudioData(await response.arrayBuffer());
};

export class ReplySoundPlayer {
  private context: AudioContext | null = null;
  private buffers: Partial<Record<ReplySoundKind, AudioBuffer>> = {};
  private loading: Partial<Record<ReplySoundKind, Promise<void>>> = {};
  private consumed = new Set<string>();
  private playing = new Set<() => void>();

  constructor(
    private create: () => AudioContext = () => new AudioContext(),
    private load: (context: AudioContext, kind: ReplySoundKind) => Promise<AudioBuffer> = loadTone,
  ) {}

  unlock(): void {
    try {
      // Notification pings may mix with music. Avoid a permanent exclusive
      // playback session, which can interrupt another app's media.
      try {
        const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
        if (session && (session.type === 'auto' || session.type === 'ambient'))
          session.type = 'transient';
      } catch {
        /* Optional API: unsupported types must not prevent audio unlock. */
      }
      if (!this.context) {
        const context = this.create();
        this.context = context;
        context.onstatechange = () => {
          if (context.state !== 'running') this.interrupt();
        };
      }
      const context = this.context;
      for (const kind of ['notification', 'conversation'] as const) {
        if (!this.buffers[kind] && !this.loading[kind]) {
          this.loading[kind] = this.load(context, kind)
            .then(
              (buffer) => {
                if (this.context === context) this.buffers[kind] = buffer;
              },
              () => {},
            )
            .finally(() => {
              if (this.context === context) delete this.loading[kind];
            });
        }
      }
      if (this.context.state !== 'running') {
        // A later tap may unlock audio, but must never resume an old message tone.
        this.interrupt();
        void this.context.resume().catch(() => {});
      }
    } catch {
      /* Visual delivery remains available without audio support or permission. */
    }
  }

  /** Discard sources on interruption, hiding, or expiry; audio time can freeze. */
  interrupt(): void {
    for (const stop of [...this.playing]) stop();
  }

  ready(signal: AbortSignal, kind: ReplySoundKind = 'notification'): Promise<boolean> {
    const context = this.context;
    if (signal.aborted || !context || context.state === 'closed') return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', cancelled);
        resolve(
          ready &&
            !signal.aborted &&
            this.context === context &&
            context.state === 'running' &&
            !!this.buffers[kind],
        );
      };
      const cancelled = () => finish(false);
      const timer = setTimeout(() => finish(false), 1000);
      signal.addEventListener('abort', cancelled, { once: true });
      try {
        const resumed = context.state === 'running' ? Promise.resolve() : context.resume();
        void Promise.all([resumed, this.loading[kind]]).then(
          () => finish(true),
          () => finish(false),
        );
      } catch {
        finish(false);
      }
    });
  }

  play(
    id: string,
    silent: boolean,
    volume: number,
    visible: boolean,
    kind: ReplySoundKind = 'notification',
  ): boolean {
    if (this.consumed.has(id)) return false;
    this.consumed.add(id);
    if (this.consumed.size > 200) this.consumed.delete(this.consumed.values().next().value!);
    const context = this.context;
    if (
      silent ||
      !visible ||
      volume <= 0 ||
      !context ||
      context.state !== 'running' ||
      !this.buffers[kind]
    )
      return false;
    const buffer = this.buffers[kind]!;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.min(1, Math.max(0, volume / 100));
    source.connect(gain).connect(context.destination);
    const stop = () => {
      clearTimeout(expiry);
      this.playing.delete(stop);
      source.onended = null;
      source.stop();
      source.disconnect();
      gain.disconnect();
    };
    // This uses wall time rather than AudioContext time, which pauses on iOS.
    const expiry = setTimeout(stop, buffer.duration * 1000 + 100);
    this.playing.add(stop);
    source.onended = stop;
    source.start();
    return true;
  }

  dispose(): void {
    this.interrupt();
    if (this.context) this.context.onstatechange = null;
    void this.context?.close().catch(() => {});
    this.context = null;
    this.buffers = {};
    this.loading = {};
  }
}
