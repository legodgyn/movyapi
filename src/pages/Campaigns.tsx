import { useEffect, useState } from "react";
import { formatDate, labelOf } from "../lib/format";
import { campaigns } from "../lib/services";
import type { Campaign } from "../lib/types";

export function Campaigns() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function load() {
    setStatus("Carregando...");
    try {
      setItems(await campaigns.normalizedList({ q: query || undefined }));
      setStatus("");
    } catch {
      setStatus("Nao foi possivel carregar campanhas.");
    }
  }

  async function createCampaign() {
    if (!name.trim()) return;
    setStatus("Criando campanha...");
    try {
      await campaigns.create({ name, description, status: "draft" });
      setName("");
      setDescription("");
      await load();
      setStatus("Campanha criada.");
    } catch {
      setStatus("Falha ao criar campanha.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="page grid">
      <section className="card grid">
        <h3>Nova campanha</h3>
        <div className="grid cols-3">
          <input className="input" placeholder="Nome da campanha" value={name} onChange={(event) => setName(event.target.value)} />
          <input className="input" placeholder="Descricao" value={description} onChange={(event) => setDescription(event.target.value)} />
          <button className="button" onClick={createCampaign}>Criar campanha</button>
        </div>
      </section>

      <section className="card grid">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <input className="input" placeholder="Buscar campanha..." value={query} onChange={(event) => setQuery(event.target.value)} />
          <button className="button secondary" onClick={load}>Atualizar</button>
        </div>
        <div className="grid cols-3">
          <input className="input" placeholder="Criado por (id)" />
          <input className="input" placeholder="Criado a partir de" />
          <input className="input" placeholder="Criado ate" />
        </div>
        {status && <p className="muted">{status}</p>}
        <div className="table-list">
          {items.map((campaign) => (
            <div className="table-row" key={campaign.id}>
              <strong>{labelOf(campaign, "Campanha")}</strong>
              <span className="muted">
                {campaign.transmissions_count ?? 0} transmissoes · {campaign.status || "Sem status"} · {formatDate(campaign.created_at)}
              </span>
            </div>
          ))}
          {!items.length && <p className="muted">Nenhuma campanha retornada pela API.</p>}
        </div>
      </section>
    </main>
  );
}
