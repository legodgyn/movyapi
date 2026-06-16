import type { CurrentUser } from "./localUsers";

export type StoredToken =
  | string
  | {
      access_token?: string;
      refresh_token?: string;
      token_type?: string;
      user?: CurrentUser;
      expires_in?: number;
      [key: string]: unknown;
    };

const TOKEN_KEY = "token";

export function getStoredToken(): string | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredToken;
    if (typeof parsed === "string") return parsed;
    return parsed.access_token ?? raw;
  } catch {
    return raw;
  }
}

export function saveToken(token: StoredToken) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function hasToken() {
  return Boolean(getStoredToken());
}

export function getCurrentUser(): CurrentUser | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredToken;
    if (typeof parsed === "string") return null;
    return parsed.user ?? null;
  } catch {
    return null;
  }
}
