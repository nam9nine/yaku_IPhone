/* Push only: deliberately no fetch handler or app-shell cache. */
const DB = 'yaku-iphone-push-v1';
function state(write, action) {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('state');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('state', write ? 'readwrite' : 'readonly');
      const request = action(tx.objectStore('state'));
      tx.oncomplete = () => {
        resolve(request.result);
        db.close();
      };
      tx.onerror = () => {
        reject(tx.error);
        db.close();
      };
    };
  });
}
// Same readwrite claim protocol as the page. Never infer sound delivery from
// client visibility: a visible page may have locked or interrupted Web Audio.
function claimSound(id, owner, release = false) {
  return state(true, (store) => {
    const output = { result: false };
    const request = store.get('soundClaims');
    request.onsuccess = () => {
      const claims = request.result || [];
      if (release) {
        store.put(
          claims.filter((claim) => claim.id !== id || claim.owner !== owner),
          'soundClaims',
        );
      } else if (!claims.some((claim) => claim.id === id)) {
        store.put([...claims.slice(-199), { id, owner }], 'soundClaims');
        output.result = true;
      }
    };
    return output;
  });
}
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
let pushQueue = Promise.resolve();
self.addEventListener('push', (event) => {
  pushQueue = pushQueue
    .catch(() => {})
    .then(async () => {
      let payload;
      try {
        payload = event.data?.json();
      } catch {
        return;
      }
      if (
        !payload ||
        payload.type !== 'chat.reply' ||
        !['haruka', 'majima'].includes(payload.character) ||
        typeof payload.subscription_id !== 'string' ||
        typeof payload.notification_id !== 'string' ||
        typeof payload.title !== 'string' ||
        typeof payload.body !== 'string'
      )
        return;
      const binding = await state(false, (store) => store.get('binding'));
      if (!binding || binding.id !== payload.subscription_id) return;
      const seen = (await state(false, (store) => store.get('seen'))) || [];
      if (seen.includes(payload.notification_id)) return;
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const scopedClients = clients.filter((client) =>
        client.url.startsWith(self.registration.scope),
      );
      // Recheck after asynchronous work: a reset may have invalidated the binding.
      const current = await state(false, (store) => store.get('binding'));
      if (current?.id !== payload.subscription_id) return;
      const soundId = payload.job_id || payload.notification_id;
      const soundOwner = `native:${payload.notification_id}`;
      const soundClaimed = await claimSound(soundId, soundOwner);
      // A reset while waiting for the sound transaction must not revive a push.
      const beforeShow = await state(false, (store) => store.get('binding'));
      if (beforeShow?.id !== payload.subscription_id) {
        if (soundClaimed) await claimSound(soundId, soundOwner, true);
        return;
      }
      try {
        await self.registration.showNotification(payload.title.slice(0, 80), {
          body: payload.body.slice(0, 500),
          tag: `kiryu-${payload.notification_id}`,
          // Required visible display remains even when another path owns sound.
          ...(!soundClaimed ? { silent: true } : {}),
          icon: new URL('app-icon.png', self.registration.scope).href,
          badge: new URL('app-icon.png', self.registration.scope).href,
          data: { character: payload.character, subscription_id: payload.subscription_id },
        });
      } catch (error) {
        if (soundClaimed) await claimSound(soundId, soundOwner, true);
        throw error;
      }
      const afterShow = await state(false, (store) => store.get('binding'));
      if (afterShow?.id !== payload.subscription_id) {
        const stale = await self.registration.getNotifications({
          tag: `kiryu-${payload.notification_id}`,
        });
        stale.forEach((notification) => notification.close());
        return;
      }
      await state(true, (store) =>
        store.put([...seen.slice(-199), payload.notification_id], 'seen'),
      );
      for (const client of scopedClients)
        client.postMessage({
          type: 'chat.reply',
          character: payload.character,
          job_id: payload.job_id,
        });
    });
  event.waitUntil(pushQueue);
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const { character, subscription_id } = event.notification.data || {};
      const binding = await state(false, (store) => store.get('binding'));
      if (!['haruka', 'majima'].includes(character) || binding?.id !== subscription_id) return;
      const target = new URL(self.registration.scope);
      target.searchParams.set('conversation', character);
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = clients.find((c) => c.url.startsWith(self.registration.scope));
      if (client) {
        await client.navigate(target.href);
        await client.focus();
      } else await self.clients.openWindow(target.href);
    })(),
  );
});
