import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Check,
  CheckCircle2,
  Clock3,
  CornerDownLeft,
  Link2,
  Megaphone,
  MessageCircle,
  Image,
  Paperclip,
  Pilcrow,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  Smartphone,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { broadcasts, contacts, infobipApis, media as mediaService, savedTemplates } from "../lib/services";
import { config } from "../lib/config";
import { apiGet, unwrapList } from "../lib/api";
import { labelOf } from "../lib/format";
import type { ContactItem, ContactTag, InfobipApi, MediaItem, SavedTemplate } from "../lib/types";

const LOCAL_BROADCAST_PLAN_KEY = "scaleapi.broadcastPlan";
const LOCAL_BROADCAST_RUN_KEY = "scaleapi.broadcastRun";
const LOCAL_BROADCAST_PAYLOAD_KEY = "scaleapi.broadcastLastPayload";
const LOCAL_BROADCAST_CAMPAIGNS_KEY = "movy.broadcastCampaigns";
const LOCAL_BM_SETTINGS_KEY = "scaleapi.bmSettings";
const LOCAL_BM_ACCOUNTS_KEY = "scaleapi.bmAccounts";
const LOCAL_CONNECTED_SENDERS_KEY = "movy.connectedSenders";
const LOCAL_META_SENT_TEMPLATES_KEY = "scaleapi.metaSentTemplatesCache";
const MEDIA_LIBRARY_KEY = "movy.mediaLibrary";
const GRAPH_API_BASE = "https://graph.facebook.com/v24.0";

type WizardStep = "sender" | "templates" | "audience" | "customize" | "monitor";
type RunStatus = "idle" | "sending" | "paused" | "done";
type RunEvent = { id: string; type: "success" | "failed" | "info"; message: string; time: string };
type MessageStatus = {
  id: string;
  status: string;
  timestamp?: number;
  recipientId?: string;
  errorCode?: string | number;
  errorTitle?: string;
  errorMessage?: string;
};
type BroadcastRecipient = ContactItem & {
  phone: string;
  tagId: string;
  tagName: string;
};
type TemplateCustomization = {
  variables: Record<string, string>;
  mediaUrl: string;
  mediaName: string;
  mediaType: string;
};

type LocalMediaItem = MediaItem & {
  storagePath?: string;
};

type BroadcastMode = "simple" | "random";

type BroadcastPlan = {
  mode: BroadcastMode;
  senderId: string;
  senderIds: string[];
  manualSender: string;
  templateIds: string[];
  templatesBySender: Record<string, string[]>;
  tagIds: string[];
  customizations: Record<string, TemplateCustomization>;
};

type BroadcastRun = {
  status: RunStatus;
  total: number;
  accepted: number;
  delivered: number;
  pending: number;
  failed: number;
  processing: number;
  events: RunEvent[];
  messageIds: string[];
  statusByMessageId: Record<string, MessageStatus>;
  startedAt?: string;
};

type BroadcastCampaignStatus = "draft" | "sending" | "done" | "failed";

type BroadcastCampaign = {
  id: string;
  name: string;
  channel: "Cloud API" | "Janela 24h";
  description?: string;
  delivered: number;
  failed: number;
  pending: number;
  total: number;
  lots: number;
  status: BroadcastCampaignStatus;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
};

type BroadcastDistributionItem = {
  sender?: InfobipApi;
  template: SavedTemplate;
  tag: ContactTag;
  customizationKey: string;
};

type BroadcastTemplateSelection = {
  key: string;
  sender?: InfobipApi;
  template: SavedTemplate;
  label: string;
};

type BroadcastJob = {
  recipient: BroadcastRecipient;
  template: SavedTemplate;
  customization: TemplateCustomization;
  sender: InfobipApi;
  lotId: string;
};

type BmSettingsData = {
  id?: string;
  name?: string;
  businessName?: string;
  label?: string;
  status?: string;
  accessToken?: string;
  defaultWabaId?: string;
  wabaId?: string;
  defaultPhoneNumberId?: string;
  phoneNumberId?: string;
  phoneNumber?: string;
  phones?: Array<{ id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string; status?: string }>;
  connectedPhoneIds?: string[];
  createdAt?: string;
};
type ConnectedSender = {
  id: string;
  bmId: string;
  bmName: string;
  wabaId: string;
  phoneNumberId: string;
  phone: string;
  verifiedName: string;
  quality: string;
  connectedAt: string;
};
type MetaMessageTemplate = {
  id?: string;
  name: string;
  status?: string;
  language?: string;
  category?: string;
  components?: Array<{
    type?: string;
    format?: string;
    text?: string;
    buttons?: Array<{ type?: string; text?: string; url?: string }>;
  }>;
  waba_id?: string;
  bm_id?: string;
  bm_name?: string;
};

const steps: Array<{ key: WizardStep; title: string; subtitle: string }> = [
  { key: "sender", title: "Remetente", subtitle: "Conta que vai enviar" },
  { key: "templates", title: "Template", subtitle: "Mensagens aprovadas" },
  { key: "audience", title: "Tag", subtitle: "Uma por template" },
  { key: "customize", title: "Variáveis & Mídia", subtitle: "Conteúdo do envio" },
  { key: "monitor", title: "Disparo", subtitle: "Criar lote" },
];

const defaultPlan: BroadcastPlan = {
  mode: "simple",
  senderId: "",
  senderIds: [],
  manualSender: "",
  templateIds: [],
  templatesBySender: {},
  tagIds: [],
  customizations: {},
};

function normalizeBroadcastPlan(value: BroadcastPlan): BroadcastPlan {
  return {
    ...defaultPlan,
    ...value,
    mode: value?.mode === "random" ? "random" : "simple",
    senderIds: Array.isArray(value?.senderIds) ? value.senderIds : [],
    templateIds: Array.isArray(value?.templateIds) ? value.templateIds : [],
    templatesBySender: asRecord(value?.templatesBySender) as Record<string, string[]>,
    tagIds: Array.isArray(value?.tagIds) ? value.tagIds : [],
    customizations: asRecord(value?.customizations) as Record<string, TemplateCustomization>,
  };
}

const defaultRun: BroadcastRun = {
  status: "idle",
  total: 0,
  accepted: 0,
  delivered: 0,
  pending: 0,
  failed: 0,
  processing: 0,
  events: [],
  messageIds: [],
  statusByMessageId: {},
};

function withTimeout<T>(promise: Promise<T>, ms = 3500): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error("timeout")), ms);
    }),
  ]);
}

function readLocalContactTags(): ContactTag[] {
  try {
    const store = JSON.parse(localStorage.getItem("scaleapi.localContacts") || "{}") as Record<string, { tag: ContactTag }>;
    return Object.values(store).map((entry) => entry.tag).filter(Boolean);
  } catch {
    return [];
  }
}

function onlyDigits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function nowTime() {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function accountKey(account: BmSettingsData, fallback = "") {
  return String(account.defaultWabaId || account.wabaId || account.id || fallback).trim();
}

function readConnectedSenders() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_CONNECTED_SENDERS_KEY) || "[]");
    return Array.isArray(stored) ? (stored as ConnectedSender[]) : [];
  } catch {
    return [];
  }
}

function normalizePhoneSender(account: BmSettingsData, phone: NonNullable<BmSettingsData["phones"]>[number], index: number): InfobipApi {
  const wabaId = account.defaultWabaId || account.wabaId || "";
  const phoneNumberId = phone.id;
  const phoneNumber = phone.display_phone_number || "";
  const name = account.name || account.businessName || account.label || `BM ${index + 1}`;
  const verifiedName = phone.verified_name || name;
  return {
    ...account,
    id: `bm-${account.id || wabaId || index}-phone-${phoneNumberId}`,
    name: verifiedName,
    label: verifiedName,
    businessName: name,
    defaultPhoneNumberId: phoneNumberId,
    phoneNumberId,
    phoneNumber,
    verifiedName,
    qualityRating: phone.quality_rating || "",
    phoneStatus: phone.status || "",
    sender_number: phoneNumber || phoneNumberId || wabaId || "WABA conectada",
    senderNumber: phoneNumber || phoneNumberId || wabaId || "WABA conectada",
    api_type: "whatsapp_cloud",
    base_url: wabaId ? `WABA ${wabaId}` : "WhatsApp Cloud API",
    status: account.status || "connected",
  } as InfobipApi;
}

function normalizeConnectedSender(sender: ConnectedSender, index: number): InfobipApi {
  return {
    id: `connected-${sender.bmId || sender.wabaId || index}-phone-${sender.phoneNumberId}`,
    name: sender.verifiedName || sender.phone || sender.bmName || `Remetente ${index + 1}`,
    label: sender.verifiedName || sender.phone || sender.bmName || `Remetente ${index + 1}`,
    businessName: sender.bmName,
    defaultWabaId: sender.wabaId,
    wabaId: sender.wabaId,
    defaultPhoneNumberId: sender.phoneNumberId,
    phoneNumberId: sender.phoneNumberId,
    phoneNumber: sender.phone,
    verifiedName: sender.verifiedName,
    qualityRating: sender.quality,
    sender_number: sender.phone,
    senderNumber: sender.phone,
    api_type: "whatsapp_cloud",
    base_url: sender.wabaId ? `WABA ${sender.wabaId}` : "WhatsApp Cloud API",
    status: "connected",
  } as InfobipApi;
}

function senderDedupeKey(sender: InfobipApi) {
  const wabaId = String(sender.defaultWabaId || sender.wabaId || "").trim();
  const phoneNumberId = String(sender.defaultPhoneNumberId || sender.phoneNumberId || "").trim();
  const phone = onlyDigits(sender.phoneNumber || sender.sender_number || sender.senderNumber);
  if (wabaId && phoneNumberId) return `waba-phone-id:${wabaId}:${phoneNumberId}`;
  if (phoneNumberId) return `phone-id:${phoneNumberId}`;
  if (wabaId && phone) return `waba-phone:${wabaId}:${phone}`;
  if (phone) return `phone:${phone}`;
  return `id:${sender.id}`;
}

function readBmSenders(): InfobipApi[] {
  const accounts: BmSettingsData[] = [];
  try {
    const storedAccounts = JSON.parse(localStorage.getItem(LOCAL_BM_ACCOUNTS_KEY) || "[]");
    if (Array.isArray(storedAccounts)) accounts.push(...storedAccounts);
  } catch {
    // localStorage legacy entries are optional.
  }
  try {
    const singleSettings = JSON.parse(localStorage.getItem(LOCAL_BM_SETTINGS_KEY) || "{}") as BmSettingsData;
    if (singleSettings && (singleSettings.accessToken || singleSettings.defaultWabaId || singleSettings.wabaId)) {
      accounts.push(singleSettings);
    }
  } catch {
    // ignore malformed local settings.
  }

  const connected = readConnectedSenders();
  const normalizedConnected = connected.map(normalizeConnectedSender);
  const accountPhoneSenders = accounts.flatMap((account, accountIndex) => {
    const wabaId = account.defaultWabaId || account.wabaId || "";
    const connectedPhoneIds = new Set([
      account.defaultPhoneNumberId || account.phoneNumberId || "",
      ...(account.connectedPhoneIds || []),
      ...connected.filter((sender) => sender.bmId === accountKey(account) || sender.wabaId === wabaId).map((sender) => sender.phoneNumberId),
    ].filter(Boolean));
    const phoneSenders = (account.phones || [])
      .filter((phone) => connectedPhoneIds.has(phone.id))
      .map((phone) => normalizePhoneSender(account, phone, accountIndex));
    if (phoneSenders.length) return phoneSenders;
    const fallbackPhoneId = account.defaultPhoneNumberId || account.phoneNumberId || "";
    if (!fallbackPhoneId) return [];
    return [
      {
        ...account,
        id: `bm-${account.id || wabaId || accountIndex}-phone-${fallbackPhoneId}`,
        name: account.name || account.businessName || account.label || "Remetente conectado",
        label: account.name || account.businessName || account.label || "Remetente conectado",
        businessName: account.name || account.businessName || account.label,
        defaultWabaId: wabaId,
        wabaId,
        defaultPhoneNumberId: fallbackPhoneId,
        phoneNumberId: fallbackPhoneId,
        phoneNumber: account.phoneNumber || fallbackPhoneId,
        verifiedName: account.name || account.businessName || account.label,
        sender_number: account.phoneNumber || fallbackPhoneId,
        senderNumber: account.phoneNumber || fallbackPhoneId,
        api_type: "whatsapp_cloud",
        base_url: wabaId ? `WABA ${wabaId}` : "WhatsApp Cloud API",
        status: account.status || "connected",
      } as InfobipApi,
    ];
  });

  return dedupeSenders([...normalizedConnected, ...accountPhoneSenders]);
}

function readBmAccounts(): BmSettingsData[] {
  const accounts: BmSettingsData[] = [];
  try {
    const storedAccounts = JSON.parse(localStorage.getItem(LOCAL_BM_ACCOUNTS_KEY) || "[]");
    if (Array.isArray(storedAccounts)) accounts.push(...storedAccounts);
  } catch {
    // optional local data.
  }
  try {
    const singleSettings = JSON.parse(localStorage.getItem(LOCAL_BM_SETTINGS_KEY) || "{}") as BmSettingsData;
    if (singleSettings && (singleSettings.accessToken || singleSettings.defaultWabaId || singleSettings.wabaId)) {
      accounts.push(singleSettings);
    }
  } catch {
    // optional legacy local data.
  }

  return accounts.filter((account, index) => {
    const key = account.id || account.defaultWabaId || account.wabaId || account.accessToken || String(index);
    return accounts.findIndex((item, itemIndex) => (item.id || item.defaultWabaId || item.wabaId || item.accessToken || String(itemIndex)) === key) === index;
  });
}

function senderToBmAccount(sender: InfobipApi): BmSettingsData | null {
  const token = String(
    sender.accessToken ||
      sender.token ||
      sender.api_token ||
      sender.apiToken ||
      sender.bearer_token ||
      sender.bearerToken ||
      "",
  ).trim();
  const rawWaba = String(sender.defaultWabaId || sender.wabaId || sender.waba_id || sender.base_url || sender.sender_number || sender.senderNumber || "").trim();
  const wabaId = onlyDigits(rawWaba).length >= 12 ? onlyDigits(rawWaba) : rawWaba;
  if (!token || !wabaId) return null;

  return {
    id: String(sender.bmId || sender.id || wabaId),
    name: String(sender.businessName || sender.name || sender.label || "BM conectada"),
    businessName: String(sender.businessName || sender.name || sender.label || "BM conectada"),
    accessToken: token,
    defaultWabaId: wabaId,
    wabaId,
    defaultPhoneNumberId: String(sender.defaultPhoneNumberId || sender.phoneNumberId || ""),
    phoneNumberId: String(sender.defaultPhoneNumberId || sender.phoneNumberId || ""),
    phoneNumber: String(sender.phoneNumber || sender.sender_number || sender.senderNumber || ""),
    status: String(sender.status || "connected"),
  };
}

function findAccountForSender(sender?: InfobipApi) {
  if (!sender) return undefined;
  const senderWaba = String(sender.defaultWabaId || sender.wabaId || "").trim();
  const senderPhoneId = String(sender.defaultPhoneNumberId || sender.phoneNumberId || "").trim();
  const senderBm = String(sender.bmId || "").trim();
  return readBmAccounts().find((account) => {
    const accountWaba = String(account.defaultWabaId || account.wabaId || "").trim();
    const accountKeyValue = accountKey(account);
    const phones = account.phones || [];
    return (
      (senderBm && accountKeyValue === senderBm) ||
      (senderWaba && accountWaba === senderWaba) ||
      (senderPhoneId && phones.some((phone) => phone.id === senderPhoneId))
    );
  });
}

async function metaGet<T = Record<string, unknown>>(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${GRAPH_API_BASE}/${path.replace(/^\//, "")}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = data as { error?: { message?: string; error_user_msg?: string }; message?: string };
    throw new Error(record.error?.error_user_msg || record.error?.message || record.message || `Meta retornou HTTP ${response.status}`);
  }
  return data as T;
}

async function metaPost<T = Record<string, unknown>>(path: string, token: string, body: unknown) {
  const response = await fetch(`${GRAPH_API_BASE}/${path.replace(/^\//, "")}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = data as { error?: { message?: string; error_user_msg?: string; code?: number; error_subcode?: number }; message?: string };
    const parts = [
      record.error?.error_user_msg || record.error?.message || record.message || `Meta retornou HTTP ${response.status}`,
      record.error?.code ? `codigo ${record.error.code}` : "",
      record.error?.error_subcode ? `subcodigo ${record.error.error_subcode}` : "",
    ].filter(Boolean);
    throw new Error(parts.join(" | "));
  }
  return data as T;
}

function metaTemplateToSavedTemplate(template: MetaMessageTemplate, account: BmSettingsData): SavedTemplate {
  const wabaId = account.defaultWabaId || account.wabaId || "";
  const body = template.components?.find((component) => String(component.type || "").toUpperCase() === "BODY")?.text || "";
  const footer = template.components?.find((component) => String(component.type || "").toUpperCase() === "FOOTER")?.text || "";
  const header = template.components?.find((component) => String(component.type || "").toUpperCase() === "HEADER");
  const buttons = template.components?.find((component) => String(component.type || "").toUpperCase() === "BUTTONS")?.buttons || [];
  const mediaType = String(header?.format || "").toLowerCase();

  return {
    id: String(template.id || `${wabaId}-${template.name}-${template.language || "default"}`),
    name: template.name,
    folder: "Meta",
    body_text: body,
    footer_text: footer,
    buttons,
    language: template.language,
    category: template.category,
    meta_status: String(template.status || ""),
    status: String(template.status || ""),
    media_type: mediaType,
    header_type: mediaType,
    waba_id: wabaId,
    bm_id: account.id || wabaId,
    bm_name: account.name || account.businessName || wabaId || "BM conectada",
  } as SavedTemplate;
}

function cachedMetaTemplateToSavedTemplate(template: MetaMessageTemplate): SavedTemplate {
  const body = template.components?.find((component) => String(component.type || "").toUpperCase() === "BODY")?.text || "";
  const footer = template.components?.find((component) => String(component.type || "").toUpperCase() === "FOOTER")?.text || "";
  const header = template.components?.find((component) => String(component.type || "").toUpperCase() === "HEADER");
  const buttons = template.components?.find((component) => String(component.type || "").toUpperCase() === "BUTTONS")?.buttons || [];
  const mediaType = String(header?.format || "").toLowerCase();
  const wabaId = String(template.waba_id || "").trim();

  return {
    id: String(template.id || `${wabaId || "meta"}-${template.name}-${template.language || "default"}`),
    name: template.name,
    folder: "Meta",
    body_text: body,
    footer_text: footer,
    buttons,
    language: template.language,
    category: template.category,
    meta_status: String(template.status || ""),
    status: String(template.status || ""),
    media_type: mediaType,
    header_type: mediaType,
    waba_id: wabaId,
    bm_id: template.bm_id,
    bm_name: template.bm_name,
  } as SavedTemplate;
}

function readCachedMetaTemplates() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_META_SENT_TEMPLATES_KEY) || "{}") as { templates?: MetaMessageTemplate[] };
    const templates = Array.isArray(stored.templates) ? stored.templates : [];
    return templates.map(cachedMetaTemplateToSavedTemplate).filter(isApprovedTemplate);
  } catch {
    return [];
  }
}

function templateDedupeKey(template: SavedTemplate) {
  const wabaId = String(template.waba_id || "").trim();
  const name = String(template.name || "").trim().toLowerCase();
  const language = String(template.language || "").trim().toLowerCase();
  return wabaId ? `waba:${wabaId}:${name}:${language}` : `name:${name}:${language}`;
}

function dedupeTemplates(templatesToDedupe: SavedTemplate[]) {
  const seen = new Set<string>();
  return templatesToDedupe.filter((template) => {
    const name = String(template.name || "").trim().toLowerCase();
    const language = String(template.language || "").trim().toLowerCase();
    const genericKey = `name:${name}:${language}`;
    const specificKey = templateDedupeKey(template);
    if (seen.has(specificKey) || seen.has(genericKey)) return false;
    seen.add(specificKey);
    seen.add(genericKey);
    return true;
  });
}

function dedupeSenders(sendersToDedupe: InfobipApi[]) {
  const seen = new Set<string>();
  return sendersToDedupe.filter((sender) => {
    const key = senderDedupeKey(sender);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchApprovedMetaTemplatesFromBmAccounts(extraAccounts: BmSettingsData[] = []) {
  const results: SavedTemplate[] = [];
  const errors: string[] = [];

  const accounts = [...readBmAccounts(), ...extraAccounts].filter((account, index, list) => {
    const key = accountKey(account, String(index));
    return list.findIndex((item, itemIndex) => accountKey(item, String(itemIndex)) === key) === index;
  });

  for (const account of accounts) {
    const token = account.accessToken?.trim();
    const wabaId = account.defaultWabaId || account.wabaId || "";
    const bmName = account.name || account.businessName || wabaId || "BM conectada";

    if (!token || !wabaId) {
      if (wabaId || token) errors.push(`${bmName}: faltam WABA ID ou token.`);
      continue;
    }

    try {
      const response = await metaGet<{ data?: MetaMessageTemplate[] }>(`${wabaId}/message_templates`, token, {
        fields: "id,name,status,language,category,components",
        limit: "250",
      });
      results.push(
        ...(response.data || [])
          .map((template) => metaTemplateToSavedTemplate(template, account))
          .filter(isApprovedTemplate)
      );
    } catch (error) {
      errors.push(`${bmName}: ${error instanceof Error ? error.message : "falha ao buscar templates"}`);
    }
  }

  return { templates: results, errors };
}

async function fetchBackendMessageTemplates() {
  const payload = await apiGet<unknown>("/message_templates");
  return unwrapList<SavedTemplate>(payload).map((template) => ({
    ...template,
    folder: template.folder || "Meta",
    meta_status: String(template.meta_status || template.status || ""),
  }));
}

function readStored<T>(key: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) || "{}") };
  } catch {
    return fallback;
  }
}

function readStoredList<T>(key: string): T[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function persistBroadcastCampaigns(items: BroadcastCampaign[]) {
  localStorage.setItem(LOCAL_BROADCAST_CAMPAIGNS_KEY, JSON.stringify(items));
}

function normalizeCampaignStatus(status: unknown): BroadcastCampaignStatus {
  const value = String(status || "").toLowerCase();
  if (value === "sending" || value === "done" || value === "failed") return value;
  return "draft";
}

function readBroadcastCampaigns(): BroadcastCampaign[] {
  return readStoredList<Partial<BroadcastCampaign>>(LOCAL_BROADCAST_CAMPAIGNS_KEY)
    .filter((item) => item && item.id && item.name)
    .map((item) => {
      const channel: BroadcastCampaign["channel"] = item.channel === "Janela 24h" ? "Janela 24h" : "Cloud API";
      return {
        id: String(item.id),
        name: String(item.name),
        channel,
        description: String(item.description || ""),
        delivered: Number(item.delivered || 0),
        failed: Number(item.failed || 0),
        pending: Number(item.pending || 0),
        total: Number(item.total || 0),
        lots: Number(item.lots || 0),
        status: normalizeCampaignStatus(item.status),
        createdAt: item.createdAt || new Date().toISOString(),
        createdBy: item.createdBy || "Admin",
        updatedAt: item.updatedAt,
      };
    });
}

function campaignStatusLabel(status: BroadcastCampaignStatus) {
  if (status === "done") return "Concluida";
  if (status === "sending") return "Enviando";
  if (status === "failed") return "Falhou";
  return "Rascunho";
}

function formatCampaignDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function contactCount(tag: ContactTag) {
  const value = Number(tag.contacts_count ?? tag.count ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function contactPhone(contact: ContactItem) {
  return String(contact.phone || contact.telefone || contact.whatsapp || contact.numero || contact.celular || "");
}

function normalizeRecipientPhone(value: unknown) {
  const digits = onlyDigits(value);
  if (!digits) return "";
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function readLocalTagContacts(tag: ContactTag): BroadcastRecipient[] {
  try {
    const store = JSON.parse(localStorage.getItem("scaleapi.localContacts") || "{}") as Record<string, { tag: ContactTag; contacts: ContactItem[] }>;
    const entry = store[tag.id];
    if (!entry?.contacts?.length) return [];
    return entry.contacts
      .map((contact, index) => ({
        ...contact,
        id: contact.id || `${tag.id}-${index}`,
        phone: normalizeRecipientPhone(contactPhone(contact)),
        tagId: tag.id,
        tagName: tagDisplayName(tag),
      }))
      .filter((contact) => contact.phone);
  } catch {
    return [];
  }
}

async function fetchTagRecipients(tag: ContactTag): Promise<BroadcastRecipient[]> {
  const local = readLocalTagContacts(tag);
  if (local.length) return local;

  const expected = Math.max(contactCount(tag), 1);
  const pageSize = 500;
  const collected: ContactItem[] = [];
  for (let offset = 0; offset < expected + pageSize; offset += pageSize) {
    const payload = await contacts.tagContacts(tag.id, pageSize, offset);
    const page = unwrapList<ContactItem>(payload);
    if (!page.length) break;
    collected.push(...page);
    if (page.length < pageSize || collected.length >= expected) break;
  }

  return collected
    .map((contact, index) => ({
      ...contact,
      id: contact.id || `${tag.id}-${index}`,
      phone: normalizeRecipientPhone(contactPhone(contact)),
      tagId: tag.id,
      tagName: tagDisplayName(tag),
    }))
    .filter((contact) => contact.phone);
}

function senderLabel(sender: InfobipApi) {
  return String(sender.name || sender.label || sender.sender_number || sender.senderNumber || sender.id);
}

function senderNumber(sender: InfobipApi) {
  return String(sender.sender_number || sender.senderNumber || sender.base_url || "WhatsApp Cloud API");
}

function senderBusinessLabel(sender: InfobipApi) {
  return String(sender.businessName || sender.label || sender.base_url || "");
}

function templateStatus(template: SavedTemplate) {
  return String(template.meta_status || template.status || "").trim().toUpperCase();
}

function templateStatusLabel(template: SavedTemplate) {
  const status = templateStatus(template);
  if (status === "APPROVED") return "Aprovado";
  if (status === "PENDING") return "Em análise";
  if (status === "REJECTED") return "Rejeitado";
  if (status === "PAUSED") return "Pausado";
  return "Meta";
}

function isMetaTemplate(template: SavedTemplate) {
  const folder = String(template.folder || "").toLowerCase();
  return folder === "meta" || Boolean(template.waba_id || template.meta_status);
}

function isApprovedTemplate(template: SavedTemplate) {
  const status = templateStatus(template);
  return status === "APPROVED" || (!status && isMetaTemplate(template));
}

function tagDisplayName(tag: ContactTag) {
  const label = labelOf(tag, "");
  if (label) return label;
  return String(tag.id || "Etiqueta").replace(/^local-/, "");
}

function templateText(template: SavedTemplate) {
  return String(template.body_text || template.text || template.message || template.content || "");
}

function templateComponents(template: SavedTemplate) {
  return Array.isArray(template.components) ? template.components : [];
}

function templateHeaderComponent(template: SavedTemplate) {
  return templateComponents(template).find((component) => String(component.type || "").toUpperCase() === "HEADER");
}

function templateMediaType(template: SavedTemplate) {
  const header = templateHeaderComponent(template);
  const headerFormat = String(header?.format || "").toLowerCase();
  if (["image", "video", "document"].some((type) => headerFormat.includes(type))) return headerFormat;
  const legacyMediaType = String(template.media_type || template.header_type || template.type || "").toLowerCase();
  if (!templateComponents(template).length && ["image", "video", "document"].some((type) => legacyMediaType.includes(type))) {
    return legacyMediaType;
  }
  return "";
}

function templateNeedsMedia(template: SavedTemplate) {
  const mediaType = templateMediaType(template);
  return ["image", "video", "document"].some((type) => mediaType.includes(type));
}

function templateVariables(template: SavedTemplate) {
  const text = [
    templateText(template),
    String(template.footer_text || ""),
    JSON.stringify(template.buttons || []),
  ].join(" ");
  const matches = text.match(/\{\{\s*[\w.-]+\s*\}\}/g) || [];
  const variables = matches.map((item) => item.replace(/[{}]/g, "").trim()).filter(Boolean);
  const count = Number(template.variable_count || 0);
  for (let index = 1; index <= count; index += 1) variables.push(String(index));
  return Array.from(new Set(variables)).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

function applyVariables(text: string, values: Record<string, string>) {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, variable: string) => values[variable] || `{{${variable}}}`);
}

function renderTemplateLineBreaks(text: string) {
  return String(text || "").replace(/\v/g, "\n");
}

function insertTextAtSelection(value: string, insert: string, start?: number | null, end?: number | null) {
  const safeStart = typeof start === "number" ? start : value.length;
  const safeEnd = typeof end === "number" ? end : safeStart;
  return `${value.slice(0, safeStart)}${insert}${value.slice(safeEnd)}`;
}

function normalizeTemplateParameterText(value: string) {
  return String(value || "")
    .replace(/\v/g, "\n")
    .replace(/\r\n?/g, "\n")
    .replace(/\t+/g, " ")
    .replace(/ {5,}/g, "    ")
    .trim();
}

function sameVariableValues(left: Record<string, string>, right: Record<string, unknown>) {
  const leftKeys = Object.keys(left).filter((key) => String(left[key] || "").trim());
  if (!leftKeys.length) return false;
  return leftKeys.every((key) => String(left[key] || "").trim() === String(right[key] || right[`{{${key}}}`] || "").trim());
}

function orderedTemplateVariables(template: SavedTemplate) {
  return templateVariables(template);
}

function resolveHeaderMediaType(template: SavedTemplate, customization: TemplateCustomization) {
  const mediaType = String(customization.mediaType || templateMediaType(template) || "image").toLowerCase();
  if (mediaType.includes("video")) return "video";
  if (mediaType.includes("document")) return "document";
  if (mediaType.includes("image") || mediaType.includes("media")) return "image";
  return "image";
}

function buildMetaMessagePayload(params: {
  to: string;
  template: SavedTemplate;
  customization: TemplateCustomization;
}) {
  const { to, template, customization } = params;
  const components: Array<Record<string, unknown>> = [];
  const mediaUrl = String(customization.mediaUrl || "").trim();

  if (templateNeedsMedia(template) && mediaUrl) {
    const type = resolveHeaderMediaType(template, customization);
    components.push({
      type: "header",
      parameters: [
        {
          type,
          [type]: {
            link: mediaUrl,
          },
        },
      ],
    });
  }

  const bodyParameters = orderedTemplateVariables(template)
    .map((variable) => normalizeTemplateParameterText(customization.variables[variable] || ""))
    .filter(Boolean)
    .map((text) => ({ type: "text", text }));

  if (bodyParameters.length) {
    components.push({
      type: "body",
      parameters: bodyParameters,
    });
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: template.name,
      language: {
        code: String(template.language || "pt_BR"),
      },
      ...(components.length ? { components } : {}),
    },
  };
}

function emptyCustomization(): TemplateCustomization {
  return {
    variables: {},
    mediaUrl: "",
    mediaName: "",
    mediaType: "",
  };
}

function toggleValue(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function percent(run: BroadcastRun) {
  if (!run.total) return 0;
  return Math.min(100, Math.round(((run.delivered + run.failed) / run.total) * 100));
}

function acceptedRate(run: BroadcastRun) {
  if (!run.total) return 0;
  return Math.min(100, Math.round((run.accepted / run.total) * 100));
}

function successRate(run: BroadcastRun) {
  const completed = run.delivered + run.failed;
  if (!completed) return 0;
  return Math.round((run.delivered / completed) * 100);
}

function failureRate(run: BroadcastRun) {
  const completed = run.delivered + run.failed;
  if (!completed) return 0;
  return Math.round((run.failed / completed) * 100);
}

function normalizeRun(run: BroadcastRun): BroadcastRun {
  return {
    ...defaultRun,
    ...run,
    events: Array.isArray(run.events) ? run.events : [],
    messageIds: Array.isArray(run.messageIds) ? run.messageIds : [],
    statusByMessageId: run.statusByMessageId && typeof run.statusByMessageId === "object" ? run.statusByMessageId : {},
    accepted: Number(run.accepted || 0),
    processing: Number(run.processing || 0),
  };
}

function movyBackendUrl() {
  const configured = config.mediaBackendUrl || config.localBackendUrl;
  if (/^https?:\/\//i.test(configured)) return configured.replace(/\/$/, "");
  const origin =
    typeof window !== "undefined" && window.location.origin && !window.location.origin.includes("localhost")
      ? window.location.origin
      : config.publicAppUrl;
  return `${origin.replace(/\/$/, "")}/${configured.replace(/^\/+|\/+$/g, "")}`;
}

function absoluteMediaUrl(value?: string) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/local-api/")) return `${config.publicAppUrl.replace(/\/$/, "")}${url}`;
  if (url.startsWith("/media/files/")) return `${movyBackendUrl()}${url}`;
  if (url.startsWith("/")) return `${movyBackendUrl()}${url}`;
  return url;
}

function normalizeMediaLibraryItem(item: LocalMediaItem): LocalMediaItem {
  const storagePath =
    item.storagePath ||
    String(item.url || item.public_url || "").match(/\/media\/files\/[^?#]+/)?.[0] ||
    "";
  const url = absoluteMediaUrl(item.public_url || item.url || storagePath);
  return {
    ...item,
    storagePath,
    url,
    public_url: url,
  };
}

function mediaItemUrl(item: LocalMediaItem) {
  return absoluteMediaUrl(item.public_url || item.url || item.storagePath);
}

function mediaItemName(item: LocalMediaItem) {
  return String(item.name || item.file_name || mediaItemUrl(item).split("/").pop() || "Midia salva");
}

function mediaItemKind(item: LocalMediaItem) {
  const type = String(item.type || "").toLowerCase();
  const url = mediaItemUrl(item).toLowerCase();
  if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) return "image";
  if (type.startsWith("video/") || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) return "video";
  if (type.includes("pdf") || /\.(pdf|docx?|xlsx?|csv)(\?|$)/i.test(url)) return "document";
  return "document";
}

async function readBroadcastMediaLibrary() {
  const byId = new Map<string, LocalMediaItem>();
  const addItems = (items: LocalMediaItem[]) => {
    items.map(normalizeMediaLibraryItem).forEach((item, index) => {
      const url = mediaItemUrl(item);
      if (!url) return;
      byId.set(String(item.id || url || index), item);
    });
  };

  await mediaService.normalizedList().then((items) => addItems(items as LocalMediaItem[])).catch(() => null);

  try {
    const response = await fetch(`${movyBackendUrl()}/storage/${encodeURIComponent(MEDIA_LIBRARY_KEY)}`);
    const payload = await response.json().catch(() => ({}));
    if (Array.isArray(payload.value)) addItems(payload.value as LocalMediaItem[]);
  } catch {
    try {
      addItems(JSON.parse(localStorage.getItem(MEDIA_LIBRARY_KEY) || "[]") as LocalMediaItem[]);
    } catch {
      // local library unavailable
    }
  }

  return Array.from(byId.values());
}

async function fetchLocalMessageStatuses(messageIds: string[]) {
  if (!messageIds.length) return [];
  const response = await fetch(`${movyBackendUrl()}/broadcast/statuses?ids=${encodeURIComponent(messageIds.join(","))}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Status local HTTP ${response.status}`);
  return Array.isArray(data.statuses) ? (data.statuses as MessageStatus[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function formatBackendError(error: unknown) {
  const record = asRecord(error);
  const response = asRecord(record.response);
  const data = asRecord(response.data);
  const apiError = asRecord(data.error);
  const message =
    apiError.error_user_msg ||
    apiError.message ||
    data.error_message ||
    data.message ||
    record.message ||
    "erro desconhecido";
  const code = apiError.code || data.code || response.status;
  const subcode = apiError.error_subcode || data.error_subcode;
  return [String(message), code ? `codigo ${code}` : "", subcode ? `subcodigo ${subcode}` : ""].filter(Boolean).join(" | ");
}

function numberFromResponse(record: Record<string, unknown>, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  const totals = asRecord(record.totals);
  for (const key of keys) {
    const value = Number(totals[key]);
    if (Number.isFinite(value)) return value;
  }
  const summary = asRecord(record.summary);
  for (const key of keys) {
    const value = Number(summary[key]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function arrayFromResponse(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  const data = asRecord(record.data);
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function backendMessageIds(response: unknown) {
  const record = asRecord(response);
  const messages = arrayFromResponse(record, ["messageIds", "message_ids", "messages", "results", "items"]);
  return Array.from(
    new Set(
      messages
        .map((item) => {
          if (typeof item === "string") return item;
          const itemRecord = asRecord(item);
          return String(itemRecord.id || itemRecord.messageId || itemRecord.message_id || itemRecord.wamid || itemRecord.wamId || "");
        })
        .filter(Boolean),
    ),
  );
}

function responseEvents(response: unknown): RunEvent[] {
  const record = asRecord(response);
  const rawEvents = arrayFromResponse(record, ["events", "logs", "results", "items"]).slice(0, 20);
  return rawEvents.map((item) => {
    const itemRecord = asRecord(item);
    const statusValue = String(itemRecord.status || itemRecord.type || "").toLowerCase();
    const isFailed = ["failed", "error", "rejected"].includes(statusValue) || Boolean(itemRecord.error || itemRecord.errorMessage);
    const phone = String(itemRecord.phone || itemRecord.to || itemRecord.recipient || itemRecord.recipientId || "");
    const message =
      itemRecord.message ||
      itemRecord.errorMessage ||
      itemRecord.error ||
      (phone ? `${phone} ${isFailed ? "falhou" : "aceito pelo sistema"}.` : "Evento retornado pelo sistema.");
    return {
      id: crypto.randomUUID(),
      type: isFailed ? "failed" : "success",
      message: String(message),
      time: nowTime(),
    } as RunEvent;
  });
}

async function dispatchThroughSystem(payload: Record<string, unknown>, runtimeCredentials?: Record<string, unknown>) {
  const localBody = {
    ...payload,
    runtimeCredentials,
  };
  try {
    const response = await fetch(`${movyBackendUrl()}/broadcasts/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(localBody),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const record = asRecord(data);
      const details = arrayFromResponse(record, ["events", "results"])
        .map((item) => String(asRecord(item).message || asRecord(item).errorMessage || asRecord(item).error || ""))
        .filter(Boolean)
        .slice(0, 3)
        .join(" | ");
      throw new Error(String(record.message || record.error || details || `servidor local HTTP ${response.status}`));
    }
    return data;
  } catch (localError) {
    if (localError instanceof Error && !/Failed to fetch|NetworkError|Network Error/i.test(localError.message)) {
      throw localError;
    }
  }

  try {
    return await broadcasts.dispatch(payload);
  } catch (dispatchError) {
    try {
      const created = await broadcasts.create(payload);
      const createdRecord = asRecord(created);
      const id = String(createdRecord.id || asRecord(createdRecord.data).id || payload.id || "");
      if (!id) {
        throw new Error("o backend criou o lote, mas nao retornou ID para iniciar o disparo");
      }
      try {
        return await broadcasts.start(id, { payload, broadcastId: id });
      } catch (startError) {
        throw new Error(`lote criado, mas nao iniciou o disparo: ${formatBackendError(startError)}`);
      }
    } catch (createError) {
      throw new Error(`dispatch: ${formatBackendError(dispatchError)} | create/start: ${formatBackendError(createError)}`);
    }
  }
}

function buildDispatchPayload(params: {
  plan: BroadcastPlan;
  sender?: InfobipApi;
  templates: SavedTemplate[];
  tags: ContactTag[];
  distribution: BroadcastDistributionItem[];
  totalContacts: number;
}) {
  const { plan, sender, templates, tags, distribution, totalContacts } = params;
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "created",
    channel: "whatsapp_cloud",
    sender: sender
      ? {
          id: sender.id,
          name: senderLabel(sender),
          bmName: senderBusinessLabel(sender),
          wabaId: sender.defaultWabaId || sender.wabaId || "",
          phoneNumberId: sender.phoneNumberId || sender.defaultPhoneNumberId || "",
          phoneNumber: sender.phoneNumber || senderNumber(sender),
          apiType: sender.api_type || "whatsapp_cloud",
        }
      : {
          id: "manual",
          name: plan.manualSender,
          phoneNumber: plan.manualSender,
          apiType: "manual_test",
        },
    totals: {
      templates: templates.length,
      tags: tags.length,
      contacts: totalContacts,
      lots: Math.max(1, distribution.length),
    },
    mode: plan.mode,
    lots: distribution.map((item, index) => {
      const lotSender = item.sender || sender;
      const customization = plan.customizations[item.customizationKey] || plan.customizations[item.template.id] || emptyCustomization();
      const lotId = `${lotSender?.id || "manual"}-${item.template.id}-${item.tag.id}`;
      return {
        id: lotId,
        index: index + 1,
        sender: lotSender
          ? {
              id: lotSender.id,
              name: senderLabel(lotSender),
              bmName: senderBusinessLabel(lotSender),
              wabaId: lotSender.defaultWabaId || lotSender.wabaId || "",
              phoneNumberId: lotSender.phoneNumberId || lotSender.defaultPhoneNumberId || "",
              phoneNumber: lotSender.phoneNumber || senderNumber(lotSender),
              accessToken: lotSender.accessToken || lotSender.token || "",
              apiType: lotSender.api_type || "whatsapp_cloud",
            }
          : null,
        template: {
          id: item.template.id,
          name: item.template.name,
          language: item.template.language || "pt_BR",
          body_text: templateText(item.template),
          header_text: item.template.header_text || item.template.headerText || "",
          footer_text: item.template.footer_text || "",
          buttons: item.template.buttons || [],
          components: item.template.components || [],
          media_type: item.template.media_type || "",
          header_type: item.template.header_type || "",
          wabaId: item.template.waba_id || lotSender?.defaultWabaId || lotSender?.wabaId || "",
          variables: customization.variables,
          media: customization.mediaUrl || customization.mediaName
            ? {
                url: customization.mediaUrl,
                name: customization.mediaName,
                type: customization.mediaType || templateMediaType(item.template),
              }
            : null,
        },
        audience: {
          tagId: item.tag.id,
          tagName: tagDisplayName(item.tag),
          contacts: contactCount(item.tag),
        },
      };
    }),
  };
}

type BroadcastProps = {
  mode?: BroadcastMode;
};

export function Broadcast({ mode = "simple" }: BroadcastProps) {
  const [activeStep, setActiveStep] = useState<WizardStep>("sender");
  const [plan, setPlan] = useState<BroadcastPlan>(() => normalizeBroadcastPlan({ ...readStored(LOCAL_BROADCAST_PLAN_KEY, defaultPlan), mode }));
  const [run, setRun] = useState<BroadcastRun>(() => normalizeRun(readStored(LOCAL_BROADCAST_RUN_KEY, defaultRun)));
  const [senders, setSenders] = useState<InfobipApi[]>([]);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [tags, setTags] = useState<ContactTag[]>([]);
  const [mediaLibrary, setMediaLibrary] = useState<LocalMediaItem[]>([]);
  const [senderQuery, setSenderQuery] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [activeCustomizeTemplateId, setActiveCustomizeTemplateId] = useState("");
  const [loading, setLoading] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [status, setStatus] = useState("");
  const [broadcastView, setBroadcastView] = useState<"dashboard" | "wizard">(mode === "simple" ? "dashboard" : "wizard");
  const [campaigns, setCampaigns] = useState<BroadcastCampaign[]>(() => readBroadcastCampaigns());
  const [expandedCampaignId, setExpandedCampaignId] = useState("");
  const [activeCampaignId, setActiveCampaignId] = useState("");
  const [campaignQuery, setCampaignQuery] = useState("");
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<"all" | BroadcastCampaignStatus>("all");
  const [campaignModalOpen, setCampaignModalOpen] = useState(false);
  const [campaignForm, setCampaignForm] = useState({
    name: "",
    channel: "Cloud API" as BroadcastCampaign["channel"],
    description: "",
  });
  const fixedMode = mode;

  const selectedSender = useMemo(
    () => senders.find((sender) => sender.id === plan.senderId),
    [plan.senderId, senders],
  );
  const isRandomMode = plan.mode === "random";
  const selectedSenders = useMemo(() => {
    const ids = plan.senderIds.length ? plan.senderIds : isRandomMode && plan.senderId ? [plan.senderId] : [];
    return senders.filter((sender) => ids.includes(sender.id));
  }, [isRandomMode, plan.senderId, plan.senderIds, senders]);
  const senderPool = isRandomMode ? selectedSenders : selectedSender ? [selectedSender] : [];
  const templatesForSender = useCallback(
    (sender?: InfobipApi) => {
      const senderWaba = String(sender?.defaultWabaId || sender?.wabaId || "").trim();
      if (!senderWaba) return templates;
      const matchedTemplates = templates.filter((template) => !template.waba_id || String(template.waba_id).trim() === senderWaba);
      return matchedTemplates.length ? matchedTemplates : templates;
    },
    [templates],
  );
  const availableTemplates = useMemo(() => {
    if (isRandomMode && selectedSenders.length) {
      const byId = new Map<string, SavedTemplate>();
      selectedSenders.forEach((sender) => templatesForSender(sender).forEach((template) => byId.set(template.id, template)));
      return Array.from(byId.values());
    }
    return templatesForSender(selectedSender);
  }, [isRandomMode, selectedSender, selectedSenders, templatesForSender]);
  const selectedTemplates = useMemo(() => {
    if (!isRandomMode) return availableTemplates.filter((template) => plan.templateIds.includes(template.id));
    const byId = new Map<string, SavedTemplate>();
    selectedSenders.forEach((sender) => {
      const selectedIds = plan.templatesBySender[sender.id] || [];
      templatesForSender(sender)
        .filter((template) => selectedIds.includes(template.id))
        .forEach((template) => byId.set(template.id, template));
    });
    return Array.from(byId.values());
  }, [availableTemplates, isRandomMode, plan.templateIds, plan.templatesBySender, selectedSenders, templatesForSender]);
  const selectedTemplateItems = useMemo<BroadcastTemplateSelection[]>(() => {
    if (!isRandomMode) {
      return selectedTemplates.map((template) => ({
        key: template.id,
        template,
        label: template.name,
      }));
    }
    return selectedSenders.flatMap((sender) =>
      templatesForSender(sender)
        .filter((template) => (plan.templatesBySender[sender.id] || []).includes(template.id))
        .map((template) => ({
          key: `${sender.id}:${template.id}`,
          sender,
          template,
          label: `${senderLabel(sender)} • ${template.name}`,
        })),
    );
  }, [isRandomMode, plan.templatesBySender, selectedSenders, selectedTemplates, templatesForSender]);
  const filteredSenders = useMemo(() => {
    const query = senderQuery.trim().toLowerCase();
    return [...senders]
      .sort((a, b) => senderLabel(a).localeCompare(senderLabel(b), "pt-BR"))
      .filter((sender) => {
        if (!query) return true;
        return [
          senderLabel(sender),
          senderNumber(sender),
          senderBusinessLabel(sender),
          String(sender.id || ""),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      });
  }, [senderQuery, senders]);
  const filteredTemplates = useMemo(() => {
    const query = templateQuery.trim().toLowerCase();
    return availableTemplates.filter((template) => {
      if (!query) return true;
      return [
        template.name,
        templateText(template),
        templateStatusLabel(template),
        String(template.id || ""),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [availableTemplates, templateQuery]);
  const selectedTags = useMemo(() => tags.filter((tag) => plan.tagIds.includes(tag.id)), [plan.tagIds, tags]);
  const filteredTags = useMemo(() => {
    const query = tagQuery.trim().toLowerCase();
    return [...tags]
      .sort((a, b) => tagDisplayName(a).localeCompare(tagDisplayName(b), "pt-BR"))
      .filter((tag) => {
        if (!query) return true;
        return tagDisplayName(tag).toLowerCase().includes(query) || String(tag.id).toLowerCase().includes(query);
      });
  }, [tagQuery, tags]);

  const distribution = useMemo(() => {
    if (!selectedTags.length || !selectedTemplates.length) return [];
    if (isRandomMode) {
      return selectedSenders.flatMap((sender) =>
        templatesForSender(sender)
          .filter((template) => (plan.templatesBySender[sender.id] || []).includes(template.id))
          .flatMap((template) =>
            selectedTags.map((tag) => ({
              sender,
              template,
              customizationKey: `${sender.id}:${template.id}`,
              tag,
            })),
          ),
      );
    }
    return selectedTemplates
      .map((template, index) => ({
        sender: selectedSender,
        template,
        customizationKey: template.id,
        tag: selectedTags[index],
      }))
      .filter((item) => item.tag);
  }, [isRandomMode, plan.templatesBySender, selectedSender, selectedSenders, selectedTags, selectedTemplates, templatesForSender]);

  const totalContacts = useMemo(
    () => selectedTags.reduce((sum, tag) => sum + contactCount(tag), 0),
    [selectedTags],
  );
  const filteredCampaigns = useMemo(() => {
    const query = campaignQuery.trim().toLowerCase();
    return campaigns
      .filter((campaign) => campaign.channel === "Cloud API")
      .filter((campaign) => campaignStatusFilter === "all" || campaign.status === campaignStatusFilter)
      .filter((campaign) => {
        if (!query) return true;
        return [campaign.name, campaign.description, campaign.createdBy, campaignStatusLabel(campaign.status)]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime());
  }, [campaignQuery, campaignStatusFilter, campaigns]);
  const dashboardTotals = useMemo(
    () =>
      campaigns.reduce(
        (acc, campaign) => ({
          total: acc.total + campaign.total,
          delivered: acc.delivered + campaign.delivered,
          failed: acc.failed + campaign.failed,
          pending: acc.pending + campaign.pending,
          lots: acc.lots + campaign.lots,
        }),
        { total: 0, delivered: 0, failed: 0, pending: 0, lots: 0 },
      ),
    [campaigns],
  );
  const activeCustomizeItem = selectedTemplateItems.find((item) => item.key === activeCustomizeTemplateId) || selectedTemplateItems[0];
  const activeCustomizeTemplate = activeCustomizeItem?.template;
  const activeCustomizationKey = activeCustomizeItem?.key || activeCustomizeTemplate?.id || "";
  const customizedTemplates = useMemo(
    () =>
      selectedTemplateItems.filter((item) => {
        const customization = plan.customizations[item.key] || emptyCustomization();
        const template = item.template;
        const hasVariables = templateVariables(template).every((variable) => customization.variables[variable]?.trim());
        const hasMedia = !templateNeedsMedia(template) || Boolean(customization.mediaUrl || customization.mediaName);
        return hasVariables && hasMedia;
      }),
    [plan.customizations, selectedTemplateItems],
  );

  const randomTemplatesReady =
    !isRandomMode ||
    (selectedSenders.length > 0 && selectedSenders.every((sender) => (plan.templatesBySender[sender.id] || []).length > 0));
  const senderReady = isRandomMode ? selectedSenders.length > 0 : Boolean(plan.senderId);
  const templatesReady = isRandomMode ? randomTemplatesReady : selectedTemplates.length > 0;
  const audienceReady = templatesReady && (isRandomMode ? selectedTags.length > 0 : selectedTags.length === selectedTemplates.length);
  const customizationsReady = templatesReady && customizedTemplates.length === selectedTemplateItems.length;
  const planReady = senderReady && templatesReady && audienceReady && customizationsReady;
  const stepIndex = steps.findIndex((step) => step.key === activeStep);
  const awaitingStatuses = run.accepted > 0 && run.pending > 0;
  const runLocked = isDispatching;
  const runStatusText =
    run.status === "idle"
      ? "Aguardando"
      : run.status === "paused"
        ? "Pausado"
        : awaitingStatuses
          ? "Aguardando status"
          : run.status === "done"
            ? "Finalizado"
            : "Enviando";

  async function loadOptions() {
    setLoading(true);
    try {
      const bmSenders = readBmSenders();
      const [remoteSenders, remoteMetaTemplates, remoteAllTemplates, backendMessageTemplates, remoteTags, savedMedia] = await Promise.all([
        withTimeout(infobipApis.normalizedList("whatsapp")).catch(() => infobipApis.normalizedList().catch(() => [])),
        withTimeout(savedTemplates.normalizedList("Meta")).catch(() => savedTemplates.normalizedList().catch(() => [])),
        withTimeout(savedTemplates.normalizedList()).catch(() => []),
        withTimeout(fetchBackendMessageTemplates()).catch(() => []),
        withTimeout(contacts.normalizedTags()).catch(() => []),
        withTimeout(readBroadcastMediaLibrary()).catch(() => []),
      ]);
      const senderAccounts = remoteSenders.map(senderToBmAccount).filter(Boolean) as BmSettingsData[];
      const directMetaResult = await withTimeout(fetchApprovedMetaTemplatesFromBmAccounts(senderAccounts), 5000).catch((error) => ({
        templates: [],
        errors: [error instanceof Error ? error.message : "falha ao buscar templates da Meta"],
      }));
      const localTags = readLocalContactTags();
      const cachedTemplates = readCachedMetaTemplates();
      const nextSenders = bmSenders.length ? bmSenders : dedupeSenders(remoteSenders);
      const remoteTemplates = dedupeTemplates([...remoteMetaTemplates, ...remoteAllTemplates, ...backendMessageTemplates]);
      const metaTemplates = remoteTemplates.filter(isMetaTemplate);
      const approvedTemplates = remoteTemplates.filter(isApprovedTemplate);
      const mergedTemplates = dedupeTemplates([
        ...directMetaResult.templates,
        ...approvedTemplates,
        ...cachedTemplates,
      ]);
      const fallbackTemplates = mergedTemplates.length
        ? mergedTemplates
        : dedupeTemplates(approvedTemplates.length ? [...approvedTemplates, ...cachedTemplates] : [...metaTemplates, ...cachedTemplates, ...remoteTemplates.filter(templateText)]);
      setSenders(nextSenders);
      setTemplates(fallbackTemplates);
      setTags([...localTags, ...remoteTags.filter((tag) => !localTags.some((localTag) => localTag.id === tag.id))]);
      setMediaLibrary(savedMedia);
      setStatus(
        `${nextSenders.length} remetente(s), ${fallbackTemplates.length} template(s) e ${localTags.length + remoteTags.length} etiqueta(s) carregados.` +
          (directMetaResult.errors.length ? ` Algumas BMs falharam: ${directMetaResult.errors.slice(0, 2).join(" | ")}` : "")
      );
    } finally {
      setLoading(false);
    }
  }

  function persistPlan(nextPlan: BroadcastPlan) {
    const normalized = normalizeBroadcastPlan(nextPlan);
    localStorage.setItem(LOCAL_BROADCAST_PLAN_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function updatePlan(nextPlan: BroadcastPlan | ((current: BroadcastPlan) => BroadcastPlan)) {
    setPlan((current) => {
      const resolved = typeof nextPlan === "function" ? nextPlan(current) : nextPlan;
      return persistPlan(resolved);
    });
  }

  function updateCustomization(templateId: string, patch: Partial<TemplateCustomization>) {
    updatePlan((currentPlan) => {
      const current = currentPlan.customizations[templateId] || emptyCustomization();
      return {
        ...currentPlan,
        customizations: {
          ...currentPlan.customizations,
          [templateId]: {
            ...current,
            ...patch,
            variables: patch.variables || current.variables,
          },
        },
      };
    });
  }

  function updateVariable(templateId: string, variable: string, value: string) {
    updatePlan((currentPlan) => {
      const current = currentPlan.customizations[templateId] || emptyCustomization();
      return {
        ...currentPlan,
        customizations: {
          ...currentPlan.customizations,
          [templateId]: {
            ...current,
            variables: {
              ...current.variables,
              [variable]: value,
            },
          },
        },
      };
    });
  }

  function toggleRandomSender(senderId: string) {
    updatePlan((currentPlan) => {
      const nextSenderIds = toggleValue(currentPlan.senderIds, senderId);
      const nextTemplatesBySender = { ...currentPlan.templatesBySender };
      const nextCustomizations = { ...currentPlan.customizations };
      if (!nextSenderIds.includes(senderId)) {
        delete nextTemplatesBySender[senderId];
        Object.keys(nextCustomizations).forEach((key) => {
          if (key.startsWith(`${senderId}:`)) delete nextCustomizations[key];
        });
      }
      return {
        ...currentPlan,
        senderIds: nextSenderIds,
        templatesBySender: nextTemplatesBySender,
        customizations: nextCustomizations,
      };
    });
  }

  function toggleTemplateForSender(senderId: string, templateId: string) {
    updatePlan((currentPlan) => {
      const currentTemplates = currentPlan.templatesBySender[senderId] || [];
      const selected = currentTemplates.includes(templateId);
      const nextCustomizations = { ...currentPlan.customizations };
      const customizationKey = `${senderId}:${templateId}`;
      const nextTemplates = toggleValue(currentTemplates, templateId);
      if (selected && !nextTemplates.includes(templateId)) {
        delete nextCustomizations[customizationKey];
      }
      if (!selected) {
        nextCustomizations[customizationKey] = nextCustomizations[customizationKey] || emptyCustomization();
      }
      return {
        ...currentPlan,
        templatesBySender: {
          ...currentPlan.templatesBySender,
          [senderId]: nextTemplates,
        },
        customizations: nextCustomizations,
      };
    });
  }

  function insertVariableBreak(templateId: string, variable: string, lines: number, textarea?: HTMLTextAreaElement | null) {
    const currentValue = (plan.customizations[templateId] || emptyCustomization()).variables[variable] || "";
    const insert = "\n".repeat(lines);
    const start = textarea?.selectionStart ?? currentValue.length;
    const nextValue = insertTextAtSelection(currentValue, insert, start, textarea?.selectionEnd);
    updateVariable(templateId, variable, nextValue);

    window.setTimeout(() => {
      if (!textarea) return;
      const nextCursor = start + insert.length;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  }

  function toggleTemplate(templateId: string) {
    updatePlan((currentPlan) => {
      const selected = currentPlan.templateIds.includes(templateId);
      const nextCustomizations = { ...currentPlan.customizations };
      if (selected) {
        delete nextCustomizations[templateId];
      } else {
        nextCustomizations[templateId] = emptyCustomization();
      }
      return {
        ...currentPlan,
        templateIds: toggleValue(currentPlan.templateIds, templateId),
        customizations: nextCustomizations,
      };
    });
  }

  function handleMediaFile(templateId: string, file: File | undefined) {
    if (!file) return;
    updateCustomization(templateId, {
      mediaName: file.name,
      mediaType: file.type || "arquivo",
      mediaUrl: URL.createObjectURL(file),
    });
  }

  function mediaChoicesForTemplate(template: SavedTemplate, customizationKey = template.id) {
    const expected = resolveHeaderMediaType(template, plan.customizations[customizationKey] || emptyCustomization());
    return [...mediaLibrary]
      .filter((item) => mediaItemUrl(item))
      .sort((left, right) => {
        const leftMatch = mediaItemKind(left) === expected ? 0 : 1;
        const rightMatch = mediaItemKind(right) === expected ? 0 : 1;
        return leftMatch - rightMatch || mediaItemName(left).localeCompare(mediaItemName(right), "pt-BR");
      })
      .slice(0, 8);
  }

  function selectSavedMedia(templateId: string, item: LocalMediaItem) {
    updateCustomization(templateId, {
      mediaName: mediaItemName(item),
      mediaType: item.type || mediaItemKind(item),
      mediaUrl: mediaItemUrl(item),
    });
  }

  function toggleTag(tagId: string) {
    const isSelected = plan.tagIds.includes(tagId);
    if (!isRandomMode && !isSelected && selectedTemplates.length && plan.tagIds.length >= selectedTemplates.length) {
      setStatus(`Você selecionou ${selectedTemplates.length} template(s). Remova uma etiqueta antes de escolher outra.`);
      return;
    }
    updatePlan({ ...plan, tagIds: toggleValue(plan.tagIds, tagId) });
  }

  function updateRun(nextRun: BroadcastRun) {
    const normalized = normalizeRun(nextRun);
    setRun(normalized);
    localStorage.setItem(LOCAL_BROADCAST_RUN_KEY, JSON.stringify(normalized));
  }

  function goNext() {
    const next = steps[Math.min(stepIndex + 1, steps.length - 1)];
    setActiveStep(next.key);
  }

  function goBack() {
    const previous = steps[Math.max(stepIndex - 1, 0)];
    setActiveStep(previous.key);
  }

  function startRun() {
    if (!planReady) {
      setStatus("Escolha remetente, templates, etiquetas e complete as customizações antes de iniciar.");
      return;
    }
    const total = Math.max(totalContacts, selectedTags.length);
    const payload = buildDispatchPayload({
      plan,
      sender: selectedSender,
      templates: selectedTemplates,
      tags: selectedTags,
      distribution,
      totalContacts,
    });
    localStorage.setItem(LOCAL_BROADCAST_PAYLOAD_KEY, JSON.stringify(payload));
    updateRun({
      status: "sending",
      total,
      accepted: 0,
      delivered: 0,
      pending: total,
      failed: 0,
      processing: Math.min(total, Math.max(1, Math.ceil(total * 0.02))),
      messageIds: [],
      statusByMessageId: {},
      events: [
        {
          id: crypto.randomUUID(),
          type: "info",
          message: `Lote criado com ${total.toLocaleString("pt-BR")} destinatários.`,
          time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        },
      ],
      startedAt: new Date().toISOString(),
    });
    setActiveStep("monitor");
    setStatus("Lote preparado para disparo oficial. Payload salvo localmente e acompanhamento iniciado.");
  }

  async function startSystemRun() {
    if (!planReady) {
      setStatus("Escolha remetente, templates, etiquetas e complete as customizacoes antes de iniciar.");
      return;
    }
    if (!senderPool.length) {
      setStatus("Selecione um remetente conectado antes de disparar.");
      return;
    }

    setIsDispatching(true);
    setActiveStep("monitor");
    setStatus("Preparando lote e carregando destinatarios...");

    const payload = buildDispatchPayload({
      plan,
      sender: senderPool[0],
      templates: selectedTemplates,
      tags: selectedTags,
      distribution,
      totalContacts,
    }) as Record<string, unknown>;
    const missingCredentials = senderPool.filter((sender) => {
      const account = findAccountForSender(sender);
      const phoneNumberId = String(sender.phoneNumberId || sender.defaultPhoneNumberId || account?.phoneNumberId || account?.defaultPhoneNumberId || "").trim();
      const accessToken = String(sender.accessToken || sender.token || account?.accessToken || "").trim();
      return !phoneNumberId || !accessToken;
    });
    if (missingCredentials.length) {
      setIsDispatching(false);
      setStatus(`Remetente sem Phone Number ID ou token: ${missingCredentials.map(senderLabel).join(", ")}. Confira Configuracoes BM e Registrar Remetente.`);
      return;
    }
    const primaryAccount = findAccountForSender(senderPool[0]);
    const phoneNumberId = String(senderPool[0].phoneNumberId || senderPool[0].defaultPhoneNumberId || primaryAccount?.phoneNumberId || primaryAccount?.defaultPhoneNumberId || "").trim();
    const accessToken = String(senderPool[0].accessToken || senderPool[0].token || primaryAccount?.accessToken || "").trim();

    const jobs: BroadcastJob[] = [];
    const recipientsByTag = new Map<string, BroadcastRecipient[]>();
    try {
      if (isRandomMode) {
        const allRecipients: BroadcastRecipient[] = [];
        for (const tag of selectedTags) {
          const recipients = await fetchTagRecipients(tag);
          recipientsByTag.set(tag.id, recipients);
          allRecipients.push(...recipients);
        }
        const senderSlots = selectedSenders
          .map((sender) => ({
            sender,
            cursor: 0,
            templates: templatesForSender(sender).filter((template) => (plan.templatesBySender[sender.id] || []).includes(template.id)),
          }))
          .filter((slot) => slot.templates.length);
        if (!senderSlots.length) throw new Error("nenhum template selecionado por remetente");

        allRecipients.forEach((recipient, index) => {
          const slot = senderSlots[index % senderSlots.length];
          const template = slot.templates[slot.cursor % slot.templates.length];
          slot.cursor += 1;
          const tagId = String(recipient.tagId || selectedTags[0]?.id || "");
          jobs.push({
            recipient,
            sender: slot.sender,
            template,
            customization: plan.customizations[`${slot.sender.id}:${template.id}`] || plan.customizations[template.id] || emptyCustomization(),
            lotId: `${slot.sender.id}-${template.id}-${tagId}`,
          });
        });
      } else {
        for (const item of distribution) {
          const recipients = await fetchTagRecipients(item.tag);
          recipientsByTag.set(item.tag.id, recipients);
          recipients.forEach((recipient) => {
            jobs.push({
              recipient,
              sender: item.sender || senderPool[0],
              template: item.template,
              customization: plan.customizations[item.customizationKey] || plan.customizations[item.template.id] || emptyCustomization(),
              lotId: `${item.sender?.id || senderPool[0]?.id || "manual"}-${item.template.id}-${item.tag.id}`,
            });
          });
        }
      }
    } catch (error) {
      setIsDispatching(false);
      setStatus(`Nao foi possivel carregar os contatos: ${error instanceof Error ? error.message : "falha desconhecida"}`);
      return;
    }

    const total = jobs.length;
    if (!total) {
      setIsDispatching(false);
      setStatus("Nenhum destinatario encontrado nas etiquetas selecionadas.");
      return;
    }

    const lots = Array.isArray(payload.lots) ? (payload.lots as Array<Record<string, unknown>>) : [];
    payload.status = "queued";
    payload.dispatchMode = "system";
    payload.requestedFrom = "movy-web";
    payload.totals = {
      ...asRecord(payload.totals),
      contacts: total,
      recipients: total,
      lots: Math.max(1, distribution.length),
    };
    const lotRows = new Map<string, BroadcastJob[]>();
    jobs.forEach((job) => {
      const key = job.lotId;
      lotRows.set(key, [...(lotRows.get(key) || []), job]);
    });
    payload.lots = lots.map((lot) => {
      const audience = asRecord(lot.audience);
      const template = asRecord(lot.template);
      const lotSender = asRecord(lot.sender);
      const lotKey = `${String(lotSender.id || senderPool[0]?.id || "manual")}-${String(template.id || "")}-${String(audience.tagId || "")}`;
      const recipients = lotRows.get(lotKey) || [];
      return {
        ...lot,
        recipients: recipients.map((job) => ({
          id: job.recipient.id,
          name: job.recipient.name || job.recipient.nome || "",
          phone: normalizeRecipientPhone(job.recipient.phone),
          tagId: job.recipient.tagId,
          tagName: job.recipient.tagName,
          templateId: job.template.id,
          templateName: job.template.name,
          variables: job.customization.variables,
        })),
      };
    });
    payload.recipients = jobs.map((job) => ({
      id: job.recipient.id,
      name: job.recipient.name || job.recipient.nome || "",
      phone: normalizeRecipientPhone(job.recipient.phone),
      tagId: job.recipient.tagId,
      tagName: job.recipient.tagName,
      lotId: job.lotId,
      senderId: job.sender.id,
      senderName: senderLabel(job.sender),
      phoneNumberId: job.sender.phoneNumberId || job.sender.defaultPhoneNumberId || findAccountForSender(job.sender)?.phoneNumberId || findAccountForSender(job.sender)?.defaultPhoneNumberId || "",
      accessToken: job.sender.accessToken || job.sender.token || findAccountForSender(job.sender)?.accessToken || "",
      templateId: job.template.id,
      templateName: job.template.name,
      variables: job.customization.variables,
      mediaUrl: job.customization.mediaUrl,
    }));

    localStorage.setItem(LOCAL_BROADCAST_PAYLOAD_KEY, JSON.stringify(payload));
    updateRun({
      status: "sending",
      total,
      accepted: 0,
      delivered: 0,
      pending: total,
      failed: 0,
      processing: Math.min(total, Math.max(1, Math.ceil(total * 0.02))),
      messageIds: [],
      statusByMessageId: {},
      events: [
        {
          id: crypto.randomUUID(),
          type: "info",
          message: `Lote enviado ao sistema com ${total.toLocaleString("pt-BR")} destinatario(s).`,
          time: nowTime(),
        },
      ],
      startedAt: new Date().toISOString(),
    });

    try {
      const response = await dispatchThroughSystem(payload, { phoneNumberId, accessToken });
      const responseRecord = asRecord(response);
      const messageIds = backendMessageIds(response);
      const accepted = numberFromResponse(responseRecord, ["accepted", "accepted_count", "sent", "sent_count", "queued", "queued_count", "enqueued"], messageIds.length);
      const delivered = numberFromResponse(responseRecord, ["delivered", "delivered_count"], 0);
      const failed = numberFromResponse(responseRecord, ["failed", "failed_count", "errors", "error_count"], 0);
      const processing = numberFromResponse(responseRecord, ["processing", "processing_count"], 0);
      const pending = Math.max(0, numberFromResponse(responseRecord, ["pending", "pending_count"], total - delivered - failed));
      const backendEvents = responseEvents(response);
      const statusValue = String(responseRecord.status || asRecord(responseRecord.data).status || "").toLowerCase();
      const waitingForWebhook = pending > 0 && accepted > 0 && !failed && statusValue !== "failed" && statusValue !== "error";
      const nextStatus: RunStatus = waitingForWebhook || pending <= 0 || statusValue === "failed" || statusValue === "error" ? "done" : "sending";
      const nextRun: BroadcastRun = {
        status: nextStatus,
        total,
        accepted,
        delivered,
        pending,
        failed,
        processing,
        messageIds,
        statusByMessageId: {},
        startedAt: new Date().toISOString(),
        events: [
          {
            id: crypto.randomUUID(),
            type: (failed ? "failed" : "success") as RunEvent["type"],
            message: failed
              ? `Sistema retornou ${failed.toLocaleString("pt-BR")} falha(s) imediata(s).`
              : waitingForWebhook
                ? `${Math.max(accepted, messageIds.length).toLocaleString("pt-BR")} mensagem(ns) aceita(s) pela Meta. Aguardando webhook publico para confirmar entrega ou falha.`
                : `${Math.max(accepted, messageIds.length).toLocaleString("pt-BR")} mensagem(ns) aceita(s) pelo sistema. A entrega final depende do status/webhook.`,
            time: nowTime(),
          },
          ...backendEvents,
        ].slice(0, 30),
      };
      updateRun(nextRun);
      setStatus(
        failed
          ? "O sistema retornou falhas no disparo. Confira os detalhes em atualizacoes em tempo real."
          : waitingForWebhook
            ? "Mensagem aceita pela Meta. Aguardando webhook publico para confirmar entregue ou falha."
          : "Lote criado no sistema. Acompanhe os status reais retornados pelo backend/webhook.",
      );
    } catch (error) {
      const message = formatBackendError(error);
      updateRun({
        status: "done",
        total,
        accepted: 0,
        delivered: 0,
        pending: 0,
        failed: total,
        processing: 0,
        messageIds: [],
        statusByMessageId: {},
        startedAt: new Date().toISOString(),
        events: [
          {
            id: crypto.randomUUID(),
            type: "failed",
            message: `Falha ao disparar pelo sistema: ${message}`,
            time: nowTime(),
          },
        ],
      });
      setStatus(`Falha ao disparar pelo sistema: ${message}`);
    } finally {
      setIsDispatching(false);
    }
  }

  async function startOfficialRun() {
    if (!planReady) {
      setStatus("Escolha remetente, templates, etiquetas e complete as customizacoes antes de iniciar.");
      return;
    }
    if (!selectedSender) {
      setStatus("Selecione um remetente conectado antes de disparar.");
      return;
    }

    const phoneNumberId = String(selectedSender.phoneNumberId || selectedSender.defaultPhoneNumberId || "").trim();
    const account = findAccountForSender(selectedSender);
    const token = String(selectedSender.accessToken || account?.accessToken || "").trim();
    if (!phoneNumberId || !token) {
      setStatus("Remetente sem Phone Number ID ou token da BM. Confira Configuracoes BM e Registrar Remetente.");
      return;
    }

    setIsDispatching(true);
    setStatus("Carregando destinatarios das etiquetas...");

    const payload = buildDispatchPayload({
      plan,
      sender: selectedSender,
      templates: selectedTemplates,
      tags: selectedTags,
      distribution,
      totalContacts,
    });
    localStorage.setItem(LOCAL_BROADCAST_PAYLOAD_KEY, JSON.stringify(payload));

    const jobs: Array<{ recipient: BroadcastRecipient; template: SavedTemplate; customization: TemplateCustomization }> = [];
    try {
      for (const item of distribution) {
        const recipients = await fetchTagRecipients(item.tag);
        recipients.forEach((recipient) => {
          jobs.push({
            recipient,
            template: item.template,
            customization: plan.customizations[item.customizationKey] || plan.customizations[item.template.id] || emptyCustomization(),
          });
        });
      }
    } catch (error) {
      setIsDispatching(false);
      setStatus(`Nao foi possivel carregar os contatos: ${error instanceof Error ? error.message : "falha desconhecida"}`);
      return;
    }

    const total = jobs.length;
    if (!total) {
      setIsDispatching(false);
      setStatus("Nenhum destinatario encontrado nas etiquetas selecionadas.");
      return;
    }

    let nextRun: BroadcastRun = {
      status: "sending",
      total,
      accepted: 0,
      delivered: 0,
      pending: total,
      failed: 0,
      processing: 1,
      messageIds: [],
      statusByMessageId: {},
      events: [
        {
          id: crypto.randomUUID(),
          type: "info",
          message: `Lote criado com ${total.toLocaleString("pt-BR")} destinatarios reais.`,
          time: nowTime(),
        },
      ],
      startedAt: new Date().toISOString(),
    };

    updateRun(nextRun);
    setActiveStep("monitor");
    setStatus("Disparo oficial em andamento pela Meta Cloud API.");

    for (const job of jobs) {
      const phone = normalizeRecipientPhone(job.recipient.phone);
      if (!phone) {
        nextRun = {
          ...nextRun,
          failed: nextRun.failed + 1,
          pending: Math.max(0, nextRun.pending - 1),
          processing: Math.min(1, Math.max(0, nextRun.pending - 1)),
          events: [
            {
              id: crypto.randomUUID(),
              type: "failed" as const,
              message: `${job.recipient.tagName}: telefone vazio ou invalido.`,
              time: nowTime(),
            },
            ...nextRun.events,
          ].slice(0, 20),
        };
        updateRun(nextRun);
        continue;
      }

      try {
        const response = await metaPost<{ messages?: Array<{ id?: string }> }>(
          `${phoneNumberId}/messages`,
          token,
          buildMetaMessagePayload({
            to: phone,
            template: job.template,
            customization: job.customization,
          }),
        );
        const messageId = response.messages?.[0]?.id;
        if (!messageId) {
          throw new Error(`Meta nao retornou ID da mensagem. Resposta: ${JSON.stringify(response).slice(0, 500)}`);
        }
        nextRun = {
          ...nextRun,
          accepted: nextRun.accepted + 1,
          processing: Math.min(1, Math.max(0, nextRun.pending - 1)),
          messageIds: Array.from(new Set([...nextRun.messageIds, messageId])),
          events: [
            {
              id: crypto.randomUUID(),
              type: "success" as const,
              message: `${phone} aceito pela Meta | ${messageId}. A entrega/falha final depende do webhook de status.`,
              time: nowTime(),
            },
            ...nextRun.events,
          ].slice(0, 20),
        };
      } catch (error) {
        nextRun = {
          ...nextRun,
          failed: nextRun.failed + 1,
          pending: Math.max(0, nextRun.pending - 1),
          processing: Math.min(1, Math.max(0, nextRun.pending - 1)),
          events: [
            {
              id: crypto.randomUUID(),
              type: "failed" as const,
              message: `${phone} falhou: ${error instanceof Error ? error.message : "erro desconhecido da Meta"}`,
              time: nowTime(),
            },
            ...nextRun.events,
          ].slice(0, 20),
        };
      }
      updateRun(nextRun);
    }

    nextRun = {
      ...nextRun,
      status: "done",
      processing: 0,
      events: [
        {
          id: crypto.randomUUID(),
          type: (nextRun.failed ? "failed" : "success") as RunEvent["type"],
          message: nextRun.failed
            ? `Lote finalizado com ${nextRun.failed.toLocaleString("pt-BR")} falha(s). Veja os erros abaixo.`
            : `${nextRun.accepted.toLocaleString("pt-BR")} mensagem(ns) aceita(s) pela Meta. Aguardando webhook/status para confirmar entrega ou falha.`,
          time: nowTime(),
        },
        ...nextRun.events,
      ].slice(0, 20),
    };
    updateRun(nextRun);
    setIsDispatching(false);
    setStatus(
      nextRun.failed
        ? "Disparo finalizado com falhas imediatas retornadas pela Meta."
        : "A Meta aceitou as mensagens. Entrega, bloqueio por pagamento e falhas finais chegam depois via webhook de status."
    );
  }

  function advanceRun() {
    if (run.status !== "sending" || run.pending <= 0) return;
    const chunk = Math.min(run.pending, Math.max(1, Math.ceil(run.total * 0.08)));
    const failed = Math.floor(chunk * (0.02 + Math.random() * 0.035));
    const delivered = chunk - failed;
    const pending = run.pending - chunk;
    const nextStatus = pending <= 0 ? "done" : "sending";
    const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const eventType: RunEvent["type"] = failed ? "failed" : "success";
    const nextEvents: RunEvent[] = [
      {
        id: crypto.randomUUID(),
        type: eventType,
        message: `${delivered.toLocaleString("pt-BR")} entregues${failed ? `, ${failed.toLocaleString("pt-BR")} falhas` : ""}.`,
        time: now,
      },
      ...run.events,
    ].slice(0, 8);
    updateRun({
      ...run,
      delivered: run.delivered + delivered,
      failed: run.failed + failed,
      pending,
      processing: nextStatus === "done" ? 0 : Math.min(pending, Math.max(1, Math.ceil(run.total * 0.025))),
      status: nextStatus,
          events: nextStatus === "done"
        ? [
            {
              id: crypto.randomUUID(),
              type: "success" as const,
              message: "Lote finalizado.",
              time: now,
            },
            ...nextEvents,
          ].slice(0, 8)
        : nextEvents,
    });
  }

  function pauseOrResume() {
    if (run.status === "sending") updateRun({ ...run, status: "paused" });
    if (run.status === "paused") updateRun({ ...run, status: "sending" });
  }

  function finishRun() {
    updateRun({
      ...run,
      status: "done",
      delivered: run.delivered + run.pending,
      pending: 0,
    });
  }

  function resetRun() {
    updateRun(defaultRun);
    setStatus("Acompanhamento limpo.");
  }

  function updateCampaigns(nextCampaigns: BroadcastCampaign[] | ((current: BroadcastCampaign[]) => BroadcastCampaign[])) {
    setCampaigns((current) => {
      const resolved = typeof nextCampaigns === "function" ? nextCampaigns(current) : nextCampaigns;
      persistBroadcastCampaigns(resolved);
      return resolved;
    });
  }

  function openWizardForCampaign(campaignId: string, reset = true) {
    setActiveCampaignId(campaignId);
    setBroadcastView("wizard");
    setActiveStep("sender");
    if (reset) {
      const nextPlan = normalizeBroadcastPlan({ ...defaultPlan, mode: fixedMode });
      updatePlan(nextPlan);
      updateRun(defaultRun);
    }
    const campaign = campaigns.find((item) => item.id === campaignId);
    setStatus(campaign ? `Criando lote para ${campaign.name}.` : "Criando novo lote.");
  }

  function createCampaign() {
    const name = campaignForm.name.trim();
    if (!name) {
      setStatus("Informe um nome para a campanha.");
      return;
    }
    const now = new Date().toISOString();
    const campaign: BroadcastCampaign = {
      id: crypto.randomUUID(),
      name,
      channel: campaignForm.channel,
      description: campaignForm.description.trim(),
      delivered: 0,
      failed: 0,
      pending: 0,
      total: 0,
      lots: 0,
      status: "draft",
      createdAt: now,
      createdBy: "Admin",
      updatedAt: now,
    };
    updateCampaigns([campaign, ...campaigns]);
    setCampaignForm({ name: "", channel: "Cloud API", description: "" });
    setCampaignModalOpen(false);
    openWizardForCampaign(campaign.id);
  }

  function deleteCampaign(campaignId: string) {
    updateCampaigns((current) => current.filter((campaign) => campaign.id !== campaignId));
    if (activeCampaignId === campaignId) setActiveCampaignId("");
    if (expandedCampaignId === campaignId) setExpandedCampaignId("");
  }

  function refreshCampaignDashboard() {
    const storedCampaigns = readBroadcastCampaigns();
    setCampaigns(storedCampaigns);
    setStatus("Status das campanhas atualizado.");
  }

  useEffect(() => {
    loadOptions();
  }, []);

  useEffect(() => {
    setPlan((currentPlan) => {
      if (currentPlan.mode === fixedMode) return currentPlan;
      return persistPlan({
        ...currentPlan,
        mode: fixedMode,
        senderIds: fixedMode === "random" ? currentPlan.senderIds.length ? currentPlan.senderIds : currentPlan.senderId ? [currentPlan.senderId] : [] : [],
        senderId: fixedMode === "simple" ? currentPlan.senderId || currentPlan.senderIds[0] || "" : currentPlan.senderId,
      });
    });
    setStatus(fixedMode === "random" ? "Broadcast randomico: alterna remetentes e templates contato a contato." : "Broadcast simples: um remetente assina todo o lote.");
    if (fixedMode === "random") setBroadcastView("wizard");
  }, [fixedMode]);

  useEffect(() => {
    if (fixedMode !== "simple" || !activeCampaignId || !run.total) return;
    const nextStatus: BroadcastCampaignStatus =
      run.failed && run.failed >= run.total ? "failed" : run.status === "done" ? "done" : run.status === "idle" ? "draft" : "sending";
    updateCampaigns((current) =>
      current.map((campaign) =>
        campaign.id === activeCampaignId
          ? {
              ...campaign,
              delivered: run.delivered || campaign.delivered,
              failed: run.failed,
              pending: run.pending,
              total: run.total,
              lots: Math.max(campaign.lots, 1),
              status: nextStatus,
              updatedAt: new Date().toISOString(),
            }
          : campaign,
      ),
    );
  }, [activeCampaignId, fixedMode, run.delivered, run.failed, run.pending, run.status, run.total]);

  useEffect(() => {
    const refresh = () => {
      if (!isDispatching && run.status !== "sending") void loadOptions();
    };
    const interval = window.setInterval(refresh, 4000);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [isDispatching, run.status]);

  useEffect(() => {
    if (!selectedTemplateItems.length) {
      setActiveCustomizeTemplateId("");
      return;
    }
    if (!selectedTemplateItems.some((item) => item.key === activeCustomizeTemplateId)) {
      setActiveCustomizeTemplateId(selectedTemplateItems[0].key);
    }
  }, [activeCustomizeTemplateId, selectedTemplateItems]);

  useEffect(() => {
    if (!selectedTemplateItems.length) return;
    const nextCustomizations = { ...plan.customizations };
    let changed = false;

    selectedTemplateItems.forEach((item) => {
      const customization = nextCustomizations[item.key];
      const template = item.template;
      const templateExamples = asRecord(template.variables);
      if (customization?.variables && sameVariableValues(customization.variables, templateExamples)) {
        nextCustomizations[item.key] = {
          ...customization,
          variables: {},
        };
        changed = true;
      }
    });

    if (changed) {
      updatePlan((currentPlan) => ({
        ...currentPlan,
        customizations: {
          ...currentPlan.customizations,
          ...nextCustomizations,
        },
      }));
    }
  }, [selectedTemplateItems]);

  useEffect(() => {
    if (!run.messageIds.length || run.pending <= 0) return;
    const timer = window.setInterval(async () => {
      try {
        const currentRun = normalizeRun(readStored(LOCAL_BROADCAST_RUN_KEY, defaultRun));
        const pendingIds = currentRun.messageIds.filter((id) => !currentRun.statusByMessageId[id]);
        if (!pendingIds.length) return;
        const statuses = await fetchLocalMessageStatuses(pendingIds);
        if (!statuses.length) return;

        let deliveredDelta = 0;
        let failedDelta = 0;
        const events: RunEvent[] = [];
        const statusByMessageId = { ...currentRun.statusByMessageId };

        statuses.forEach((messageStatus) => {
          if (!messageStatus.id || statusByMessageId[messageStatus.id]) return;
          const statusValue = String(messageStatus.status || "").toLowerCase();
          if (["delivered", "read"].includes(statusValue)) {
            deliveredDelta += 1;
            statusByMessageId[messageStatus.id] = messageStatus;
            events.push({
              id: crypto.randomUUID(),
              type: "success",
              message: `${messageStatus.recipientId || messageStatus.id} entregue (${statusValue}).`,
              time: nowTime(),
            });
          } else if (statusValue === "failed") {
            failedDelta += 1;
            statusByMessageId[messageStatus.id] = messageStatus;
            const errorText = [
              messageStatus.errorTitle || "Falha da Meta",
              messageStatus.errorMessage,
              messageStatus.errorCode ? `codigo ${messageStatus.errorCode}` : "",
            ].filter(Boolean).join(" | ");
            events.push({
              id: crypto.randomUUID(),
              type: "failed",
              message: `${messageStatus.recipientId || messageStatus.id} falhou: ${errorText || "sem detalhe retornado"}`,
              time: nowTime(),
            });
          }
        });

        if (!deliveredDelta && !failedDelta) {
          const startedAt = currentRun.startedAt ? new Date(currentRun.startedAt).getTime() : Date.now();
          const waitedTooLong = Date.now() - startedAt > 90000;
          const alreadyWarned = currentRun.events.some((event) => event.message.includes("Webhook sem retorno"));
          if (waitedTooLong && !alreadyWarned) {
            const nextRun = {
              ...currentRun,
              events: [
                {
                  id: crypto.randomUUID(),
                  type: "info" as const,
                  message:
                    "Webhook sem retorno ate agora. A Meta aceitou a mensagem, mas entrega/falha final so aparece quando o webhook publico da Cloud API estiver configurado.",
                  time: nowTime(),
                },
                ...currentRun.events,
              ].slice(0, 30),
            };
            updateRun(nextRun);
            setStatus("Mensagem aceita pela Meta. Aguardando webhook publico para confirmar entregue ou falha.");
          }
          return;
        }
        const nextPending = Math.max(0, currentRun.pending - deliveredDelta - failedDelta);
        const nextRun = {
          ...currentRun,
          delivered: currentRun.delivered + deliveredDelta,
          failed: currentRun.failed + failedDelta,
          pending: nextPending,
          status: nextPending ? currentRun.status : "done",
          statusByMessageId,
          events: [...events, ...currentRun.events].slice(0, 30),
        };
        updateRun(nextRun);
        setStatus(
          nextPending
            ? `${nextPending.toLocaleString("pt-BR")} mensagem(ns) ainda aguardando status da Meta.`
            : "Todos os status recebidos pelo webhook local."
        );
      } catch {
        // O coletor local pode não estar configurado/publicado ainda; a tela continua aguardando status.
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [run.messageIds, run.pending]);

  if (fixedMode === "simple" && broadcastView === "dashboard") {
    return (
      <main className="template-page broadcast-page broadcast-dashboard-page">
        <section className="broadcast-dashboard-shell">
          <header className="broadcast-dashboard-hero">
            <div>
              <span className="section-kicker">Transmissoes Cloud</span>
              <h1>Broadcast Simples</h1>
              <p>Gerencie campanhas, acompanhe lotes e crie novos disparos pela Cloud API.</p>
            </div>
            <div className="broadcast-dashboard-actions">
              <button className="button secondary" onClick={refreshCampaignDashboard}>
                <RefreshCcw size={16} />
                Atualizar status
              </button>
              <button className="button" onClick={() => setCampaignModalOpen(true)}>
                <Plus size={16} />
                Criar campanha
              </button>
            </div>
          </header>

          <div className="broadcast-dashboard-tabs" role="tablist" aria-label="Tipo de campanha">
            <button className="active" type="button">Cloud API</button>
            <button type="button">Janela 24h</button>
          </div>

          <section className="broadcast-dashboard-kpis">
            <div>
              <span>Entregues</span>
              <strong>{dashboardTotals.delivered.toLocaleString("pt-BR")}</strong>
            </div>
            <div>
              <span>Falhas</span>
              <strong>{dashboardTotals.failed.toLocaleString("pt-BR")}</strong>
            </div>
            <div>
              <span>Pendentes</span>
              <strong>{dashboardTotals.pending.toLocaleString("pt-BR")}</strong>
            </div>
            <div>
              <span>Lotes</span>
              <strong>{dashboardTotals.lots.toLocaleString("pt-BR")}</strong>
            </div>
          </section>

          <section className="broadcast-management-card">
            <div className="broadcast-management-toolbar">
              <label className="search-field">
                <Search size={16} />
                <input
                  placeholder="Buscar campanha..."
                  value={campaignQuery}
                  onChange={(event) => setCampaignQuery(event.target.value)}
                />
              </label>
              <select
                value={campaignStatusFilter}
                onChange={(event) => setCampaignStatusFilter(event.target.value as "all" | BroadcastCampaignStatus)}
              >
                <option value="all">Todos</option>
                <option value="draft">Rascunho</option>
                <option value="sending">Enviando</option>
                <option value="done">Concluida</option>
                <option value="failed">Falhou</option>
              </select>
            </div>

            <div className="campaign-table">
              <div className="campaign-table-head">
                <span>Nome</span>
                <span>Progresso</span>
                <span>Lotes</span>
                <span>Status</span>
                <span>Criada em</span>
                <span>Criado por</span>
              </div>
              {filteredCampaigns.map((campaign) => {
                const expanded = expandedCampaignId === campaign.id;
                return (
                  <div className={expanded ? "campaign-row expanded" : "campaign-row"} key={campaign.id}>
                    <button className="campaign-row-main" onClick={() => setExpandedCampaignId(expanded ? "" : campaign.id)} type="button">
                      <span className="campaign-toggle">
                        <ChevronDown size={15} />
                      </span>
                      <span className="campaign-name">
                        <MessageCircle size={16} />
                        <strong>{campaign.name}</strong>
                        {campaign.description ? <small>{campaign.description}</small> : null}
                      </span>
                      <span className="campaign-progress">
                        <strong className="success">{campaign.delivered.toLocaleString("pt-BR")}</strong>
                        <strong className="danger">{campaign.failed.toLocaleString("pt-BR")}</strong>
                      </span>
                      <span>{campaign.lots.toLocaleString("pt-BR")} transmissao(oes)</span>
                      <span className={`campaign-status ${campaign.status}`}>{campaignStatusLabel(campaign.status)}</span>
                      <span>{formatCampaignDate(campaign.createdAt)}</span>
                      <span>{campaign.createdBy}</span>
                    </button>
                    {expanded ? (
                      <div className="campaign-expanded">
                        <div>
                          <strong>Lotes de transmissao</strong>
                          <span>{campaign.lots.toLocaleString("pt-BR")} lote(s) - {campaign.total.toLocaleString("pt-BR")} destinatario(s)</span>
                        </div>
                        <p>{campaign.lots ? "Use Adicionar lote para criar uma nova remessa nesta campanha." : "Nenhum lote criado nesta campanha."}</p>
                        <div className="campaign-expanded-actions">
                          <button className="button danger ghost" onClick={() => deleteCampaign(campaign.id)} type="button">
                            <Trash2 size={15} />
                            Excluir campanha
                          </button>
                          <button className="button secondary" onClick={() => openWizardForCampaign(campaign.id)} type="button">
                            <Plus size={15} />
                            Adicionar lote
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {!filteredCampaigns.length ? (
                <div className="campaign-empty">
                  <MessageCircle size={20} />
                  <strong>Nenhuma campanha encontrada</strong>
                  <span>Crie a primeira campanha para abrir o fluxo de disparo simples.</span>
                </div>
              ) : null}
            </div>
          </section>
        </section>

        {campaignModalOpen ? (
          <div className="modal-backdrop">
            <div className="broadcast-campaign-modal">
              <button className="icon-button modal-close" onClick={() => setCampaignModalOpen(false)} type="button">
                <X size={16} />
              </button>
              <h2>Criar campanha</h2>
              <label>
                Nome da campanha
                <input
                  placeholder="Ex: GB 1 MARCO 2026"
                  value={campaignForm.name}
                  onChange={(event) => setCampaignForm({ ...campaignForm, name: event.target.value })}
                />
              </label>
              <label>
                Canal
                <select
                  value={campaignForm.channel}
                  onChange={(event) => setCampaignForm({ ...campaignForm, channel: event.target.value as BroadcastCampaign["channel"] })}
                >
                  <option value="Cloud API">Cloud Broadcast</option>
                  <option value="Janela 24h">Janela 24h</option>
                </select>
              </label>
              <label>
                Descricao (opcional)
                <textarea
                  placeholder="Descricao da campanha..."
                  value={campaignForm.description}
                  onChange={(event) => setCampaignForm({ ...campaignForm, description: event.target.value })}
                />
              </label>
              <div className="modal-actions">
                <button className="button secondary" onClick={() => setCampaignModalOpen(false)} type="button">Cancelar</button>
                <button className="button" onClick={createCampaign} type="button">
                  <Plus size={16} />
                  Criar campanha
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <main className="template-page broadcast-page broadcast-wizard-page">
      <section className="broadcast-flow-shell">
        <header className="broadcast-flow-header">
          <div>
            <h1>
              <Megaphone size={18} />
              {isRandomMode ? "Broadcast Randomico" : "Broadcast Simples"}
            </h1>
            <div className="broadcast-stepper">
              {steps.map((step, index) => {
                const isActive = step.key === activeStep;
                const isDone =
                  index < stepIndex ||
                  (step.key === "sender" && senderReady) ||
                  (step.key === "templates" && templatesReady) ||
                  (step.key === "audience" && audienceReady) ||
                  (step.key === "customize" && customizationsReady);
                return (
                  <button
                    aria-label={`${step.title} ${step.subtitle}`}
                    className={isActive ? "wizard-step active" : isDone ? "wizard-step done" : "wizard-step"}
                    key={step.key}
                    onClick={() => setActiveStep(step.key)}
                  >
                    <span>{isDone ? <Check size={15} /> : index + 1}</span>
                    <strong>{step.title}</strong>
                    <small>{step.subtitle}</small>
                  </button>
                );
              })}
            </div>
            <p>
              Etapa {stepIndex + 1} de {steps.length}: <strong>{steps[stepIndex]?.title}</strong>
            </p>
          </div>
          <div className="broadcast-header-actions">
            <button className="icon-button" disabled={loading} onClick={loadOptions} title="Atualizar dados">
              <RefreshCcw size={16} />
            </button>
            <button className="icon-button" onClick={() => fixedMode === "simple" ? setBroadcastView("dashboard") : undefined} title="Fechar">
              <X size={16} />
            </button>
          </div>
        </header>

        <section className="broadcast-wizard-layout">
        <div className="card broadcast-wizard-main">
          {activeStep === "sender" ? (
            <>
              <div className="wizard-section-heading">
                <Smartphone size={20} />
                <div>
                  <h2>Escolha quem vai enviar</h2>
                  <p>Esse é o número oficial da Cloud API que vai assinar o disparo.</p>
                </div>
              </div>

              <div className="broadcast-list-toolbar">
                <label className="search-field">
                  <Search size={16} />
                  <input
                    placeholder="Buscar remetente por nome, telefone ou BM..."
                    value={senderQuery}
                    onChange={(event) => setSenderQuery(event.target.value)}
                  />
                </label>
                <span>{filteredSenders.length} de {senders.length} remetente(s)</span>
              </div>

              <div className="sender-grid broadcast-picker-scroll">
                {filteredSenders.map((sender) => {
                  const selected = isRandomMode ? plan.senderIds.includes(sender.id) : plan.senderId === sender.id;
                  return (
                    <button
                      className={selected ? "select-card active" : "select-card"}
                      key={sender.id}
                      onClick={() =>
                        isRandomMode
                          ? toggleRandomSender(sender.id)
                          : updatePlan({ ...plan, senderId: sender.id, manualSender: "" })
                      }
                      type="button"
                    >
                      <span className="select-card-icon">
                        {selected && isRandomMode ? <Check size={18} /> : <Smartphone size={18} />}
                      </span>
                      <strong>{senderLabel(sender)}</strong>
                      <small>{senderNumber(sender)}</small>
                      {senderBusinessLabel(sender) ? <small>{senderBusinessLabel(sender)}</small> : null}
                    </button>
                  );
                })}
                {!senders.length ? (
                  <div className="empty-helper">
                    <AlertTriangle size={18} />
                    <p>Nenhuma BM conectada retornou um remetente. Dá para testar digitando um remetente manual abaixo.</p>
                  </div>
                ) : null}
                {senders.length && !filteredSenders.length ? (
                  <div className="empty-helper">
                    <Search size={18} />
                    <p>Nenhum remetente encontrado para essa busca.</p>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {activeStep === "templates" ? (
            <>
              <div className="wizard-section-heading">
                <Sparkles size={20} />
                <div>
                  <h2>Selecione os templates aprovados</h2>
                  <p>Você pode escolher um ou vários. Na próxima etapa eles serão ligados às etiquetas.</p>
                </div>
              </div>

              <div className="broadcast-list-toolbar">
                <label className="search-field">
                  <Search size={16} />
                  <input
                    placeholder="Buscar template por nome, conteúdo ou status..."
                    value={templateQuery}
                    onChange={(event) => setTemplateQuery(event.target.value)}
                  />
                </label>
                <span>{selectedTemplates.length} selecionado(s) de {filteredTemplates.length}</span>
              </div>

              <div className="template-select-list broadcast-picker-scroll">
                {isRandomMode
                  ? selectedSenders.map((sender) => {
                      const query = templateQuery.trim().toLowerCase();
                      const senderTemplates = templatesForSender(sender).filter((template) => {
                        if (!query) return true;
                        return [template.name, templateText(template), templateStatusLabel(template), String(template.id || "")]
                          .join(" ")
                          .toLowerCase()
                          .includes(query);
                      });
                      return (
                        <div className="random-template-group" key={sender.id}>
                          <div className="random-template-group-head">
                            <strong>{senderLabel(sender)}</strong>
                            <span>{(plan.templatesBySender[sender.id] || []).length} template(s)</span>
                          </div>
                          {senderTemplates.map((template) => {
                            const selected = (plan.templatesBySender[sender.id] || []).includes(template.id);
                            return (
                              <button
                                className={selected ? "template-select-row active" : "template-select-row"}
                                key={`${sender.id}-${template.id}`}
                                onClick={() => toggleTemplateForSender(sender.id, template.id)}
                                type="button"
                              >
                                <span className="custom-checkbox">{selected ? <Check size={13} /> : null}</span>
                                <div>
                                  <strong>{template.name}</strong>
                                  <p>{templateText(template) || "Template salvo sem previa de texto."}</p>
                                </div>
                                <small>{templateStatusLabel(template)}</small>
                              </button>
                            );
                          })}
                          {!senderTemplates.length ? <p className="hint">Nenhum template encontrado para este remetente.</p> : null}
                        </div>
                      );
                    })
                  : filteredTemplates.map((template) => {
                      const selected = plan.templateIds.includes(template.id);
                      return (
                        <button
                          className={selected ? "template-select-row active" : "template-select-row"}
                          key={template.id}
                          onClick={() => toggleTemplate(template.id)}
                          type="button"
                        >
                          <span className="custom-checkbox">{selected ? <Check size={13} /> : null}</span>
                          <div>
                            <strong>{template.name}</strong>
                            <p>{templateText(template) || "Template salvo sem previa de texto."}</p>
                          </div>
                          <small>{templateStatusLabel(template)}</small>
                        </button>
                      );
                    })}
                {!availableTemplates.length ? (
                  <div className="empty-helper">
                    <AlertTriangle size={18} />
                    <div>
                      <p>
                        {templates.length
                          ? "Nenhum template aprovado encontrado para a BM selecionada. Confira se o remetente usa a mesma WABA dos templates."
                          : "Nenhum template aprovado encontrado. Sincronize a Meta Templates ou confirme o token/WABA da BM."}
                      </p>
                      {status ? <small>{status}</small> : null}
                    </div>
                  </div>
                ) : null}
                {isRandomMode && !selectedSenders.length ? (
                  <div className="empty-helper">
                    <AlertTriangle size={18} />
                    <p>Selecione pelo menos um remetente antes de escolher templates.</p>
                  </div>
                ) : null}
                {availableTemplates.length && !filteredTemplates.length && !isRandomMode ? (
                  <div className="empty-helper">
                    <Search size={18} />
                    <p>Nenhum template encontrado para essa busca.</p>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {activeStep === "audience" ? (
            <>
              <div className="wizard-section-heading">
                <Users size={20} />
                <div>
                  <h2>Escolha as etiquetas tratadas</h2>
                  <p>Essas etiquetas vêm da lista tratada. Cada etiqueta vira um grupo de envio.</p>
                </div>
              </div>

              <div className="tag-binding-panel">
                <strong>{selectedTags.length}/{isRandomMode ? "varias" : selectedTemplates.length || 1} selecionada(s)</strong>
                <div className="tag-binding-list">
                  {isRandomMode
                    ? selectedTags.map((tag) => (
                        <span key={tag.id}>
                          {tagDisplayName(tag)} {"->"} alternando entre {selectedSenders.length} remetente(s) e {selectedTemplates.length} template(s)
                        </span>
                      ))
                    : selectedTemplates.map((template, index) => (
                        <span key={template.id}>
                          {template.name} {"->"} {selectedTags[index] ? tagDisplayName(selectedTags[index]) : "aguardando..."}
                        </span>
                      ))}
                  {!selectedTemplates.length ? <span>Selecione templates antes de escolher as etiquetas.</span> : null}
                </div>
              </div>

              <div className="tag-search-panel">
                <label className="search-field">
                  <Search size={16} />
                  <input
                    placeholder="Buscar etiqueta por nome, data ou prefixo..."
                    value={tagQuery}
                    onChange={(event) => setTagQuery(event.target.value)}
                  />
                </label>
                <div className="tag-tools">
                  <span>
                    {selectedTags.length} selecionada(s) de {filteredTags.length}
                  </span>
                  <button
                    className="button secondary compact"
                    disabled={!filteredTags.length}
                    onClick={() =>
                      updatePlan({
                        ...plan,
                        tagIds: isRandomMode
                          ? Array.from(new Set([...plan.tagIds, ...filteredTags.map((tag) => tag.id)]))
                          : Array.from(new Set([...plan.tagIds, ...filteredTags.map((tag) => tag.id)])).slice(0, selectedTemplates.length),
                      })
                    }
                    type="button"
                  >
                    Selecionar visíveis
                  </button>
                  <button
                    className="button secondary compact"
                    disabled={!plan.tagIds.length}
                    onClick={() => updatePlan({ ...plan, tagIds: [] })}
                    type="button"
                  >
                    Limpar
                  </button>
                </div>
              </div>

              <div className="tag-select-grid">
                {filteredTags.map((tag) => {
                  const selected = plan.tagIds.includes(tag.id);
                  return (
                    <button
                      className={selected ? "tag-card active" : "tag-card"}
                      disabled={!isRandomMode && !selected && selectedTemplates.length > 0 && plan.tagIds.length >= selectedTemplates.length}
                      key={tag.id}
                      onClick={() => toggleTag(tag.id)}
                      type="button"
                    >
                      <span className="custom-checkbox">{selected ? <Check size={13} /> : null}</span>
                      <strong>{tagDisplayName(tag)}</strong>
                      <small>{contactCount(tag).toLocaleString("pt-BR")} contatos</small>
                    </button>
                  );
                })}
                {!tags.length ? (
                  <div className="empty-helper">
                    <AlertTriangle size={18} />
                    <p>Nenhuma etiqueta encontrada. Importe contatos ou trate uma lista primeiro.</p>
                  </div>
                ) : null}
                {tags.length && !filteredTags.length ? (
                  <div className="empty-helper">
                    <Search size={18} />
                    <p>Nenhuma etiqueta encontrada para essa busca.</p>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {false ? (
            <>
              <div className="wizard-section-heading">
                <Link2 size={20} />
                <div>
                  <h2>Vincule templates com etiquetas</h2>
                  <p>O sistema distribui automaticamente em ordem. Exemplo: 3 templates e 3 etiquetas, cada lista recebe um template.</p>
                </div>
              </div>

              <div className="distribution-board">
                {distribution.map((item, index) => (
                  <div className="distribution-card" key={`${item.tag.id}-${item.template.id}`}>
                    <span className="distribution-number">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <small>Etiqueta</small>
                      <strong>{tagDisplayName(item.tag)}</strong>
                      <p>{contactCount(item.tag).toLocaleString("pt-BR")} contatos</p>
                    </div>
                    <ArrowRight size={17} />
                    <div>
                      <small>Template</small>
                      <strong>{item.template.name}</strong>
                      <p>{String(item.template.folder || item.template.status || "Aprovado")}</p>
                    </div>
                  </div>
                ))}
                {!distribution.length ? (
                  <div className="empty-helper">
                    <AlertTriangle size={18} />
                    <p>Selecione pelo menos um template e uma etiqueta para visualizar o vínculo.</p>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {activeStep === "customize" ? (
            <>
              <div className="wizard-section-heading">
                <Paperclip size={20} />
                <div>
                  <h2>Customize o disparo</h2>
                  <p>Preencha as variáveis encontradas no template e anexe a mídia quando o template pedir.</p>
                </div>
              </div>

              <div className="customize-layout broadcast-customize-v2">
                <div className="customize-template-list">
                  {selectedTemplateItems.map((item) => {
                    const template = item.template;
                    const customization = plan.customizations[item.key] || emptyCustomization();
                    const variables = templateVariables(template);
                    const complete =
                      variables.every((variable) => customization.variables[variable]?.trim()) &&
                      (!templateNeedsMedia(template) || Boolean(customization.mediaUrl || customization.mediaName));
                    return (
                      <button
                        className={activeCustomizeItem?.key === item.key ? "customize-template-pill active" : "customize-template-pill"}
                        key={item.key}
                        onClick={() => setActiveCustomizeTemplateId(item.key)}
                        type="button"
                      >
                        <span className={complete ? "mini-status done" : "mini-status"}>{complete ? <Check size={12} /> : variables.length || (templateNeedsMedia(template) ? 1 : 0)}</span>
                        <strong>{item.label}</strong>
                        <small>{variables.length} variáveis {templateNeedsMedia(template) ? "e mídia" : ""}</small>
                      </button>
                    );
                  })}
                </div>

                {activeCustomizeTemplate ? (
                  <>
                    <aside className="broadcast-phone-preview">
                      <div className="preview-title">
                        <span>
                          <MessageCircle size={16} />
                        </span>
                        <div>
                          <strong>Pre-visualizacao</strong>
                          <small>Como o modelo tende a aparecer no WhatsApp</small>
                        </div>
                      </div>
                      <div className="broadcast-phone-frame">
                        <div className="broadcast-phone-scroll">
                          {templateNeedsMedia(activeCustomizeTemplate) ? (
                            <div className="broadcast-preview-media">
                              {(plan.customizations[activeCustomizationKey] || emptyCustomization()).mediaUrl ? (
                                templateMediaType(activeCustomizeTemplate) === "video" ? (
                                  <video src={(plan.customizations[activeCustomizationKey] || emptyCustomization()).mediaUrl} muted playsInline />
                                ) : (
                                  <img alt="Midia selecionada" src={(plan.customizations[activeCustomizationKey] || emptyCustomization()).mediaUrl} />
                                )
                              ) : (
                                <div>
                                  <Image size={34} />
                                  <strong>{templateMediaType(activeCustomizeTemplate) === "video" ? "Video do cabecalho" : "Imagem do cabecalho"}</strong>
                                  <small>Defina uma URL ou envie um arquivo</small>
                                </div>
                              )}
                            </div>
                          ) : null}
                          <div className="broadcast-whatsapp-bubble">
                            <p>
                              {renderTemplateLineBreaks(
                                applyVariables(
                                  templateText(activeCustomizeTemplate) || "Template sem texto de previa.",
                                  (plan.customizations[activeCustomizationKey] || emptyCustomization()).variables,
                                )
                              )}
                            </p>
                            <small>{activeCustomizeTemplate.footer_text || 'Digite "sair" para nao receber mais.'}</small>
                            {activeCustomizeTemplate.buttons?.length ? (
                              <div className="broadcast-preview-buttons">
                                {activeCustomizeTemplate.buttons.map((button, index) => (
                                  <button key={`${button.text || "botao"}-${index}`} type="button">
                                    <Link2 size={14} />
                                    {button.text || "CLIQUE AQUI"}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            <time>12:00</time>
                          </div>
                        </div>
                      </div>
                    </aside>

                    <div className="customize-editor broadcast-content-panel">
                    <div className="customize-editor-header">
                      <div>
                        <h3>{activeCustomizeItem?.label || activeCustomizeTemplate.name}</h3>
                        <p className="hint">{templateNeedsMedia(activeCustomizeTemplate) ? "Este template precisa de mídia." : "Este template não exige mídia."}</p>
                      </div>
                      <span className="template-media-badge">{templateMediaType(activeCustomizeTemplate) || "texto"}</span>
                    </div>

                    <div className="custom-fields-grid">
                      {templateVariables(activeCustomizeTemplate).map((variable) => {
                        const customization = plan.customizations[activeCustomizationKey] || emptyCustomization();
                        return (
                          <label className="field variable-field" key={variable}>
                            <span>{`Variável {{${variable}}}`}</span>
                            <textarea
                              className="input broadcast-variable-textarea"
                              placeholder={variable === "nome" ? "Ex: nome do contato" : `Valor para {{${variable}}}`}
                              rows={3}
                              value={customization.variables[variable] || ""}
                              onChange={(event) => updateVariable(activeCustomizationKey, variable, event.target.value)}
                            />
                            <div className="variable-format-actions">
                              <button
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={(event) => {
                                  const textarea = event.currentTarget.closest(".variable-field")?.querySelector("textarea");
                                  insertVariableBreak(activeCustomizationKey, variable, 1, textarea);
                                }}
                              >
                                <CornerDownLeft size={14} />
                                + Linha
                              </button>
                              <button
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={(event) => {
                                  const textarea = event.currentTarget.closest(".variable-field")?.querySelector("textarea");
                                  insertVariableBreak(activeCustomizationKey, variable, 2, textarea);
                                }}
                              >
                                <Pilcrow size={14} />
                                + Paragrafo
                              </button>
                            </div>
                          </label>
                        );
                      })}
                      {!templateVariables(activeCustomizeTemplate).length ? (
                        <div className="empty-helper">
                          <CheckCircle2 size={18} />
                          <p>Nenhuma variável encontrada neste template.</p>
                        </div>
                      ) : null}
                    </div>

                    {templateNeedsMedia(activeCustomizeTemplate) ? (
                    <div className="media-custom-card">
                      <div>
                        <h3>Mídia do template</h3>
                        <p className="hint">Use uma URL pública da mídia ou selecione um arquivo para deixar preparado no disparo.</p>
                      </div>
                      <label className="field">
                        <span>URL da mídia</span>
                        <input
                          className="input"
                          placeholder="https://..."
                          value={(plan.customizations[activeCustomizationKey] || emptyCustomization()).mediaUrl}
                          onChange={(event) => updateCustomization(activeCustomizationKey, { mediaUrl: event.target.value })}
                        />
                      </label>
                      {mediaChoicesForTemplate(activeCustomizeTemplate, activeCustomizationKey).length ? (
                        <div className="saved-media-picker">
                          <div className="saved-media-picker-head">
                            <strong>Midias salvas</strong>
                            <span>{mediaChoicesForTemplate(activeCustomizeTemplate, activeCustomizationKey).length} opcoes</span>
                          </div>
                          <div className="saved-media-list">
                            {mediaChoicesForTemplate(activeCustomizeTemplate, activeCustomizationKey).map((item) => {
                              const kind = mediaItemKind(item);
                              const url = mediaItemUrl(item);
                              return (
                                <button
                                  className="saved-media-option"
                                  key={String(item.id || url)}
                                  type="button"
                                  onClick={() => selectSavedMedia(activeCustomizationKey, item)}
                                >
                                  <span className="saved-media-thumb">
                                    {kind === "image" ? <img alt="" src={url} /> : <Image size={16} />}
                                  </span>
                                  <span>
                                    <strong>{mediaItemName(item)}</strong>
                                    <small>{kind}</small>
                                  </span>
                                  <b>Usar</b>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      <label className="button secondary file-button">
                        <Image size={17} />
                        Selecionar arquivo
                        <input
                          hidden
                          type="file"
                          accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
                          onChange={(event) => handleMediaFile(activeCustomizationKey, event.target.files?.[0])}
                        />
                      </label>
                      {(plan.customizations[activeCustomizationKey] || emptyCustomization()).mediaName ? (
                        <p className="hint">Arquivo: {(plan.customizations[activeCustomizationKey] || emptyCustomization()).mediaName}</p>
                      ) : null}
                    </div>
                    ) : null}

                    <div className="custom-preview-card">
                      <span>Prévia final</span>
                      <p>{applyVariables(templateText(activeCustomizeTemplate) || "Template sem texto de prévia.", (plan.customizations[activeCustomizationKey] || emptyCustomization()).variables)}</p>
                    </div>
                  </div>
                  </>
                ) : (
                  <div className="empty-helper">
                    <AlertTriangle size={18} />
                    <p>Selecione pelo menos um template para customizar.</p>
                  </div>
                )}
              </div>
            </>
          ) : null}

          {activeStep === "monitor" ? (
            <>
              <div className="wizard-section-heading">
                <Send size={20} />
                <div>
                  <h2>Disparo do lote</h2>
                  <p>Aqui você acompanha entregues, pendentes e falhas enquanto a campanha roda.</p>
                </div>
              </div>

              <div className="review-layout review-layout-summary-only">
                <div className="review-summary-card">
                  <h3>Resumo do lote</h3>
                  <div className="review-line">
                    <span>Sender:</span>
                    <strong>{isRandomMode ? `${selectedSenders.length} remetente(s) alternados` : selectedSender ? senderLabel(selectedSender) : plan.manualSender || "-"}</strong>
                  </div>
                  <div className="review-pairs">
                    {distribution.map((item) => (
                      <span key={`${item.sender?.id || "sender"}-${item.template.id}-${item.tag.id}`}>
                        {item.template.name} → {tagDisplayName(item.tag)} ({contactCount(item.tag).toLocaleString("pt-BR")})
                      </span>
                    ))}
                  </div>
                  <div className="review-line">
                    <span>Total de destinatários:</span>
                    <strong>{totalContacts.toLocaleString("pt-BR")}</strong>
                  </div>
                  <div className="review-line">
                    <span>Total de lotes:</span>
                    <strong>{Math.max(1, distribution.length)}</strong>
                  </div>
                </div>
              </div>

              <div className="run-dashboard">
                <div className="live-kpi-grid">
                  <div className="live-kpi success">
                    <span>Taxa aceita</span>
                    <strong>{acceptedRate(run)}%</strong>
                  </div>
                  <div className="live-kpi danger">
                    <span>Taxa de falha</span>
                    <strong>{failureRate(run)}%</strong>
                  </div>
                  <div className="live-kpi">
                    <span>Entregues reais</span>
                    <strong>{run.delivered.toLocaleString("pt-BR")}</strong>
                  </div>
                  <div className="live-kpi">
                    <span>Concluído</span>
                    <strong>{percent(run)}%</strong>
                  </div>
                </div>

                <div className="run-progress">
                  <div>
                    <strong>{percent(run)}%</strong>
                    <span>{run.status === "idle" ? "Aguardando inicio" : runStatusText}</span>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: `${percent(run)}%` }} />
                  </div>
                  <div className="progress-segments">
                    <span className="success" style={{ width: `${run.total ? (run.delivered / run.total) * 100 : 0}%` }} />
                    <span className="danger" style={{ width: `${run.total ? (run.failed / run.total) * 100 : 0}%` }} />
                    <span className="warning" style={{ width: `${run.total ? (run.processing / run.total) * 100 : 0}%` }} />
                  </div>
                </div>

                {awaitingStatuses ? (
                  <div className="broadcast-status-note">
                    <Clock3 size={17} />
                    <div>
                      <strong>Aceito pela Meta, aguardando webhook</strong>
                      <span>
                        O wamid confirma que a Meta recebeu a mensagem. Entregue ou falha final so aparece quando o webhook publico
                        da Cloud API estiver configurado e retornando status.
                      </span>
                    </div>
                  </div>
                ) : null}

                <div className="run-stats">
                  <div className="run-stat success">
                    <CheckCircle2 size={18} />
                    <strong>{run.accepted.toLocaleString("pt-BR")}</strong>
                    <span>Aceitos Meta</span>
                  </div>
                  <div className="run-stat warning">
                    <Clock3 size={18} />
                    <strong>{run.pending.toLocaleString("pt-BR")}</strong>
                    <span>Pendentes</span>
                  </div>
                  <div className="run-stat processing">
                    <RefreshCcw size={18} />
                    <strong>{run.delivered.toLocaleString("pt-BR")}</strong>
                    <span>Entregues</span>
                  </div>
                  <div className="run-stat danger">
                    <AlertTriangle size={18} />
                    <strong>{run.failed.toLocaleString("pt-BR")}</strong>
                    <span>Falhas</span>
                  </div>
                  <div className="run-stat">
                    <Users size={18} />
                    <strong>{run.total.toLocaleString("pt-BR")}</strong>
                    <span>Total</span>
                  </div>
                </div>

                <div className="button-row run-actions">
                  <button className="button" disabled={!planReady || runLocked} onClick={startSystemRun}>
                    <Send size={17} />
                    {isDispatching ? "Enviando..." : "Criar lote no sistema"}
                  </button>
                  <button className="button secondary" onClick={resetRun}>
                    <RotateCcw size={17} />
                    Limpar
                  </button>
                </div>

                <div className="live-events-card">
                  <div className="contacts-card-header">
                    <h3>Atualizações em tempo real</h3>
                    <span className={`status-pill status-${run.status === "done" ? "done" : run.status === "sending" ? "sending" : "draft"}`}>
                      {runStatusText}
                    </span>
                  </div>
                  <div className="live-events-list">
                    {run.events.map((event) => (
                      <div className={`live-event ${event.type}`} key={event.id}>
                        <span>{event.time}</span>
                        <p>{event.message}</p>
                      </div>
                    ))}
                    {!run.events.length ? <p className="hint">Crie o lote para ver as atualizações entrando aqui.</p> : null}
                  </div>
                </div>
              </div>
            </>
          ) : null}

          <div className="wizard-footer">
            <button className="button secondary" disabled={stepIndex === 0} onClick={goBack}>
              <ArrowLeft size={17} />
              Voltar
            </button>
            {activeStep === "monitor" ? (
              <button className="button" disabled={!planReady || runLocked} onClick={startSystemRun}>
                <Send size={17} />
                {isDispatching ? "Enviando..." : "Criar lote no sistema"}
              </button>
            ) : (
              <button
                className="button"
                disabled={
                  (activeStep === "sender" && !senderReady) ||
                  (activeStep === "templates" && !templatesReady) ||
                  (activeStep === "audience" && !audienceReady) ||
                  (activeStep === "customize" && !customizationsReady)
                }
                onClick={goNext}
              >
                Continuar
                <ArrowRight size={17} />
              </button>
            )}
          </div>
        </div>

        <aside className="card broadcast-summary">
          <span className="summary-eyebrow">Resumo do disparo</span>
          <h3>{selectedTags.length || selectedTemplateItems.length ? `${selectedTemplateItems.length} templates, ${selectedTags.length} etiquetas` : "Nada selecionado ainda"}</h3>

          <div className="summary-block">
            <small>Remetente</small>
            <strong>{selectedSender ? senderLabel(selectedSender) : plan.manualSender || "Selecione um remetente"}</strong>
          </div>
          <div className="summary-mini-grid">
            <div>
              <strong>{selectedTemplateItems.length}</strong>
              <span>Templates</span>
            </div>
            <div>
              <strong>{selectedTags.length}</strong>
              <span>Etiquetas</span>
            </div>
            <div>
              <strong>{totalContacts.toLocaleString("pt-BR")}</strong>
              <span>Contatos</span>
            </div>
          </div>

          <div className="summary-block">
            <small>Customização</small>
            <strong>{customizedTemplates.length} de {selectedTemplateItems.length || 0} template(s) prontos</strong>
          </div>

          <div className="summary-block">
            <small>Como será distribuído</small>
            <div className="mini-distribution">
              {distribution.slice(0, 5).map((item) => (
                <span key={`${item.tag.id}-${item.template.id}`}>
                  {tagDisplayName(item.tag)} {"->"} {item.template.name}
                </span>
              ))}
              {distribution.length > 5 ? <span>+{distribution.length - 5} vínculos</span> : null}
              {!distribution.length ? <span>Aguardando templates e etiquetas</span> : null}
            </div>
          </div>

          <button className="button full" disabled={!planReady} onClick={() => setActiveStep("monitor")}>
            Ir para disparo
            <ArrowRight size={17} />
          </button>
          {status ? <p className="hint">{status}</p> : null}
        </aside>
      </section>
      </section>
    </main>
  );
}
