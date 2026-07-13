import { useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  Layers3,
  Megaphone,
  RefreshCcw,
  Search,
  Send,
  Smartphone,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";
import { broadcasts, contacts, infobipApis, savedTemplates } from "../lib/services";
import { config } from "../lib/config";
import { unwrapList } from "../lib/api";
import { labelOf } from "../lib/format";
import type { ContactItem, ContactTag, InfobipApi, SavedTemplate } from "../lib/types";

type StepKey = "sender" | "templates" | "tags" | "customize" | "dispatch";
type ViewMode = "dashboard" | "wizard";
type RunStatus = "idle" | "sending" | "done" | "failed";

type SenderOption = {
  id: string;
  apiId: string;
  apiName: string;
  name: string;
  phone: string;
  baseUrl: string;
  token: string;
  rawApi: InfobipApi;
  rawSender: Record<string, unknown>;
};

type Recipient = ContactItem & {
  phone: string;
  tagId: string;
  tagName: string;
};

type TemplateCustomization = {
  variables: Record<string, string>;
  mediaUrl: string;
};

type RunEvent = {
  id: string;
  type: "success" | "failed" | "info";
  message: string;
  time: string;
};

type TransmissionCampaign = {
  id: string;
  name: string;
  sender: string;
  templates: number;
  tags: number;
  total: number;
  accepted: number;
  delivered: number;
  failed: number;
  status: "draft" | "sending" | "done" | "failed";
  createdAt: string;
};

const CAMPAIGN_KEY = "movy.infobipTransmissions";
const LOCAL_INFOBIP_SENDERS_KEY = "movy.infobipSenders";
const LOCAL_INFOBIP_SENT_TEMPLATES_KEY = "movy.infobipSentTemplates";

const steps: Array<{ key: StepKey; title: string; subtitle: string }> = [
  { key: "sender", title: "Remetente", subtitle: "Canal Infobip" },
  { key: "templates", title: "Templates", subtitle: "Modelos enviados" },
  { key: "tags", title: "Etiquetas", subtitle: "Listas tratadas" },
  { key: "customize", title: "Variaveis", subtitle: "Conteudo do envio" },
  { key: "dispatch", title: "Disparo", subtitle: "Enviar agora" },
];

const defaultRun = {
  status: "idle" as RunStatus,
  accepted: 0,
  delivered: 0,
  failed: 0,
  pending: 0,
  total: 0,
  events: [] as RunEvent[],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
}

function onlyDigits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function formatPhone(value: unknown) {
  const digits = onlyDigits(value);
  if (!digits) return "";
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function nowTime() {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function localBackendUrl() {
  const isLocal =
    typeof window !== "undefined" &&
    /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
  if (isLocal) return config.localBackendUrl.replace(/\/$/, "");
  return (config.mediaBackendUrl || `${config.publicAppUrl.replace(/\/$/, "")}/local-api` || config.localBackendUrl).replace(/\/$/, "");
}

function localTags() {
  try {
    const store = JSON.parse(localStorage.getItem("scaleapi.localContacts") || "{}") as Record<string, { tag: ContactTag; contacts: ContactItem[] }>;
    return Object.values(store)
      .map((entry) => entry.tag)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readLocalTagContacts(tag: ContactTag): Recipient[] {
  try {
    const store = JSON.parse(localStorage.getItem("scaleapi.localContacts") || "{}") as Record<string, { tag: ContactTag; contacts: ContactItem[] }>;
    const entry = store[tag.id];
    if (!entry?.contacts?.length) return [];
    return entry.contacts
      .map((contact, index) => ({
        ...contact,
        id: contact.id || `${tag.id}-${index}`,
        phone: formatPhone(contact.phone || contact.telefone || contact.whatsapp || contact.numero || contact.celular),
        tagId: tag.id,
        tagName: tagName(tag),
      }))
      .filter((contact) => contact.phone);
  } catch {
    return [];
  }
}

async function fetchTagRecipients(tag: ContactTag): Promise<Recipient[]> {
  const local = readLocalTagContacts(tag);
  if (local.length) return local;

  const expected = Math.max(tagCount(tag), 1);
  const collected: ContactItem[] = [];
  const pageSize = 500;
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
      phone: formatPhone(contact.phone || contact.telefone || contact.whatsapp || contact.numero || contact.celular),
      tagId: tag.id,
      tagName: tagName(tag),
    }))
    .filter((contact) => contact.phone);
}

function tagName(tag: ContactTag) {
  return labelOf(tag, "") || String(tag.name || tag.id || "Etiqueta").replace(/^local-/, "");
}

function tagCount(tag: ContactTag) {
  return Number(tag.contacts_count || tag.count || tag.total || 0);
}

function templateText(template: SavedTemplate) {
  return String(template.body_text || template.bodyText || template.text || template.message || template.content || "");
}

function templateVariables(template: SavedTemplate) {
  const raw = [
    templateText(template),
    String(template.footer_text || ""),
    JSON.stringify(template.buttons || []),
  ].join(" ");
  const variables = (raw.match(/\{\{\s*[\w.-]+\s*\}\}/g) || [])
    .map((item) => item.replace(/[{}]/g, "").trim())
    .filter(Boolean);
  const count = Number(template.variable_count || 0);
  for (let index = 1; index <= count; index += 1) variables.push(String(index));
  return Array.from(new Set(variables)).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

function applyVariables(text: string, values: Record<string, string>) {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, variable: string) => values[variable] || `{{${variable}}}`);
}

function templateMediaType(template: SavedTemplate) {
  return String(template.media_type || template.header_type || template.type || "").toLowerCase();
}

function needsMedia(template: SavedTemplate) {
  return ["image", "video", "document"].some((type) => templateMediaType(template).includes(type));
}

function isInfobipApi(api: InfobipApi) {
  const type = String(api.api_type || api.provider || "").toLowerCase();
  return !type || type.includes("infobip") || type.includes("whatsapp");
}

function readIntegratedInfobipSenders() {
  try {
    const items = JSON.parse(localStorage.getItem(LOCAL_INFOBIP_SENDERS_KEY) || "[]") as Record<string, unknown>[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function readLocalInfobipTemplates() {
  try {
    const items = JSON.parse(localStorage.getItem(LOCAL_INFOBIP_SENT_TEMPLATES_KEY) || "[]") as SavedTemplate[];
    return Array.isArray(items) ? items.filter(isInfobipTemplate) : [];
  } catch {
    return [];
  }
}

function templateStatus(template: SavedTemplate) {
  return String(template.infobip_status || template.status || template.meta_status || "").trim().toUpperCase();
}

function isInfobipTemplate(template: SavedTemplate) {
  const folder = String(template.folder || "").toLowerCase();
  const provider = String(template.provider || "").toLowerCase();
  return provider.includes("infobip") || folder.includes("infobip") || Boolean(template.api_id || template.sender_number || template.infobip_status);
}

function isTemplateReady(template: SavedTemplate) {
  const status = templateStatus(template);
  return !status || ["APPROVED", "ACTIVE", "ENABLED", "PENDING"].includes(status);
}

function templateMatchesSender(template: SavedTemplate, sender?: SenderOption) {
  if (!sender) return true;
  const templateRecord = asRecord(template);
  const templateApi = pickString(templateRecord, ["api_id", "apiId", "api"]);
  const templateSender = formatPhone(pickString(templateRecord, ["sender_number", "senderNumber", "sender", "from", "phone", "phoneNumber"]));
  if (templateApi && templateApi !== sender.apiId) return false;
  if (templateSender && templateSender !== sender.phone) return false;
  return true;
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function senderLabel(sender: SenderOption) {
  return `${sender.name || sender.apiName || "Remetente"} - ${sender.phone}`;
}

function readCampaigns() {
  try {
    return JSON.parse(localStorage.getItem(CAMPAIGN_KEY) || "[]") as TransmissionCampaign[];
  } catch {
    return [];
  }
}

function saveCampaigns(campaigns: TransmissionCampaign[]) {
  localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(campaigns.slice(0, 50)));
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

function responseEvents(response: unknown): RunEvent[] {
  const record = asRecord(response);
  return arrayFromResponse(record, ["events", "logs", "results", "items"]).slice(0, 30).map((item) => {
    const itemRecord = asRecord(item);
    const status = String(itemRecord.status || itemRecord.type || "").toLowerCase();
    const failed = ["failed", "error", "rejected"].includes(status) || Boolean(itemRecord.error || itemRecord.errorMessage);
    const phone = String(itemRecord.phone || itemRecord.to || itemRecord.recipient || "");
    const message =
      itemRecord.message ||
      itemRecord.errorMessage ||
      itemRecord.error ||
      (phone ? `${phone} ${failed ? "falhou" : "aceito pela Infobip"}.` : "Evento retornado pelo sistema.");
    return {
      id: crypto.randomUUID(),
      type: failed ? "failed" : "success",
      message: String(message),
      time: nowTime(),
    };
  });
}

function formatBackendError(error: unknown) {
  if (error instanceof Error) return error.message;
  const record = asRecord(error);
  return String(record.message || record.error || "Erro desconhecido");
}

async function dispatchInfobip(payload: Record<string, unknown>) {
  try {
    const response = await fetch(`${localBackendUrl()}/broadcasts/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || asRecord(data).ok === false) {
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

  return broadcasts.dispatch(payload);
}

export function InfobipTransmissions() {
  const [view, setView] = useState<ViewMode>("dashboard");
  const [step, setStep] = useState<StepKey>("sender");
  const [senders, setSenders] = useState<SenderOption[]>([]);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [tags, setTags] = useState<ContactTag[]>([]);
  const [campaigns, setCampaigns] = useState<TransmissionCampaign[]>(() => readCampaigns());
  const [selectedSenderId, setSelectedSenderId] = useState("");
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [customizations, setCustomizations] = useState<Record<string, TemplateCustomization>>({});
  const [senderQuery, setSenderQuery] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [campaignQuery, setCampaignQuery] = useState("");
  const [campaignName, setCampaignName] = useState(`Infobip ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [run, setRun] = useState(defaultRun);

  useEffect(() => {
    void loadData();
  }, []);

  const activeIndex = steps.findIndex((item) => item.key === step);
  const selectedSender = senders.find((sender) => sender.id === selectedSenderId);
  const selectedTemplates = templateIds.map((id) => templates.find((template) => template.id === id)).filter(Boolean) as SavedTemplate[];
  const selectedTags = tagIds.map((id) => tags.find((tag) => tag.id === id)).filter(Boolean) as ContactTag[];
  const expectedMatch = selectedTemplates.length > 0 && selectedTemplates.length === selectedTags.length;
  const totalRecipients = selectedTags.reduce((sum, tag) => sum + tagCount(tag), 0);
  const currentTemplate = selectedTemplates[0];
  const currentPreviewText = currentTemplate
    ? applyVariables(templateText(currentTemplate), customizations[currentTemplate.id]?.variables || {})
    : "Selecione um template para visualizar.";

  const filteredSenders = useMemo(() => {
    const q = senderQuery.toLowerCase();
    return senders.filter((sender) => senderLabel(sender).toLowerCase().includes(q) || sender.apiName.toLowerCase().includes(q));
  }, [senders, senderQuery]);

  const filteredTemplates = useMemo(() => {
    const q = templateQuery.toLowerCase();
    return templates
      .filter((template) => templateMatchesSender(template, selectedSender))
      .filter((template) =>
        [template.name, templateText(template), templateStatus(template), template.sender_number, template.api_name]
          .map((value) => String(value || "").toLowerCase())
          .some((value) => value.includes(q)),
      );
  }, [templates, templateQuery, selectedSender]);

  const filteredTags = useMemo(() => {
    const q = tagQuery.toLowerCase();
    return tags.filter((tag) => [tagName(tag), tag.id].some((value) => String(value || "").toLowerCase().includes(q)));
  }, [tags, tagQuery]);

  const filteredCampaigns = useMemo(() => {
    const q = campaignQuery.toLowerCase();
    return campaigns.filter((campaign) => [campaign.name, campaign.sender, campaign.status].some((value) => value.toLowerCase().includes(q)));
  }, [campaigns, campaignQuery]);

  const dashboardTotals = campaigns.reduce(
    (acc, campaign) => ({
      delivered: acc.delivered + campaign.delivered,
      failed: acc.failed + campaign.failed,
      pending: acc.pending + Math.max(campaign.total - campaign.delivered - campaign.failed, 0),
      total: acc.total + campaign.total,
      lots: acc.lots + campaign.tags,
    }),
    { delivered: 0, failed: 0, pending: 0, total: 0, lots: 0 },
  );

  async function loadData() {
    setLoading(true);
    setStatus("");
    try {
      const [senderOptions, templateOptions, tagOptions] = await Promise.all([
        loadSenders(),
        loadTemplates(),
        loadTags(),
      ]);
      setSenders(senderOptions);
      setTemplates(templateOptions);
      setTags(tagOptions);
      if (!selectedSenderId && senderOptions[0]) setSelectedSenderId(senderOptions[0].id);
    } catch (error) {
      setStatus(formatBackendError(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setTemplateIds((current) => current.filter((id) => {
      const template = templates.find((item) => item.id === id);
      return template ? templateMatchesSender(template, selectedSender) : false;
    }));
  }, [selectedSenderId, selectedSender, templates]);

  async function loadSenders() {
    const apis = (await infobipApis.normalizedList().catch(() => [] as InfobipApi[])).filter(isInfobipApi);
    const localIntegrated = readIntegratedInfobipSenders();
    const options = (
      await Promise.all(
        apis.map(async (api) => {
          const apiRecord = asRecord(api);
          const apiId = String(api.id);
          const apiName = pickString(apiRecord, ["name", "label", "title"]) || `API ${apiId}`;
          const baseUrl = pickString(apiRecord, ["base_url", "baseUrl", "url", "base"]);
          const token = pickString(apiRecord, ["token", "apiKey", "api_key", "accessToken", "authorization"]);
          const integratedFromApi = Array.isArray(apiRecord.integrated_senders) ? (apiRecord.integrated_senders as Record<string, unknown>[]) : [];
          const integrated = [...localIntegrated, ...integratedFromApi].filter((sender) => String(sender.apiId || sender.api_id || "") === apiId);
          const rawSenders = uniqueBy(integrated, (sender) => {
            const senderRecord = asRecord(sender);
            return (
              pickString(senderRecord, ["id", "senderId", "sender_id", "sender", "sender_number", "senderNumber", "phone", "phoneNumber", "number"]) ||
              JSON.stringify(sender)
            );
          });

          return rawSenders
            .map((raw, index) => {
              const senderRecord = asRecord(raw);
              const phone = formatPhone(pickString(senderRecord, ["sender_number", "senderNumber", "phone", "phoneNumber", "number", "sender"]));
              const name = pickString(senderRecord, ["name", "senderName", "label", "displayName"]) || apiName;
              if (!phone) return null;
              return {
                id: `${apiId}:${phone}:${index}`,
                apiId,
                apiName,
                name,
                phone,
                baseUrl,
                token,
                rawApi: api,
                rawSender: senderRecord,
              } as SenderOption;
            })
            .filter(Boolean) as SenderOption[];
        }),
      )
    ).flat();

    return uniqueBy(options, (sender) => `${sender.apiId}:${sender.phone}`);
  }

  async function loadTemplates() {
    const sent = await savedTemplates.normalizedList("Infobip Enviados").catch(() => [] as SavedTemplate[]);
    const fallback = sent.length ? [] : await savedTemplates.normalizedList().catch(() => [] as SavedTemplate[]);
    const localSent = readLocalInfobipTemplates();
    return uniqueBy([...localSent, ...sent, ...fallback].filter(isInfobipTemplate).filter(isTemplateReady), (template) =>
      String(template.id || `${template.name}:${template.sender_number || ""}`),
    );
  }

  async function loadTags() {
    const remote = await contacts.normalizedTags().catch(() => [] as ContactTag[]);
    return uniqueBy([...remote, ...localTags()], (tag) => String(tag.id));
  }

  function resetWizard() {
    setStep("sender");
    setSelectedSenderId(senders[0]?.id || "");
    setTemplateIds([]);
    setTagIds([]);
    setCustomizations({});
    setRun(defaultRun);
    setStatus("");
    setCampaignName(`Infobip ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`);
    setView("wizard");
  }

  function toggleTemplate(templateId: string) {
    setTemplateIds((current) => (current.includes(templateId) ? current.filter((id) => id !== templateId) : [...current, templateId]));
  }

  function toggleTag(tagId: string) {
    setTagIds((current) => (current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]));
  }

  function updateVariable(templateId: string, variable: string, value: string) {
    setCustomizations((current) => ({
      ...current,
      [templateId]: {
        variables: {
          ...(current[templateId]?.variables || {}),
          [variable]: value,
        },
        mediaUrl: current[templateId]?.mediaUrl || "",
      },
    }));
  }

  function updateMedia(templateId: string, mediaUrl: string) {
    setCustomizations((current) => ({
      ...current,
      [templateId]: {
        variables: current[templateId]?.variables || {},
        mediaUrl,
      },
    }));
  }

  function canContinue() {
    if (step === "sender") return Boolean(selectedSender);
    if (step === "templates") return selectedTemplates.length > 0;
    if (step === "tags") return expectedMatch;
    if (step === "customize") return selectedTemplates.every((template) => {
      const values = customizations[template.id]?.variables || {};
      const hasVariables = templateVariables(template).every((variable) => String(values[variable] || "").trim());
      const hasMedia = !needsMedia(template) || Boolean(customizations[template.id]?.mediaUrl || template.media_url);
      return hasVariables && hasMedia;
    });
    return true;
  }

  function goNext() {
    const next = steps[activeIndex + 1];
    if (next && canContinue()) setStep(next.key);
  }

  function goBack() {
    if (activeIndex <= 0) {
      setView("dashboard");
      return;
    }
    setStep(steps[activeIndex - 1].key);
  }

  async function handleDispatch() {
    if (!selectedSender || !expectedMatch || run.status === "sending") return;
    setRun({ ...defaultRun, status: "sending", total: totalRecipients, pending: totalRecipients, events: [{ id: crypto.randomUUID(), type: "info", message: "Montando transmissao Infobip.", time: nowTime() }] });
    setStatus("");

    try {
      const pairs = selectedTemplates.map((template, index) => ({ template, tag: selectedTags[index] }));
      const recipientsByPair = await Promise.all(pairs.map(async (pair) => ({ ...pair, recipients: await fetchTagRecipients(pair.tag) })));
      const senderPayload = {
        id: selectedSender.id,
        provider: "infobip",
        apiType: "infobip",
        api_type: "whatsapp",
        apiId: selectedSender.apiId,
        api_id: selectedSender.apiId,
        apiName: selectedSender.apiName,
        api_name: selectedSender.apiName,
        name: selectedSender.name,
        label: senderLabel(selectedSender),
        senderName: selectedSender.name,
        sender_number: selectedSender.phone,
        senderNumber: selectedSender.phone,
        phone: selectedSender.phone,
        base_url: selectedSender.baseUrl,
        baseUrl: selectedSender.baseUrl,
        token: selectedSender.token,
      };

      const lots = recipientsByPair.map((pair, index) => {
        const customization = customizations[pair.template.id] || { variables: {}, mediaUrl: "" };
        return {
          id: `infobip-${Date.now()}-${index}`,
          provider: "infobip",
          sender: senderPayload,
          template: {
            ...pair.template,
            provider: "infobip",
            name: pair.template.name,
            body_text: templateText(pair.template),
            bodyText: templateText(pair.template),
            variables: customization.variables,
            media_url: customization.mediaUrl || pair.template.media_url || "",
          },
          tag: {
            id: pair.tag.id,
            name: tagName(pair.tag),
            count: pair.recipients.length,
          },
          audience: {
            tagId: pair.tag.id,
            tagName: tagName(pair.tag),
            contacts: pair.recipients.length,
          },
        };
      });

      const recipients = recipientsByPair.flatMap((pair, index) => {
        const lot = lots[index];
        const customization = customizations[pair.template.id] || { variables: {}, mediaUrl: "" };
        return pair.recipients.map((recipient) => ({
          ...recipient,
          lotId: lot.id,
          templateId: pair.template.id,
          templateName: pair.template.name,
          variables: customization.variables,
          provider: "infobip",
          apiId: selectedSender.apiId,
          api_id: selectedSender.apiId,
          baseUrl: selectedSender.baseUrl,
          base_url: selectedSender.baseUrl,
          token: selectedSender.token,
          senderNumber: selectedSender.phone,
          sender_number: selectedSender.phone,
          senderName: selectedSender.name,
        }));
      });

      if (!recipients.length) throw new Error("Nenhum contato encontrado nas etiquetas selecionadas.");

      const payload = {
        id: crypto.randomUUID(),
        provider: "infobip",
        channel: "infobip",
        mode: "infobip_transmission",
        status: "created",
        createdAt: new Date().toISOString(),
        campaignName,
        createdBy: "Admin",
        sender: senderPayload,
        campaign: {
          name: campaignName,
          type: "infobip",
          createdAt: new Date().toISOString(),
        },
        totals: {
          contacts: recipients.length,
          lots: lots.length,
        },
        lots,
        recipients,
      };

      const response = await dispatchInfobip(payload);
      const record = asRecord(response);
      const accepted = Number(record.accepted || asRecord(record.data).accepted || recipients.length);
      const failed = Number(record.failed || asRecord(record.data).failed || 0);
      const pending = Math.max(accepted - failed, 0);
      const events = responseEvents(response);
      const fallbackEvent: RunEvent = {
        id: crypto.randomUUID(),
        type: failed ? "failed" : "success",
        message: `${accepted} mensagem(ns) enviada(s) para a Infobip.`,
        time: nowTime(),
      };
      const nextRun = {
        status: failed > 0 ? "failed" as RunStatus : "done" as RunStatus,
        accepted,
        delivered: accepted - failed,
        failed,
        pending,
        total: recipients.length,
        events: events.length ? events : [fallbackEvent],
      };
      setRun(nextRun);

      const nextCampaign: TransmissionCampaign = {
        id: crypto.randomUUID(),
        name: campaignName,
        sender: senderLabel(selectedSender),
        templates: selectedTemplates.length,
        tags: selectedTags.length,
        total: recipients.length,
        accepted,
        delivered: nextRun.delivered,
        failed,
        status: failed > 0 ? "failed" : "done",
        createdAt: new Date().toISOString(),
      };
      const nextCampaigns = [nextCampaign, ...campaigns];
      setCampaigns(nextCampaigns);
      saveCampaigns(nextCampaigns);
    } catch (error) {
      setRun((current) => ({
        ...current,
        status: "failed",
        failed: current.total || 1,
        pending: 0,
        events: [
          { id: crypto.randomUUID(), type: "failed", message: formatBackendError(error), time: nowTime() },
          ...current.events,
        ],
      }));
      setStatus(formatBackendError(error));
    }
  }

  if (view === "dashboard") {
    return (
      <main className="infobip-transmission-page page-shell">
        <section className="page-hero compact-hero">
          <div>
            <span className="eyebrow">INFOBIP</span>
            <h1>Transmissoes Infobip</h1>
            <p>Gerencie lotes, use etiquetas tratadas e dispare modelos pelo canal Infobip.</p>
          </div>
          <div className="hero-actions">
            <button className="button secondary" type="button" onClick={() => void loadData()}>
              <RefreshCcw size={16} />
              Atualizar
            </button>
            <button className="button" type="button" onClick={resetWizard}>
              <Sparkles size={16} />
              Nova transmissao
            </button>
          </div>
        </section>

        <section className="infobip-kpis">
          <Metric label="Enviados" value={dashboardTotals.total} Icon={Send} />
          <Metric label="Entregues" value={dashboardTotals.delivered} Icon={CheckCircle2} tone="success" />
          <Metric label="Falhas" value={dashboardTotals.failed} Icon={XCircle} tone="danger" />
          <Metric label="Lotes" value={dashboardTotals.lots} Icon={Layers3} />
        </section>

        <section className="infobip-list-card">
          <div className="infobip-toolbar">
            <label className="search-field">
              <Search size={17} />
              <input value={campaignQuery} onChange={(event) => setCampaignQuery(event.target.value)} placeholder="Buscar transmissao..." />
            </label>
            <span>{filteredCampaigns.length} de {campaigns.length} transmissao(oes)</span>
          </div>
          <div className="infobip-table-head">
            <span>Nome</span>
            <span>Remetente</span>
            <span>Templates</span>
            <span>Etiquetas</span>
            <span>Status</span>
            <span>Criada em</span>
          </div>
          {filteredCampaigns.length ? (
            filteredCampaigns.map((campaign) => (
              <div className="infobip-table-row" key={campaign.id}>
                <strong>{campaign.name}</strong>
                <span>{campaign.sender}</span>
                <span>{campaign.templates}</span>
                <span>{campaign.tags}</span>
                <span className={`infobip-status ${campaign.status}`}>{campaign.status === "done" ? "Concluida" : campaign.status}</span>
                <span>{formatDate(campaign.createdAt)}</span>
              </div>
            ))
          ) : (
            <div className="infobip-empty">
              <Megaphone size={24} />
              <strong>Nenhuma transmissao ainda</strong>
              <p>Crie um lote escolhendo remetente, templates e as etiquetas vindas do Tratar Lista.</p>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="infobip-transmission-page page-shell">
      <section className="infobip-wizard-shell">
        <div className="infobip-wizard-head">
          <div>
            <h1><Megaphone size={18} /> Nova transmissao Infobip</h1>
            <p>Selecione remetente, templates e etiquetas. Cada etiqueta precisa ter um template correspondente.</p>
          </div>
          <button className="icon-button" type="button" onClick={() => setView("dashboard")} aria-label="Fechar">
            <XCircle size={18} />
          </button>
        </div>

        <div className="infobip-stepper">
          {steps.map((item, index) => (
            <button
              className={`infobip-step ${item.key === step ? "active" : ""} ${index < activeIndex ? "done" : ""}`}
              key={item.key}
              type="button"
              onClick={() => setStep(item.key)}
            >
              <span>{index < activeIndex ? <Check size={13} /> : index + 1}</span>
              <strong>{item.title}</strong>
              <small>{item.subtitle}</small>
            </button>
          ))}
        </div>

        <div className="infobip-step-body">
          {step === "sender" ? (
            <WizardSection icon={<Smartphone size={18} />} title="Escolha quem vai enviar" subtitle="Remetentes sincronizados em Gerenciar APIs.">
              <SearchBar value={senderQuery} onChange={setSenderQuery} placeholder="Buscar por nome, telefone ou API..." count={`${filteredSenders.length} remetente(s)`} />
              <div className="infobip-selection-list">
                {filteredSenders.map((sender) => (
                  <button className={`infobip-select-row ${selectedSenderId === sender.id ? "selected" : ""}`} key={sender.id} type="button" onClick={() => setSelectedSenderId(sender.id)}>
                    <span className="select-dot"><Smartphone size={15} /></span>
                    <strong>{senderLabel(sender)}</strong>
                    <small>{sender.apiName}</small>
                  </button>
                ))}
                {!filteredSenders.length ? <EmptyLine text={loading ? "Carregando remetentes..." : "Nenhum remetente Infobip encontrado."} /> : null}
              </div>
            </WizardSection>
          ) : null}

          {step === "templates" ? (
            <WizardSection icon={<Sparkles size={18} />} title="Selecione os templates" subtitle="Use a mesma quantidade de templates e etiquetas.">
              <SearchBar value={templateQuery} onChange={setTemplateQuery} placeholder="Buscar template por nome, conteudo ou status..." count={`${templateIds.length} selecionado(s) de ${filteredTemplates.length}`} />
              <div className="infobip-selection-list compact">
                {filteredTemplates.map((template) => (
                  <button className={`infobip-select-row ${templateIds.includes(template.id) ? "selected" : ""}`} key={template.id} type="button" onClick={() => toggleTemplate(template.id)}>
                    <span className="check-box">{templateIds.includes(template.id) ? <Check size={13} /> : null}</span>
                    <strong>{template.name}</strong>
                    <small>{templateText(template).slice(0, 120) || "Template sem corpo salvo"}</small>
                    <em>{templateStatus(template) || "Infobip"}</em>
                  </button>
                ))}
                {!filteredTemplates.length ? <EmptyLine text={loading ? "Carregando templates..." : "Nenhum template Infobip enviado encontrado."} /> : null}
              </div>
            </WizardSection>
          ) : null}

          {step === "tags" ? (
            <WizardSection icon={<Users size={18} />} title="Escolha as etiquetas tratadas" subtitle="A lista vem do Tratar Lista. Uma etiqueta para cada template.">
              <div className={`match-note ${expectedMatch ? "ok" : ""}`}>
                <strong>{selectedTemplates.length} template(s)</strong>
                <span>{selectedTags.length} etiqueta(s)</span>
                <small>{expectedMatch ? "Quantidade correta para criar a transmissao." : "Selecione exatamente a mesma quantidade dos dois lados."}</small>
              </div>
              <SearchBar value={tagQuery} onChange={setTagQuery} placeholder="Buscar etiqueta por nome ou prefixo..." count={`${tagIds.length} selecionada(s) de ${tags.length}`} />
              <div className="infobip-selection-list compact">
                {filteredTags.map((tag) => (
                  <button className={`infobip-select-row ${tagIds.includes(tag.id) ? "selected" : ""}`} key={tag.id} type="button" onClick={() => toggleTag(tag.id)}>
                    <span className="check-box">{tagIds.includes(tag.id) ? <Check size={13} /> : null}</span>
                    <strong>{tagName(tag)}</strong>
                    <small>{tagCount(tag).toLocaleString("pt-BR")} contato(s)</small>
                  </button>
                ))}
                {!filteredTags.length ? <EmptyLine text={loading ? "Carregando etiquetas..." : "Nenhuma etiqueta encontrada. Publique uma lista no Tratar Lista."} /> : null}
              </div>
            </WizardSection>
          ) : null}

          {step === "customize" ? (
            <div className="infobip-customize-grid">
              <section className="infobip-phone-card">
                <div className="phone-top" />
                <div className="phone-screen">
                  <span>Pre-visualizacao</span>
                  <div className="phone-message">
                    <p>{currentPreviewText}</p>
                    <small>Digite "sair" para nao receber mais mensagens.</small>
                  </div>
                </div>
              </section>

              <section className="infobip-custom-panel">
                <div className="custom-panel-head">
                  <div>
                    <h2>Personalize os templates</h2>
                    <p>Cada template selecionado tem suas variaveis e midia propria.</p>
                  </div>
                  <span>{selectedTemplates.length} template(s)</span>
                </div>

                {selectedTemplates.map((template, index) => {
                  const variables = templateVariables(template);
                  const customization = customizations[template.id] || { variables: {}, mediaUrl: "" };
                  return (
                    <div className="infobip-template-custom" key={template.id}>
                      <div className="template-custom-title">
                        <strong>{index + 1}. {template.name}</strong>
                        <small>{selectedTags[index] ? tagName(selectedTags[index]) : "Sem etiqueta vinculada"}</small>
                      </div>
                      <div className="template-variable-grid">
                        {variables.length ? variables.map((variable) => (
                          <label className="field" key={variable}>
                            <span>Variavel {`{{${variable}}}`}</span>
                            <textarea
                              className="input"
                              rows={2}
                              value={customization.variables[variable] || ""}
                              onChange={(event) => updateVariable(template.id, variable, event.target.value)}
                              placeholder={`Valor de {{${variable}}}`}
                            />
                          </label>
                        )) : <p className="muted">Este template nao possui variaveis.</p>}
                      </div>
                      {needsMedia(template) ? (
                        <label className="field">
                          <span>URL da midia</span>
                          <input
                            className="input"
                            value={customization.mediaUrl || String(template.media_url || "")}
                            onChange={(event) => updateMedia(template.id, event.target.value)}
                            placeholder="https://..."
                          />
                        </label>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            </div>
          ) : null}

          {step === "dispatch" ? (
            <WizardSection icon={<Send size={18} />} title="Disparo" subtitle="Revise e envie a transmissao para a Infobip.">
              <div className="dispatch-summary">
                <label className="field">
                  <span>Nome da transmissao</span>
                  <input className="input" value={campaignName} onChange={(event) => setCampaignName(event.target.value)} />
                </label>
                <div>
                  <span>Remetente</span>
                  <strong>{selectedSender ? senderLabel(selectedSender) : "-"}</strong>
                </div>
                <div>
                  <span>Templates x etiquetas</span>
                  <strong>{selectedTemplates.length} x {selectedTags.length}</strong>
                </div>
                <div>
                  <span>Total previsto</span>
                  <strong>{totalRecipients.toLocaleString("pt-BR")} contato(s)</strong>
                </div>
              </div>
              <div className="run-metrics">
                <Metric label="Aceitos" value={run.accepted} Icon={CheckCircle2} tone="success" />
                <Metric label="Pendentes" value={run.pending} Icon={Clock3} />
                <Metric label="Falhas" value={run.failed} Icon={XCircle} tone="danger" />
                <Metric label="Total" value={run.total} Icon={Users} />
              </div>
              <div className="run-progress-bar">
                <strong>{run.total ? Math.round(((run.accepted + run.failed) / run.total) * 100) : 0}%</strong>
                <span>{run.status === "sending" ? "Enviando" : run.status === "failed" ? "Com falhas" : run.status === "done" ? "Concluido" : "Aguardando"}</span>
                <div><i style={{ width: `${run.total ? Math.min(100, ((run.accepted + run.failed) / run.total) * 100) : 0}%` }} /></div>
              </div>
              <div className="live-events-card compact">
                <div className="live-events-head">
                  <strong>Atualizacoes</strong>
                  <span>{run.events.length} evento(s)</span>
                </div>
                {run.events.length ? (
                  run.events.map((event) => (
                    <div className={`run-event ${event.type}`} key={event.id}>
                      <span>{event.time}</span>
                      <p>{event.message}</p>
                    </div>
                  ))
                ) : (
                  <p className="muted">Clique em disparar para acompanhar o retorno da Infobip.</p>
                )}
              </div>
              {status ? <p className="list-status error">{status}</p> : null}
            </WizardSection>
          ) : null}
        </div>

        <div className="infobip-wizard-footer">
          <button className="button secondary" type="button" onClick={goBack}>
            <ArrowLeft size={16} />
            Voltar
          </button>
          {step === "dispatch" ? (
            <button className="button" type="button" disabled={!canContinue() || run.status === "sending"} onClick={handleDispatch}>
              <Send size={16} />
              {run.status === "sending" ? "Enviando..." : "Disparar agora"}
            </button>
          ) : (
            <button className="button" type="button" disabled={!canContinue()} onClick={goNext}>
              Continuar
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

function SearchBar(props: { value: string; onChange: (value: string) => void; placeholder: string; count: string }) {
  return (
    <div className="infobip-search-row">
      <label className="search-field">
        <Search size={17} />
        <input value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder={props.placeholder} />
      </label>
      <strong>{props.count}</strong>
    </div>
  );
}

function WizardSection(props: { icon: ReactNode; title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="infobip-section-card">
      <header>
        <span>{props.icon}</span>
        <div>
          <h2>{props.title}</h2>
          <p>{props.subtitle}</p>
        </div>
      </header>
      {props.children}
    </section>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="infobip-empty-line">
      <FileText size={18} />
      <span>{text}</span>
    </div>
  );
}

function Metric(props: { label: string; value: number; Icon: ComponentType<{ size?: number | string }>; tone?: "success" | "danger" }) {
  const { label, value, Icon, tone } = props;
  return (
    <div className={`infobip-metric ${tone || ""}`}>
      <Icon size={17} />
      <span>{label}</span>
      <strong>{value.toLocaleString("pt-BR")}</strong>
    </div>
  );
}
