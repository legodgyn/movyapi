import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

function loadDotEnv() {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const execFileAsync = promisify(execFile);
const port = Number(process.env.SCALEAPI_SAVE_PORT ?? 5174);
const host = process.env.SCALEAPI_SAVE_HOST || "127.0.0.1";
const downloadsDir = join(homedir(), "Downloads");
const checkNumberApiKey = process.env.CHECKNUMBER_API_KEY || "";
const sms24hApiKey = process.env.SMS24H_API_KEY || "";
const sisbratelApiKey = process.env.SISBRATEL_API_KEY || "";
const metaWebhookVerifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || "";
const databasePath = process.env.MOVY_DB_PATH || join(process.cwd(), "data", "movyapi.sqlite");
const storageFilePath = process.env.MOVY_STORAGE_FILE || join(process.cwd(), "data", "storage.json");
const uploadsDir = process.env.MOVY_UPLOADS_DIR || join(process.cwd(), "data", "uploads");
const checkNumberBaseUrl = "https://api.checknumber.ai/v1";
const sms24hBaseUrl = process.env.SMS24H_API_BASE_URL || "https://api.sms24h.org/stubs/handler_api";
const sisbratelBaseUrl = process.env.SISBRATEL_API_BASE_URL || "https://app.sisbratel.com/api/external";
const whatsappStatuses = new Map();
const WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const FLOW_RUNTIME_KEY = "movy.flowRuntime";
const BROADCAST_ANALYTICS_KEY = "movy.broadcastAnalyticsEvents";
const CONVERSATION_MESSAGES_KEY = "movy.conversationMessages";
const INFOBIP_APIS_KEY = "movy.infobipApis";
const graphApiBase = "https://graph.facebook.com/v24.0";
let lastBroadcastDebug = null;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function setCors(response, contentType = "application/json; charset=utf-8") {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type,x-api-key");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  response.setHeader("Content-Type", contentType);
}

const sms24hErrorMessages = {
  BAD_KEY: "Chave SMS24h invalida ou sem permissao.",
  BAD_ACTION: "Acao SMS24h invalida.",
  BAD_SERVICE: "Servico nao suportado pela SMS24h.",
  FORBIDEN_SERVICE: "Servico indisponivel para essa conta na SMS24h.",
  NO_NUMBERS: "Sem numeros WhatsApp Brasil disponiveis agora.",
  NO_BALANCE: "Saldo insuficiente na SMS24h.",
  NO_ACTIVATION: "Ativacao nao encontrada na SMS24h.",
  STATUS_CANCEL: "Ativacao cancelada.",
  STATUS_WAIT_CODE: "Aguardando SMS com o codigo.",
  STATUS_WAIT_RETRY: "Aguardando novo SMS.",
};

function sms24hUrl(params) {
  const url = new URL(sms24hBaseUrl);
  url.searchParams.set("api_key", sms24hApiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

function parseSms24hText(raw) {
  const text = String(raw || "").trim();
  if (text.startsWith("ACCESS_BALANCE:")) {
    return { ok: true, status: "balance", balance: Number(text.split(":")[1] || 0), raw: text };
  }
  if (text.startsWith("ACCESS_NUMBER:")) {
    const [, id, number] = text.split(":");
    return { ok: true, status: "number", id, number, raw: text };
  }
  if (text.startsWith("STATUS_OK:")) {
    return { ok: true, status: "code", code: text.slice("STATUS_OK:".length).trim(), raw: text };
  }
  if (sms24hErrorMessages[text]) {
    return { ok: !text.startsWith("BAD_") && !text.startsWith("NO_"), status: text, message: sms24hErrorMessages[text], raw: text };
  }
  return { ok: true, status: "raw", raw: text };
}

async function callSms24h(params) {
  if (!sms24hApiKey) {
    const error = new Error("SMS24H_API_KEY nao configurada no servidor");
    error.statusCode = 500;
    throw error;
  }
  const upstream = await fetch(sms24hUrl(params), {
    headers: {
      Accept: "text/plain, application/json, */*",
      "User-Agent": "Mozilla/5.0 MovyApi/1.0",
    },
  });
  const raw = await upstream.text();
  if (!upstream.ok) {
    const error = new Error(
      raw?.trim() || `SMS24h retornou HTTP ${upstream.status}. Tente novamente ou confirme se a API aceita chamadas da VPS.`
    );
    error.statusCode = upstream.status;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = parseSms24hText(raw);
  }
  return { upstreamStatus: upstream.status, raw, parsed };
}

async function handleSms24h(request, response) {
  try {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/sms24h/balance") {
      const result = await callSms24h({ action: "getBalance" });
      sendJson(response, result.upstreamStatus, { ok: result.upstreamStatus < 400, ...result.parsed });
      return;
    }

    if (request.method === "GET" && url.pathname === "/sms24h/stock") {
      const statusResult = await callSms24h({ action: "getNumbersStatus", country: "73", operator: "any" });
      const priceResult = await callSms24h({ action: "getPrices", country: "73", service: "wa" });
      const stock = typeof statusResult.parsed === "object" && !Array.isArray(statusResult.parsed) ? statusResult.parsed : {};
      const prices = typeof priceResult.parsed === "object" && !Array.isArray(priceResult.parsed) ? priceResult.parsed : {};
      sendJson(response, 200, {
        ok: true,
        service: "wa",
        country: "73",
        available: Number(stock.wa_0 || 0),
        price: Number(prices?.["73"]?.wa?.cost || 0),
        count: Number(prices?.["73"]?.wa?.count || 0),
        stock,
        prices,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/sms24h/orders") {
      const body = JSON.parse((await readRequestBody(request)).toString("utf8") || "{}");
      const ddd = String(body.ddd || "").replace(/\D/g, "").slice(0, 2);
      const result = await callSms24h({
        action: "getNumber",
        operator: "any",
        service: "wa",
        country: "73",
        ddd,
      });
      const status = result.parsed?.ok === false ? 400 : result.upstreamStatus;
      sendJson(response, status, {
        ok: result.upstreamStatus < 400 && result.parsed?.ok !== false,
        service: "wa",
        country: "73",
        ddd: ddd || null,
        ...result.parsed,
      });
      return;
    }

    const orderMatch = url.pathname.match(/^\/sms24h\/orders\/([^/]+)$/);
    if (request.method === "GET" && orderMatch) {
      const result = await callSms24h({ action: "getStatus", id: orderMatch[1] });
      sendJson(response, result.upstreamStatus, { ok: result.upstreamStatus < 400, id: orderMatch[1], ...result.parsed });
      return;
    }

    const statusMatch = url.pathname.match(/^\/sms24h\/orders\/([^/]+)\/status$/);
    if (request.method === "POST" && statusMatch) {
      const body = JSON.parse((await readRequestBody(request)).toString("utf8") || "{}");
      const status = String(body.status || "");
      if (!/^[368]$/.test(status)) {
        sendJson(response, 400, { ok: false, error: "invalid-status", message: "Use 3 para novo SMS, 6 para finalizar ou 8 para cancelar." });
        return;
      }
      const result = await callSms24h({ action: "setStatus", status, id: statusMatch[1] });
      sendJson(response, result.upstreamStatus, { ok: result.upstreamStatus < 400, id: statusMatch[1], ...result.parsed });
      return;
    }

    sendJson(response, 404, { ok: false, error: "sms24h-route-not-found" });
  } catch (error) {
    sendJson(response, error?.statusCode || 500, { ok: false, error: error instanceof Error ? error.message : "sms24h-proxy-failed" });
  }
}

async function callSisbratel(path, options = {}) {
  if (!sisbratelApiKey) {
    const error = new Error("SISBRATEL_API_KEY nao configurada no servidor");
    error.statusCode = 500;
    throw error;
  }
  const upstream = await fetch(`${sisbratelBaseUrl.replace(/\/$/, "")}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 MovyApi/1.0",
      "X-API-Key": sisbratelApiKey,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const raw = await upstream.text();
  let parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = { raw };
  }
  if (!upstream.ok) {
    const message =
      parsed?.message ||
      parsed?.error ||
      raw?.trim() ||
      `SisBratel retornou HTTP ${upstream.status}`;
    const error = new Error(message);
    error.statusCode = upstream.status;
    error.payload = parsed;
    throw error;
  }
  return { upstreamStatus: upstream.status, parsed, raw };
}

function normalizeSisbratelActivation(item) {
  const source = item?.activation || item?.order || item?.data || item?.item || item || {};
  const id = source.activationId || source.id || source.activation_id || "";
  return {
    id: String(id),
    internalId: source.id ? String(source.id) : "",
    activationId: String(id),
    number: String(source.phoneNumber || source.phone_number || source.number || ""),
    serviceCode: String(source.serviceCode || source.service_code || "wa"),
    serviceName: String(source.serviceName || source.service_name || "WhatsApp"),
    status: String(source.status || ""),
    code: source.smsCode || source.sms_code || source.code || null,
    price: typeof source.price === "number" ? source.price : Number(source.price || source.metadata?.finalPrice || 0),
    ddd: source.ddd || source.metadata?.ddd || null,
    createdAt: source.createdAt || source.created_at || "",
    expiresAt: source.expiresAt || source.expires_at || "",
    raw: source,
  };
}

function extractSisbratelActivation(payload) {
  return payload?.activation || payload?.order || payload?.data || payload?.item || payload;
}

function normalizeSisbratelList(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.activations)
          ? payload.activations
          : Array.isArray(payload?.history)
            ? payload.history
            : [];
  return list.map(normalizeSisbratelActivation).filter((item) => item.id || item.number);
}

async function handleSisbratel(request, response) {
  try {
    const url = new URL(request.url || "", `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/sisbratel/balance") {
      const result = await callSisbratel("/balance");
      sendJson(response, 200, { ok: true, ...result.parsed });
      return;
    }

    if (request.method === "GET" && url.pathname === "/sisbratel/services") {
      const result = await callSisbratel("/services");
      const services = Array.isArray(result.parsed)
        ? result.parsed
        : Array.isArray(result.parsed?.services)
          ? result.parsed.services
          : Array.isArray(result.parsed?.data)
            ? result.parsed.data
            : [];
      const whatsapp = services.find((service) => String(service.code || service.serviceCode || "").toLowerCase() === "wa");
      sendJson(response, 200, { ok: true, services, whatsapp });
      return;
    }

    if (request.method === "GET" && url.pathname === "/sisbratel/activations") {
      const result = await callSisbratel("/activations");
      sendJson(response, 200, { ok: true, activations: normalizeSisbratelList(result.parsed), raw: result.parsed });
      return;
    }

    if (request.method === "GET" && url.pathname === "/sisbratel/history") {
      const result = await callSisbratel("/history");
      sendJson(response, 200, { ok: true, history: normalizeSisbratelList(result.parsed), raw: result.parsed });
      return;
    }

    if (request.method === "POST" && url.pathname === "/sisbratel/orders") {
      const body = JSON.parse((await readRequestBody(request)).toString("utf8") || "{}");
      const ddd = String(body.ddd || "").replace(/\D/g, "").slice(0, 2);
      const payload = {
        serviceCode: "wa",
        serviceName: "WhatsApp",
        ...(ddd ? { ddd } : {}),
      };
      const result = await callSisbratel("/buy", { method: "POST", body: payload });
      sendJson(response, 200, { ok: true, order: normalizeSisbratelActivation(extractSisbratelActivation(result.parsed)), raw: result.parsed });
      return;
    }

    const orderMatch = url.pathname.match(/^\/sisbratel\/orders\/([^/]+)$/);
    if (request.method === "GET" && orderMatch) {
      const id = decodeURIComponent(orderMatch[1]);
      const result = await callSisbratel(`/status/${encodeURIComponent(id)}`);
      sendJson(response, 200, {
        ok: true,
        order: normalizeSisbratelActivation({ activationId: id, ...extractSisbratelActivation(result.parsed) }),
        raw: result.parsed,
      });
      return;
    }

    const actionMatch = url.pathname.match(/^\/sisbratel\/orders\/([^/]+)\/(cancel|complete|renew|reactivate)$/);
    if (request.method === "POST" && actionMatch) {
      const id = decodeURIComponent(actionMatch[1]);
      const action = actionMatch[2];
      const result = await callSisbratel(`/${action}`, {
        method: "POST",
        body: { activationId: id, id },
      });
      sendJson(response, 200, {
        ok: true,
        order: normalizeSisbratelActivation({ activationId: id, ...extractSisbratelActivation(result.parsed) }),
        raw: result.parsed,
      });
      return;
    }

    sendJson(response, 404, { ok: false, error: "sisbratel-route-not-found" });
  } catch (error) {
    sendJson(response, error?.statusCode || 500, {
      ok: false,
      error: error instanceof Error ? error.message : "sisbratel-proxy-failed",
      details: error?.payload || null,
    });
  }
}

function normalizeWhatsAppStatus(status) {
  const messageId = String(status.id || status.message_id || "").trim();
  if (!messageId) return null;
  const errors = Array.isArray(status.errors) ? status.errors : [];
  const firstError = errors[0] || {};
  return {
    id: messageId,
    status: String(status.status || "").toLowerCase(),
    timestamp: status.timestamp ? Number(status.timestamp) : Math.floor(Date.now() / 1000),
    recipientId: String(status.recipient_id || ""),
    conversationId: String(status.conversation?.id || ""),
    pricingCategory: String(status.pricing?.category || ""),
    errorCode: firstError.code || firstError.error_code || "",
    errorTitle: firstError.title || firstError.error_title || "",
    errorMessage: firstError.message || firstError.error_data?.details || firstError.error_message || "",
    raw: status,
  };
}

function collectWhatsAppStatuses(payload) {
  const collected = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const statuses = Array.isArray(change?.value?.statuses) ? change.value.statuses : [];
      for (const status of statuses) {
        const normalized = normalizeWhatsAppStatus(status);
        if (!normalized) continue;
        whatsappStatuses.set(normalized.id, normalized);
        collected.push(normalized);
      }
    }
  }
  return collected;
}

function safeStorageKey(value) {
  const key = String(value || "").trim();
  return /^[a-zA-Z0-9._:-]{1,120}$/.test(key) ? key : "";
}

async function readFileStorage() {
  try {
    return JSON.parse(await readFile(storageFilePath, "utf8"));
  } catch {
    return {};
  }
}

async function writeFileStorage(store) {
  await mkdir(dirname(storageFilePath), { recursive: true });
  await writeFile(storageFilePath, JSON.stringify(store, null, 2), "utf8");
}

async function runSqlite(args) {
  await mkdir(dirname(databasePath), { recursive: true });
  try {
    const { stdout } = await execFileAsync("sqlite3", [databasePath, ...args], {
      maxBuffer: 100 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function sqliteDotPath(value) {
  return `"${String(value).replace(/\\/g, "/").replace(/"/g, '\\"')}"`;
}

async function runSqliteScript(script) {
  await mkdir(dirname(databasePath), { recursive: true });
  const tempFile = join(dirname(databasePath), `.movy-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  await writeFile(tempFile, script, "utf8");
  try {
    return await runSqlite([`.read ${sqliteDotPath(tempFile)}`]);
  } finally {
    await unlink(tempFile).catch(() => null);
  }
}

function sqlValue(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

async function ensureDatabase() {
  const result = await runSqlite([
    "create table if not exists app_storage (key text primary key, value text not null, updated_at text not null);",
  ]);
  return result !== null;
}

async function getStoredValue(key) {
  if (await ensureDatabase()) {
    const output = await runSqlite(["-json", `select value from app_storage where key = ${sqlValue(key)} limit 1;`]);
    const rows = output ? JSON.parse(output || "[]") : [];
    return rows[0]?.value ? JSON.parse(rows[0].value) : null;
  }

  const store = await readFileStorage();
  return store[key] ?? null;
}

async function setStoredValue(key, value) {
  if (await ensureDatabase()) {
    const sql = `insert into app_storage (key, value, updated_at) values (${sqlValue(key)}, ${sqlValue(JSON.stringify(value))}, ${sqlValue(new Date().toISOString())}) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at;`;
    if (sql.length > 100000) await runSqliteScript(sql);
    else await runSqlite([sql]);
    return;
  }

  const store = await readFileStorage();
  store[key] = value;
  await writeFileStorage(store);
}

async function readBroadcastAnalyticsEvents() {
  const stored = await getStoredValue(BROADCAST_ANALYTICS_KEY);
  return Array.isArray(stored) ? stored.filter((item) => item && typeof item === "object") : [];
}

async function writeBroadcastAnalyticsEvents(events) {
  await setStoredValue(BROADCAST_ANALYTICS_KEY, events.slice(-50000));
}

async function readInfobipApis() {
  const stored = await getStoredValue(INFOBIP_APIS_KEY);
  return Array.isArray(stored) ? stored.filter((item) => item && typeof item === "object").map(sanitizeInfobipApi) : [];
}

async function writeInfobipApis(items) {
  await setStoredValue(INFOBIP_APIS_KEY, items.map(sanitizeInfobipApi));
}

function normalizeInfobipBaseUrl(value) {
  let url = String(value || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/^http:\/\//i, "https://").replace(/\/+$/, "");
}

function normalizeInfobipToken(value) {
  return String(value || "").trim().replace(/^App\s+/i, "");
}

function translateInfobipError(code, text) {
  const value = `${code || ""} ${text || ""}`.toLowerCase();
  if (value.includes("e401") || value.includes("valid authentication") || value.includes("authentication credentials")) {
    return "A API key da Infobip esta invalida, incompleta ou nao pertence a essa Base URL. Confira se a chave e a URL base sao da mesma conta Infobip.";
  }
  if (value.includes("e403") || value.includes("permission") || value.includes("forbidden")) {
    return "A API key foi aceita, mas nao tem permissao para acessar os remetentes WhatsApp.";
  }
  if (value.includes("e404") || value.includes("not found")) {
    return "A URL base da Infobip ou o recurso de remetentes nao foi encontrado. Use a URL base da conta, no formato https://xxxxx.api-xx.infobip.com.";
  }
  if (value.includes("e429") || value.includes("too many") || value.includes("rate")) {
    return "A Infobip limitou as requisicoes temporariamente. Aguarde alguns minutos e tente de novo.";
  }
  if (value.includes("timeout") || value.includes("aborted") || value.includes("failed to fetch")) {
    return "Nao foi possivel conectar na Infobip dentro do tempo limite.";
  }
  return "";
}

function infobipErrorMessage(status, payload, raw) {
  const record = payload && typeof payload === "object" ? payload : {};
  const requestError = record.requestError && typeof record.requestError === "object" ? record.requestError : {};
  const serviceException =
    requestError.serviceException && typeof requestError.serviceException === "object"
      ? requestError.serviceException
      : {};
  const parts = [
    record.errorCode,
    serviceException.text,
    serviceException.message,
    record.description,
    record.action,
    record.message,
    record.error,
  ]
    .filter(Boolean)
    .map((item) => String(item).trim())
    .filter(Boolean);
  const text = parts.join(" - ");
  const translated = translateInfobipError(parts[0] || status, `${text} ${raw || ""}`);
  if (translated) return text ? `${translated} Detalhe tecnico: ${text}` : translated;
  return text || String(raw || "").trim() || `Infobip retornou HTTP ${status}`;
}

function extractInfobipList(payload) {
  if (Array.isArray(payload)) return payload;
  const record = payload && typeof payload === "object" ? payload : {};
  for (const key of ["senders", "items", "results", "data", "channels"]) {
    if (Array.isArray(record[key])) return record[key];
  }
  if (record.sender || record.senderNumber || record.number || record.phoneNumber) return [record];
  return [];
}

function sanitizeInfobipSender(sender) {
  const source = sender && typeof sender === "object" ? sender : {};
  return {
    id: String(firstNonEmpty(source.id, source.senderId, source.sender_id, source.sender, source.number, "")),
    apiId: String(source.apiId || ""),
    apiName: String(source.apiName || ""),
    sender: String(firstNonEmpty(source.sender, source.senderNumber, source.sender_number, source.number, source.phoneNumber, "")),
    name: String(firstNonEmpty(source.name, source.displayName, source.display_name, source.verifiedName, source.sender, "")),
    status: String(firstNonEmpty(source.status, source.state, source.connectionStatus, source.enabled, "disponivel")),
    channel: String(firstNonEmpty(source.channel, source.type, "WhatsApp")),
  };
}

function sanitizeInfobipApi(api) {
  const source = api && typeof api === "object" ? api : {};
  const senders = Array.isArray(source.senders)
    ? source.senders.map(sanitizeInfobipSender).filter((sender) => sender.sender || sender.name)
    : [];
  return { ...source, senders };
}

function normalizeInfobipSender(api, raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  const sender = firstNonEmpty(
    source.sender,
    source.senderNumber,
    source.sender_number,
    source.number,
    source.phoneNumber,
    source.phone_number,
    source.phone,
    source.from,
    source.address,
    source.id
  );
  const name = firstNonEmpty(
    source.name,
    source.displayName,
    source.display_name,
    source.verifiedName,
    source.verified_name,
    source.businessName,
    source.business_name,
    sender,
    `Remetente ${index + 1}`
  );
  const id = firstNonEmpty(source.id, source.senderId, source.sender_id, sender, `${api.id}-${index}`);
  return {
    id: String(id),
    apiId: api.id,
    apiName: firstNonEmpty(api.name, api.label, "Infobip"),
    sender,
    name,
    status: firstNonEmpty(source.status, source.state, source.enabled, "disponivel"),
    channel: firstNonEmpty(source.channel, source.type, "WhatsApp"),
  };
}

async function fetchInfobipJson(api, path, options = {}) {
  const baseUrl = normalizeInfobipBaseUrl(api.base_url || api.baseUrl || api.url);
  const token = normalizeInfobipToken(api.token || api.api_key || api.apiKey || api.authorization);
  if (!baseUrl) {
    const error = new Error("Informe a Base URL da Infobip.");
    error.statusCode = 400;
    throw error;
  }
  if (!token) {
    const error = new Error("Informe o token/API Key da Infobip.");
    error.statusCode = 400;
    throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let upstream;
  try {
    const hasBody = options.body !== undefined && options.body !== null;
    upstream = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `App ${token}`,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        "User-Agent": "MovyApi/1.0",
      },
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "Nao foi possivel conectar na Infobip dentro do tempo limite."
      : error instanceof Error
        ? error.message
        : "Falha de rede ao conectar na Infobip.";
    const networkError = new Error(message);
    networkError.statusCode = 504;
    throw networkError;
  } finally {
    clearTimeout(timeout);
  }
  const raw = await upstream.text();
  let parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = { raw };
  }
  if (!upstream.ok) {
    const error = new Error(infobipErrorMessage(upstream.status, parsed, raw));
    error.statusCode = upstream.status;
    error.payload = parsed;
    throw error;
  }
  return parsed;
}

function normalizeInfobipLanguage(value) {
  const raw = String(value || "").trim();
  if (!raw) return "pt_BR";
  const lower = raw.toLowerCase().replace("-", "_");
  if (lower === "pt" || lower === "pt_br" || lower.includes("port")) return "pt_BR";
  if (lower === "es" || lower === "es_es" || lower.includes("span") || lower.includes("espan")) return "es";
  if (lower === "en" || lower === "en_us" || lower.includes("ing") || lower.includes("engl")) return "en_US";
  return raw;
}

function normalizeInfobipCategory(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "UTILITY";
  if (raw.includes("MARKET")) return "MARKETING";
  if (raw.includes("AUTH")) return "AUTHENTICATION";
  return "UTILITY";
}

function normalizeInfobipButton(button) {
  const source = button && typeof button === "object" ? button : {};
  const kind = String(firstNonEmpty(source.type, source.kind, "QUICK_REPLY")).toUpperCase();
  const text = firstNonEmpty(source.text, source.title, kind === "URL" ? "CLIQUE AQUI" : "Resposta");
  if (kind === "URL") {
    return {
      type: "URL",
      text,
      url: firstNonEmpty(source.url, source.href, "https://movyapi.com.br"),
    };
  }
  return {
    type: "QUICK_REPLY",
    text,
  };
}

function buildInfobipTemplatePayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const name = firstNonEmpty(source.name, source.templateName);
  const bodyText = firstNonEmpty(source.bodyText, source.body, source.text);
  if (!name) {
    const error = new Error("Informe o nome do template.");
    error.statusCode = 400;
    throw error;
  }
  if (!bodyText) {
    const error = new Error("Informe o texto do body do template.");
    error.statusCode = 400;
    throw error;
  }

  const mediaType = String(firstNonEmpty(source.mediaType, source.headerType, "NONE")).toUpperCase();
  const mediaUrl = firstNonEmpty(source.mediaUrl, source.headerUrl, source.exampleUrl);
  const buttons = Array.isArray(source.buttons) ? source.buttons.map(normalizeInfobipButton).filter((button) => button.text) : [];
  const structure = {
    type: mediaType === "IMAGE" || mediaType === "VIDEO" || mediaType === "DOCUMENT" ? "MEDIA" : "TEXT",
    body: {
      text: bodyText,
      examples: Array.isArray(source.bodyExamples)
        ? source.bodyExamples.map((item) => String(item || "exemplo"))
        : [],
    },
  };

  const footerText = firstNonEmpty(source.footerText, source.footer);
  if (footerText) structure.footer = { text: footerText };
  if (structure.type === "MEDIA") {
    structure.header = {
      format: mediaType,
      example: mediaUrl,
    };
  }
  if (buttons.length) structure.buttons = buttons;

  return {
    name,
    language: normalizeInfobipLanguage(source.language),
    category: normalizeInfobipCategory(source.category),
    allowCategoryChange: true,
    structure,
  };
}

function normalizeInfobipTemplateResponse(result, templatePayload, senderNumber) {
  const record = result && typeof result === "object" ? result : {};
  return {
    id: firstNonEmpty(record.id, record.templateId, record.name, templatePayload.name),
    name: firstNonEmpty(record.name, templatePayload.name),
    status: firstNonEmpty(record.status, record.templateStatus, record.state, "pending"),
    language: firstNonEmpty(record.language, templatePayload.language),
    category: firstNonEmpty(record.category, templatePayload.category),
    sender_number: senderNumber,
    response: record,
  };
}

async function syncInfobipSenders(api) {
  const attempts = ["/whatsapp/1/senders?limit=1000", "/whatsapp/1/senders"];
  let lastError = null;
  for (const path of attempts) {
    try {
      const payload = await fetchInfobipJson(api, path);
      const senders = extractInfobipList(payload)
        .map((item, index) => normalizeInfobipSender(api, item, index))
        .filter((sender) => sender.sender || sender.name);
      return { payload, senders };
    } catch (error) {
      lastError = error;
      if (error?.statusCode === 504 || (error?.statusCode && error.statusCode >= 400 && error.statusCode < 500)) throw error;
    }
  }
  throw lastError || new Error("Nao foi possivel consultar remetentes na Infobip.");
}

async function handleInfobipApis(request, response) {
  try {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const apis = await readInfobipApis();
    const apiMatch = url.pathname.match(/^\/infobip\/apis\/([^/]+)$/);
    const senderMatch = url.pathname.match(/^\/infobip\/apis\/([^/]+)\/senders$/);
    const syncMatch = url.pathname.match(/^\/infobip\/apis\/([^/]+)\/senders\/sync$/);
    const templateMatch = url.pathname.match(/^\/infobip\/apis\/([^/]+)\/templates$/);

    if (request.method === "GET" && url.pathname === "/infobip/apis") {
      const apiType = String(url.searchParams.get("api_type") || "").toLowerCase();
      const filtered = apiType
        ? apis.filter((api) => {
            const type = firstNonEmpty(api.api_type, api.provider, "INFOBIP").toLowerCase();
            return type.includes(apiType) || apiType.includes(type);
          })
        : apis;
      await writeInfobipApis(apis);
      sendJson(response, 200, { ok: true, data: filtered });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/infobip/apis") {
      const body = JSON.parse((await readRequestBody(request)).toString("utf8") || "{}");
      const now = new Date().toISOString();
      const item = {
        ...body,
        id: body.id || `infobip-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: firstNonEmpty(body.name, body.label, "Infobip"),
        label: firstNonEmpty(body.label, body.name, "Infobip"),
        api_type: firstNonEmpty(body.api_type, body.provider, "INFOBIP"),
        provider: firstNonEmpty(body.provider, body.api_type, "infobip").toLowerCase(),
        base_url: normalizeInfobipBaseUrl(body.base_url || body.baseUrl || body.url),
        token: normalizeInfobipToken(body.token || body.api_key || body.apiKey || body.authorization),
        sender_number: firstNonEmpty(body.sender_number, body.senderNumber, body.phone_number),
        created_at: body.created_at || now,
        updated_at: now,
      };
      await writeInfobipApis([item, ...apis.filter((api) => String(api.id) !== String(item.id))]);
      sendJson(response, 200, { ok: true, data: item });
      return true;
    }

    if (apiMatch && request.method === "PUT") {
      const id = decodeURIComponent(apiMatch[1]);
      const body = JSON.parse((await readRequestBody(request)).toString("utf8") || "{}");
      const current = apis.find((api) => String(api.id) === id) || {};
      const item = {
        ...current,
        ...body,
        id,
        name: firstNonEmpty(body.name, body.label, current.name, current.label, "Infobip"),
        label: firstNonEmpty(body.label, body.name, current.label, current.name, "Infobip"),
        api_type: firstNonEmpty(body.api_type, body.provider, current.api_type, "INFOBIP"),
        provider: firstNonEmpty(body.provider, body.api_type, current.provider, "infobip").toLowerCase(),
        base_url: normalizeInfobipBaseUrl(body.base_url || body.baseUrl || body.url || current.base_url || current.baseUrl || current.url),
        token: normalizeInfobipToken(body.token || body.api_key || body.apiKey || body.authorization || current.token || current.api_key),
        sender_number: firstNonEmpty(body.sender_number, body.senderNumber, body.phone_number, current.sender_number, current.senderNumber),
        updated_at: new Date().toISOString(),
      };
      await writeInfobipApis([item, ...apis.filter((api) => String(api.id) !== id)]);
      sendJson(response, 200, { ok: true, data: item });
      return true;
    }

    if (apiMatch && request.method === "DELETE") {
      const id = decodeURIComponent(apiMatch[1]);
      await writeInfobipApis(apis.filter((api) => String(api.id) !== id));
      sendJson(response, 200, { ok: true });
      return true;
    }

    if (senderMatch && request.method === "GET") {
      const id = decodeURIComponent(senderMatch[1]);
      const api = apis.find((item) => String(item.id) === id);
      if (!api) {
        sendJson(response, 404, { ok: false, error: "api-not-found", message: "API Infobip nao encontrada." });
        return true;
      }
      sendJson(response, 200, { ok: true, data: Array.isArray(api.senders) ? api.senders : [] });
      return true;
    }

    if (syncMatch && request.method === "POST") {
      const id = decodeURIComponent(syncMatch[1]);
      const api = apis.find((item) => String(item.id) === id);
      if (!api) {
        sendJson(response, 404, { ok: false, error: "api-not-found", message: "API Infobip nao encontrada." });
        return true;
      }
      let result;
      try {
        result = await syncInfobipSenders(api);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao sincronizar remetentes.";
        const cachedSenders = Array.isArray(api.senders) ? api.senders : [];
        const nextApi = {
          ...api,
          last_sync_at: "",
          last_sync_error: message,
          base_url: normalizeInfobipBaseUrl(api.base_url || api.baseUrl || api.url),
        };
        await writeInfobipApis([nextApi, ...apis.filter((item) => String(item.id) !== id)]);
        if (cachedSenders.length) {
          sendJson(response, 200, {
            ok: true,
            data: cachedSenders,
            count: cachedSenders.length,
            cached: true,
            warning: message,
          });
          return true;
        }
        throw error;
      }
      const nextApi = {
        ...api,
        senders: result.senders,
        base_url: normalizeInfobipBaseUrl(api.base_url || api.baseUrl || api.url),
        last_sync_at: new Date().toISOString(),
        last_sync_error: "",
      };
      await writeInfobipApis([nextApi, ...apis.filter((item) => String(item.id) !== id)]);
      sendJson(response, 200, { ok: true, data: result.senders, count: result.senders.length });
      return true;
    }

    if (templateMatch && request.method === "POST") {
      const id = decodeURIComponent(templateMatch[1]);
      const api = apis.find((item) => String(item.id) === id);
      if (!api) {
        sendJson(response, 404, { ok: false, error: "api-not-found", message: "API Infobip nao encontrada." });
        return true;
      }
      const body = JSON.parse((await readRequestBody(request)).toString("utf8") || "{}");
      const templatePayload = buildInfobipTemplatePayload(body.payload || body);
      const senderNumber = onlyDigits(firstNonEmpty(
        body.senderNumber,
        body.sender_number,
        body.sender,
        asRecord(body.payload).senderNumber,
        asRecord(asRecord(body.payload).api).senderNumber,
        api.sender_number,
        api.senderNumber
      ));
      if (!senderNumber) {
        sendJson(response, 400, {
          ok: false,
          error: "missing-sender",
          message: "Selecione um remetente Infobip antes de enviar o template.",
        });
        return true;
      }
      const result = await fetchInfobipJson(
        api,
        `/whatsapp/2/senders/${encodeURIComponent(senderNumber)}/templates`,
        { method: "POST", body: templatePayload }
      );
      const template = normalizeInfobipTemplateResponse(result, templatePayload, senderNumber);
      sendJson(response, 200, { ok: true, data: template, ...template });
      return true;
    }

    return false;
  } catch (error) {
    sendJson(response, error?.statusCode || 500, {
      ok: false,
      error: error instanceof Error ? error.message : "infobip-failed",
      details: error?.payload || null,
    });
    return true;
  }
}

function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeBrazilPhone(value) {
  const digits = onlyDigits(value);
  if (!digits) return "";
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function senderAnalyticsName(sender, fallback = "") {
  return firstNonEmpty(sender.name, sender.verifiedName, sender.senderName, sender.phoneNumber, sender.phone, fallback, "Remetente");
}

function broadcastAnalyticsContext(payload, recipient, lot, phone, messageId = "") {
  const payloadSender = asRecord(payload.sender);
  const lotSender = asRecord(asRecord(lot).sender);
  const template = asRecord(asRecord(lot).template);
  const audience = asRecord(asRecord(lot).audience);
  const campaign = asRecord(payload.campaign);
  const sender = Object.keys(lotSender).length ? lotSender : payloadSender;
  const createdAt = firstNonEmpty(payload.createdAt, campaign.createdAt, new Date().toISOString());
  return {
    id: messageId || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    messageId,
    broadcastId: firstNonEmpty(payload.id, campaign.id),
    campaignId: firstNonEmpty(campaign.id, payload.campaignId),
    campaignName: firstNonEmpty(campaign.name, payload.campaignName, payload.name, "Campanha sem nome"),
    mode: firstNonEmpty(payload.mode, campaign.mode, "simple"),
    channel: firstNonEmpty(payload.channel, campaign.channel, "whatsapp_cloud"),
    bm: firstNonEmpty(sender.bmName, sender.businessName, sender.bm_name, sender.name, payloadSender.bmName, "BM nao informada"),
    wabaId: firstNonEmpty(sender.wabaId, sender.waba_id, template.wabaId, payloadSender.wabaId),
    user: firstNonEmpty(payload.createdBy, campaign.createdBy, payload.user, payload.operator, "Admin"),
    sender: senderAnalyticsName(sender, recipient.senderName),
    phone: firstNonEmpty(sender.phoneNumber, sender.phone, sender.senderNumber, recipient.senderPhone),
    phoneNumberId: firstNonEmpty(recipient.phoneNumberId, sender.phoneNumberId, payload.phoneNumberId),
    recipient: phone,
    templateId: firstNonEmpty(recipient.templateId, template.id),
    templateName: firstNonEmpty(recipient.templateName, template.name),
    tagId: firstNonEmpty(recipient.tagId, audience.tagId),
    tagName: firstNonEmpty(recipient.tagName, audience.tagName),
    lotId: firstNonEmpty(recipient.lotId, lot.id),
    createdAt,
    updatedAt: new Date().toISOString(),
    acceptedAt: "",
    deliveredAt: "",
    failedAt: "",
    readAt: "",
    status: "queued",
    errorCode: "",
    errorMessage: "",
  };
}

async function appendBroadcastAnalyticsEvents(nextEvents) {
  if (!nextEvents.length) return;
  const current = await readBroadcastAnalyticsEvents();
  const byId = new Map(current.map((event) => [String(event.messageId || event.id), event]));
  for (const event of nextEvents) {
    const key = String(event.messageId || event.id);
    const previous = byId.get(key) || {};
    byId.set(key, { ...previous, ...event, updatedAt: new Date().toISOString() });
  }
  await writeBroadcastAnalyticsEvents(Array.from(byId.values()));
}

async function updateBroadcastAnalyticsStatuses(statuses) {
  if (!statuses.length) return;
  const current = await readBroadcastAnalyticsEvents();
  const byId = new Map(current.map((event) => [String(event.messageId || event.id), event]));
  let changed = false;
  for (const status of statuses) {
    const key = String(status.id || "");
    if (!key) continue;
    const previous = byId.get(key);
    if (!previous) continue;
    const statusValue = String(status.status || "").toLowerCase();
    const eventTime = status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : new Date().toISOString();
    byId.set(key, {
      ...previous,
      status: statusValue || previous.status,
      recipient: status.recipientId || previous.recipient,
      conversationId: status.conversationId || previous.conversationId || "",
      pricingCategory: status.pricingCategory || previous.pricingCategory || "",
      errorCode: status.errorCode || previous.errorCode || "",
      errorMessage: status.errorMessage || status.errorTitle || previous.errorMessage || "",
      deliveredAt: ["delivered", "read"].includes(statusValue) ? eventTime : previous.deliveredAt || "",
      readAt: statusValue === "read" ? eventTime : previous.readAt || "",
      failedAt: statusValue === "failed" ? eventTime : previous.failedAt || "",
      updatedAt: new Date().toISOString(),
    });
    changed = true;
  }
  if (changed) await writeBroadcastAnalyticsEvents(Array.from(byId.values()));
}

async function readConversationMessages() {
  const stored = await getStoredValue(CONVERSATION_MESSAGES_KEY);
  return Array.isArray(stored) ? stored.filter((item) => item && typeof item === "object") : [];
}

async function writeConversationMessages(messages) {
  await setStoredValue(CONVERSATION_MESSAGES_KEY, messages.slice(-100000));
}

function conversationIdFor(contactPhone, phoneNumberId = "") {
  return [normalizeBrazilPhone(contactPhone), String(phoneNumberId || "")].filter(Boolean).join(":");
}

function statusTime(status) {
  return status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : new Date().toISOString();
}

function renderTemplateText(template, variables = {}) {
  let text = templateBodyText(template);
  const bodyVariables = extractVariablesFromText(text);
  for (const variable of bodyVariables) {
    const value = variableValue(variables, variable);
    const escaped = String(variable).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "g"), value);
  }
  return normalizeTemplateParameterText(text);
}

function inboundTextFromMeta(message) {
  const record = asRecord(message);
  const interactive = asRecord(record.interactive);
  const buttonReply = asRecord(interactive.button_reply);
  const listReply = asRecord(interactive.list_reply);
  const button = asRecord(record.button);
  const text = asRecord(record.text);
  const type = String(record.type || "");
  return firstNonEmpty(
    text.body,
    buttonReply.title,
    listReply.title,
    button.text,
    asRecord(record.image).caption,
    asRecord(record.video).caption,
    asRecord(record.document).caption,
    type ? `[${type}]` : "Mensagem recebida",
  );
}

function conversationMessageFromInbound(value, message) {
  const metadata = asRecord(value.metadata);
  const record = asRecord(message);
  const from = normalizeBrazilPhone(record.from || "");
  const phoneNumberId = String(metadata.phone_number_id || "");
  return {
    id: String(record.id || `in-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    messageId: String(record.id || ""),
    provider: "meta",
    direction: "inbound",
    conversationId: conversationIdFor(from, phoneNumberId),
    contactPhone: from,
    senderPhoneNumberId: phoneNumberId,
    senderPhone: String(metadata.display_phone_number || ""),
    senderName: String(metadata.display_phone_number || "Remetente"),
    text: inboundTextFromMeta(record),
    type: String(record.type || "text"),
    status: "received",
    createdAt: record.timestamp ? new Date(Number(record.timestamp) * 1000).toISOString() : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    raw: record,
  };
}

function collectConversationInboundMessages(payload) {
  const messages = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = asRecord(change?.value);
      const rawMessages = Array.isArray(value.messages) ? value.messages : [];
      for (const message of rawMessages) {
        const normalized = conversationMessageFromInbound(value, message);
        if (normalized.contactPhone) messages.push(normalized);
      }
    }
  }
  return messages;
}

async function appendConversationMessages(nextMessages) {
  if (!nextMessages.length) return;
  const current = await readConversationMessages();
  const byId = new Map(current.map((message) => [String(message.messageId || message.id), message]));
  for (const message of nextMessages) {
    const key = String(message.messageId || message.id);
    const previous = byId.get(key) || {};
    byId.set(key, { ...previous, ...message, updatedAt: new Date().toISOString() });
  }
  await writeConversationMessages(Array.from(byId.values()));
}

async function updateConversationStatuses(statuses) {
  if (!statuses.length) return;
  const current = await readConversationMessages();
  const byId = new Map(current.map((message) => [String(message.messageId || message.id), message]));
  let changed = false;
  for (const status of statuses) {
    const key = String(status.id || "");
    if (!key) continue;
    const previous = byId.get(key);
    const statusValue = String(status.status || "").toLowerCase();
    const eventTime = statusTime(status);
    const next = {
      ...(previous || {
        id: key,
        messageId: key,
        provider: "meta",
        direction: "outbound",
        contactPhone: normalizeBrazilPhone(status.recipientId || ""),
        conversationId: conversationIdFor(status.recipientId || ""),
        text: "Mensagem enviada",
        type: "template",
        createdAt: eventTime,
      }),
      status: statusValue || previous?.status || "status",
      recipientPhone: normalizeBrazilPhone(status.recipientId || previous?.recipientPhone || previous?.contactPhone || ""),
      contactPhone: normalizeBrazilPhone(previous?.contactPhone || status.recipientId || ""),
      conversationId: previous?.conversationId || conversationIdFor(status.recipientId || previous?.contactPhone || "", previous?.senderPhoneNumberId || ""),
      errorCode: status.errorCode || previous?.errorCode || "",
      errorMessage: status.errorMessage || status.errorTitle || previous?.errorMessage || "",
      deliveredAt: ["delivered", "read"].includes(statusValue) ? eventTime : previous?.deliveredAt || "",
      readAt: statusValue === "read" ? eventTime : previous?.readAt || "",
      failedAt: statusValue === "failed" ? eventTime : previous?.failedAt || "",
      updatedAt: new Date().toISOString(),
      rawStatus: status.raw || status,
    };
    byId.set(key, next);
    changed = true;
  }
  if (changed) await writeConversationMessages(Array.from(byId.values()));
}

function conversationFromMessages(messages) {
  const byConversation = new Map();
  for (const message of messages) {
    const contactPhone = normalizeBrazilPhone(message.contactPhone || message.recipientPhone || message.from || message.to || "");
    if (!contactPhone) continue;
    const senderPhoneNumberId = String(message.senderPhoneNumberId || message.phoneNumberId || "");
    const id = message.conversationId || conversationIdFor(contactPhone, senderPhoneNumberId);
    const current = byConversation.get(id) || {
      id,
      contactPhone,
      senderPhoneNumberId,
      senderPhone: message.senderPhone || "",
      senderName: message.senderName || "Remetente",
      lastMessage: "",
      lastStatus: "",
      lastAt: "",
      lastInboundAt: "",
      canReplyUntil: "",
      replyWindowOpen: false,
      unread: 0,
      messages: [],
    };
    current.senderPhone = current.senderPhone || message.senderPhone || "";
    current.senderName = current.senderName || message.senderName || "Remetente";
    current.messages.push(message);
    if (message.direction === "inbound") {
      if (!message.readByAgentAt) current.unread += 1;
      const inboundAt = message.createdAt || message.updatedAt || "";
      if (inboundAt && (!current.lastInboundAt || new Date(inboundAt).getTime() >= new Date(current.lastInboundAt).getTime())) {
        current.lastInboundAt = inboundAt;
      }
    }
    const when = message.createdAt || message.updatedAt || "";
    if (!current.lastAt || new Date(when).getTime() >= new Date(current.lastAt).getTime()) {
      current.lastAt = when;
      current.lastMessage = message.text || message.status || "Mensagem";
      current.lastStatus = message.status || "";
    }
    byConversation.set(id, current);
  }
  return Array.from(byConversation.values())
    .map((conversation) => ({
      ...conversation,
      canReplyUntil: conversation.lastInboundAt ? new Date(new Date(conversation.lastInboundAt).getTime() + WHATSAPP_REPLY_WINDOW_MS).toISOString() : "",
      replyWindowOpen: conversation.lastInboundAt ? Date.now() - new Date(conversation.lastInboundAt).getTime() <= WHATSAPP_REPLY_WINDOW_MS : false,
      messages: conversation.messages.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()),
    }))
    .sort((a, b) => new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime());
}

async function canReplyWithFreeText(contactPhone, phoneNumberId) {
  const contact = normalizeBrazilPhone(contactPhone || "");
  const senderId = String(phoneNumberId || "");
  if (!contact || !senderId) return { ok: false, lastInboundAt: "", canReplyUntil: "" };
  const messages = await readConversationMessages();
  const inbound = messages
    .filter((message) => {
      const messageContact = normalizeBrazilPhone(message.contactPhone || message.from || "");
      return message.direction === "inbound" && messageContact === contact && String(message.senderPhoneNumberId || message.phoneNumberId || "") === senderId;
    })
    .sort((a, b) => new Date(b.createdAt || b.updatedAt || 0).getTime() - new Date(a.createdAt || a.updatedAt || 0).getTime())[0];
  const lastInboundAt = inbound?.createdAt || inbound?.updatedAt || "";
  const canReplyUntil = lastInboundAt ? new Date(new Date(lastInboundAt).getTime() + WHATSAPP_REPLY_WINDOW_MS).toISOString() : "";
  return {
    ok: Boolean(lastInboundAt && Date.now() <= new Date(canReplyUntil).getTime()),
    lastInboundAt,
    canReplyUntil,
  };
}

async function listConversations(params = {}) {
  const messages = await readConversationMessages();
  const storedConnected = await getStoredValue("movy.connectedSenders");
  const storedAccounts = await getStoredValue("scaleapi.bmAccounts");
  const storedSettings = await getStoredValue("scaleapi.bmSettings");
  const connectedSenders = Array.isArray(storedConnected) ? storedConnected : [];
  const accounts = [
    ...(Array.isArray(storedAccounts) ? storedAccounts : storedAccounts ? [storedAccounts] : []),
    ...(storedSettings ? [storedSettings] : []),
  ].filter((item) => item && typeof item === "object");
  const query = String(params.q || "").trim().toLowerCase();
  const sender = String(params.sender || "").trim();
  const filtered = messages.filter((message) => {
    const haystack = [message.contactPhone, message.senderPhone, message.senderName, message.text, message.status].join(" ").toLowerCase();
    const senderOk = !sender || sender === "all" || String(message.senderPhoneNumberId || "") === sender;
    return senderOk && (!query || haystack.includes(query));
  });
  const conversations = conversationFromMessages(filtered);
  const accountSenders = accounts.flatMap((account, accountIndex) => {
    const bmName = firstNonEmpty(account.name, account.businessName, account.label, `BM ${accountIndex + 1}`);
    const wabaId = String(account.defaultWabaId || account.wabaId || "");
    const connectedIds = new Set([
      account.defaultPhoneNumberId || account.phoneNumberId || "",
      ...(Array.isArray(account.connectedPhoneIds) ? account.connectedPhoneIds : []),
      ...connectedSenders.filter((item) => String(item.wabaId || "") === wabaId || String(item.bmId || "") === String(account.id || "")).map((item) => item.phoneNumberId),
    ].filter(Boolean).map(String));
    const phones = Array.isArray(account.phones) ? account.phones : [];
    const phoneRows = phones
      .filter((phone) => connectedIds.size === 0 || connectedIds.has(String(phone.id || "")))
      .map((phone) => [
        String(phone.id || ""),
        {
          id: String(phone.id || ""),
          name: firstNonEmpty(phone.verified_name, phone.verifiedName, bmName),
          phone: phone.display_phone_number || phone.phone || "",
        },
      ]);
    if (phoneRows.length) return phoneRows;
    const fallbackId = String(account.defaultPhoneNumberId || account.phoneNumberId || "");
    if (!fallbackId) return [];
    return [[fallbackId, { id: fallbackId, name: bmName, phone: account.phoneNumber || account.senderNumber || "" }]];
  });
  const senderRows = [
    ...accountSenders,
    ...connectedSenders.map((sender) => [
      String(sender.phoneNumberId || ""),
      {
        id: String(sender.phoneNumberId || ""),
        name: firstNonEmpty(sender.verifiedName, sender.bmName, "Remetente"),
        phone: sender.phone || "",
      },
    ]),
    ...messages
      .filter((message) => message.senderPhoneNumberId)
      .map((message) => [
        String(message.senderPhoneNumberId),
        {
          id: String(message.senderPhoneNumberId),
          name: message.senderName || "Remetente",
          phone: message.senderPhone || "",
        },
      ]),
  ].filter(([id]) => id);
  const senderMap = new Map();
  senderRows.forEach(([id, sender]) => {
    const current = senderMap.get(String(id)) || { id: String(id), name: "", phone: "" };
    const nextPhone = firstNonEmpty(current.phone, sender.phone);
    const currentName = firstNonEmpty(current.name);
    const incomingName = firstNonEmpty(sender.name);
    const currentIsPhone = nextPhone && normalizeBrazilPhone(currentName) === normalizeBrazilPhone(nextPhone);
    const incomingIsPhone = nextPhone && normalizeBrazilPhone(incomingName) === normalizeBrazilPhone(nextPhone);
    const candidateName = currentIsPhone && incomingName && !incomingIsPhone ? incomingName : firstNonEmpty(currentName, incomingName, sender.phone, "Remetente");
    senderMap.set(String(id), {
      id: String(id),
      name: candidateName === nextPhone ? firstNonEmpty(current.name, sender.name, "Remetente") : candidateName,
      phone: nextPhone,
    });
  });
  const senders = Array.from(senderMap.values()).map((sender) => {
    const related = messages.find((message) => String(message.senderPhoneNumberId || "") === String(sender.id || ""));
    return {
      ...sender,
      name: firstNonEmpty(sender.name, related?.senderName, related?.senderPhone, "Remetente"),
      phone: firstNonEmpty(sender.phone, related?.senderPhone, related?.senderName),
    };
  });
  return { ok: true, conversations, senders, total: conversations.length };
}

async function findSenderCredentials(phoneNumberId) {
  const storedAccounts = await getStoredValue("scaleapi.bmAccounts");
  const storedSettings = await getStoredValue("scaleapi.bmSettings");
  const storedConnected = await getStoredValue("movy.connectedSenders");
  const accounts = [
    ...(Array.isArray(storedAccounts) ? storedAccounts : storedAccounts ? [storedAccounts] : []),
    ...(storedSettings ? [storedSettings] : []),
  ].filter((item) => item && typeof item === "object");
  const connected = Array.isArray(storedConnected) ? storedConnected : [];
  const connectedSender = connected.find((sender) => String(sender.phoneNumberId || "") === String(phoneNumberId || ""));
  const account = accounts.find((item) => {
    const phones = Array.isArray(item.phones) ? item.phones : [];
    return (
      String(item.defaultPhoneNumberId || "") === String(phoneNumberId || "") ||
      phones.some((phone) => String(phone.id || "") === String(phoneNumberId || "")) ||
      (Array.isArray(item.connectedPhoneIds) && item.connectedPhoneIds.map(String).includes(String(phoneNumberId || ""))) ||
      (connectedSender && (String(item.defaultWabaId || "") === String(connectedSender.wabaId || "") || String(item.id || "") === String(connectedSender.bmId || "")))
    );
  });
  return {
    accessToken: String(account?.accessToken || ""),
    phoneNumberId: String(phoneNumberId || account?.defaultPhoneNumberId || ""),
    senderName: connectedSender?.verifiedName || connectedSender?.bmName || account?.name || account?.businessName || "Remetente",
    senderPhone: connectedSender?.phone || "",
  };
}

async function handleConversations(request, response) {
  const url = new URL(request.url || "", `http://${request.headers.host}`);
  if (request.method === "GET" && url.pathname === "/conversations") {
    sendJson(response, 200, await listConversations(Object.fromEntries(url.searchParams.entries())));
    return true;
  }
  if (request.method === "POST" && url.pathname === "/conversations/send") {
    const body = JSON.parse((await readRequestBody(request)).toString("utf8") || "{}");
    const to = normalizeBrazilPhone(body.to || body.contactPhone || "");
    const text = String(body.text || "").trim();
    const mediaUrl = String(body.mediaUrl || body.url || "").trim();
    const mediaTypeRaw = String(body.mediaType || body.type || "").toLowerCase();
    const mediaName = String(body.mediaName || body.filename || "arquivo").trim();
    const phoneNumberId = String(body.phoneNumberId || body.senderPhoneNumberId || "").trim();
    if (!to || (!text && !mediaUrl) || !phoneNumberId) {
      sendJson(response, 400, { ok: false, error: "missing-message-fields", message: "Informe remetente, contato e texto." });
      return true;
    }
    const replyWindow = await canReplyWithFreeText(to, phoneNumberId);
    if (!replyWindow.ok) {
      sendJson(response, 400, {
        ok: false,
        error: "reply-window-closed",
        message: "Essa conversa esta fora da janela de 24h. Envie um template aprovado para reabrir a conversa.",
        lastInboundAt: replyWindow.lastInboundAt,
        canReplyUntil: replyWindow.canReplyUntil,
      });
      return true;
    }
    const credentials = await findSenderCredentials(phoneNumberId);
    if (!credentials.accessToken) {
      sendJson(response, 400, { ok: false, error: "missing-sender-token", message: "Nao encontrei token da BM para esse remetente." });
      return true;
    }
    const normalizedText = normalizeTemplateParameterText(text);
    const mediaKind = mediaUrl
      ? mediaTypeRaw.includes("video")
        ? "video"
        : mediaTypeRaw.includes("audio")
          ? "audio"
          : mediaTypeRaw.includes("image")
            ? "image"
            : "document"
      : "text";
    const payload = mediaUrl
      ? {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: mediaKind,
          [mediaKind]:
            mediaKind === "document"
              ? { link: mediaUrl, filename: mediaName, ...(normalizedText ? { caption: normalizedText } : {}) }
              : mediaKind === "audio"
                ? { link: mediaUrl }
                : { link: mediaUrl, ...(normalizedText ? { caption: normalizedText } : {}) },
        }
      : {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: normalizedText },
    };
    const result = await sendCloudMessage(phoneNumberId, credentials.accessToken, payload);
    const createdAt = new Date().toISOString();
    await appendConversationMessages([
      {
        id: result.messageId,
        messageId: result.messageId,
        provider: "meta",
        direction: "outbound",
        conversationId: conversationIdFor(to, phoneNumberId),
        contactPhone: to,
        recipientPhone: to,
        senderPhoneNumberId: phoneNumberId,
        senderPhone: credentials.senderPhone,
        senderName: credentials.senderName,
        text: normalizedText || mediaName,
        type: mediaKind,
        status: "accepted",
        createdAt,
        updatedAt: createdAt,
        raw: result.data,
      },
    ]);
    sendJson(response, 200, { ok: true, messageId: result.messageId });
    return true;
  }
  return false;
}

function dateFromPeriod(period) {
  const text = String(period || "").toLowerCase();
  const now = new Date();
  if (text.includes("24")) return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (text.includes("7")) return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (text.includes("30")) return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (text.includes("mes") || text.includes("mês")) return new Date(now.getFullYear(), now.getMonth(), 1);
  return null;
}

function inAnalyticsPeriod(event, period) {
  const start = dateFromPeriod(period);
  if (!start) return true;
  const date = new Date(event.createdAt || event.updatedAt || 0);
  return !Number.isNaN(date.getTime()) && date >= start;
}

function eventMatches(value, filter, allLabel) {
  const text = String(filter || "");
  const normalize = (item) =>
    String(item || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  return !text || normalize(text) === normalize(allLabel) || String(value || "") === text;
}

async function analyticsTransmissions(params = {}) {
  const events = await readBroadcastAnalyticsEvents();
  const optionEvents = events.filter((event) => inAnalyticsPeriod(event, params.period));
  const filtered = events.filter((event) =>
    inAnalyticsPeriod(event, params.period) &&
    eventMatches(event.bm, params.bm, "Todas as BMs") &&
    eventMatches(event.user, params.user, "Todos os usuários") &&
    eventMatches(`${event.sender}${event.phone ? ` - ${event.phone}` : ""}`, params.sender, "Todos os remetentes")
  );
  const groups = new Map();
  const reportGroups = new Map();
  for (const event of filtered) {
    const key = [event.bm, event.wabaId, event.user, event.sender, event.phone].map((value) => String(value || "").toLowerCase()).join("|");
    const current = groups.get(key) || {
      key,
      bm: event.bm || "BM não informada",
      wabaId: event.wabaId || "",
      user: event.user || "Admin",
      sender: event.sender || "Remetente",
      phone: event.phone || "",
      sent: 0,
      accepted: 0,
      delivered: 0,
      pending: 0,
      failed: 0,
      flows: 0,
      lots: new Set(),
      campaigns: new Set(),
      lastAt: "",
      messages: [],
    };
    const status = String(event.status || "");
    current.sent += 1;
    if (["accepted", "sent", "delivered", "read"].includes(status)) current.accepted += 1;
    if (["delivered", "read"].includes(status)) current.delivered += 1;
    if (status === "failed") current.failed += 1;
    if (!["delivered", "read", "failed"].includes(status)) current.pending += 1;
    if (String(event.mode || "").includes("flow")) current.flows += 1;
    if (event.lotId) current.lots.add(event.lotId);
    if (event.campaignName) current.campaigns.add(event.campaignName);
    current.lastAt = [current.lastAt, event.updatedAt || event.createdAt].filter(Boolean).sort().slice(-1)[0] || "";
    current.messages.push(event);
    groups.set(key, current);

    const reportKey = [
      event.campaignId || event.campaignName || event.broadcastId || "campaign",
      event.lotId || "lot",
      event.user || "Admin",
      event.bm || "",
      event.sender || "",
    ].map((value) => String(value || "").toLowerCase()).join("|");
    const report = reportGroups.get(reportKey) || {
      id: reportKey,
      campaignId: event.campaignId || "",
      campaignName: event.campaignName || "Campanha sem nome",
      lotId: event.lotId || "",
      bm: event.bm || "BM nao informada",
      wabaId: event.wabaId || "",
      user: event.user || "Admin",
      sender: event.sender || "Remetente",
      senderPhone: event.phone || "",
      createdAt: event.createdAt || event.updatedAt || new Date().toISOString(),
      totalSent: 0,
      accepted: 0,
      delivered: 0,
      failed: 0,
      pending: 0,
      phones: new Set(),
      errors: [],
    };
    const reportStatus = String(event.status || "");
    report.totalSent += 1;
    if (["accepted", "sent", "delivered", "read"].includes(reportStatus)) report.accepted += 1;
    if (["delivered", "read"].includes(reportStatus)) report.delivered += 1;
    if (reportStatus === "failed") report.failed += 1;
    if (!["delivered", "read", "failed"].includes(reportStatus)) report.pending += 1;
    if (event.recipient) report.phones.add(event.recipient);
    if (event.errorMessage) report.errors.push(event.errorMessage);
    report.createdAt = [report.createdAt, event.createdAt || event.updatedAt].filter(Boolean).sort()[0] || report.createdAt;
    reportGroups.set(reportKey, report);
  }
  const data = Array.from(groups.values()).map((group) => ({
    ...group,
    lots: group.lots.size || 1,
    campaigns: Array.from(group.campaigns),
    messages: group.messages.slice(-50),
  }));
  const reports = Array.from(reportGroups.values())
    .map((report) => ({
      ...report,
      phones: Array.from(report.phones),
      errors: Array.from(new Set(report.errors)).slice(0, 8),
    }))
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  return {
    ok: true,
    data,
    options: {
      bms: Array.from(new Set(optionEvents.map((event) => event.bm || "BM nao informada"))).filter(Boolean).sort(),
      senders: Array.from(new Set(optionEvents.map((event) => `${event.sender || "Remetente"}${event.phone ? ` - ${event.phone}` : ""}`))).filter(Boolean).sort(),
      users: Array.from(new Set(optionEvents.map((event) => event.user || "Admin"))).filter(Boolean).sort(),
    },
    totals: {
      sent: filtered.length,
      accepted: filtered.filter((event) => ["accepted", "sent", "delivered", "read"].includes(String(event.status || ""))).length,
      delivered: filtered.filter((event) => ["delivered", "read"].includes(String(event.status || ""))).length,
      failed: filtered.filter((event) => String(event.status || "") === "failed").length,
      pending: filtered.filter((event) => !["delivered", "read", "failed"].includes(String(event.status || ""))).length,
    },
    reports,
    events: filtered.slice(-500).reverse(),
  };
}

function mediaParameterFromTemplate(template) {
  const components = Array.isArray(template.components) ? template.components : [];
  const header = components.find((item) => String(item?.type || "").toUpperCase() === "HEADER");
  const headerFormat = String(header?.format || header?.type || "").toLowerCase();
  const legacyMediaType = String(template.mediaType || template.media_type || template.header_type || "").toLowerCase();
  const hasExplicitMediaHeader =
    ["image", "video", "document"].some((type) => headerFormat.includes(type)) ||
    (!components.length && ["image", "video", "document"].some((type) => legacyMediaType.includes(type)));
  if (!hasExplicitMediaHeader) return null;

  const media = asRecord(template.media);
  const url = String(media.url || "").trim();
  if (!url) return null;
  const rawType = String(media.type || headerFormat || legacyMediaType || "image").toLowerCase();
  const type = rawType.includes("video") ? "video" : rawType.includes("document") ? "document" : "image";
  return {
    type: "header",
    parameters: [
      {
        type,
        [type]: {
          link: url,
        },
      },
    ],
  };
}

function normalizeVariableKey(key) {
  const digits = onlyDigits(key);
  return digits ? `{{${Number(digits)}}}` : String(key || "").trim();
}

function extractVariablesFromText(text) {
  const matches = String(text || "").match(/\{\{\s*[\w.-]+\s*\}\}/g) || [];
  return Array.from(new Set(matches.map(normalizeVariableKey))).sort((left, right) => Number(onlyDigits(left)) - Number(onlyDigits(right)));
}

function componentText(template, type) {
  const components = Array.isArray(template.components) ? template.components : [];
  const component = components.find((item) => String(item?.type || "").toUpperCase() === type);
  return String(component?.text || "");
}

function templateBodyText(template) {
  return String(template.body_text || template.bodyText || template.text || template.message || componentText(template, "BODY") || "");
}

function templateHeaderText(template) {
  return String(template.header_text || template.headerText || componentText(template, "HEADER") || "");
}

function templateButtons(template) {
  if (Array.isArray(template.buttons)) return template.buttons;
  const components = Array.isArray(template.components) ? template.components : [];
  const buttonComponent = components.find((item) => String(item?.type || "").toUpperCase() === "BUTTONS");
  return Array.isArray(buttonComponent?.buttons) ? buttonComponent.buttons : [];
}

function variableValue(variables, key) {
  const normalized = normalizeVariableKey(key);
  return normalizeTemplateParameterText(
    variables[normalized] ??
      variables[normalized.replace(/[{}]/g, "")] ??
      variables[onlyDigits(normalized)] ??
      "",
  );
}

function normalizeTemplateParameterText(value) {
  return String(value || "")
    .replace(/\r\n|\r|\n|\u2028|\u2029/g, "\v")
    .replace(/\t+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

function buildCloudMessagePayload(recipient, lot) {
  const template = asRecord(lot.template);
  const variables = asRecord(recipient.variables || template.variables);
  const headerText = templateHeaderText(template);
  const headerVariables = extractVariablesFromText(headerText);
  const bodyVariables = extractVariablesFromText(templateBodyText(template));
  const headerParameters = headerVariables
    .map((variable) => variableValue(variables, variable))
    .map((text) => ({ type: "text", text }));
  const bodyParameters = bodyVariables
    .map((variable) => variableValue(variables, variable))
    .map((text) => ({ type: "text", text }));
  const components = [];
  const media = mediaParameterFromTemplate(template);
  if (media) components.push(media);
  if (!media && headerVariables.length) {
    components.push({
      type: "header",
      parameters: headerParameters,
    });
  }
  if (bodyVariables.length) {
    components.push({
      type: "body",
      parameters: bodyParameters,
    });
  }
  templateButtons(template).forEach((button, index) => {
    const buttonRecord = asRecord(button);
    const buttonType = String(buttonRecord.type || "").toUpperCase();
    const url = String(buttonRecord.url || "");
    const urlVariables = extractVariablesFromText(url);
    if (buttonType === "URL" && urlVariables.length) {
      components.push({
        type: "button",
        sub_type: "url",
        index: String(index),
        parameters: [
          {
            type: "text",
            text: variableValue(variables, urlVariables[0]),
          },
        ],
      });
    }
  });

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeBrazilPhone(recipient.phone || recipient.telefone || recipient.whatsapp),
    type: "template",
    template: {
      name: String(recipient.templateName || template.name || ""),
      language: {
        code: String(template.language || recipient.language || "pt_BR"),
      },
      ...(components.length ? { components } : {}),
    },
    _debug: {
      templateName: String(recipient.templateName || template.name || ""),
      language: String(template.language || recipient.language || "pt_BR"),
      headerText,
      bodyText: templateBodyText(template),
      headerVariables,
      bodyVariables,
      buttonCount: templateButtons(template).length,
      componentCount: components.length,
    },
  };
}

function metaErrorText(data, statusCode) {
  const error = asRecord(data.error);
  return [
    error.error_user_msg || error.message || data.message || `Meta HTTP ${statusCode}`,
    error.code ? `codigo ${error.code}` : "",
    error.error_subcode ? `subcodigo ${error.error_subcode}` : "",
    error.fbtrace_id ? `trace ${error.fbtrace_id}` : "",
  ].filter(Boolean).join(" | ");
}

async function sendCloudMessage(phoneNumberId, token, messagePayload) {
  const cleanPayload = { ...messagePayload };
  delete cleanPayload._debug;
  const upstream = await fetch(`${graphApiBase}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cleanPayload),
  });
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    throw new Error(metaErrorText(data, upstream.status));
  }
  const messageId = Array.isArray(data.messages) ? data.messages[0]?.id : "";
  if (!messageId) {
    throw new Error(`Meta nao retornou ID da mensagem. Resposta: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return { data, messageId };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultFlowRuntime() {
  return { sessions: {}, outboundIndex: {}, phoneIndex: {}, events: [] };
}

async function readFlowRuntime() {
  const stored = await getStoredValue(FLOW_RUNTIME_KEY);
  return {
    ...defaultFlowRuntime(),
    ...(stored && typeof stored === "object" ? stored : {}),
    sessions: asRecord(stored?.sessions),
    outboundIndex: asRecord(stored?.outboundIndex),
    phoneIndex: asRecord(stored?.phoneIndex),
    events: Array.isArray(stored?.events) ? stored.events : [],
  };
}

async function writeFlowRuntime(runtime) {
  await setStoredValue(FLOW_RUNTIME_KEY, {
    sessions: asRecord(runtime.sessions),
    outboundIndex: asRecord(runtime.outboundIndex),
    phoneIndex: asRecord(runtime.phoneIndex),
    events: Array.isArray(runtime.events) ? runtime.events.slice(-500) : [],
  });
}

function flowNodeData(node) {
  return asRecord(asRecord(node).data);
}

function flowNodes(flow) {
  return Array.isArray(asRecord(flow).nodes) ? asRecord(flow).nodes : [];
}

function flowEdges(flow) {
  return Array.isArray(asRecord(flow).edges) ? asRecord(flow).edges : [];
}

function findFlowNode(flow, nodeId) {
  return flowNodes(flow).find((node) => String(asRecord(node).id || "") === String(nodeId || ""));
}

function normalizeFlowReply(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function findNextFlowEdge(flow, sourceNodeId, replyText = "", replyId = "") {
  const edges = flowEdges(flow).filter((edge) => String(asRecord(edge).source || "") === String(sourceNodeId || ""));
  if (!edges.length) return null;
  const replyCandidates = Array.from(new Set([replyText, replyId].map(normalizeFlowReply).filter(Boolean)));
  if (replyCandidates.length) {
    const byHandleId = replyCandidates
      .map((candidate) => candidate.match(/(?:^|[_-])(?:button|btn)[_-]?(\d+)$/i)?.[1] ?? candidate.match(/_(\d+)$/)?.[1])
      .map((index) => (index === undefined ? -1 : Number(index)))
      .find((index) => Number.isInteger(index) && index >= 0);
    if (byHandleId !== undefined && byHandleId >= 0) {
      const byHandle = edges.find((edge) => String(asRecord(edge).sourceHandle || "") === `button-${byHandleId}`);
      if (byHandle) return byHandle;
    }
    const byLabel = edges.find((edge) => replyCandidates.includes(normalizeFlowReply(asRecord(edge).label)));
    if (byLabel) return byLabel;
    const sourceNode = findFlowNode(flow, sourceNodeId);
    const buttons = Array.isArray(flowNodeData(sourceNode).buttons) ? flowNodeData(sourceNode).buttons : [];
    const buttonIndex = buttons.findIndex((button) => replyCandidates.includes(normalizeFlowReply(button)));
    if (buttonIndex >= 0) {
      const handle = `button-${buttonIndex}`;
      const byHandle = edges.find((edge) => String(asRecord(edge).sourceHandle || "") === handle);
      if (byHandle) return byHandle;
    }
  }
  return edges[0] || null;
}

function flowEvent(session, message, type = "info") {
  return {
    at: new Date().toISOString(),
    type,
    sessionId: session.id,
    flowId: session.flowId,
    phone: session.phone,
    message,
  };
}

function outgoingText(text, session) {
  return String(text || "")
    .replace(/\{\{\s*nome\s*\}\}/gi, String(session.recipient?.name || ""))
    .replace(/\{\{\s*telefone\s*\}\}/gi, String(session.phone || ""));
}

function buildFlowNodePayload(node, session) {
  const data = flowNodeData(node);
  const kind = String(data.kind || "text");
  const body = outgoingText(data.body || data.subtitle || data.title || "", session);
  const mediaLink = String(data.imageUrl || data.mediaUrl || data.url || "").trim();
  const caption = outgoingText(data.caption || body, session);

  if (kind === "interactive") {
    const buttons = (Array.isArray(data.buttons) ? data.buttons : ["CLIQUE AQUI"]).slice(0, 3);
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: session.phone,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body || "Escolha uma opcao:" },
        action: {
          buttons: buttons.map((button, index) => ({
            type: "reply",
            reply: {
              id: `flow_${String(data.title || "node").replace(/\W+/g, "_").slice(0, 20)}_${index}`,
              title: String(button || `Opcao ${index + 1}`).slice(0, 20),
            },
          })),
        },
      },
    };
  }

  if (kind === "image" && mediaLink) {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: session.phone,
      type: "image",
      image: { link: mediaLink, ...(caption ? { caption } : {}) },
    };
  }

  if (kind === "video" && mediaLink) {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: session.phone,
      type: "video",
      video: { link: mediaLink, ...(caption ? { caption } : {}) },
    };
  }

  if (kind === "audio" && mediaLink) {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: session.phone,
      type: "audio",
      audio: { link: mediaLink },
    };
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: session.phone,
    type: "text",
    text: { preview_url: false, body: body || String(data.title || "Mensagem") },
  };
}

async function addToFlowBlacklist(phone) {
  const key = "movy.blacklist";
  const stored = await getStoredValue(key);
  const list = Array.isArray(stored) ? stored : [];
  const normalized = normalizeBrazilPhone(phone);
  if (normalized && !list.includes(normalized)) {
    list.push(normalized);
    await setStoredValue(key, list);
  }
}

async function advanceFlowSession(runtime, session, nextNodeId, reason = "", depth = 0) {
  if (!nextNodeId || depth > 12) {
    session.status = "done";
    session.currentNodeId = nextNodeId || session.currentNodeId;
    session.updatedAt = new Date().toISOString();
    runtime.events.push(flowEvent(session, "Fluxo finalizado.", "done"));
    return;
  }

  const node = findFlowNode(session.flow, nextNodeId);
  if (!node) {
    session.status = "failed";
    session.updatedAt = new Date().toISOString();
    runtime.events.push(flowEvent(session, `No ${nextNodeId} nao encontrado.`, "failed"));
    return;
  }

  const data = flowNodeData(node);
  const kind = String(data.kind || "text");
  session.currentNodeId = String(asRecord(node).id || nextNodeId);
  session.updatedAt = new Date().toISOString();

  if (kind === "delay") {
    const delayMs = Math.min(Math.max(Number(data.delayMs || 1000), 0), 120000);
    runtime.events.push(flowEvent(session, `Delay ${delayMs}ms iniciado${reason ? ` (${reason})` : ""}.`));
    await sleep(delayMs);
    const nextEdge = findNextFlowEdge(session.flow, session.currentNodeId);
    return advanceFlowSession(runtime, session, String(asRecord(nextEdge).target || ""), "delay concluido", depth + 1);
  }

  if (kind === "blacklist") {
    await addToFlowBlacklist(session.phone);
    session.status = "done";
    runtime.events.push(flowEvent(session, "Contato enviado para blacklist e fluxo finalizado.", "done"));
    return;
  }

  try {
    const payload = buildFlowNodePayload(node, session);
    const result = await sendCloudMessage(session.phoneNumberId, session.accessToken, payload);
    session.currentMessageId = result.messageId;
    session.outboundMessageIds = Array.from(new Set([...(session.outboundMessageIds || []), result.messageId]));
    runtime.outboundIndex[result.messageId] = session.id;
    const sessionSender = asRecord(session.sender);
    await appendBroadcastAnalyticsEvents([
      {
        id: result.messageId,
        messageId: result.messageId,
        broadcastId: session.broadcastId || session.flowId || session.id,
        campaignId: session.flowId || "",
        campaignName: session.flowName || "Fluxo",
        mode: "flow",
        channel: "whatsapp_cloud",
        bm: firstNonEmpty(sessionSender.bmName, sessionSender.businessName, sessionSender.bm, "BM nao informada"),
        wabaId: firstNonEmpty(sessionSender.wabaId, sessionSender.waba_id),
        user: firstNonEmpty(session.user, "Admin"),
        sender: firstNonEmpty(sessionSender.name, sessionSender.verifiedName, session.flowName, "Fluxo"),
        phone: firstNonEmpty(sessionSender.phone, sessionSender.phoneNumber, session.phoneNumberId),
        phoneNumberId: session.phoneNumberId || "",
        recipient: session.phone,
        templateId: "",
        templateName: String(data.title || kind),
        tagId: session.recipient?.tagId || "",
        tagName: session.recipient?.tagName || "",
        lotId: session.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        acceptedAt: new Date().toISOString(),
        deliveredAt: "",
        failedAt: "",
        readAt: "",
        status: "accepted",
        errorCode: "",
        errorMessage: "",
      },
    ]);
    runtime.events.push(flowEvent(session, `${String(data.title || kind)} enviado para ${session.phone}.`, "sent"));
  } catch (error) {
    session.status = "failed";
    runtime.events.push(flowEvent(session, `Falha ao enviar ${String(data.title || kind)}: ${error instanceof Error ? error.message : "erro desconhecido"}`, "failed"));
    return;
  }

  const hasButtonWait = kind === "interactive" || (Array.isArray(data.buttons) && data.buttons.length > 0);
  const nextEdge = findNextFlowEdge(session.flow, session.currentNodeId);
  if (hasButtonWait) {
    session.status = "waiting_reply";
    runtime.events.push(flowEvent(session, `Aguardando resposta em ${String(data.title || kind)}.`));
    return;
  }

  if (nextEdge) {
    return advanceFlowSession(runtime, session, String(asRecord(nextEdge).target || ""), "", depth + 1);
  }

  session.status = "done";
  runtime.events.push(flowEvent(session, "Fluxo finalizado.", "done"));
}

async function registerFlowSession(payload, recipient, lot, messageId) {
  const flow = asRecord(payload.flow);
  if (String(payload.mode || "") !== "flow" && !flow.nodes) return null;
  const phone = normalizeBrazilPhone(recipient.phone || recipient.telefone || recipient.whatsapp);
  if (!phone || !messageId) return null;
  const sessionId = `${String(payload.id || "flow")}:${phone}`;
  const lotSender = asRecord(asRecord(lot).sender);
  const payloadSender = asRecord(payload.sender);
  const sessionSender = Object.keys(lotSender).length ? lotSender : payloadSender;
  const session = {
    id: sessionId,
    broadcastId: String(payload.id || ""),
    flowId: String(flow.id || payload.id || ""),
    flowName: String(flow.name || payload.name || "Fluxo"),
    flow,
    phone,
    recipient: {
      id: recipient.id || "",
      name: recipient.name || recipient.nome || "",
      tagId: recipient.tagId || "",
      tagName: recipient.tagName || "",
    },
    currentNodeId: String(flow.startNodeId || "start"),
    currentMessageId: messageId,
    outboundMessageIds: [messageId],
    accessToken: String(recipient.accessToken || lotSender.accessToken || asRecord(payload.sender).accessToken || ""),
    phoneNumberId: String(recipient.phoneNumberId || lotSender.phoneNumberId || asRecord(payload.sender).phoneNumberId || ""),
    sender: {
      bmName: firstNonEmpty(sessionSender.bmName, sessionSender.businessName, sessionSender.bm_name, sessionSender.name),
      wabaId: firstNonEmpty(sessionSender.wabaId, sessionSender.waba_id),
      name: senderAnalyticsName(sessionSender, recipient.senderName),
      phone: firstNonEmpty(sessionSender.phoneNumber, sessionSender.phone, sessionSender.senderNumber, recipient.senderPhone),
      phoneNumberId: firstNonEmpty(recipient.phoneNumberId, sessionSender.phoneNumberId, payload.phoneNumberId),
    },
    user: firstNonEmpty(payload.createdBy, payload.user, payload.operator, "Admin"),
    status: "waiting_reply",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const runtime = await readFlowRuntime();
  runtime.sessions[sessionId] = session;
  runtime.outboundIndex[messageId] = sessionId;
  runtime.phoneIndex[phone] = sessionId;
  runtime.events.push(flowEvent(session, `Template inicial aceito pela Meta. Aguardando resposta de ${phone}.`, "accepted"));
  await writeFlowRuntime(runtime);
  return sessionId;
}

function normalizeIncomingMessages(payload) {
  const messages = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = asRecord(change?.value);
      const rawMessages = Array.isArray(value.messages) ? value.messages : [];
      for (const message of rawMessages) {
        const record = asRecord(message);
        const interactive = asRecord(record.interactive);
        const buttonReply = asRecord(interactive.button_reply);
        const listReply = asRecord(interactive.list_reply);
        const button = asRecord(record.button);
        const text = asRecord(record.text);
        const context = asRecord(record.context);
        const replyId = String(buttonReply.id || listReply.id || button.payload || button.id || "");
        const replyText = String(buttonReply.title || listReply.title || button.text || text.body || replyId || "");
        messages.push({
          id: String(record.id || ""),
          from: normalizeBrazilPhone(record.from || ""),
          timestamp: Number(record.timestamp || Math.floor(Date.now() / 1000)),
          contextId: String(context.id || ""),
          type: String(record.type || ""),
          text: replyText,
          replyId,
          raw: record,
        });
      }
    }
  }
  return messages.filter((message) => message.from || message.contextId);
}

async function processFlowIncomingMessages(messages) {
  if (!messages.length) return [];
  const runtime = await readFlowRuntime();
  const processed = [];
  for (const message of messages) {
    const sessionId = runtime.outboundIndex[message.contextId] || runtime.phoneIndex[message.from];
    const session = asRecord(runtime.sessions[sessionId]);
    if (!session.id) {
      runtime.events.push({
        at: new Date().toISOString(),
        type: "warning",
        sessionId: "",
        flowId: "",
        phone: message.from,
        message: `Resposta recebida, mas nenhuma sessao de fluxo foi encontrada. Contexto: ${message.contextId || "-"} | texto: ${message.text || message.replyId || "-"}`,
      });
      processed.push({ sessionId: "", routed: false, text: message.text, reason: "session-not-found" });
      continue;
    }
    if (session.processedInboundIds?.includes(message.id)) continue;
    session.processedInboundIds = Array.isArray(session.processedInboundIds) ? session.processedInboundIds : [];
    session.processedInboundIds.push(message.id);
    session.status = "routing";
    session.updatedAt = new Date().toISOString();
    runtime.events.push(flowEvent(session, `Resposta recebida: ${message.text || message.replyId || "(sem texto)"}`, "reply"));
    const edge = findNextFlowEdge(session.flow, session.currentNodeId, message.text, message.replyId);
    if (!edge) {
      session.status = "waiting_reply";
      runtime.events.push(flowEvent(session, `Nenhuma saida encontrada para "${message.text || message.replyId}".`, "warning"));
      runtime.sessions[session.id] = session;
      processed.push({ sessionId: session.id, routed: false, text: message.text, replyId: message.replyId });
      continue;
    }
    await advanceFlowSession(runtime, session, String(asRecord(edge).target || ""), `resposta ${message.text || message.replyId}`);
    runtime.sessions[session.id] = session;
    processed.push({ sessionId: session.id, routed: true, text: message.text, replyId: message.replyId, target: asRecord(edge).target });
  }
  await writeFlowRuntime(runtime);
  return processed;
}

async function dispatchBroadcast(request, response) {
  try {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body.toString("utf8") || "{}");
    const sender = asRecord(payload.sender);
    const runtimeCredentials = asRecord(payload.runtimeCredentials);
    const token = String(runtimeCredentials.accessToken || sender.accessToken || payload.accessToken || "").trim();
    const phoneNumberId = String(runtimeCredentials.phoneNumberId || sender.phoneNumberId || sender.defaultPhoneNumberId || "").trim();
    const lots = Array.isArray(payload.lots) ? payload.lots : [];
    const hasRecipientCredentials =
      Array.isArray(payload.recipients) &&
      payload.recipients.some((recipient) => {
        const record = asRecord(recipient);
        return String(record.accessToken || "").trim() && String(record.phoneNumberId || "").trim();
      });
    if ((!token || !phoneNumberId) && !hasRecipientCredentials) {
      sendJson(response, 400, {
        ok: false,
        error: "missing-cloud-credentials",
        message: "Remetente sem token ou Phone Number ID para disparar pela Cloud API.",
      });
      return;
    }

    const recipientRows = Array.isArray(payload.recipients)
      ? payload.recipients
      : lots.flatMap((lot) => {
          const lotRecord = asRecord(lot);
          const template = asRecord(lot.template);
          const lotSender = asRecord(lotRecord.sender);
          const recipients = Array.isArray(lot.recipients) ? lot.recipients : [];
          return recipients.map((recipient) => ({
            ...asRecord(recipient),
            lotId: lotRecord.id,
            senderId: lotSender.id,
            senderName: lotSender.name,
            phoneNumberId: lotSender.phoneNumberId,
            accessToken: lotSender.accessToken,
            templateId: template.id,
            templateName: template.name,
            variables: template.variables,
          }));
        });

    if (!recipientRows.length) {
      sendJson(response, 400, { ok: false, error: "empty-recipients", message: "Nenhum destinatario recebido no lote." });
      return;
    }

    const results = [];
    const messageIds = [];
    const debugMessages = [];
    const analyticsEvents = [];
    const conversationEvents = [];
    for (const recipient of recipientRows) {
      const recipientRecord = asRecord(recipient);
      const phone = normalizeBrazilPhone(recipientRecord.phone || recipientRecord.telefone || recipientRecord.whatsapp);
      const lot =
        lots.find((item) => String(asRecord(item).id || "") === String(recipientRecord.lotId || "")) ||
        lots.find((item) => String(asRecord(asRecord(item).sender).id || "") === String(recipientRecord.senderId || "") && String(asRecord(item.template).id || "") === String(recipientRecord.templateId || "")) ||
        lots.find((item) => String(asRecord(item.template).id || "") === String(recipientRecord.templateId || "")) ||
        lots.find((item) => String(asRecord(item.template).name || "") === String(recipientRecord.templateName || "")) ||
        lots[0] ||
        {};
      const lotSender = asRecord(asRecord(lot).sender);
      const rowToken = String(recipientRecord.accessToken || lotSender.accessToken || token).trim();
      const rowPhoneNumberId = String(recipientRecord.phoneNumberId || lotSender.phoneNumberId || phoneNumberId).trim();
      if (!phone) {
        analyticsEvents.push({
          ...broadcastAnalyticsContext(payload, recipientRecord, lot, "", ""),
          status: "failed",
          failedAt: new Date().toISOString(),
          errorMessage: "telefone invalido ou vazio",
        });
        results.push({ status: "failed", phone, errorMessage: "telefone invalido ou vazio" });
        continue;
      }
      if (!rowToken || !rowPhoneNumberId) {
        analyticsEvents.push({
          ...broadcastAnalyticsContext(payload, recipientRecord, lot, phone, ""),
          status: "failed",
          failedAt: new Date().toISOString(),
          errorMessage: "remetente sem token ou Phone Number ID",
        });
        results.push({ status: "failed", phone, errorMessage: "remetente sem token ou Phone Number ID" });
        continue;
      }
      try {
        const messagePayload = buildCloudMessagePayload({ ...recipientRecord, phone }, lot);
        const debugInfo = messagePayload._debug;
        const cleanMessagePayload = { ...messagePayload };
        delete cleanMessagePayload._debug;
        debugMessages.push({ phone, debug: debugInfo, payload: cleanMessagePayload });
        if (!messagePayload.template.name) throw new Error("template sem nome");
        const result = await sendCloudMessage(rowPhoneNumberId, rowToken, messagePayload);
        const flowSessionId = await registerFlowSession(payload, { ...recipientRecord, phone, accessToken: rowToken, phoneNumberId: rowPhoneNumberId }, lot, result.messageId);
        messageIds.push(result.messageId);
        const lotTemplate = asRecord(asRecord(lot).template);
        const outboundText = renderTemplateText(lotTemplate, asRecord(recipientRecord.variables || lotTemplate.variables));
        const senderName = senderAnalyticsName(lotSender, recipientRecord.senderName || senderAnalyticsName(sender));
        conversationEvents.push({
          id: result.messageId,
          messageId: result.messageId,
          provider: "meta",
          direction: "outbound",
          conversationId: conversationIdFor(phone, rowPhoneNumberId),
          contactPhone: phone,
          recipientPhone: phone,
          senderPhoneNumberId: rowPhoneNumberId,
          senderPhone: firstNonEmpty(lotSender.phoneNumber, lotSender.phone, sender.phoneNumber, sender.phone),
          senderName,
          text: outboundText || `Template ${messagePayload.template.name}`,
          type: "template",
          templateName: messagePayload.template.name,
          status: "accepted",
          campaignName: firstNonEmpty(asRecord(payload.campaign).name, payload.campaignName, payload.name),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          raw: result.data,
        });
        analyticsEvents.push({
          ...broadcastAnalyticsContext(payload, recipientRecord, lot, phone, result.messageId),
          status: "accepted",
          acceptedAt: new Date().toISOString(),
        });
        results.push({
          status: "accepted",
          phone,
          id: result.messageId,
          messageId: result.messageId,
          flowSessionId,
          templateName: messagePayload.template.name,
        });
      } catch (error) {
        const lastDebug = debugMessages[debugMessages.length - 1];
        analyticsEvents.push({
          ...broadcastAnalyticsContext(payload, recipientRecord, lot, phone, ""),
          status: "failed",
          failedAt: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : "erro desconhecido da Meta",
        });
        results.push({
          status: "failed",
          phone,
          templateName: String(recipientRecord.templateName || asRecord(asRecord(lot).template).name || ""),
          errorMessage: error instanceof Error ? error.message : "erro desconhecido da Meta",
          debug: lastDebug?.debug,
        });
      }
    }

    const accepted = results.filter((item) => item.status === "accepted").length;
    const failed = results.filter((item) => item.status === "failed").length;
    await appendBroadcastAnalyticsEvents(analyticsEvents);
    await appendConversationMessages(conversationEvents);
    lastBroadcastDebug = {
      at: new Date().toISOString(),
      phoneNumberId,
      total: results.length,
      accepted,
      failed,
      messages: debugMessages.slice(-20),
      results: results.slice(-20),
    };
    sendJson(response, 200, {
      ok: accepted > 0,
      id: payload.id,
      status: failed ? "partial" : "sent",
      total: results.length,
      accepted,
      failed,
      pending: accepted,
      messageIds,
      results,
      events: results.map((item) => ({
        type: item.status === "failed" ? "failed" : "success",
        phone: item.phone,
        message:
          item.status === "failed"
            ? `${item.phone || "destinatario"} falhou: ${item.errorMessage || "erro desconhecido"}${item.debug ? ` | body vars: ${item.debug.bodyVariables?.length || 0}, header vars: ${item.debug.headerVariables?.length || 0}, componentes: ${item.debug.componentCount || 0}` : ""}`
            : `${item.phone} aceito pela Meta | ${item.messageId}`,
      })),
    });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : "broadcast-dispatch-failed" });
  }
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function proxyCheckNumber(request, response, apiPath) {
  try {
    if (!checkNumberApiKey) {
      sendJson(response, 500, { ok: false, error: "CHECKNUMBER_API_KEY nao configurada no servidor" });
      return;
    }
    const body = await readRequestBody(request);
    const upstream = await fetch(`${checkNumberBaseUrl}${apiPath}`, {
      body,
      headers: {
        "X-API-Key": checkNumberApiKey,
        "Content-Type": request.headers["content-type"] || "application/octet-stream",
      },
      method: "POST",
    });
    const payload = await upstream.text();
    setCors(response);
    response.writeHead(upstream.status);
    response.end(payload);
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : "checknumber-proxy-failed" });
  }
}

async function proxyCheckNumberResult(request, response) {
  try {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const resultUrl = url.searchParams.get("url");
    if (!resultUrl || !/^https?:\/\//i.test(resultUrl)) {
      sendJson(response, 400, { ok: false, error: "invalid-result-url" });
      return;
    }

    const upstream = await fetch(resultUrl);
    const bytes = Buffer.from(await upstream.arrayBuffer());
    setCors(response, upstream.headers.get("content-type") || "application/octet-stream");
    response.setHeader("Content-Length", String(bytes.byteLength));
    response.writeHead(upstream.status);
    response.end(bytes);
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : "result-download-failed" });
  }
}

function safeFilename(filename) {
  return String(filename || "lista-tratada.csv")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "lista-tratada.csv";
}

function uploadExtension(contentType, fallbackName) {
  const byType = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "application/pdf": ".pdf",
  };
  if (byType[contentType]) return byType[contentType];
  const match = String(fallbackName || "").match(/\.[a-z0-9]{2,8}$/i);
  return match ? match[0].toLowerCase() : ".bin";
}

function safeUploadName(name) {
  return String(name || "midia")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "midia";
}

async function saveMediaUpload(request, response) {
  try {
    const body = await readRequestBody(request);
    const payload = JSON.parse(body.toString("utf8") || "{}");
    const filename = safeUploadName(payload.filename);
    const contentType = String(payload.contentType || "application/octet-stream").trim();
    const base64 = String(payload.base64 || "").replace(/^data:[^;]+;base64,/, "");
    if (!base64) {
      sendJson(response, 400, { ok: false, error: "missing-file-data" });
      return;
    }

    const bytes = Buffer.from(base64, "base64");
    if (!bytes.byteLength) {
      sendJson(response, 400, { ok: false, error: "empty-file" });
      return;
    }
    if (bytes.byteLength > 32 * 1024 * 1024) {
      sendJson(response, 413, { ok: false, error: "file-too-large", message: "Arquivo acima do limite de 32MB." });
      return;
    }

    await mkdir(uploadsDir, { recursive: true });
    const extension = uploadExtension(contentType, filename);
    const storedName = `${Date.now()}-${Math.random().toString(16).slice(2)}-${filename.replace(/\.[a-z0-9]{2,8}$/i, "")}${extension}`;
    const target = join(uploadsDir, storedName);
    await writeFile(target, bytes);
    sendJson(response, 200, {
      ok: true,
      filename: storedName,
      path: `/media/files/${encodeURIComponent(storedName)}`,
      type: contentType,
      size: bytes.byteLength,
    });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : "media-upload-failed" });
  }
}

async function serveMediaFile(request, response) {
  try {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const filename = safeUploadName(decodeURIComponent(url.pathname.replace(/^\/media\/files\//, "")));
    if (!filename) {
      sendJson(response, 400, { ok: false, error: "invalid-media-file" });
      return;
    }
    const filePath = join(uploadsDir, filename);
    const bytes = await readFile(filePath);
    const extension = filename.split(".").pop()?.toLowerCase();
    const contentType =
      extension === "jpg" || extension === "jpeg"
        ? "image/jpeg"
        : extension === "png"
          ? "image/png"
          : extension === "webp"
            ? "image/webp"
            : extension === "gif"
              ? "image/gif"
              : extension === "mp4"
                ? "video/mp4"
                : extension === "webm"
                  ? "video/webm"
                  : extension === "ogg"
                    ? "audio/ogg"
                    : extension === "mp3"
                      ? "audio/mpeg"
                      : "application/octet-stream";
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(bytes.byteLength),
      "Content-Type": contentType,
    });
    response.end(bytes);
  } catch {
    sendJson(response, 404, { ok: false, error: "media-file-not-found" });
  }
}

createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === "POST" && request.url === "/checknumber/tasks") {
    await proxyCheckNumber(request, response, "/tasks");
    return;
  }

  if (request.method === "POST" && request.url === "/checknumber/gettasks") {
    await proxyCheckNumber(request, response, "/gettasks");
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/checknumber/result")) {
    await proxyCheckNumberResult(request, response);
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/broadcast/statuses")) {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const ids = (url.searchParams.get("ids") || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const statuses = ids.length
      ? ids.map((id) => whatsappStatuses.get(id)).filter(Boolean)
      : Array.from(whatsappStatuses.values()).slice(-200);
    sendJson(response, 200, { ok: true, statuses });
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/analytics/transmissions")) {
    try {
      const url = new URL(request.url || "", `http://${request.headers.host}`);
      const payload = await analyticsTransmissions({
        period: url.searchParams.get("period") || "",
        sender: url.searchParams.get("sender") || "",
        bm: url.searchParams.get("bm") || "",
        user: url.searchParams.get("user") || "",
      });
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : "analytics-read-failed" });
    }
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/flows/runs")) {
    try {
      const url = new URL(request.url || "", `http://${request.headers.host}`);
      const messageIds = (url.searchParams.get("messageIds") || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const runtime = await readFlowRuntime();
      const sessionIds = messageIds.length
        ? Array.from(new Set(messageIds.map((id) => runtime.outboundIndex[id]).filter(Boolean)))
        : Object.keys(runtime.sessions).slice(-100);
      const sessions = sessionIds.map((id) => runtime.sessions[id]).filter(Boolean);
      const eventSessionIds = new Set(sessionIds);
      const events = (runtime.events || [])
        .filter((event) => !eventSessionIds.size || eventSessionIds.has(event.sessionId))
        .slice(-100)
        .reverse();
      sendJson(response, 200, { ok: true, sessions, events });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : "flow-runtime-read-failed" });
    }
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/broadcast/debug-last")) {
    sendJson(response, 200, { ok: true, debug: lastBroadcastDebug });
    return;
  }

  if (request.url?.startsWith("/infobip/")) {
    if (await handleInfobipApis(request, response)) return;
  }

  if (request.url?.startsWith("/sms24h/")) {
    await handleSms24h(request, response);
    return;
  }

  if (request.url?.startsWith("/sisbratel/")) {
    await handleSisbratel(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/media/upload") {
    await saveMediaUpload(request, response);
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/media/files/")) {
    await serveMediaFile(request, response);
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/storage/")) {
    try {
      const url = new URL(request.url || "", `http://${request.headers.host}`);
      const key = safeStorageKey(decodeURIComponent(url.pathname.replace(/^\/storage\//, "")));
      if (!key) {
        sendJson(response, 400, { ok: false, error: "invalid-storage-key" });
        return;
      }
      const value = await getStoredValue(key);
      sendJson(response, 200, { ok: true, key, value });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : "storage-read-failed" });
    }
    return;
  }

  if (request.method === "PUT" && request.url?.startsWith("/storage/")) {
    try {
      const url = new URL(request.url || "", `http://${request.headers.host}`);
      const key = safeStorageKey(decodeURIComponent(url.pathname.replace(/^\/storage\//, "")));
      if (!key) {
        sendJson(response, 400, { ok: false, error: "invalid-storage-key" });
        return;
      }
      const body = await readRequestBody(request);
      const payload = JSON.parse(body.toString("utf8") || "{}");
      await setStoredValue(key, payload.value ?? null);
      sendJson(response, 200, { ok: true, key });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : "storage-write-failed" });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/broadcasts/dispatch") {
    await dispatchBroadcast(request, response);
    return;
  }

  if (request.url?.startsWith("/conversations")) {
    if (await handleConversations(request, response)) return;
  }

  if (request.method === "GET" && request.url?.startsWith("/meta/webhook")) {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const challenge = url.searchParams.get("hub.challenge") || "";
    const token = url.searchParams.get("hub.verify_token") || "";
    if (metaWebhookVerifyToken && token !== metaWebhookVerifyToken) {
      sendJson(response, 403, { ok: false, error: "invalid-webhook-token" });
      return;
    }
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end(challenge || "ok");
    return;
  }

  if (request.method === "POST" && request.url?.startsWith("/meta/webhook")) {
    try {
      const body = await readRequestBody(request);
      const payload = JSON.parse(body.toString("utf8") || "{}");
      const statuses = collectWhatsAppStatuses(payload);
      await updateBroadcastAnalyticsStatuses(statuses);
      await updateConversationStatuses(statuses);
      const incomingMessages = normalizeIncomingMessages(payload);
      const conversationInbound = collectConversationInboundMessages(payload);
      await appendConversationMessages(conversationInbound);
      const flowRoutes = await processFlowIncomingMessages(incomingMessages);
      if (statuses.length) {
        console.log(
          `Webhook Meta recebeu ${statuses.length} status: ${statuses
            .map((item) => `${item.id}:${item.status}${item.errorCode ? `:${item.errorCode}` : ""}`)
            .join(", ")}`,
        );
      } else if (flowRoutes.length) {
        console.log(
          `Webhook Meta roteou ${flowRoutes.length} resposta(s) de fluxo: ${flowRoutes
            .map((item) => `${item.sessionId}:${item.routed ? "ok" : "sem-rota"}`)
            .join(", ")}`,
        );
      } else {
        console.log("Webhook Meta recebeu evento sem status de mensagem.");
      }
      sendJson(response, 200, { ok: true, received: statuses.length + incomingMessages.length, statuses, messages: incomingMessages.length, flowRoutes });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : "invalid-webhook-payload" });
    }
    return;
  }

  if (request.method !== "POST" || request.url !== "/save-csv") {
    sendJson(response, 404, { ok: false, error: "not-found" });
    return;
  }

  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
  });

  request.on("end", async () => {
    try {
      const payload = JSON.parse(body);
      const filename = safeFilename(payload.filename);
      const csv = String(payload.csv ?? "");
      const target = join(downloadsDir, filename);

      await mkdir(downloadsDir, { recursive: true });
      await writeFile(target, csv.replace(/^\ufeff/, ""), "utf8");
      sendJson(response, 200, { ok: true, path: target, bytes: Buffer.byteLength(csv.replace(/^\ufeff/, ""), "utf8") });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : "save-failed" });
    }
  });
}).listen(port, host, () => {
  console.log(`Scale API local save server running at http://${host}:${port}`);
});
