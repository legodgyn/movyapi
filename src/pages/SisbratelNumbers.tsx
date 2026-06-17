import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Copy,
  History,
  Loader2,
  RefreshCcw,
  ShoppingCart,
  Smartphone,
  Trash2,
  WalletCards,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { config } from "../lib/config";

type SisbratelTab = "buy" | "activations" | "history";

type SisbratelOrder = {
  id: string;
  activationId?: string;
  number: string;
  serviceCode?: string;
  serviceName?: string;
  status: string;
  code?: string | null;
  price?: number;
  ddd?: string | null;
  createdAt?: string;
  expiresAt?: string;
};

type SisbratelBalance = {
  balance?: number;
  currency?: string;
};

type SisbratelServices = {
  whatsapp?: {
    code?: string;
    serviceCode?: string;
    name?: string;
    serviceName?: string;
    price?: number;
  };
};

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

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function statusLabel(status: string) {
  const normalized = String(status || "").toUpperCase();
  const map: Record<string, string> = {
    ACTIVE: "Aguardando codigo",
    WAITING: "Aguardando codigo",
    WAIT_CODE: "Aguardando codigo",
    STATUS_WAIT_CODE: "Aguardando codigo",
    CODE_RECEIVED: "Codigo recebido",
    RECEIVED: "Codigo recebido",
    COMPLETED: "Finalizado",
    FINISHED: "Finalizado",
    CANCELLED: "Cancelado",
    CANCELED: "Cancelado",
    EXPIRED: "Expirado",
  };
  return map[normalized] || status || "Aguardando";
}

function isActiveOrder(order: SisbratelOrder) {
  const status = String(order.status || "").toUpperCase();
  return !["CANCELLED", "CANCELED", "COMPLETED", "FINISHED", "EXPIRED"].includes(status);
}

function normalizeOrder(order: Partial<SisbratelOrder> | null | undefined): SisbratelOrder | null {
  if (!order) return null;
  const id = String(order.activationId || order.id || "");
  const number = String(order.number || "");
  if (!id && !number) return null;
  return {
    id,
    activationId: id,
    number,
    serviceCode: order.serviceCode || "wa",
    serviceName: order.serviceName || "WhatsApp",
    status: order.status || "WAITING",
    code: order.code || null,
    price: order.price,
    ddd: order.ddd || null,
    createdAt: order.createdAt || new Date().toISOString(),
    expiresAt: order.expiresAt,
  };
}

export function SisbratelNumbers() {
  const [activeTab, setActiveTab] = useState<SisbratelTab>("buy");
  const [ddd, setDdd] = useState("");
  const [balance, setBalance] = useState<SisbratelBalance | null>(null);
  const [servicePrice, setServicePrice] = useState<number | undefined>();
  const [activations, setActivations] = useState<SisbratelOrder[]>([]);
  const [history, setHistory] = useState<SisbratelOrder[]>([]);
  const [apiError, setApiError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const activeOrders = useMemo(() => activations.filter(isActiveOrder), [activations]);

  useEffect(() => {
    void loadOverview();
  }, []);

  useEffect(() => {
    if (!activeOrders.length) return;
    const timer = window.setInterval(() => {
      for (const order of activeOrders) void refreshOrder(order.id, false);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [activeOrders]);

  async function loadOverview() {
    try {
      const [nextBalance, services, activeList, historyList] = await Promise.all([
        api<SisbratelBalance>("/sisbratel/balance"),
        api<SisbratelServices>("/sisbratel/services"),
        api<{ activations: SisbratelOrder[] }>("/sisbratel/activations"),
        api<{ history: SisbratelOrder[] }>("/sisbratel/history"),
      ]);
      setBalance(nextBalance);
      setServicePrice(Number(services.whatsapp?.price || 0) || undefined);
      setActivations((activeList.activations || []).map(normalizeOrder).filter(Boolean) as SisbratelOrder[]);
      setHistory((historyList.history || []).map(normalizeOrder).filter(Boolean) as SisbratelOrder[]);
      setApiError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar SisBratel";
      setApiError(message);
      toast.error(message);
    }
  }

  async function buyNumber() {
    const selectedDdd = ddd.replace(/\D/g, "").slice(0, 2);
    if (ddd && selectedDdd.length !== 2) {
      toast.error("Informe um DDD com 2 digitos ou deixe vazio para comprar aleatorio.");
      return;
    }
    setLoading(true);
    try {
      const result = await api<{ order?: SisbratelOrder }>("/sisbratel/orders", {
        body: JSON.stringify({ ddd: selectedDdd || undefined }),
        method: "POST",
      });
      const order = normalizeOrder(result.order);
      if (!order) throw new Error("A SisBratel comprou, mas nao retornou os dados da ativacao.");
      setActivations((current) => [order, ...current.filter((item) => item.id !== order.id)]);
      setActiveTab("activations");
      toast.success("Numero comprado. Aguardando codigo.");
      void loadOverview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao comprar numero");
    } finally {
      setLoading(false);
    }
  }

  async function refreshOrder(id: string, showToast = true) {
    setRefreshingId(id);
    try {
      const result = await api<{ order?: SisbratelOrder }>(`/sisbratel/orders/${encodeURIComponent(id)}`);
      const nextOrder = normalizeOrder(result.order);
      if (nextOrder) {
        setActivations((current) =>
          current.map((order) => (order.id === id ? { ...order, ...nextOrder } : order)),
        );
        if (nextOrder.code) toast.success(`Codigo recebido: ${nextOrder.code}`);
        else if (showToast) toast.message(statusLabel(nextOrder.status));
      }
    } catch (error) {
      if (showToast) toast.error(error instanceof Error ? error.message : "Falha ao consultar codigo");
    } finally {
      setRefreshingId(null);
    }
  }

  async function setOrderAction(id: string, action: "cancel" | "complete") {
    try {
      await api(`/sisbratel/orders/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      setActivations((current) =>
        current.map((order) =>
          order.id === id ? { ...order, status: action === "cancel" ? "CANCELLED" : "COMPLETED" } : order,
        ),
      );
      toast.success(action === "cancel" ? "Ativacao cancelada." : "Ativacao finalizada.");
      void loadOverview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar ativacao");
    }
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success("Copiado.");
  }

  const tabs = [
    { id: "buy" as const, label: "Comprar", icon: ShoppingCart },
    { id: "activations" as const, label: "Ativacoes", icon: Clock3, badge: activeOrders.length || undefined },
    { id: "history" as const, label: "Historico", icon: History },
  ];

  return (
    <main className="virtual-page">
      <section className="virtual-shell">
        <div className="virtual-topbar">
          <nav className="virtual-tabs" aria-label="Navegacao SisBratel">
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
          </nav>

          <div className="virtual-account">
            <span className="virtual-api-pill">SISBRATEL</span>
            <WalletCards size={16} />
            <strong>{formatMoney(balance?.balance)}</strong>
            <button className="icon-button" type="button" onClick={loadOverview} aria-label="Atualizar SisBratel">
              <RefreshCcw size={16} />
            </button>
          </div>
        </div>

        {activeTab === "buy" && (
          <section className="virtual-buy-layout">
            <div className="virtual-title-block">
              <span className="eyebrow">WhatsApp Brasil</span>
              <h1>Comprar numero pela SisBratel</h1>
              <p>Escolha o DDD desejado. Se deixar vazio, a SisBratel busca um numero brasileiro disponivel.</p>
              {apiError && (
                <div className="virtual-alert">
                  <strong>SisBratel nao respondeu</strong>
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
                  <strong>WhatsApp</strong>
                  <span>Regiao BR</span>
                </div>
              </div>

              <label className="virtual-ddd-field">
                <span>DDD desejado</span>
                <input
                  value={ddd}
                  maxLength={2}
                  onChange={(event) => setDdd(event.target.value.replace(/\D/g, "").slice(0, 2))}
                  placeholder="Ex: 11"
                />
              </label>

              <div className="virtual-buy-strip">
                <strong>{formatMoney(ddd ? (servicePrice || 0) * 1.3 : servicePrice)}</strong>
                <span>{ddd ? "DDD especifico" : "Aleatorio BR"}</span>
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
              <h1>Ativacoes em andamento</h1>
              <p>Use o numero recebido no WhatsApp e aguarde o codigo aparecer automaticamente.</p>
            </div>

            <div className="virtual-table-card">
              <table className="virtual-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Servico</th>
                    <th>Numero</th>
                    <th>Status</th>
                    <th>Codigo SMS</th>
                    <th>Expira</th>
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
                            <button type="button" onClick={() => copyText(order.number)} aria-label="Copiar numero">
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
                        <td>{formatDate(order.expiresAt)}</td>
                        <td>
                          <div className="virtual-row-actions">
                            <button className="icon-button" type="button" onClick={() => refreshOrder(order.id)}>
                              {refreshingId === order.id ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                            </button>
                            <button className="icon-button danger" type="button" onClick={() => setOrderAction(order.id, "cancel")}>
                              <XCircle size={16} />
                            </button>
                            <button className="icon-button success" type="button" onClick={() => setOrderAction(order.id, "complete")}>
                              <CheckCircle2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>
                        <div className="virtual-empty-row">Nenhuma ativacao em andamento.</div>
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
              <h1>Historico SisBratel</h1>
              <p>Ultimos numeros comprados, codigos recebidos e status de cada ativacao.</p>
            </div>

            <div className="virtual-history-tools">
              <button className="btn secondary" type="button" onClick={loadOverview}>
                <RefreshCcw size={16} /> Atualizar
              </button>
              <button className="btn ghost" type="button" onClick={() => setHistory([])}>
                <Trash2 size={16} /> Limpar visualizacao
              </button>
            </div>

            <div className="virtual-table-card">
              <table className="virtual-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Compra</th>
                    <th>Servico</th>
                    <th>Numero</th>
                    <th>SMS</th>
                    <th>Valor</th>
                    <th>Status</th>
                    <th>Consulta</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length ? (
                    history.map((order) => (
                      <tr key={`${order.id}-${order.number}`}>
                        <td>{order.id}</td>
                        <td>{formatDate(order.createdAt)}</td>
                        <td>{order.serviceName || "WhatsApp"}</td>
                        <td>{order.number}</td>
                        <td>{order.code || "-"}</td>
                        <td>{formatMoney(order.price)}</td>
                        <td>
                          <span className={`virtual-status ${order.code ? "ok" : isActiveOrder(order) ? "wait" : ""}`}>
                            {order.code ? "Recebido" : statusLabel(order.status)}
                          </span>
                        </td>
                        <td>
                          <button className="btn secondary" type="button" onClick={() => refreshOrder(order.id)}>
                            Ver status
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8}>
                        <div className="virtual-empty-row">Nenhum historico encontrado.</div>
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
