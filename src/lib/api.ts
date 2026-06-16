import axios from "axios";
import { apiBaseUrl, config } from "./config";
import { clearToken, getStoredToken, saveToken } from "./auth";

export const api = axios.create({
  baseURL: apiBaseUrl,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((request) => {
  const token = getStoredToken();
  if (token) request.headers.Authorization = `Bearer ${token}`;
  if (request.data instanceof FormData) {
    delete request.headers["Content-Type"];
  }
  return request;
});

export const infobipGateway = axios.create({
  baseURL: config.infobipGatewayUrl,
  headers: {
    "Content-Type": "application/json",
  },
});

infobipGateway.interceptors.request.use((request) => {
  const token = getStoredToken();
  if (token) request.headers.Authorization = `Bearer ${token}`;
  if (request.data instanceof FormData) {
    delete request.headers["Content-Type"];
  }
  return request;
});

export async function login(email: string, password: string) {
  const { data } = await api.post("/auth/login", { email, password });
  saveToken(data);
  return data;
}

export async function getMe() {
  const { data } = await api.get("/auth/me");
  return data;
}

export async function logout() {
  clearToken();
}

export function unwrapList<T = unknown>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["data", "items", "results", "templates", "contacts", "media", "flows"]) {
      const value = record[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

export async function apiGet<T = unknown>(path: string, params?: Record<string, unknown>) {
  const { data } = await api.get<T>(path, { params });
  return data;
}

export async function apiPost<T = unknown>(path: string, body?: unknown) {
  const { data } = await api.post<T>(path, body);
  return data;
}

export async function apiPut<T = unknown>(path: string, body?: unknown) {
  const { data } = await api.put<T>(path, body);
  return data;
}

export async function apiDelete<T = unknown>(path: string, body?: unknown) {
  const { data } = await api.delete<T>(path, { data: body });
  return data;
}

export async function gatewayGet<T = unknown>(path: string) {
  const { data } = await infobipGateway.get<T>(path);
  return data;
}

export async function gatewayPost<T = unknown>(path: string, body?: unknown) {
  const { data } = await infobipGateway.post<T>(path, body);
  return data;
}
