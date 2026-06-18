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
  Code2,
  FileText,
  Image,
  Mic2,
  Play,
  Plus,
  Save,
  Send,
  Timer,
  Video,
  X,
  Zap,
} from "lucide-react";
import { broadcasts, contacts, infobipApis, savedTemplates } from "../lib/services";
import { config } from "../lib/config";
import { unwrapList } from "../lib/api";
import type { ContactItem, ContactTag, InfobipApi, SavedTemplate } from "../lib/types";

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
  caption?: string;
  delayMs?: string;
  buttons?: string[];
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

const LOCAL_FLOW_EDITOR_KEY = "scaleapi.flowEditor";
const LOCAL_FLOW_RUN_KEY = "scaleapi.flowRun";
const LOCAL_BM_SETTINGS_KEY = "scaleapi.bmSettings";
const LOCAL_BM_ACCOUNTS_KEY = "scaleapi.bmAccounts";
const LOCAL_CONNECTED_SENDERS_KEY = "movy.connectedSenders";

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
  return {
    kind: "start",
    title: "Template",
    subtitle: template.name,
    templateId: template.id,
    imageUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=420&q=80",
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
    data: templateToStartData(fallbackTemplates[0]),
  },
  {
    id: "button-0-text",
    type: "flowCard",
    position: { x: 435, y: 120 },
    data: { kind: "text", title: "Resposta Sim", subtitle: "Caminho do botão Sim", body: "Perfeito, vou continuar seu atendimento." },
  },
  {
    id: "button-1-blacklist",
    type: "flowCard",
    position: { x: 435, y: 320 },
    data: { kind: "blacklist", title: "Resposta Não", subtitle: "blacklist" },
  },
  {
    id: "delay-1",
    type: "flowCard",
    position: { x: 720, y: 120 },
    data: { kind: "delay", title: "Delay", subtitle: "1000ms", delayMs: "1000" },
  },
  {
    id: "interactive-1",
    type: "flowCard",
    position: { x: 1010, y: 120 },
    data: {
      kind: "interactive",
      title: "Interativo",
      subtitle: "Texto do corpo...",
      body: "Mensagem principal...",
      buttons: ["CLIQUE AQUI"],
    },
  },
];

const initialEdges: Edge[] = [
  { id: "e-start-sim", source: "start", sourceHandle: "button-0", target: "button-0-text", animated: true, label: "Sim" },
  { id: "e-start-nao", source: "start", sourceHandle: "button-1", target: "button-1-blacklist", animated: true, label: "Não" },
  { id: "e-text-delay", source: "button-0-text", target: "delay-1", animated: true },
  { id: "e-delay-interactive", source: "delay-1", target: "interactive-1", animated: true },
];

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

function senderLabel(sender: InfobipApi) {
  return String(sender.name || sender.label || sender.sender_number || sender.senderNumber || sender.id);
}

function senderNumber(sender: InfobipApi) {
  return String(sender.phoneNumber || sender.sender_number || sender.senderNumber || sender.base_url || "WhatsApp Cloud API");
}

function senderBusinessLabel(sender: InfobipApi) {
  return String(sender.businessName || sender.label || sender.base_url || "");
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
        <div className="dc-whatsapp-card">
          {data.imageUrl ? <img alt="" src={data.imageUrl} /> : null}
          <div className="dc-whatsapp-body">
            {(data.body || "").split("\n").filter(Boolean).map((line) => (
              <p key={line}>{line}</p>
            ))}
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
        <div className="dc-media-slot">Adicionar {data.kind === "audio" ? "áudio" : data.kind === "video" ? "vídeo" : "imagem"}</div>
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
  const [templates, setTemplates] = useState<SavedTemplate[]>(fallbackTemplates);
  const [senders, setSenders] = useState<InfobipApi[]>([]);
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
    savedTemplates
      .normalizedList()
      .then((items) => {
        if (items.length) setTemplates(items);
      })
      .catch(() => setTemplates(fallbackTemplates));
  }, []);

  useEffect(() => {
    infobipApis
      .normalizedList()
      .then((items) => setSenders(dedupeSenders([...readBmSenders(), ...items])))
      .catch(() => setSenders(readBmSenders()));
  }, []);

  useEffect(() => {
    setTags(readLocalContactTags());
  }, []);

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
          return next;
        });
      } catch {
        // Status local pode nao existir antes do webhook receber evento.
      }
    }, 3500);
    return () => window.clearInterval(timer);
  }, [flowRun.messageIds, flowRun.status]);


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
    const template = templates.find((item) => item.id === templateId) || fallbackTemplates[0];
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
    rebuildButtonBranches(nextData.buttons || []);
    setStatus(`Template "${template.name}" carregado. ${nextData.buttons?.length || 0} saída(s) criada(s).`);
  }

  function updateTemplateVariable(variable: string, value: string) {
    markFlowDirty();
    const startNode = nodes.find((node) => node.id === "start");
    const template = templates.find((item) => item.id === startNode?.data.templateId) || fallbackTemplates[0];
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
    const payload = { name: flowName, nodes, edges, selectedNodeId, updatedAt };
    localStorage.setItem(LOCAL_FLOW_EDITOR_KEY, JSON.stringify(payload));
    setSavedFlowAt(updatedAt);
    setFlowDirty(false);
    setStatus("Fluxo salvo localmente.");
  }

  function updateRun(nextRun: FlowRun) {
    setFlowRun(nextRun);
    localStorage.setItem(LOCAL_FLOW_RUN_KEY, JSON.stringify(nextRun));
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

  return (
    <main className="dc-flow-page">
      <header className="dc-flow-top">
        <button className="dc-back-button" type="button">
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
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
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
                    <span>Arquivo de áudio</span>
                    <button className="button secondary" type="button">Enviar áudio (máx. 16MB)</button>
                  </label>
                  <label className="dc-toggle-row">
                    <input type="checkbox" />
                    <span>Mensagem de voz (PTT)</span>
                  </label>
                </div>
              ) : null}

              {selectedNode.data.kind === "video" ? (
                <div className="grid">
                  <label className="field">
                    <span>Arquivo de vídeo</span>
                    <button className="button secondary" type="button">Enviar vídeo (.mp4, máx. 16MB)</button>
                  </label>
                  <label className="field">
                    <span>Legenda opcional</span>
                    <textarea className="textarea" placeholder="Legenda do vídeo..." value={selectedNode.data.caption || ""} onChange={(event) => updateSelected({ caption: event.target.value })} />
                  </label>
                </div>
              ) : null}

              {selectedNode.data.kind === "image" ? (
                <div className="grid">
                  <label className="field">
                    <span>Arquivo de imagem</span>
                    <button className="button secondary" type="button">Enviar imagem (máx. 16MB)</button>
                  </label>
                  <div className="dc-recent-media">
                    {[1, 2, 3].map((item) => (
                      <div key={item}>
                        <img alt="" src={`https://picsum.photos/seed/movy-${item}/70/70`} />
                        <span>WhatsApp Image 2026-0...</span>
                      </div>
                    ))}
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
                    <input className="input" placeholder="Texto do rodapé..." />
                  </label>
                  <div className="dc-quick-replies">
                    {(selectedNode.data.buttons || ["CLIQUE AQUI"]).map((button) => (
                      <span key={button}>{button}</span>
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
