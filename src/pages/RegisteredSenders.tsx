import { useMemo, useState } from "react";
import { CheckCircle2, Filter, Search, ShieldCheck, Smartphone, WifiOff } from "lucide-react";

const LOCAL_BM_SETTINGS_KEY = "scaleapi.bmSettings";
const LOCAL_BM_ACCOUNTS_KEY = "scaleapi.bmAccounts";
const LOCAL_CONNECTED_SENDERS_KEY = "movy.connectedSenders";

type MetaPhoneNumber = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  status?: string;
};

type BmAccount = {
  id?: string;
  name?: string;
  businessName?: string;
  defaultWabaId?: string;
  defaultPhoneNumberId?: string;
  phones?: MetaPhoneNumber[];
  connectedPhoneIds?: string[];
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

type SenderRow = {
  id: string;
  wabaId: string;
  bmId: string;
  bmName: string;
  phone: string;
  verifiedName: string;
  quality: string;
  status: string;
  connected: boolean;
  connectedAt?: string;
};

function accountKey(account: BmAccount, fallback = "") {
  return String(account.defaultWabaId || account.id || fallback).trim();
}

function accountName(account: BmAccount) {
  return account.name || account.businessName || account.defaultWabaId || "BM conectada";
}

function mergeAccounts(base: BmAccount, incoming: BmAccount) {
  const phoneMap = new Map<string, MetaPhoneNumber>();
  [...(base.phones || []), ...(incoming.phones || [])].forEach((phone) => {
    if (phone.id) phoneMap.set(phone.id, { ...phoneMap.get(phone.id), ...phone });
  });

  return {
    ...base,
    ...incoming,
    id: base.id || incoming.id,
    name: base.name || incoming.name,
    businessName: base.businessName || incoming.businessName,
    defaultWabaId: base.defaultWabaId || incoming.defaultWabaId,
    defaultPhoneNumberId: base.defaultPhoneNumberId || incoming.defaultPhoneNumberId,
    phones: Array.from(phoneMap.values()),
    connectedPhoneIds: Array.from(new Set([...(base.connectedPhoneIds || []), ...(incoming.connectedPhoneIds || [])])),
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
    const currentScore = (current.phones?.length || 0) * 10 + (current.name ? 2 : 0);
    const incomingScore = (account.phones?.length || 0) * 10 + (account.name ? 2 : 0);
    map.set(key, incomingScore > currentScore ? mergeAccounts(account, current) : mergeAccounts(current, account));
  });
  return Array.from(map.values());
}

function readAccounts() {
  const accounts: BmAccount[] = [];
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_BM_ACCOUNTS_KEY) || "[]");
    if (Array.isArray(stored)) accounts.push(...stored);
  } catch {
    // optional local data.
  }
  try {
    const legacy = JSON.parse(localStorage.getItem(LOCAL_BM_SETTINGS_KEY) || "{}") as BmAccount;
    if (legacy && (legacy.defaultWabaId || legacy.id)) accounts.push(legacy);
  } catch {
    // optional legacy data.
  }
  return dedupeAccounts(accounts);
}

function readConnectedSenders() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_CONNECTED_SENDERS_KEY) || "[]");
    return Array.isArray(stored) ? (stored as ConnectedSender[]) : [];
  } catch {
    return [];
  }
}

function phoneLabel(phone: MetaPhoneNumber) {
  return phone.display_phone_number || phone.id;
}

function statusLabel(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "CONNECTED") return "Conectado na Meta";
  if (normalized === "PENDING") return "Pendente na Meta";
  if (normalized === "DISCONNECTED") return "Desconectado";
  return status || "Sem status";
}

function qualityLabel(value: string) {
  const normalized = value.toUpperCase();
  if (normalized === "GREEN") return "Alta";
  if (normalized === "YELLOW") return "Media";
  if (normalized === "RED") return "Baixa";
  return value || "-";
}

export function RegisteredSenders() {
  const [accounts] = useState(() => readAccounts());
  const [connectedSenders] = useState(() => readConnectedSenders());
  const [selectedWaba, setSelectedWaba] = useState("all");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const senders = useMemo<SenderRow[]>(() => {
    const connectedByPhoneId = new Map(connectedSenders.map((sender) => [sender.phoneNumberId, sender]));
    const rows: SenderRow[] = [];

    accounts.forEach((account, index) => {
      const wabaId = account.defaultWabaId || "";
      const bmId = accountKey(account, String(index));
      const bmName = accountName(account);
      const connectedPhoneIds = new Set([...(account.connectedPhoneIds || []), ...connectedSenders.filter((sender) => sender.bmId === bmId || sender.wabaId === wabaId).map((sender) => sender.phoneNumberId)]);

      (account.phones || []).forEach((phone) => {
        const connected = connectedPhoneIds.has(phone.id) || connectedByPhoneId.has(phone.id);
        const connectedSender = connectedByPhoneId.get(phone.id);
        rows.push({
          id: phone.id,
          wabaId,
          bmId,
          bmName,
          phone: phoneLabel(phone),
          verifiedName: phone.verified_name || connectedSender?.verifiedName || "",
          quality: phone.quality_rating || connectedSender?.quality || "",
          status: phone.status || "",
          connected,
          connectedAt: connectedSender?.connectedAt,
        });
      });
    });

    connectedSenders.forEach((sender) => {
      if (rows.some((row) => row.id === sender.phoneNumberId)) return;
      rows.push({
        id: sender.phoneNumberId,
        wabaId: sender.wabaId,
        bmId: sender.bmId,
        bmName: sender.bmName,
        phone: sender.phone,
        verifiedName: sender.verifiedName,
        quality: sender.quality,
        status: "CONNECTED",
        connected: true,
        connectedAt: sender.connectedAt,
      });
    });

    return rows;
  }, [accounts, connectedSenders]);

  const filteredSenders = useMemo(() => {
    const search = query.trim().toLowerCase();
    return senders.filter((sender) => {
      const matchesWaba = selectedWaba === "all" || sender.wabaId === selectedWaba;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "movy" && sender.connected) ||
        (statusFilter === "pending" && !sender.connected) ||
        String(sender.status || "").toLowerCase() === statusFilter;
      const matchesSearch =
        !search ||
        sender.phone.toLowerCase().includes(search) ||
        sender.verifiedName.toLowerCase().includes(search) ||
        sender.bmName.toLowerCase().includes(search) ||
        sender.wabaId.toLowerCase().includes(search) ||
        sender.id.toLowerCase().includes(search);
      return matchesWaba && matchesStatus && matchesSearch;
    });
  }, [query, selectedWaba, senders, statusFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, SenderRow[]>();
    filteredSenders.forEach((sender) => {
      const key = sender.wabaId || sender.bmId || "sem-waba";
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(sender);
    });
    return Array.from(map.entries()).map(([wabaId, rows]) => ({
      wabaId,
      bmName: rows[0]?.bmName || "BM conectada",
      rows: rows.sort((a, b) => a.phone.localeCompare(b.phone, "pt-BR")),
    }));
  }, [filteredSenders]);

  const totalConnected = senders.filter((sender) => sender.connected).length;
  const totalPending = Math.max(0, senders.length - totalConnected);

  return (
    <main className="template-page registered-senders-page">
      <header className="template-heading">
        <div className="page-heading-icon">
          <Smartphone size={24} />
        </div>
        <div>
          <h1>Remetentes</h1>
          <p>Visualize todos os numeros por WABA e acompanhe quais ja estao conectados ao Movy Api.</p>
        </div>
      </header>

      <section className="registered-senders-summary">
        <div className="metric-card">
          <span>Total de numeros</span>
          <strong>{senders.length.toLocaleString("pt-BR")}</strong>
          <small>{accounts.length.toLocaleString("pt-BR")} WABA(s)</small>
        </div>
        <div className="metric-card success">
          <span>Movy conectados</span>
          <strong>{totalConnected.toLocaleString("pt-BR")}</strong>
          <small>Prontos para Broadcast e CRM</small>
        </div>
        <div className="metric-card danger">
          <span>Pendentes</span>
          <strong>{totalPending.toLocaleString("pt-BR")}</strong>
          <small>Precisam registrar/conectar</small>
        </div>
      </section>

      <section className="card registered-senders-toolbar">
        <label className="search-field">
          <Search size={16} />
          <input placeholder="Buscar por numero, nome, WABA ou phone id..." value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label className="field">
          <span>WABA</span>
          <select className="select" value={selectedWaba} onChange={(event) => setSelectedWaba(event.target.value)}>
            <option value="all">Todas as WABAs</option>
            {accounts.map((account, index) => {
              const wabaId = account.defaultWabaId || accountKey(account, String(index));
              return (
                <option key={wabaId} value={wabaId}>
                  {accountName(account)} - {wabaId}
                </option>
              );
            })}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Todos</option>
            <option value="movy">Movy conectados</option>
            <option value="pending">Pendentes</option>
            <option value="connected">Conectado na Meta</option>
          </select>
        </label>
      </section>

      <section className="registered-waba-list">
        {grouped.map((group) => (
          <article className="card registered-waba-card" key={group.wabaId}>
            <div className="registered-waba-header">
              <div>
                <span className="eyebrow">
                  <Filter size={13} />
                  WABA
                </span>
                <h2>{group.bmName}</h2>
                <p>{group.wabaId}</p>
              </div>
              <div className="registered-waba-count">
                <strong>{group.rows.length}</strong>
                <span>numero(s)</span>
              </div>
            </div>

            <div className="registered-sender-list">
              {group.rows.map((sender) => (
                <div className="registered-sender-row" key={sender.id}>
                  <span className={`registered-sender-icon ${sender.connected ? "connected" : ""}`}>
                    {sender.connected ? <CheckCircle2 size={18} /> : <WifiOff size={18} />}
                  </span>
                  <div className="registered-sender-main">
                    <strong>{sender.phone}</strong>
                    <span>{sender.verifiedName || "Nome verificado nao informado"}</span>
                  </div>
                  <div className="registered-sender-meta">
                    <small>Phone ID</small>
                    <strong>{sender.id}</strong>
                  </div>
                  <div className="registered-sender-meta">
                    <small>Qualidade</small>
                    <strong>{qualityLabel(sender.quality)}</strong>
                  </div>
                  <span className={`sender-status-pill ${sender.connected ? "connected" : ""}`}>
                    {sender.connected ? "Movy conectado" : statusLabel(sender.status)}
                  </span>
                </div>
              ))}
            </div>
          </article>
        ))}

        {!grouped.length ? (
          <section className="card empty-state subtle-empty-state">
            <Smartphone size={30} />
            <strong>Nenhum remetente encontrado</strong>
            <span>Sincronize os numeros em Registrar Remetente ou revise os filtros aplicados.</span>
          </section>
        ) : null}
      </section>
    </main>
  );
}
