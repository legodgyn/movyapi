import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Copy,
  Hash,
  Loader2,
  MapPin,
  Phone,
  RefreshCcw,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  WalletCards,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { config } from "../lib/config";
import { readPersistentValue, writePersistentValue } from "../lib/persistentStorage";

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
const brazilDdds = ["11", "21", "31", "34", "41", "51", "61", "62", "71", "81", "85"];

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

function statusLabel(status: string) {
  const map: Record<string, string> = {
    number: "Numero comprado",
    code: "Codigo recebido",
    STATUS_WAIT_CODE: "Aguardando codigo",
    STATUS_WAIT_RETRY: "Aguardando novo SMS",
    STATUS_CANCEL: "Cancelado",
    finished: "Finalizado",
    canceled: "Cancelado",
  };
  return map[status] || status || "Aguardando";
}

export function VirtualNumbers() {
  const [mode, setMode] = useState<"random" | "ddd">("random");
  const [ddd, setDdd] = useState("11");
  const [customDdd, setCustomDdd] = useState("");
  const [balance, setBalance] = useState<Sms24hBalance | null>(null);
  const [stock, setStock] = useState<Sms24hStock | null>(null);
  const [orders, setOrders] = useState<Sms24hOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const activeOrder = useMemo(
    () => orders.find((order) => !["code", "finished", "canceled", "STATUS_CANCEL"].includes(order.status)),
    [orders],
  );

  useEffect(() => {
    void readPersistentValue<Sms24hOrder[]>(STORAGE_KEY, []).then(setOrders);
    void loadOverview();
  }, []);

  useEffect(() => {
    if (!activeOrder) return;
    const timer = window.setInterval(() => {
      void refreshOrder(activeOrder.id, false);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [activeOrder?.id]);

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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar SMS24h");
    }
  }

  async function buyNumber() {
    const selectedDdd = mode === "ddd" ? (customDdd || ddd).replace(/\D/g, "").slice(0, 2) : "";
    if (mode === "ddd" && selectedDdd.length !== 2) {
      toast.error("Informe um DDD valido com 2 digitos.");
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
      await persist([order, ...orders].slice(0, 20));
      toast.success("Numero comprado. Agora e so aguardar o codigo.");
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
      if (result.code) toast.success(`Codigo recebido: ${result.code}`);
      else if (showToast) toast.message(statusLabel(result.status));
    } catch (error) {
      if (showToast) toast.error(error instanceof Error ? error.message : "Falha ao consultar codigo");
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
      toast.success(status === "8" ? "Numero cancelado." : "Ativacao finalizada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar ativacao");
    }
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success("Copiado.");
  }

  async function clearHistory() {
    await persist([]);
    toast.success("Historico limpo.");
  }

  return (
    <main className="virtual-page">
      <section className="virtual-hero">
        <div>
          <span className="eyebrow">SMS24H</span>
          <h1>Numeros Virtuais WhatsApp</h1>
          <p>Compre numeros do Brasil, acompanhe o SMS de verificacao e use no cadastro sem sair do Movy Api.</p>
        </div>
        <button className="btn secondary" type="button" onClick={loadOverview}>
          <RefreshCcw size={16} /> Atualizar
        </button>
      </section>

      <section className="virtual-metrics">
        <div className="virtual-metric">
          <WalletCards size={18} />
          <span>Saldo SMS24h</span>
          <strong>{formatMoney(balance?.balance)}</strong>
        </div>
        <div className="virtual-metric active">
          <Smartphone size={18} />
          <span>WhatsApp Brasil</span>
          <strong>{(stock?.count || stock?.available || 0).toLocaleString("pt-BR")}</strong>
        </div>
        <div className="virtual-metric">
          <ShoppingCart size={18} />
          <span>Custo estimado</span>
          <strong>{formatMoney(stock?.price)}</strong>
        </div>
      </section>

      <section className="virtual-grid">
        <div className="virtual-card">
          <div className="virtual-card-title">
            <ShieldCheck size={18} />
            <div>
              <h2>Comprar numero</h2>
              <p>Servico fixo: WhatsApp. Pais fixo: Brasil.</p>
            </div>
          </div>

          <div className="virtual-choice">
            <button className={mode === "random" ? "active" : ""} type="button" onClick={() => setMode("random")}>
              <Hash size={16} />
              Aleatorio
              <small>Qualquer DDD disponivel</small>
            </button>
            <button className={mode === "ddd" ? "active" : ""} type="button" onClick={() => setMode("ddd")}>
              <MapPin size={16} />
              Escolher DDD
              <small>Filtra antes da compra</small>
            </button>
          </div>

          {mode === "ddd" && (
            <div className="ddd-panel">
              <div className="ddd-grid">
                {brazilDdds.map((item) => (
                  <button className={ddd === item && !customDdd ? "active" : ""} key={item} type="button" onClick={() => {
                    setDdd(item);
                    setCustomDdd("");
                  }}>
                    {item}
                  </button>
                ))}
              </div>
              <label className="field">
                <span>Outro DDD</span>
                <input
                  className="input"
                  maxLength={2}
                  value={customDdd}
                  onChange={(event) => setCustomDdd(event.target.value.replace(/\D/g, "").slice(0, 2))}
                  placeholder="Ex: 62"
                />
              </label>
            </div>
          )}

          <button className="btn primary virtual-buy" type="button" disabled={loading} onClick={buyNumber}>
            {loading ? <Loader2 className="spin" size={16} /> : <ShoppingCart size={16} />}
            Comprar numero WhatsApp
          </button>
        </div>

        <div className="virtual-card virtual-active-card">
          <div className="virtual-card-title">
            <Clock3 size={18} />
            <div>
              <h2>Ativacao em andamento</h2>
              <p>O sistema consulta o codigo automaticamente a cada 10 segundos.</p>
            </div>
          </div>

          {activeOrder ? (
            <div className="virtual-order">
              <div className="virtual-phone-row">
                <div>
                  <span>Numero recebido</span>
                  <strong>{formatPhone(activeOrder.number)}</strong>
                  <small>ID {activeOrder.id}</small>
                </div>
                <button className="icon-button" type="button" onClick={() => copyText(activeOrder.number)}>
                  <Copy size={16} />
                </button>
              </div>
              <div className={`virtual-code ${activeOrder.code ? "ready" : ""}`}>
                <span>{activeOrder.code ? "Codigo de verificacao" : "Status atual"}</span>
                <strong>{activeOrder.code || statusLabel(activeOrder.status)}</strong>
                {activeOrder.message && <small>{activeOrder.message}</small>}
              </div>
              <div className="virtual-actions">
                <button className="btn secondary" type="button" onClick={() => refreshOrder(activeOrder.id)}>
                  {refreshingId === activeOrder.id ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                  Consultar
                </button>
                <button className="btn secondary" type="button" onClick={() => setOrderStatus(activeOrder.id, "8")}>
                  <XCircle size={16} /> Cancelar
                </button>
                <button className="btn primary" type="button" onClick={() => setOrderStatus(activeOrder.id, "6")}>
                  <CheckCircle2 size={16} /> Finalizar
                </button>
              </div>
            </div>
          ) : (
            <div className="virtual-empty">
              <Phone size={28} />
              <strong>Nenhuma ativacao em aberto</strong>
              <span>Compre um numero para o WhatsApp e o codigo aparecera aqui.</span>
            </div>
          )}
        </div>
      </section>

      <section className="virtual-card">
        <div className="virtual-card-title">
          <Smartphone size={18} />
          <div>
            <h2>Historico recente</h2>
            <p>Ultimos numeros comprados pelo Movy Api.</p>
          </div>
          {!!orders.length && (
            <button className="btn ghost" type="button" onClick={clearHistory}>
              Limpar
            </button>
          )}
        </div>

        <div className="virtual-history">
          {orders.length ? (
            orders.map((order) => (
              <div className="virtual-history-row" key={order.id}>
                <div>
                  <strong>{formatPhone(order.number)}</strong>
                  <span>ID {order.id} {order.ddd ? `- DDD ${order.ddd}` : "- aleatorio"}</span>
                </div>
                <div>
                  <b>{order.code || statusLabel(order.status)}</b>
                  <small>{new Date(order.updatedAt).toLocaleString("pt-BR")}</small>
                </div>
                <button className="btn secondary" type="button" onClick={() => refreshOrder(order.id)}>
                  Consultar
                </button>
              </div>
            ))
          ) : (
            <div className="virtual-empty compact">Nenhum numero comprado ainda.</div>
          )}
        </div>
      </section>
    </main>
  );
}
