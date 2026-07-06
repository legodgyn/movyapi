import {
  AlertCircle,
  CheckCircle,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Image,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Shuffle,
  Sparkles,
  Video,
  X,
  Zap,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { config } from "../lib/config";
import { labelOf } from "../lib/format";
import { infobipApis, savedTemplates } from "../lib/services";
import type { InfobipApi, SavedTemplate } from "../lib/types";

type MediaType = "NONE" | "IMAGE" | "VIDEO";
type TemplateButton = { id: number; kind: "URL" | "QUICK_REPLY"; text: string; url?: string };
type SendResult = { name: string; status: "ok" | "error"; message: string };
type Tab = "create" | "sent" | "models";
type IntegratedInfobipSender = {
  id: string;
  apiId: string;
  apiName: string;
  sender: string;
  name: string;
  status: string;
};

const LOCAL_INFOBIP_MODELS_KEY = "movy.infobipTemplateModels";
const LOCAL_INFOBIP_SENT_KEY = "movy.infobipSentTemplates";
const LOCAL_INFOBIP_SENDERS_KEY = "movy.infobipSenders";
const INFOBIP_BATCH_DELAY_MS = 700;
const DEFAULT_TEMPLATE_MEDIA_BASE = `${config.publicAppUrl.replace(/\/$/, "")}/local-api/media/files`;
const DEFAULT_HEADER_IMAGE =
  import.meta.env.VITE_DEFAULT_TEMPLATE_IMAGE_URL ||
  `${DEFAULT_TEMPLATE_MEDIA_BASE}/movy-default-template-image.jpeg`;
const DEFAULT_HEADER_VIDEO =
  import.meta.env.VITE_DEFAULT_TEMPLATE_VIDEO_URL ||
  `${DEFAULT_TEMPLATE_MEDIA_BASE}/movy-default-template-video.mp4`;
const DEFAULT_BODY = `Olá, {{1}}!

Temos uma novidade: {{2}}
 
{{3}}

Para {{4}}, use o botão abaixo 👇`;

const variablePools = [
  [
    "André",
    "Estamos agendando a visita de um técnico para o endereço Rua 1 Quadra 1 Lote 1",
    "Horário: 20:00",
    "confirmar o horário 19:20",
  ],
  [
    "Beatriz",
    "Estamos agendando a visita de um técnico para o endereço Rua 4 Quadra 2 Lote 8",
    "Horário: 09:45",
    "confirmar o horário 09:15",
  ],
  [
    "Camila",
    "Estamos agendando a visita de um técnico para o endereço Rua 9 Quadra 6 Lote 12",
    "Horário: 14:40",
    "confirmar o horário 14:10",
  ],
  [
    "João",
    "Estamos agendando a visita de um técnico para o endereço Rua 25 Quadra 16 Lote 13",
    "Horário: 19:20",
    "confirmar o horário 18:55",
  ],
];

function normalizeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 512);
}

function batchTemplateName(baseName: string, index: number, total: number) {
  return total > 1 ? `${baseName}_${index}` : baseName;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function bodyVariables(text: string) {
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g) || [];
  const numbers = matches.map((item) => Number(item.replace(/[{}]/g, "").trim())).filter(Boolean);
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

function variableSequenceError(indexes: number[]) {
  const invalid = indexes.some((value, index) => value !== index + 1);
  if (!invalid) return "";
  return `As variáveis precisam seguir a ordem: ${indexes.map((_, index) => `{{${index + 1}}}`).join(", ")}.`;
}

function readLocalModels(): SavedTemplate[] {
  try {
    const items = JSON.parse(localStorage.getItem(LOCAL_INFOBIP_MODELS_KEY) || "[]") as SavedTemplate[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeLocalModels(items: SavedTemplate[]) {
  localStorage.setItem(LOCAL_INFOBIP_MODELS_KEY, JSON.stringify(items));
}

function readLocalSent(): SavedTemplate[] {
  try {
    const items = JSON.parse(localStorage.getItem(LOCAL_INFOBIP_SENT_KEY) || "[]") as SavedTemplate[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeLocalSent(items: SavedTemplate[]) {
  localStorage.setItem(LOCAL_INFOBIP_SENT_KEY, JSON.stringify(items));
}

function readIntegratedSenders(): IntegratedInfobipSender[] {
  try {
    const items = JSON.parse(localStorage.getItem(LOCAL_INFOBIP_SENDERS_KEY) || "[]") as IntegratedInfobipSender[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function apiSender(api?: InfobipApi) {
  return String(api?.sender_number || api?.senderNumber || api?.phone_number || "");
}

function apiBaseUrl(api?: InfobipApi) {
  return String(api?.base_url || api?.baseUrl || api?.url || "");
}

function apiToken(api?: InfobipApi) {
  return String(api?.token || api?.api_key || api?.apiKey || api?.authorization || "");
}

function isInfobipApi(api: InfobipApi) {
  const type = String(api.api_type || api.provider || "").toLowerCase();
  return !type || type.includes("infobip") || type.includes("whatsapp");
}

function isInfobipTemplate(template: SavedTemplate) {
  const folder = String(template.folder || "").toLowerCase();
  const provider = String(template.provider || template.source || "").toLowerCase();
  return folder.includes("infobip") || provider.includes("infobip");
}

function resultMessage(error: unknown) {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const response = record.response as Record<string, unknown> | undefined;
    const data = response?.data as Record<string, unknown> | undefined;
    return String(data?.message || data?.error || record.message || "Falha ao criar template na Infobip.");
  }
  return "Falha ao criar template na Infobip.";
}

export function TemplateCreator() {
  const [tab, setTab] = useState<Tab>("create");
  const [apis, setApis] = useState<InfobipApi[]>([]);
  const [remoteTemplates, setRemoteTemplates] = useState<SavedTemplate[]>([]);
  const [models, setModels] = useState<SavedTemplate[]>([]);
  const [sentTemplates, setSentTemplates] = useState<SavedTemplate[]>([]);
  const [integratedSenders, setIntegratedSenders] = useState<IntegratedInfobipSender[]>([]);
  const [apiId, setApiId] = useState("");
  const [senderId, setSenderId] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("UTILITY");
  const [language, setLanguage] = useState("pt_BR");
  const [mediaType, setMediaType] = useState<MediaType>("IMAGE");
  const [body, setBody] = useState(DEFAULT_BODY);
  const [footer, setFooter] = useState('Digite "sair" para não receber mais mensagens.');
  const [variables, setVariables] = useState<Record<number, string>>({ 1: variablePools[0][0], 2: variablePools[0][1], 3: variablePools[0][2], 4: variablePools[0][3] });
  const [buttons, setButtons] = useState<TemplateButton[]>([{ id: 1, kind: "URL", text: "CLIQUE AQUI", url: "https://movyapi.com.br" }]);
  const [mediaUrl, setMediaUrl] = useState(DEFAULT_HEADER_IMAGE);
  const [quantity, setQuantity] = useState(1);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sendOpen, setSendOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[]>([]);

  const selectedApi = useMemo(() => apis.find((api) => api.id === apiId), [apiId, apis]);
  const apiSenders = useMemo(() => {
    const integrated = integratedSenders.filter((sender) => sender.apiId === apiId);
    if (integrated.length) return integrated;
    const fallback = apiSender(selectedApi);
    return fallback && selectedApi
      ? [{ id: `${selectedApi.id}:${fallback}`, apiId: selectedApi.id, apiName: labelOf(selectedApi, "Infobip"), sender: fallback, name: String(selectedApi.sender_name || selectedApi.senderName || fallback), status: "configurado" }]
      : [];
  }, [apiId, integratedSenders, selectedApi]);
  const selectedSender = useMemo(() => apiSenders.find((sender) => sender.id === senderId) || apiSenders[0], [apiSenders, senderId]);
  const selectedSenderNumber = selectedSender?.sender || apiSender(selectedApi);
  const variableIndexes = useMemo(() => bodyVariables(body), [body]);
  const sequenceError = useMemo(() => variableSequenceError(variableIndexes), [variableIndexes]);
  const canSend = Boolean(apiId && selectedSenderNumber && normalizeName(name) && !sequenceError && variableIndexes.every((index) => variables[index]?.trim()));
  const generatedTemplateNames = useMemo(() => {
    const baseName = normalizeName(name);
    if (!baseName) return [];
    return Array.from({ length: Math.min(quantity, 6) }, (_, index) => batchTemplateName(baseName, index + 1, quantity));
  }, [name, quantity]);
  const hiddenGeneratedTemplates = Math.max(0, quantity - generatedTemplateNames.length);

  const preview = useMemo(() => {
    return variableIndexes.reduce(
      (text, index) => text.split(`{{${index}}}`).join(variables[index] || `{{${index}}}`),
      body
    );
  }, [body, variableIndexes, variables]);

  const previewParagraphs = useMemo(
    () => preview.split(/\n+/).map((line) => line.trim()).filter(Boolean),
    [preview]
  );

  const filteredSentTemplates = useMemo(() => {
    const search = query.trim().toLowerCase();
    return sentTemplates.filter((template) => {
      const statusValue = String(template.infobip_status || template.status || "local").toLowerCase();
      const matchesStatus = statusFilter === "all" || statusValue === statusFilter;
      const haystack = `${template.name} ${template.category || ""} ${template.language || ""} ${template.api_name || ""}`.toLowerCase();
      return matchesStatus && (!search || haystack.includes(search));
    });
  }, [query, sentTemplates, statusFilter]);

  const sentSummary = useMemo(() => {
    const approved = sentTemplates.filter((item) => ["approved", "active", "ok"].includes(String(item.infobip_status || item.status || "").toLowerCase())).length;
    const failed = sentTemplates.filter((item) => ["error", "rejected", "failed"].includes(String(item.infobip_status || item.status || "").toLowerCase())).length;
    const pending = Math.max(0, sentTemplates.length - approved - failed);
    return { approved, failed, pending, total: sentTemplates.length };
  }, [sentTemplates]);

  async function load() {
    const [apiList, templateList] = await Promise.all([
      infobipApis.normalizedList().catch(() => []),
      savedTemplates.normalizedList().catch(() => []),
    ]);
    const normalizedApis = apiList.filter(isInfobipApi);
    const localModels = readLocalModels();
    const localSent = readLocalSent();
    const remoteInfobipTemplates = templateList.filter(isInfobipTemplate);

    setApis(normalizedApis);
    setIntegratedSenders(readIntegratedSenders());
    setRemoteTemplates(remoteInfobipTemplates);
    setModels([...localModels, ...remoteInfobipTemplates.filter((item) => String(item.folder || "").toLowerCase().includes("modelo"))]);
    setSentTemplates([...localSent, ...remoteInfobipTemplates.filter((item) => !String(item.folder || "").toLowerCase().includes("modelo"))]);
    setApiId((current) => current || normalizedApis[0]?.id || "");
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const next: Record<number, string> = {};
    variableIndexes.forEach((index) => {
      next[index] = variables[index] || variablePools[0][index - 1] || "";
    });
    setVariables(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variableIndexes.join(",")]);

  useEffect(() => {
    if (mediaType === "IMAGE") setMediaUrl(DEFAULT_HEADER_IMAGE);
    if (mediaType === "VIDEO") setMediaUrl(DEFAULT_HEADER_VIDEO);
    if (mediaType === "NONE") setMediaUrl("");
  }, [mediaType]);

  useEffect(() => {
    setSenderId((current) => (apiSenders.some((sender) => sender.id === current) ? current : apiSenders[0]?.id || ""));
  }, [apiSenders]);

  function shuffleVariables() {
    const current = variablePools.findIndex((pool) => variableIndexes.every((index) => pool[index - 1] === variables[index]));
    const pool = variablePools[(current + 1) % variablePools.length];
    setVariables(Object.fromEntries(variableIndexes.map((index) => [index, pool[index - 1] || ""])));
  }

  function applyTemplate(template: SavedTemplate) {
    setName(template.name || "");
    setMediaType((String(template.media_type || "NONE").toUpperCase() as MediaType) || "NONE");
    setBody(String(template.body_text || body));
    setFooter(String(template.footer_text || footer));
    setCategory(String(template.category || "UTILITY"));
    setLanguage(String(template.language || "pt_BR"));
    setVariables(Object.fromEntries((template.body_examples || []).map((value, index) => [index + 1, value])));
    setButtons(
      template.buttons?.length
        ? template.buttons.map((button, index) => ({
            id: index + 1,
            kind: String(button.type || "URL").toUpperCase() === "QUICK_REPLY" ? "QUICK_REPLY" : "URL",
            text: button.text || "CLIQUE AQUI",
            url: button.url || "",
          }))
        : buttons
    );
    setTab("create");
    setStatus(`Modelo ${template.name} carregado.`);
  }

  async function saveModel() {
    const model: SavedTemplate = {
      id: crypto.randomUUID(),
      name: normalizeName(name) || "modelo_infobip",
      folder: "Infobip Modelos",
      provider: "infobip",
      media_type: mediaType,
      media_url: mediaUrl,
      body_text: body,
      footer_text: footer,
      body_examples: variableIndexes.map((index) => variables[index] || ""),
      variable_count: variableIndexes.length,
      buttons,
      language,
      category,
      api_id: apiId,
      api_name: selectedApi ? labelOf(selectedApi, "Infobip") : "",
      sender_number: selectedSenderNumber,
      sender_name: selectedSender?.name || "",
      saved_at: new Date().toISOString(),
    };
    const next = [model, ...models.filter((item) => item.name !== model.name)];
    writeLocalModels(next);
    setModels(next);
    setStatus("Modelo salvo.");
    try {
      await savedTemplates.save(model);
    } catch {
      setStatus("Modelo salvo localmente. A API remota não confirmou o salvamento.");
    }
  }

  async function sendToInfobip() {
    if (!canSend || !selectedApi) return;
    setSending(true);
    setResults([]);
    setStatus("Enviando templates para a Infobip...");
    const baseName = normalizeName(name);
    const nextResults: SendResult[] = [];
    const createdTemplates: SavedTemplate[] = [];

    for (let index = 1; index <= quantity; index += 1) {
      if (index > 1) await wait(INFOBIP_BATCH_DELAY_MS);
      const templateName = batchTemplateName(baseName, index, quantity);
      const payload = {
        name: templateName,
        provider: "infobip",
        language,
        category,
        bodyText: body,
        bodyExamples: variableIndexes.map((variableIndex) => variables[variableIndex] || ""),
        footerText: footer,
        mediaType,
        mediaUrl,
        buttons: buttons.map((button) => ({
          type: button.kind,
          text: button.text,
          url: button.kind === "URL" ? button.url || "https://movyapi.com.br" : undefined,
        })),
        api: {
          id: selectedApi.id,
          name: labelOf(selectedApi, "Infobip"),
          baseUrl: apiBaseUrl(selectedApi),
          senderNumber: selectedSenderNumber,
          senderName: selectedSender?.name || "",
        },
      };

      try {
        const response = await savedTemplates.createRemote(selectedApi.id, selectedSenderNumber, payload);
        const statusValue = String((response as Record<string, unknown>)?.status || "pending");
        nextResults.unshift({ name: templateName, status: "ok", message: `Enviado para Infobip: ${statusValue}` });
        createdTemplates.unshift({
          id: String((response as Record<string, unknown>)?.id || crypto.randomUUID()),
          name: templateName,
          folder: "Infobip Enviados",
          provider: "infobip",
          media_type: mediaType,
          media_url: mediaUrl,
          body_text: body,
          footer_text: footer,
          body_examples: variableIndexes.map((variableIndex) => variables[variableIndex] || ""),
          variable_count: variableIndexes.length,
          buttons,
          language,
          category,
          api_id: selectedApi.id,
          api_name: labelOf(selectedApi, "Infobip"),
          sender_number: selectedSenderNumber,
          sender_name: selectedSender?.name || "",
          infobip_status: statusValue,
          remote_response: response,
          created_at: new Date().toISOString(),
        });
      } catch (error) {
        nextResults.unshift({ name: templateName, status: "error", message: resultMessage(error) });
      }
      setResults([...nextResults]);
    }

    if (createdTemplates.length) {
      const nextSent = [...createdTemplates, ...sentTemplates];
      writeLocalSent(nextSent);
      setSentTemplates(nextSent);
    }

    setSending(false);
    setStatus(nextResults.every((item) => item.status === "ok") ? "Templates enviados para a Infobip." : "Alguns templates falharam. Veja os detalhes no modal.");
  }

  const progress = results.length ? Math.round((results.length / quantity) * 100) : 0;
  const okCount = results.filter((item) => item.status === "ok").length;
  const errorCount = results.filter((item) => item.status === "error").length;
  const pendingCount = Math.max(0, quantity - results.length);

  return (
    <main className="page template-page infobip-template-page">
      <header className="template-heading">
        <div className="page-heading-icon">
          <Zap size={22} />
        </div>
        <div>
          <h1>Templates INFOBIP</h1>
          <p>Crie, salve e envie modelos pelo canal configurado em Gerenciar APIs.</p>
        </div>
      </header>

      <nav className="meta-template-tabs">
        <button className={tab === "create" ? "active" : ""} onClick={() => setTab("create")} type="button">
          <Sparkles size={16} /> Criar Template
        </button>
        <button className={tab === "sent" ? "active" : ""} onClick={() => setTab("sent")} type="button">
          <Send size={16} /> Templates Enviados <span>{sentTemplates.length}</span>
        </button>
        <button className={tab === "models" ? "active" : ""} onClick={() => setTab("models")} type="button">
          <FileText size={16} /> Modelos <span>{models.length}</span>
        </button>
      </nav>

      {tab === "create" ? (
        <div className="template-layout infobip-create-layout">
          <section className="card template-config infobip-template-config">
            <h2><span className="card-title-icon"><Sparkles size={17} /></span> Informações básicas</h2>
            <div className="grid cols-2">
              <div className="field">
                <label>API Infobip</label>
                <select className="select" value={apiId} onChange={(event) => setApiId(event.target.value)}>
                  <option value="">Selecione uma API</option>
                  {apis.map((api) => (
                    <option key={api.id} value={api.id}>
                      {labelOf(api, "Infobip")} {apiSender(api) ? `- ${apiSender(api)}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Remetente integrado</label>
                <select className="select" value={senderId} onChange={(event) => setSenderId(event.target.value)} disabled={!apiSenders.length}>
                  {!apiSenders.length ? <option value="">Integre um remetente em Gerenciar APIs</option> : null}
                  {apiSenders.map((sender) => (
                    <option key={sender.id} value={sender.id}>
                      {sender.name} {sender.sender ? `- ${sender.sender}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Nome do template</label>
                <input className="input" placeholder="ex: visita_tecnica" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="field">
                <label>Categoria</label>
                <select className="select" value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="UTILITY">Utilidade</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="AUTHENTICATION">Autenticação</option>
                </select>
              </div>
              <div className="field">
                <label>Idioma</label>
                <select className="select" value={language} onChange={(event) => setLanguage(event.target.value)}>
                  <option value="pt_BR">Português</option>
                  <option value="es">Espanhol</option>
                  <option value="en">Inglês</option>
                </select>
              </div>
            </div>

            {apis.length && !apiSenders.length ? (
              <div className="sent-access-alert">
                <AlertCircle size={18} />
                <div>
                  <strong>Nenhum remetente integrado nessa API.</strong>
                  <span>Sincronize a conexão Infobip e escolha quais remetentes entram no Movy.</span>
                  <Link className="button secondary compact" to="/admin/handle-manager">Integrar remetentes</Link>
                </div>
              </div>
            ) : null}

            <h2><span className="card-title-icon"><Image size={17} /></span> Header</h2>
            <div className="media-choice meta-media-choice">
              {(["NONE", "IMAGE", "VIDEO"] as MediaType[]).map((type) => (
                <button className={`media-card ${mediaType === type ? "active" : ""}`} key={type} onClick={() => setMediaType(type)} type="button">
                  <span className="media-icon-box">{type === "VIDEO" ? <Video size={20} /> : type === "IMAGE" ? <Image size={20} /> : <X size={20} />}</span>
                  <strong>{type === "NONE" ? "Nenhum" : type === "IMAGE" ? "Imagem" : "Vídeo"}</strong>
                  <small>{type === "NONE" ? "Só texto" : "Amostra pública"}</small>
                </button>
              ))}
            </div>
            {mediaType !== "NONE" ? (
              <div className="field">
                <label>URL da mídia</label>
                <input className="input" value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} />
              </div>
            ) : null}

            <div className="section-title-row">
              <span className="with-icon"><span className="section-icon"><Zap size={15} /></span> Conteúdo da mensagem</span>
            </div>
            <div className="field">
              <label>Texto do body</label>
              <textarea className="textarea template-body infobip-body" value={body} onChange={(event) => setBody(event.target.value)} />
              {sequenceError ? <p className="hint error-hint">{sequenceError}</p> : <p className="hint">Use variáveis em sequência: {"{{1}}, {{2}}, {{3}}"}</p>}
            </div>

            <div className="field">
              <div className="variables-header-row">
                <label>Exemplos das variáveis ({variableIndexes.length})</label>
                <button className="button secondary compact" type="button" onClick={shuffleVariables}>
                  <Shuffle size={15} /> Embaralhar
                </button>
              </div>
              <div className="variables-grid">
                {variableIndexes.map((index) => (
                  <div className="field" key={index}>
                    <label>{index} Campo</label>
                    <input
                      className="input"
                      value={variables[index] || ""}
                      onChange={(event) => setVariables((current) => ({ ...current, [index]: event.target.value }))}
                    />
                  </div>
                ))}
                {!variableIndexes.length ? <p className="hint">Nenhuma variável encontrada no body.</p> : null}
              </div>
            </div>

            <div className="field">
              <label>Footer</label>
              <input className="input" value={footer} onChange={(event) => setFooter(event.target.value)} />
            </div>

            <div className="meta-buttons-list">
              <div className="variables-header-row">
                <label>Botões</label>
                <button className="button secondary compact" type="button" onClick={() => setButtons((current) => [...current, { id: Date.now(), kind: "QUICK_REPLY", text: "Resposta" }])}>
                  <Plus size={15} /> Adicionar
                </button>
              </div>
              {buttons.map((button) => (
                <div className="panel meta-button-card" key={button.id}>
                  <div className="grid cols-3">
                    <select className="select" value={button.kind} onChange={(event) => setButtons((current) => current.map((item) => item.id === button.id ? { ...item, kind: event.target.value as TemplateButton["kind"] } : item))}>
                      <option value="URL">URL</option>
                      <option value="QUICK_REPLY">Resposta</option>
                    </select>
                    <input className="input" value={button.text} onChange={(event) => setButtons((current) => current.map((item) => item.id === button.id ? { ...item, text: event.target.value } : item))} />
                    <button className="button secondary" type="button" onClick={() => setButtons((current) => current.filter((item) => item.id !== button.id))}>Remover</button>
                  </div>
                  {button.kind === "URL" ? (
                    <input className="input" placeholder="https://..." value={button.url || ""} onChange={(event) => setButtons((current) => current.map((item) => item.id === button.id ? { ...item, url: event.target.value } : item))} />
                  ) : null}
                </div>
              ))}
            </div>

            <div className="button-row template-actions">
              <button className="button secondary" type="button" onClick={saveModel}><Save size={16} /> Salvar modelo</button>
              <button className="button create-template" disabled={!canSend} type="button" onClick={() => setSendOpen(true)}><Send size={16} /> Enviar para Infobip</button>
            </div>
            {status ? <p className="hint">{status}</p> : null}
          </section>

          <aside className="card template-preview-card infobip-template-preview-card">
            <h2><span className="card-title-icon"><Eye size={17} /></span> Preview WhatsApp</h2>
            <div className="whatsapp-preview">
              <div className="preview-label">Pré-visualização</div>
              {mediaType !== "NONE" ? (
                <div className="preview-media">
                  {mediaType === "IMAGE" ? <img alt="" src={mediaUrl} /> : <video muted poster={DEFAULT_HEADER_IMAGE} src={mediaUrl} />}
                  {mediaType === "VIDEO" ? <span className="play-circle"><Play size={30} /></span> : null}
                  <span>{mediaType === "VIDEO" ? "Vídeo" : "Imagem"}</span>
                </div>
              ) : null}
              <div className={`preview-message ${mediaType === "NONE" ? "rounded" : ""}`}>
                {previewParagraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                {footer ? <p className="preview-footer">{footer}</p> : null}
                <div className="preview-buttons">
                  {buttons.map((button) => (
                    <button key={button.id} type="button"><ExternalLink size={14} /> {button.text || "CLIQUE AQUI"}</button>
                  ))}
                </div>
                <span>12:00</span>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {tab === "sent" ? (
        <section className="sent-templates-page">
          <div className="sent-templates-toolbar">
            <div>
              <h2>Templates enviados para Infobip</h2>
              <p>Acompanhe o que foi criado por API, idioma e status sem sair da Movy Api.</p>
            </div>
            <button className="button secondary sent-refresh-button" type="button" onClick={load}><RefreshCw size={16} /> Atualizar</button>
          </div>
          <div className="sent-summary-grid">
            <div className="sent-summary-card total"><span>Total</span><strong>{sentSummary.total}</strong></div>
            <div className="sent-summary-card ok"><span>Aprovados/ativos</span><strong>{sentSummary.approved}</strong></div>
            <div className="sent-summary-card pending"><span>Pendentes</span><strong>{sentSummary.pending}</strong></div>
            <div className="sent-summary-card error"><span>Falhas</span><strong>{sentSummary.failed}</strong></div>
          </div>
          <div className="card sent-filter-panel">
            <div className="field sent-search-field">
              <label><Search size={14} /> Buscar</label>
              <input className="input" placeholder="Nome, API, idioma..." value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div className="field">
              <label>Status</label>
              <select className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">Todos</option>
                <option value="pending">Pendente</option>
                <option value="approved">Aprovado</option>
                <option value="active">Ativo</option>
                <option value="error">Erro</option>
              </select>
            </div>
          </div>
          <div className="sent-template-list">
            {filteredSentTemplates.map((template) => (
              <button className="sent-template-item" key={`${template.id}-${template.name}`} type="button" onClick={() => applyTemplate(template)}>
                <div>
                  <strong>{template.name}</strong>
                  <span>{String(template.api_name || template.folder || "Infobip")} • {template.language || "pt_BR"} • {template.category || "UTILITY"}</span>
                </div>
                <span className="status-pill">{String(template.infobip_status || template.status || "local")}</span>
              </button>
            ))}
            {!filteredSentTemplates.length ? <div className="empty-sent-state"><strong>Nenhum template encontrado.</strong><span>Envie um template para a Infobip ou atualize a lista.</span></div> : null}
          </div>
        </section>
      ) : null}

      {tab === "models" ? (
        <section className="sent-templates-page">
          <div className="sent-templates-toolbar">
            <div>
              <h2>Modelos salvos</h2>
              <p>Carregue um padrão pronto para ajustar e reenviar pela Infobip.</p>
            </div>
          </div>
          <div className="sent-template-list">
            {models.map((template) => (
              <button className="sent-template-item" key={`${template.id}-${template.name}`} type="button" onClick={() => applyTemplate(template)}>
                <div>
                  <strong>{template.name}</strong>
                  <span>{template.variable_count || template.body_examples?.length || 0} variáveis • {template.media_type || "NONE"}</span>
                </div>
                <span className="status-pill">Carregar</span>
              </button>
            ))}
            {!models.length ? <div className="empty-sent-state"><strong>Nenhum modelo salvo.</strong><span>Crie um template e clique em Salvar modelo.</span></div> : null}
          </div>
        </section>
      ) : null}

      {sendOpen ? (
        <div className="modal-backdrop">
          <section className="card meta-approval-modal infobip-approval-modal">
            <div className="meta-modal-header infobip-send-heading">
              <div>
                <h2><Send size={18} /> Enviar Template para Infobip</h2>
                <p>Confirme a API, remetente e quantidade antes de criar.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setSendOpen(false)}><X size={16} /></button>
            </div>
            <div className="infobip-send-body">
              <div className="infobip-send-setup">
              <div className="field">
                <label>API Infobip</label>
                <select className="select" value={apiId} onChange={(event) => setApiId(event.target.value)}>
                  {apis.map((api) => <option key={api.id} value={api.id}>{labelOf(api, "Infobip")}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Quantidade</label>
                <input className="input" max={50} min={1} type="number" value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} />
              </div>
              </div>
            <div className="approval-summary">
              <h3><FileText size={16} /> Resumo do Template</h3>
              <dl>
                <dt>Nome base</dt><dd>{normalizeName(name) || "-"}</dd>
                <dt>Remetente</dt><dd>{selectedSenderNumber || "não informado"}</dd>
                <dt>Base URL</dt><dd>{apiBaseUrl(selectedApi) || "não informada"}</dd>
                <dt>Token</dt><dd>{apiToken(selectedApi) ? "Configurado" : "não informado"}</dd>
                <dt>Categoria</dt><dd>{category}</dd>
                <dt>Idioma</dt><dd>{language}</dd>
              </dl>
              {generatedTemplateNames.length ? (
                <div className="infobip-name-preview" aria-label="Templates que serao criados">
                  {generatedTemplateNames.map((templateName) => <span key={templateName}>{templateName}</span>)}
                  {hiddenGeneratedTemplates ? <span>+{hiddenGeneratedTemplates}</span> : null}
                </div>
              ) : null}
            </div>
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={() => setSendOpen(false)}>Cancelar</button>
              <button className="button" disabled={!canSend || sending} type="button" onClick={sendToInfobip}>
                {sending ? <RefreshCw className="spin" size={16} /> : <Send size={16} />} Enviar para Infobip
              </button>
            </div>
            {results.length ? (
              <div className="meta-send-modal infobip-inline-progress">
                <div className="meta-send-header">
                  <span className="send-state-icon">{pendingCount ? <Clock size={22} /> : <CheckCircle size={22} />}</span>
                  <div>
                    <h2>{pendingCount ? "Enviando para Infobip" : "Envio concluído"}</h2>
                    <p>Acompanhe cada template criado na API.</p>
                  </div>
                </div>
                <div className="send-progress-ring" style={{ "--progress": `${progress}%` } as CSSProperties}>
                  <strong>{progress}%</strong>
                  <span>{results.length} de {quantity}</span>
                </div>
                <div className="send-stats-grid">
                  <div className="send-stat-card ok"><strong>{okCount}</strong><span>Enviados</span></div>
                  <div className="send-stat-card error"><strong>{errorCount}</strong><span>Falhas</span></div>
                  <div className="send-stat-card pending"><strong>{pendingCount}</strong><span>Restantes</span></div>
                </div>
                <div className="send-results-panel">
                  <div><h3>Últimos resultados</h3><span>{results.length} itens</span></div>
                  <div className="send-result-list">
                    {results.map((result) => (
                      <div className={`send-result-item ${result.status}`} key={result.name}>
                        {result.status === "ok" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                        <div><strong>{result.name}</strong><span>{result.message}</span></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
