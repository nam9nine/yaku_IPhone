/** Registration errors reject immediately; activation must not leave the permission UI pending forever. */
export async function waitForPushWorker(
  workers: Pick<ServiceWorkerContainer, 'register' | 'ready'>,
  baseUrl: string,
  timeoutMs = 10_000,
): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = new Error('알림 준비가 지연되고 있습니다. 잠시 후 다시 켜 주세요.');
  const ready = async () => {
    await workers.register(`${baseUrl}push-sw.js`, { scope: baseUrl });
    return workers.ready;
  };
  try {
    return await Promise.race([
      ready(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error === timeoutError) throw error;
    throw new Error('이 브라우저에서 알림을 준비하지 못했습니다. 새로고침한 뒤 다시 켜 주세요.', {
      cause: error,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
