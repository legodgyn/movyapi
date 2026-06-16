import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.SCALEAPI_SAVE_PORT ?? 5174);
const host = process.env.SCALEAPI_SAVE_HOST || "127.0.0.1";
const downloadsDir = join(homedir(), "Downloads");
const checkNumberApiKey = process.env.CHECKNUMBER_API_KEY || "";
const checkNumberBaseUrl = "https://api.checknumber.ai/v1";
const whatsappStatuses = new Map();
const graphApiBase = "https://graph.facebook.com/v24.0";
let lastBroadcastDebug = null;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function setCors(response, contentType = "application/json; charset=utf-8") {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type,x-api-key");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Content-Type", contentType);
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
  return String(
    variables[normalized] ??
      variables[normalized.replace(/[{}]/g, "")] ??
      variables[onlyDigits(normalized)] ??
      "",
  ).trim();
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
    if (!token || !phoneNumberId) {
      sendJson(response, 400, {
        ok: false,
        error: "missing-cloud-credentials",
        message: "Remetente sem token ou Phone Number ID para disparar pela Cloud API.",
      });
      return;
    }

    const lots = Array.isArray(payload.lots) ? payload.lots : [];
    const recipientRows = Array.isArray(payload.recipients)
      ? payload.recipients
      : lots.flatMap((lot) => {
          const template = asRecord(lot.template);
          const recipients = Array.isArray(lot.recipients) ? lot.recipients : [];
          return recipients.map((recipient) => ({
            ...asRecord(recipient),
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
        lots.find((item) => String(asRecord(item.template).id || "") === String(recipientRecord.templateId || "")) ||
        lots.find((item) => String(asRecord(item.template).name || "") === String(recipientRecord.templateName || "")) ||
        lots[0] ||
        {};
      if (!phone) {
        results.push({ status: "failed", phone, errorMessage: "telefone invalido ou vazio" });
        continue;
      }
      try {
        const messagePayload = buildCloudMessagePayload({ ...recipientRecord, phone }, lot);
        const debugInfo = messagePayload._debug;
        const cleanMessagePayload = { ...messagePayload };
        delete cleanMessagePayload._debug;
        debugMessages.push({ phone, debug: debugInfo, payload: cleanMessagePayload });
        if (!messagePayload.template.name) throw new Error("template sem nome");
        const result = await sendCloudMessage(phoneNumberId, token, messagePayload);
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

  if (request.method === "POST" && request.url === "/broadcasts/dispatch") {
    await dispatchBroadcast(request, response);
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/meta/webhook")) {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const challenge = url.searchParams.get("hub.challenge") || "";
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
