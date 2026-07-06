import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Ban, Check, CheckCircle2, Clipboard, Clock3, Cloud, Download, FileText, Filter, Loader2, Play, Radio, RefreshCcw, Search, Settings, ShieldCheck, Sparkles, Trash2, Upload, XCircle } from "lucide-react";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { config } from "../lib/config";
import { contacts } from "../lib/services";

const LOCAL_CONTACTS_KEY = "scaleapi.localContacts";
const CHECKNUMBER_API_BASE = `${config.localBackendUrl.replace(/\/$/, "")}/checknumber`;
const TREAT_LIST_CHECK_SESSION_KEY = "movy.treatListCheckSession";
const TREAT_LIST_CHECK_HISTORY_KEY = "movy.treatListCheckHistory";
const TREAT_LIST_CHECK_HISTORY_LIMIT = 8;

type ListRow = Record<string, string | number | boolean | null>;
type LocalContact = {
  id: string;
  name?: string;
  phone: string;
  created_at: string;
};
type LocalContactsStore = Record<string, { tag: { id: string; name: string; contacts_count: number }; contacts: LocalContact[] }>;
type ProcessStats = {
  totalRead: number;
  processed: number;
  duplicates: number;
  ignored: number;
  invalidPhones: number;
};
type RetryStats = {
  totalFound: number;
  generated: number;
  duplicates: number;
  invalidPhones: number;
  labels: number;
};
type RetrySourceTab = "system" | "manual";
type SystemRetryCandidate = {
  id: string;
  phone: string;
  campaignName: string;
  bm: string;
  sender: string;
  templateName: string;
  error: string;
  status: string;
  createdAt: string;
  source: string;
};
type SystemRetryOptions = {
  bms: string[];
  senders: string[];
  users: string[];
};
type CheckStatus = "idle" | "creating" | "polling" | "downloading" | "done" | "error";
type TreatListTab = "process" | "history";
type TreatProcessMode = "checked" | "processed";
type CheckStats = {
  submitted: number;
  activated: number;
  inactive: number;
  taskId: string;
  remoteStatus: string;
  total?: number;
  success?: number;
  failure?: number;
};
type CheckNumberTask = {
  task_id?: string;
  id?: string;
  status?: string;
  total?: number;
  success?: number;
  failure?: number;
  result_url?: string;
  resultUrl?: string;
  url?: string;
};
type TreatListCheckSession = {
  version: 1;
  savedAt: string;
  taskId: string;
  sourceFileNames?: string[];
  rowsToCheck: ListRow[];
  processStats: ProcessStats | null;
  checkStats: CheckStats;
  checkStatus: CheckStatus;
  activatedRows?: ListRow[];
  status: string;
};

const phoneColumnHints = ["telefone", "phone", "whatsapp", "celular", "numero", "número", "contato"];
const nameColumnHints = ["nome", "name", "cliente", "lead", "nome completo", "full name", "fullname", "first name"];
const activeWords = ["yes", "sim", "true", "1", "active", "ativo", "ativado", "activated", "whatsapp"];
const validBrazilDdds = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeCell(value: unknown) {
  return String(value ?? "").trim();
}

function rawPhoneDigits(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value).toLocaleString("fullwide", { useGrouping: false }).replace(/\D/g, "");
  }

  const text = normalizeCell(value);
  if (/^\d+(?:[.,]\d+)?e\+?\d+$/i.test(text)) {
    const numeric = Number(text.replace(",", "."));
    if (Number.isFinite(numeric)) {
      return Math.trunc(numeric).toLocaleString("fullwide", { useGrouping: false }).replace(/\D/g, "");
    }
  }

  return text.replace(/\D/g, "");
}

function stripBrazilLongDistancePrefix(digits: string) {
  if (/^0\d{2}\d{10,11}$/.test(digits)) return digits.slice(3);
  if (/^0\d{10,11}$/.test(digits)) return digits.slice(1);
  return digits;
}

function normalizeBrazilPhoneCandidate(digits: string) {
  if (!digits) return "";

  let value = digits.replace(/^00+/, "");
  if (value.startsWith("55")) value = value.slice(2);
  value = stripBrazilLongDistancePrefix(value);

  if (value.length !== 10 && value.length !== 11) return "";

  const ddd = value.slice(0, 2);
  if (!validBrazilDdds.has(ddd)) return "";

  const localNumber = value.slice(2);
  if (/^(\d)\1+$/.test(localNumber)) return "";

  if (localNumber.length === 8) return `55${ddd}9${localNumber}`;
  if (localNumber.length === 9 && localNumber.startsWith("9")) return `55${ddd}${localNumber}`;

  return "";
}

function normalizeBrazilPhone(value: unknown) {
  const digits = rawPhoneDigits(value);
  if (!digits) return "";

  const candidates = new Set<string>([
    digits,
    digits.replace(/^0+/, ""),
    stripBrazilLongDistancePrefix(digits),
  ]);

  if (digits.startsWith("00")) candidates.add(digits.replace(/^00+/, ""));
  if (digits.startsWith("55")) candidates.add(digits.slice(2));
  if (digits.startsWith("0055")) candidates.add(digits.slice(4));

  for (const size of [13, 12, 11, 10]) {
    if (digits.length > size) candidates.add(digits.slice(-size));
  }

  for (const candidate of candidates) {
    const normalized = normalizeBrazilPhoneCandidate(candidate);
    if (normalized) return normalized;
  }

  return "";
}

function isValidBrazilPhone(phone: string) {
  if (!/^55\d{11}$/.test(phone)) return false;

  const ddd = phone.slice(2, 4);
  const localNumber = phone.slice(4);
  if (!validBrazilDdds.has(ddd)) return false;
  if (/^(\d)\1+$/.test(localNumber)) return false;
  if (!localNumber.startsWith("9")) return false;

  return true;
}

function getColumnByHints(row: ListRow | undefined, hints: string[]) {
  if (!row) return undefined;
  return Object.keys(row).find((key) => {
    const normalized = normalizeHeader(key);
    return hints.some((hint) => normalized.includes(normalizeHeader(hint)));
  });
}

function getPhoneKey(row: ListRow) {
  const phoneColumn = getColumnByHints(row, phoneColumnHints);
  const values = phoneColumn ? [row[phoneColumn], ...Object.values(row)] : Object.values(row);

  for (const value of values) {
    if (!/\d{8,}/.test(rawPhoneDigits(value))) continue;
    const phone = normalizeBrazilPhone(value);
    if (phone) return phone;
  }

  return "";
}

function isPhoneColumn(key: string) {
  const normalized = normalizeHeader(key);
  return phoneColumnHints.some((hint) => normalized.includes(normalizeHeader(hint)));
}

function toE164(phone: string) {
  const normalized = normalizeBrazilPhone(phone);
  return normalized ? `+${normalized}` : "";
}

function findPhoneColumnInRows(rows: ListRow[]) {
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return keys.find((key) => isPhoneColumn(key));
}

function findFirstPhoneValue(row: ListRow) {
  return Object.values(row).find((value) => /\d{8,}/.test(rawPhoneDigits(value)) && normalizeBrazilPhone(value));
}

function extractTask(payload: unknown): CheckNumberTask | undefined {
  const record = payload as { data?: unknown; tasks?: unknown; task?: unknown };
  const candidates = [record.task, record.data, record.tasks, payload];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate[0] as CheckNumberTask | undefined;
    if (candidate && typeof candidate === "object") return candidate as CheckNumberTask;
  }
  return undefined;
}

async function checkNumberRequest(path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${CHECKNUMBER_API_BASE}${path}`, init);
  } catch {
    throw new Error("Servidor local da CheckNumber offline. Reinicie o projeto para ativar a validacao.");
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const record = data as { message?: string; error?: string };
    throw new Error(record.message || record.error || `CheckNumber retornou HTTP ${response.status}`);
  }
  return data;
}

async function createWhatsappTask(phones: string[]) {
  const brazilPhones = Array.from(new Set(phones.map(normalizeBrazilPhone).filter(isValidBrazilPhone)));
  const content = brazilPhones.join("\n");
  if (!content) throw new Error("Nenhum telefone brasileiro valido (+55) para enviar a CheckNumber.");

  const file = new File([content], "movy-whatsapp-check.txt", { type: "text/plain" });
  const form = new FormData();
  form.append("task_type", "ws");
  form.append("file", file);
  const data = await checkNumberRequest("/tasks", { body: form, method: "POST" });
  const task = extractTask(data);
  const taskId = task?.task_id || task?.id;
  if (!taskId) throw new Error("A CheckNumber nao retornou o ID da tarefa.");
  return taskId;
}

async function fetchTask(taskId: string) {
  const form = new FormData();
  form.append("task_id", taskId);
  const data = await checkNumberRequest("/gettasks", { body: form, method: "POST" });
  const task = extractTask(data);
  if (!task) throw new Error("A CheckNumber nao retornou dados da tarefa.");
  return task;
}

function parseDelimitedText(text: string): ListRow[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = lines[0].includes(";") ? ";" : lines[0].includes(",") ? "," : "";
  if (!delimiter) {
    return lines.map(normalizeBrazilPhone).filter(Boolean).map((phone) => ({ telefone: phone }));
  }

  const headers = lines[0].split(delimiter).map((item) => item.trim() || "coluna");
  return lines.slice(1).map((line) => {
    const values = line.split(delimiter);
    return headers.reduce<ListRow>((row, header, index) => {
      row[header] = values[index]?.trim() || "";
      return row;
    }, {});
  });
}

function rowsFromWorkbook(buffer: ArrayBuffer): ListRow[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<ListRow>(sheet, { defval: "", raw: false }).filter((row) => !isEmptyRow(row));
}

function activeRowsFromResultRows(resultRows: ListRow[]) {
  const whatsappColumn = Object.keys(resultRows[0] || {}).find((key) => {
    const normalized = normalizeHeader(key);
    return normalized.includes("whatsapp") || normalized.includes("status") || normalized.includes("active");
  });

  if (!whatsappColumn) return resultRows;

  return resultRows.filter((row) => {
    const value = normalizeHeader(normalizeCell(row[whatsappColumn]));
    return activeWords.some((word) => value === normalizeHeader(word) || value.includes(normalizeHeader(word)));
  });
}

async function extractRowsFromBlob(blob: Blob, filename = "") {
  const buffer = await blob.arrayBuffer();
  const lowerName = filename.toLowerCase();
  const isZip = lowerName.endsWith(".zip") || new Uint8Array(buffer).slice(0, 2).join(",") === "80,75";

  if (isZip) {
    const zip = await JSZip.loadAsync(buffer);
    const files = Object.values(zip.files).filter((entry) => !entry.dir);
    const preferred =
      files.find((entry) => /ativ|active|yes|whatsapp/i.test(entry.name) && /\.(txt|csv|xlsx|xls)$/i.test(entry.name)) ||
      files.find((entry) => /\.(txt|csv|xlsx|xls)$/i.test(entry.name));

    if (!preferred) throw new Error("O ZIP nao trouxe TXT, CSV ou XLSX de resultado.");
    if (/\.(xlsx|xls)$/i.test(preferred.name)) {
      return activeRowsFromResultRows(rowsFromWorkbook(await preferred.async("arraybuffer")));
    }
    return activeRowsFromResultRows(parseDelimitedText(await preferred.async("text")));
  }

  if (/\.(xlsx|xls)$/i.test(lowerName) || blob.type.includes("spreadsheet")) {
    return activeRowsFromResultRows(rowsFromWorkbook(buffer));
  }

  return activeRowsFromResultRows(parseDelimitedText(await blob.text()));
}

function onlyPhoneRows(rows: ListRow[]) {
  const phones = rows
    .map((row) => normalizeBrazilPhone(row[findPhoneColumnInRows([row]) || "telefone"] || findFirstPhoneValue(row)))
    .filter(Boolean);
  return Array.from(new Set(phones)).map((phone) => ({ telefone: phone }));
}

function activatedRowsWithTags(resultRows: ListRow[], processedRows: ListRow[]) {
  const activePhones = new Set(onlyPhoneRows(resultRows).map((row) => normalizeCell(row.telefone)));
  if (!activePhones.size) return [];
  return processedRows.filter((row) => activePhones.has(normalizeCell(row.telefone)));
}

function phonesOnlyForCheckNumber(rows: ListRow[]) {
  return Array.from(new Set(rows.map((row) => normalizeBrazilPhone(row.telefone)).filter(isValidBrazilPhone)));
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function hasName(row: ListRow) {
  const nameColumn = getColumnByHints(row, nameColumnHints);
  if (!nameColumn) return true;
  return normalizeCell(row[nameColumn]).length > 0;
}

function buildProcessingSummary(cleanedCount: number, stats: { duplicates: number; ignored: number; invalidPhones: number; withoutName: number }, filters: { removeDuplicates: boolean; discardInvalidPhones: boolean; discardWithoutName: boolean }) {
  const removals = [
    filters.removeDuplicates ? `${stats.duplicates} duplicados` : "duplicados mantidos",
    filters.discardInvalidPhones ? `${stats.invalidPhones} telefones inválidos` : "telefones inválidos mantidos",
    filters.discardWithoutName ? `${stats.withoutName} sem nome` : "leads sem nome mantidos",
    `${stats.ignored} na ignore`,
  ];

  return `${cleanedCount} contatos processados. ${removals.join(", ")}.`;
}

function isEmptyRow(row: ListRow) {
  return Object.values(row).every((value) => normalizeCell(value).length === 0);
}

async function readRows(file: File) {
  if (/\.(csv|txt)$/i.test(file.name)) {
    return parseDelimitedText(await file.text()).filter((row) => !isEmptyRow(row));
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<ListRow>(sheet, { defval: "" }).filter((row) => !isEmptyRow(row));
}

async function readFileText(file: File) {
  return file.text();
}

function extractPhonesFromText(text: string) {
  const matches = text.match(/\+?\d[\d\s()./-]{7,}\d/g) ?? [];
  const phones = matches.map(normalizeBrazilPhone).filter(Boolean);

  if (phones.length) return phones;

  return text
    .split(/[\s,;|]+/)
    .map(normalizeBrazilPhone)
    .filter(Boolean);
}

function createCsv(rows: ListRow[]) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(worksheet);
  return `\ufeff${csv}`;
}

function createCsvUrl(csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  return URL.createObjectURL(blob);
}

function triggerDownload(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function saveCsvToDisk(csv: string, filename: string) {
  const filePicker = (
    window as Window &
      typeof globalThis & {
        showSaveFilePicker?: (options: {
          suggestedName: string;
          types: Array<{ description: string; accept: Record<string, string[]> }>;
        }) => Promise<{
          createWritable: () => Promise<{
            write: (
              contents:
                | Blob
                | BufferSource
                | string
                | { type: "write"; position: number; data: Blob | BufferSource | string },
            ) => Promise<void>;
            truncate: (size: number) => Promise<void>;
            close: () => Promise<void>;
          }>;
        }>;
      }
  ).showSaveFilePicker;

  if (!filePicker) {
    throw new Error("file-picker-unavailable");
  }

  const handle = await filePicker({
    suggestedName: filename,
    types: [
      {
        description: "CSV",
        accept: { "text/csv": [".csv"] },
      },
    ],
  });
  const writable = await handle.createWritable();
  const bytes = new TextEncoder().encode(csv.replace(/^\ufeff/, ""));
  await writable.write({ type: "write", position: 0, data: bytes });
  await writable.truncate(bytes.byteLength);
  await writable.close();
}

async function saveCsvLocally(csv: string, filename: string) {
  const response = await fetch(`${config.localBackendUrl.replace(/\/$/, "")}/save-csv`, {
    body: JSON.stringify({ csv, filename }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("local-save-failed");
  }

  return (await response.json()) as { ok: boolean; path: string; bytes: number };
}

function readLocalContactsStore(): LocalContactsStore {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_CONTACTS_KEY) || "{}") as LocalContactsStore;
  } catch {
    return {};
  }
}

function writeLocalContactsStore(store: LocalContactsStore) {
  localStorage.setItem(LOCAL_CONTACTS_KEY, JSON.stringify(store));
}

function publishRowsToContacts(rows: ListRow[]) {
  const store = readLocalContactsStore();
  const grouped = new Map<string, Set<string>>();

  rows.forEach((row) => {
    const phone = normalizeCell(row.telefone);
    const tagName = normalizeCell(row.etiqueta) || "Importados";
    if (!phone) return;
    if (!grouped.has(tagName)) grouped.set(tagName, new Set());
    grouped.get(tagName)?.add(phone);
  });

  grouped.forEach((phones, tagName) => {
    const tagId = `local-${tagName}`;
    const contacts = Array.from(phones).map((phone, index) => ({
      id: `${tagId}-${index}-${phone}`,
      phone,
      created_at: new Date().toISOString(),
    }));

    store[tagId] = {
      tag: {
        id: tagId,
        name: tagName,
        contacts_count: contacts.length,
      },
      contacts,
    };
  });

  writeLocalContactsStore(store);

  return {
    tags: grouped.size,
    contacts: Array.from(grouped.values()).reduce((sum, phones) => sum + phones.size, 0),
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

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function textFrom(record: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return fallback;
}

function isFailureStatus(record: Record<string, unknown>) {
  const status = normalizeHeader(textFrom(record, ["status", "deliveryStatus", "messageStatus"]));
  const error = textFrom(record, ["errorMessage", "error", "reason", "failureReason", "lastError"]);
  const failedAt = textFrom(record, ["failedAt", "failureAt"]);
  const errorCode = textFrom(record, ["errorCode", "code"]);
  return Boolean(
    failedAt ||
      error ||
      errorCode ||
      ["failed", "fail", "error", "undelivered", "rejected"].some((word) => status.includes(word)),
  );
}

function candidatePhoneFrom(record: Record<string, unknown>) {
  return normalizeBrazilPhone(
    textFrom(record, ["recipient", "to", "phone", "telefone", "wa_id", "customerPhone", "recipientPhone", "contactPhone"]) ||
      findFirstPhoneValue(record as ListRow),
  );
}

function candidateFromRecord(record: Record<string, unknown>, index: number, source = "Sistema"): SystemRetryCandidate | null {
  const phone = candidatePhoneFrom(record);
  if (!phone) return null;
  const error = textFrom(record, ["errorMessage", "error", "reason", "failureReason", "lastError"], "Falha registrada no envio");
  const status = textFrom(record, ["status", "deliveryStatus", "messageStatus"], error ? "failed" : "pending");
  const campaignName = textFrom(record, ["campaignName", "campaign", "flowName", "name"], source);
  const sender = textFrom(record, ["sender", "senderName", "phoneName"], "Remetente");
  const bm = textFrom(record, ["bm", "businessName", "wabaName"], "BM");
  const templateName = textFrom(record, ["templateName", "template", "templateId"], "-");
  const createdAt = textFrom(record, ["failedAt", "updatedAt", "createdAt", "sentAt"], "");
  const id = textFrom(record, ["id", "messageId", "wamid"], `${source}-${phone}-${index}-${createdAt}`);

  return {
    id,
    phone,
    campaignName,
    bm,
    sender,
    templateName,
    error,
    status,
    createdAt,
    source,
  };
}

function dedupeCandidates(candidates: SystemRetryCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.phone}|${candidate.campaignName}|${candidate.error}|${candidate.createdAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseSystemRetryCandidates(payload: unknown) {
  const root = asRecord(payload);
  const candidates: SystemRetryCandidate[] = [];
  const groups = Array.isArray(root.data) ? root.data : [];

  groups.forEach((group, groupIndex) => {
    const record = asRecord(group);
    const messages = Array.isArray(record.messages) ? record.messages : [];
    messages.forEach((message, index) => {
      const messageRecord = asRecord(message);
      if (!isFailureStatus(messageRecord)) return;
      const candidate = candidateFromRecord(
        { ...record, ...messageRecord, campaignName: textFrom(messageRecord, ["campaignName"], textFrom(record, ["campaignName"], "Campanha sem nome")) },
        groupIndex * 1000 + index,
        textFrom(messageRecord, ["mode", "channel"], "Broadcast"),
      );
      if (candidate) candidates.push(candidate);
    });
  });

  const events = Array.isArray(root.events) ? root.events : [];
  events.forEach((event, index) => {
    const record = asRecord(event);
    if (!isFailureStatus(record)) return;
    const candidate = candidateFromRecord(record, index, "Webhook");
    if (candidate) candidates.push(candidate);
  });

  const reports = Array.isArray(root.reports) ? root.reports : [];
  reports.forEach((report, index) => {
    const record = asRecord(report);
    const failed = Number(textFrom(record, ["failed", "failures"], "0"));
    const explicitPhones =
      (Array.isArray(record.failedPhones) && record.failedPhones) ||
      (Array.isArray(record.failurePhones) && record.failurePhones) ||
      (Array.isArray(record.errorPhones) && record.errorPhones) ||
      [];
    if (failed <= 0 && explicitPhones.length === 0) return;
    explicitPhones.forEach((phone, phoneIndex) => {
      const candidate = candidateFromRecord(
        { ...record, recipient: phone, errorMessage: textFrom(record, ["errorMessage", "error"], "Falha registrada no relatorio") },
        index * 1000 + phoneIndex,
        "Relatorio",
      );
      if (candidate) candidates.push(candidate);
    });
  });

  return dedupeCandidates(candidates);
}

async function fetchRetryAnalytics(filters: Record<string, string>) {
  const url = new URL(`${movyBackendUrl()}/analytics/transmissions`);
  Object.entries(filters).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  const response = await fetch(url.toString());
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Analytics retornou HTTP ${response.status}`);
  }
  return payload as Record<string, unknown>;
}

async function publishRowsToContactsApi(rows: ListRow[], filename: string) {
  const csv = createCsv(rows);
  const file = new File([csv], filename, { type: "text/csv;charset=utf-8" });
  await contacts.importCsv(file);

  return {
    tags: new Set(rows.map((row) => normalizeCell(row.etiqueta) || "Importados")).size,
    contacts: rows.length,
  };
}

function readStoredCheckHistory() {
  try {
    const raw = localStorage.getItem(TREAT_LIST_CHECK_HISTORY_KEY);
    const history = raw ? (JSON.parse(raw) as TreatListCheckSession[]) : [];
    return history
      .filter((item) => item.version === 1 && item.taskId && item.rowsToCheck?.length)
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
      .slice(0, TREAT_LIST_CHECK_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Agora";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHistoryFileNames(names: string[] | undefined) {
  const cleanNames = (names ?? []).map((name) => name.trim()).filter(Boolean);
  if (!cleanNames.length) return "";
  if (cleanNames.length === 1) return cleanNames[0];
  return `${cleanNames[0]} + ${cleanNames.length - 1} arquivo(s)`;
}

function writeStoredCheckHistory(history: TreatListCheckSession[]) {
  localStorage.setItem(TREAT_LIST_CHECK_HISTORY_KEY, JSON.stringify(history.slice(0, TREAT_LIST_CHECK_HISTORY_LIMIT)));
}

function upsertStoredCheckHistory(session: TreatListCheckSession) {
  const nextHistory = [
    session,
    ...readStoredCheckHistory().filter((item) => item.taskId !== session.taskId),
  ].slice(0, TREAT_LIST_CHECK_HISTORY_LIMIT);
  writeStoredCheckHistory(nextHistory);
  return nextHistory;
}

function CheckOption({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="check-row">
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <span className="custom-checkbox">{checked ? <Check size={13} /> : null}</span>
      <span>{label}</span>
    </label>
  );
}

function TreatListPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [sourceRows, setSourceRows] = useState<ListRow[]>([]);
  const [ignoreFiles, setIgnoreFiles] = useState<File[]>([]);
  const [labelCount, setLabelCount] = useState(1);
  const [prefix, setPrefix] = useState("");
  const removeDuplicates = true;
  const discardWithoutName = true;
  const discardInvalidPhones = true;
  const [status, setStatus] = useState("");
  const [isReadingFiles, setIsReadingFiles] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [download, setDownload] = useState<{ csv: string; url: string; filename: string } | null>(null);
  const [processStats, setProcessStats] = useState<ProcessStats | null>(null);
  const [processedRows, setProcessedRows] = useState<ListRow[]>([]);
  const [activatedDownload, setActivatedDownload] = useState<{ csv: string; url: string; filename: string } | null>(null);
  const [activatedRows, setActivatedRows] = useState<ListRow[]>([]);
  const [taggedActivatedRows, setTaggedActivatedRows] = useState<ListRow[]>([]);
  const [checkStatus, setCheckStatus] = useState<CheckStatus>("idle");
  const [checkStats, setCheckStats] = useState<CheckStats>({ submitted: 0, activated: 0, inactive: 0, taskId: "", remoteStatus: "" });
  const [checkHistory, setCheckHistory] = useState<TreatListCheckSession[]>(() => readStoredCheckHistory());
  const [activeTab, setActiveTab] = useState<TreatListTab>("process");
  const [processMode, setProcessMode] = useState<TreatProcessMode>("checked");
  const checkRunRef = useRef(0);
  const sourceFileNamesRef = useRef<string[]>([]);

  const checkInProgress = checkStatus === "creating" || checkStatus === "polling" || checkStatus === "downloading";
  const canProcess = sourceRows.length > 0 && !isReadingFiles && !isProcessing && !checkInProgress;
  const shouldShowCheckPanel = processedRows.length > 0 && processMode === "checked";
  const readyRowsLabel = processMode === "checked" ? "ativado(s)" : "contato(s) tratado(s)";
  const finalRowsPerLabel = activatedRows.length ? Math.ceil(activatedRows.length / Math.max(labelCount, 1)) : 0;
  const checkProgress =
    checkStatus === "done"
      ? 100
      : checkStatus === "downloading"
        ? 92
        : checkStatus === "polling"
          ? Math.max(25, Math.min(88, Math.round((((checkStats.success || 0) + (checkStats.failure || 0)) / Math.max(checkStats.total || checkStats.submitted || 1, 1)) * 100)))
          : checkStatus === "creating"
            ? 14
            : 0;
  const checkStatusLabel =
    checkStatus === "idle"
      ? "Aguardando validacao"
      : checkStatus === "creating"
        ? "Criando lote"
        : checkStatus === "polling"
          ? "Consultando API"
          : checkStatus === "downloading"
            ? "Extraindo ativados"
            : checkStatus === "done"
              ? "Validacao concluida"
              : "Falha na validacao";

  function saveCheckSession(session: Omit<TreatListCheckSession, "version" | "savedAt">) {
    const nextSession: TreatListCheckSession = {
      ...session,
      sourceFileNames: session.sourceFileNames?.length ? session.sourceFileNames : sourceFileNamesRef.current,
      version: 1,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(TREAT_LIST_CHECK_SESSION_KEY, JSON.stringify(nextSession));
    setCheckHistory(upsertStoredCheckHistory(nextSession));
  }

  function clearCheckSession() {
    localStorage.removeItem(TREAT_LIST_CHECK_SESSION_KEY);
  }

  function readCheckSession() {
    try {
      const raw = localStorage.getItem(TREAT_LIST_CHECK_SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw) as TreatListCheckSession;
      return session.version === 1 && session.taskId && session.rowsToCheck?.length ? session : null;
    } catch {
      return null;
    }
  }

  function restoreCheckSession(session: TreatListCheckSession) {
    checkRunRef.current += 1;
    if (download) {
      URL.revokeObjectURL(download.url);
      setDownload(null);
    }
    if (activatedDownload) {
      URL.revokeObjectURL(activatedDownload.url);
      setActivatedDownload(null);
    }
    localStorage.setItem(TREAT_LIST_CHECK_SESSION_KEY, JSON.stringify(session));
    sourceFileNamesRef.current = session.sourceFileNames ?? [];
    setFiles([]);
    setSourceRows([]);
    setActiveTab("process");
    setProcessedRows(session.rowsToCheck);
    setProcessStats(session.processStats);
    setCheckStats(session.checkStats);
    setStatus(session.status || `Tarefa ${session.taskId} recuperada.`);
    setTaggedActivatedRows([]);

    if (session.checkStatus === "done" && session.activatedRows?.length) {
      setActivatedRows(session.activatedRows);
      setCheckStatus("done");
      return;
    }

    setActivatedRows(session.activatedRows ?? []);
    if (session.checkStatus === "error") {
      setCheckStatus("error");
      return;
    }

    const runId = checkRunRef.current + 1;
    checkRunRef.current = runId;
    setCheckStatus("polling");
    setStatus(`Retomando tarefa ${session.taskId}. Aguardando resultado...`);
    void continueWhatsappCheck(session.taskId, session.rowsToCheck, session.checkStats, runId, session.processStats);
  }

  function removeCheckHistoryItem(taskId: string) {
    const nextHistory = checkHistory.filter((item) => item.taskId !== taskId);
    writeStoredCheckHistory(nextHistory);
    setCheckHistory(nextHistory);
    if (checkStats.taskId === taskId) {
      clearTreatResults();
    }
  }

  function clearCheckHistory() {
    localStorage.removeItem(TREAT_LIST_CHECK_HISTORY_KEY);
    setCheckHistory([]);
  }

  useEffect(() => {
    const session = readCheckSession();
    if (!session) return;

    restoreCheckSession(session);
  }, []);

  function clearTreatResults() {
    checkRunRef.current += 1;
    clearCheckSession();
    if (download) {
      URL.revokeObjectURL(download.url);
      setDownload(null);
    }
    if (activatedDownload) {
      URL.revokeObjectURL(activatedDownload.url);
      setActivatedDownload(null);
    }
    setProcessStats(null);
    setProcessedRows([]);
    setActivatedRows([]);
    setTaggedActivatedRows([]);
    setCheckStatus("idle");
    setCheckStats({ submitted: 0, activated: 0, inactive: 0, taskId: "", remoteStatus: "" });
  }

  async function loadSourceFiles(nextFiles: File[]) {
    clearTreatResults();
    sourceFileNamesRef.current = nextFiles.map((file) => file.name);
    setFiles(nextFiles);
    setSourceRows([]);

    if (!nextFiles.length) {
      sourceFileNamesRef.current = [];
      setStatus("");
      return;
    }

    setIsReadingFiles(true);
    setStatus("Lendo arquivo para calcular a quantidade de contatos...");

    try {
      const parsedRows = (await Promise.all(nextFiles.map(readRows))).flat();
      setSourceRows(parsedRows);
      setStatus(`${parsedRows.length.toLocaleString("pt-BR")} linha(s) carregadas. Processe para validar os ativados; as etiquetas serao escolhidas depois.`);
    } catch {
      setFiles([]);
      setSourceRows([]);
      setStatus("Nao foi possivel ler a lista. Confira se o arquivo e CSV, XLSX ou XLS valido.");
    } finally {
      setIsReadingFiles(false);
    }
  }

  async function removeSourceFile(file: File) {
    const nextFiles = files.filter((candidate) => candidate !== file);
    await loadSourceFiles(nextFiles);
  }

  async function handleProcess() {
    if (!canProcess) return;

    setIsProcessing(true);
    setStatus("Processando lista...");
    clearTreatResults();
    setProcessMode("checked");

    try {
      const ignoreRows = (await Promise.all(ignoreFiles.map(readRows))).flat();
      const ignoredPhones = new Set(ignoreRows.map(getPhoneKey).filter(Boolean));
      const seenPhones = new Set<string>();
      const stats = {
        duplicates: 0,
        ignored: 0,
        invalidPhones: 0,
        withoutName: 0,
      };
      const cleanedRows: ListRow[] = [];

      for (const row of sourceRows) {
        const phoneKey = getPhoneKey(row);
        if (!isValidBrazilPhone(phoneKey)) {
          stats.invalidPhones += 1;
          continue;
        }
        if (ignoredPhones.has(phoneKey)) {
          stats.ignored += 1;
          continue;
        }
        if (discardWithoutName && !hasName(row)) {
          stats.withoutName += 1;
          continue;
        }
        if (removeDuplicates && phoneKey) {
          if (seenPhones.has(phoneKey)) {
            stats.duplicates += 1;
            continue;
          }
          seenPhones.add(phoneKey);
        }

        cleanedRows.push({ telefone: phoneKey });
      }

      if (cleanedRows.length === 0) {
        setStatus("Nenhum contato válido encontrado para gerar o CSV.");
        return;
      }

      const filename = "lista-tratada.csv";
      const csv = createCsv(cleanedRows);
      const url = createCsvUrl(csv);
      setDownload({ csv, url, filename });
      setProcessedRows(cleanedRows);
      const nextProcessStats: ProcessStats = {
        totalRead: sourceRows.length,
        processed: cleanedRows.length,
        duplicates: stats.duplicates,
        ignored: stats.ignored,
        invalidPhones: stats.invalidPhones,
      };
      setProcessStats(nextProcessStats);
      setStatus(`${buildProcessingSummary(cleanedRows.length, stats, { removeDuplicates, discardInvalidPhones, discardWithoutName })} Validando ativados automaticamente...`);
      await handleWhatsappCheck(cleanedRows, nextProcessStats);
    } catch {
      setStatus("Não foi possível processar a lista. Confira se o arquivo é CSV ou XLSX válido.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleOnlyProcess() {
    if (!canProcess) return;

    setIsProcessing(true);
    setStatus("Processando lista sem validar na CheckNumber...");
    clearTreatResults();
    setProcessMode("processed");

    try {
      const ignoreRows = (await Promise.all(ignoreFiles.map(readRows))).flat();
      const ignoredPhones = new Set(ignoreRows.map(getPhoneKey).filter(Boolean));
      const seenPhones = new Set<string>();
      const stats = {
        duplicates: 0,
        ignored: 0,
        invalidPhones: 0,
        withoutName: 0,
      };
      const cleanedRows: ListRow[] = [];

      for (const row of sourceRows) {
        const phoneKey = getPhoneKey(row);
        if (!isValidBrazilPhone(phoneKey)) {
          stats.invalidPhones += 1;
          continue;
        }
        if (ignoredPhones.has(phoneKey)) {
          stats.ignored += 1;
          continue;
        }
        if (discardWithoutName && !hasName(row)) {
          stats.withoutName += 1;
          continue;
        }
        if (removeDuplicates && phoneKey) {
          if (seenPhones.has(phoneKey)) {
            stats.duplicates += 1;
            continue;
          }
          seenPhones.add(phoneKey);
        }

        cleanedRows.push({ telefone: phoneKey });
      }

      if (cleanedRows.length === 0) {
        setStatus("Nenhum contato valido encontrado para gerar o CSV.");
        return;
      }

      const filename = "lista-tratada.csv";
      const csv = createCsv(cleanedRows);
      const url = createCsvUrl(csv);
      setDownload({ csv, url, filename });
      setProcessedRows(cleanedRows);
      setActivatedRows(cleanedRows);
      setCheckStatus("idle");
      setCheckStats({ submitted: 0, activated: 0, inactive: 0, taskId: "", remoteStatus: "" });
      setProcessStats({
        totalRead: sourceRows.length,
        processed: cleanedRows.length,
        duplicates: stats.duplicates,
        ignored: stats.ignored,
        invalidPhones: stats.invalidPhones,
      });
      setStatus(`${buildProcessingSummary(cleanedRows.length, stats, { removeDuplicates, discardInvalidPhones, discardWithoutName })} Escolha as etiquetas para gerar o CSV final sem validar na CheckNumber.`);
    } catch {
      setStatus("Nao foi possivel processar a lista. Confira se o arquivo e CSV ou XLSX valido.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function continueWhatsappCheck(taskId: string, rowsToCheck: ListRow[], initialStats: CheckStats, runId: number, sessionProcessStats: ProcessStats | null) {
    const phones = phonesOnlyForCheckNumber(rowsToCheck);
    let latestStats = initialStats;

    try {
      let exportedTask: CheckNumberTask | undefined;
      for (let attempt = 0; attempt < 180; attempt += 1) {
        if (checkRunRef.current !== runId) return;

        const task = await fetchTask(taskId);
        const remoteStatus = String(task.status || "processando");
        const nextStats: CheckStats = {
          ...initialStats,
          taskId,
          remoteStatus,
          total: task.total,
          success: task.success,
          failure: task.failure,
        };
        latestStats = nextStats;
        setCheckStats(nextStats);
        saveCheckSession({
          taskId,
          rowsToCheck,
          processStats: sessionProcessStats,
          checkStats: nextStats,
          checkStatus: "polling",
          status: `Lote enviado. Tarefa ${taskId}. Aguardando resultado...`,
        });

        if (remoteStatus.toLowerCase() === "exported" && (task.result_url || task.resultUrl || task.url)) {
          exportedTask = task;
          break;
        }

        if (["failed", "error", "canceled", "cancelled"].includes(remoteStatus.toLowerCase())) {
          throw new Error(`A tarefa retornou status ${remoteStatus}.`);
        }

        await sleep(2500);
      }

      if (checkRunRef.current !== runId) return;
      if (!exportedTask) throw new Error("A CheckNumber ainda nao exportou o resultado. Tente novamente em instantes.");

      setCheckStatus("downloading");
      setStatus("Baixando e extraindo arquivo de ativados...");
      saveCheckSession({
        taskId,
        rowsToCheck,
        processStats: sessionProcessStats,
        checkStats: { ...latestStats, taskId, remoteStatus: "exported" },
        checkStatus: "downloading",
        status: "Baixando e extraindo arquivo de ativados...",
      });

      const resultUrl = exportedTask.result_url || exportedTask.resultUrl || exportedTask.url || "";
      const resultResponse = await fetch(`${CHECKNUMBER_API_BASE}/result?url=${encodeURIComponent(resultUrl)}`);
      if (!resultResponse.ok) throw new Error(`Falha ao baixar resultado HTTP ${resultResponse.status}.`);

      const resultBlob = await resultResponse.blob();
      const extractedRows = await extractRowsFromBlob(resultBlob, resultUrl);
      const finalRows = activatedRowsWithTags(extractedRows, rowsToCheck);
      if (!finalRows.length) throw new Error("A CheckNumber nao retornou numeros ativados para essa lista.");
      if (checkRunRef.current !== runId) return;

      const doneStats: CheckStats = {
        ...latestStats,
        taskId,
        activated: finalRows.length,
        inactive: Math.max(0, phones.length - finalRows.length),
        remoteStatus: "exported",
      };
      const doneStatus = `${finalRows.length.toLocaleString("pt-BR")} numero(s) ativados encontrados. Agora escolha as etiquetas para gerar o CSV final.`;

      setActivatedRows(finalRows);
      setTaggedActivatedRows([]);
      if (activatedDownload) {
        URL.revokeObjectURL(activatedDownload.url);
        setActivatedDownload(null);
      }
      setCheckStatus("done");
      setCheckStats(doneStats);
      setStatus(doneStatus);
      saveCheckSession({
        taskId,
        rowsToCheck,
        processStats: sessionProcessStats,
        checkStats: doneStats,
        checkStatus: "done",
        activatedRows: finalRows,
        status: doneStatus,
      });
    } catch (error) {
      if (checkRunRef.current !== runId) return;
      const errorStatus = error instanceof Error ? error.message : "Falha ao validar WhatsApp na CheckNumber.";
      setCheckStatus("error");
      setStatus(errorStatus);
      saveCheckSession({
        taskId,
        rowsToCheck,
        processStats: sessionProcessStats,
        checkStats: { ...latestStats, taskId, remoteStatus: "erro" },
        checkStatus: "error",
        status: errorStatus,
      });
    }
  }

  async function handleWhatsappCheck(rowsToCheck = processedRows, sessionProcessStats = processStats) {
    const phones = phonesOnlyForCheckNumber(rowsToCheck);
    if (!phones.length) {
      setStatus("Nenhum telefone tratado valido para enviar a CheckNumber.");
      return;
    }

    const runId = checkRunRef.current + 1;
    checkRunRef.current = runId;

    try {
      setActivatedRows([]);
      if (activatedDownload) {
        URL.revokeObjectURL(activatedDownload.url);
        setActivatedDownload(null);
      }
      setCheckStatus("creating");
      const creatingStats: CheckStats = { submitted: phones.length, activated: 0, inactive: 0, taskId: "", remoteStatus: "criando" };
      setCheckStats(creatingStats);
      setStatus("Enviando lista tratada Brasil (+55) para a CheckNumber...");

      const taskId = await createWhatsappTask(phones);
      if (checkRunRef.current !== runId) return;

      const pollingStats: CheckStats = { ...creatingStats, taskId, remoteStatus: "processando" };
      const pollingStatus = `Lote enviado. Tarefa ${taskId}. Aguardando resultado...`;
      setCheckStatus("polling");
      setCheckStats(pollingStats);
      setStatus(pollingStatus);
      saveCheckSession({
        taskId,
        rowsToCheck,
        processStats: sessionProcessStats,
        checkStats: pollingStats,
        checkStatus: "polling",
        status: pollingStatus,
      });

      await continueWhatsappCheck(taskId, rowsToCheck, pollingStats, runId, sessionProcessStats);
    } catch (error) {
      if (checkRunRef.current !== runId) return;
      setCheckStatus("error");
      setStatus(error instanceof Error ? error.message : "Falha ao validar WhatsApp na CheckNumber.");
    }
  }

  function generateActivatedCsvWithTags() {
    if (!activatedRows.length) {
      setStatus("Valide os ativados antes de gerar etiquetas.");
      return;
    }
    if (!prefix.trim()) {
      setStatus("Informe o prefixo da etiqueta para gerar o CSV final.");
      return;
    }

    if (activatedDownload) {
      URL.revokeObjectURL(activatedDownload.url);
      setActivatedDownload(null);
    }

    const today = new Date();
    const dateCode = `${String(today.getDate()).padStart(2, "0")}${String(today.getMonth() + 1).padStart(2, "0")}`;
    const labels = Math.max(1, Math.min(labelCount, activatedRows.length));
    const rowsPerGeneratedLabel = Math.ceil(activatedRows.length / labels);
    const finalRows = activatedRows.map((row, index) => ({
      telefone: normalizeBrazilPhone(row.telefone),
      etiqueta: `${prefix.trim()} ${dateCode} - ${Math.floor(index / rowsPerGeneratedLabel) + 1}`,
    }));
    const suffix = processMode === "checked" ? "ativados" : "tratados";
    const filename = `${prefix.trim().replace(/\s+/g, "-").toLowerCase()}-${suffix}.csv`;
    const csv = createCsv(finalRows);
    const url = createCsvUrl(csv);

    setTaggedActivatedRows(finalRows);
    setActivatedDownload({ csv, url, filename });
    setStatus(`${finalRows.length.toLocaleString("pt-BR")} contato(s) distribuidos em ${labels} etiqueta(s). CSV final pronto.`);
  }

  return (
    <main className="template-page list-cleaner-page treat-list-page">
      <div className="template-heading">
        <div className="page-heading-icon">
          <FileText size={24} />
        </div>
        <div>
          <h1>Tratar Lista</h1>
          <p>Processe e organize seus contatos</p>
        </div>
      </div>

      <div className="treat-list-tabs" role="tablist" aria-label="Tratar lista">
        <button className={activeTab === "process" ? "active" : ""} onClick={() => setActiveTab("process")} type="button">
          <FileText size={16} />
          Processar lista
        </button>
        <button className={activeTab === "history" ? "active" : ""} onClick={() => setActiveTab("history")} type="button">
          <Clock3 size={16} />
          Historico
          {checkHistory.length ? <span>{checkHistory.length}</span> : null}
        </button>
      </div>

      {activeTab === "process" ? (
        <>
      <section className="card list-card">
        <h2>
          <span className="card-title-icon">
            <FileText size={18} />
          </span>
          Listas Principais
        </h2>
        <p className="hint">
          Upload de arquivos CSV ou XLSX com os contatos. A blacklist é carregada automaticamente da API.
        </p>

        <label className="dropzone">
          <input
            accept=".csv,.xlsx,.xls"
            multiple
            onChange={(event) => void loadSourceFiles(Array.from(event.target.files ?? []))}
            type="file"
          />
          <span className="dropzone-icon">
            <Upload size={30} />
          </span>
          <strong>Clique para selecionar ou arraste arquivos</strong>
        </label>
        {files.length > 0 ? (
          <div className="selected-file-list">
            {files.map((file) => (
              <div className="selected-file-row" key={`${file.name}-${file.size}`}>
                <strong>{file.name}</strong>
                <button
                  className="icon-button danger"
                  onClick={() => void removeSourceFile(file)}
                  title="Remover arquivo"
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {files.length > 0 ? (
          <div className="list-upload-insight">
            <div>
              <span>Total na lista</span>
              <strong>{isReadingFiles ? "Lendo..." : sourceRows.length.toLocaleString("pt-BR")}</strong>
            </div>
            <div>
              <span>Ativados</span>
              <strong>{checkStats.activated ? checkStats.activated.toLocaleString("pt-BR") : "Apos validar"}</strong>
            </div>
            <div>
              <span>Etiquetas</span>
              <strong>A definir</strong>
            </div>
          </div>
        ) : null}

        <label className="ignore-upload">
          <input
            accept=".csv,.xlsx,.xls"
            multiple
            onChange={(event) => setIgnoreFiles(Array.from(event.target.files ?? []))}
            type="file"
          />
          <Ban size={17} />
          <span>
            {ignoreFiles.length > 0
              ? ignoreFiles.map((file) => file.name).join(", ")
              : "Adicionar lista de ignore (opcional)"}
          </span>
        </label>
      </section>

      </>
      ) : (
        <section className="card list-card check-history-card">
          <div className="contacts-card-header">
            <div>
              <h3>
                <Clock3 size={18} />
                Ultimas validacoes
              </h3>
            </div>
            <button className="button secondary compact-button" onClick={clearCheckHistory} type="button">
              <Trash2 size={15} />
              Limpar historico
            </button>
          </div>

          {checkHistory.length ? (
            <div className="check-history-list">
            {checkHistory.map((item) => {
              const isActiveTask = item.taskId === checkStats.taskId;
              const itemInProgress = item.checkStatus === "creating" || item.checkStatus === "polling" || item.checkStatus === "downloading";
              const statusText =
                item.checkStatus === "done"
                  ? "Concluida"
                  : item.checkStatus === "error"
                    ? "Falhou"
                    : itemInProgress
                      ? "Em execucao"
                      : "Salva";

              return (
                <div className={`check-history-row ${isActiveTask ? "active" : ""}`} key={item.taskId}>
                  <div className="check-history-main">
                    <span className={`check-history-status status-${item.checkStatus}`}>{statusText}</span>
                    <div className="check-history-title">
                      <strong title={formatHistoryFileNames(item.sourceFileNames) || `Tarefa ${item.taskId}`}>
                        {formatHistoryFileNames(item.sourceFileNames) || `Tarefa ${item.taskId}`}
                      </strong>
                      {formatHistoryFileNames(item.sourceFileNames) ? <small>Tarefa {item.taskId}</small> : null}
                    </div>
                    <small>{formatHistoryDate(item.savedAt)}</small>
                  </div>
                  <div className="check-history-metrics">
                    <span>{item.checkStats.submitted.toLocaleString("pt-BR")} enviados</span>
                    <span>{item.checkStats.activated.toLocaleString("pt-BR")} ativados</span>
                    <span>{item.processStats?.processed?.toLocaleString("pt-BR") ?? item.rowsToCheck.length.toLocaleString("pt-BR")} tratados</span>
                  </div>
                  <div className="check-history-actions">
                    <button className="button secondary compact-button" onClick={() => restoreCheckSession(item)} type="button">
                      {itemInProgress ? <RefreshCcw size={15} /> : <Clipboard size={15} />}
                      {itemInProgress ? "Continuar" : "Abrir"}
                    </button>
                    <button
                      className="icon-button danger"
                      onClick={() => removeCheckHistoryItem(item.taskId)}
                      title="Remover do historico"
                      type="button"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
            </div>
          ) : (
            <div className="empty-state subtle-empty-state">
              <Clock3 size={28} />
              <strong>Nenhuma validacao salva ainda</strong>
              <span>Quando uma lista for processada, ela aparece aqui para consulta ou retomada.</span>
            </div>
          )}
        </section>
      )}

      {activeTab === "process" ? (
        <>
      <div className="list-action-row">
        <button className="button secondary process-list-button" disabled={!canProcess} onClick={handleOnlyProcess}>
          {isReadingFiles || isProcessing || checkInProgress ? <Loader2 className="spin-icon" size={18} /> : <FileText size={18} />}
          {isReadingFiles ? "Lendo lista..." : isProcessing && processMode === "processed" ? "Processando..." : "So Processar"}
        </button>
        <button className="button process-list-button" disabled={!canProcess} onClick={handleProcess}>
          {isReadingFiles || isProcessing || checkInProgress ? <Loader2 className="spin-icon" size={18} /> : <Play size={18} />}
          {isReadingFiles ? "Lendo lista..." : isProcessing || checkInProgress ? "Processando e validando..." : "Processar e verificar"}
        </button>
      </div>
      {status ? <p className="list-status muted">{status}</p> : null}
      {processStats ? (
        <section className="card process-stats-card">
          {[
            ["Total lido", processStats.totalRead.toLocaleString("pt-BR"), "neutral"],
            ["Processados", processStats.processed.toLocaleString("pt-BR"), "success"],
            ["Duplicados", processStats.duplicates.toLocaleString("pt-BR"), "warning"],
            ["Ignorados (blacklist)", processStats.ignored.toLocaleString("pt-BR"), "danger"],
            ["Inválidos", processStats.invalidPhones.toLocaleString("pt-BR"), "neutral"],
          ].map(([label, value, tone]) => (
            <div className={`process-stat ${tone}`} key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </section>
      ) : null}
      {shouldShowCheckPanel ? (
        <section className="card number-check-card treat-check-card">
          <div className="number-check-hero">
            <div className="number-check-title">
              <span className="number-check-icon">
                {checkInProgress ? <Loader2 className="spin-icon" size={22} /> : <ShieldCheck size={22} />}
              </span>
            </div>
            <div className={`number-check-state state-${checkStatus}`}>
              <Radio size={16} />
              {checkStatusLabel}
            </div>
          </div>

          <div className="number-check-progress-card">
            <div>
              <strong>{checkProgress}%</strong>
              <span>{checkStats.taskId ? `Tarefa ${checkStats.taskId}` : "Nenhum lote criado ainda"}</span>
            </div>
            <div className="number-check-progress">
              <span style={{ width: `${checkProgress}%` }} />
            </div>
            <small>{checkStats.remoteStatus ? `Status remoto: ${checkStats.remoteStatus}` : "Clique em verificar para checar WhatsApp ativo."}</small>
          </div>

          <div className="number-check-grid">
            <div className="metric-card number-metric">
              <span>Enviados</span>
              <strong>{checkStats.submitted.toLocaleString("pt-BR")}</strong>
              <small>Telefones tratados enviados</small>
            </div>
            <div className="metric-card number-metric success">
              <span>Ativados</span>
              <strong>{checkStats.activated.toLocaleString("pt-BR")}</strong>
              <small>Com WhatsApp confirmado</small>
            </div>
            <div className="metric-card number-metric danger">
              <span>Nao ativados</span>
              <strong>{checkStats.inactive.toLocaleString("pt-BR")}</strong>
              <small>Ficam fora do CSV final</small>
            </div>
            <div className="metric-card number-metric">
              <span>Processados</span>
              <strong>{((checkStats.success || 0) + (checkStats.failure || 0)).toLocaleString("pt-BR")}</strong>
              <small>{checkStats.total ? `de ${checkStats.total.toLocaleString("pt-BR")}` : "Aguardando retorno"}</small>
            </div>
          </div>

        </section>
      ) : null}
      {activatedRows.length ? (
        <section className="card list-card activated-label-card">
          <div className="contacts-card-header">
            <div>
              <h3>
                <ShieldCheck size={18} />
                Distribuir contatos em etiquetas
              </h3>
              <p>{activatedRows.length.toLocaleString("pt-BR")} {readyRowsLabel} encontrados. Escolha quantas etiquetas quer gerar.</p>
            </div>
          </div>

          <div className="list-settings-grid">
            <label className="field">
              <span>Quantidade de etiquetas</span>
              <input
                className="input"
                min={1}
                max={Math.max(activatedRows.length, 1)}
                onChange={(event) => setLabelCount(Math.max(1, Number(event.target.value)))}
                type="number"
                value={labelCount}
              />
              <p className="hint">
                {finalRowsPerLabel
                  ? `Vai ficar cerca de ${finalRowsPerLabel.toLocaleString("pt-BR")} contato(s) por etiqueta.`
                  : "Informe quantas etiquetas deseja gerar."}
              </p>
            </label>

            <label className="field">
              <span>Prefixo da etiqueta *</span>
              <input
                className="input"
                onChange={(event) => setPrefix(event.target.value)}
                placeholder="Prefixo"
                value={prefix}
              />
              <p className="hint">Ex: "RJ" vira RJ DDMM - 1, RJ DDMM - 2...</p>
            </label>

            <div className="label-preview-card">
              <span>CSV final</span>
              <strong>{taggedActivatedRows.length ? `${taggedActivatedRows.length.toLocaleString("pt-BR")} pronto(s)` : "Aguardando gerar"}</strong>
              <button className="button" type="button" onClick={generateActivatedCsvWithTags}>
                <FileText size={17} />
                Gerar CSV com etiquetas
              </button>
            </div>
          </div>
        </section>
      ) : null}
      {activatedDownload ? (
        <section className="card number-format-result activated-result">
          <div className="contacts-card-header">
            <div>
              <h3>
                <ShieldCheck size={18} />
                CSV final
              </h3>
              <p>{processMode === "checked" ? "Resultado limpo da CheckNumber com telefone e etiqueta." : "Lista tratada com telefones validos no padrao Brasil e etiqueta."}</p>
            </div>
            <div className="button-row">
              <button className="button" type="button" onClick={() => triggerDownload(activatedDownload.url, activatedDownload.filename)}>
                <Download size={17} />
                Baixar {activatedDownload.filename}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  const result = publishRowsToContacts(taggedActivatedRows);
                  setStatus(`${result.contacts.toLocaleString("pt-BR")} contato(s) publicados em ${result.tags} etiqueta(s).`);
                }}
              >
                <Upload size={17} />
                Subir para Broadcast
              </button>
            </div>
          </div>

          <div className="csv-compact-preview">
            <span>Preview dos ativados:</span>
            <pre>{activatedDownload.csv.replace(/^\ufeff/, "").split("\n").slice(0, 8).join("\n")}</pre>
          </div>
        </section>
      ) : null}
        </>
      ) : null}
    </main>
  );
}

function RetryPage() {
  const [sourceTab, setSourceTab] = useState<RetrySourceTab>("system");
  const [files, setFiles] = useState<File[]>([]);
  const [pastedNumbers, setPastedNumbers] = useState("");
  const [rowsPerLabel, setRowsPerLabel] = useState(5000);
  const [prefix, setPrefix] = useState("Retentativa");
  const [removeDuplicates, setRemoveDuplicates] = useState(true);
  const [discardInvalidPhones, setDiscardInvalidPhones] = useState(true);
  const [status, setStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingSystem, setIsLoadingSystem] = useState(false);
  const [systemPeriod, setSystemPeriod] = useState("Ultimos 7 dias");
  const [systemBm, setSystemBm] = useState("");
  const [systemSender, setSystemSender] = useState("");
  const [systemSearch, setSystemSearch] = useState("");
  const [systemOptions, setSystemOptions] = useState<SystemRetryOptions>({ bms: [], senders: [], users: [] });
  const [systemCandidates, setSystemCandidates] = useState<SystemRetryCandidate[]>([]);
  const [selectedSystemIds, setSelectedSystemIds] = useState<Set<string>>(new Set());
  const [download, setDownload] = useState<{ csv: string; url: string; filename: string } | null>(null);
  const [retryRows, setRetryRows] = useState<ListRow[]>([]);
  const [retryStats, setRetryStats] = useState<RetryStats | null>(null);

  const canProcess = (files.length > 0 || pastedNumbers.trim().length > 0) && prefix.trim().length > 0 && !isProcessing;
  const pastedPreviewCount = extractPhonesFromText(pastedNumbers).length;
  const activeStage = isProcessing ? 2 : download ? 3 : files.length || pastedNumbers.trim() || systemCandidates.length ? 1 : 0;
  const filteredSystemCandidates = systemCandidates.filter((candidate) => {
    const search = normalizeHeader(systemSearch);
    if (!search) return true;
    return [candidate.phone, candidate.campaignName, candidate.bm, candidate.sender, candidate.templateName, candidate.error]
      .map(normalizeHeader)
      .some((value) => value.includes(search));
  });
  const selectedSystemCount = filteredSystemCandidates.filter((candidate) => selectedSystemIds.has(candidate.id)).length;

  async function collectPhones() {
    const fromFiles = (
      await Promise.all(
        files.map(async (file) => {
          if (/\.(txt|log)$/i.test(file.name)) {
            return extractPhonesFromText(await readFileText(file));
          }

          try {
            const rows = await readRows(file);
            return rows.map(getPhoneKey).filter(Boolean);
          } catch {
            return extractPhonesFromText(await readFileText(file));
          }
        }),
      )
    ).flat();

    return [...fromFiles, ...extractPhonesFromText(pastedNumbers)];
  }

  function buildRetryFromPhones(phones: string[], sourceLabel = "retentativas") {
    if (download) {
      URL.revokeObjectURL(download.url);
      setDownload(null);
    }
    setRetryRows([]);
    setRetryStats(null);

    const seenPhones = new Set<string>();
    const stats = {
      duplicates: 0,
      invalidPhones: 0,
    };
    const today = new Date();
    const dateCode = `${String(today.getDate()).padStart(2, "0")}${String(today.getMonth() + 1).padStart(2, "0")}`;
    const preparedRows: ListRow[] = [];

    for (const rawPhone of phones) {
      const phone = normalizeBrazilPhone(rawPhone);
      if (!isValidBrazilPhone(phone)) {
        stats.invalidPhones += 1;
        continue;
      }
      if (removeDuplicates && phone) {
        if (seenPhones.has(phone)) {
          stats.duplicates += 1;
          continue;
        }
        seenPhones.add(phone);
      }

      const tagIndex = Math.floor(preparedRows.length / Math.max(rowsPerLabel, 1)) + 1;
      preparedRows.push({
        telefone: phone,
        etiqueta: `${prefix.trim()} ${dateCode} - ${tagIndex}`,
      });
    }

    if (preparedRows.length === 0) {
      setStatus("Nenhum telefone valido encontrado para gerar retentativa.");
      return false;
    }

    const filename = `${prefix.trim().replace(/\s+/g, "-").toLowerCase()}-retentativas.csv`;
    const csv = createCsv(preparedRows);
    const url = createCsvUrl(csv);
    setDownload({ csv, url, filename });
    setRetryRows(preparedRows);
    setRetryStats({
      totalFound: phones.length,
      generated: preparedRows.length,
      duplicates: stats.duplicates,
      invalidPhones: stats.invalidPhones,
      labels: Math.ceil(preparedRows.length / Math.max(rowsPerLabel, 1)),
    });
    setStatus(
      `${preparedRows.length.toLocaleString("pt-BR")} ${sourceLabel} geradas. ${removeDuplicates ? `${stats.duplicates} duplicados removidos` : "duplicados mantidos"}, ${discardInvalidPhones ? `${stats.invalidPhones} invalidos removidos` : "invalidos mantidos"}.`,
    );
    return true;
  }

  async function handleRetryProcess() {
    if (!canProcess) return;

    setIsProcessing(true);
    setStatus("Gerando retentativas...");

    try {
      const phones = await collectPhones();
      buildRetryFromPhones(phones, "retentativas");
    } catch {
      setStatus("Nao foi possivel gerar retentativas. Confira o arquivo ou texto informado.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function fetchSystemFailures() {
    setIsLoadingSystem(true);
    setStatus("Buscando falhas dos disparos...");
    try {
      const payload = await fetchRetryAnalytics({
        period: systemPeriod,
        bm: systemBm,
        sender: systemSender,
      });
      const options = asRecord(payload.options);
      const bms = Array.isArray(options.bms) ? options.bms.map(String) : [];
      const senders = Array.isArray(options.senders) ? options.senders.map(String) : [];
      const users = Array.isArray(options.users) ? options.users.map(String) : [];
      const candidates = parseSystemRetryCandidates(payload);
      setSystemOptions({ bms, senders, users });
      setSystemCandidates(candidates);
      setSelectedSystemIds(new Set(candidates.map((candidate) => candidate.id)));
      setStatus(
        candidates.length
          ? `${candidates.length.toLocaleString("pt-BR")} falha(s) encontradas para retentativa.`
          : "Nenhuma falha encontrada no periodo selecionado.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Nao foi possivel consultar as falhas do sistema.");
    } finally {
      setIsLoadingSystem(false);
    }
  }

  function generateFromSystemFailures() {
    const phones = systemCandidates.filter((candidate) => selectedSystemIds.has(candidate.id)).map((candidate) => candidate.phone);
    if (!phones.length) {
      setStatus("Selecione pelo menos uma falha para gerar a retentativa.");
      return;
    }
    buildRetryFromPhones(phones, "falhas");
  }

  function toggleSystemCandidate(id: string) {
    setSelectedSystemIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectVisibleSystemCandidates() {
    setSelectedSystemIds((current) => {
      const next = new Set(current);
      filteredSystemCandidates.forEach((candidate) => next.add(candidate.id));
      return next;
    });
  }

  function clearVisibleSystemCandidates() {
    setSelectedSystemIds((current) => {
      const next = new Set(current);
      filteredSystemCandidates.forEach((candidate) => next.delete(candidate.id));
      return next;
    });
  }
  async function publishRetryRows() {
    if (!retryRows.length || !download) {
      setStatus("Gere as retentativas antes de subir para o Broadcast.");
      return;
    }

    setStatus("Subindo retentativas para o Broadcast...");
    try {
      const result = await publishRowsToContactsApi(retryRows, download.filename);
      setStatus(`${result.contacts.toLocaleString("pt-BR")} contato(s) publicados no banco em ${result.tags} etiqueta(s).`);
    } catch {
      const result = publishRowsToContacts(retryRows);
      setStatus(`API indisponivel. Publiquei localmente ${result.contacts.toLocaleString("pt-BR")} contato(s) em ${result.tags} etiqueta(s).`);
    }
  }

  function clearRetryPage() {
    setFiles([]);
    setPastedNumbers("");
    setStatus("");
    setSystemSearch("");
    setSelectedSystemIds(new Set());
    setRetryRows([]);
    setRetryStats(null);
    if (download) URL.revokeObjectURL(download.url);
    setDownload(null);
  }

  useEffect(() => {
    fetchSystemFailures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="template-page list-cleaner-page retry-page">
      <div className="template-heading retry-hero">
        <div className="page-heading-icon">
          <RefreshCcw size={24} />
        </div>
        <div>
          <h1>Retentativas</h1>
          <p>Reprocesse falhas, limpe números e gere uma nova lista pronta para envio</p>
        </div>
      </div>

      <section className="retry-flow-card">
        {[
          ["Origem", sourceTab === "system" ? "Falhas do sistema" : "Arquivos ou logs", Upload],
          ["Leitura", "Telefones encontrados", Clock3],
          ["Tratamento", "Duplicados e invalidos", Sparkles],
          ["Pronto", "CSV de retentativas", CheckCircle2],
        ].map(([title, subtitle, Icon], index) => (
          <div className={index <= activeStage ? "retry-step active" : "retry-step"} key={String(title)}>
            <span>{index < activeStage ? <Check size={14} /> : <Icon size={15} />}</span>
            <strong>{title as string}</strong>
            <small>{subtitle as string}</small>
          </div>
        ))}
      </section>

      <section className="retry-source-tabs" aria-label="Origem das retentativas">
        <button className={sourceTab === "system" ? "active" : ""} onClick={() => setSourceTab("system")} type="button">
          <Cloud size={16} />
          Falhas do sistema
        </button>
        <button className={sourceTab === "manual" ? "active" : ""} onClick={() => setSourceTab("manual")} type="button">
          <Upload size={16} />
          Importar manual
        </button>
      </section>

      {sourceTab === "system" ? (
        <section className="card list-card retry-system-card">
          <div className="retry-card-title-row">
            <div>
              <h2>
                <span className="card-title-icon">
                  <Filter size={18} />
                </span>
                Falhas capturadas
              </h2>
              <p className="hint">Busque falhas de Broadcast e Flows e gere uma nova base sem copiar logs.</p>
            </div>
            <button className="button secondary" disabled={isLoadingSystem} onClick={fetchSystemFailures} type="button">
              <RefreshCcw size={16} />
              {isLoadingSystem ? "Atualizando..." : "Atualizar"}
            </button>
          </div>

          <div className="retry-system-toolbar">
            <label className="field">
              <span>Periodo</span>
              <select className="input" onChange={(event) => setSystemPeriod(event.target.value)} value={systemPeriod}>
                <option value="Ultimas 24h">Ultimas 24h</option>
                <option value="Ultimos 7 dias">Ultimos 7 dias</option>
                <option value="Ultimos 30 dias">Ultimos 30 dias</option>
                <option value="Tudo">Tudo</option>
              </select>
            </label>
            <label className="field">
              <span>BM</span>
              <select className="input" onChange={(event) => setSystemBm(event.target.value)} value={systemBm}>
                <option value="">Todas as BMs</option>
                {systemOptions.bms.map((bm) => (
                  <option key={bm} value={bm}>{bm}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Remetente</span>
              <select className="input" onChange={(event) => setSystemSender(event.target.value)} value={systemSender}>
                <option value="">Todos os remetentes</option>
                {systemOptions.senders.map((sender) => (
                  <option key={sender} value={sender}>{sender}</option>
                ))}
              </select>
            </label>
            <label className="field retry-search-field">
              <span>Busca</span>
              <div className="input-with-icon">
                <Search size={16} />
                <input
                  className="input"
                  onChange={(event) => setSystemSearch(event.target.value)}
                  placeholder="Telefone, campanha, template ou erro..."
                  value={systemSearch}
                />
              </div>
            </label>
          </div>

          <div className="retry-system-summary">
            <span>{systemCandidates.length.toLocaleString("pt-BR")} falha(s) no periodo</span>
            <span>{selectedSystemCount.toLocaleString("pt-BR")} selecionada(s) visiveis</span>
            <span>{systemOptions.bms.length.toLocaleString("pt-BR")} BM(s)</span>
            <span>{systemOptions.senders.length.toLocaleString("pt-BR")} remetente(s)</span>
          </div>

          <div className="retry-selection-actions">
            <button className="button ghost" onClick={selectVisibleSystemCandidates} type="button">
              <Check size={16} />
              Selecionar visiveis
            </button>
            <button className="button ghost" onClick={clearVisibleSystemCandidates} type="button">
              <XCircle size={16} />
              Limpar selecao
            </button>
            <button className="button" disabled={!selectedSystemIds.size} onClick={generateFromSystemFailures} type="button">
              <Play size={16} />
              Gerar retentativa
            </button>
          </div>

          <div className="retry-failure-list">
            {filteredSystemCandidates.length ? (
              filteredSystemCandidates.map((candidate) => (
                <label className={selectedSystemIds.has(candidate.id) ? "retry-failure-row selected" : "retry-failure-row"} key={candidate.id}>
                  <input checked={selectedSystemIds.has(candidate.id)} onChange={() => toggleSystemCandidate(candidate.id)} type="checkbox" />
                  <span className="retry-failure-phone">{candidate.phone}</span>
                  <span>
                    <strong>{candidate.campaignName}</strong>
                    <small>{candidate.templateName}</small>
                  </span>
                  <span>
                    <strong>{candidate.sender}</strong>
                    <small>{candidate.bm}</small>
                  </span>
                  <span className="retry-failure-error">{candidate.error}</span>
                  <small>{candidate.createdAt ? new Date(candidate.createdAt).toLocaleString("pt-BR") : "-"}</small>
                </label>
              ))
            ) : (
              <div className="retry-empty-state">
                <AlertTriangle size={20} />
                <strong>Nenhuma falha encontrada</strong>
                <span>Quando um disparo retornar falha pelo webhook ou pela API, ele aparece aqui para reprocessar.</span>
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="retry-layout">
          <section className="card list-card retry-input-card">
            <h2>
              <span className="card-title-icon">
                <Upload size={18} />
              </span>
              Lista de Falhas
            </h2>
            <p className="hint">Envie arquivos ou cole logs. A tela detecta telefones automaticamente.</p>

            <label className={files.length ? "dropzone retry-dropzone has-files" : "dropzone retry-dropzone"}>
              <input accept=".csv,.xlsx,.xls,.txt,.log" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} type="file" />
              <span className="dropzone-icon">
                <Upload size={30} />
              </span>
              <strong>{files.length ? files.length + " arquivo(s) selecionado(s)" : "Selecionar arquivos"}</strong>
              {files.length > 0 ? <small>{files.map((file) => file.name).join(", ")}</small> : <small>CSV, XLSX, TXT ou LOG</small>}
            </label>

            <label className="field">
              <span>Numeros ou logs de falha</span>
              <textarea
                className="textarea retry-textarea"
                onChange={(event) => setPastedNumbers(event.target.value)}
                placeholder="Cole aqui numeros, logs de erro ou mensagens com telefones..."
                value={pastedNumbers}
              />
            </label>
            <div className="retry-live-hint">
              <Clock3 size={15} />
              <span>{pastedPreviewCount.toLocaleString("pt-BR")} telefone(s) detectados no texto colado</span>
            </div>
          </section>

          <section className="card list-card settings-card retry-settings-card">
            <h2>
              <span className="card-title-icon">
                <Settings size={18} />
              </span>
              Configuracoes
            </h2>

            <div className="list-settings-grid">
              <label className="field">
                <span>Linhas por etiqueta</span>
                <input className="input" min={1} onChange={(event) => setRowsPerLabel(Number(event.target.value))} type="number" value={rowsPerLabel} />
                <p className="hint">Ex: 1000 retentativas por etiqueta gera Retentativa DDMM - 1, - 2...</p>
              </label>

              <label className="field">
                <span>Prefixo da etiqueta *</span>
                <input className="input" onChange={(event) => setPrefix(event.target.value)} placeholder="Retentativa" value={prefix} />
              </label>

              <div className="checkbox-stack">
                <CheckOption checked={removeDuplicates} label="Remover duplicados automaticamente" onChange={setRemoveDuplicates} />
                <CheckOption checked={discardInvalidPhones} label="Descartar telefones invalidos" onChange={setDiscardInvalidPhones} />
              </div>
            </div>
          </section>
        </div>
      )}

      {sourceTab === "system" ? (
        <section className="card list-card settings-card retry-settings-inline">
          <h2>
            <span className="card-title-icon">
              <Settings size={18} />
            </span>
            Geracao das etiquetas
          </h2>
          <div className="retry-inline-settings-grid">
            <label className="field">
              <span>Linhas por etiqueta</span>
              <input className="input" min={1} onChange={(event) => setRowsPerLabel(Number(event.target.value))} type="number" value={rowsPerLabel} />
            </label>
            <label className="field">
              <span>Prefixo da etiqueta *</span>
              <input className="input" onChange={(event) => setPrefix(event.target.value)} placeholder="Retentativa" value={prefix} />
            </label>
            <div className="checkbox-stack compact">
              <CheckOption checked={removeDuplicates} label="Remover duplicados" onChange={setRemoveDuplicates} />
              <CheckOption checked={discardInvalidPhones} label="Descartar invalidos" onChange={setDiscardInvalidPhones} />
            </div>
          </div>
        </section>
      ) : null}

      <section className="retry-dashboard">
        {[
          { label: "Encontrados", value: retryStats?.totalFound ?? (sourceTab === "system" ? systemCandidates.length : pastedPreviewCount), tone: "neutral", Icon: Clock3 },
          { label: "Gerados", value: retryStats?.generated ?? 0, tone: "success", Icon: CheckCircle2 },
          { label: "Duplicados", value: retryStats?.duplicates ?? 0, tone: "warning", Icon: RefreshCcw },
          { label: "Invalidos", value: retryStats?.invalidPhones ?? 0, tone: "danger", Icon: AlertTriangle },
          { label: "Etiquetas", value: retryStats?.labels ?? 0, tone: "primary", Icon: FileText },
        ].map(({ label, value, tone, Icon }) => (
          <div className={`retry-metric ${tone}`} key={label}>
            <Icon size={18} />
            <strong>{value.toLocaleString("pt-BR")}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>

      <div className="list-action-row">
        {sourceTab === "manual" ? (
          <button className="button process-list-button" disabled={!canProcess} onClick={handleRetryProcess}>
            <Play size={18} />
            {isProcessing ? "Gerando..." : "Gerar retentativas"}
          </button>
        ) : null}
        {download ? (
          <>
            <button
              className="button secondary process-list-button"
              onClick={() => {
                triggerDownload(download.url, download.filename);
                setStatus("Download do CSV de retentativas iniciado.");
              }}
              type="button"
            >
              <Download size={17} />
              Baixar CSV retentativas
            </button>
            <button className="button secondary process-list-button" onClick={publishRetryRows} type="button">
              <Cloud size={17} />
              Subir para Broadcast
            </button>
            <button
              className="button secondary process-list-button"
              onClick={async () => {
                await navigator.clipboard.writeText(download.csv.replace(/^\ufeff/, ""));
                setStatus("CSV de retentativas copiado.");
              }}
              type="button"
            >
              <Clipboard size={17} />
              Copiar CSV
            </button>
            <button className="button ghost process-list-button" onClick={clearRetryPage} type="button">
              <Trash2 size={17} />
              Limpar
            </button>
          </>
        ) : null}
      </div>
      {status ? <p className="list-status muted">{status}</p> : null}
      {download ? (
        <section className="card retry-result-card">
          <div className="processed-result-header">
            <div className="processed-result-title">
              <span className="result-check">
                <Check size={20} />
              </span>
              <div>
                <h2>{retryStats?.generated.toLocaleString("pt-BR") ?? "CSV"} retentativas prontas</h2>
                <p>{download.filename} • {new TextEncoder().encode(download.csv.replace(/^\ufeff/, "")).byteLength} bytes</p>
              </div>
            </div>
            <div className="button-row">
              <span className="retry-success-pill">Pronto para download</span>
              <button className="button secondary" onClick={publishRetryRows} type="button">
                <Cloud size={16} />
                Subir para Broadcast
              </button>
            </div>
          </div>
          <div className="csv-compact-preview">
            <span>Preview do arquivo:</span>
            <pre>{download.csv.replace(/^\ufeff/, "").split("\n").slice(0, 6).join("\n")}</pre>
          </div>
        </section>
      ) : null}
    </main>
  );
}

export function ListTools({ mode }: { mode: "process" | "retry" }) {
  return mode === "process" ? <TreatListPage /> : <RetryPage />;
}
