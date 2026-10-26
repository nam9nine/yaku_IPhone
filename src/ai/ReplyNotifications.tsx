import { useEffect, useRef, useState } from 'react';
import { AppIcon } from '../home/AppIcon';
import { contacts } from '../story/data';
import type { AiReplyArrival, AiReplyNotification } from './messenger';
import { ReplySoundPlayer } from './replySound';
import { claimReplySound, releaseReplySound } from './pushBinding';
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
}: {
  arrival: AiReplyArrival | null;
  silent: boolean;
  volume: number;
}) {
  const audio = useRef<ReplySoundPlayer | null>(null);
  audio.current ??= new ReplySoundPlayer();
  useEffect(() => {
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
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('pointerup', unlock, true);
      document.removeEventListener('touchend', unlock, true);
      document.removeEventListener('click', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      audio.current?.dispose();
    };
  }, []);
  useEffect(() => {
    if (!arrival) return;
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
      player.interrupt();
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
}: {
  notification: AiReplyNotification | null;
  onOpen: (id: string) => void;
  onDismiss: () => void;
  obscured: boolean;
}) {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    if (!notification || obscured || !visible) return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [notification, onDismiss, obscured, visible]);
  if (!notification || obscured) return null;
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
