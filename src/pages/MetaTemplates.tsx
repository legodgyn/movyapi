import {
  AlertCircle,
  BarChart3,
  CheckCircle,
  Clock,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Image,
  MessageCircle,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Video,
  X,
  Zap,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { savedTemplates } from "../lib/services";

type MetaMediaType = "IMAGE" | "VIDEO" | "NONE";
type MetaCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";
type TemplateButton = {
  id: number;
  kind: "URL" | "QUICK_REPLY";
  text: string;
  url?: string;
};
type VariableExamples = Record<number, string>;

type BmSettingsData = {
  id?: string;
  businessName?: string;
  name?: string;
  appId?: string;
  appSecret?: string;
  accessToken?: string;
  defaultWabaId?: string;
  status?: string;
};

type CreateResult = {
  name: string;
  status: "ok" | "error";
  message: string;
};

type LocalMetaTemplateModel = {
  id: string;
  name: string;
  savedAt: string;
  mediaType: MetaMediaType;
  body: string;
  variables: VariableExamples | string[];
  footer: string;
  quantity: number;
  category: MetaCategory;
  language: string;
  buttons: TemplateButton[];
};

type MetaSentTemplate = {
  id: string;
  name: string;
  status: string;
  language?: string;
  category?: string;
  previous_category?: string;
  quality_score?: {
    score?: string;
    date?: number;
  };
  components?: Array<{
    type?: string;
    format?: string;
    text?: string;
    buttons?: Array<{ type?: string; text?: string; url?: string }>;
  }>;
  waba_id?: string;
  bm_id?: string;
  bm_name?: string;
  source?: "meta" | "local";
  updated_at?: string;
};

type TokenDiagnostic = {
  appId?: string;
  isValid?: boolean;
  scopes: string[];
  missing: string[];
  error?: string;
};

const LOCAL_BM_SETTINGS_KEY = "scaleapi.bmSettings";
const LOCAL_BM_ACCOUNTS_KEY = "scaleapi.bmAccounts";
const LOCAL_META_MODELS_KEY = "scaleapi.metaTemplateModels";
const LOCAL_META_SENT_TEMPLATES_KEY = "scaleapi.metaSentTemplatesCache";
const GRAPH_API_BASE = "https://graph.facebook.com/v24.0";
const DEFAULT_HEADER_IMAGE =
  import.meta.env.VITE_DEFAULT_TEMPLATE_IMAGE_URL ||
  "https://wdlbajwwnmfdyoenpqzy.supabase.co/storage/v1/object/public/site-assets/img.jpeg";
const DEFAULT_HEADER_VIDEO =
  import.meta.env.VITE_DEFAULT_TEMPLATE_VIDEO_URL ||
  "https://wdlbajwwnmfdyoenpqzy.supabase.co/storage/v1/object/public/site-assets/WhatsApp%20Video%202026-04-28%20at%2022.35.50.mp4";
const DEFAULT_HEADER_VIDEO_POSTER =
  import.meta.env.VITE_DEFAULT_TEMPLATE_VIDEO_POSTER_URL ||
  "https://wdlbajwwnmfdyoenpqzy.supabase.co/storage/v1/object/public/site-assets/img.jpeg";

const DEFAULT_TEMPLATE_BODY = `Ol\u00e1 {{1}}!

Temos uma novidade: {{2}}.

{{3}}

Para {{4}}, use o bot\u00e3o abaixo \ud83d\udc47`;

const visitVariablePools = [
  [
    "Andr\u00e9",
    "Estamos agendando a visita de um t\u00e9cnico para o endere\u00e7o Rua 1 Quadra 1 Lote 1",
    "Hor\u00e1rio: 20:00",
    "confirmar o hor\u00e1rio 19:20",
  ],
  [
    "Bruno",
    "Estamos agendando a visita de um t\u00e9cnico para o endere\u00e7o Rua 2 Quadra 3 Lote 4",
    "Hor\u00e1rio: 08:30",
    "confirmar o hor\u00e1rio 08:10",
  ],
  [
    "Camila",
    "Estamos agendando a visita de um t\u00e9cnico para o endere\u00e7o Rua 4 Quadra 2 Lote 8",
    "Hor\u00e1rio: 09:45",
    "confirmar o hor\u00e1rio 09:15",
  ],
  [
    "Daniel",
    "Estamos agendando a visita de um t\u00e9cnico para o endere\u00e7o Rua 7 Quadra 5 Lote 3",
    "Hor\u00e1rio: 10:20",
    "confirmar o hor\u00e1rio 10:00",
  ],
  [
    "Eduarda",
    "Estamos agendando a visita de um t\u00e9cnico para o endere\u00e7o Rua 9 Quadra 6 Lote 12",
    "Hor\u00e1rio: 11:50",
    "confirmar o hor\u00e1rio 11:30",
  ],
  [
    "Felipe",
    "Estamos agendando a visita de um t\u00e9cnico para o endere\u00e7o Rua 12 Quadra 8 Lote 5",
    "Hor\u00e1rio: 13:15",
    "confirmar o hor\u00e1rio 12:50",
  ],
  [
    "Gabriela",
    "Estamos agendando a visita de um t\u00e9cnico para o endere\u00e7o Rua 15 Quadra 10 Lote 7",
    "Hor\u00e1rio: 14:40",
    "confirmar o hor\u00e1rio 14:10",
  ],
  [
    "Henrique",
    "Estamos agendando a visita de um t\u00e9cnico para o endere\u00e7o Rua 18 Quadra 12 Lote 9",
    "Hor\u00e1rio: 16:00",
    "confirmar o hor\u00e1rio 15:35",
  ],
  [
    "Isabela",
    "Estamos agendando a visita de um t\u00e9cnico para o endere\u00e7o Rua 21 Quadra 14 Lote 11",
    "Hor\u00e1rio: 17:30",
    "confirmar o hor\u00e1rio 17:00",
  ],
  [
    "Jo\u00e3o",
    "Estamos agendando a visita de um t\u00e9cnico para o endere\u00e7o Rua 25 Quadra 16 Lote 13",
    "Hor\u00e1rio: 19:20",
    "confirmar o hor\u00e1rio 18:55",
  ],
];

function readBmSettings(): BmSettingsData {
  try {
    const accounts = JSON.parse(localStorage.getItem(LOCAL_BM_ACCOUNTS_KEY) || "[]") as BmSettingsData[];
    if (Array.isArray(accounts) && accounts.length) {
      return accounts.find((account) => account.status === "connected") || accounts[0] || {};
    }
    return JSON.parse(localStorage.getItem(LOCAL_BM_SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function readBmAccounts(): BmSettingsData[] {
  try {
    const accounts = JSON.parse(localStorage.getItem(LOCAL_BM_ACCOUNTS_KEY) || "[]") as BmSettingsData[];
    if (Array.isArray(accounts) && accounts.length) return accounts;
    const legacy = readBmSettings();
    return legacy.defaultWabaId ? [legacy] : [];
  } catch {
    return [];
  }
}

function readLocalMetaModels(): LocalMetaTemplateModel[] {
  try {
    const models = JSON.parse(localStorage.getItem(LOCAL_META_MODELS_KEY) || "[]") as LocalMetaTemplateModel[];
    return Array.isArray(models) ? models : [];
  } catch {
    return [];
  }
}

function writeLocalMetaModels(models: LocalMetaTemplateModel[]) {
  localStorage.setItem(LOCAL_META_MODELS_KEY, JSON.stringify(models));
}

function writeSentTemplatesCache(templates: MetaSentTemplate[]) {
  if (!templates.length) return;
  localStorage.setItem(LOCAL_META_SENT_TEMPLATES_KEY, JSON.stringify({
    savedAt: new Date().toISOString(),
    templates,
  }));
}

function readSentTemplatesCache(): MetaSentTemplate[] {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_META_SENT_TEMPLATES_KEY) || "{}") as { templates?: MetaSentTemplate[] };
    return Array.isArray(stored.templates) ? stored.templates : [];
  } catch {
    return [];
  }
}

function normalizeTemplateName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 512);
}

function bodyVariables(text: string) {
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g) || [];
  const numbers = matches.map((item) => Number(item.replace(/[{}]/g, "").trim())).filter(Boolean);
  return Array.from(new Set(numbers)).sort((a, b) => a - b);
}

function variableSequenceError(indexes: number[]) {
  const expected = indexes.map((_, index) => index + 1);
  const invalid = indexes.some((value, index) => value !== expected[index]);
  if (!invalid) return "";
  return `As variáveis precisam seguir a ordem: ${expected.map((value) => `{{${value}}}`).join(", ")}.`;
}

function neutralExample(index: number) {
  return ["Cliente", "sua solicitacao foi atualizada", "as informacoes estao disponiveis para consulta", "continuar o atendimento"][index - 1] || `exemplo_${index}`;
}

function templateStatusLabel(status?: string) {
  const normalized = String(status || "UNKNOWN").toUpperCase();
  const labels: Record<string, string> = {
    APPROVED: "Aprovado",
    PENDING: "Em análise",
    REJECTED: "Reprovado",
    PAUSED: "Pausado",
    DISABLED: "Desativado",
    IN_APPEAL: "Em recurso",
    PENDING_DELETION: "Excluindo",
    UNKNOWN: "Desconhecido",
  };
  return labels[normalized] || normalized;
}

function templateCategoryLabel(category?: string) {
  const normalized = String(category || "UNKNOWN").toUpperCase();
  const labels: Record<string, string> = {
    UTILITY: "Utilidade",
    MARKETING: "Marketing",
    AUTHENTICATION: "Autenticação",
    UNKNOWN: "Sem categoria",
  };
  return labels[normalized] || normalized;
}

function templateLanguageLabel(language?: string) {
  const normalized = String(language || "").toLowerCase();
  if (normalized.startsWith("pt")) return "Português";
  if (normalized.startsWith("es")) return "Espanhol";
  if (normalized.startsWith("en")) return "Inglês";
  return language || "Sem idioma";
}

function templateBodyPreview(template: MetaSentTemplate) {
  const body = template.components?.find((component) => String(component.type || "").toUpperCase() === "BODY")?.text;
  return body || "Sem texto de corpo retornado pela Meta.";
}

function templateButtonsCount(template: MetaSentTemplate) {
  return template.components?.reduce((total, component) => total + (component.buttons?.length || 0), 0) || 0;
}

function syncVariableExamples(indexes: number[], current: VariableExamples = {}, pool = visitVariablePools[0]): VariableExamples {
  return indexes.reduce<VariableExamples>((acc, variableIndex, position) => {
    acc[variableIndex] = current[variableIndex] || pool[position] || `exemplo_${variableIndex}`;
    return acc;
  }, {});
}

function normalizeVariableExamples(value: LocalMetaTemplateModel["variables"] | undefined, indexes: number[]): VariableExamples {
  if (Array.isArray(value)) {
    return indexes.reduce<VariableExamples>((acc, variableIndex, position) => {
      acc[variableIndex] = value[position] || visitVariablePools[0][position] || `exemplo_${variableIndex}`;
      return acc;
    }, {});
  }
  return syncVariableExamples(indexes, value || {});
}

function metaReviewHint(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("ofensivo") || lower.includes("offensive") || lower.includes("reported")) {
    return "A Meta bloqueou o conteudo na revisao automatica. Tente trocar exemplos/URL, remover termos sensiveis ou criar uma variacao com nome novo.";
  }
  if (lower.includes("duplicate")) {
    return "A Meta identificou conteudo duplicado. Use outro nome e altere pelo menos uma parte do texto.";
  }
  return message;
}

function metaTemplateAccessHint(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("api access blocked")) {
    return "A Meta bloqueou o acesso API dessa BM/WABA para este token/app. Reautorize o token na BM, confirme o app como asset da WABA e garanta a permissão whatsapp_business_management.";
  }
  if (lower.includes("permission") || lower.includes("(#200)") || lower.includes("access this field")) {
    return "Token sem permissão para ler templates dessa WABA. Confira se o usuário/app tem controle total da WABA e a permissão whatsapp_business_management.";
  }
  if (lower.includes("unsupported post request") || lower.includes("does not exist")) {
    return "A WABA ID pode estar incorreta ou o token não tem acesso a essa conta WhatsApp.";
  }
  return message;
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
    const record = data as { error?: { message?: string; error_user_msg?: string }; message?: string };
    throw new Error(record.error?.error_user_msg || record.error?.message || record.message || `Meta retornou HTTP ${response.status}`);
  }
  return data as T;
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

async function graphGetPublic<T = Record<string, unknown>>(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${GRAPH_API_BASE}/${path.replace(/^\//, "")}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  const response = await fetch(url.toString());
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = data as { error?: { message?: string }; message?: string };
    throw new Error(record.error?.message || record.message || `Meta retornou HTTP ${response.status}`);
  }
  return data as T;
}

export function MetaTemplates() {
  const [bmAccounts, setBmAccounts] = useState<BmSettingsData[]>(() => readBmAccounts());
  const [bmSettings, setBmSettings] = useState<BmSettingsData>(() => readBmSettings());
  const [account, setAccount] = useState("");
  const [wabaId, setWabaId] = useState(() => readBmSettings().defaultWabaId || "");
  const [templateName, setTemplateName] = useState("");
  const [mediaType, setMediaType] = useState<MetaMediaType>("NONE");
  const [body, setBody] = useState(DEFAULT_TEMPLATE_BODY);
  const [variables, setVariables] = useState<VariableExamples>(() => syncVariableExamples(bodyVariables(DEFAULT_TEMPLATE_BODY)));
  const [footer, setFooter] = useState('Digite "sair" para n\u00e3o receber mais mensagens.');
  const [quantity, setQuantity] = useState(1);
  const [category, setCategory] = useState<MetaCategory>("UTILITY");
  const [language, setLanguage] = useState("pt_BR");
  const [status, setStatus] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createResults, setCreateResults] = useState<CreateResult[]>([]);
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [tokenDiagnostic, setTokenDiagnostic] = useState<TokenDiagnostic | null>(null);
  const [localModels, setLocalModels] = useState<LocalMetaTemplateModel[]>(() => readLocalMetaModels());
  const [selectedModelId, setSelectedModelId] = useState("");
  const [buttons, setButtons] = useState<TemplateButton[]>([
    { id: 1, kind: "URL", text: "CLIQUE AQUI", url: "https://exemplo.com" },
  ]);
  const [activeTemplateTab, setActiveTemplateTab] = useState<"create" | "sent">("create");
  const [sentTemplates, setSentTemplates] = useState<MetaSentTemplate[]>([]);
  const [selectedSentTemplateId, setSelectedSentTemplateId] = useState("");
  const [sentTemplatesLoading, setSentTemplatesLoading] = useState(false);
  const [sentTemplatesStatus, setSentTemplatesStatus] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateStatusFilter, setTemplateStatusFilter] = useState("all");
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState("all");
  const [templateLanguageFilter, setTemplateLanguageFilter] = useState("all");

  const bodyVariableIndexes = useMemo(() => bodyVariables(body), [body]);
  const bodyVariableKey = bodyVariableIndexes.join(",");
  const variableOrderError = useMemo(() => variableSequenceError(bodyVariableIndexes), [bodyVariableKey]);

  useEffect(() => {
    setVariables((current) => syncVariableExamples(bodyVariableIndexes, current));
  }, [bodyVariableKey]);

  function applyBmAccount(selected?: BmSettingsData) {
    if (!selected) return;
    setBmSettings(selected);
    setWabaId(selected.defaultWabaId || "");
    setAccount(selected.id || selected.defaultWabaId || "");
  }

  function refreshBmAccounts() {
    const settings = readBmSettings();
    const accounts = readBmAccounts();
    setBmAccounts(accounts);
    const selected = accounts.find((item) => (item.id || item.defaultWabaId) === account) || settings;
    if (selected.defaultWabaId && (!wabaId || !account || account === "connected")) {
      applyBmAccount(selected);
    } else if (selected.defaultWabaId) {
      setBmSettings(selected);
    }
  }

  async function localSentTemplates(targetWaba = wabaId, sourceAccount?: BmSettingsData): Promise<MetaSentTemplate[]> {
    const local = await savedTemplates.normalizedList("Meta").catch(() => []);
    return local
      .filter((template) => !targetWaba || !template.waba_id || String(template.waba_id) === targetWaba)
      .map((template) => ({
        id: String(template.id || template.name),
        name: template.name,
        status: String(template.meta_status || template.status || "LOCAL"),
        language: template.language,
        category: template.category ? String(template.category) : undefined,
        components: [
          { type: "BODY", text: template.body_text || "" },
          { type: "FOOTER", text: template.footer_text || "" },
          { type: "BUTTONS", buttons: template.buttons || [] },
        ],
        waba_id: template.waba_id ? String(template.waba_id) : targetWaba,
        bm_id: sourceAccount?.id || sourceAccount?.defaultWabaId || account,
        bm_name: sourceAccount?.name || sourceAccount?.businessName || selectedBmLabel,
        source: "local",
      }));
  }

  async function loadSentTemplates(targetAccount = account, targetWaba = wabaId) {
    const selectedAccount = bmAccounts.find((item) => (item.id || item.defaultWabaId) === targetAccount);
    const fallbackAccount = bmSettings.defaultWabaId || bmSettings.accessToken ? bmSettings : undefined;
    const accountsToSync = selectedAccount
      ? [selectedAccount]
      : [...bmAccounts, ...(fallbackAccount && !bmAccounts.length ? [fallbackAccount] : [])];

    setSentTemplatesLoading(true);
    setSentTemplatesStatus("Sincronizando templates enviados...");

    try {
      const remoteResults: MetaSentTemplate[] = [];
      const localResults: MetaSentTemplate[] = [];
      const errors: string[] = [];
      const syncTargets = accountsToSync.filter(Boolean) as BmSettingsData[];

      if (!syncTargets.length) {
        const local = await localSentTemplates("");
        setSentTemplates(local);
        writeSentTemplatesCache(local);
        setSelectedSentTemplateId(local[0]?.id || "");
        setSentTemplatesStatus(local.length ? "Mostrando templates salvos localmente." : "Nenhuma BM configurada para sincronizar templates.");
        return;
      }

      for (const currentAccount of syncTargets) {
        const token = currentAccount.accessToken?.trim() || bmSettings.accessToken?.trim();
        const waba = targetWaba || currentAccount.defaultWabaId || "";
        const bmName = currentAccount.name || currentAccount.businessName || currentAccount.defaultWabaId || "BM conectada";

        if (!token || !waba) {
          localResults.push(...(await localSentTemplates(waba, currentAccount)));
          errors.push(`${bmName}: faltam WABA ID ou token.`);
          continue;
        }

        try {
          const response = await metaGet<{ data?: MetaSentTemplate[] }>(`${waba}/message_templates`, token, {
            fields: "id,name,status,language,category,components",
            limit: "250",
          });
          remoteResults.push(
            ...(response.data || []).map((template) => ({
              ...template,
              id: String(template.id || `${waba}-${template.name}`),
              waba_id: waba,
              bm_id: currentAccount.id || currentAccount.defaultWabaId || targetAccount,
              bm_name: bmName,
              source: "meta" as const,
            }))
          );
        } catch (error) {
          errors.push(`${bmName}: ${metaTemplateAccessHint(error instanceof Error ? error.message : "falha desconhecida")}`);
        }

        localResults.push(...(await localSentTemplates(waba, currentAccount)));
      }

      if (!remoteResults.length && !localResults.length && !errors.length) {
        const local = await localSentTemplates("");
        setSentTemplates(local);
        writeSentTemplatesCache(local);
        setSelectedSentTemplateId(local[0]?.id || "");
        setSentTemplatesStatus(local.length ? "Mostrando templates salvos localmente." : "Selecione uma BM com WABA e token para buscar na Meta.");
        return;
      }

      const merged = [
        ...remoteResults,
        ...localResults.filter((item) =>
          !remoteResults.some((remoteItem) => remoteItem.name === item.name && remoteItem.waba_id === item.waba_id)
        ),
      ];
      if (!merged.length && errors.length) {
        const cached = readSentTemplatesCache();
        if (cached.length) {
          setSentTemplates(cached);
          setSelectedSentTemplateId((current) => (cached.some((item) => item.id === current) ? current : cached[0]?.id || ""));
          setSentTemplatesStatus(
            `A Meta limitou a consulta agora, então mantive ${cached.length} template(s) do último cache. Erro: ${errors.slice(0, 2).join(" | ")}`
          );
          return;
        }
      }
      setSentTemplates(merged);
      writeSentTemplatesCache(merged);
      setSelectedSentTemplateId((current) => (merged.some((item) => item.id === current) ? current : merged[0]?.id || ""));
      setSentTemplatesStatus(
        errors.length
          ? `${merged.length} template(s) carregados. Algumas BMs falharam: ${errors.slice(0, 2).join(" | ")}`
          : `${merged.length} template(s) encontrados na Meta.`
      );
    } catch (error) {
      const local = await localSentTemplates("");
      const cached = readSentTemplatesCache();
      const fallback = local.length ? local : cached;
      if (local.length) writeSentTemplatesCache(local);
      setSentTemplates(fallback);
      setSelectedSentTemplateId(fallback[0]?.id || "");
      setSentTemplatesStatus(
        fallback.length
          ? `A Meta não respondeu, então trouxe ${fallback.length} salvo(s) localmente/cache. Erro: ${metaTemplateAccessHint(error instanceof Error ? error.message : "falha desconhecida")}`
          : `Não foi possível buscar templates nessa WABA. ${metaTemplateAccessHint(error instanceof Error ? error.message : "")}`
      );
    } finally {
      setSentTemplatesLoading(false);
    }
  }

  useEffect(() => {
    refreshBmAccounts();
    const interval = window.setInterval(refreshBmAccounts, 2000);
    window.addEventListener("focus", refreshBmAccounts);
    window.addEventListener("storage", refreshBmAccounts);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshBmAccounts);
      window.removeEventListener("storage", refreshBmAccounts);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTemplateTab === "sent") {
      loadSentTemplates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTemplateTab]);

  const preview = useMemo(
    () =>
      bodyVariableIndexes.reduce(
        (text, variableIndex) => text.split(`{{${variableIndex}}}`).join(variables[variableIndex] || ""),
        body,
      ),
    [body, bodyVariableKey, variables]
  );

  const previewParagraphs = useMemo(
    () =>
      preview
        .replace(/\.\s+(O comprovante|A documentação|O comprovante)/g, ".\n$1")
        .replace(/\.\s+(Para|Clique|Acesse|Use)/g, ".\n$1")
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean),
    [preview]
  );

  function shuffleVariables() {
    if (!bodyVariableIndexes.length) {
      setStatus("Adicione variáveis no body, como {{1}}, para embaralhar exemplos.");
      return;
    }
    const currentIndex = visitVariablePools.findIndex((pool) =>
      bodyVariableIndexes.every((variableIndex, index) => pool[index] === variables[variableIndex])
    );
    const nextPool = visitVariablePools[(currentIndex + 1) % visitVariablePools.length];
    setVariables(syncVariableExamples(bodyVariableIndexes, {}, nextPool));
  }

  function addButton(kind: TemplateButton["kind"]) {
    if (buttons.length >= 3) return;
    setButtons((current) => [
      ...current,
      {
        id: Date.now(),
        kind,
        text: kind === "URL" ? "CLIQUE AQUI" : "Resposta",
        url: kind === "URL" ? "https://exemplo.com" : undefined,
      },
    ]);
  }

  function updateButton(id: number, patch: Partial<TemplateButton>) {
    setButtons((current) =>
      current.map((button) => (button.id === id ? { ...button, ...patch } : button))
    );
  }

  function removeButton(id: number) {
    setButtons((current) => current.filter((button) => button.id !== id));
  }

  function saveModel() {
    setStatus("Modelo salvo localmente para esta sessão.");
  }

  function loadModel() {
    setStatus("Modelo carregado.");
    setTemplateName("meutemplate");
    setVariables(syncVariableExamples(bodyVariables(DEFAULT_TEMPLATE_BODY)));
    setBody(DEFAULT_TEMPLATE_BODY);
  }

  function saveCurrentModel() {
    const normalizedName = normalizeTemplateName(templateName);
    if (!normalizedName) {
      setStatus("Informe um nome base antes de salvar o modelo.");
      return;
    }
    if (variableOrderError) {
      setStatus(variableOrderError);
      return;
    }

    const model: LocalMetaTemplateModel = {
      id: normalizedName,
      name: normalizedName,
      savedAt: new Date().toISOString(),
      mediaType,
      body,
      variables,
      footer,
      quantity,
      category,
      language,
      buttons,
    };
    const nextModels = [model, ...localModels.filter((item) => item.id !== model.id)];
    writeLocalMetaModels(nextModels);
    setLocalModels(nextModels);
    setSelectedModelId(model.id);
    setStatus(`Modelo "${model.name}" salvo.`);
  }

  function loadSelectedModel() {
    const model = localModels.find((item) => item.id === selectedModelId) || localModels[0];
    if (!model) {
      setStatus("Nenhum modelo salvo ainda.");
      return;
    }

    setTemplateName(model.name);
    setMediaType(model.mediaType);
    setBody(model.body);
    setVariables(normalizeVariableExamples(model.variables, bodyVariables(model.body)));
    setFooter(model.footer);
    setQuantity(model.quantity || 1);
    setCategory(model.category || "UTILITY");
    setLanguage(model.language || "pt_BR");
    setButtons(
      model.buttons?.length
        ? model.buttons.map((button, index) => ({ ...button, id: button.id || Date.now() + index }))
        : [{ id: 1, kind: "URL", text: "CLIQUE AQUI", url: "https://exemplo.com" }],
    );
    setSelectedModelId(model.id);
    setStatus(`Modelo "${model.name}" carregado.`);
  }

  function deleteSelectedModel() {
    const model = localModels.find((item) => item.id === selectedModelId);
    if (!model) {
      setStatus("Selecione um modelo para excluir.");
      return;
    }
    const nextModels = localModels.filter((item) => item.id !== model.id);
    writeLocalMetaModels(nextModels);
    setLocalModels(nextModels);
    setSelectedModelId(nextModels[0]?.id || "");
    setStatus(`Modelo "${model.name}" excluido.`);
  }

  function openApprovalModal() {
    const baseName = normalizeTemplateName(templateName || "movy_template");
    if (!account || !wabaId.trim() || !baseName) {
      setStatus("Informe BM, WABA ID e nome do template antes de enviar para aprovação.");
      return;
    }
    if (variableOrderError) {
      setStatus(variableOrderError);
      return;
    }
    setApprovalModalOpen(true);
  }

  function buildMetaPayload(name: string) {
    const components: Array<Record<string, unknown>> = [];
    if (mediaType !== "NONE") {
      const header: Record<string, unknown> = {
        type: "HEADER",
        format: mediaType,
      };
      header.example = {
        header_handle: [mediaType === "VIDEO" ? DEFAULT_HEADER_VIDEO : DEFAULT_HEADER_IMAGE],
      };
      components.push(header);
    }

    const variableIndexes = bodyVariables(body);
    const bodyExamples = variableIndexes.map((index) => neutralExample(index));
    components.push({
      type: "BODY",
      text: body,
      ...(bodyExamples.length ? { example: { body_text: [bodyExamples] } } : {}),
    });

    if (footer.trim()) {
      components.push({ type: "FOOTER", text: footer.trim() });
    }

    const validButtons = buttons.filter((button) => button.text.trim());
    if (validButtons.length) {
      components.push({
        type: "BUTTONS",
        buttons: validButtons.map((button) =>
          button.kind === "URL"
            ? { type: "URL", text: button.text.trim(), url: button.url?.trim() || "https://exemplo.com" }
            : { type: "QUICK_REPLY", text: button.text.trim() },
        ),
      });
    }

    return { name, language, category, components };
  }

  async function diagnoseToken() {
    const accessToken = bmSettings.accessToken?.trim();
    const appId = bmSettings.appId?.trim();
    const appSecret = bmSettings.appSecret?.trim();
    if (!accessToken || !appId) {
      const diagnostic = {
        appId,
        isValid: false,
        scopes: [],
        missing: ["appId/accessToken"],
        error: "Preencha App ID e Access Token em Configurações BM para diagnosticar o token.",
      };
      setTokenDiagnostic(diagnostic);
      return diagnostic;
    }

    if (!appSecret) {
      const diagnostic = {
        appId,
        isValid: true,
        scopes: [],
        missing: [],
        error: "Diagnóstico avançado de scopes exige App Secret, mas ele não é necessário para criar templates se o token já tiver permissão na WABA.",
      };
      setTokenDiagnostic(diagnostic);
      return diagnostic;
    }

    try {
      const response = await graphGetPublic<{ data?: { app_id?: string; is_valid?: boolean; scopes?: string[] } }>("debug_token", {
        input_token: accessToken,
        access_token: `${appId}|${appSecret}`,
      });
      const scopes = response.data?.scopes || [];
      const required = ["whatsapp_business_management", "whatsapp_business_messaging"];
      const diagnostic = {
        appId: response.data?.app_id,
        isValid: response.data?.is_valid,
        scopes,
        missing: required.filter((scope) => !scopes.includes(scope)),
      };
      setTokenDiagnostic(diagnostic);
      return diagnostic;
    } catch (error) {
      const diagnostic = {
        appId,
        isValid: false,
        scopes: [],
        missing: ["debug_token"],
        error: error instanceof Error ? error.message : "Falha ao diagnosticar token.",
      };
      setTokenDiagnostic(diagnostic);
      return diagnostic;
    }
  }

  async function createMetaTemplates() {
    const accessToken = bmSettings.accessToken?.trim();
    const targetWaba = wabaId.trim();
    const baseName = normalizeTemplateName(templateName || "movy_template");

    if (!accessToken || !targetWaba || !baseName) {
      setStatus("Informe WABA, token conectado na BM e nome do template.");
      return;
    }
    if (variableOrderError) {
      setStatus(variableOrderError);
      return;
    }

    setApprovalModalOpen(false);
    setSendModalOpen(true);
    setIsCreating(true);
    setCreateResults([]);
    setStatus("Validando acesso aos templates dessa WABA...");

    const results: CreateResult[] = [];
    try {
      await metaGet(`${targetWaba}/message_templates`, accessToken, { fields: "name,status,language", limit: "1" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao consegui ler templates nessa WABA.";
      const diagnostic = await diagnoseToken();
      const diagnosticText = diagnostic.missing.length
        ? `Scopes ausentes no token: ${diagnostic.missing.join(", ")}.`
        : "Scopes principais estao no token; provavelmente falta permissao/tarefa do app ou usuario dentro da WABA.";
      setCreateResults([
        {
          name: targetWaba,
          status: "error",
          message: `Nao foi possivel acessar os templates dessa WABA. ${diagnosticText} Confirme se ${targetWaba} e o WhatsApp Business Account ID e se o app/usuario do token tem controle total da conta WhatsApp. Erro: ${message}`,
        },
      ]);
      setStatus("A WABA/Token não tem acesso ao endpoint de templates.");
      setIsCreating(false);
      return;
    }

    setStatus(`Enviando ${quantity} template${quantity > 1 ? "s" : ""} para a Meta...`);

    for (let index = 0; index < quantity; index += 1) {
      const name = quantity > 1 ? `${baseName}_${String(index + 1).padStart(2, "0")}` : baseName;
      try {
        const response = await metaPost<{ id?: string; status?: string }>(`${targetWaba}/message_templates`, accessToken, buildMetaPayload(name));
        results.push({
          name,
          status: "ok",
          message: response.status ? `Enviado para analise: ${response.status}` : `Criado na Meta${response.id ? ` (${response.id})` : ""}`,
        });
        savedTemplates
          .save({
            id: response.id || name,
            name,
            folder: "Meta",
            media_type: mediaType,
            body_text: body,
            footer_text: footer,
            buttons,
            body_examples: bodyVariableIndexes.map((variableIndex) => variables[variableIndex] || ""),
            variable_count: bodyVariables(body).length,
            language,
            category,
            meta_status: response.status,
            waba_id: targetWaba,
          })
          .catch(() => undefined);
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : "Falha desconhecida ao criar template.";
        results.push({
          name,
          status: "error",
          message: metaReviewHint(rawMessage),
        });
      }
      setCreateResults([...results]);
    }

    setStatus(results.every((item) => item.status === "ok") ? "Templates enviados para a Meta." : "Alguns templates falharam. Veja os detalhes abaixo.");
    setIsCreating(false);
  }

  const previewButtons = buttons.filter((button) => button.text.trim());
  const selectedBmLabel =
    bmAccounts.find((item) => (item.id || item.defaultWabaId) === account)?.name ||
    bmAccounts.find((item) => (item.id || item.defaultWabaId) === account)?.businessName ||
    bmSettings.name ||
    bmSettings.businessName ||
    "BM conectada";
  const sentCount = createResults.filter((item) => item.status === "ok").length;
  const failureCount = createResults.filter((item) => item.status === "error").length;
  const processedCount = createResults.length;
  const remainingCount = Math.max(quantity - processedCount, 0);
  const progressPercent = quantity ? Math.round((processedCount / quantity) * 100) : 0;
  const sentStatusOptions = Array.from(new Set(sentTemplates.map((template) => String(template.status || "UNKNOWN").toUpperCase()))).sort();
  const sentCategoryOptions = Array.from(new Set(sentTemplates.map((template) => String(template.category || "UNKNOWN").toUpperCase()))).sort();
  const sentLanguageOptions = Array.from(new Set(sentTemplates.map((template) => String(template.language || "").toLowerCase()).filter(Boolean))).sort();
  const filteredSentTemplates = sentTemplates.filter((template) => {
    const search = templateSearch.trim().toLowerCase();
    const bodyText = templateBodyPreview(template).toLowerCase();
    const matchesSearch = !search || template.name.toLowerCase().includes(search) || bodyText.includes(search);
    const matchesStatus = templateStatusFilter === "all" || String(template.status || "UNKNOWN").toUpperCase() === templateStatusFilter;
    const matchesCategory = templateCategoryFilter === "all" || String(template.category || "UNKNOWN").toUpperCase() === templateCategoryFilter;
    const matchesLanguage = templateLanguageFilter === "all" || String(template.language || "").toLowerCase() === templateLanguageFilter;
    return matchesSearch && matchesStatus && matchesCategory && matchesLanguage;
  });
  const selectedSentTemplate =
    filteredSentTemplates.find((template) => template.id === selectedSentTemplateId) ||
    filteredSentTemplates[0] ||
    sentTemplates.find((template) => template.id === selectedSentTemplateId);
  const sentApproved = sentTemplates.filter((template) => String(template.status).toUpperCase() === "APPROVED").length;
  const sentPending = sentTemplates.filter((template) => String(template.status).toUpperCase() === "PENDING").length;
  const sentRejected = sentTemplates.filter((template) => String(template.status).toUpperCase() === "REJECTED").length;
  const sentLocal = sentTemplates.filter((template) => template.source === "local").length;

  return (
    <main className="page template-page meta-template-page">
      <header className="template-heading">
        <div className="page-heading-icon">
          <Zap size={24} />
        </div>
        <div>
          <h1>{activeTemplateTab === "create" ? "Criar Templates" : "Templates enviados"}</h1>
          <p>
            {activeTemplateTab === "create"
              ? "Gere modelos aprovados para WhatsApp pela Meta"
              : "Acompanhe status, BMs e conteudo aprovado"}
          </p>
        </div>
      </header>

      <div className="meta-template-tabs">
        <button className={activeTemplateTab === "create" ? "active" : ""} type="button" onClick={() => setActiveTemplateTab("create")}>
          <Sparkles size={16} />
          Criar Template
        </button>
        <button className={activeTemplateTab === "sent" ? "active" : ""} type="button" onClick={() => setActiveTemplateTab("sent")}>
          <BarChart3 size={16} />
          Templates Enviados
          {sentTemplates.length ? <span>{sentTemplates.length}</span> : null}
        </button>
      </div>

      {activeTemplateTab === "create" ? (
      <div className="template-layout meta-create-layout">
        <section className="card template-config meta-template-config">
          <h2><span className="card-title-icon"><Zap size={17} /></span> Configurar Template</h2>

          <div className="meta-top-fields">
            <div className="field">
              <label>Conta</label>
              <select
                className="select"
                value={account}
                onChange={(event) => {
                  const selected = bmAccounts.find((item) => (item.id || item.defaultWabaId) === event.target.value);
                  if (selected) applyBmAccount(selected);
                  else setAccount(event.target.value);
                }}
              >
                <option value="">Selecionar BM</option>
                {bmAccounts.map((item) => (
                  <option key={item.id || item.defaultWabaId} value={item.id || item.defaultWabaId}>
                    {item.name || item.businessName || item.defaultWabaId || "BM conectada"}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>WABA ID</label>
              <input
                className="input"
                placeholder="ID da conta WABA (ex: 738485062669822)"
                value={wabaId}
                onChange={(event) => setWabaId(event.target.value)}
              />
              <p className="hint">ID da sua conta WhatsApp Business API na Meta</p>
            </div>
          </div>

          <div className="field">
            <label>Nome Base do Template</label>
            <input
              className="input"
              placeholder="ex: meutemplate"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
            />
          </div>

          <section className="panel advanced-panel meta-visible-settings">
            <div className="field">
              <label>Categoria</label>
              <select className="select" value={category} onChange={(event) => setCategory(event.target.value as MetaCategory)}>
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
                <option value="en_US">Inglês</option>
              </select>
            </div>
          </section>

          <div className="field">
            <label>Tipo de Mídia (Header)</label>
            <div className="media-choice meta-media-choice" role="radiogroup">
              <MediaButton active={mediaType === "IMAGE"} icon="image" label="Imagem" sublabel="Header com foto" onClick={() => setMediaType("IMAGE")} />
              <MediaButton active={mediaType === "VIDEO"} icon="video" label="Vídeo" sublabel="Header com vídeo" onClick={() => setMediaType("VIDEO")} />
              <MediaButton active={mediaType === "NONE"} icon="none" label="Nenhum" sublabel="Sem header" onClick={() => setMediaType("NONE")} />
            </div>
          </div>

          <div className="section-title-row">
            <span className="with-icon"><span className="section-icon"><Zap size={15} /></span> Conteúdo do Template</span>
          </div>

          <div className="field">
            <label>Texto do Body</label>
            <textarea
              className="textarea template-body"
              placeholder="Mensagem do template com variáveis {{1}}, {{2}}, etc."
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
            <p className="hint">Use {"{{1}}, {{2}}, {{3}}, {{4}}"} para variáveis</p>
          </div>

          <div className="field">
            <div className="variables-header-row">
              <label>Exemplos das Variáveis ({bodyVariableIndexes.length})</label>
              <button className="button secondary compact" type="button" onClick={shuffleVariables}>
                Embaralhar
              </button>
            </div>
            <div className="variables-grid">
              {bodyVariableIndexes.map((variableIndex, index) => (
                <input
                  className="input"
                  key={variableIndex}
                  aria-label={`Exemplo para variável {{${variableIndex}}}`}
                  placeholder={`Exemplo para variável {{${variableIndex}}}`}
                  value={variables[variableIndex] || ""}
                  onChange={(event) => {
                    setVariables((current) => ({ ...current, [variableIndex]: event.target.value }));
                  }}
                />
              ))}
            </div>
            {!bodyVariableIndexes.length ? (
              <p className="hint">Adicione variáveis no body usando {"{{1}}, {{2}}, {{3}}"}...</p>
            ) : null}
            {variableOrderError ? <p className="hint error-hint">{variableOrderError}</p> : null}
          </div>

          <div className="field">
            <label>Texto do Footer</label>
            <input className="input" placeholder="Texto do rodapé" value={footer} onChange={(event) => setFooter(event.target.value)} />
          </div>

          <div className="section-title-row">
            <span>Botões</span>
            <span className="hint">({buttons.length}/3)</span>
          </div>
          <div className="button-row">
            <button className="button secondary compact" type="button" disabled={buttons.length >= 3} onClick={() => addButton("URL")}>
              <Plus size={14} /> URL
            </button>
            <button className="button secondary compact" type="button" disabled={buttons.length >= 3} onClick={() => addButton("QUICK_REPLY")}>
              <Plus size={14} /> Resposta
            </button>
          </div>

          <div className="meta-buttons-list">
            {buttons.map((button) => (
              <section className="panel meta-button-card" key={button.id}>
                <div className="section-title-row">
                  <span>{button.kind === "URL" ? "Botão de Link" : "Botão de Resposta"}</span>
                  <button className="icon-button" type="button" onClick={() => removeButton(button.id)}>
                    <X size={16} />
                  </button>
                </div>
                <div className="grid cols-2">
                  <input
                    className="input"
                    placeholder="Texto do botão (ex: CLIQUE AQUI)"
                    value={button.text}
                    onChange={(event) => updateButton(button.id, { text: event.target.value })}
                  />
                  {button.kind === "URL" ? (
                    <input
                      className="input"
                      placeholder="https://exemplo.com"
                      value={button.url || ""}
                      onChange={(event) => updateButton(button.id, { url: event.target.value })}
                    />
                  ) : (
                    <select className="select" value={button.kind} onChange={() => null}>
                      <option>Resposta rápida</option>
                    </select>
                  )}
                </div>
              </section>
            ))}
          </div>

          <div className="button-row template-actions">
            <select
              className="select model-select"
              value={selectedModelId}
              onChange={(event) => setSelectedModelId(event.target.value)}
            >
              <option value="">Modelos salvos ({localModels.length})</option>
              {localModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <button className="button secondary" type="button" onClick={saveCurrentModel}>
              Salvar Modelo
            </button>
            <button className="button secondary" disabled={!localModels.length} type="button" onClick={loadSelectedModel}>
              Carregar Modelo
            </button>
            <button className="button secondary" disabled={!localModels.length || !selectedModelId} type="button" onClick={deleteSelectedModel}>
              Excluir
            </button>
            <button className="button" disabled={!account || !wabaId || !templateName || Boolean(variableOrderError) || isCreating} type="button" onClick={openApprovalModal}>
              <Send size={16} />
              Enviar Aprovação
            </button>
          </div>
          {status && <p className="hint">{status}</p>}
        </section>

        <aside className="card template-preview-card meta-template-preview-card">
          <h2><span className="card-title-icon"><Eye size={17} /></span> Preview WhatsApp</h2>
          <div className="whatsapp-preview">
            <div className="preview-label">{"Pr\u00e9-visualiza\u00e7\u00e3o"}</div>
            {mediaType !== "NONE" && (
              <div className={`preview-media ${mediaType === "VIDEO" ? "preview-media-video" : "preview-media-image"}`}>
                {mediaType === "VIDEO" && DEFAULT_HEADER_VIDEO ? (
                  <video src={DEFAULT_HEADER_VIDEO} poster={DEFAULT_HEADER_VIDEO_POSTER} muted playsInline preload="metadata" />
                ) : (
                  <img
                    src={mediaType === "VIDEO" ? DEFAULT_HEADER_VIDEO_POSTER : DEFAULT_HEADER_IMAGE}
                    alt={mediaType === "VIDEO" ? "Preview padrão de vídeo" : "Preview padrão de imagem"}
                  />
                )}
                {mediaType === "VIDEO" && <span className="play-circle"><Play size={30} /></span>}
                <span>{mediaType === "VIDEO" ? "V\u00eddeo" : "Imagem"}</span>
              </div>
            )}
            <div className={mediaType === "NONE" ? "preview-message rounded" : "preview-message"}>
              {previewParagraphs.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
              <p className="preview-footer">{footer}</p>
              {previewButtons.length ? (
                <div className="preview-buttons">
                  {previewButtons.map((button) => (
                    <button key={button.id} type="button">
                      {button.kind === "URL" ? <ExternalLink size={14} /> : <MessageCircle size={14} />}
                      {button.text || "CLIQUE AQUI"}
                    </button>
                  ))}
                </div>
              ) : null}
              <span>12:00</span>
            </div>
          </div>
        </aside>
      </div>
      ) : (
        <section className="sent-templates-page">
          <div className="sent-templates-toolbar">
            <div>
              <h2>Templates enviados</h2>
              <p>Status, filtros e detalhes dos modelos enviados para a Meta.</p>
            </div>
            <button className="button secondary sent-refresh-button" disabled={sentTemplatesLoading} type="button" onClick={() => loadSentTemplates()}>
              <RefreshCw size={16} className={sentTemplatesLoading ? "spin" : ""} />
              Atualizar
            </button>
          </div>

          <div className="sent-summary-grid">
            <div className="sent-summary-card total">
              <FileText size={18} />
              <strong>{sentTemplates.length}</strong>
              <span>Total</span>
            </div>
            <div className="sent-summary-card ok">
              <CheckCircle size={18} />
              <strong>{sentApproved}</strong>
              <span>Aprovados</span>
            </div>
            <div className="sent-summary-card pending">
              <Clock size={18} />
              <strong>{sentPending}</strong>
              <span>Em análise</span>
            </div>
            <div className="sent-summary-card error">
              <AlertCircle size={18} />
              <strong>{sentRejected}</strong>
              <span>Reprovados</span>
            </div>
            <div className="sent-summary-card local">
              <Sparkles size={18} />
              <strong>{sentLocal}</strong>
              <span>Locais</span>
            </div>
          </div>

          <div className="card sent-filter-panel">
            <div className="field sent-search-field">
              <label><Search size={14} /> Buscar</label>
              <input className="input" placeholder="Nome ou trecho do template..." value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} />
            </div>
            <div className="field">
              <label>BM conectada</label>
              <select
                className="select"
                value={account}
                onChange={(event) => {
                  const selected = bmAccounts.find((item) => (item.id || item.defaultWabaId) === event.target.value);
                  if (selected) {
                    applyBmAccount(selected);
                    loadSentTemplates(selected.id || selected.defaultWabaId || "", selected.defaultWabaId || "");
                  } else {
                    setAccount("");
                    loadSentTemplates("", "");
                  }
                }}
              >
                <option value="">Todas as BMs</option>
                {bmAccounts.map((item) => (
                  <option key={item.id || item.defaultWabaId} value={item.id || item.defaultWabaId}>
                    {item.name || item.businessName || item.defaultWabaId || "BM conectada"}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Status</label>
              <select className="select" value={templateStatusFilter} onChange={(event) => setTemplateStatusFilter(event.target.value)}>
                <option value="all">Todos</option>
                {sentStatusOptions.map((option) => (
                  <option key={option} value={option}>{templateStatusLabel(option)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Categoria</label>
              <select className="select" value={templateCategoryFilter} onChange={(event) => setTemplateCategoryFilter(event.target.value)}>
                <option value="all">Todas</option>
                {sentCategoryOptions.map((option) => (
                  <option key={option} value={option}>{templateCategoryLabel(option)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Idioma</label>
              <select className="select" value={templateLanguageFilter} onChange={(event) => setTemplateLanguageFilter(event.target.value)}>
                <option value="all">Todos</option>
                {sentLanguageOptions.map((option) => (
                  <option key={option} value={option}>{templateLanguageLabel(option)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="sent-status-line">
            <span><Filter size={14} /> {filteredSentTemplates.length} de {sentTemplates.length} template(s)</span>
            <small>{sentTemplatesStatus}</small>
          </div>

          {sentTemplatesStatus.toLowerCase().includes("falharam") || sentTemplatesStatus.toLowerCase().includes("não foi possível") ? (
            <div className="sent-access-alert">
              <AlertCircle size={18} />
              <div>
                <strong>Acesso à Meta bloqueado ou sem permissão</strong>
                <span>{sentTemplatesStatus}</span>
              </div>
            </div>
          ) : null}

          <div className="sent-templates-layout">
            <div className="sent-template-list">
              {filteredSentTemplates.map((template) => (
                <button
                  className={`sent-template-item ${template.id === selectedSentTemplate?.id ? "active" : ""}`}
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedSentTemplateId(template.id)}
                >
                  <div>
                    <strong>{template.name}</strong>
                    <span>{templateCategoryLabel(template.category)} · {templateLanguageLabel(template.language)}</span>
                  </div>
                  <span className={`status-pill ${String(template.status || "UNKNOWN").toLowerCase()}`}>{templateStatusLabel(template.status)}</span>
                </button>
              ))}
              {!filteredSentTemplates.length ? (
                <div className="empty-sent-state">
                  <FileText size={28} />
                  <strong>Nenhum template encontrado</strong>
                  <span>Ajuste os filtros ou clique em Atualizar para sincronizar com a Meta.</span>
                </div>
              ) : null}
            </div>

            <aside className="card sent-template-detail">
              {selectedSentTemplate ? (
                <>
                  <div className="sent-detail-header">
                    <div>
                      <span className={`status-pill ${String(selectedSentTemplate.status || "UNKNOWN").toLowerCase()}`}>{templateStatusLabel(selectedSentTemplate.status)}</span>
                      <h3>{selectedSentTemplate.name}</h3>
                      <p>{selectedSentTemplate.bm_name || selectedBmLabel} · WABA {selectedSentTemplate.waba_id || wabaId || "-"}</p>
                    </div>
                  </div>
                  <div className="sent-detail-grid">
                    <div><span>Categoria</span><strong>{templateCategoryLabel(selectedSentTemplate.category)}</strong></div>
                    <div><span>Idioma</span><strong>{templateLanguageLabel(selectedSentTemplate.language)}</strong></div>
                    <div><span>Botões</span><strong>{templateButtonsCount(selectedSentTemplate)}</strong></div>
                    <div><span>Origem</span><strong>{selectedSentTemplate.source === "local" ? "Local" : "Meta"}</strong></div>
                  </div>
                  <div className="sent-message-preview">
                    <span>Conteúdo</span>
                    <p>{templateBodyPreview(selectedSentTemplate)}</p>
                  </div>
                  <div className="sent-components-list">
                    {(selectedSentTemplate.components || []).map((component, index) => (
                      <div key={`${component.type}-${index}`}>
                        <strong>{component.type || "COMPONENTE"}</strong>
                        <span>{component.format || component.text || `${component.buttons?.length || 0} botão(ões)`}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-sent-state">
                  <Eye size={28} />
                  <strong>Selecione um template</strong>
                  <span>O detalhe aparece aqui com status, conteúdo e configuração.</span>
                </div>
              )}
            </aside>
          </div>
        </section>
      )}

      {approvalModalOpen ? (
        <div className="modal-backdrop">
          <section className="card meta-approval-modal">
            <header className="meta-modal-header">
              <div>
                <h2><Send size={21} /> Enviar Template para Aprovação</h2>
                <p>Confirme a BM, WABA e quantidade antes de enviar para a Meta.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setApprovalModalOpen(false)}>
                <X size={18} />
              </button>
            </header>

            <div className="field">
              <label>Business Manager (Token)</label>
              <select
                className="select"
                value={account}
                onChange={(event) => {
                  const selected = bmAccounts.find((item) => (item.id || item.defaultWabaId) === event.target.value);
                  if (selected) applyBmAccount(selected);
                  else setAccount(event.target.value);
                }}
              >
                <option value="">Selecione o BM</option>
                {bmAccounts.map((item) => (
                  <option key={item.id || item.defaultWabaId} value={item.id || item.defaultWabaId}>
                    {item.name || item.businessName || item.defaultWabaId || "BM conectada"}
                  </option>
                ))}
              </select>
              <p className="hint">Escolha qual Business Manager usar para enviar o template.</p>
            </div>

            <div className="field">
              <label>WABA ID</label>
              <input className="input" placeholder="Digite o WABA ID" value={wabaId} onChange={(event) => setWabaId(event.target.value)} />
            </div>

            <div className="field">
              <label>Quantidade de Templates (máx. 50)</label>
              <input className="input" max={50} min={1} type="number" value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} />
              <p className="hint">Nomes sequenciais são gerados automaticamente quando a quantidade for maior que 1.</p>
            </div>

            <div className="approval-summary">
              <h3><FileText size={18} /> Resumo do Template</h3>
              <dl>
                <dt>Nome base:</dt>
                <dd>{normalizeTemplateName(templateName) || "-"}</dd>
                <dt>Categoria:</dt>
                <dd>{category}</dd>
                <dt>Idioma:</dt>
                <dd>{language}</dd>
                <dt>Quantidade:</dt>
                <dd>{quantity}</dd>
                <dt>BM:</dt>
                <dd>{selectedBmLabel}</dd>
                <dt>WABA ID:</dt>
                <dd>{wabaId || "-"}</dd>
              </dl>
            </div>

            <div className="button-row modal-actions">
              <button className="button secondary" type="button" onClick={() => setApprovalModalOpen(false)}>
                Cancelar
              </button>
              <button className="button" disabled={isCreating} type="button" onClick={createMetaTemplates}>
                <Send size={16} />
                Enviar para Meta BM
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {sendModalOpen ? (
        <div className="modal-backdrop">
          <section className="card meta-send-modal">
            <header className="meta-send-header">
              <div className="send-state-icon">{isCreating ? <Clock size={24} /> : <CheckCircle size={24} />}</div>
              <div>
                <h2>{isCreating ? "Enviando para Meta" : "Envio Concluído"}</h2>
                <p>{isCreating ? "Acompanhe cada template criado na BM." : `${processedCount} de ${quantity} processados`}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setSendModalOpen(false)}>
                <X size={18} />
              </button>
            </header>

            <div className="send-progress-ring" style={{ "--progress": `${progressPercent}%` } as CSSProperties}>
              <strong>{progressPercent}%</strong>
              <span>{processedCount} de {quantity}</span>
            </div>

            <div className="send-stats-grid">
              <div className="send-stat-card ok">
                <CheckCircle size={20} />
                <strong>{sentCount}</strong>
                <span>Enviados</span>
              </div>
              <div className="send-stat-card error">
                <AlertCircle size={20} />
                <strong>{failureCount}</strong>
                <span>Falhas</span>
              </div>
              <div className="send-stat-card pending">
                <Clock size={20} />
                <strong>{isCreating ? remainingCount : 0}</strong>
                <span>Restantes</span>
              </div>
            </div>

            <div className="send-results-panel">
              <div>
                <h3>Últimos resultados</h3>
                <span>{createResults.length} itens</span>
              </div>
              <div className="send-result-list">
                {createResults.length ? (
                  createResults.slice().reverse().map((result) => (
                    <div className={`send-result-item ${result.status}`} key={result.name}>
                      {result.status === "ok" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                      <div>
                        <strong>{result.name}</strong>
                        <span>{result.message}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="hint">Aguardando resposta da Meta...</p>
                )}
              </div>
            </div>

            <button className="button meta-send-close" disabled={isCreating} type="button" onClick={() => setSendModalOpen(false)}>
              Fechar
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function MediaButton({
  active,
  icon,
  label,
  onClick,
  sublabel,
}: {
  active: boolean;
  icon: "image" | "video" | "none";
  label: string;
  onClick: () => void;
  sublabel: string;
}) {
  const Icon = icon === "image" ? Image : icon === "video" ? Video : MessageCircle;

  return (
    <button className={`media-card ${active ? "active" : ""}`} type="button" onClick={onClick}>
      <span className="media-icon-box"><Icon size={22} /></span>
      <strong>{label}</strong>
      <small>{sublabel}</small>
    </button>
  );
}


