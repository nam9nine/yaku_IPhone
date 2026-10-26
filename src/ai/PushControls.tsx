import { useEffect, useState } from 'react';
import type { AiConnection } from './connection';
import { disablePush, enablePush, pushSupport, readPushBinding, PUSH_SETTINGS_EVENT } from './push';

export function PushControls({
  connection,
  active,
}: {
  connection: AiConnection | null;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const support = pushSupport();
  useEffect(() => {
    let mounted = true;
    let revision = 0;
    const check = () => {
      const request = ++revision;
      void readPushBinding(connection)
        .then((value) => {
          if (mounted && request === revision) setEnabled(!!value);
        })
        .catch(() => {
          if (mounted && request === revision) setEnabled(false);
        });
    };
    check();
    window.addEventListener(PUSH_SETTINGS_EVENT, check);
    document.addEventListener('visibilitychange', check);
    return () => {
      mounted = false;
      window.removeEventListener(PUSH_SETTINGS_EVENT, check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [connection]);
  async function toggle() {
    if (!connection || busy || !active) return;
    setBusy(true);
    setError(null);
    try {
      if (enabled) {
        if (!(await disablePush(connection)))
          throw new Error('알림 설정을 저장하지 못했습니다. 다시 시도해 주세요.');
        setEnabled(false);
      } else {
        await enablePush(connection);
        setEnabled(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '알림 설정을 바꾸지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="message-push-controls">
      <button
        className="social-circle message-push-button"
        aria-label="답장 알림 설정"
        aria-expanded={open}
        disabled={!active}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="message-push-panel" role="region" aria-label="답장 알림">
          <strong>답장 알림</strong>
          {support === 'install' ? (
            <p>
              Safari의 공유 버튼에서 ‘홈 화면에 추가’를 선택한 뒤, 추가된 앱을 열어 알림을 켜
              주세요.
            </p>
          ) : support === 'unsupported' ? (
            <p>이 브라우저에서는 사이트 안에서만 알림을 받을 수 있습니다.</p>
          ) : (
            <>
              <p>앱을 닫아도 새 답장을 잠금 화면에서 받을 수 있습니다.</p>
              {!connection && <p>하루카나 마지마의 대화를 연 뒤 알림을 켜 주세요.</p>}
              <button onClick={() => void toggle()} disabled={busy || !connection || !active}>
                {busy ? '설정 중…' : enabled ? '알림 끄기' : '알림 켜기'}
              </button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <button onClick={() => setOpen(false)}>닫기</button>
        </div>
      )}
    </div>
  );
}
