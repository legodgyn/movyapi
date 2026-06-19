import { useEffect, useMemo, useState } from "react";
import {
  CheckCheck,
  Clock,
  FileText,
  History,
  MessageCircle,
  MoreVertical,
  Paperclip,
  RefreshCcw,
  Search,
  Send,
  Smile,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { config } from "../lib/config";

type ConversationMessage = {
  id: string;
  messageId?: string;
  direction: "inbound" | "outbound";
  contactPhone: string;
  senderPhoneNumberId?: string;
  senderPhone?: string;
  senderName?: string;
  text?: string;
  type?: string;
  status?: string;
  errorMessage?: string;
  createdAt?: string;
};

type Conversation = {
  id: string;
  contactPhone: string;
  senderPhoneNumberId?: string;
  senderPhone?: string;
  senderName?: string;
  lastMessage?: string;
  lastStatus?: string;
  lastAt?: string;
  unread?: number;
  messages: ConversationMessage[];
};

type SenderOption = {
  id: string;
  name: string;
  phone?: string;
};

function movyBackendUrl() {
  if (typeof window !== "undefined" && /localhost|127\.0\.0\.1/.test(window.location.hostname)) {
    return config.localBackendUrl.replace(/\/$/, "");
  }
  const apiUrl = config.apiUrl.replace(/\/api\/v1\/?$/, "").replace(/\/$/, "");
  if (/localhost|127\.0\.0\.1/.test(apiUrl)) return config.localBackendUrl.replace(/\/$/, "");
  return apiUrl;
}

function formatTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function phoneMask(value?: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return value || "-";
}

function statusLabel(status?: string) {
  const value = String(status || "").toLowerCase();
  if (value === "read") return "Lida";
  if (value === "delivered") return "Entregue";
  if (value === "sent") return "Enviada";
  if (value === "accepted") return "Aceita";
  if (value === "failed") return "Falha";
  if (value === "received") return "Recebida";
  return value || "Pendente";
}

function statusIcon(message: ConversationMessage) {
  const status = String(message.status || "").toLowerCase();
  if (status === "failed") return <TriangleAlert size={13} />;
  if (["delivered", "read", "sent", "accepted"].includes(status)) return <CheckCheck size={13} />;
  return <Clock size={13} />;
}

function initials(value?: string) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? digits.slice(-2) : "?";
}

function shortTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function readLocalArray(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function textOf(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function localSenderOptions() {
  if (typeof window === "undefined") return [];
  const connected = readLocalArray("movy.connectedSenders");
  const accounts = readLocalArray("scaleapi.bmAccounts");
  const options: SenderOption[] = [];

  connected.forEach((sender, index) => {
    const id = textOf(sender.phoneNumberId);
    if (!id) return;
    options.push({
      id,
      name: textOf(sender.verifiedName, textOf(sender.bmName, `Remetente ${index + 1}`)),
      phone: textOf(sender.phone),
    });
  });

  accounts.forEach((account, accountIndex) => {
    const bmName = textOf(account.name, textOf(account.businessName, textOf(account.label, `BM ${accountIndex + 1}`)));
    const connectedIds = new Set(
      [
        textOf(account.defaultPhoneNumberId),
        textOf(account.phoneNumberId),
        ...(Array.isArray(account.connectedPhoneIds) ? account.connectedPhoneIds.map((item) => textOf(item)) : []),
      ].filter(Boolean),
    );
    const phones = Array.isArray(account.phones) ? (account.phones as Array<Record<string, unknown>>) : [];
    phones.forEach((phone) => {
      const id = textOf(phone.id);
      if (!id || (connectedIds.size && !connectedIds.has(id))) return;
      options.push({
        id,
        name: textOf(phone.verified_name, textOf(phone.verifiedName, bmName)),
        phone: textOf(phone.display_phone_number, textOf(phone.phone)),
      });
    });
    if (!phones.length) {
      const fallbackId = textOf(account.defaultPhoneNumberId, textOf(account.phoneNumberId));
      if (fallbackId) options.push({ id: fallbackId, name: bmName, phone: textOf(account.phoneNumber, textOf(account.senderNumber)) });
    }
  });

  return Array.from(new Map(options.filter((item) => item.id).map((item) => [item.id, item])).values());
}

function mergeSenderOptions(remote: unknown) {
  const remoteOptions = Array.isArray(remote) ? (remote as SenderOption[]) : [];
  return Array.from(new Map([...remoteOptions, ...localSenderOptions()].filter((item) => item.id).map((item) => [item.id, item])).values());
}

export function Conversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [senders, setSenders] = useState<SenderOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [senderFilter, setSenderFilter] = useState("all");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) || conversations[0],
    [conversations, selectedId],
  );
  const selectedMessages = useMemo(
    () => [...(selected?.messages || [])].sort((a, b) => new Date(a.createdAt || "").getTime() - new Date(b.createdAt || "").getTime()),
    [selected],
  );
  const metrics = useMemo(() => {
    const messages = conversations.flatMap((conversation) => conversation.messages || []);
    const inbound = messages.filter((message) => message.direction === "inbound").length;
    const outbound = messages.filter((message) => message.direction === "outbound").length;
    const failed = messages.filter((message) => String(message.status || "").toLowerCase() === "failed").length;
    return { inbound, outbound, failed };
  }, [conversations]);

  async function loadConversations(silent = false) {
    if (!silent) setLoading(true);
    try {
      const url = new URL(`${movyBackendUrl()}/conversations`);
      if (query.trim()) url.searchParams.set("q", query.trim());
      if (senderFilter !== "all") url.searchParams.set("sender", senderFilter);
      const response = await fetch(url);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Conversas HTTP ${response.status}`);
      const next = Array.isArray(payload.conversations) ? payload.conversations : [];
      setConversations(next);
      setSenders(mergeSenderOptions(payload.senders));
      setSelectedId((current) => (current && next.some((item: Conversation) => item.id === current) ? current : next[0]?.id || ""));
      setStatus(next.length ? "" : "Nenhuma conversa encontrada ainda. As novas mensagens chegam aqui pelo webhook.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Nao foi possivel carregar conversas.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function sendMessage() {
    if (!selected || !draft.trim() || sending) return;
    setSending(true);
    try {
      const response = await fetch(`${movyBackendUrl()}/conversations/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selected.contactPhone,
          phoneNumberId: selected.senderPhoneNumberId,
          text: draft,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || payload.error || `Envio HTTP ${response.status}`);
      setDraft("");
      await loadConversations(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Falha ao enviar mensagem.");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    void loadConversations();
  }, [senderFilter]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadConversations(true), 350);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const interval = window.setInterval(() => void loadConversations(true), 8000);
    return () => window.clearInterval(interval);
  }, [query, senderFilter]);

  return (
    <main className="conversations-page">
      <div className="template-heading conversations-heading">
        <div className="template-icon">
          <MessageCircle size={18} />
        </div>
        <div>
          <h1>Conversas</h1>
          <p>Acompanhe respostas, entregas e falhas por remetente conectado.</p>
        </div>
      </div>

      <section className="conversation-metric-row">
        <article>
          <span>Conversas</span>
          <strong>{conversations.length}</strong>
        </article>
        <article>
          <span>Recebidas</span>
          <strong>{metrics.inbound}</strong>
        </article>
        <article>
          <span>Enviadas</span>
          <strong>{metrics.outbound}</strong>
        </article>
        <article>
          <span>Falhas</span>
          <strong>{metrics.failed}</strong>
        </article>
      </section>

      <section className="conversations-shell">
        <aside className="conversation-list-panel">
          <div className="conversation-tools">
            <label className="search-field">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar contato, texto ou status..." />
            </label>
            <div className="conversation-filter-row">
              <select className="input" value={senderFilter} onChange={(event) => setSenderFilter(event.target.value)}>
                <option value="all">Todos os remetentes</option>
                {senders.map((sender) => (
                  <option value={sender.id} key={sender.id}>
                    {sender.name} {sender.phone ? `- ${sender.phone}` : ""}
                  </option>
                ))}
              </select>
              <button className="icon-button" type="button" onClick={() => loadConversations()} disabled={loading} aria-label="Atualizar conversas">
                <RefreshCcw size={16} />
              </button>
            </div>
          </div>

          <div className="conversation-list-summary">
            <strong>Atendimentos</strong>
            <span>{conversations.length} conversa(s)</span>
          </div>

          <div className="conversation-list">
            {conversations.map((conversation) => (
              <button
                type="button"
                className={`conversation-list-item ${selected?.id === conversation.id ? "active" : ""}`}
                key={conversation.id}
                onClick={() => setSelectedId(conversation.id)}
              >
                <span className="conversation-avatar">{initials(conversation.contactPhone)}</span>
                <span className="conversation-list-copy">
                  <strong>{phoneMask(conversation.contactPhone)}</strong>
                  <small>{conversation.lastMessage || "Sem mensagens"}</small>
                  <em>{statusLabel(conversation.lastStatus)} - WhatsApp</em>
                </span>
                <span className="conversation-list-meta">
                  <small>{shortTime(conversation.lastAt)}</small>
                  {conversation.unread ? <i>{conversation.unread}</i> : null}
                </span>
              </button>
            ))}
            {!conversations.length ? (
              <div className="conversation-list-empty">
                <MessageCircle size={18} />
                <strong>Nenhuma conversa ainda</strong>
                <span>As respostas do webhook aparecem aqui.</span>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="conversation-chat-panel">
          {selected ? (
            <>
              <header className="conversation-chat-head">
                <div className="conversation-contact-head">
                  <span className="conversation-avatar large">{initials(selected.contactPhone)}</span>
                  <div>
                    <strong>{phoneMask(selected.contactPhone)}</strong>
                    <span>{selected.senderName || "Remetente"} {selected.senderPhone ? `- ${selected.senderPhone}` : ""}</span>
                  </div>
                </div>
                <div className="conversation-head-actions">
                  <span className={`conversation-status-pill ${String(selected.lastStatus || "").toLowerCase()}`}>
                    {statusLabel(selected.lastStatus)}
                  </span>
                  <button className="icon-button" type="button" aria-label="Mais opcoes">
                    <MoreVertical size={16} />
                  </button>
                </div>
              </header>

              <div className="conversation-messages">
                <span className="conversation-date-chip">Hoje</span>
                {selectedMessages.map((message) => (
                  <article className={`conversation-bubble ${message.direction}`} key={message.id || message.messageId}>
                    <p>{message.text || statusLabel(message.status)}</p>
                    {message.errorMessage ? <small className="conversation-error">{message.errorMessage}</small> : null}
                    <span>
                      {shortTime(message.createdAt)}
                      {message.direction === "outbound" ? statusIcon(message) : null}
                      {message.direction === "outbound" ? statusLabel(message.status) : ""}
                    </span>
                  </article>
                ))}
              </div>

              <footer className="conversation-composer">
                <button className="icon-button" type="button" aria-label="Anexar arquivo">
                  <Paperclip size={16} />
                </button>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Digite uma resposta..."
                  rows={2}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                />
                <button className="icon-button" type="button" aria-label="Inserir emoji">
                  <Smile size={16} />
                </button>
                <button className="button" type="button" onClick={sendMessage} disabled={!draft.trim() || sending}>
                  <Send size={16} />
                  Enviar
                </button>
              </footer>
            </>
          ) : (
            <div className="conversation-empty">
              <MessageCircle size={28} />
              <strong>Nenhuma conversa selecionada</strong>
              <span>{status || "Assim que o webhook receber respostas, elas aparecem aqui."}</span>
            </div>
          )}
        </section>

        <aside className="conversation-detail-panel">
          <div className="conversation-profile-card">
            <span className="conversation-avatar xl">{initials(selected?.contactPhone)}</span>
            <strong>{selected ? phoneMask(selected.contactPhone) : "Contato"}</strong>
            <small>{selected?.lastAt ? `Ultima interacao ${formatTime(selected.lastAt)}` : "Nenhuma conversa selecionada"}</small>
          </div>

          <div className="conversation-side-section">
            <div className="conversation-side-title">
              <Smartphone size={15} />
              Perfil
            </div>
            <dl>
              <div>
                <dt>Telefone</dt>
                <dd>{selected ? phoneMask(selected.contactPhone) : "-"}</dd>
              </div>
              <div>
                <dt>Remetente</dt>
                <dd>{selected?.senderName || "Remetente"}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{statusLabel(selected?.lastStatus)}</dd>
              </div>
            </dl>
          </div>

          <div className="conversation-side-section">
            <div className="conversation-side-title">
              <FileText size={15} />
              Notas internas
            </div>
            <textarea placeholder="Anotacoes do atendimento..." rows={5} />
          </div>

          <div className="conversation-side-section">
            <div className="conversation-side-title">
              <History size={15} />
              Historico
            </div>
            <div className="conversation-history-item">
              <strong>Webhook conectado</strong>
              <span>Respostas e status entram automaticamente.</span>
            </div>
            <div className="conversation-history-item">
              <strong>Ultimo evento</strong>
              <span>{selected?.lastAt ? formatTime(selected.lastAt) : "-"}</span>
            </div>
          </div>
        </aside>
      </section>

      {status && selected ? <p className="conversation-page-status">{status}</p> : null}
    </main>
  );
}
