import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, CheckCircle2, Download, Filter, Search, Send, TrendingUp, Workflow, XCircle } from "lucide-react";
import { analytics, broadcasts } from "../lib/services";

type SenderMetric = {
  key: string;
  bm: string;
  wabaId: string;
  user: string;
  sender: string;
  phone: string;
  sent: number;
  accepted: number;
  delivered: number;
  pending: number;
  failed: number;
  flows: number;
  lots: number;
  lastAt?: string;
};

const LOCAL_BROADCAST_RUN_KEY = "scaleapi.broadcastRun";
const LOCAL_BROADCAST_PAYLOAD_KEY = "scaleapi.broadcastLastPayload";

function numberOf(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function textOf(record: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return fallback;
}

function unwrapList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["data", "items", "results", "rows", "broadcasts", "transmissions"]) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  }
  return [];
}

function safeJson(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

function periodStart(period: string) {
  const now = new Date();
  if (period === "Últimas 24h") return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (period === "Últimos 7 dias") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === "Últimos 30 dias") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (period === "Este mês") return new Date(now.getFullYear(), now.getMonth(), 1);
  return null;
}

function inPeriod(value: unknown, period: string) {
  const start = periodStart(period);
  if (!start || !value) return true;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return true;
  return date >= start;
}

function metricKey(row: Pick<SenderMetric, "bm" | "wabaId" | "user" | "sender" | "phone">) {
  return [row.bm, row.wabaId, row.user, row.sender, row.phone].map((value) => String(value || "").toLowerCase()).join("|");
}

function fromAnalyticsItem(item: Record<string, unknown>, index: number): SenderMetric {
  const senderObject = (item.sender && typeof item.sender === "object" ? item.sender : {}) as Record<string, unknown>;
  const bm = textOf(item, ["bm", "bmName", "businessName", "business_name", "waba_name", "owner", "created_by"], textOf(senderObject, ["bmName", "businessName"], "BM não informada"));
  const sender = textOf(item, ["sender", "senderName", "name", "label"], textOf(senderObject, ["name", "verifiedName"], `Remetente ${index + 1}`));
  const phone = textOf(item, ["phone", "telefone", "number", "sender_number", "phoneNumber"], textOf(senderObject, ["phoneNumber", "sender_number"], ""));
  const sent = numberOf(item.sent ?? item.enviados ?? item.total ?? item.total_count ?? item.sent_count ?? item.recipients);
  const accepted = numberOf(item.accepted ?? item.aceitos ?? item.accepted_count);
  const delivered = numberOf(item.delivered ?? item.entregues ?? item.delivered_count);
  const failed = numberOf(item.failed ?? item.falhas ?? item.failed_count);
  const pending = numberOf(item.pending ?? item.pendentes ?? Math.max(0, sent - delivered - failed));
  const metric = {
    key: "",
    bm,
    wabaId: textOf(item, ["wabaId", "waba_id"], textOf(senderObject, ["wabaId"], "")),
    user: textOf(item, ["user", "usuario", "created_by", "createdBy", "owner", "operator"], "-"),
    sender,
    phone,
    sent,
    accepted,
    delivered,
    pending,
    failed,
    flows: numberOf(item.flows ?? item.flow_count ?? item.fluxos),
    lots: numberOf(item.lots ?? item.batches ?? item.lotes ?? 1),
    lastAt: textOf(item, ["createdAt", "created_at", "updatedAt", "updated_at", "startedAt"], ""),
  };
  metric.key = metricKey(metric);
  return metric;
}

function fromBroadcastItem(item: Record<string, unknown>, index: number): SenderMetric {
  const senderObject = (item.sender && typeof item.sender === "object" ? item.sender : {}) as Record<string, unknown>;
  const totals = (item.totals && typeof item.totals === "object" ? item.totals : {}) as Record<string, unknown>;
  const run = (item.run && typeof item.run === "object" ? item.run : item) as Record<string, unknown>;
  const bm = textOf(senderObject, ["bmName", "businessName"], textOf(item, ["bm", "bmName", "businessName"], "BM não informada"));
  const sender = textOf(senderObject, ["name", "verifiedName"], textOf(item, ["sender", "senderName", "name"], `Broadcast ${index + 1}`));
  const sent = numberOf(run.total ?? item.total ?? totals.contacts ?? item.recipients_count);
  const failed = numberOf(run.failed ?? item.failed ?? item.failed_count);
  const delivered = numberOf(run.delivered ?? item.delivered ?? item.delivered_count);
  const accepted = numberOf(run.accepted ?? item.accepted ?? item.accepted_count);
  const pending = numberOf(run.pending ?? item.pending ?? Math.max(0, sent - delivered - failed));
  const metric = {
    key: "",
    bm,
    wabaId: textOf(senderObject, ["wabaId", "waba_id"], textOf(item, ["wabaId", "waba_id"], "")),
    user: textOf(item, ["user", "usuario", "created_by", "createdBy", "owner", "operator"], "-"),
    sender,
    phone: textOf(senderObject, ["phoneNumber", "phone", "senderNumber"], textOf(item, ["phone", "sender_number"], "")),
    sent,
    accepted,
    delivered,
    pending,
    failed,
    flows: numberOf(item.flows ?? item.flow_count ?? 0),
    lots: numberOf(totals.lots ?? item.lots ?? 1),
    lastAt: textOf(item, ["createdAt", "created_at", "startedAt", "updatedAt", "updated_at"], ""),
  };
  metric.key = metricKey(metric);
  return metric;
}

function localBroadcastMetric(): SenderMetric | null {
  const payload = safeJson(LOCAL_BROADCAST_PAYLOAD_KEY);
  const run = safeJson(LOCAL_BROADCAST_RUN_KEY);
  if (!payload && !run) return null;
  const senderObject = (payload?.sender && typeof payload.sender === "object" ? payload.sender : {}) as Record<string, unknown>;
  const totals = (payload?.totals && typeof payload.totals === "object" ? payload.totals : {}) as Record<string, unknown>;
  const sent = numberOf(run?.total ?? totals.contacts);
  const accepted = numberOf(run?.accepted);
  const delivered = numberOf(run?.delivered);
  const failed = numberOf(run?.failed);
  const pending = numberOf(run?.pending ?? Math.max(0, sent - delivered - failed));
  if (!sent && !accepted && !delivered && !failed) return null;
  const metric = {
    key: "",
    bm: textOf(senderObject, ["bmName", "businessName"], "BM não informada"),
    wabaId: textOf(senderObject, ["wabaId", "waba_id"], ""),
    user: textOf(payload || {}, ["user", "usuario", "created_by", "createdBy", "owner", "operator"], "local"),
    sender: textOf(senderObject, ["name", "verifiedName"], "Último broadcast local"),
    phone: textOf(senderObject, ["phoneNumber", "phone", "senderNumber"], ""),
    sent,
    accepted,
    delivered,
    pending,
    failed,
    flows: 0,
    lots: numberOf(totals.lots ?? 1),
    lastAt: textOf(payload || {}, ["createdAt", "created_at"], textOf(run || {}, ["startedAt"], "")),
  };
  metric.key = metricKey(metric);
  return metric;
}

function mergeMetrics(metrics: SenderMetric[]) {
  const map = new Map<string, SenderMetric>();
  metrics.forEach((metric) => {
    if (!metric.sent && !metric.accepted && !metric.delivered && !metric.failed && !metric.pending) return;
    const current = map.get(metric.key);
    if (!current) {
      map.set(metric.key, metric);
      return;
    }
    map.set(metric.key, {
      ...current,
      sent: current.sent + metric.sent,
      accepted: current.accepted + metric.accepted,
      delivered: current.delivered + metric.delivered,
      pending: current.pending + metric.pending,
      failed: current.failed + metric.failed,
      flows: current.flows + metric.flows,
      lots: current.lots + metric.lots,
      lastAt: [current.lastAt, metric.lastAt].filter(Boolean).sort().slice(-1)[0],
    });
  });
  return Array.from(map.values()).sort((a, b) => b.sent - a.sent);
}

function compact(value: number) {
  return value.toLocaleString("pt-BR");
}

function rate(row: SenderMetric) {
  if (!row.sent) return 0;
  return Math.round((row.delivered / row.sent) * 1000) / 10;
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function senderDisplay(row: SenderMetric) {
  return row.phone ? `${row.sender} - ${row.phone}` : row.sender;
}

export function Analytics() {
  const [rows, setRows] = useState<SenderMetric[]>([]);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("Últimas 24h");
  const [senderFilter, setSenderFilter] = useState("Todos os remetentes");
  const [bmFilter, setBmFilter] = useState("Todas as BMs");
  const [userFilter, setUserFilter] = useState("Todos os usuários");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  async function load() {
    setLoading(true);
    setStatus("Buscando dados reais dos disparos...");
    try {
      const [analyticsPayload, broadcastRows] = await Promise.all([
        analytics.transmissions({ period, sender: senderFilter, bm: bmFilter, user: userFilter }).catch(() => null),
        broadcasts.normalizedList({ period }).catch(() => []),
      ]);
      const analyticsRows = unwrapList(analyticsPayload)
        .filter((item) => inPeriod(item.createdAt ?? item.created_at ?? item.startedAt ?? item.updated_at, period))
        .map(fromAnalyticsItem);
      const normalizedBroadcasts = broadcastRows
        .filter((item) => inPeriod(item.createdAt ?? item.created_at ?? item.startedAt ?? item.updated_at, period))
        .map(fromBroadcastItem);
      const local = localBroadcastMetric();
      const localRows = local && inPeriod(local.lastAt, period) ? [local] : [];
      const merged = mergeMetrics([...analyticsRows, ...normalizedBroadcasts, ...localRows]);
      setRows(merged);
      setStatus(merged.length ? `${merged.length} grupo(s) de disparo carregado(s).` : "Nenhum disparo real encontrado para os filtros atuais.");
    } catch (error) {
      setRows([]);
      setStatus(error instanceof Error ? error.message : "Não foi possível carregar analytics reais.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        !search ||
        row.sender.toLowerCase().includes(search) ||
        row.phone.toLowerCase().includes(search) ||
        row.bm.toLowerCase().includes(search) ||
        row.wabaId.toLowerCase().includes(search) ||
        row.user.toLowerCase().includes(search);
      const matchesSender = senderFilter === "Todos os remetentes" || senderDisplay(row) === senderFilter;
      const matchesBm = bmFilter === "Todas as BMs" || row.bm === bmFilter;
      const matchesUser = userFilter === "Todos os usuários" || row.user === userFilter;
      return matchesSearch && matchesSender && matchesBm && matchesUser;
    });
  }, [bmFilter, query, rows, senderFilter, userFilter]);

  const totals = useMemo(() => {
    const sent = filteredRows.reduce((sum, row) => sum + row.sent, 0);
    const accepted = filteredRows.reduce((sum, row) => sum + row.accepted, 0);
    const delivered = filteredRows.reduce((sum, row) => sum + row.delivered, 0);
    const failed = filteredRows.reduce((sum, row) => sum + row.failed, 0);
    const pending = filteredRows.reduce((sum, row) => sum + row.pending, 0);
    const flows = filteredRows.reduce((sum, row) => sum + row.flows, 0);
    return {
      sent,
      accepted,
      delivered,
      failed,
      pending,
      flows,
      rate: sent ? Math.round((delivered / sent) * 1000) / 10 : 0,
    };
  }, [filteredRows]);

  const senders = useMemo(() => Array.from(new Set(rows.map(senderDisplay))).sort(), [rows]);
  const bms = useMemo(() => Array.from(new Set(rows.map((row) => row.bm))).sort(), [rows]);
  const users = useMemo(() => Array.from(new Set(rows.map((row) => row.user))).filter(Boolean).sort(), [rows]);
  const topRows = filteredRows
    .slice()
    .sort((a, b) => b.sent - a.sent)
    .slice(0, 8)
    .map((row) => ({ ...row, senderLabel: senderDisplay(row) }));
  const pieData = [
    { name: "Entregues", value: totals.delivered, color: "hsl(var(--success))" },
    { name: "Falhas", value: totals.failed, color: "hsl(var(--danger))" },
    { name: "Pendentes", value: totals.pending, color: "hsl(var(--warning))" },
  ].filter((item) => item.value > 0);

  function exportCsv() {
    const header = "BM,WABA,Usuario,Remetente,Telefone,Enviados,Aceitos,Entregues,Pendentes,Falhas,Taxa,Lotes,Ultimo disparo";
    const body = filteredRows
      .map((row) => [row.bm, row.wabaId, row.user, row.sender, row.phone, row.sent, row.accepted, row.delivered, row.pending, row.failed, `${rate(row)}%`, row.lots, row.lastAt || ""].join(","))
      .join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "analytics-disparos-reais.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="template-page analytics-page">
      <div className="template-heading analytics-heading">
        <div className="page-heading-icon">
          <BarChart3 size={24} />
        </div>
        <div>
          <h1>Analytics de Transmissões</h1>
          <p>Dados reais agregados por BM, WABA e remetente.</p>
        </div>
      </div>

      <section className="card analytics-filter-card">
        <h3>
          <Filter size={16} />
          Filtros
        </h3>
        <div className="analytics-filter-grid">
          <select className="select" value={period} onChange={(event) => setPeriod(event.target.value)}>
            <option>Últimas 24h</option>
            <option>Últimos 7 dias</option>
            <option>Últimos 30 dias</option>
            <option>Este mês</option>
            <option>Todo período</option>
          </select>
          <select className="select" value={bmFilter} onChange={(event) => setBmFilter(event.target.value)}>
            <option>Todas as BMs</option>
            {bms.map((bm) => <option key={bm}>{bm}</option>)}
          </select>
          <select className="select" value={senderFilter} onChange={(event) => setSenderFilter(event.target.value)}>
            <option>Todos os remetentes</option>
            {senders.map((sender) => <option key={sender}>{sender}</option>)}
          </select>
          <select className="select" value={userFilter} onChange={(event) => setUserFilter(event.target.value)}>
            <option>Todos os usuários</option>
            {users.map((user) => <option key={user}>{user}</option>)}
          </select>
          <button className="button" disabled={loading} onClick={load}>
            <Search size={16} />
            {loading ? "Buscando..." : "Buscar"}
          </button>
        </div>
        {status ? <p className="hint">{status}</p> : null}
      </section>

      <section className="analytics-kpi-grid">
        {[
          { label: "Enviados", value: totals.sent, icon: Send, tone: "neutral", detail: "Destinatários do lote" },
          { label: "Aceitos", value: totals.accepted, icon: CheckCircle2, tone: "primary", detail: "Aceitos pela API" },
          { label: "Entregues", value: totals.delivered, icon: CheckCircle2, tone: "success", detail: `${totals.rate}%` },
          { label: "Falhas", value: totals.failed, icon: XCircle, tone: "danger", detail: `${totals.sent ? Math.round((totals.failed / totals.sent) * 1000) / 10 : 0}%` },
          { label: "Pendentes", value: totals.pending, icon: TrendingUp, tone: "warning", detail: "Aguardando status" },
          { label: "Flows", value: totals.flows, icon: Workflow, tone: "primary", detail: "Ações disparadas" },
        ].map(({ label, value, icon: Icon, tone, detail }) => (
          <div className={`analytics-kpi ${tone}`} key={label}>
            <Icon size={17} />
            <span>{label}</span>
            <strong>{typeof value === "number" ? compact(value) : value}</strong>
            <small>{detail}</small>
          </div>
        ))}
      </section>

      <section className="analytics-chart-grid">
        <div className="card analytics-chart-card large">
          <h3>Disparos por BM/remetente</h3>
          {topRows.length ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={topRows} margin={{ top: 18, right: 18, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="senderLabel" stroke="hsl(var(--muted-foreground))" fontSize={11} interval={0} tickLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    color: "hsl(var(--foreground))",
                  }}
                />
                <Bar dataKey="delivered" stackId="a" fill="hsl(var(--success))" radius={[6, 6, 0, 0]} />
                <Bar dataKey="failed" stackId="a" fill="hsl(var(--danger))" radius={[6, 6, 0, 0]} />
                <Bar dataKey="pending" stackId="a" fill="hsl(var(--warning))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="analytics-empty-state">Nenhum disparo real encontrado para montar o gráfico.</div>
          )}
        </div>

        <div className="card analytics-chart-card">
          <h3>Distribuição de status</h3>
          {pieData.length ? (
            <>
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={72} outerRadius={110} paddingAngle={2}>
                    {pieData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      color: "hsl(var(--foreground))",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="analytics-legend">
                <span><i className="success" />Entregues</span>
                <span><i className="danger" />Falhas</span>
                <span><i className="warning" />Pendentes</span>
              </div>
            </>
          ) : (
            <div className="analytics-empty-state">Sem status de entrega/falha ainda.</div>
          )}
        </div>
      </section>

      <section className="card analytics-table-card">
        <div className="analytics-table-header">
          <h3>Detalhamento por BM e remetente</h3>
          <div className="analytics-table-actions">
            <label className="search-field">
              <Search size={15} />
              <input placeholder="Buscar..." value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <button className="button secondary compact" onClick={exportCsv} disabled={!filteredRows.length}>
              <Download size={15} />
              CSV
            </button>
          </div>
        </div>

        <div className="analytics-table">
          <div className="analytics-table-row head">
            <span>BM / WABA</span>
            <span>Usuário</span>
            <span>Remetente</span>
            <span>Enviados</span>
            <span>Aceitos</span>
            <span>Entregues</span>
            <span>Pendentes</span>
            <span>Falhas</span>
            <span>Taxa</span>
            <span>Último</span>
          </div>
          {filteredRows.map((row) => (
            <div className="analytics-table-row" key={row.key}>
              <span>
                <strong>{row.bm}</strong>
                <small>{row.wabaId || "WABA não informada"}</small>
              </span>
              <span>{row.user}</span>
              <span>
                <strong>{senderDisplay(row)}</strong>
                <small>{row.phone ? "Remetente integrado" : "Telefone não informado"}</small>
              </span>
              <span>{compact(row.sent)}</span>
              <span className="primary-text">{compact(row.accepted)}</span>
              <span className="success-text">{compact(row.delivered)}</span>
              <span>{compact(row.pending)}</span>
              <span className="danger-text">{compact(row.failed)}</span>
              <span>
                <strong className={rate(row) < 90 ? "rate-pill bad" : "rate-pill"}>{rate(row)}%</strong>
              </span>
              <span>{formatDateTime(row.lastAt)}</span>
            </div>
          ))}
          {!filteredRows.length ? (
            <div className="analytics-empty-table">
              <strong>Nenhum disparo real encontrado.</strong>
              <span>Quando um broadcast for executado e salvo pela API, ele aparece aqui agrupado por BM/WABA/remetente.</span>
            </div>
          ) : null}
        </div>
        <p className="hint">{filteredRows.length} registro(s)</p>
      </section>
    </main>
  );
}
