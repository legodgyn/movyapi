import { CheckCircle2, KeyRound, Link2, Plus, RefreshCw, Save, Search, Server, Smartphone, Trash2, Wifi } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { labelOf } from "../lib/format";
import { infobipApis } from "../lib/services";
import type { InfobipApi } from "../lib/types";

type ApiForm = {
  id?: string;
  name: string;
  apiType: string;
  baseUrl: string;
  token: string;
  senderNumber: string;
};

type InfobipSender = {
  id: string;
  apiId: string;
  apiName: string;
  sender: string;
  name: string;
  status: string;
  channel?: string;
  integratedAt?: string;
};

const emptyForm: ApiForm = {
  name: "",
  apiType: "INFOBIP",
  baseUrl: "",
  token: "",
  senderNumber: "",
};

const LOCAL_INFOBIP_SENDERS_KEY = "movy.infobipSenders";
const SENDER_PAGE_SIZE = 24;

function apiValue(api: InfobipApi, ...keys: string[]) {
  for (const key of keys) {
    const value = api[key];
    if (value) return String(value);
  }
  return "";
}

function tokenPreview(value: string) {
  if (!value) return "Token nao informado";
  if (value.length <= 12) return "Token configurado";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function normalizeUrl(value: string) {
  let url = value.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/^http:\/\//i, "https://").replace(/\/+$/, "");
}

function normalizeSender(api: InfobipApi, raw: Record<string, unknown>, index: number): InfobipSender {
  const sender = String(raw.sender || raw.senderNumber || raw.sender_number || raw.number || raw.phoneNumber || raw.phone || raw.from || raw.id || "").trim();
  const id = String(raw.id || raw.senderId || raw.sender_id || sender || `${api.id}-${index}`);
  return {
    id: `${api.id}:${id}`,
    apiId: api.id,
    apiName: labelOf(api, "Infobip"),
    sender,
    name: String(raw.name || raw.displayName || raw.display_name || raw.verifiedName || raw.verified_name || sender || `Remetente ${index + 1}`),
    status: String(raw.status || raw.state || raw.enabled || "disponivel"),
    channel: String(raw.channel || raw.type || "WhatsApp"),
  };
}

function senderFromApi(api: InfobipApi): InfobipSender | null {
  const sender = apiValue(api, "sender_number", "senderNumber", "phone_number");
  if (!sender) return null;
  return {
    id: `${api.id}:${sender}`,
    apiId: api.id,
    apiName: labelOf(api, "Infobip"),
    sender,
    name: String(api.sender_name || api.senderName || labelOf(api, sender)),
    status: "configurado manualmente",
    channel: "WhatsApp",
  };
}

function cachedSendersFromApi(api: InfobipApi) {
  const rows = Array.isArray(api.senders) ? api.senders : [];
  return rows
    .map((row, index) => normalizeSender(api, row as Record<string, unknown>, index))
    .filter((option) => option.sender || option.name);
}

function readIntegratedSenders(): InfobipSender[] {
  try {
    const items = JSON.parse(localStorage.getItem(LOCAL_INFOBIP_SENDERS_KEY) || "[]") as InfobipSender[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeIntegratedSenders(items: InfobipSender[]) {
  localStorage.setItem(LOCAL_INFOBIP_SENDERS_KEY, JSON.stringify(items));
}

function senderLabel(sender: InfobipSender) {
  const number = sender.sender || "Sem numero";
  const name = (sender.name || "").trim();
  if (!name || name === sender.sender) return number;
  return `${name} - ${number}`;
}

function formatSyncDate(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "2-digit" });
}

export function ApiManager() {
  const [apis, setApis] = useState<InfobipApi[]>([]);
  const [form, setForm] = useState<ApiForm>(emptyForm);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncingApiId, setSyncingApiId] = useState("");
  const [selectedApiId, setSelectedApiId] = useState("");
  const [senderOptions, setSenderOptions] = useState<Record<string, InfobipSender[]>>({});
  const [senderFilters, setSenderFilters] = useState<Record<string, string>>({});
  const [senderLimits, setSenderLimits] = useState<Record<string, number>>({});
  const [integratedSenders, setIntegratedSenders] = useState<InfobipSender[]>(() => readIntegratedSenders());

  const filteredApis = useMemo(() => {
    const search = query.trim().toLowerCase();
    return apis.filter((api) => {
      const haystack = `${labelOf(api, "API")} ${api.api_type || ""} ${apiValue(api, "base_url", "baseUrl", "url")} ${apiValue(api, "sender_number", "senderNumber")}`.toLowerCase();
      return !search || haystack.includes(search);
    });
  }, [apis, query]);

  const selectedApi = useMemo(() => apis.find((api) => api.id === selectedApiId) || apis[0], [apis, selectedApiId]);
  const selectedOptions = selectedApi ? senderOptions[selectedApi.id] || cachedSendersFromApi(selectedApi) : [];
  const selectedConnected = selectedApi ? integratedSenders.filter((item) => item.apiId === selectedApi.id) : [];
  const selectedFilter = selectedApi ? senderFilters[selectedApi.id] || "" : "";
  const selectedLimit = selectedApi ? senderLimits[selectedApi.id] || SENDER_PAGE_SIZE : SENDER_PAGE_SIZE;
  const selectedSearch = selectedFilter.trim().toLowerCase();
  const selectedVisibleOptions = selectedOptions.filter((option) => {
    const haystack = `${option.name} ${option.sender} ${option.status} ${option.channel || ""}`.toLowerCase();
    return !selectedSearch || haystack.includes(selectedSearch);
  });
  const selectedPagedOptions = selectedVisibleOptions.slice(0, selectedLimit);
  const selectedRemaining = Math.max(selectedVisibleOptions.length - selectedPagedOptions.length, 0);
  const selectedBaseUrl = selectedApi ? apiValue(selectedApi, "base_url", "baseUrl", "url") : "";
  const selectedSender = selectedApi ? apiValue(selectedApi, "sender_number", "senderNumber", "phone_number") : "";
  const selectedToken = selectedApi ? apiValue(selectedApi, "token", "api_key", "apiKey", "authorization") : "";
  const selectedLastSync = selectedApi ? formatSyncDate(selectedApi.last_sync_at || selectedApi.lastSyncAt) : "";

  async function load() {
    setStatus("Atualizando APIs...");
    const items = await infobipApis.normalizedList().catch(() => []);
    setApis(items);
    setIntegratedSenders(readIntegratedSenders());
    setSelectedApiId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id || "");
    setStatus(items.length ? `${items.length} API(s) cadastrada(s).` : "Nenhuma API cadastrada.");
  }

  useEffect(() => {
    load();
  }, []);

  function edit(api: InfobipApi) {
    setSelectedApiId(api.id);
    setForm({
      id: api.id,
      name: labelOf(api, ""),
      apiType: String(api.api_type || "INFOBIP"),
      baseUrl: apiValue(api, "base_url", "baseUrl", "url"),
      token: apiValue(api, "token", "api_key", "apiKey", "authorization"),
      senderNumber: apiValue(api, "sender_number", "senderNumber", "phone_number"),
    });
    const fallback = senderFromApi(api);
    if (fallback) setSenderOptions((current) => ({ ...current, [api.id]: current[api.id]?.length ? current[api.id] : [fallback] }));
    setStatus(`Editando ${labelOf(api, "API")}.`);
  }

  async function save() {
    if (!form.name.trim()) {
      setStatus("Informe um nome para a API.");
      return;
    }
    setSaving(true);
    setStatus("Salvando API...");
    const payload = {
      name: form.name.trim(),
      label: form.name.trim(),
      api_type: form.apiType,
      provider: form.apiType.toLowerCase(),
      base_url: normalizeUrl(form.baseUrl),
      token: form.token.trim(),
      api_key: form.token.trim(),
      sender_number: form.senderNumber.trim(),
      senderNumber: form.senderNumber.trim(),
    };
    try {
      if (form.id) await infobipApis.update(form.id, payload);
      else await infobipApis.save(payload);
      setSelectedApiId(form.id || "");
      setForm(emptyForm);
      setStatus("API salva. Ela ja fica disponivel na tela de Templates.");
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao salvar API.";
      setStatus(message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(api: InfobipApi) {
    setStatus(`Removendo ${labelOf(api, "API")}...`);
    try {
      await infobipApis.remove(api.id);
      if (selectedApiId === api.id) setSelectedApiId("");
      await load();
    } catch {
      setStatus("Nao foi possivel remover a API.");
    }
  }

  async function syncSenders(api: InfobipApi) {
    setSyncingApiId(api.id);
    setSelectedApiId(api.id);
    setSenderLimits((current) => ({ ...current, [api.id]: SENDER_PAGE_SIZE }));
    setStatus(`Buscando remetentes de ${labelOf(api, "Infobip")}...`);
    const cachedOptions = cachedSendersFromApi(api);
    if (cachedOptions.length) {
      setSenderOptions((current) => ({ ...current, [api.id]: cachedOptions }));
    }
    try {
      const rows = await infobipApis.syncNormalizedSenders(api.id);
      const normalized = rows.map((row, index) => normalizeSender(api, row, index)).filter((sender) => sender.sender || sender.name);
      const fallback = senderFromApi(api);
      const next = normalized.length ? normalized : fallback ? [fallback] : [];
      setSenderOptions((current) => ({ ...current, [api.id]: next }));
      setApis((current) =>
        current.map((item) =>
          item.id === api.id
            ? { ...item, senders: rows, last_sync_error: "", last_sync_at: new Date().toISOString() }
            : item
        )
      );
      setStatus(next.length ? `${next.length} remetente(s) encontrado(s). Escolha quais deseja integrar no sistema.` : "Nenhum remetente retornado pela Infobip.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao sincronizar remetentes.";
      if (cachedOptions.length) {
        setSenderOptions((current) => ({ ...current, [api.id]: cachedOptions }));
        setStatus(`Infobip: ${message} Mostrando ${cachedOptions.length} remetente(s) ja sincronizado(s).`);
        return;
      }
      const fallback = senderFromApi(api);
      if (fallback) {
        setSenderOptions((current) => ({ ...current, [api.id]: [fallback] }));
        setStatus(`Infobip: ${message} Mostrando o remetente cadastrado manualmente como fallback.`);
      } else {
        setStatus(`Infobip: ${message}`);
      }
    } finally {
      setSyncingApiId("");
    }
  }

  async function integrateSender(sender: InfobipSender) {
    const nextSender = { ...sender, integratedAt: new Date().toISOString() };
    const next = [nextSender, ...integratedSenders.filter((item) => item.id !== sender.id)];
    writeIntegratedSenders(next);
    setIntegratedSenders(next);
    setStatus(`${sender.name || sender.sender} integrado ao Movy.`);
    const api = apis.find((item) => item.id === sender.apiId);
    if (api) {
      await infobipApis.update(api.id, {
        ...api,
        sender_number: sender.sender,
        senderNumber: sender.sender,
        sender_name: sender.name,
        integrated_senders: next.filter((item) => item.apiId === api.id),
      }).catch(() => null);
      await load();
    }
  }

  function removeIntegratedSender(sender: InfobipSender) {
    const next = integratedSenders.filter((item) => item.id !== sender.id);
    writeIntegratedSenders(next);
    setIntegratedSenders(next);
    setStatus(`${sender.name || sender.sender} removido dos remetentes integrados.`);
  }

  return (
    <main className="page template-page api-manager-page">
      <header className="template-heading">
        <div className="page-heading-icon">
          <Server size={22} />
        </div>
        <div>
          <h1>Gerenciar APIs</h1>
          <p>Configure contas Infobip, sincronize remetentes e escolha quais ficam disponiveis no Movy.</p>
        </div>
      </header>

      <section className="api-manager-shell">
        <aside className="api-manager-sidebar">
          <div className="card api-form-card api-connect-card">
            <h2><span className="card-title-icon"><KeyRound size={17} /></span> {form.id ? "Editar conexao" : "Nova conexao"}</h2>
            <div className="field">
              <label>Nome da conexao</label>
              <input className="input" placeholder="ex: Infobip principal" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div className="field">
              <label>Base URL</label>
              <input className="input" placeholder="https://xxxxx.api.infobip.com" value={form.baseUrl} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} />
            </div>
            <div className="field">
              <label>Token / API Key</label>
              <input className="input" placeholder="Cole o token da Infobip" value={form.token} onChange={(event) => setForm((current) => ({ ...current, token: event.target.value }))} />
            </div>
            <div className="field">
              <label>Remetente padrao</label>
              <input className="input" placeholder="Opcional: numero ou sender" value={form.senderNumber} onChange={(event) => setForm((current) => ({ ...current, senderNumber: event.target.value }))} />
            </div>
            <div className="button-row">
              <button className="button" disabled={saving} type="button" onClick={save}>
                {form.id ? <Save size={16} /> : <Plus size={16} />} {form.id ? "Salvar" : "Adicionar"}
              </button>
              {form.id ? <button className="button secondary" type="button" onClick={() => setForm(emptyForm)}>Cancelar</button> : null}
            </div>
            {status ? <p className="hint">{status}</p> : null}
          </div>

          <div className="card api-account-list-card">
            <div className="api-list-toolbar">
              <div>
                <h2>Conexoes</h2>
                <p>{filteredApis.length} de {apis.length} conta(s)</p>
              </div>
              <button className="button secondary compact" type="button" onClick={load}><RefreshCw size={15} /> Atualizar</button>
            </div>
            <label className="api-sender-filter">
              <Search size={15} />
              <input placeholder="Buscar conta, URL ou sender" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <div className="api-account-list">
              {filteredApis.map((api) => {
                const accountOptions = senderOptions[api.id] || cachedSendersFromApi(api);
                const accountConnected = integratedSenders.filter((item) => item.apiId === api.id);
                const accountSender = apiValue(api, "sender_number", "senderNumber", "phone_number");
                return (
                  <button className={`api-account-card ${selectedApi?.id === api.id ? "active" : ""}`} key={api.id} type="button" onClick={() => setSelectedApiId(api.id)}>
                    <span className="api-connection-icon"><Wifi size={16} /></span>
                    <span>
                      <strong>{labelOf(api, "API Infobip")}</strong>
                      <small>{accountSender || apiValue(api, "base_url", "baseUrl", "url") || "Sem remetente padrao"}</small>
                    </span>
                    <em>{accountConnected.length}/{accountOptions.length}</em>
                  </button>
                );
              })}
              {!filteredApis.length ? (
                <div className="api-sender-empty">Nenhuma conexao encontrada.</div>
              ) : null}
            </div>
          </div>
        </aside>

        <section className="card api-detail-card">
          {selectedApi ? (
            <>
              <div className="api-detail-header">
                <div className="api-detail-title">
                  <span className="api-connection-icon"><Server size={18} /></span>
                  <div>
                    <h2>{labelOf(selectedApi, "API Infobip")}</h2>
                    <p>{selectedBaseUrl || "Base URL nao informada"}</p>
                  </div>
                </div>
                <div className="button-row">
                  <button className="button secondary compact" type="button" onClick={() => edit(selectedApi)}>Editar</button>
                  <button className="button secondary compact" disabled={syncingApiId === selectedApi.id} type="button" onClick={() => syncSenders(selectedApi)}>
                    {syncingApiId === selectedApi.id ? <RefreshCw className="spin" size={14} /> : <Smartphone size={14} />} Sincronizar
                  </button>
                  <button className="button secondary compact danger" type="button" onClick={() => remove(selectedApi)}><Trash2 size={14} /> Remover</button>
                </div>
              </div>

              <div className="api-detail-stats">
                <div><span>Encontrados</span><strong>{selectedOptions.length}</strong></div>
                <div><span>Integrados</span><strong>{selectedConnected.length}</strong></div>
                <div><span>Token</span><strong>{tokenPreview(selectedToken)}</strong></div>
                <div><span>Ultimo sync</span><strong>{selectedLastSync || "Pendente"}</strong></div>
              </div>

              <div className="api-detail-meta">
                <span><CheckCircle2 size={14} /> {selectedSender ? `Padrao: ${selectedSender}` : "Sem remetente padrao"}</span>
                <span><KeyRound size={14} /> {selectedBaseUrl || "Configure a Base URL antes de sincronizar"}</span>
              </div>

              {selectedApi.last_sync_error ? <p className="hint">Ultima sincronizacao: {String(selectedApi.last_sync_error)}</p> : null}

              <div className="api-detail-grid">
                <div className="api-sender-panel">
                  <div className="api-panel-head">
                    <div>
                      <strong>Remetentes da conta</strong>
                      <span>{selectedVisibleOptions.length} visivel(is) de {selectedOptions.length}</span>
                    </div>
                  </div>
                  <label className="api-sender-filter">
                    <Search size={15} />
                    <input
                      placeholder="Filtrar por nome, numero, status ou canal"
                      value={selectedFilter}
                      onChange={(event) => setSenderFilters((current) => ({ ...current, [selectedApi.id]: event.target.value }))}
                    />
                  </label>
                  <div className="api-sender-scroll api-sender-results">
                    {selectedPagedOptions.map((option) => {
                      const isIntegrated = integratedSenders.some((item) => item.id === option.id);
                      return (
                        <div className="api-sender-row" key={option.id}>
                          <span className="api-connection-icon"><Smartphone size={16} /></span>
                          <div>
                            <strong>{senderLabel(option)}</strong>
                            <span>{option.channel || "WhatsApp"} - {option.status}</span>
                          </div>
                          <button className="button compact" disabled={isIntegrated} type="button" onClick={() => integrateSender(option)}>
                            <Link2 size={14} /> {isIntegrated ? "Integrado" : "Integrar"}
                          </button>
                        </div>
                      );
                    })}
                    {!selectedVisibleOptions.length ? <div className="api-sender-empty">Nenhum remetente encontrado nessa conta.</div> : null}
                  </div>
                  {selectedRemaining ? (
                    <div className="api-sender-footer">
                      <span>{selectedRemaining} remetente(s) oculto(s).</span>
                      <button className="button secondary compact" type="button" onClick={() => setSenderLimits((current) => ({ ...current, [selectedApi.id]: selectedLimit + SENDER_PAGE_SIZE }))}>
                        Mostrar mais {Math.min(SENDER_PAGE_SIZE, selectedRemaining)}
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="api-sender-panel api-integrated-panel">
                  <div className="api-panel-head">
                    <div>
                      <strong>Integrados no Movy</strong>
                      <span>Disponiveis em Templates e Flow Infobip</span>
                    </div>
                  </div>
                  <div className="api-integrated-scroll">
                    {selectedConnected.map((item) => (
                      <div className="api-sender-row integrated" key={item.id}>
                        <span className="api-connection-icon"><CheckCircle2 size={16} /></span>
                        <div>
                          <strong>{senderLabel(item)}</strong>
                          <span>{item.apiName} - pronto para uso</span>
                        </div>
                        <button className="button secondary compact" type="button" onClick={() => removeIntegratedSender(item)}>Remover</button>
                      </div>
                    ))}
                    {!selectedConnected.length ? <div className="api-sender-empty">Nenhum remetente integrado nessa conexao.</div> : null}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-sent-state">
              <strong>Nenhuma API cadastrada.</strong>
              <span>Adicione uma conexao Infobip para buscar e integrar remetentes.</span>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
