import { useMemo, useState } from "react";
import { BadgeCheck, CheckCircle2, Loader2, PlugZap, RefreshCcw, ShieldCheck, Smartphone } from "lucide-react";

const LOCAL_BM_SETTINGS_KEY = "scaleapi.bmSettings";
const LOCAL_BM_ACCOUNTS_KEY = "scaleapi.bmAccounts";
const LOCAL_CONNECTED_SENDERS_KEY = "movy.connectedSenders";
const GRAPH_API_BASE = "https://graph.facebook.com/v24.0";

type MetaPhoneNumber = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  status?: string;
};

type BmAccount = {
  id: string;
  name?: string;
  businessName?: string;
  accessToken?: string;
  defaultWabaId?: string;
  defaultPhoneNumberId?: string;
  status?: string;
  phones?: MetaPhoneNumber[];
  connectedPhoneIds?: string[];
  lastCheckedAt?: string;
};

type ConnectedSender = {
  id: string;
  bmId: string;
  bmName: string;
  wabaId: string;
  phoneNumberId: string;
  phone: string;
  verifiedName: string;
  quality: string;
  connectedAt: string;
};

function accountKey(account: BmAccount, fallback = "") {
  return String(account.defaultWabaId || account.id || fallback).trim();
}

function mergeAccounts(base: BmAccount, incoming: BmAccount) {
  const basePhones = base.phones || [];
  const incomingPhones = incoming.phones || [];
  const phoneMap = new Map<string, MetaPhoneNumber>();
  [...basePhones, ...incomingPhones].forEach((phone) => {
    if (phone.id) phoneMap.set(phone.id, { ...phoneMap.get(phone.id), ...phone });
  });
  const connectedPhoneIds = Array.from(new Set([...(base.connectedPhoneIds || []), ...(incoming.connectedPhoneIds || [])]));

  return {
    ...base,
    ...incoming,
    id: base.id || incoming.id,
    name: base.name || incoming.name,
    businessName: base.businessName || incoming.businessName,
    accessToken: base.accessToken || incoming.accessToken,
    defaultWabaId: base.defaultWabaId || incoming.defaultWabaId,
    defaultPhoneNumberId: base.defaultPhoneNumberId || incoming.defaultPhoneNumberId,
    phones: Array.from(phoneMap.values()),
    connectedPhoneIds,
    lastCheckedAt: base.lastCheckedAt || incoming.lastCheckedAt,
  };
}

function dedupeAccounts(accounts: BmAccount[]) {
  const map = new Map<string, BmAccount>();
  accounts.forEach((account, index) => {
    const key = accountKey(account, String(index));
    const current = map.get(key);
    if (!current) {
      map.set(key, account);
      return;
    }
    const currentScore = (current.phones?.length || 0) * 10 + (current.accessToken ? 4 : 0) + (current.name ? 2 : 0);
    const incomingScore = (account.phones?.length || 0) * 10 + (account.accessToken ? 4 : 0) + (account.name ? 2 : 0);
    map.set(key, incomingScore > currentScore ? mergeAccounts(account, current) : mergeAccounts(current, account));
  });
  return Array.from(map.values());
}

function readAccounts(): BmAccount[] {
  const accounts: BmAccount[] = [];
  try {
    const storedAccounts = JSON.parse(localStorage.getItem(LOCAL_BM_ACCOUNTS_KEY) || "[]");
    if (Array.isArray(storedAccounts)) accounts.push(...storedAccounts);
  } catch {
    // optional local config.
  }
  try {
    const legacy = JSON.parse(localStorage.getItem(LOCAL_BM_SETTINGS_KEY) || "{}") as BmAccount;
    if (legacy && (legacy.accessToken || legacy.defaultWabaId)) accounts.push(legacy);
  } catch {
    // optional legacy config.
  }

  return dedupeAccounts(accounts);
}

function persistAccounts(accounts: BmAccount[]) {
  const uniqueAccounts = dedupeAccounts(accounts);
  localStorage.setItem(LOCAL_BM_ACCOUNTS_KEY, JSON.stringify(uniqueAccounts));
  const active = uniqueAccounts[0];
  if (active) {
    localStorage.setItem(LOCAL_BM_SETTINGS_KEY, JSON.stringify(active));
    localStorage.setItem("scaleapi.bmPhoneNumbers", JSON.stringify(active.phones || []));
  }
}

function readConnectedSenders() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_CONNECTED_SENDERS_KEY) || "[]");
    return Array.isArray(stored) ? (stored as ConnectedSender[]) : [];
  } catch {
    return [];
  }
}

function writeConnectedSenders(senders: ConnectedSender[]) {
  localStorage.setItem(LOCAL_CONNECTED_SENDERS_KEY, JSON.stringify(senders));
}

async function graphGet<T = Record<string, unknown>>(path: string, token: string, params: Record<string, string> = {}) {
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

async function graphPost<T = Record<string, unknown>>(path: string, token: string, body: unknown) {
  const response = await fetch(`${GRAPH_API_BASE}/${path.replace(/^\//, "")}`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = data as { error?: { message?: string; error_user_msg?: string }; message?: string };
    throw new Error(record.error?.error_user_msg || record.error?.message || record.message || `Meta retornou HTTP ${response.status}`);
  }
  return data as T;
}

function accountName(account: BmAccount) {
  return account.name || account.businessName || account.defaultWabaId || "BM conectada";
}

function phoneLabel(phone: MetaPhoneNumber) {
  return phone.display_phone_number || phone.id;
}

function normalizePhoneStatus(status?: string) {
  const value = String(status || "").toUpperCase();
  if (value === "CONNECTED") return "Conectado";
  if (value === "PENDING") return "Pendente";
  if (value === "DISCONNECTED") return "Desconectado";
  return value || "Sem status";
}

export function SenderRegistration() {
  const initialAccounts = useMemo(() => readAccounts(), []);
  const [accounts, setAccounts] = useState<BmAccount[]>(initialAccounts);
  const [selectedAccountId, setSelectedAccountId] = useState(() => accountKey(initialAccounts[0] || {}, ""));
  const [selectedPhoneId, setSelectedPhoneId] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [syncingAccountId, setSyncingAccountId] = useState("");
  const [registeringPhoneId, setRegisteringPhoneId] = useState("");
  const [connectedSenders, setConnectedSenders] = useState<ConnectedSender[]>(() => readConnectedSenders());

  const selectedAccount = useMemo(
    () => accounts.find((account, index) => accountKey(account, String(index)) === selectedAccountId) || accounts[0],
    [accounts, selectedAccountId],
  );
  const selectedPhone = selectedAccount?.phones?.find((phone) => phone.id === selectedPhoneId) || selectedAccount?.phones?.[0];
  const connectedPhoneIds = new Set([
    ...(selectedAccount?.connectedPhoneIds || []),
    ...connectedSenders.filter((sender) => sender.bmId === accountKey(selectedAccount || {}, "")).map((sender) => sender.phoneNumberId),
  ]);

  function updateAccounts(nextAccounts: BmAccount[]) {
    const uniqueAccounts = dedupeAccounts(nextAccounts);
    setAccounts(uniqueAccounts);
    persistAccounts(uniqueAccounts);
  }

  async function syncPhones(account: BmAccount) {
    if (!account.accessToken || !account.defaultWabaId) {
      setMessage("Essa BM precisa de WABA ID e token antes de sincronizar telefones.");
      return;
    }

    setSyncingAccountId(accountKey(account, ""));
    setMessage(`Sincronizando telefones da ${accountName(account)}...`);
    try {
      const response = await graphGet<{ data?: MetaPhoneNumber[] }>(`${account.defaultWabaId}/phone_numbers`, account.accessToken, {
        fields: "id,display_phone_number,verified_name,quality_rating,status",
      });
      const phones = response.data || [];
      const updatedAccount = {
        ...account,
        phones,
        defaultPhoneNumberId: account.defaultPhoneNumberId || phones[0]?.id || "",
        lastCheckedAt: new Date().toISOString(),
      };
      const accountId = accountKey(account, "");
      const nextAccounts = accounts.map((item, index) => (accountKey(item, String(index)) === accountId ? updatedAccount : item));
      updateAccounts(nextAccounts);
      setSelectedAccountId(accountKey(updatedAccount, ""));
      setSelectedPhoneId(phones[0]?.id || "");
      setMessage(phones.length ? `${phones.length} telefone(s) encontrado(s).` : "A WABA nao retornou telefones.");
    } catch (error) {
      setMessage(error instanceof Error ? `Falha ao sincronizar: ${error.message}` : "Falha ao sincronizar telefones.");
    } finally {
      setSyncingAccountId("");
    }
  }

  async function registerPhone() {
    if (!selectedAccount || !selectedPhone) {
      setMessage("Selecione uma BM e um telefone.");
      return;
    }
    if (!selectedAccount.accessToken) {
      setMessage("Essa BM nao tem token salvo.");
      return;
    }
    if (!/^\d{6}$/.test(pin.trim())) {
      setMessage("Informe o PIN de 6 digitos configurado para esse numero.");
      return;
    }

    setRegisteringPhoneId(selectedPhone.id);
    setMessage(`Registrando ${phoneLabel(selectedPhone)} na Cloud API...`);
    try {
      await graphPost(`${selectedPhone.id}/register`, selectedAccount.accessToken, {
        messaging_product: "whatsapp",
        pin: pin.trim(),
      });

      const bmId = accountKey(selectedAccount, "");
      const nextSender: ConnectedSender = {
        id: `${bmId}-${selectedPhone.id}`,
        bmId,
        bmName: accountName(selectedAccount),
        wabaId: selectedAccount.defaultWabaId || "",
        phoneNumberId: selectedPhone.id,
        phone: phoneLabel(selectedPhone),
        verifiedName: selectedPhone.verified_name || "",
        quality: selectedPhone.quality_rating || "",
        connectedAt: new Date().toISOString(),
      };
      const nextConnected = [
        nextSender,
        ...connectedSenders.filter((sender) => sender.id !== nextSender.id),
      ];
      setConnectedSenders(nextConnected);
      writeConnectedSenders(nextConnected);

      const nextAccounts = accounts.map((account) => {
        if (accountKey(account, "") !== bmId) return account;
        return {
          ...account,
          defaultPhoneNumberId: selectedPhone.id,
          connectedPhoneIds: Array.from(new Set([...(account.connectedPhoneIds || []), selectedPhone.id])),
          lastCheckedAt: new Date().toISOString(),
        };
      });
      updateAccounts(nextAccounts);
      setMessage(`${phoneLabel(selectedPhone)} conectado ao Movy Api.`);
      void syncPhones({ ...selectedAccount, defaultPhoneNumberId: selectedPhone.id });
    } catch (error) {
      setMessage(error instanceof Error ? `Erro Meta: ${error.message}` : "Falha ao registrar o telefone.");
    } finally {
      setRegisteringPhoneId("");
    }
  }

  return (
    <main className="template-page sender-registration-page">
      <header className="template-heading">
        <div className="page-heading-icon">
          <PlugZap size={24} />
        </div>
        <div>
          <h1>Registrar Remetente</h1>
          <p>Conecte o numero da WABA ao Movy Api para enviar e receber eventos da Cloud API.</p>
        </div>
      </header>

      {message ? <p className="bm-message">{message}</p> : null}

      <section className="sender-connect-grid">
        <div className="card sender-account-panel">
          <div className="bm-section-title">
            <ShieldCheck size={18} />
            <div>
              <h2>BMs conectadas</h2>
              <p>Escolha a BM/WABA onde o numero esta pendente.</p>
            </div>
          </div>

          <div className="sender-account-list">
            {accounts.map((account, index) => {
              const id = accountKey(account, String(index));
              const selected = id === accountKey(selectedAccount || {}, "");
              return (
                <button className={`sender-account-card ${selected ? "active" : ""}`} key={id} onClick={() => setSelectedAccountId(id)} type="button">
                  <span>
                    <strong>{accountName(account)}</strong>
                    <small>WABA {account.defaultWabaId || "-"}</small>
                  </span>
                  <em>{account.phones?.length || 0} numero(s)</em>
                </button>
              );
            })}
            {!accounts.length ? (
              <div className="empty-helper">
                <p>Nenhuma BM configurada. Cadastre a BM em Configuracoes BM primeiro.</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="card sender-phone-panel">
          <div className="contacts-card-header">
            <div className="bm-section-title">
              <Smartphone size={18} />
              <div>
                <h2>Numeros da WABA</h2>
                <p>Sincronize, selecione o numero e registre com o PIN.</p>
              </div>
            </div>
            <button className="button secondary" disabled={!selectedAccount || Boolean(syncingAccountId)} onClick={() => selectedAccount && void syncPhones(selectedAccount)} type="button">
              {syncingAccountId ? <Loader2 className="spin-icon" size={16} /> : <RefreshCcw size={16} />}
              Sincronizar
            </button>
          </div>

          <div className="sender-phone-list">
            {(selectedAccount?.phones || []).map((phone) => {
              const connected = connectedPhoneIds.has(phone.id);
              const selected = (selectedPhone?.id || selectedAccount?.defaultPhoneNumberId) === phone.id;
              return (
                <button className={`sender-phone-card ${selected ? "active" : ""}`} key={phone.id} onClick={() => setSelectedPhoneId(phone.id)} type="button">
                  <span className="sender-phone-icon">
                    {connected ? <CheckCircle2 size={18} /> : <Smartphone size={18} />}
                  </span>
                  <span>
                    <strong>{phoneLabel(phone)}</strong>
                    <small>{phone.verified_name || "Nome verificado nao informado"}</small>
                  </span>
                  <span className={`sender-status-pill ${connected ? "connected" : ""}`}>{connected ? "Movy conectado" : normalizePhoneStatus(phone.status)}</span>
                </button>
              );
            })}
            {selectedAccount && !selectedAccount.phones?.length ? (
              <div className="empty-helper">
                <p>Nenhum numero carregado. Clique em sincronizar para buscar na Meta.</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="card sender-register-panel">
        <div className="bm-section-title">
          <BadgeCheck size={18} />
          <div>
            <h2>Conectar numero ao Movy Api</h2>
            <p>Use o PIN de 6 digitos do numero. Apos registrar, esse remetente fica pronto para Broadcast e CRM.</p>
          </div>
        </div>

        <div className="sender-register-form">
          <label className="field">
            <span>Telefone selecionado</span>
            <input className="input" readOnly value={selectedPhone ? `${phoneLabel(selectedPhone)} - ${selectedPhone.id}` : "Nenhum telefone selecionado"} />
          </label>
          <label className="field">
            <span>PIN de 6 digitos</span>
            <input className="input" inputMode="numeric" maxLength={6} placeholder="123456" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} />
          </label>
          <button className="button" disabled={!selectedPhone || Boolean(registeringPhoneId)} onClick={registerPhone} type="button">
            {registeringPhoneId ? <Loader2 className="spin-icon" size={17} /> : <PlugZap size={17} />}
            Registrar na Cloud API
          </button>
        </div>

        <div className="sender-connected-list">
          <h3>Remetentes conectados</h3>
          {connectedSenders.map((sender) => (
            <div className="sender-connected-row" key={sender.id}>
              <strong>{sender.phone}</strong>
              <span>{sender.bmName}</span>
              <small>{sender.phoneNumberId}</small>
            </div>
          ))}
          {!connectedSenders.length ? <p className="muted">Nenhum remetente conectado ao Movy Api ainda.</p> : null}
        </div>
      </section>
    </main>
  );
}
