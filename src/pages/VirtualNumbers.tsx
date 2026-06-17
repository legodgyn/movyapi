import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Copy,
  HelpCircle,
  History,
  Loader2,
  Phone,
  RefreshCcw,
  Settings,
  ShoppingCart,
  Smartphone,
  Trash2,
  WalletCards,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { config } from "../lib/config";
import { readPersistentValue, writePersistentValue } from "../lib/persistentStorage";

type VirtualTab = "buy" | "activations" | "history";

type Sms24hOrder = {
  id: string;
  number: string;
  ddd?: string | null;
  code?: string;
  status: string;
  message?: string;
  createdAt: string;
  updatedAt: string;
};

type Sms24hBalance = {
  balance?: number;
  raw?: string;
};

type Sms24hStock = {
  available?: number;
  count?: number;
  price?: number;
};

const STORAGE_KEY = "movy.sms24hOrders";

function backendUrl(path: string) {
  return `${config.localBackendUrl.replace(/\/$/, "")}${path}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(backendUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || data.error || `HTTP ${response.status}`);
  }
  return data as T;
}

function formatMoney(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return value.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 12) return value;
  return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    number: "Aguardando código",
    code: "Código recebido",
    STATUS_WAIT_CODE: "Envie o código para o número recebido",
    STATUS_WAIT_RETRY: "Aguardando novo SMS",
    STATUS_CANCEL: "Cancelado",
    finished: "Finalizado",
    canceled: "Cancelado",
  };
  return map[status] || status || "Aguardando";
}

function isActiveOrder(order: Sms24hOrder) {
  return !["code", "finished", "canceled", "STATUS_CANCEL"].includes(order.status);
}

export function VirtualNumbers() {
  const [activeTab, setActiveTab] = useState<VirtualTab>("buy");
  const [ddd, setDdd] = useState("");
  const [balance, setBalance] = useState<Sms24hBalance | null>(null);
  const [stock, setStock] = useState<Sms24hStock | null>(null);
  const [orders, setOrders] = useState<Sms24hOrder[]>([]);
  const [apiError, setApiError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const activeOrders = useMemo(() => orders.filter(isActiveOrder), [orders]);
  const latestActiveOrder = activeOrders[0];

  useEffect(() => {
    void readPersistentValue<Sms24hOrder[]>(STORAGE_KEY, []).then(setOrders);
    void loadOverview();
  }, []);

  useEffect(() => {
    if (!latestActiveOrder) return;
    const timer = window.setInterval(() => {
      for (const order of activeOrders) void refreshOrder(order.id, false);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [activeOrders, latestActiveOrder?.id]);

  async function persist(next: Sms24hOrder[]) {
    setOrders(next);
    await writePersistentValue(STORAGE_KEY, next);
  }

  async function loadOverview() {
    try {
      const [nextBalance, nextStock] = await Promise.all([
        api<Sms24hBalance>("/sms24h/balance"),
        api<Sms24hStock>("/sms24h/stock"),
      ]);
      setBalance(nextBalance);
      setStock(nextStock);
      setApiError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar SMS24h";
      setApiError(message);
      toast.error(message);
    }
  }

  async function buyNumber() {
    const selectedDdd = ddd.replace(/\D/g, "").slice(0, 2);
    if (ddd && selectedDdd.length !== 2) {
      toast.error("Informe um DDD com 2 dígitos ou deixe vazio para comprar aleatório.");
      return;
    }
    setLoading(true);
    try {
      const result = await api<{ id: string; number: string; status: string; message?: string }>("/sms24h/orders", {
        body: JSON.stringify({ ddd: selectedDdd || undefined }),
        method: "POST",
      });
      const now = new Date().toISOString();
      const order: Sms24hOrder = {
        id: String(result.id || ""),
        number: String(result.number || ""),
        ddd: selectedDdd || null,
        status: result.status || "number",
        message: result.message,
        createdAt: now,
        updatedAt: now,
      };
      await persist([order, ...orders].slice(0, 50));
      setActiveTab("activations");
      toast.success("Número comprado. Aguardando código.");
      void loadOverview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao comprar número");
    } finally {
      setLoading(false);
    }
  }

  async function refreshOrder(id: string, showToast = true) {
    setRefreshingId(id);
    try {
      const result = await api<{ status: string; code?: string; message?: string; raw?: string }>(`/sms24h/orders/${encodeURIComponent(id)}`);
      const next = orders.map((order) =>
        order.id === id
          ? {
              ...order,
              code: result.code || order.code,
              status: result.status || order.status,
              message: result.message || result.raw || order.message,
              updatedAt: new Date().toISOString(),
            }
          : order,
      );
      await persist(next);
      if (result.code) toast.success(`Código recebido: ${result.code}`);
      else if (showToast) toast.message(statusLabel(result.status));
    } catch (error) {
      if (showToast) toast.error(error instanceof Error ? error.message : "Falha ao consultar código");
    } finally {
      setRefreshingId(null);
    }
  }

  async function setOrderStatus(id: string, status: "6" | "8") {
    try {
      await api(`/sms24h/orders/${encodeURIComponent(id)}/status`, {
        body: JSON.stringify({ status }),
        method: "POST",
      });
      const nextStatus = status === "8" ? "canceled" : "finished";
      await persist(
        orders.map((order) =>
          order.id === id ? { ...order, status: nextStatus, updatedAt: new Date().toISOString() } : order,
        ),
      );
      toast.success(status === "8" ? "Ativacao cancelada." : "Ativacao finalizada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar ativação");
    }
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success("Copiado.");
  }

  async function clearHistory() {
    await persist([]);
    toast.success("Histórico limpo.");
  }

  const tabs = [
    { id: "buy" as const, label: "Comprar", icon: ShoppingCart },
    { id: "activations" as const, label: "Ativações", icon: Clock3, badge: activeOrders.length || undefined },
    { id: "history" as const, label: "Histórico", icon: History },
  ];

  return (
    <main className="virtual-page">
      <section className="virtual-shell">
        <div className="virtual-topbar">
          <nav className="virtual-tabs" aria-label="Navegação de números virtuais">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  className={activeTab === tab.id ? "active" : ""}
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon size={18} />
                  {tab.label}
                  {tab.badge ? <span>{tab.badge}</span> : null}
                </button>
              );
            })}
            <button type="button" className="virtual-tab-muted" disabled>
              <Settings size={18} />
              Configurações
            </button>
            <button type="button" className="virtual-tab-muted" disabled>
              <HelpCircle size={18} />
              Ajuda
            </button>
          </nav>

          <div className="virtual-account">
            <span className="virtual-api-pill">API</span>
            <strong>{formatMoney(balance?.balance)}</strong>
            <button className="icon-button" type="button" onClick={loadOverview} aria-label="Atualizar SMS24h">
              <RefreshCcw size={16} />
            </button>
          </div>
        </div>

        {activeTab === "buy" && (
          <section className="virtual-buy-layout">
            <div className="virtual-title-block">
              <span className="eyebrow">WhatsApp Brasil</span>
              <h1>Comprar número virtual</h1>
              <p>Informe o DDD desejado ou deixe em branco para comprar qualquer número disponível do Brasil.</p>
              {apiError && (
                <div className="virtual-alert">
                  <strong>SMS24h não respondeu pela VPS</strong>
                  <span>{apiError}</span>
                </div>
              )}
            </div>

            <div className="virtual-shop-card">
              <div className="virtual-service-row">
                <div className="virtual-whatsapp-badge">
                  <Smartphone size={18} />
                </div>
                <div>
                  <strong>Whatsapp</strong>
                  <span>Região BR</span>
                </div>
              </div>

              <label className="virtual-ddd-field">
                <span>REGIAO BR (DDD):</span>
                <input
                  value={ddd}
                  maxLength={2}
                  onChange={(event) => setDdd(event.target.value.replace(/\D/g, "").slice(0, 2))}
                  placeholder="Ex: 11"
                />
              </label>

              <div className="virtual-buy-strip">
                <strong>{formatMoney(stock?.price)}</strong>
                <span>{(stock?.count || stock?.available || 0).toLocaleString("pt-BR")} un.</span>
                <button className="btn primary" type="button" disabled={loading} onClick={buyNumber}>
                  {loading ? <Loader2 className="spin" size={16} /> : <ShoppingCart size={16} />}
                  Comprar
                </button>
              </div>
            </div>
          </section>
        )}

        {activeTab === "activations" && (
          <section className="virtual-section">
            <div className="virtual-title-block compact">
              <h1>Ativações em andamento</h1>
              <p>Os códigos são consultados automaticamente. Quando chegar, ele aparece na coluna Código SMS.</p>
            </div>

            <div className="virtual-table-card">
              <table className="virtual-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Servico</th>
                    <th>Número</th>
                    <th>Status</th>
                    <th>Código SMS</th>
                    <th>Tempo</th>
                    <th>Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {activeOrders.length ? (
                    activeOrders.map((order) => (
                      <tr key={order.id}>
                        <td>{order.id}</td>
                        <td>
                          <span className="virtual-wa-mini">
                            <Smartphone size={16} />
                          </span>
                        </td>
                        <td>
                          <div className="virtual-copy-number">
                            <button type="button" onClick={() => copyText(order.number)} aria-label="Copiar número">
                              <Copy size={14} />
                            </button>
                            <strong>{order.number}</strong>
                          </div>
                        </td>
                        <td>{statusLabel(order.status)}</td>
                        <td>
                          {order.code ? (
                            <button className="virtual-code-pill" type="button" onClick={() => copyText(order.code || "")}>
                              {order.code}
                            </button>
                          ) : (
                            <Loader2 className="spin virtual-loader" size={24} />
                          )}
                        </td>
                        <td>20 min</td>
                        <td>
                          <div className="virtual-row-actions">
                            <button className="icon-button" type="button" onClick={() => refreshOrder(order.id)}>
                              {refreshingId === order.id ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                            </button>
                            <button className="icon-button danger" type="button" onClick={() => setOrderStatus(order.id, "8")}>
                              <XCircle size={16} />
                            </button>
                            <button className="icon-button success" type="button" onClick={() => setOrderStatus(order.id, "6")}>
                              <CheckCircle2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>
                        <div className="virtual-empty-row">
                          Nenhuma ativação em andamento. Compre um número para iniciar.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "history" && (
          <section className="virtual-section">
            <div className="virtual-title-block compact">
              <h1>Histórico</h1>
              <p>Consulte os números comprados recentemente e os códigos recebidos.</p>
            </div>

            <div className="virtual-history-tools">
              <label>
                <span>Paginacao</span>
                <select>
                  <option>10 por pagina</option>
                  <option>25 por pagina</option>
                  <option>50 por pagina</option>
                </select>
              </label>
              <button className="btn secondary" type="button" onClick={loadOverview}>
                <RefreshCcw size={16} /> Buscar
              </button>
              {!!orders.length && (
                <button className="btn ghost" type="button" onClick={clearHistory}>
                  <Trash2 size={16} /> Limpar histórico
                </button>
              )}
            </div>

            <div className="virtual-table-card">
              <table className="virtual-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Dia da compra</th>
                    <th>Servico</th>
                    <th>Número alugado</th>
                    <th>SMS</th>
                    <th>Valor</th>
                    <th>Status</th>
                    <th>Nova ativação</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length ? (
                    orders.map((order) => (
                      <tr key={order.id}>
                        <td>{order.id}</td>
                        <td>{formatDate(order.createdAt)}</td>
                        <td>
                          <span className="virtual-wa-mini">
                            <Smartphone size={16} />
                          </span>
                        </td>
                        <td>{order.number}</td>
                        <td>{order.code || "-"}</td>
                        <td>{formatMoney(stock?.price)}</td>
                        <td>
                          <span className={`virtual-status ${order.code ? "ok" : isActiveOrder(order) ? "wait" : ""}`}>
                            {order.code ? "Recebido" : statusLabel(order.status)}
                          </span>
                        </td>
                        <td>
                          <button className="btn secondary" type="button" onClick={() => refreshOrder(order.id)}>
                            Novo código
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8}>
                        <div className="virtual-empty-row">Nenhum histórico encontrado.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
