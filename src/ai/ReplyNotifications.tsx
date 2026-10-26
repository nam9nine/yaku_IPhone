import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AppIcon } from '../home/AppIcon';
import { contacts } from '../story/data';
import type { AiReplyArrival, AiReplyNotification } from './messenger';
import { AI_RESET_EVENT, AI_RESET_KEY } from './connection';
import { MESSAGE_SENT_SOUND, ReplySoundPlayer } from './replySound';
import { claimReplySound, releaseReplySound, storedPushBinding } from './pushBinding';
import './reply-notifications.css';

function ReplyCard({
  reply,
  onOpen,
}: {
  reply: AiReplyNotification;
  onOpen: (id: string) => void;
}) {
  const person = contacts.find((contact) => contact.id === reply.character)!;
  return (
    <button
      className="day-notification"
      onClick={() => onOpen(reply.character)}
      aria-label={`${person.shortName}의 새 메시지 알림 열기`}
    >
      <span className="notification-symbol">
        <AppIcon id="messages" day="24" weekday="토" />
      </span>
      <span className="notification-copy">
        <span className="notification-heading">
          <strong>{person.shortName}</strong>
          <small>지금</small>
        </span>
        <span className="ai-notification-preview">{reply.text}</span>
      </span>
    </button>
  );
}

export function AiReplyNotifications({
  replies,
  onOpen,
}: {
  replies: AiReplyNotification[];
  onOpen: (id: string) => void;
}) {
  if (!replies.length) return null;
  return (
    <div className="day-notifications" aria-label="새 메시지 알림">
      {replies
        .slice(-5)
        .reverse()
        .map((reply) => (
          <ReplyCard key={reply.id} reply={reply} onOpen={onOpen} />
        ))}
    </div>
  );
}

/** User gesture unlock only. No OS permission prompt or queued sound on return. */
export function AiReplySound({
  arrival,
  silent,
  volume,
  activeCharacter,
}: {
  arrival: AiReplyArrival | null;
  silent: boolean;
  volume: number;
  activeCharacter: string | null;
}) {
  const audio = useRef<ReplySoundPlayer | null>(null);
  audio.current ??= new ReplySoundPlayer();
  const pendingSounds = useRef(new Set<AbortController>());
  const soundSettings = useEffectEvent(() => ({ silent, volume }));
  const cancelSounds = useEffectEvent(() => {
    for (const controller of pendingSounds.current) controller.abort();
    pendingSounds.current.clear();
    audio.current?.interrupt();
  });
  useEffect(() => {
    if (silent || volume <= 0) cancelSounds();
  }, [silent, volume]);
  const onSend = useEffectEvent(() => {
    const player = audio.current!;
    player.unlock();
    const controller = new AbortController();
    pendingSounds.current.add(controller);
    const hide = () => {
      if (document.hidden) controller.abort();
    };
    document.addEventListener('visibilitychange', hide);
    const id = `sent:${crypto.randomUUID()}`;
    void player.ready(controller.signal, 'conversation').then((ready) => {
      const settings = soundSettings();
      player.play(
        id,
        settings.silent || !ready,
        settings.volume,
        !document.hidden && !controller.signal.aborted,
        'conversation',
      );
      pendingSounds.current.delete(controller);
      document.removeEventListener('visibilitychange', hide);
    });
  });
  const onPushSound = useEffectEvent(async (event: MessageEvent) => {
    const data = event.data;
    const port = event.ports[0];
    if (data?.type !== 'chat.sound' || !port || !event.source || !('scriptURL' in event.source))
      return;
    const expected = new URL(`${import.meta.env.BASE_URL}push-sw.js`, location.href);
    if (
      new URL(event.source.scriptURL).pathname !== expected.pathname ||
      new URL(event.source.scriptURL).origin !== expected.origin
    )
      return;
    const player = audio.current!;
    const owner = `app:${crypto.randomUUID()}`;
    const kind = data.character === activeCharacter ? 'conversation' : 'notification';
    const controller = new AbortController();
    pendingSounds.current.add(controller);
    const hide = () => {
      if (document.hidden) controller.abort();
    };
    document.addEventListener('visibilitychange', hide);
    const valid = () =>
      !document.hidden &&
      !controller.signal.aborted &&
      !soundSettings().silent &&
      soundSettings().volume > 0 &&
      Date.now() < data.deadline;
    try {
      if (
        !['haruka', 'majima'].includes(data.character) ||
        typeof data.soundId !== 'string' ||
        !valid()
      )
        return;
      if ((await storedPushBinding())?.id !== data.subscription_id) return;
      if (!(await player.ready(controller.signal, kind)) || !valid()) return;
      if (!(await claimReplySound(data.soundId, owner))) return;
      if (
        (await storedPushBinding())?.id !== data.subscription_id ||
        !valid() ||
        !player.play(data.soundId, false, soundSettings().volume, true, kind)
      ) {
        await releaseReplySound(data.soundId, owner);
        return;
      }
    } catch {
      await releaseReplySound(data.soundId, owner);
    } finally {
      pendingSounds.current.delete(controller);
      document.removeEventListener('visibilitychange', hide);
      port.postMessage({ done: true });
      port.close();
    }
  });
  useEffect(() => {
    const reset = () => cancelSounds();
    const storageReset = (event: StorageEvent) => {
      if (event.key === AI_RESET_KEY || event.key === null) cancelSounds();
    };
    window.addEventListener('storage', storageReset);
    window.addEventListener(AI_RESET_EVENT, reset);
    const sent = () => onSend();
    const pushSound = (event: MessageEvent) => {
      void onPushSound(event);
    };
    window.addEventListener(MESSAGE_SENT_SOUND, sent);
    navigator.serviceWorker?.addEventListener('message', pushSound);
    const unlock = () => audio.current?.unlock();
    const visibility = () => {
      if (document.hidden) audio.current?.interrupt();
    };
    document.addEventListener('visibilitychange', visibility);
    // Safari media activation explicitly includes touchend/click. Pointerup is
    // kept for pointer-only controls, with duplicate resume calls harmless.
    document.addEventListener('pointerup', unlock, true);
    document.addEventListener('touchend', unlock, true);
    document.addEventListener('click', unlock, true);
    document.addEventListener('keydown', unlock, true);
    return () => {
      cancelSounds();
      window.removeEventListener('storage', storageReset);
      window.removeEventListener(AI_RESET_EVENT, reset);
      window.removeEventListener(MESSAGE_SENT_SOUND, sent);
      navigator.serviceWorker?.removeEventListener('message', pushSound);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('pointerup', unlock, true);
      document.removeEventListener('touchend', unlock, true);
      document.removeEventListener('click', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      audio.current?.dispose();
    };
  }, []);
  useEffect(() => {
    if (!arrival) {
      audio.current?.interrupt();
      return;
    }
    let current = true;
    const player = audio.current!;
    const soundId = arrival.jobId ?? arrival.id;
    const owner = `app:${crypto.randomUUID()}`;
    if (!arrival.playSound || silent || volume <= 0 || document.hidden) {
      player.interrupt();
      // Consume in this page without replaying on return, unmute, or audio unlock.
      player.play(arrival.id, true, volume, false);
      return;
    }
    const controller = new AbortController();
    const onVisibility = () => {
      if (document.hidden) controller.abort();
    };
    document.addEventListener('visibilitychange', onVisibility);
    void player.ready(controller.signal, arrival.sound).then(async (ready) => {
      if (!ready || !current || document.hidden) {
        player.play(arrival.id, true, volume, false);
        return;
      }
      const claimed = await claimReplySound(soundId, owner);
      if (!claimed) {
        player.play(arrival.id, true, volume, false);
        return;
      }
      const played =
        current &&
        !controller.signal.aborted &&
        player.play(arrival.id, silent, volume, !document.hidden, arrival.sound);
      if (!played) {
        player.play(arrival.id, true, volume, false);
        void releaseReplySound(soundId, owner);
      }
    });
    return () => {
      current = false;
      controller.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [arrival, silent, volume]);
  return null;
}

export function AiReplyBanner({
  notification,
  onOpen,
  onDismiss,
  obscured,
  inConversation,
}: {
  notification: AiReplyNotification | null;
  onOpen: (id: string) => void;
  onDismiss: () => void;
  obscured: boolean;
  inConversation: boolean;
}) {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    // Dismiss the transient banner only, keeping other threads unread. Do not
    // queue an old banner to appear after the user leaves the conversation.
    if (notification && visible && inConversation) onDismiss();
  }, [notification, visible, inConversation, onDismiss]);
  useEffect(() => {
    if (!notification || obscured || !visible) return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [notification, onDismiss, obscured, visible]);
  if (!notification || obscured || inConversation) return null;
  return (
    <aside className="ai-reply-banner" aria-label="새 메시지 도착" role="status">
      <ReplyCard
        reply={notification}
        onOpen={(id) => {
          onDismiss();
          onOpen(id);
        }}
      />
      <button className="ai-notification-dismiss" aria-label="메시지 알림 닫기" onClick={onDismiss}>
        ×
      </button>
    </aside>
  );
}
