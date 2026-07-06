import { apiDelete, apiGet, apiPost, apiPut, unwrapList } from "./api";
import { config } from "./config";
import type { Campaign, ContactTag, InfobipApi, MediaItem, SavedFlow, SavedTemplate, User } from "./types";

function localApiBase() {
  const isLocal =
    typeof window !== "undefined" &&
    /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
  if (isLocal) return config.localBackendUrl.replace(/\/$/, "");
  return (config.mediaBackendUrl || `${config.publicAppUrl.replace(/\/$/, "")}/local-api` || config.localBackendUrl).replace(/\/$/, "");
}

async function localJson<T = unknown>(path: string, init?: RequestInit) {
  const response = await fetch(`${localApiBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (data && typeof data === "object" && (data as Record<string, unknown>).ok === false)) {
    const record = data as Record<string, unknown>;
    throw new Error(String(record.message || record.error || `HTTP ${response.status}`));
  }
  return data as T;
}

export const infobipApis = {
  list: (apiType?: string) => localJson<unknown>(`/infobip/apis${apiType ? `?api_type=${encodeURIComponent(apiType)}` : ""}`),
  normalizedList: async (apiType?: string) => unwrapList<InfobipApi>(await infobipApis.list(apiType)),
  save: (payload: unknown) => localJson("/infobip/apis", { body: JSON.stringify(payload), method: "POST" }),
  update: (id: string, payload: unknown) => localJson(`/infobip/apis/${encodeURIComponent(id)}`, { body: JSON.stringify(payload), method: "PUT" }),
  remove: (id: string) => localJson(`/infobip/apis/${encodeURIComponent(id)}`, { method: "DELETE" }),
  senders: (id: string) => localJson<unknown>(`/infobip/apis/${encodeURIComponent(id)}/senders`),
  syncSenders: (id: string) => localJson<unknown>(`/infobip/apis/${encodeURIComponent(id)}/senders/sync`, { method: "POST" }),
  normalizedSenders: async (id: string) => {
    const payload = await infobipApis.syncSenders(id).catch(() => infobipApis.senders(id));
    return unwrapList<Record<string, unknown>>(payload);
  },
};

export const savedTemplates = {
  list: (folder?: string) => apiGet<unknown>("/templates/saved", folder ? { folder } : undefined),
  normalizedList: async (folder?: string) => unwrapList<SavedTemplate>(await savedTemplates.list(folder)),
  save: (payload: unknown) => apiPost("/templates/saved", payload),
  update: (id: string, payload: unknown) => apiPut(`/templates/saved/${id}`, payload),
  remove: (id: string) => apiDelete(`/templates/saved/${id}`),
  createRemote: (apiId: string, senderNumber: string, payload: unknown) =>
    apiPost("/templates", { apiId, senderNumber, payload }),
};

export const contacts = {
  tags: (q?: string, limit = 100, offset = 0) => apiGet<unknown>("/tags", { q, limit, offset }),
  normalizedTags: async (q?: string) => unwrapList<ContactTag>(await contacts.tags(q)),
  tagContacts: (tagId: string, limit = 50, offset = 0) =>
    apiGet<unknown>(`/tags/${tagId}/contacts`, { limit, offset }),
  importCsv: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiPost("/import/contacts/csv", form);
  },
  deleteTags: (tagIds: string[]) => apiDelete("/tags/", { tagIds }),
};

export const media = {
  list: (type?: string) => apiGet<unknown>("/media", type ? { type } : undefined),
  normalizedList: async (type?: string) => unwrapList<MediaItem>(await media.list(type)),
  recent: (type: string, limit = 3) => apiGet<unknown>("/media/recent", { type, limit }),
  save: (payload: unknown) => apiPost("/media", payload),
  remove: (id: string) => apiDelete(`/media/${id}`),
  upload: async (file: File, folder = "user-media", isPrivate = false) => {
    const form = new FormData();
    form.append("file", file);
    form.append("folder", folder);
    form.append("isPrivate", String(isPrivate));
    return apiPost("/storage/upload", form);
  },
};

export const flows = {
  list: () => apiGet<unknown>("/saved-flows"),
  normalizedList: async () => unwrapList<SavedFlow>(await flows.list()),
  create: (payload: unknown) => apiPost("/saved-flows", payload),
  update: (id: string, payload: unknown) => apiPut(`/saved-flows/${id}`, payload),
  remove: (id: string) => apiDelete(`/saved-flows/${id}`),
};

export const campaigns = {
  list: (params?: Record<string, unknown>) => apiGet<unknown>("/campaigns", params),
  normalizedList: async (params?: Record<string, unknown>) => unwrapList<Campaign>(await campaigns.list(params)),
  create: (payload: unknown) => apiPost("/campaigns", payload),
  update: (id: string, payload: unknown) => apiPut(`/campaigns/${id}`, payload),
  remove: (id: string) => apiDelete(`/campaigns/${id}`),
};

export const broadcasts = {
  list: (params?: Record<string, unknown>) => apiGet<unknown>("/broadcasts", params),
  normalizedList: async (params?: Record<string, unknown>) => unwrapList<Record<string, unknown>>(await broadcasts.list(params)),
  create: (payload: unknown) => apiPost<unknown>("/broadcasts", payload),
  dispatch: (payload: unknown) => apiPost<unknown>("/broadcasts/dispatch", payload),
  start: (id: string, payload?: unknown) => apiPost<unknown>(`/broadcasts/${id}/start`, payload),
  status: (id: string) => apiGet<unknown>(`/broadcasts/${id}/status`),
  updateStatus: (id: string, status: string) => apiPut(`/broadcasts/${id}/status`, { status }),
};

export const analytics = {
  transmissions: (params?: Record<string, unknown>) => apiGet<unknown>("/analytics/transmissions", params),
  infobip: (params?: Record<string, unknown>) => apiGet<unknown>("/analytics/infobip", params),
};

export const adminUsers = {
  list: () => apiGet<unknown>("/admin/users"),
  listV1: () => apiGet<unknown>("/admin/v1/users"),
  normalizedList: async () => unwrapList<User>(await adminUsers.list()),
  normalizedListV1: async () => unwrapList<User>(await adminUsers.listV1()),
  updateApproval: (id: string, approved: boolean) => apiPut(`/admin/users/${id}/approval`, { approved }),
  updateRole: (id: string, role: string) => apiPut(`/admin/users/${id}/role`, { role }),
  updateBetaAccess: (id: string, beta_access: boolean) => apiPut(`/admin/users/${id}/beta`, { beta_access }),
  updateSenderAccess: (id: string, senders_access: boolean) =>
    apiPut(`/admin/users/${id}/senders-access`, { senders_access }),
};

export const senders = {
  list: () => apiGet<unknown>("/senders"),
  wabas: (page = 1, limit = 50) => apiGet<unknown>("/senders/wabas", { page, limit }),
  registered: () => apiGet<unknown>("/senders/registration/wabas"),
  register: (payload: unknown) => apiPost("/senders/registration/register", payload),
  verify: (payload: unknown) => apiPost("/senders/registration/verify", payload),
  remove: (id: string) => apiDelete(`/senders/${id}`),
};

export const security = {
  apiRestrictions: () => apiGet<unknown>("/admin/restrictions/apis"),
  userRestrictions: () => apiGet<unknown>("/user-api-restrictions"),
  myRestrictions: () => apiGet<unknown>("/user-api-restrictions/me"),
  addRestriction: (payload: unknown) => apiPost("/user-api-restrictions", payload),
  removeRestriction: (payload: unknown) => apiDelete("/user-api-restrictions", payload),
};
