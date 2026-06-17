import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
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
    await runSqlite([
      `insert into app_storage (key, value, updated_at) values (${sqlValue(key)}, ${sqlValue(JSON.stringify(value))}, ${sqlValue(new Date().toISOString())}) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at;`,
    ]);
    return;
  }

  const store = await readFileStorage();
  store[key] = value;
  await writeFileStorage(store);
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
  const normalized = String(value || "")
    .replace(/\v/g, "\n")
    .replace(/\r\n?/g, "\n")
    .replace(/\t+/g, " ")
    .replace(/ {5,}/g, "    ")
    .trim();
  return normalized.replace(/\n/g, "\v");
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
        results.push({ status: "failed", phone, errorMessage: "telefone invalido ou vazio" });
        continue;
      }
      if (!rowToken || !rowPhoneNumberId) {
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
        messageIds.push(result.messageId);
        results.push({
          status: "accepted",
          phone,
          id: result.messageId,
          messageId: result.messageId,
          templateName: messagePayload.template.name,
        });
      } catch (error) {
        const lastDebug = debugMessages[debugMessages.length - 1];
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

  if (request.method === "GET" && request.url?.startsWith("/broadcast/debug-last")) {
    sendJson(response, 200, { ok: true, debug: lastBroadcastDebug });
    return;
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
      if (statuses.length) {
        console.log(
          `Webhook Meta recebeu ${statuses.length} status: ${statuses
            .map((item) => `${item.id}:${item.status}${item.errorCode ? `:${item.errorCode}` : ""}`)
            .join(", ")}`,
        );
      } else {
        console.log("Webhook Meta recebeu evento sem status de mensagem.");
      }
      sendJson(response, 200, { ok: true, received: statuses.length, statuses });
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
