// Talks to the Bama Hub server.

export class ApiError extends Error {}

/** @param {string} path */
export async function getJson(path) {
  let res;
  try {
    res = await fetch(path, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError("Can't reach the Bama Hub server.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error ?? `Request failed (HTTP ${res.status}).`);
  return body;
}

/** @type {Promise<any> | null} */
let configPromise = null;
export function getConfig() {
  configPromise ??= getJson("/api/config").catch((err) => {
    configPromise = null;
    throw err;
  });
  return configPromise;
}

/**
 * Sends a chat message and calls onEvent for each server-sent event.
 * @param {{ message: string, conversationId?: string | null, signal?: AbortSignal }} request
 * @param {(event: any) => void} onEvent
 */
export async function streamChat({ message, conversationId, signal }, onEvent) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(conversationId ? { message, conversationId } : { message }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.error ?? `Chat failed (HTTP ${res.status}).`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let split;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) onEvent(JSON.parse(data));
    }
  }
}
