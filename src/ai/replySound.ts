/** A synthesized D4–A4–D5 chime, informed by the classic iPhone Tri-Tone.
 * No Apple recording is copied. Timbre is an approximation; provenance: docs/reply-notifications.md.
 */
export class ReplySoundPlayer {
  private context: AudioContext | null = null;
  private consumed = new Set<string>();

  constructor(private create: () => AudioContext = () => new AudioContext()) {}

  unlock(): void {
    try {
      this.context ??= this.create();
      if (this.context.state !== 'running') void this.context.resume().catch(() => {});
    } catch {
      /* Visual delivery remains available without audio support or permission. */
    }
  }

  /** Retry only an already gesture-created context for this fresh arrival.
   * A browser interruption may resolve asynchronously or never resolve at all.
   */
  ready(signal: AbortSignal): Promise<boolean> {
    const context = this.context;
    if (signal.aborted || !context || context.state === 'closed') return Promise.resolve(false);
    if (context.state === 'running') return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', cancelled);
        resolve(
          ready && !signal.aborted && this.context === context && context.state === 'running',
        );
      };
      const cancelled = () => finish(false);
      const timer = setTimeout(() => finish(false), 1000);
      signal.addEventListener('abort', cancelled, { once: true });
      try {
        void context.resume().then(
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
    if (silent || !visible || volume <= 0 || !context || context.state !== 'running') return false;
    const level = Math.min(1, Math.max(0, volume / 100)) * 0.13;
    // Bell-like partials decay sooner than the fundamental. Gentle attack avoids clicks.
    for (const [offset, frequency] of [
      [0, 293.665],
      [0.16, 440],
      [0.25, 587.33],
    ]) {
      for (const [multiple, weight, duration] of [
        [1, 1, 0.47],
        [4, 0.18, 0.23],
        [8, 0.09, 0.18],
      ]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + offset;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency * multiple;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(level * weight, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.01);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      }
    }
    return true;
  }

  dispose(): void {
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
