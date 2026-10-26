/** Apple's Note recording, decoded locally; provenance: docs/reply-notifications.md. */
const loadNote = async (context: AudioContext): Promise<AudioBuffer> => {
  const response = await fetch(`${import.meta.env.BASE_URL}audio/iphone-note.wav`);
  if (!response.ok) throw new Error('Message tone unavailable');
  return context.decodeAudioData(await response.arrayBuffer());
};

export class ReplySoundPlayer {
  private context: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private loading: Promise<void> | null = null;
  private consumed = new Set<string>();
  private playing = new Set<() => void>();

  constructor(
    private create: () => AudioContext = () => new AudioContext(),
    private load: (context: AudioContext) => Promise<AudioBuffer> = loadNote,
  ) {}

  unlock(): void {
    try {
      if (!this.context) {
        const context = this.create();
        this.context = context;
        context.onstatechange = () => {
          if (context.state !== 'running') this.interrupt();
        };
      }
      const context = this.context;
      if (!this.buffer && !this.loading) {
        this.loading = this.load(context)
          .then(
            (buffer) => {
              if (this.context === context) this.buffer = buffer;
            },
            () => {},
          )
          .finally(() => {
            if (this.context === context) this.loading = null;
          });
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

  ready(signal: AbortSignal): Promise<boolean> {
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
            !!this.buffer,
        );
      };
      const cancelled = () => finish(false);
      const timer = setTimeout(() => finish(false), 1000);
      signal.addEventListener('abort', cancelled, { once: true });
      try {
        const resumed = context.state === 'running' ? Promise.resolve() : context.resume();
        void Promise.all([resumed, this.loading]).then(
          () => finish(true),
          () => finish(false),
        );
      } catch {
        finish(false);
      }
    });
  }

  play(id: string, silent: boolean, volume: number, visible: boolean): boolean {
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
      !this.buffer
    )
      return false;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = this.buffer;
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
    const expiry = setTimeout(stop, this.buffer.duration * 1000 + 100);
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
    this.buffer = null;
    this.loading = null;
  }
}
