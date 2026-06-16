import { FormEvent, useEffect, useMemo, useState } from "react";
import { BadgeCheck, Building2, Link2, Plus, RefreshCcw, Save, ShieldCheck, Smartphone, X } from "lucide-react";
import { readPersistentValue, writePersistentValue } from "../lib/persistentStorage";

const LOCAL_BM_SETTINGS_KEY = "scaleapi.bmSettings";
const LOCAL_BM_ACCOUNTS_KEY = "scaleapi.bmAccounts";
const GRAPH_API_BASE = "https://graph.facebook.com/v24.0";

type BmStatus = "draft" | "connected" | "error";

type MetaPhoneNumber = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  status?: string;
};

type BmAccount = {
  id: string;
  name: string;
  appId: string;
  accessToken: string;
  defaultWabaId: string;
  defaultPhoneNumberId: string;
  status: BmStatus;
  lastCheckedAt: string;
  phones: MetaPhoneNumber[];
};

type BmValidationDetail = {
  label: string;
  value: string;
  status: "ok" | "error" | "warn";
};

const emptyAccount: BmAccount = {
  id: "",
  name: "",
  appId: "",
  accessToken: "",
  defaultWabaId: "",
  defaultPhoneNumberId: "",
  status: "draft",
  lastCheckedAt: "",
  phones: [],
};

function legacyToAccount(): BmAccount | null {
  try {
    const legacy = JSON.parse(localStorage.getItem(LOCAL_BM_SETTINGS_KEY) || "{}");
    if (!legacy.defaultWabaId && !legacy.accessToken) return null;
    const phones = JSON.parse(localStorage.getItem("scaleapi.bmPhoneNumbers") || "[]");
    return {
      ...emptyAccount,
      id: legacy.defaultWabaId || `bm-${Date.now()}`,
      name: legacy.businessName || legacy.defaultWabaId || "BM conectada",
      appId: legacy.appId || "",
      accessToken: legacy.accessToken || "",
      defaultWabaId: legacy.defaultWabaId || "",
      defaultPhoneNumberId: legacy.defaultPhoneNumberId || phones?.[0]?.id || "",
      status: legacy.status || "draft",
      lastCheckedAt: legacy.lastCheckedAt || "",
      phones: Array.isArray(phones) ? phones : [],
    };
  } catch {
    return null;
  }
}

function readAccounts(): BmAccount[] {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_BM_ACCOUNTS_KEY) || "[]");
    if (Array.isArray(stored) && stored.length) return stored;
  } catch {
    // Keep compatibility with the single-BM version below.
  }
  const migrated = legacyToAccount();
  return migrated ? [migrated] : [];
}

function writeAccounts(accounts: BmAccount[], activeId?: string) {
  localStorage.setItem(LOCAL_BM_ACCOUNTS_KEY, JSON.stringify(accounts));
  const active = accounts.find((account) => account.id === activeId) || accounts.find((account) => account.status === "connected") || accounts[0];
  if (active) {
    localStorage.setItem(
      LOCAL_BM_SETTINGS_KEY,
      JSON.stringify({
        businessName: active.name,
        appId: active.appId,
        accessToken: active.accessToken,
        defaultWabaId: active.defaultWabaId,
        defaultPhoneNumberId: active.defaultPhoneNumberId,
        status: active.status,
        lastCheckedAt: active.lastCheckedAt,
      }),
    );
    localStorage.setItem("scaleapi.bmPhoneNumbers", JSON.stringify(active.phones || []));
  }
}

function persistAccountsRemote(accounts: BmAccount[], activeId?: string) {
  const active = accounts.find((account) => account.id === activeId) || accounts.find((account) => account.status === "connected") || accounts[0];
  void writePersistentValue(LOCAL_BM_ACCOUNTS_KEY, accounts);
  if (active) {
    void writePersistentValue(LOCAL_BM_SETTINGS_KEY, {
      businessName: active.name,
      appId: active.appId,
      accessToken: active.accessToken,
      defaultWabaId: active.defaultWabaId,
      defaultPhoneNumberId: active.defaultPhoneNumberId,
      status: active.status,
      lastCheckedAt: active.lastCheckedAt,
    });
    void writePersistentValue("scaleapi.bmPhoneNumbers", active.phones || []);
  }
}

function maskSecret(value: string) {
  if (!value.trim()) return "Nao informado";
  if (value.length <= 10) return "••••••";
  return `${value.slice(0, 5)}••••••${value.slice(-4)}`;
}

async function graphGet<T = Record<string, unknown>>(path: string, accessToken: string, params: Record<string, string> = {}) {
  const url = new URL(`${GRAPH_API_BASE}/${path.replace(/^\//, "")}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = data as { error?: { message?: string }; message?: string };
    throw new Error(record.error?.message || record.message || `Meta retornou HTTP ${response.status}`);
  }
  return data as T;
}

export function BmSettings() {
  const [accounts, setAccounts] = useState<BmAccount[]>(() => readAccounts());
  const [activeId, setActiveId] = useState(() => readAccounts().find((account) => account.status === "connected")?.id || readAccounts()[0]?.id || "");
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<BmAccount>(() => ({ ...emptyAccount, id: `bm-${Date.now()}` }));
  const [message, setMessage] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncing, setIsSyncing] = useState("");
  const [validationDetails, setValidationDetails] = useState<BmValidationDetail[]>([]);

  useEffect(() => {
    let mounted = true;
    readPersistentValue<BmAccount[]>(LOCAL_BM_ACCOUNTS_KEY, readAccounts()).then((remoteAccounts) => {
      if (!mounted || !Array.isArray(remoteAccounts) || !remoteAccounts.length) return;
      const nextActiveId = remoteAccounts.find((account) => account.status === "connected")?.id || remoteAccounts[0]?.id || "";
      setAccounts(remoteAccounts);
      setActiveId(nextActiveId);
      writeAccounts(remoteAccounts, nextActiveId);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const activeAccount = useMemo(
    () => accounts.find((account) => account.id === activeId) || accounts.find((account) => account.status === "connected") || accounts[0],
    [accounts, activeId],
  );

  const connectedCount = accounts.filter((account) => account.status === "connected").length;

  function persist(next: BmAccount[], nextActiveId = activeId) {
    setAccounts(next);
    setActiveId(nextActiveId);
    writeAccounts(next, nextActiveId);
    persistAccountsRemote(next, nextActiveId);
  }

  function openNewModal() {
    setDraft({ ...emptyAccount, id: `bm-${Date.now()}` });
    setValidationDetails([]);
    setMessage("");
    setModalOpen(true);
  }

  function openEditModal(account: BmAccount) {
    setDraft({ ...account, phones: account.phones || [] });
    setValidationDetails([]);
    setMessage("");
    setModalOpen(true);
  }

  async function validateAccount(account: BmAccount) {
    if (!account.accessToken.trim() || !account.defaultWabaId.trim()) {
      throw new Error("Preencha WABA ID e Access Token.");
    }
    const details: BmValidationDetail[] = [];
    const profile = await graphGet<{ id?: string; name?: string }>("me", account.accessToken, { fields: "id,name" });
    details.push({
      label: "Access Token",
      value: profile.name ? `${profile.name} (${profile.id})` : `Token ativo (${profile.id || "sem nome"})`,
      status: "ok",
    });

    const waba = await graphGet<{ id?: string; name?: string; account_review_status?: string }>(account.defaultWabaId, account.accessToken, {
      fields: "id,name,account_review_status",
    });
    details.push({
      label: "WABA",
      value: `${waba.name || waba.id || account.defaultWabaId}${waba.account_review_status ? ` - ${waba.account_review_status}` : ""}`,
      status: "ok",
    });

    return {
      details,
      account: {
        ...account,
        name: account.name || waba.name || account.defaultWabaId,
        status: "connected" as const,
        lastCheckedAt: new Date().toISOString(),
      },
    };
  }

  async function testDraft() {
    setIsTesting(true);
    setMessage("Testando conexao com a Meta...");
    try {
      const result = await validateAccount(draft);
      setDraft(result.account);
      setValidationDetails(result.details);
      setMessage("Conexao validada. Agora pode salvar essa BM.");
    } catch (error) {
      setDraft((current) => ({ ...current, status: "error", lastCheckedAt: new Date().toISOString() }));
      setValidationDetails([{ label: "Erro Meta", value: error instanceof Error ? error.message : "Falha desconhecida.", status: "error" }]);
      setMessage("Nao consegui validar essa BM.");
    } finally {
      setIsTesting(false);
    }
  }

  async function saveDraft(event?: FormEvent) {
    event?.preventDefault();
    const accountToSave = draft.status === "connected" ? draft : (await validateAccount(draft)).account;
    const next = accounts.some((account) => account.id === accountToSave.id)
      ? accounts.map((account) => (account.id === accountToSave.id ? accountToSave : account))
      : [...accounts, accountToSave];
    persist(next, accountToSave.id);
    setModalOpen(false);
    setMessage("BM salva e selecionada.");
  }

  async function syncAccount(account: BmAccount) {
    setIsSyncing(account.id);
    setMessage(`Sincronizando telefones da ${account.name || account.defaultWabaId}...`);
    try {
      const response = await graphGet<{ data?: MetaPhoneNumber[] }>(`${account.defaultWabaId}/phone_numbers`, account.accessToken, {
        fields: "id,display_phone_number,verified_name,quality_rating,status",
      });
      const phones = response.data || [];
      const updated = {
        ...account,
        phones,
        defaultPhoneNumberId: account.defaultPhoneNumberId || phones[0]?.id || "",
        status: "connected" as const,
        lastCheckedAt: new Date().toISOString(),
      };
      persist(accounts.map((item) => (item.id === account.id ? updated : item)), updated.id);
      setMessage(phones.length ? `${phones.length} telefone(s) sincronizado(s).` : "A WABA conectou, mas não retornou telefones.");
    } catch (error) {
      setMessage(error instanceof Error ? `Falha ao sincronizar: ${error.message}` : "Falha ao sincronizar telefones.");
    } finally {
      setIsSyncing("");
    }
  }

  function selectAccount(account: BmAccount) {
    persist(accounts, account.id);
    setMessage(`${account.name || account.defaultWabaId} selecionada como BM ativa.`);
  }

  function removeAccount(accountId: string) {
    const next = accounts.filter((account) => account.id !== accountId);
    persist(next, next[0]?.id || "");
    setMessage("BM removida.");
  }

  return (
    <main className="template-page bm-settings-page">
      <header className="template-heading">
        <div className="page-heading-icon">
          <Building2 size={24} />
        </div>
        <div>
          <h1>Configurações BM</h1>
          <p>Gerencie as BMs conectadas para templates, remetentes e disparos oficiais</p>
        </div>
        <button className="button" type="button" onClick={openNewModal}>
          <Plus size={17} />
          Adicionar BM
        </button>
      </header>

      <section className="bm-hero card">
        <div>
          <span className={connectedCount ? "status-pill status-done" : "status-pill status-draft"}>
            {connectedCount ? `${connectedCount} conectada(s)` : "Nenhuma BM conectada"}
          </span>
          <h2>{activeAccount?.name || "Configure sua primeira BM"}</h2>
          <p>A BM ativa alimenta automaticamente Meta Templates, remetentes e broadcasts.</p>
        </div>
        <div className="bm-score">
          <strong>{accounts.length}</strong>
          <span>BM(s)</span>
          <div className="bm-score-bar">
            <span style={{ width: `${accounts.length ? 100 : 0}%` }} />
          </div>
        </div>
      </section>

      {message ? <p className="bm-message">{message}</p> : null}

      <section className="card grid">
        <div className="bm-section-title">
          <ShieldCheck size={18} />
          <div>
            <h2>BMs conectadas</h2>
            <p>Selecione uma como ativa ou sincronize os telefones da WABA.</p>
          </div>
        </div>

        <div className="bm-account-grid">
          {accounts.map((account) => (
            <article className={`bm-account-card bm-connected-card ${activeAccount?.id === account.id ? "active" : ""}`} key={account.id}>
              <BadgeCheck size={18} />
              <div>
                <strong>{account.name || account.defaultWabaId}</strong>
                <span>WABA {account.defaultWabaId}</span>
                <span>Token {maskSecret(account.accessToken)}</span>
                <span>
                  {account.phones?.length
                    ? `${account.phones.length} telefone(s) - padrao ${account.defaultPhoneNumberId || account.phones[0]?.id}`
                    : "Telefones ainda não sincronizados"}
                </span>
              </div>
              <div className="bm-card-actions">
                <button className="button secondary compact" type="button" onClick={() => selectAccount(account)}>
                  Usar
                </button>
                <button className="button secondary compact" disabled={isSyncing === account.id} type="button" onClick={() => syncAccount(account)}>
                  <RefreshCcw size={14} />
                  {isSyncing === account.id ? "..." : "Sync"}
                </button>
                <button className="button secondary compact" type="button" onClick={() => openEditModal(account)}>
                  Editar
                </button>
                <button className="icon-button" type="button" onClick={() => removeAccount(account.id)} aria-label="Remover BM">
                  <X size={15} />
                </button>
              </div>
            </article>
          ))}

          {!accounts.length ? (
            <div className="bm-account-card">
              <Smartphone size={18} />
              <div>
                <strong>Nenhuma BM cadastrada</strong>
                <span>Clique em Adicionar BM para conectar a primeira conta.</span>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {modalOpen ? (
        <div className="modal-backdrop">
          <form className="card bm-modal" onSubmit={saveDraft}>
            <div className="section-title-row">
              <div className="bm-section-title">
                <Building2 size={18} />
                <div>
                  <h2>{draft.id && accounts.some((account) => account.id === draft.id) ? "Editar BM" : "Adicionar BM"}</h2>
                  <p>Preencha, teste a conexao e salve a conta.</p>
                </div>
              </div>
              <button className="icon-button" type="button" onClick={() => setModalOpen(false)} aria-label="Fechar">
                <X size={18} />
              </button>
            </div>

            <div className="grid cols-2">
              <label className="field">
                <span>Nome da BM</span>
                <input className="input" placeholder="Ex: Movy Oficial" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </label>
              <label className="field">
                <span>WABA ID</span>
                <input className="input" placeholder="ID da WhatsApp Business Account" value={draft.defaultWabaId} onChange={(event) => setDraft({ ...draft, defaultWabaId: event.target.value })} />
              </label>
              <label className="field">
                <span>App ID</span>
                <input className="input" placeholder="ID do app Meta" value={draft.appId} onChange={(event) => setDraft({ ...draft, appId: event.target.value })} />
              </label>
              <label className="field">
                <span>Access Token permanente</span>
                <textarea className="textarea bm-token-field" placeholder="Cole o token de acesso da Meta" value={draft.accessToken} onChange={(event) => setDraft({ ...draft, accessToken: event.target.value })} />
              </label>
            </div>

            <div className="button-row">
              <button className="button secondary" disabled={isTesting} type="button" onClick={testDraft}>
                <Link2 size={17} />
                {isTesting ? "Testando..." : "Testar conexao"}
              </button>
              <button className="button" type="submit">
                <Save size={17} />
                Salvar BM
              </button>
            </div>

            {validationDetails.length ? (
              <div className="bm-validation-list">
                {validationDetails.map((detail) => (
                  <div className={`bm-validation-item ${detail.status}`} key={detail.label}>
                    <span>{detail.label}</span>
                    <strong>{detail.value}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </form>
        </div>
      ) : null}
    </main>
  );
}
