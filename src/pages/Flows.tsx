import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  addEdge,
  Background,
  Connection,
  Controls,
  Edge,
  Handle,
  MiniMap,
  Node,
  NodeProps,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "react-flow-renderer";
import "react-flow-renderer/dist/style.css";
import {
  ArrowLeft,
  Check,
  Code2,
  FileText,
  Image,
  MessageCircle,
  Mic2,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Send,
  Timer,
  Trash2,
  Upload,
  Video,
  X,
  Zap,
} from "lucide-react";
import { broadcasts, contacts, infobipApis, media as mediaService, savedTemplates } from "../lib/services";
import { config } from "../lib/config";
import { apiGet, unwrapList } from "../lib/api";
import type { ContactItem, ContactTag, InfobipApi, MediaItem, SavedTemplate } from "../lib/types";

type FlowNodeKind = "start" | "text" | "audio" | "video" | "image" | "delay" | "interactive" | "blacklist";

type FlowNodeData = {
  kind: FlowNodeKind;
  title: string;
  subtitle: string;
  deletable?: boolean;
  onDelete?: () => void;
  body?: string;
  footer?: string;
  imageUrl?: string;
  mediaType?: string;
  mediaName?: string;
  caption?: string;
  delayMs?: string;
  buttons?: string[];
  voice?: boolean;
  templateId?: string;
  variables?: string[];
  variableValues?: Record<string, string>;
};

type FlowRun = {
  status: "idle" | "sending" | "paused" | "done";
  senderId: string;
  tagId: string;
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  waiting: number;
  currentStep: string;
  events: string[];
  messageIds: string[];
  statusByMessageId: Record<string, FlowMessageStatus>;
  startedAt?: string;
};

type FlowMessageStatus = {
  id: string;
  status: string;
  timestamp?: number;
  recipientId?: string;
  errorCode?: string | number;
  errorTitle?: string;
  errorMessage?: string;
};

type FlowRuntimeEvent = {
  at?: string;
  type?: string;
  sessionId?: string;
  phone?: string;
  message?: string;
};

type FlowRuntimeSession = {
  id?: string;
  status?: string;
  phone?: string;
  currentNodeId?: string;
  currentMessageId?: string;
};

type FlowRecipient = ContactItem & {
  phone: string;
  tagId: string;
  tagName: string;
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

type LocalMediaItem = MediaItem & {
  storagePath?: string;
  path?: string;
  publicUrl?: string;
  originalName?: string;
  filename?: string;
};

type MetaMessageTemplate = {
  id?: string;
  name: string;
  status?: string;
  language?: string;
  category?: string;
  waba_id?: string;
  bm_id?: string;
  bm_name?: string;
  components?: Array<{
    type?: string;
    text?: string;
    format?: string;
    buttons?: Array<{ type?: string; text?: string; url?: string }>;
  }>;
};

type SavedFlowSummary = {
  id: string;
  name: string;
  senderId: string;
  senderName: string;
  templateId: string;
  templateName: string;
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  selectedNodeId: string;
  updatedAt: string;
  stats?: {
    total: number;
    sent: number;
    delivered: number;
    failed: number;
    waiting: number;
    status: FlowRun["status"];
  };
};

const LOCAL_FLOW_EDITOR_KEY = "scaleapi.flowEditor";
const LOCAL_FLOW_LIST_KEY = "scaleapi.flowList";
const LOCAL_FLOW_RUN_KEY = "scaleapi.flowRun";
const LOCAL_BM_SETTINGS_KEY = "scaleapi.bmSettings";
const LOCAL_BM_ACCOUNTS_KEY = "scaleapi.bmAccounts";
const LOCAL_CONNECTED_SENDERS_KEY = "movy.connectedSenders";
const LOCAL_META_SENT_TEMPLATES_KEY = "scaleapi.metaSentTemplatesCache";
const MEDIA_LIBRARY_KEY = "movy.mediaLibrary";
const GRAPH_API_BASE = "https://graph.facebook.com/v24.0";

const fallbackTemplates: SavedTemplate[] = [
  {
    id: "tpl-confirmacao",
    name: "confirmacao_numero",
    folder: "Aprovado",
    media_type: "IMAGE",
    body_text:
      "Oi {{1}}!\n\nTemos uma novidade: voce foi selecionado pra receber essa mensagem.\n\nMas antes preciso confirmar se esse numero {{2}} realmente e seu.",
    footer_text: "Digite sair para não receber mais.",
    buttons: [
      { type: "QUICK_REPLY", text: "Sim" },
      { type: "QUICK_REPLY", text: "Não" },
    ],
  },
  {
    id: "tpl-oferta",
    name: "oferta_movy",
    folder: "Aprovado",
    media_type: "IMAGE",
    body_text: "Fala {{1}}! Tudo certo? {{2}}.\n\nPara confirmar, toque em uma opcao abaixo.",
    footer_text: "Movy Api",
    buttons: [
      { type: "QUICK_REPLY", text: "Tenho interesse" },
      { type: "QUICK_REPLY", text: "Agora não" },
      { type: "QUICK_REPLY", text: "Falar com atendente" },
    ],
  },
];

const defaultRun: FlowRun = {
  status: "idle",
  senderId: "",
  tagId: "",
  total: 0,
  sent: 0,
  delivered: 0,
  failed: 0,
  waiting: 0,
  currentStep: "Aguardando inicio",
  events: [],
  messageIds: [],
  statusByMessageId: {},
};

const fallbackTags: ContactTag[] = [
  { id: "tag-demo-1000", name: "0106 - teste", contacts_count: 1000 },
  { id: "tag-demo-428", name: "lista tratada - 428", contacts_count: 428 },
];

function templateBody(template: SavedTemplate) {
  return String(template.body_text || template.text || template.message || template.content || "");
}

function templateFooter(template: SavedTemplate) {
  return String(template.footer_text || template.footer || "");
}

function templateButtons(template: SavedTemplate) {
  const buttons = Array.isArray(template.buttons) ? template.buttons : [];
  return buttons
    .map((button, index) => String(button.text || button.type || `Botão ${index + 1}`))
    .filter(Boolean);
}

function templateVariables(template: SavedTemplate) {
  const text = [templateBody(template), templateFooter(template), JSON.stringify(template.buttons || [])].join(" ");
  const matches = text.match(/\{\{\s*[\w.-]+\s*\}\}/g) || [];
  const variables = matches.map((item) => item.replace(/[{}]/g, "").trim()).filter(Boolean);
  const count = Number(template.variable_count || 0);
  for (let index = 1; index <= count; index += 1) variables.push(String(index));
  return Array.from(new Set(variables)).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

function applyTemplateValues(text: string, values: Record<string, string> = {}) {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, variable: string) => values[variable] || `{{${variable}}}`);
}

function templateToStartData(template: SavedTemplate, currentValues: Record<string, string> = {}): FlowNodeData {
  const variables = templateVariables(template);
  const values = variables.reduce<Record<string, string>>((acc, variable) => {
    acc[variable] = currentValues[variable] || (variable === "1" ? "Lorrene" : variable === "2" ? "5527999983857" : "");
    return acc;
  }, {});
  const mediaUrl = String(template.media_url || template.header_url || "").trim();
  const mediaType = templateMediaType(template);
  return {
    kind: "start",
    title: "Template",
    subtitle: template.name,
    templateId: template.id,
    imageUrl: mediaUrl,
    mediaType,
    body: applyTemplateValues(templateBody(template), values),
    footer: applyTemplateValues(templateFooter(template), values),
    buttons: templateButtons(template),
    variables,
    variableValues: values,
  };
}

function emptyStartData(): FlowNodeData {
  return {
    kind: "start",
    title: "Template",
    subtitle: "Selecione um template",
    body: "Selecione um template aprovado para iniciar o fluxo.",
    buttons: [],
    variables: [],
    variableValues: {},
  };
}

const nodeInfo: Record<FlowNodeKind, { label: string; icon: typeof Zap; color: string }> = {
  start: { label: "START", icon: Send, color: "green" },
  text: { label: "TEXT", icon: FileText, color: "blue" },
  audio: { label: "AUDIO", icon: Mic2, color: "purple" },
  video: { label: "VIDEO", icon: Video, color: "pink" },
  image: { label: "IMAGE", icon: Image, color: "teal" },
  delay: { label: "DELAY", icon: Timer, color: "amber" },
  interactive: { label: "INTERACTIVE", icon: Zap, color: "blue" },
  blacklist: { label: "ACTION", icon: Zap, color: "red" },
};

const menuItems: Array<{ kind: FlowNodeKind; title: string; label: string }> = [
  { kind: "text", title: "Texto", label: "Mensagem de texto" },
  { kind: "audio", title: "Áudio", label: "Arquivo ou PTT" },
  { kind: "video", title: "Vídeo", label: "Vídeo com legenda" },
  { kind: "image", title: "Imagem", label: "Imagem com legenda" },
  { kind: "delay", title: "Delay", label: "Espera em ms" },
  { kind: "interactive", title: "Texto + Botão", label: "Reply ou CTA" },
  { kind: "blacklist", title: "Blacklist", label: "Bloquear contato" },
];

const initialNodes: Node<FlowNodeData>[] = [
  {
    id: "start",
    type: "flowCard",
    position: { x: 110, y: 145 },
    data: emptyStartData(),
  },
];

const initialEdges: Edge[] = [];

function readStoredFlow() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_FLOW_EDITOR_KEY) || "{}");
    if (Array.isArray(stored.nodes) && Array.isArray(stored.edges)) return stored;
  } catch {
    return null;
  }
  return null;
}

function readStoredRun(): FlowRun {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_FLOW_RUN_KEY) || "{}");
    return {
      ...defaultRun,
      ...stored,
      events: Array.isArray(stored.events) ? stored.events : [],
      messageIds: Array.isArray(stored.messageIds) ? stored.messageIds : [],
      statusByMessageId: stored.statusByMessageId && typeof stored.statusByMessageId === "object" ? stored.statusByMessageId : {},
    };
  } catch {
    return defaultRun;
  }
}

function readStoredFlowList(): SavedFlowSummary[] {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_FLOW_LIST_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function writeStoredFlowList(flows: SavedFlowSummary[]) {
  localStorage.setItem(LOCAL_FLOW_LIST_KEY, JSON.stringify(flows.slice(0, 80)));
}

function formatFlowDate(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function readLocalContactTags(): ContactTag[] {
  try {
    const store = JSON.parse(localStorage.getItem("scaleapi.localContacts") || "{}") as Record<string, { tag: ContactTag }>;
    const tags = Object.values(store).map((entry) => entry.tag).filter(Boolean);
    return tags.length ? tags : fallbackTags;
  } catch {
    return fallbackTags;
  }
}

function tagName(tag: ContactTag) {
  return String(tag.name || tag.id || "Etiqueta");
}

function tagCount(tag: ContactTag) {
  const value = Number(tag.contacts_count ?? tag.count ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function onlyDigits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function nowTime() {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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
    item.path ||
    String(item.url || item.public_url || item.publicUrl || "").match(/\/media\/files\/[^?#]+/)?.[0] ||
    "";
  const url = absoluteMediaUrl(item.public_url || item.publicUrl || item.url || storagePath);
  return {
    ...item,
    storagePath,
    url,
    public_url: url,
    publicUrl: url,
  };
}

function mediaItemUrl(item: LocalMediaItem) {
  return absoluteMediaUrl(item.public_url || item.publicUrl || item.url || item.storagePath || item.path);
}

function mediaItemName(item: LocalMediaItem) {
  return String(item.name || item.file_name || item.originalName || item.filename || mediaItemUrl(item).split("/").pop() || "Midia salva");
}

function mediaItemKind(item: LocalMediaItem) {
  const type = String(item.type || "").toLowerCase();
  const url = mediaItemUrl(item).toLowerCase();
  if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) return "image";
  if (type.startsWith("video/") || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) return "video";
  if (type.startsWith("audio/") || /\.(mp3|ogg|wav|m4a|aac)(\?|$)/i.test(url)) return "audio";
  return "document";
}

function mergeMediaItems(...groups: LocalMediaItem[][]) {
  const byId = new Map<string, LocalMediaItem>();
  groups.flat().map(normalizeMediaLibraryItem).forEach((item, index) => {
    const url = mediaItemUrl(item);
    if (!url) return;
    byId.set(String(item.id || url || index), item);
  });
  return Array.from(byId.values());
}

async function readFlowMediaLibrary() {
  const items: LocalMediaItem[][] = [];
  await mediaService.normalizedList().then((list) => items.push(list as LocalMediaItem[])).catch(() => null);
  try {
    const response = await fetch(`${movyBackendUrl()}/storage/${encodeURIComponent(MEDIA_LIBRARY_KEY)}`);
    const payload = await response.json().catch(() => ({}));
    if (Array.isArray(payload.value)) items.push(payload.value as LocalMediaItem[]);
  } catch {
    // local API unavailable
  }
  try {
    items.push(JSON.parse(localStorage.getItem(MEDIA_LIBRARY_KEY) || "[]") as LocalMediaItem[]);
  } catch {
    // optional local library
  }
  return mergeMediaItems(...items).sort((a, b) => String(mediaItemName(a)).localeCompare(mediaItemName(b)));
}

async function writeFlowMediaLibrary(value: LocalMediaItem[]) {
  const normalized = mergeMediaItems(value);
  localStorage.setItem(MEDIA_LIBRARY_KEY, JSON.stringify(normalized));
  await fetch(`${movyBackendUrl()}/storage/${encodeURIComponent(MEDIA_LIBRARY_KEY)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: normalized }),
  }).catch(() => null);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler arquivo."));
    reader.readAsDataURL(file);
  });
}

async function uploadFlowMedia(file: File) {
  const base64 = await readFileAsDataUrl(file);
  const response = await fetch(`${movyBackendUrl()}/media/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type, base64 }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || `Upload HTTP ${response.status}`);
  return normalizeMediaLibraryItem({
    id: String(data.filename || crypto.randomUUID()),
    name: file.name,
    file_name: file.name,
    type: String(data.type || file.type || ""),
    size: Number(data.size || file.size || 0),
    url: absoluteMediaUrl(String(data.path || "")),
    public_url: absoluteMediaUrl(String(data.path || "")),
    path: String(data.path || ""),
    storagePath: String(data.path || ""),
    created_at: new Date().toISOString(),
  });
}

function mediaAcceptForKind(kind: FlowNodeKind) {
  if (kind === "image") return "image/*";
  if (kind === "video") return "video/mp4,video/webm,video/quicktime,video/*";
  if (kind === "audio") return "audio/mpeg,audio/ogg,audio/wav,audio/*";
  return "*/*";
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

function normalizePhoneSender(account: BmSettingsData, phone: NonNullable<BmSettingsData["phones"]>[number], index: number): InfobipApi {
  const wabaId = account.defaultWabaId || account.wabaId || "";
  const phoneNumberId = phone.id;
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
    phoneNumber: phone.display_phone_number || "",
    verifiedName,
    sender_number: phone.display_phone_number || phoneNumberId || wabaId,
    senderNumber: phone.display_phone_number || phoneNumberId || wabaId,
    api_type: "whatsapp_cloud",
    base_url: wabaId ? `WABA ${wabaId}` : "WhatsApp Cloud API",
    status: account.status || "connected",
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

function dedupeSenders(senders: InfobipApi[]) {
  const byKey = new Map<string, InfobipApi>();
  senders.forEach((sender) => byKey.set(senderDedupeKey(sender), { ...byKey.get(senderDedupeKey(sender)), ...sender }));
  return Array.from(byKey.values());
}

function readBmSenders(): InfobipApi[] {
  const accounts = readBmAccounts();
  const connected = readConnectedSenders().map(normalizeConnectedSender);
  const accountSenders = accounts.flatMap((account, accountIndex) => {
    const wabaId = account.defaultWabaId || account.wabaId || "";
    const connectedPhoneIds = new Set([
      account.defaultPhoneNumberId || account.phoneNumberId || "",
      ...(account.connectedPhoneIds || []),
      ...readConnectedSenders()
        .filter((sender) => sender.bmId === accountKey(account) || sender.wabaId === wabaId)
        .map((sender) => sender.phoneNumberId),
    ].filter(Boolean));
    const phoneSenders = (account.phones || [])
      .filter((phone) => connectedPhoneIds.has(phone.id))
      .map((phone) => normalizePhoneSender(account, phone, accountIndex));
    if (phoneSenders.length) return phoneSenders;
    const fallbackPhoneId = account.defaultPhoneNumberId || account.phoneNumberId || "";
    if (!fallbackPhoneId) return [];
    const fallbackPhone = (account.phones || []).find((phone) => phone.id === fallbackPhoneId);
    const fallbackPhoneNumber = fallbackPhone?.display_phone_number || account.phoneNumber || "";
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
        phoneNumber: fallbackPhoneNumber,
        verifiedName: fallbackPhone?.verified_name || account.name || account.businessName || account.label,
        sender_number: fallbackPhoneNumber,
        senderNumber: fallbackPhoneNumber,
        api_type: "whatsapp_cloud",
        base_url: wabaId ? `WABA ${wabaId}` : "WhatsApp Cloud API",
        status: account.status || "connected",
      } as InfobipApi,
    ];
  });
  return dedupeSenders([...connected, ...accountSenders]);
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

function senderToBmAccount(sender: InfobipApi): BmSettingsData {
  const wabaId = String(sender.defaultWabaId || sender.wabaId || "").trim();
  const token = String(sender.accessToken || sender.token || "").trim();
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

function templateStatus(template: SavedTemplate) {
  return String(template.meta_status || template.status || "").trim().toUpperCase();
}

function isMetaTemplate(template: SavedTemplate) {
  const folder = String(template.folder || "").toLowerCase();
  return folder === "meta" || Boolean(template.waba_id || template.meta_status);
}

function isApprovedTemplate(template: SavedTemplate) {
  const status = templateStatus(template);
  return status === "APPROVED" || (!status && isMetaTemplate(template));
}

function templateDedupeKey(template: SavedTemplate) {
  const wabaId = String(template.waba_id || "").trim();
  const name = String(template.name || "").trim().toLowerCase();
  const language = String(template.language || "").trim().toLowerCase();
  return wabaId ? `waba:${wabaId}:${name}:${language}` : `name:${name}:${language}`;
}

function dedupeTemplates(items: SavedTemplate[]) {
  const seen = new Set<string>();
  return items.filter((template) => {
    const name = String(template.name || "").trim().toLowerCase();
    const language = String(template.language || "").trim().toLowerCase();
    const genericKey = `name:${name}:${language}`;
    const specificKey = templateDedupeKey(template);
    if (!name || seen.has(specificKey) || seen.has(genericKey)) return false;
    seen.add(specificKey);
    seen.add(genericKey);
    return true;
  });
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

async function fetchApprovedMetaTemplatesFromBmAccounts(extraAccounts: BmSettingsData[] = []) {
  const results: SavedTemplate[] = [];
  const accounts = [...readBmAccounts(), ...extraAccounts].filter((account, index, list) => {
    const key = accountKey(account, String(index));
    return list.findIndex((item, itemIndex) => accountKey(item, String(itemIndex)) === key) === index;
  });

  for (const account of accounts) {
    const token = account.accessToken?.trim();
    const wabaId = account.defaultWabaId || account.wabaId || "";
    if (!token || !wabaId) continue;
    try {
      const response = await metaGet<{ data?: MetaMessageTemplate[] }>(`${wabaId}/message_templates`, token, {
        fields: "id,name,status,language,category,components",
        limit: "250",
      });
      results.push(
        ...(response.data || [])
          .map((template) => metaTemplateToSavedTemplate(template, account))
          .filter(isApprovedTemplate),
      );
    } catch {
      // Fallbacks below keep the screen usable when one BM is temporarily blocked.
    }
  }

  return dedupeTemplates(results);
}

async function fetchBackendMessageTemplates() {
  const payload = await apiGet<unknown>("/message_templates");
  return unwrapList<SavedTemplate>(payload)
    .map((template) => ({
      ...template,
      folder: template.folder || "Meta",
      meta_status: String(template.meta_status || template.status || ""),
    }))
    .filter(isApprovedTemplate);
}

function senderLabel(sender: InfobipApi) {
  return String(sender.name || sender.label || sender.sender_number || sender.senderNumber || sender.id);
}

function senderNumber(sender: InfobipApi) {
  const phoneNumberId = String(sender.defaultPhoneNumberId || sender.phoneNumberId || "").trim();
  const matchedPhone = Array.isArray(sender.phones) ? sender.phones.find((phone) => phone.id === phoneNumberId) : undefined;
  const candidates = [
    matchedPhone?.display_phone_number,
    sender.display_phone_number,
    sender.displayPhoneNumber,
    sender.phoneNumber,
    sender.phone_number,
    sender.phone,
    sender.number,
    sender.sender_number,
    sender.senderNumber,
  ];
  const phone = candidates.find((value) => {
    const digits = onlyDigits(value);
    return digits.length >= 10 && digits.length <= 15;
  });
  return String(phone || "WhatsApp Cloud API");
}

function senderBusinessLabel(sender: InfobipApi) {
  return String(sender.businessName || sender.label || sender.base_url || "");
}

function templateMatchesSender(template: SavedTemplate, sender?: InfobipApi) {
  if (!sender) return true;
  const templateWaba = String(template.waba_id || "").trim();
  const senderWaba = String(sender.defaultWabaId || sender.wabaId || "").trim();
  if (!templateWaba || !senderWaba) return true;
  return templateWaba === senderWaba;
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

function readLocalTagContacts(tag: ContactTag): FlowRecipient[] {
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
        tagName: tagName(tag),
      }))
      .filter((contact) => contact.phone);
  } catch {
    return [];
  }
}

async function fetchTagRecipients(tag: ContactTag): Promise<FlowRecipient[]> {
  const local = readLocalTagContacts(tag);
  if (local.length) return local;

  const expected = Math.max(tagCount(tag), 1);
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
      tagName: tagName(tag),
    }))
    .filter((contact) => contact.phone);
}

function templateMediaType(template: SavedTemplate) {
  const components = Array.isArray(template.components) ? template.components : [];
  const header = components.find((component) => String(asRecord(component).type || "").toUpperCase() === "HEADER");
  const format = String(asRecord(header).format || "").toLowerCase();
  if (format.includes("video")) return "video";
  if (format.includes("document")) return "document";
  if (format.includes("image")) return "image";
  const legacy = String(template.media_type || template.header_type || "").toLowerCase();
  if (legacy.includes("video")) return "video";
  if (legacy.includes("document")) return "document";
  if (legacy.includes("image")) return "image";
  return "";
}

function normalizeTemplateParameterText(value: string) {
  return String(value || "")
    .replace(/\r\n|\r|\n|\u2028|\u2029/g, "\v")
    .replace(/\t+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
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
  return fallback;
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

function responseEvents(response: unknown) {
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
    return `${nowTime()} - ${String(message)}`;
  });
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

async function dispatchThroughSystem(payload: Record<string, unknown>, runtimeCredentials?: Record<string, unknown>) {
  const localBody = { ...payload, runtimeCredentials };
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
      if (!id) throw new Error("o backend criou o lote, mas nao retornou ID para iniciar o disparo");
      return await broadcasts.start(id, { payload, broadcastId: id });
    } catch (createError) {
      throw new Error(`dispatch: ${formatBackendError(dispatchError)} | create/start: ${formatBackendError(createError)}`);
    }
  }
}

async function fetchLocalMessageStatuses(messageIds: string[]) {
  if (!messageIds.length) return [];
  const response = await fetch(`${movyBackendUrl()}/broadcast/statuses?ids=${encodeURIComponent(messageIds.join(","))}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Status local HTTP ${response.status}`);
  return Array.isArray(data.statuses) ? (data.statuses as FlowMessageStatus[]) : [];
}

async function fetchLocalFlowRuns(messageIds: string[]) {
  if (!messageIds.length) return { sessions: [] as FlowRuntimeSession[], events: [] as FlowRuntimeEvent[] };
  const response = await fetch(`${movyBackendUrl()}/flows/runs?messageIds=${encodeURIComponent(messageIds.join(","))}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Flow runtime HTTP ${response.status}`);
  return {
    sessions: Array.isArray(data.sessions) ? (data.sessions as FlowRuntimeSession[]) : [],
    events: Array.isArray(data.events) ? (data.events as FlowRuntimeEvent[]) : [],
  };
}

function FlowCardNode({ data, selected }: NodeProps<FlowNodeData>) {
  const meta = nodeInfo[data.kind];
  const Icon = meta.icon;
  const isStart = data.kind === "start";
  const isMedia = ["audio", "video", "image"].includes(data.kind);
  const startLines = (data.body || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const startImageUrl = String(data.imageUrl || "").includes("images.unsplash.com/photo-1494790108377")
    ? ""
    : String(data.imageUrl || "");
  const startHasMedia = isStart && Boolean(startImageUrl);
  const startMediaType = String(data.mediaType || "").toLowerCase();
  const nodeMediaUrl = String(data.imageUrl || "").trim();
  const nodeMediaName = String(data.mediaName || data.subtitle || "Midia selecionada");

  return (
    <div className={`dc-node dc-node-${meta.color} ${selected ? "selected" : ""} ${isStart ? "dc-start-node" : ""}`}>
      {selected && data.deletable && data.onDelete ? (
        <button className="dc-node-delete" type="button" onClick={data.onDelete} aria-label="Excluir no">
          <X size={18} />
        </button>
      ) : null}
      <Handle type="target" position={Position.Left} />
      <div className="dc-node-grip" />
      <div className="dc-node-head">
        <Icon size={14} />
        <div>
          <strong>{data.title}</strong>
          <span>{data.subtitle}</span>
        </div>
      </div>

      {isStart ? (
        <div className={`dc-whatsapp-card dc-flow-phone-preview ${startHasMedia ? "has-media" : "text-only"}`}>
          <div className="dc-flow-phone-top" />
          {startHasMedia ? (
            <div className="dc-flow-preview-media">
              {startMediaType === "video" ? (
                <>
                  <video src={startImageUrl} muted playsInline />
                  <span className="dc-flow-play"><Play size={20} /></span>
                </>
              ) : (
                <img alt="" src={startImageUrl} />
              )}
            </div>
          ) : null}
          <div className={`dc-whatsapp-body ${startHasMedia ? "" : "rounded"}`}>
            {startLines.length ? (
              startLines.map((line, index) => (
                <p key={`${line}-${index}`}>{line}</p>
              ))
            ) : (
              <p>Selecione um template aprovado para iniciar o fluxo.</p>
            )}
            {data.footer ? <small>{data.footer}</small> : null}
          </div>
          {(data.buttons || []).map((button, index) => (
            <div className="dc-reply-row" key={`${button}-${index}`}>
              <span>{button}</span>
              <i />
              <Handle
                className="dc-button-handle"
                id={`button-${index}`}
                position={Position.Right}
                type="source"
              />
            </div>
          ))}
          <time>12:00</time>
        </div>
      ) : isMedia ? (
        <div className={`dc-media-slot ${nodeMediaUrl ? "filled" : ""}`}>
          {nodeMediaUrl ? (
            <>
              {data.kind === "image" ? <img alt="" src={nodeMediaUrl} /> : null}
              {data.kind === "video" ? <video src={nodeMediaUrl} muted playsInline /> : null}
              {data.kind === "audio" ? (
                <span className="dc-media-audio-icon">
                  <Mic2 size={18} />
                </span>
              ) : null}
              <span>{nodeMediaName}</span>
            </>
          ) : (
            `Adicionar ${data.kind === "audio" ? "audio" : data.kind === "video" ? "video" : "imagem"}`
          )}
        </div>
      ) : data.kind === "interactive" ? (
        <div className="dc-interactive-preview">
          <p>{data.body || "Texto do corpo..."}</p>
          <button type="button">{data.buttons?.[0] || "CLIQUE AQUI"}</button>
        </div>
      ) : data.kind === "blacklist" ? (
        <div className="dc-action-preview">blacklist</div>
      ) : null}

      {!isStart && !isMedia && data.kind !== "interactive" && data.kind !== "blacklist" ? (
        <div className="dc-simple-preview">{data.body || data.subtitle}</div>
      ) : null}
      {!isStart ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}

const nodeTypes = { flowCard: FlowCardNode };

export function Flows() {
  const stored = readStoredFlow();
  const [nodes, setNodes, baseOnNodesChange] = useNodesState<FlowNodeData>(stored?.nodes || initialNodes);
  const [edges, setEdges, baseOnEdgesChange] = useEdgesState(stored?.edges || initialEdges);
  const [flowName, setFlowName] = useState(stored?.name || "teste");
  const [selectedNodeId, setSelectedNodeId] = useState(stored?.selectedNodeId || "start");
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [senders, setSenders] = useState<InfobipApi[]>([]);
  const [currentFlowId, setCurrentFlowId] = useState(stored?.id || "");
  const [nodeMenu, setNodeMenu] = useState<{
    x: number;
    y: number;
    source?: string;
    sourceHandle?: string;
  } | null>(null);
  const [pendingConnection, setPendingConnection] = useState<{ source?: string; sourceHandle?: string } | null>(null);
  const [tags, setTags] = useState<ContactTag[]>(() => readLocalContactTags());
  const [flowRun, setFlowRun] = useState<FlowRun>(() => readStoredRun());
  const [jsonOpen, setJsonOpen] = useState(false);
  const [status, setStatus] = useState("Flow editor pronto.");
  const [flowDirty, setFlowDirty] = useState(false);
  const [savedFlowAt, setSavedFlowAt] = useState(stored?.updatedAt || "");
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [flowView, setFlowView] = useState<"dashboard" | "editor">("dashboard");
  const [flowList, setFlowList] = useState<SavedFlowSummary[]>(() => readStoredFlowList());
  const [flowSearch, setFlowSearch] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", senderId: "", templateId: "" });
  const [mediaLibrary, setMediaLibrary] = useState<LocalMediaItem[]>([]);
  const [mediaUploadingNodeId, setMediaUploadingNodeId] = useState("");

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);
  const selectedMeta = selectedNode ? nodeInfo[selectedNode.data.kind] : null;
  const renderedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
        data: {
          ...node.data,
          deletable: true,
          onDelete: () => removeNodeById(node.id),
        },
      })),
    [nodes, selectedNodeId],
  );
  const selectedRunTag = useMemo(
    () => tags.find((tag) => tag.id === flowRun.tagId) || tags[0],
    [flowRun.tagId, tags],
  );
  const selectedRunSender = useMemo(
    () => senders.find((sender) => sender.id === flowRun.senderId) || senders[0],
    [flowRun.senderId, senders],
  );
  const runPercent = flowRun.total ? Math.min(100, Math.round(((flowRun.delivered + flowRun.failed) / flowRun.total) * 100)) : 0;
  const canOpenBroadcast = Boolean(savedFlowAt) && !flowDirty;
  const filteredFlows = useMemo(() => {
    const query = flowSearch.trim().toLowerCase();
    if (!query) return flowList;
    return flowList.filter((item) =>
      [item.name, item.senderName, item.templateName, item.stats?.status].join(" ").toLowerCase().includes(query),
    );
  }, [flowList, flowSearch]);
  const createTemplateOptions = useMemo(() => {
    const sender = senders.find((item) => item.id === createForm.senderId);
    return templates.filter((template) => templateMatchesSender(template, sender));
  }, [createForm.senderId, senders, templates]);
  const currentSenderTemplates = useMemo(() => {
    const sender = senders.find((item) => item.id === flowRun.senderId);
    return templates.filter((template) => templateMatchesSender(template, sender));
  }, [flowRun.senderId, senders, templates]);
  const selectedMediaItems = useMemo(() => {
    const kind = selectedNode?.data.kind;
    if (!kind || !["image", "video", "audio"].includes(kind)) return [];
    return mediaLibrary.filter((item) => mediaItemKind(item) === kind);
  }, [mediaLibrary, selectedNode?.data.kind]);

  const markFlowDirty = useCallback(() => {
    setFlowDirty(true);
    setBroadcastOpen(false);
  }, []);

  const onNodesChange = useCallback(
    (changes: Parameters<typeof baseOnNodesChange>[0]) => {
      markFlowDirty();
      baseOnNodesChange(changes);
    },
    [baseOnNodesChange, markFlowDirty],
  );

  const onEdgesChange = useCallback(
    (changes: Parameters<typeof baseOnEdgesChange>[0]) => {
      markFlowDirty();
      baseOnEdgesChange(changes);
    },
    [baseOnEdgesChange, markFlowDirty],
  );

  const onConnect = useCallback(
    (connection: Edge | Connection) => {
      markFlowDirty();
      setEdges((current) => addEdge({ ...connection, animated: true }, current));
    },
    [markFlowDirty, setEdges],
  );

  const onConnectStart = useCallback((_: unknown, params: { nodeId?: string | null; handleId?: string | null }) => {
    setPendingConnection({
      source: params.nodeId || undefined,
      sourceHandle: params.handleId || undefined,
    });
  }, []);

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null;
      const isPane = target?.classList.contains("react-flow__pane");
      if (!isPane || !pendingConnection?.source) {
        setPendingConnection(null);
        return;
      }

      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      const canvas = target?.closest(".dc-canvas-wrap")?.getBoundingClientRect();
      setNodeMenu({
        x: Math.max(18, point.clientX - (canvas?.left || 0)),
        y: Math.max(18, point.clientY - (canvas?.top || 0)),
        source: pendingConnection.source,
        sourceHandle: pendingConnection.sourceHandle,
      });
      setPendingConnection(null);
    },
    [pendingConnection],
  );

  useEffect(() => {
    infobipApis
      .normalizedList()
      .then((items) => setSenders(dedupeSenders([...readBmSenders(), ...items])))
      .catch(() => setSenders(readBmSenders()));
  }, []);

  useEffect(() => {
    let active = true;
    async function loadTemplates() {
      const senderAccounts = senders.map(senderToBmAccount).filter((account) => account.accessToken && (account.defaultWabaId || account.wabaId));
      const [directMetaTemplates, savedMetaTemplates, backendTemplates] = await Promise.all([
        fetchApprovedMetaTemplatesFromBmAccounts(senderAccounts).catch(() => [] as SavedTemplate[]),
        savedTemplates.normalizedList("Meta").catch(() => [] as SavedTemplate[]),
        fetchBackendMessageTemplates().catch(() => [] as SavedTemplate[]),
      ]);
      const cachedTemplates = readCachedMetaTemplates();
      const nextTemplates = dedupeTemplates([
        ...directMetaTemplates,
        ...savedMetaTemplates.filter(isApprovedTemplate),
        ...cachedTemplates,
        ...backendTemplates,
      ]);
      if (active) setTemplates(nextTemplates);
    }
    void loadTemplates();
    return () => {
      active = false;
    };
  }, [senders]);

  useEffect(() => {
    setTags(readLocalContactTags());
  }, []);

  useEffect(() => {
    let active = true;
    readFlowMediaLibrary()
      .then((items) => {
        if (active) setMediaLibrary(items);
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setCreateForm((current) => ({
      ...current,
      senderId: current.senderId || senders[0]?.id || "",
      templateId: (() => {
        const sender = senders.find((item) => item.id === (current.senderId || senders[0]?.id || ""));
        const options = templates.filter((template) => templateMatchesSender(template, sender));
        return options.some((template) => template.id === current.templateId) ? current.templateId : options[0]?.id || "";
      })(),
    }));
  }, [senders, templates]);

  useEffect(() => {
    if (!flowRun.messageIds.length || flowRun.status === "idle" || flowRun.status === "paused") return;
    const timer = window.setInterval(async () => {
      try {
        const [statuses, runtime] = await Promise.all([
          fetchLocalMessageStatuses(flowRun.messageIds).catch(() => []),
          fetchLocalFlowRuns(flowRun.messageIds).catch(() => ({ sessions: [], events: [] })),
        ]);
        if (!statuses.length && !runtime.events.length && !runtime.sessions.length) return;
        setFlowRun((current) => {
          const statusByMessageId = { ...current.statusByMessageId };
          statuses.forEach((statusItem) => {
            if (statusItem.id) statusByMessageId[statusItem.id] = statusItem;
          });
          const values = Object.values(statusByMessageId).map((item) => String(item.status || "").toLowerCase());
          const delivered = values.filter((value) => ["delivered", "read", "sent"].includes(value)).length;
          const failed = values.filter((value) => ["failed", "error", "undeliverable"].includes(value)).length;
          const waiting = Math.max(0, current.sent - delivered - failed);
          const runtimeEvents = runtime.events
            .map((event) => {
              const time = event.at
                ? new Date(event.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                : nowTime();
              return `${time} - ${event.message || "Evento do fluxo"}`;
            })
            .filter(Boolean);
          const hasRunningSession = runtime.sessions.some((session) =>
            ["waiting_reply", "routing", "sending"].includes(String(session.status || "")),
          );
          const hasFailedSession = runtime.sessions.some((session) => String(session.status || "") === "failed");
          const runtimeFailed = runtime.sessions.filter((session) => String(session.status || "") === "failed").length;
          const doneByRuntime = runtime.sessions.length > 0 && !hasRunningSession;
          const done = doneByRuntime || (current.sent > 0 && waiting === 0);
          const next: FlowRun = {
            ...current,
            delivered,
            failed: Math.max(failed, runtimeFailed, hasFailedSession ? current.failed : 0),
            waiting,
            statusByMessageId,
            status: done ? "done" : current.status,
            currentStep: done ? "Fluxo finalizado" : hasRunningSession ? "Aguardando resposta ou proximo no" : "Aguardando webhook/status da Cloud API",
            events: Array.from(new Set([...runtimeEvents, ...current.events])).slice(0, 12),
          };
          localStorage.setItem(LOCAL_FLOW_RUN_KEY, JSON.stringify(next));
          syncCurrentFlowSummary(next);
          return next;
        });
      } catch {
        // Status local pode nao existir antes do webhook receber evento.
      }
    }, 3500);
    return () => window.clearInterval(timer);
  }, [currentFlowId, flowRun.messageIds, flowRun.status]);


  function rebuildButtonBranches(buttons: string[]) {
    markFlowDirty();
    const branchNodes: Node<FlowNodeData>[] = buttons.map((button, index) => {
      const isNegative = /nao|não|sair|parar|cancel/i.test(button);
      return {
        id: `button-${index}-${isNegative ? "blacklist" : "text"}`,
        type: "flowCard",
        position: { x: 435, y: 120 + index * 180 },
        data: isNegative
          ? { kind: "blacklist", title: `Resposta ${button}`, subtitle: "blacklist" }
          : {
              kind: "text",
              title: `Resposta ${button}`,
              subtitle: `Caminho do botão ${button}`,
              body: `Contato clicou em ${button}.`,
            },
      };
    });

    setNodes((current) => [
      ...current.filter((node) => node.id === "start" || !node.id.startsWith("button-")),
      ...branchNodes,
    ]);
    setEdges((current) => [
      ...current.filter((edge) => edge.source !== "start" && !edge.target.startsWith("button-")),
      ...branchNodes.map((node, index) => ({
        id: `e-start-button-${index}`,
        source: "start",
        sourceHandle: `button-${index}`,
        target: node.id,
        animated: true,
        label: buttons[index],
      })),
    ]);
  }

  function selectTemplate(templateId: string) {
    if (!templateId) {
      removeNodeById("start");
      return;
    }
    markFlowDirty();
    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      setStatus("Template aprovado nao encontrado para esse remetente.");
      return;
    }
    const currentStart = nodes.find((node) => node.id === "start");
    const nextData = templateToStartData(template, currentStart?.data.variableValues);
    setNodes((current) =>
      current.map((node) =>
        node.id === "start"
          ? {
              ...node,
              data: nextData,
            }
          : node,
      ),
    );
    setStatus(`Template "${template.name}" carregado. Puxe uma saída do botão para continuar o fluxo.`);
  }

  function updateTemplateVariable(variable: string, value: string) {
    markFlowDirty();
    const startNode = nodes.find((node) => node.id === "start");
    const template = templates.find((item) => item.id === startNode?.data.templateId);
    if (!template) return;
    const nextValues = {
      ...(startNode?.data.variableValues || {}),
      [variable]: value,
    };
    const nextData = templateToStartData(template, nextValues);
    setNodes((current) => current.map((node) => (node.id === "start" ? { ...node, data: nextData } : node)));
  }

  function addNode(kind: FlowNodeKind) {
    markFlowDirty();
    const item = menuItems.find((entry) => entry.kind === kind);
    const x = nodeMenu?.x ? nodeMenu.x + 80 : 675;
    const y = nodeMenu?.y ? nodeMenu.y - 40 : 210 + nodes.length * 24;
    const node: Node<FlowNodeData> = {
      id: `${kind}-${Date.now()}`,
      type: "flowCard",
      position: { x, y },
      data: {
        kind,
        title: item?.title || "Novo bloco",
        subtitle: item?.label || "",
        body: kind === "text" ? "" : undefined,
        delayMs: kind === "delay" ? "1000" : undefined,
        buttons: kind === "interactive" ? ["CLIQUE AQUI"] : undefined,
      },
    };
    setNodes((current) => [...current, node]);
    if (nodeMenu?.source) {
      const source = nodeMenu.source;
      setEdges((current) =>
        addEdge(
          {
            id: `e-${source}-${node.id}`,
            source,
            sourceHandle: nodeMenu.sourceHandle || null,
            target: node.id,
            animated: true,
          },
          current,
        ),
      );
    }
    setSelectedNodeId(node.id);
    setNodeMenu(null);
  }

  function updateSelected(patch: Partial<FlowNodeData>) {
    if (!selectedNode) return;
    markFlowDirty();
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: { ...node.data, ...patch },
            }
          : node,
      ),
    );
  }

  async function refreshMediaLibrary() {
    const items = await readFlowMediaLibrary();
    setMediaLibrary(items);
    return items;
  }

  async function handleNodeMediaUpload(file?: File | null) {
    if (!selectedNode || !file) return;
    const kind = selectedNode.data.kind;
    if (!["image", "video", "audio"].includes(kind)) return;
    setMediaUploadingNodeId(selectedNode.id);
    try {
      const item = await uploadFlowMedia(file);
      const nextLibrary = mergeMediaItems(mediaLibrary, [item]);
      setMediaLibrary(nextLibrary);
      await writeFlowMediaLibrary(nextLibrary);
      updateSelected({
        imageUrl: mediaItemUrl(item),
        mediaType: mediaItemKind(item),
        mediaName: mediaItemName(item),
        subtitle: mediaItemName(item),
      });
      setStatus(`${mediaItemName(item)} vinculado ao bloco ${selectedNode.data.title}.`);
    } catch (error) {
      setStatus(`Falha ao enviar midia: ${error instanceof Error ? error.message : "erro desconhecido"}`);
    } finally {
      setMediaUploadingNodeId("");
    }
  }

  function selectNodeMedia(item: LocalMediaItem) {
    if (!selectedNode) return;
    updateSelected({
      imageUrl: mediaItemUrl(item),
      mediaType: mediaItemKind(item),
      mediaName: mediaItemName(item),
      subtitle: mediaItemName(item),
    });
    setStatus(`${mediaItemName(item)} selecionado para o bloco ${selectedNode.data.title}.`);
  }

  function clearSelectedMedia() {
    if (!selectedNode) return;
    updateSelected({
      imageUrl: "",
      mediaType: "",
      mediaName: "",
      subtitle: nodeInfo[selectedNode.data.kind].label,
    });
  }

  function updateSelectedButton(index: number, value: string) {
    const buttons = [...(selectedNode?.data.buttons || [])];
    buttons[index] = value;
    updateSelected({ buttons });
  }

  function addSelectedButton() {
    const buttons = [...(selectedNode?.data.buttons || [])];
    if (buttons.length >= 3) return;
    updateSelected({ buttons: [...buttons, `Botao ${buttons.length + 1}`] });
  }

  function removeSelectedButton(index: number) {
    const buttons = [...(selectedNode?.data.buttons || [])];
    buttons.splice(index, 1);
    updateSelected({ buttons: buttons.length ? buttons : ["CLIQUE AQUI"] });
  }

  function removeNodeById(nodeId: string) {
    markFlowDirty();
    if (nodeId === "start") {
      setNodes((current) =>
        current.map((node) =>
          node.id === "start"
            ? {
                ...node,
                data: emptyStartData(),
              }
            : node,
        ),
      );
      setEdges((current) => current.filter((edge) => edge.source !== "start"));
      setSelectedNodeId("start");
      setStatus("Template inicial removido. Selecione outro para iniciar o fluxo.");
      return;
    }
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNodeId("start");
  }

  function saveFlow() {
    const updatedAt = new Date().toISOString();
    const id = currentFlowId || crypto.randomUUID();
    const startNode = nodes.find((node) => node.id === "start");
    const sender = senders.find((item) => item.id === flowRun.senderId);
    const template = templates.find((item) => item.id === startNode?.data.templateId);
    const payload = { id, name: flowName, nodes, edges, selectedNodeId, updatedAt };
    localStorage.setItem(LOCAL_FLOW_EDITOR_KEY, JSON.stringify(payload));
    setCurrentFlowId(id);
    setSavedFlowAt(updatedAt);
    setFlowDirty(false);
    const summary: SavedFlowSummary = {
      id,
      name: flowName,
      senderId: flowRun.senderId,
      senderName: sender ? senderLabel(sender) : "Remetente nao definido",
      templateId: String(startNode?.data.templateId || ""),
      templateName: template?.name || startNode?.data.subtitle || "Template",
      nodes,
      edges,
      selectedNodeId,
      updatedAt,
      stats: {
        total: flowRun.total,
        sent: flowRun.sent,
        delivered: flowRun.delivered,
        failed: flowRun.failed,
        waiting: flowRun.waiting,
        status: flowRun.status,
      },
    };
    setFlowList((current) => {
      const next = [summary, ...current.filter((item) => item.id !== id)];
      writeStoredFlowList(next);
      return next;
    });
    setStatus("Fluxo salvo localmente.");
  }

  function syncCurrentFlowSummary(nextRun: FlowRun, updatedAt = new Date().toISOString()) {
    if (currentFlowId) {
      setFlowList((current) => {
        const next = current.map((item) =>
          item.id === currentFlowId
            ? {
                ...item,
                updatedAt,
                stats: {
                  total: nextRun.total,
                  sent: nextRun.sent,
                  delivered: nextRun.delivered,
                  failed: nextRun.failed,
                  waiting: nextRun.waiting,
                  status: nextRun.status,
                },
              }
            : item,
        );
        writeStoredFlowList(next);
        return next;
      });
    }
  }

  function updateRun(nextRun: FlowRun) {
    setFlowRun(nextRun);
    localStorage.setItem(LOCAL_FLOW_RUN_KEY, JSON.stringify(nextRun));
    syncCurrentFlowSummary(nextRun);
  }

  function openFlow(flow: SavedFlowSummary) {
    setCurrentFlowId(flow.id);
    setFlowName(flow.name);
    setNodes(flow.nodes || initialNodes);
    setEdges(flow.edges || initialEdges);
    setSelectedNodeId(flow.selectedNodeId || "start");
    setSavedFlowAt(flow.updatedAt);
    setFlowDirty(false);
    setFlowRun({
      ...defaultRun,
      senderId: flow.senderId,
      ...(flow.stats
        ? {
            total: flow.stats.total,
            sent: flow.stats.sent,
            delivered: flow.stats.delivered,
            failed: flow.stats.failed,
            waiting: flow.stats.waiting,
            status: flow.stats.status,
          }
        : {}),
    });
    localStorage.setItem(
      LOCAL_FLOW_EDITOR_KEY,
      JSON.stringify({ id: flow.id, name: flow.name, nodes: flow.nodes, edges: flow.edges, selectedNodeId: flow.selectedNodeId, updatedAt: flow.updatedAt }),
    );
    setFlowView("editor");
    setStatus("Fluxo carregado.");
  }

  function openCreateFlowModal() {
    const senderId = senders[0]?.id || "";
    const sender = senders.find((item) => item.id === senderId);
    const firstTemplate = templates.find((template) => templateMatchesSender(template, sender));
    setCreateForm({
      name: `Fluxo ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`,
      senderId,
      templateId: firstTemplate?.id || "",
    });
    setCreateModalOpen(true);
  }

  function createFlowFromForm() {
    const sender = senders.find((item) => item.id === createForm.senderId);
    const template = templates.find((item) => item.id === createForm.templateId);
    if (!sender || !template) {
      setStatus("Escolha um remetente e um template para criar o fluxo.");
      return;
    }
    const id = crypto.randomUUID();
    const startData = templateToStartData(template);
    const nextNodes: Node<FlowNodeData>[] = [
      {
        id: "start",
        type: "flowCard",
        position: { x: 90, y: 110 },
        data: startData,
      },
    ];
    const nextEdges: Edge[] = [];
    setCurrentFlowId(id);
    setFlowName(createForm.name.trim() || template.name);
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId("start");
    setSavedFlowAt("");
    setFlowDirty(true);
    setFlowRun({ ...defaultRun, senderId: sender.id });
    localStorage.setItem(LOCAL_FLOW_RUN_KEY, JSON.stringify({ ...defaultRun, senderId: sender.id }));
    setCreateModalOpen(false);
    setFlowView("editor");
    setStatus("Fluxo criado. Ajuste as variaveis do template e salve para liberar o disparo.");
  }

  function deleteFlow(flowId: string) {
    setFlowList((current) => {
      const next = current.filter((item) => item.id !== flowId);
      writeStoredFlowList(next);
      return next;
    });
    if (flowId === currentFlowId) {
      setCurrentFlowId("");
      setFlowView("dashboard");
    }
  }

  async function startFlowBroadcast() {
    const sender = selectedRunSender;
    const tag = selectedRunTag;
    const startNode = nodes.find((node) => node.id === "start");
    const template = templates.find((item) => item.id === startNode?.data.templateId);
    if (!sender) {
      setStatus("Selecione um remetente conectado antes de disparar o fluxo.");
      return;
    }
    if (!tag) {
      setStatus("Selecione uma etiqueta de contatos antes de disparar o fluxo.");
      return;
    }
    if (!template) {
      setStatus("Selecione e salve um template inicial antes de disparar o fluxo.");
      return;
    }

    const account = findAccountForSender(sender);
    const phoneNumberId = String(sender.phoneNumberId || sender.defaultPhoneNumberId || account?.phoneNumberId || account?.defaultPhoneNumberId || "").trim();
    const accessToken = String(sender.accessToken || sender.token || account?.accessToken || "").trim();
    if (!phoneNumberId || !accessToken) {
      setStatus("Remetente sem Phone Number ID ou token. Confira Configuracoes BM e Registrar Remetente.");
      return;
    }

    saveFlow();
    setStatus("Carregando contatos da etiqueta...");
    updateRun({
      ...defaultRun,
      status: "sending",
      senderId: sender.id,
      tagId: tag.id,
      total: Math.max(tagCount(tag), 1),
      currentStep: "Carregando destinatarios",
      events: [`${nowTime()} - Preparando fluxo ${flowName} para ${tagName(tag)}.`],
      startedAt: new Date().toISOString(),
    });

    let recipients: FlowRecipient[] = [];
    try {
      recipients = await fetchTagRecipients(tag);
    } catch (error) {
      const message = error instanceof Error ? error.message : "falha desconhecida";
      updateRun({
        ...defaultRun,
        status: "done",
        senderId: sender.id,
        tagId: tag.id,
        failed: 1,
        currentStep: "Falha ao carregar contatos",
        events: [`${nowTime()} - Nao foi possivel carregar contatos: ${message}`],
      });
      setStatus(`Nao foi possivel carregar os contatos: ${message}`);
      return;
    }

    const total = recipients.length;
    if (!total) {
      updateRun({
        ...defaultRun,
        status: "done",
        senderId: sender.id,
        tagId: tag.id,
        currentStep: "Sem destinatarios",
        events: [`${nowTime()} - Nenhum destinatario valido encontrado na etiqueta ${tagName(tag)}.`],
      });
      setStatus("Nenhum destinatario valido encontrado na etiqueta selecionada.");
      return;
    }

    const variables = Object.fromEntries(
      (startNode?.data.variables || []).map((variable) => [
        variable,
        normalizeTemplateParameterText(startNode?.data.variableValues?.[variable] || ""),
      ]),
    );
    const mediaUrl = String(startNode?.data.imageUrl || template.media_url || template.header_url || "").trim();
    const lotId = `${sender.id}-${template.id}-${tag.id}`;
    const payload: Record<string, unknown> = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: "created",
      channel: "whatsapp_cloud_flow",
      mode: "flow",
      flow: {
        name: flowName,
        nodes,
        edges,
        startNodeId: "start",
      },
      sender: {
        id: sender.id,
        name: senderLabel(sender),
        bmName: senderBusinessLabel(sender),
        wabaId: sender.defaultWabaId || sender.wabaId || "",
        phoneNumberId,
        phoneNumber: senderNumber(sender),
        accessToken,
        apiType: sender.api_type || "whatsapp_cloud",
      },
      totals: {
        contacts: total,
        recipients: total,
        lots: 1,
        templates: 1,
        tags: 1,
      },
      lots: [
        {
          id: lotId,
          index: 1,
          sender: {
            id: sender.id,
            name: senderLabel(sender),
            bmName: senderBusinessLabel(sender),
            wabaId: sender.defaultWabaId || sender.wabaId || "",
            phoneNumberId,
            phoneNumber: senderNumber(sender),
            accessToken,
            apiType: sender.api_type || "whatsapp_cloud",
          },
          template: {
            id: template.id,
            name: template.name,
            language: template.language || "pt_BR",
            body_text: templateBody(template),
            footer_text: templateFooter(template),
            buttons: template.buttons || [],
            components: template.components || [],
            media_type: template.media_type || "",
            header_type: template.header_type || "",
            wabaId: template.waba_id || sender.defaultWabaId || sender.wabaId || "",
            variables,
            media: mediaUrl
              ? {
                  url: mediaUrl,
                  name: mediaUrl.split("/").pop() || "midia",
                  type: templateMediaType(template) || "image",
                }
              : null,
          },
          audience: {
            tagId: tag.id,
            tagName: tagName(tag),
            contacts: total,
          },
          recipients: recipients.map((recipient) => ({
            id: recipient.id,
            name: recipient.name || recipient.nome || "",
            phone: normalizeRecipientPhone(recipient.phone),
            tagId: recipient.tagId,
            tagName: recipient.tagName,
            templateId: template.id,
            templateName: template.name,
            variables,
          })),
        },
      ],
      recipients: recipients.map((recipient) => ({
        id: recipient.id,
        name: recipient.name || recipient.nome || "",
        phone: normalizeRecipientPhone(recipient.phone),
        tagId: recipient.tagId,
        tagName: recipient.tagName,
        lotId,
        senderId: sender.id,
        senderName: senderLabel(sender),
        phoneNumberId,
        accessToken,
        templateId: template.id,
        templateName: template.name,
        variables,
        mediaUrl,
      })),
    };

    updateRun({
      status: "sending",
      senderId: sender.id,
      tagId: tag.id,
      total,
      sent: 0,
      delivered: 0,
      failed: 0,
      waiting: total,
      currentStep: "Enviando template inicial",
      events: [`${nowTime()} - Lote do fluxo criado com ${total.toLocaleString("pt-BR")} destinatario(s).`],
      messageIds: [],
      statusByMessageId: {},
      startedAt: new Date().toISOString(),
    });

    try {
      const response = await dispatchThroughSystem(payload, { phoneNumberId, accessToken });
      const responseRecord = asRecord(response);
      const messageIds = backendMessageIds(response);
      const accepted = numberFromResponse(responseRecord, ["accepted", "accepted_count", "sent", "sent_count", "queued", "queued_count"], messageIds.length);
      const failed = numberFromResponse(responseRecord, ["failed", "failed_count", "errors", "error_count"], 0);
      const waiting = Math.max(0, accepted - failed);
      const next: FlowRun = {
        status: failed && !accepted ? "done" : "sending",
        senderId: sender.id,
        tagId: tag.id,
        total,
        sent: accepted,
        delivered: 0,
        failed,
        waiting,
        currentStep: failed && !accepted ? "Falha no envio inicial" : "Aceito pela Meta, aguardando webhook",
        events: [
          `${nowTime()} - ${accepted.toLocaleString("pt-BR")} mensagem(ns) aceita(s) pela Meta.`,
          ...responseEvents(response),
        ].slice(0, 12),
        messageIds,
        statusByMessageId: {},
        startedAt: new Date().toISOString(),
      };
      updateRun(next);
      setStatus(
        failed
          ? "O fluxo retornou falhas imediatas. Veja os detalhes no historico do disparo."
          : "Fluxo enviado. Acompanhe entrega/falha pelo webhook da Cloud API.",
      );
    } catch (error) {
      const message = formatBackendError(error);
      updateRun({
        status: "done",
        senderId: sender.id,
        tagId: tag.id,
        total,
        sent: 0,
        delivered: 0,
        failed: total,
        waiting: 0,
        currentStep: "Falha ao disparar",
        events: [`${nowTime()} - Falha ao disparar fluxo: ${message}`],
        messageIds: [],
        statusByMessageId: {},
        startedAt: new Date().toISOString(),
      });
      setStatus(`Falha ao disparar fluxo: ${message}`);
    }
  }

  function pauseFlowBroadcast() {
    if (flowRun.status === "sending") updateRun({ ...flowRun, status: "paused", currentStep: "Pausado" });
    if (flowRun.status === "paused") updateRun({ ...flowRun, status: "sending", currentStep: "Retomando fluxo" });
  }

  function clearFlowBroadcast() {
    updateRun(defaultRun);
    setStatus("Execucao do fluxo limpa.");
  }

  const jsonValue = JSON.stringify({ name: flowName, nodes, edges }, null, 2);

  if (flowView === "dashboard") {
    return (
      <main className="template-page broadcast-page flow-manager-page">
        <section className="broadcast-dashboard">
          <div className="broadcast-dashboard-head">
            <div>
              <h1>Flows</h1>
              <p>Crie jornadas com remetente, template inicial e respostas automaticas por botoes.</p>
            </div>
            <div className="broadcast-dashboard-actions">
              <button className="button secondary" onClick={() => setFlowList(readStoredFlowList())} type="button">
                <RefreshCcw size={16} />
                Atualizar
              </button>
              <button className="button" onClick={openCreateFlowModal} type="button">
                <Plus size={16} />
                Criar fluxo
              </button>
            </div>
          </div>

          <section className="broadcast-campaign-panel">
            <div className="broadcast-list-toolbar">
              <label className="search-field">
                <Search size={16} />
                <input
                  placeholder="Buscar fluxo por nome, remetente ou template..."
                  value={flowSearch}
                  onChange={(event) => setFlowSearch(event.target.value)}
                />
              </label>
              <span>{filteredFlows.length} de {flowList.length} fluxo(s)</span>
            </div>

            <div className="campaign-table flow-table">
              <div className="campaign-table-head">
                <span>Nome</span>
                <span>Progresso</span>
                <span>Template</span>
                <span>Status</span>
                <span>Atualizado</span>
                <span>Remetente</span>
              </div>
              {filteredFlows.map((flow) => {
                const stats = flow.stats || { sent: 0, delivered: 0, failed: 0, total: 0, waiting: 0, status: "idle" as FlowRun["status"] };
                return (
                  <div className="campaign-row-wrap" key={flow.id}>
                    <button className="campaign-row" onClick={() => openFlow(flow)} type="button">
                      <span className="campaign-name">
                        <MessageCircle size={16} />
                        <strong>{flow.name}</strong>
                        <small>{flow.templateName}</small>
                      </span>
                      <span className="campaign-progress">
                        <strong className="success">{stats.delivered.toLocaleString("pt-BR")}</strong>
                        <strong className="danger">{stats.failed.toLocaleString("pt-BR")}</strong>
                      </span>
                      <span>{flow.templateName}</span>
                      <span className={`campaign-status ${stats.status === "done" ? "done" : stats.status === "sending" ? "sending" : "draft"}`}>
                        {stats.status === "done" ? "Concluido" : stats.status === "sending" ? "Rodando" : "Rascunho"}
                      </span>
                      <span>{formatFlowDate(flow.updatedAt)}</span>
                      <span>{flow.senderName}</span>
                    </button>
                    <div className="campaign-expanded-actions flow-row-actions">
                      <button className="button secondary compact" onClick={() => openFlow(flow)} type="button">
                        Editar
                      </button>
                      <button className="button danger ghost compact" onClick={() => deleteFlow(flow.id)} type="button">
                        Excluir
                      </button>
                    </div>
                  </div>
                );
              })}
              {!filteredFlows.length ? (
                <div className="campaign-empty">
                  <MessageCircle size={20} />
                  <strong>Nenhum fluxo encontrado</strong>
                  <span>Crie um fluxo escolhendo remetente e template inicial para abrir o editor.</span>
                </div>
              ) : null}
            </div>
          </section>
        </section>

        {createModalOpen ? (
          <div className="modal-backdrop">
            <div className="broadcast-campaign-modal flow-create-modal">
              <button className="icon-button modal-close" onClick={() => setCreateModalOpen(false)} type="button">
                <X size={16} />
              </button>
              <h2>Criar fluxo</h2>
              <label>
                Nome do fluxo
                <input
                  placeholder="Ex: Recuperacao boleto 24h"
                  value={createForm.name}
                  onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })}
                />
              </label>
              <label>
                Remetente
                <select
                  value={createForm.senderId}
                  onChange={(event) => {
                    const senderId = event.target.value;
                    const sender = senders.find((item) => item.id === senderId);
                    const firstTemplate = templates.find((template) => templateMatchesSender(template, sender));
                    setCreateForm({ ...createForm, senderId, templateId: firstTemplate?.id || "" });
                  }}
                >
                  <option value="">Selecione o remetente</option>
                  {senders.map((sender) => (
                    <option key={sender.id} value={sender.id}>
                      {senderLabel(sender)} - {senderNumber(sender)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Template inicial
                <select value={createForm.templateId} onChange={(event) => setCreateForm({ ...createForm, templateId: event.target.value })}>
                  <option value="">Selecione o template</option>
                  {createTemplateOptions.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                  {!createTemplateOptions.length ? <option value="" disabled>Nenhum template aprovado nessa BM</option> : null}
                </select>
              </label>
              <div className="flow-create-hint">
                <Check size={16} />
                <span>O fluxo vai nascer com as variaveis e saidas de botao do template selecionado.</span>
              </div>
              <div className="modal-actions">
                <button className="button secondary" onClick={() => setCreateModalOpen(false)} type="button">Cancelar</button>
                <button className="button" onClick={createFlowFromForm} type="button">
                  <Plus size={16} />
                  Criar e editar
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <main className="dc-flow-page">
      <header className="dc-flow-top">
        <button className="dc-back-button" type="button" onClick={() => setFlowView("dashboard")}>
          <ArrowLeft size={17} />
          Voltar
        </button>
        <div className="dc-flow-title">
          <span />
          <small>FLOW EDITOR</small>
          <input
            value={flowName}
            onChange={(event) => {
              markFlowDirty();
              setFlowName(event.target.value);
            }}
          />
        </div>
        <div className="dc-flow-actions">
          <button className="button secondary" disabled={!canOpenBroadcast} type="button" onClick={() => setBroadcastOpen(true)}>
            <Send size={17} />
            Broadcast
          </button>
          <button className="button" type="button" onClick={saveFlow}>
            <Save size={17} />
            {flowDirty ? "Salvar fluxo" : "Salvo"}
          </button>
          <button className="button secondary" type="button" onClick={() => setJsonOpen((current) => !current)}>
            <Code2 size={17} />
            JSON
          </button>
        </div>
      </header>

      <section className="dc-flow-workspace">
        <div className="dc-canvas-wrap">
          <ReactFlowProvider>
            <ReactFlow
              fitView
              edges={edges}
              nodes={renderedNodes}
              nodeTypes={nodeTypes}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              onConnectStart={onConnectStart}
              onEdgesChange={onEdgesChange}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onNodesChange={onNodesChange}
            >
              <Background color="hsl(218 14% 23%)" gap={17} />
              <Controls />
              <MiniMap nodeBorderRadius={7} nodeColor={(node) => nodeInfo[(node.data as FlowNodeData).kind]?.color === "green" ? "#22c55e" : "#38bdf8"} />
            </ReactFlow>
          </ReactFlowProvider>

          <button
            className="dc-add-floating"
            type="button"
            onClick={() => setNodeMenu((current) => (current ? null : { x: 390, y: 210 }))}
          >
            <Plus size={18} />
          </button>

          {nodeMenu ? (
            <div className="dc-add-menu" style={{ left: nodeMenu.x, top: nodeMenu.y }}>
              <div className="dc-add-menu-head">
                <strong>ADICIONAR NO</strong>
                <button className="dc-add-menu-close" type="button" onClick={() => setNodeMenu(null)} aria-label="Fechar menu">
                  <X size={16} />
                </button>
              </div>
              {menuItems.map((item) => {
                const meta = nodeInfo[item.kind];
                const Icon = meta.icon;
                return (
                  <button className={`dc-add-menu-item dc-add-menu-${meta.color}`} key={item.kind} type="button" onClick={() => addNode(item.kind)}>
                    <Icon size={16} />
                    <span>{item.title}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="dc-flow-status">{status}</div>
        </div>

        <aside className="dc-inspector">
          <button className="dc-inspector-close" type="button">
            <X size={17} />
          </button>
          {selectedNode && selectedMeta ? (
            <>
              <div className={`dc-inspector-head dc-inspector-${selectedMeta.color}`}>
                <selectedMeta.icon size={18} />
                <div>
                  <h2>{selectedNode.data.title}</h2>
                  <span>{selectedMeta.label}</span>
                </div>
              </div>

              <label className="field">
                <span>Nome do bloco</span>
                <input className="input" value={selectedNode.data.title} onChange={(event) => updateSelected({ title: event.target.value })} />
              </label>

              {selectedNode.data.kind === "start" ? (
                <div className="grid">
                  <p className="hint">Selecione o template aprovado. As variáveis e as saídas dos botões são criadas automaticamente.</p>
                  <label className="field">
                    <span>Template aprovado</span>
                    <select className="select" value={selectedNode.data.templateId || ""} onChange={(event) => selectTemplate(event.target.value)}>
                      <option value="">Selecione um template</option>
                      {currentSenderTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                      {!currentSenderTemplates.length ? <option value="" disabled>Nenhum template aprovado nessa BM</option> : null}
                    </select>
                  </label>
                  {(selectedNode.data.variables || []).length ? (
                    <div className="dc-variable-list">
                      {(selectedNode.data.variables || []).map((variable) => (
                        <label className="field" key={variable}>
                          <span>{`Variável {{${variable}}}`}</span>
                          <input
                            className="input"
                            value={selectedNode.data.variableValues?.[variable] || ""}
                            onChange={(event) => updateTemplateVariable(variable, event.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="hint">Esse template não tem variáveis.</p>
                  )}
                  <div className="dc-quick-replies">
                    {(selectedNode.data.buttons || []).map((button, index) => (
                      <span key={button}>
                        {button}
                        <small>{`Saida button-${index}`}</small>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {selectedNode.data.kind === "text" ? (
                <label className="field">
                  <span>Mensagem</span>
                  <textarea className="textarea" placeholder="Digite a mensagem..." value={selectedNode.data.body || ""} onChange={(event) => updateSelected({ body: event.target.value, subtitle: event.target.value || "Mensagem vazia..." })} />
                </label>
              ) : null}

              {selectedNode.data.kind === "audio" ? (
                <div className="grid">
                  <label className="field">
                    <span>URL da midia</span>
                    <input
                      className="input"
                      placeholder="Cole uma URL publica ou selecione da biblioteca"
                      value={selectedNode.data.imageUrl || ""}
                      onChange={(event) => updateSelected({ imageUrl: event.target.value, mediaType: "audio", subtitle: event.target.value ? "URL personalizada" : "AUDIO" })}
                    />
                  </label>
                  <div className="dc-media-actions">
                    <label className="button secondary dc-file-button">
                      <Upload size={15} />
                      {mediaUploadingNodeId === selectedNode.id ? "Enviando..." : "Enviar audio"}
                      <input
                        type="file"
                        accept={mediaAcceptForKind("audio")}
                        disabled={mediaUploadingNodeId === selectedNode.id}
                        onChange={(event) => {
                          void handleNodeMediaUpload(event.target.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button className="button secondary" type="button" onClick={() => void refreshMediaLibrary()}>
                      <RefreshCcw size={15} />
                      Atualizar
                    </button>
                    {selectedNode.data.imageUrl ? (
                      <button className="button secondary danger" type="button" onClick={clearSelectedMedia}>
                        <Trash2 size={15} />
                        Remover
                      </button>
                    ) : null}
                  </div>
                  <div className="dc-media-library-panel">
                    <div className="dc-media-library-head">
                      <strong>Biblioteca de midias</strong>
                      <span>{selectedMediaItems.length} arquivo(s)</span>
                    </div>
                    <div className="dc-recent-media">
                      {selectedMediaItems.slice(0, 8).map((item) => {
                        const url = mediaItemUrl(item);
                        const name = mediaItemName(item);
                        const selected = url && url === selectedNode.data.imageUrl;
                        return (
                          <button className={`dc-media-option ${selected ? "selected" : ""}`} key={`${item.id}-${url}`} type="button" onClick={() => selectNodeMedia(item)}>
                            <span className="dc-media-thumb-icon">
                              <Mic2 size={17} />
                            </span>
                            <span>{name}</span>
                            {selected ? <Check size={15} /> : null}
                          </button>
                        );
                      })}
                      {!selectedMediaItems.length ? <p className="hint">Nenhum audio na biblioteca.</p> : null}
                    </div>
                  </div>
                  <label className="dc-toggle-row">
                    <input type="checkbox" checked={Boolean(selectedNode.data.voice)} onChange={(event) => updateSelected({ voice: event.target.checked })} />
                    <span>Mensagem de voz (PTT)</span>
                  </label>
                </div>
              ) : null}

              {selectedNode.data.kind === "video" ? (
                <div className="grid">
                  <label className="field">
                    <span>URL da midia</span>
                    <input
                      className="input"
                      placeholder="Cole uma URL publica ou selecione da biblioteca"
                      value={selectedNode.data.imageUrl || ""}
                      onChange={(event) => updateSelected({ imageUrl: event.target.value, mediaType: "video", subtitle: event.target.value ? "URL personalizada" : "VIDEO" })}
                    />
                  </label>
                  <div className="dc-media-actions">
                    <label className="button secondary dc-file-button">
                      <Upload size={15} />
                      {mediaUploadingNodeId === selectedNode.id ? "Enviando..." : "Enviar video"}
                      <input
                        type="file"
                        accept={mediaAcceptForKind("video")}
                        disabled={mediaUploadingNodeId === selectedNode.id}
                        onChange={(event) => {
                          void handleNodeMediaUpload(event.target.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button className="button secondary" type="button" onClick={() => void refreshMediaLibrary()}>
                      <RefreshCcw size={15} />
                      Atualizar
                    </button>
                    {selectedNode.data.imageUrl ? (
                      <button className="button secondary danger" type="button" onClick={clearSelectedMedia}>
                        <Trash2 size={15} />
                        Remover
                      </button>
                    ) : null}
                  </div>
                  <div className="dc-media-library-panel">
                    <div className="dc-media-library-head">
                      <strong>Biblioteca de midias</strong>
                      <span>{selectedMediaItems.length} arquivo(s)</span>
                    </div>
                    <div className="dc-recent-media">
                      {selectedMediaItems.slice(0, 8).map((item) => {
                        const url = mediaItemUrl(item);
                        const name = mediaItemName(item);
                        const selected = url && url === selectedNode.data.imageUrl;
                        return (
                          <button className={`dc-media-option ${selected ? "selected" : ""}`} key={`${item.id}-${url}`} type="button" onClick={() => selectNodeMedia(item)}>
                            <video src={url} muted playsInline />
                            <span>{name}</span>
                            {selected ? <Check size={15} /> : null}
                          </button>
                        );
                      })}
                      {!selectedMediaItems.length ? <p className="hint">Nenhum video na biblioteca.</p> : null}
                    </div>
                  </div>
                  <label className="field">
                    <span>Legenda opcional</span>
                    <textarea className="textarea" placeholder="Legenda do video..." value={selectedNode.data.caption || ""} onChange={(event) => updateSelected({ caption: event.target.value })} />
                  </label>
                </div>
              ) : null}

              {selectedNode.data.kind === "image" ? (
                <div className="grid">
                  <label className="field">
                    <span>URL da midia</span>
                    <input
                      className="input"
                      placeholder="Cole uma URL publica ou selecione da biblioteca"
                      value={selectedNode.data.imageUrl || ""}
                      onChange={(event) => updateSelected({ imageUrl: event.target.value, mediaType: "image", subtitle: event.target.value ? "URL personalizada" : "IMAGE" })}
                    />
                  </label>
                  <div className="dc-media-actions">
                    <label className="button secondary dc-file-button">
                      <Upload size={15} />
                      {mediaUploadingNodeId === selectedNode.id ? "Enviando..." : "Enviar imagem"}
                      <input
                        type="file"
                        accept={mediaAcceptForKind("image")}
                        disabled={mediaUploadingNodeId === selectedNode.id}
                        onChange={(event) => {
                          void handleNodeMediaUpload(event.target.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button className="button secondary" type="button" onClick={() => void refreshMediaLibrary()}>
                      <RefreshCcw size={15} />
                      Atualizar
                    </button>
                    {selectedNode.data.imageUrl ? (
                      <button className="button secondary danger" type="button" onClick={clearSelectedMedia}>
                        <Trash2 size={15} />
                        Remover
                      </button>
                    ) : null}
                  </div>
                  <div className="dc-media-library-panel">
                    <div className="dc-media-library-head">
                      <strong>Biblioteca de midias</strong>
                      <span>{selectedMediaItems.length} arquivo(s)</span>
                    </div>
                    <div className="dc-recent-media">
                      {selectedMediaItems.slice(0, 8).map((item) => {
                        const url = mediaItemUrl(item);
                        const name = mediaItemName(item);
                        const selected = url && url === selectedNode.data.imageUrl;
                        return (
                          <button className={`dc-media-option ${selected ? "selected" : ""}`} key={`${item.id}-${url}`} type="button" onClick={() => selectNodeMedia(item)}>
                            <img alt="" src={url} />
                            <span>{name}</span>
                            {selected ? <Check size={15} /> : null}
                          </button>
                        );
                      })}
                      {!selectedMediaItems.length ? <p className="hint">Nenhuma imagem na biblioteca.</p> : null}
                    </div>
                  </div>
                  <label className="field">
                    <span>Legenda opcional</span>
                    <textarea className="textarea" placeholder="Legenda da imagem..." value={selectedNode.data.caption || ""} onChange={(event) => updateSelected({ caption: event.target.value })} />
                  </label>
                </div>
              ) : null}

              {selectedNode.data.kind === "delay" ? (
                <label className="field">
                  <span>Delay (milissegundos)</span>
                  <input className="input" value={selectedNode.data.delayMs || "1000"} onChange={(event) => updateSelected({ delayMs: event.target.value, subtitle: `${event.target.value}ms` })} />
                  <p className="hint">1.0s até máx. 120s</p>
                </label>
              ) : null}

              {selectedNode.data.kind === "interactive" ? (
                <div className="grid">
                  <label className="field">
                    <span>Tipo de interativo</span>
                    <select className="select">
                      <option>Botões de resposta (reply)</option>
                      <option>Call to action</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Texto do corpo</span>
                    <textarea className="textarea" placeholder="Mensagem principal..." value={selectedNode.data.body || ""} onChange={(event) => updateSelected({ body: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>Rodapé opcional</span>
                    <input className="input" placeholder="Texto do rodape..." value={selectedNode.data.footer || ""} onChange={(event) => updateSelected({ footer: event.target.value })} />
                  </label>
                  <div className="dc-button-editor">
                    <div className="dc-button-editor-head">
                      <strong>Botoes de resposta</strong>
                      <button className="button secondary" type="button" onClick={addSelectedButton} disabled={(selectedNode.data.buttons || []).length >= 3}>
                        <Plus size={14} />
                        Adicionar
                      </button>
                    </div>
                    {(selectedNode.data.buttons || ["CLIQUE AQUI"]).map((button, index) => (
                      <label className="dc-button-editor-row" key={`${index}-${button}`}>
                        <span>{`Botao ${index + 1}`}</span>
                        <input className="input" value={button} onChange={(event) => updateSelectedButton(index, event.target.value)} />
                        <button className="button secondary danger icon-only" type="button" onClick={() => removeSelectedButton(index)} aria-label="Remover botao">
                          <Trash2 size={14} />
                        </button>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {selectedNode.data.kind === "blacklist" ? (
                <div className="dc-info-box">
                  <strong>Registrar na blacklist</strong>
                  <p>Quando o fluxo chegar neste passo, o telefone do contato é enviado à Blacklist. Ele não será aceito novamente ao tratar uma nova lista.</p>
                </div>
              ) : null}

            </>
          ) : null}

          {jsonOpen ? <textarea className="dc-json-box" readOnly value={jsonValue} /> : null}
        </aside>
      </section>

      {broadcastOpen && canOpenBroadcast ? (
        <div className="dc-flow-broadcast-overlay">
          <section className="dc-flow-broadcast dc-flow-broadcast-modal">
            <div className="dc-flow-broadcast-head">
              <div>
                <strong>Disparar fluxo salvo</strong>
                <span>{flowRun.status === "idle" ? "Escolha o remetente e a base para iniciar o template do fluxo." : flowRun.currentStep}</span>
              </div>
              <button className="dc-broadcast-close" type="button" onClick={() => setBroadcastOpen(false)} aria-label="Fechar broadcast">
                <X size={18} />
              </button>
            </div>

            <label className="field">
              <span>Remetente conectado</span>
              <select
                className="select"
                value={flowRun.senderId || selectedRunSender?.id || ""}
                onChange={(event) => updateRun({ ...flowRun, senderId: event.target.value })}
              >
                <option value="">Selecione um remetente</option>
                {senders.map((sender) => (
                  <option key={sender.id} value={sender.id}>
                    {senderLabel(sender)} - {senderNumber(sender)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Base / etiqueta</span>
              <select className="select" value={flowRun.tagId || selectedRunTag?.id || ""} onChange={(event) => updateRun({ ...flowRun, tagId: event.target.value })}>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tagName(tag)} - {tagCount(tag).toLocaleString("pt-BR")} contatos
                  </option>
                ))}
              </select>
            </label>

            <div className="dc-run-progress">
              <div>
                <strong>{runPercent}%</strong>
                <span>{flowRun.status === "idle" ? "aguardando início" : flowRun.status === "done" ? "concluído" : flowRun.status}</span>
              </div>
              <i>
                <b style={{ width: `${runPercent}%` }} />
              </i>
            </div>

            <div className="dc-run-grid">
              <div>
                <span>Aceitos Meta</span>
                <strong>{flowRun.sent.toLocaleString("pt-BR")}</strong>
              </div>
              <div>
                <span>Entregues</span>
                <strong>{flowRun.delivered.toLocaleString("pt-BR")}</strong>
              </div>
              <div>
                <span>Aguardando</span>
                <strong>{flowRun.waiting.toLocaleString("pt-BR")}</strong>
              </div>
              <div>
                <span>Falhas</span>
                <strong>{flowRun.failed.toLocaleString("pt-BR")}</strong>
              </div>
            </div>

            <div className="dc-run-actions">
              <button className="button" disabled={flowRun.status === "sending"} type="button" onClick={startFlowBroadcast}>
                <Play size={16} />
                Disparar fluxo
              </button>
              <button className="button secondary" disabled={flowRun.status === "idle" || flowRun.status === "done"} type="button" onClick={pauseFlowBroadcast}>
                {flowRun.status === "paused" ? "Retomar" : "Pausar"}
              </button>
              <button className="button secondary" type="button" onClick={clearFlowBroadcast}>
                Limpar
              </button>
            </div>

            {flowRun.events.length ? (
              <div className="dc-run-events">
                {flowRun.events.map((event) => (
                  <span key={event}>{event}</span>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
