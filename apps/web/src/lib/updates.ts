/**
 * Keep the running app in step with what has been deployed.
 *
 * A service worker installed before `skipWaiting` was configured will never
 * hand over on its own: it sits in the waiting state indefinitely, serving the
 * bundle it was built with. That leaves a browser permanently a version behind
 * — the deployed fix is live, and this tab keeps running the old code — while a
 * private window, having no worker installed, looks correct.
 *
 * Telling any waiting worker to activate, then reloading once it does, recovers
 * from that without asking anyone to clear site data.
 */
export function watchForUpdates(): void {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.ready
    .then((registration) => {
      promote(registration);
      registration.addEventListener('updatefound', () => {
        registration.installing?.addEventListener('statechange', () => promote(registration));
      });

      // A tab left open for hours should still pick up a deploy.
      window.setInterval(() => registration.update().catch(() => {}), UPDATE_CHECK_MS);
    })
    .catch(() => {});

  // Reload once, when the new worker takes control of this page.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

function promote(registration: ServiceWorkerRegistration): void {
  registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
}

const UPDATE_CHECK_MS = 5 * 60 * 1000;
