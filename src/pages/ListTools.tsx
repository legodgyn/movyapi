import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Ban, Check, CheckCircle2, Clipboard, Clock3, Cloud, Download, FileText, Loader2, Play, Radio, RefreshCcw, Settings, ShieldCheck, Sparkles, Trash2, Upload } from "lucide-react";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { config } from "../lib/config";

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

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeCell(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeBrazilPhone(value: unknown) {
  const digits = normalizeCell(value).replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("55") && digits.length >= 12) {
    return digits.slice(0, 13);
  }

  if (digits.length === 11 || digits.length === 10) {
    return `55${digits}`;
  }

  return digits;
}

function isValidBrazilPhone(phone: string) {
  if (!phone.startsWith("55")) return false;
  if (phone.length !== 12 && phone.length !== 13) return false;

  const ddd = phone.slice(2, 4);
  const localNumber = phone.slice(4);
  if (ddd.startsWith("0")) return false;
  if (/^(\d)\1+$/.test(localNumber)) return false;
  if (phone.length === 13 && localNumber[0] !== "9") return false;

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
  const sourceValue = phoneColumn ? row[phoneColumn] : Object.values(row).find((value) => /\d{8,}/.test(normalizeCell(value)));
  return normalizeBrazilPhone(sourceValue);
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
  return Object.values(row).find((value) => /\d{8,}/.test(normalizeCell(value).replace(/\D/g, "")));
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
  const content = brazilPhones.map(toE164).filter(Boolean).join("\n");
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
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<ListRow>(sheet, { defval: "" }).filter((row) => !isEmptyRow(row));
}

async function readFileText(file: File) {
  return file.text();
}

function extractPhonesFromText(text: string) {
  const matches = text.match(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-.\s]?\d{4}/g) ?? [];
  return matches.map(normalizeBrazilPhone).filter(Boolean);
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
  const [removeDuplicates, setRemoveDuplicates] = useState(true);
  const [discardWithoutName, setDiscardWithoutName] = useState(true);
  const [discardInvalidPhones, setDiscardInvalidPhones] = useState(true);
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
    setFiles(nextFiles);
    setSourceRows([]);
    clearTreatResults();

    if (!nextFiles.length) {
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
        if (discardInvalidPhones && !isValidBrazilPhone(phoneKey)) {
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
        if (discardInvalidPhones && !isValidBrazilPhone(phoneKey)) {
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

      <section className="card list-card settings-card">
        <h2>
          <span className="card-title-icon">
            <Settings size={18} />
          </span>
          Configurações
        </h2>

        <div className="list-settings-grid compact-settings-grid">
          <div className="checkbox-stack">
            <CheckOption
              checked={removeDuplicates}
              label="Remover duplicados automaticamente"
              onChange={setRemoveDuplicates}
            />
            <CheckOption
              checked={discardWithoutName}
              label="Descartar leads sem nome"
              onChange={setDiscardWithoutName}
            />
            <CheckOption
              checked={discardInvalidPhones}
              label="Descartar telefones inválidos"
              onChange={setDiscardInvalidPhones}
            />
          </div>
        </div>
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
                    <strong>Tarefa {item.taskId}</strong>
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
  const [files, setFiles] = useState<File[]>([]);
  const [pastedNumbers, setPastedNumbers] = useState("");
  const [rowsPerLabel, setRowsPerLabel] = useState(5000);
  const [prefix, setPrefix] = useState("Retentativa");
  const [removeDuplicates, setRemoveDuplicates] = useState(true);
  const [discardInvalidPhones, setDiscardInvalidPhones] = useState(true);
  const [status, setStatus] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [download, setDownload] = useState<{ csv: string; url: string; filename: string } | null>(null);
  const [retryStats, setRetryStats] = useState<RetryStats | null>(null);

  const canProcess = (files.length > 0 || pastedNumbers.trim().length > 0) && prefix.trim().length > 0 && !isProcessing;
  const pastedPreviewCount = extractPhonesFromText(pastedNumbers).length;
  const activeStage = isProcessing ? 2 : download ? 3 : files.length || pastedNumbers.trim() ? 1 : 0;

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

  async function handleRetryProcess() {
    if (!canProcess) return;

    setIsProcessing(true);
    setStatus("Gerando retentativas...");
    if (download) {
      URL.revokeObjectURL(download.url);
      setDownload(null);
    }
    setRetryStats(null);

    try {
      const phones = await collectPhones();
      const seenPhones = new Set<string>();
      const stats = {
        duplicates: 0,
        invalidPhones: 0,
      };
      const today = new Date();
      const dateCode = `${String(today.getDate()).padStart(2, "0")}${String(today.getMonth() + 1).padStart(2, "0")}`;
      const retryRows: ListRow[] = [];

      for (const phone of phones) {
        if (discardInvalidPhones && !isValidBrazilPhone(phone)) {
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

        const tagIndex = Math.floor(retryRows.length / Math.max(rowsPerLabel, 1)) + 1;
        retryRows.push({
          telefone: phone,
          etiqueta: `${prefix.trim()} ${dateCode} - ${tagIndex}`,
        });
      }

      if (retryRows.length === 0) {
        setStatus("Nenhum telefone válido encontrado para gerar retentativa.");
        return;
      }

      const filename = `${prefix.trim().replace(/\s+/g, "-").toLowerCase()}-retentativas.csv`;
      const csv = createCsv(retryRows);
      const url = createCsvUrl(csv);
      setDownload({ csv, url, filename });
      setRetryStats({
        totalFound: phones.length,
        generated: retryRows.length,
        duplicates: stats.duplicates,
        invalidPhones: stats.invalidPhones,
        labels: Math.ceil(retryRows.length / Math.max(rowsPerLabel, 1)),
      });
      setStatus(
        `${retryRows.length} retentativas geradas. ${removeDuplicates ? `${stats.duplicates} duplicados removidos` : "duplicados mantidos"}, ${discardInvalidPhones ? `${stats.invalidPhones} inválidos removidos` : "inválidos mantidos"}.`,
      );
    } catch {
      setStatus("Não foi possível gerar retentativas. Confira o arquivo ou texto informado.");
    } finally {
      setIsProcessing(false);
    }
  }

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
          ["Entrada", "Arquivos ou logs", Upload],
          ["Leitura", "Telefones encontrados", Clock3],
          ["Tratamento", "Duplicados e inválidos", Sparkles],
          ["Pronto", "CSV de retentativas", CheckCircle2],
        ].map(([title, subtitle, Icon], index) => (
          <div className={index <= activeStage ? "retry-step active" : "retry-step"} key={String(title)}>
            <span>{index < activeStage ? <Check size={14} /> : <Icon size={15} />}</span>
            <strong>{title as string}</strong>
            <small>{subtitle as string}</small>
          </div>
        ))}
      </section>

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
            <input
              accept=".csv,.xlsx,.xls,.txt,.log"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              type="file"
            />
            <span className="dropzone-icon">
              <Upload size={30} />
            </span>
            <strong>{files.length ? `${files.length} arquivo(s) selecionado(s)` : "Selecionar arquivos"}</strong>
            {files.length > 0 ? <small>{files.map((file) => file.name).join(", ")}</small> : <small>CSV, XLSX, TXT ou LOG</small>}
          </label>

          <label className="field">
            <span>Números ou logs de falha</span>
            <textarea
              className="textarea retry-textarea"
              onChange={(event) => setPastedNumbers(event.target.value)}
              placeholder="Cole aqui números, logs de erro ou mensagens com telefones..."
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
          Configurações
        </h2>

        <div className="list-settings-grid">
          <label className="field">
            <span>Linhas por etiqueta</span>
            <input
              className="input"
              min={1}
              onChange={(event) => setRowsPerLabel(Number(event.target.value))}
              type="number"
              value={rowsPerLabel}
            />
            <p className="hint">Ex: 1000 retentativas por etiqueta gera Retentativa DDMM - 1, - 2...</p>
          </label>

          <label className="field">
            <span>Prefixo da etiqueta *</span>
            <input
              className="input"
              onChange={(event) => setPrefix(event.target.value)}
              placeholder="Retentativa"
              value={prefix}
            />
          </label>

          <div className="checkbox-stack">
            <CheckOption
              checked={removeDuplicates}
              label="Remover duplicados automaticamente"
              onChange={setRemoveDuplicates}
            />
            <CheckOption
              checked={discardInvalidPhones}
              label="Descartar telefones inválidos"
              onChange={setDiscardInvalidPhones}
            />
          </div>
        </div>
      </section>
      </div>

      <section className="retry-dashboard">
        {[
          { label: "Encontrados", value: retryStats?.totalFound ?? pastedPreviewCount, tone: "neutral", Icon: Clock3 },
          { label: "Gerados", value: retryStats?.generated ?? 0, tone: "success", Icon: CheckCircle2 },
          { label: "Duplicados", value: retryStats?.duplicates ?? 0, tone: "warning", Icon: RefreshCcw },
          { label: "Inválidos", value: retryStats?.invalidPhones ?? 0, tone: "danger", Icon: AlertTriangle },
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
        <button className="button process-list-button" disabled={!canProcess} onClick={handleRetryProcess}>
          <Play size={18} />
          {isProcessing ? "Gerando..." : "Gerar retentativas"}
        </button>
        {download ? (
          <>
            <button
              className="button secondary process-list-button"
              onClick={async () => {
                try {
                  const result = await saveCsvLocally(download.csv, download.filename);
                  setStatus(`Retentativas salvas em ${result.path} (${result.bytes} bytes).`);
                } catch {
                  try {
                    await saveCsvToDisk(download.csv, download.filename);
                    setStatus("Retentativas salvas no computador.");
                  } catch {
                    triggerDownload(download.url, download.filename);
                    setStatus("Não consegui salvar direto. Use Copiar CSV como alternativa.");
                  }
                }
              }}
              type="button"
            >
              <Download size={17} />
              Baixar CSV retentativas
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
            <span className="retry-success-pill">Pronto para download</span>
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
