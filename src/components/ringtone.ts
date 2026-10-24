type RingtoneAudio = Pick<
  HTMLAudioElement,
  'play' | 'pause' | 'currentTime' | 'volume' | 'muted' | 'loop'
>;

/** One reusable media element. Delayed play promises cannot revive a finished call. */
export function createRingtonePlayer(audio: RingtoneAudio) {
  let ringing = false;
  let silent = false;
  let volume = 0.5;
  let visible = true;
  let disposed = false;
  let prepared = false;
  let pending = false;
  let playing = false;
  let generation = 0;
  audio.loop = true;
  audio.muted = true;

  const audible = () => !disposed && ringing && !silent && volume > 0 && visible;
  const stop = () => {
    generation += 1;
    pending = false;
    playing = false;
    audio.pause();
    audio.currentTime = 0;
    audio.muted = true;
  };
  const play = (prepare: boolean) => {
    if (disposed || pending || playing) return;
    const request = ++generation;
    pending = true;
    audio.muted = prepare || !audible();
    audio.volume = volume;
    // Safari may require this call inside a user event. Rejection is retryable.
    let result: Promise<void>;
    try {
      result = audio.play();
    } catch {
      pending = false;
      return;
    }
    void result.then(
      () => {
        if (request !== generation) {
          if (!audible()) audio.pause();
          return;
        }
        pending = false;
        prepared = true;
        if (audible()) {
          audio.muted = false;
          audio.volume = volume;
          playing = true;
        } else {
          stop();
        }
      },
      () => {
        if (request === generation) {
          pending = false;
          playing = false;
        }
      },
    );
  };
  return {
    update(next: { ringing: boolean; silent: boolean; volume: number }) {
      ringing = next.ringing;
      silent = next.silent;
      volume = Number.isFinite(next.volume) ? Math.max(0, Math.min(100, next.volume)) / 100 : 0;
      audio.volume = volume;
      if (audible()) {
        audio.muted = false;
        play(false);
      } else stop();
    },
    activate() {
      if (audible()) play(false);
      else if (!prepared && !disposed && visible) play(true);
    },
    setVisible(next: boolean) {
      visible = next;
      if (audible()) play(false);
      else stop();
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}
