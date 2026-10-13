const MIN_START_INTERVAL_MS = 8000;
const MAX_ATTEMPTS = 2;

let queueTail = Promise.resolve();
let lastStartedAt = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isPermanentYouTubeBlock(error) {
  return /not a bot|sign in to confirm/i.test(String(error?.message || error));
}

function isTransient(error) {
  if (isPermanentYouTubeBlock(error)) return false;

  const status = error?.response?.status;
  if (status !== undefined) return status === 429 || status >= 500;

  const code = error?.code || "";
  if (["ECONNABORTED", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ERR_NETWORK", "ERR_BAD_RESPONSE", "ECONNREFUSED"].includes(code)) {
    return true;
  }

  return /timed out|socket hang up|network error|http error (?:429|5\d\d)|page needs to be reloaded/i.test(String(error?.message || error));
}

export async function retryTransient(operation, label, attempts = MAX_ATTEMPTS) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isTransient(error)) throw error;
      const delayMs = attempt * 3000;
      console.warn(`${label} transient failure; retry ${attempt + 1}/${attempts} in ${delayMs}ms`);
      await wait(delayMs);
    }
  }
}

export function queueYouTubeDownload(task) {
  const queued = queueTail.then(async () => {
    const delayMs = Math.max(0, MIN_START_INTERVAL_MS - (Date.now() - lastStartedAt));
    if (delayMs > 0) await wait(delayMs);
    lastStartedAt = Date.now();
    return task();
  });

  // Keep the queue alive if one task fails, while returning its error to its caller.
  queueTail = queued.catch(() => {});
  return queued;
}
