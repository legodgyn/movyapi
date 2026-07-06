import { CheckCircle2, KeyRound, Link2, Plus, RefreshCw, Save, Server, Smartphone, Trash2, Wifi } from "lucide-react";
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

function apiValue(api: InfobipApi, ...keys: string[]) {
  for (const key of keys) {
    const value = api[key];
    if (value) return String(value);
  }
  return "";
}

function tokenPreview(value: string) {
  if (!value) return "Token não informado";
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
    status: String(raw.status || raw.state || raw.enabled || "disponível"),
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

export function ApiManager() {
  const [apis, setApis] = useState<InfobipApi[]>([]);
  const [form, setForm] = useState<ApiForm>(emptyForm);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncingApiId, setSyncingApiId] = useState("");
  const [senderOptions, setSenderOptions] = useState<Record<string, InfobipSender[]>>({});
  const [integratedSenders, setIntegratedSenders] = useState<InfobipSender[]>(() => readIntegratedSenders());

  const filteredApis = useMemo(() => {
    const search = query.trim().toLowerCase();
    return apis.filter((api) => {
      const haystack = `${labelOf(api, "API")} ${api.api_type || ""} ${apiValue(api, "base_url", "baseUrl", "url")} ${apiValue(api, "sender_number", "senderNumber")}`.toLowerCase();
      return !search || haystack.includes(search);
    });
  }, [apis, query]);

  async function load() {
    setStatus("Atualizando APIs...");
    const items = await infobipApis.normalizedList().catch(() => []);
    setApis(items);
    setIntegratedSenders(readIntegratedSenders());
    setStatus(items.length ? `${items.length} API(s) cadastrada(s).` : "Nenhuma API cadastrada.");
  }

  useEffect(() => {
    load();
  }, []);

  function edit(api: InfobipApi) {
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
      setForm(emptyForm);
      setStatus("API salva. Ela já fica disponível na tela de Templates.");
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
      await load();
    } catch {
      setStatus("Não foi possível remover a API.");
    }
  }

  async function syncSenders(api: InfobipApi) {
    setSyncingApiId(api.id);
    setStatus(`Buscando remetentes de ${labelOf(api, "Infobip")}...`);
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
      setStatus(next.length ? `${next.length} remetente(s) encontrado(s). Escolha quais deseja sincronizar no sistema.` : "Nenhum remetente retornado pela Infobip.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao sincronizar remetentes.";
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
          <p>Configure os acessos usados por Templates, disparos e integrações externas.</p>
        </div>
      </header>

      <section className="api-manager-layout">
        <div className="card api-form-card">
          <h2><span className="card-title-icon"><KeyRound size={17} /></span> API Infobip</h2>
          <div className="grid cols-2">
            <div className="field">
              <label>Nome da conexão</label>
              <input className="input" placeholder="ex: Infobip principal" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div className="field">
              <label>Tipo</label>
              <select className="select" value={form.apiType} onChange={(event) => setForm((current) => ({ ...current, apiType: event.target.value }))}>
                <option value="INFOBIP">Infobip</option>
                <option value="CLOUD_API">Cloud API</option>
              </select>
            </div>
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
            <label>Remetente padrão</label>
            <input className="input" placeholder="Número, sender ou canal usado na Infobip" value={form.senderNumber} onChange={(event) => setForm((current) => ({ ...current, senderNumber: event.target.value }))} />
          </div>
          <div className="button-row">
            <button className="button" disabled={saving} type="button" onClick={save}>
              {form.id ? <Save size={16} /> : <Plus size={16} />} {form.id ? "Salvar alterações" : "Adicionar API"}
            </button>
            {form.id ? <button className="button secondary" type="button" onClick={() => setForm(emptyForm)}>Cancelar edição</button> : null}
          </div>
          {status ? <p className="hint">{status}</p> : null}
        </div>

        <div className="card api-list-card">
          <div className="api-list-toolbar">
            <div>
              <h2>Conexões cadastradas</h2>
              <p>Use a busca quando tiver muitas contas, remetentes e bases.</p>
            </div>
            <button className="button secondary compact" type="button" onClick={load}><RefreshCw size={15} /> Atualizar</button>
          </div>
          <input className="input" placeholder="Buscar por nome, URL, tipo ou remetente" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="api-card-list">
            {filteredApis.map((api) => {
              const baseUrl = apiValue(api, "base_url", "baseUrl", "url");
              const sender = apiValue(api, "sender_number", "senderNumber", "phone_number");
              const token = apiValue(api, "token", "api_key", "apiKey", "authorization");
              const cachedRows = Array.isArray(api.senders) ? api.senders : [];
              const cachedOptions = cachedRows
                .map((row, index) => normalizeSender(api, row as Record<string, unknown>, index))
                .filter((option) => option.sender || option.name);
              const options = senderOptions[api.id] || cachedOptions;
              const connected = integratedSenders.filter((item) => item.apiId === api.id);
              return (
                <article className="api-connection-card" key={api.id}>
                  <div className="api-connection-main">
                    <span className="api-connection-icon"><Wifi size={18} /></span>
                    <div>
                      <strong>{labelOf(api, "API Infobip")}</strong>
                      <span>{api.api_type || "INFOBIP"}{sender ? ` - ${sender}` : ""}</span>
                    </div>
                  </div>
                  <div className="api-connection-meta">
                    <span><CheckCircle2 size={14} /> {baseUrl || "Base URL não informada"}</span>
                    <span><KeyRound size={14} /> {tokenPreview(token)}</span>
                  </div>
                  {api.last_sync_error ? <p className="hint">Ultima sincronizacao: {String(api.last_sync_error)}</p> : null}
                  <div className="button-row">
                    <button className="button secondary compact" type="button" onClick={() => edit(api)}>Editar</button>
                    <button className="button secondary compact" disabled={syncingApiId === api.id} type="button" onClick={() => syncSenders(api)}>
                      {syncingApiId === api.id ? <RefreshCw className="spin" size={14} /> : <Smartphone size={14} />} Buscar remetentes
                    </button>
                    <button className="button secondary compact" type="button" onClick={() => remove(api)}><Trash2 size={14} /> Remover</button>
                  </div>
                  {options.length ? (
                    <div className="api-sender-picker">
                      <strong>Remetentes encontrados na Infobip</strong>
                      {options.map((option) => {
                        const isIntegrated = integratedSenders.some((item) => item.id === option.id);
                        return (
                          <div className="api-sender-row" key={option.id}>
                            <span className="api-connection-icon"><Smartphone size={16} /></span>
                            <div>
                              <strong>{option.name}</strong>
                              <span>{option.sender || "Sender sem numero"} - {option.status}</span>
                            </div>
                            <button className="button compact" disabled={isIntegrated} type="button" onClick={() => integrateSender(option)}>
                              <Link2 size={14} /> {isIntegrated ? "Sincronizado" : "Sincronizar no sistema"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {connected.length ? (
                    <div className="api-integrated-list">
                      <strong>Integrados no Movy</strong>
                      {connected.map((item) => (
                        <div className="api-sender-row integrated" key={item.id}>
                          <span className="api-connection-icon"><CheckCircle2 size={16} /></span>
                          <div>
                            <strong>{item.name}</strong>
                            <span>{item.sender} - pronto para Templates</span>
                          </div>
                          <button className="button secondary compact" type="button" onClick={() => removeIntegratedSender(item)}>Remover</button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
            {!filteredApis.length ? (
              <div className="empty-sent-state">
                <strong>Nenhuma API encontrada.</strong>
                <span>Cadastre uma conexão Infobip para liberar a criação de templates.</span>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
