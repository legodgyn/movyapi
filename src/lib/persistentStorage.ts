import { config } from "./config";

const backendUrl = () => config.localBackendUrl.replace(/\/$/, "");

export async function readPersistentValue<T>(key: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${backendUrl()}/storage/${encodeURIComponent(key)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `storage HTTP ${response.status}`);
    return data.value ?? fallback;
  } catch {
    try {
      const local = localStorage.getItem(key);
      return local ? (JSON.parse(local) as T) : fallback;
    } catch {
      return fallback;
    }
  }
}

export async function writePersistentValue<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
  try {
    await fetch(`${backendUrl()}/storage/${encodeURIComponent(key)}`, {
      body: JSON.stringify({ value }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });
  } catch {
    // Local fallback is already written above.
  }
}
