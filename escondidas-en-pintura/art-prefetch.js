/* Precarga gradual de archivos comprimidos; la partida nunca espera a esta cola. */
(function (root) {
  'use strict';

  function create({ urls = [], canRun = () => true, fetch: fetchAsset = root.fetch.bind(root), timers = {} } = {}) {
    const later = timers.setTimeout || root.setTimeout.bind(root);
    const cancel = timers.clearTimeout || root.clearTimeout.bind(root);
    const now = timers.now || Date.now;
    const items = new Map();
    let queue = [];
    let enabled = false;
    let holds = 0;
    let active = null;
    let timer = null;
    let notBefore = 0;

    function cancelTimer() {
      if (timer !== null) cancel(timer);
      timer = null;
    }

    function interrupt() {
      cancelTimer();
      if (active) {
        active.interrupted = true;
        active.controller.abort();
      }
    }

    function allowed() { return enabled && holds === 0 && canRun(); }

    function schedule() {
      if (!allowed() || active || timer !== null || !queue.length) return;
      const readyAt = Math.max(notBefore, Math.min(...queue.map((item) => item.readyAt)));
      timer = later(() => {
        timer = null;
        if (!allowed() || active) return;
        const index = queue.findIndex((item) => item.readyAt <= now());
        if (index < 0) { schedule(); return; }
        const [item] = queue.splice(index, 1);
        void download(item);
      }, Math.max(0, readyAt - now()));
    }

    async function download(item) {
      const work = { item, controller: new AbortController(), interrupted: false, discard: false };
      active = work;
      try {
        const response = await fetchAsset(item.url, { priority: 'low', cache: 'default', signal: work.controller.signal });
        if (!response.ok) throw new Error('No se pudo precargar la obra');
        // Consumir el cuerpo permite completar la caché HTTP sin decodificar la imagen ni retener sus bytes.
        if (response.body && typeof response.body.getReader === 'function') {
          const reader = response.body.getReader();
          try {
            while (!(await reader.read()).done) { /* descartar cada bloque comprimido */ }
          } finally {
            reader.releaseLock();
          }
        } else {
          await response.arrayBuffer();
        }
        if (!work.interrupted) item.done = true;
      } catch {
        if (!work.interrupted) {
          item.failures++;
          item.failed = item.failures >= 3;
          item.readyAt = now() + 3000 * 2 ** (item.failures - 1);
        }
      } finally {
        if (!item.done && !item.failed && !work.discard) queue.push(item);
        active = null;
        notBefore = now() + 1000;
        schedule();
      }
    }

    function enqueue(urls) {
      for (const url of urls) {
        if (typeof url !== 'string' || !url || items.has(url)) continue;
        const item = { url, readyAt: 0, failures: 0, done: false, failed: false };
        items.set(url, item);
        queue.push(item);
      }
      cancelTimer();
      schedule();
    }

    function prioritize(urls) {
      enqueue(urls);
      const order = new Map(urls.map((url, index) => [url, index]));
      queue.sort((a, b) => (order.get(a.url) ?? Infinity) - (order.get(b.url) ?? Infinity));
    }

    function refresh() {
      if (!allowed()) interrupt();
      else schedule();
    }

    function pause() { enabled = false; interrupt(); }
    function resume() { enabled = true; refresh(); }

    /** Úsalo al recuperar la red o por una petición explícita; pause/resume nunca reinician intentos. */
    function retryFailed() {
      for (const item of items.values()) {
        if (!item.failed) continue;
        item.failed = false;
        item.failures = 0;
        item.readyAt = 0;
        queue.push(item);
      }
      schedule();
    }

    /** La carga de una obra necesaria toma prioridad hasta que todos los consumidores la liberen. */
    function hold() {
      holds++;
      interrupt();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
        schedule();
      };
    }

    /** Detiene y vacía la cola; se puede volver a llenar con enqueue(). */
    function stop() {
      pause();
      if (active) active.discard = true;
      queue = [];
      items.clear();
      notBefore = 0;
    }

    enqueue(urls);
    return { enqueue, prioritize, hold, pause, resume, refresh, stop, retryFailed };
  }

  root.ArtPrefetch = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
