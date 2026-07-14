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
  lastInboundAt?: string;
  canReplyUntil?: string;
  replyWindowOpen?: boolean;
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
  if (typeof window !== "undefined" && window.location.origin) {
    return `${window.location.origin.replace(/\/$/, "")}/local-api`;
  }
  const apiUrl = config.apiUrl.replace(/\/api\/v1\/?$/, "").replace(/\/$/, "");
  if (/localhost|127\.0\.0\.1/.test(apiUrl)) return config.localBackendUrl.replace(/\/$/, "");
  return `${config.publicAppUrl.replace(/\/$/, "")}/local-api`;
}

function productionBackendUrl() {
  return "https://movyapi.com.br/local-api";
}

function isLocalHost() {
  return typeof window !== "undefined" && /localhost|127\.0\.0\.1/.test(window.location.hostname);
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

function hoursUntil(value?: string) {
  if (!value) return "";
  const diff = new Date(value).getTime() - Date.now();
  if (diff <= 0) return "";
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.max(0, Math.ceil((diff % 3600000) / 60000));
  if (hours <= 0) return `${minutes}min`;
  return `${hours}h ${minutes}min`;
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

function textOf(...values: unknown[]) {
  const found = values.find((value) => typeof value === "string" && value.trim());
  return typeof found === "string" ? found.trim() : "";
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

function conversationSenderOptions(conversations: Conversation[]) {
  return conversations
    .filter((conversation) => conversation.senderPhoneNumberId)
    .map((conversation) => ({
      id: conversation.senderPhoneNumberId,
      name: textOf(conversation.senderName, conversation.senderPhone, "Remetente"),
      phone: textOf(conversation.senderPhone, conversation.senderName),
    }));
}

function mergeSenderOptions(remote: unknown, conversations: Conversation[] = []) {
  const remoteOptions = Array.isArray(remote) ? (remote as SenderOption[]) : [];
  const byId = new Map<string, SenderOption>();
  [...remoteOptions, ...conversationSenderOptions(conversations), ...localSenderOptions()].forEach((item) => {
    const id = textOf(item.id);
    if (!id) return;
    const current = byId.get(id);
    byId.set(id, {
      id,
      name: textOf(current?.name, item.name, item.phone, "Remetente"),
      phone: textOf(current?.phone, item.phone),
    });
  });
  return Array.from(byId.values());
}

function mergeProviderSenderOptions(remote: unknown, conversations: Conversation[] = [], includeLocalMeta = true) {
  if (includeLocalMeta) return mergeSenderOptions(remote, conversations);
  const remoteOptions = Array.isArray(remote) ? (remote as SenderOption[]) : [];
  const byId = new Map<string, SenderOption>();
  [...remoteOptions, ...conversationSenderOptions(conversations)].forEach((item) => {
    const id = textOf(item.id);
    if (!id) return;
    const current = byId.get(id);
    byId.set(id, {
      id,
      name: textOf(current?.name, item.name, item.phone, "Infobip"),
      phone: textOf(current?.phone, item.phone),
    });
  });
  return Array.from(byId.values());
}

type ConversationsProps = {
  provider?: "meta" | "infobip";
};

export function Conversations({ provider = "meta" }: ConversationsProps) {
  const isInfobip = provider === "infobip";
  const listPath = isInfobip ? "infobip-conversations" : "conversations";
  const sendPath = isInfobip ? "infobip-conversations/send" : "conversations/send";
  const providerName = isInfobip ? "Infobip" : "WhatsApp";
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [senders, setSenders] = useState<SenderOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [senderFilter, setSenderFilter] = useState("all");
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const [conversationBackendUrl, setConversationBackendUrl] = useState(movyBackendUrl());

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) || conversations[0],
    [conversations, selectedId],
  );
  const selectedMessages = useMemo(
    () => [...(selected?.messages || [])].sort((a, b) => new Date(a.createdAt || "").getTime() - new Date(b.createdAt || "").getTime()),
    [selected],
  );
  const windowRemaining = hoursUntil(selected?.canReplyUntil);

  async function loadConversations(silent = false) {
    if (!silent) setLoading(true);
    try {
      const primaryBackendUrl = movyBackendUrl();
      const url = new URL(`${primaryBackendUrl}/${listPath}`);
      url.searchParams.set("_", String(Date.now()));
      if (query.trim()) url.searchParams.set("q", query.trim());
      if (senderFilter !== "all") url.searchParams.set("sender", senderFilter);
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Conversas HTTP ${response.status}`);
      let activeBackendUrl = primaryBackendUrl;
      let nextPayload = payload;
      let next = Array.isArray(nextPayload.conversations) ? nextPayload.conversations : [];
      let nextSenders = mergeProviderSenderOptions(nextPayload.senders, next, !isInfobip);
      const fallbackBackendUrl = productionBackendUrl();
      if (!next.length && (isLocalHost() || primaryBackendUrl !== fallbackBackendUrl)) {
        const fallbackUrl = new URL(`${productionBackendUrl()}/${listPath}`);
        fallbackUrl.searchParams.set("_", String(Date.now()));
        if (query.trim()) fallbackUrl.searchParams.set("q", query.trim());
        if (senderFilter !== "all") fallbackUrl.searchParams.set("sender", senderFilter);
        const fallbackResponse = await fetch(fallbackUrl, { cache: "no-store" });
        const fallbackPayload = await fallbackResponse.json().catch(() => ({}));
        if (fallbackResponse.ok) {
          activeBackendUrl = productionBackendUrl();
          nextPayload = fallbackPayload;
          next = Array.isArray(nextPayload.conversations) ? nextPayload.conversations : [];
          nextSenders = mergeProviderSenderOptions(nextPayload.senders, next, !isInfobip);
        }
      }
      setConversationBackendUrl(activeBackendUrl);
      setConversations(next);
      setSenders(nextSenders);
      setSelectedId((current) => (current && next.some((item: Conversation) => item.id === current) ? current : next[0]?.id || ""));
      setStatus(next.length ? "" : `Nenhuma conversa ${isInfobip ? "Infobip" : "Meta"} encontrada ainda. As novas mensagens chegam aqui pelo webhook.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Nao foi possivel carregar conversas.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function uploadAttachment(file: File) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Nao foi possivel ler o arquivo."));
      reader.readAsDataURL(file);
    });
    const response = await fetch(`${conversationBackendUrl}/media/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream", base64 }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.error || `Upload HTTP ${response.status}`);
    return {
      url: `${conversationBackendUrl}${payload.path}`,
      type: String(payload.type || file.type || ""),
      name: file.name,
    };
  }

  async function sendMessage() {
    if (!selected || (!draft.trim() && !attachment) || sending) return;
    if (!selected.replyWindowOpen) {
      setStatus("Essa conversa esta fora da janela de 24h. Para reabrir, envie um template aprovado pelo Broadcast.");
      return;
    }
    setSending(true);
    try {
      const uploaded = attachment ? await uploadAttachment(attachment) : null;
      const response = await fetch(`${conversationBackendUrl}/${sendPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selected.contactPhone,
          phoneNumberId: selected.senderPhoneNumberId,
          text: draft,
          mediaUrl: uploaded?.url,
          mediaType: uploaded?.type,
          mediaName: uploaded?.name,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || payload.error || `Envio HTTP ${response.status}`);
      setDraft("");
      setAttachment(null);
      setEmojiOpen(false);
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
                    {sender.phone && sender.name === sender.phone ? sender.phone : `${sender.name}${sender.phone ? ` - ${sender.phone}` : ""}`}
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
                  <em>{statusLabel(conversation.lastStatus)} - {providerName}</em>
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
                <span>As respostas do webhook {providerName} aparecem aqui.</span>
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
                  <span className={`conversation-window-pill ${selected.replyWindowOpen ? "open" : "closed"}`}>
                    {selected.replyWindowOpen ? `Janela 24h ativa${windowRemaining ? ` - ${windowRemaining}` : ""}` : "Fora da janela 24h"}
                  </span>
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
                <label className="icon-button conversation-attach-button" aria-label="Anexar arquivo" title="Anexar mídia">
                  <Paperclip size={16} />
                  <input
                    type="file"
                    accept="image/*,video/*,application/pdf,audio/*"
                    onChange={(event) => setAttachment(event.target.files?.[0] || null)}
                  />
                </label>
                <div className="conversation-compose-box">
                  {attachment ? (
                    <div className="conversation-attachment-chip">
                      <Paperclip size={13} />
                      <span>{attachment.name}</span>
                      <button type="button" onClick={() => setAttachment(null)} aria-label="Remover anexo">x</button>
                    </div>
                  ) : null}
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
                </div>
                <div className="conversation-emoji-wrap">
                  <button className="icon-button" type="button" aria-label="Inserir emoji" onClick={() => setEmojiOpen((open) => !open)}>
                    <Smile size={16} />
                  </button>
                  {emojiOpen ? (
                    <div className="conversation-emoji-menu">
                      {["😀", "😉", "😊", "🙏", "👍", "✅", "🔥", "🚀", "💰", "⚠️", "📲", "👇"].map((emoji) => (
                        <button type="button" key={emoji} onClick={() => setDraft((value) => `${value}${emoji}`)}>
                          {emoji}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button className="button" type="button" onClick={sendMessage} disabled={(!draft.trim() && !attachment) || sending}>
                  <Send size={16} />
                  {selected.replyWindowOpen ? "Enviar" : "Usar template"}
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
              <div>
                <dt>Janela 24h</dt>
                <dd>{selected?.replyWindowOpen ? `Aberta ${windowRemaining ? `(${windowRemaining})` : ""}` : "Fechada"}</dd>
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
              <strong>Webhook {providerName} conectado</strong>
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
