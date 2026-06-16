import { useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { unwrapList } from "../lib/api";
import { labelOf } from "../lib/format";
import { security } from "../lib/services";
import type { ApiRecord } from "../lib/types";

export function Security() {
  const [apiRestrictions, setApiRestrictions] = useState<ApiRecord[]>([]);
  const [userRestrictions, setUserRestrictions] = useState<ApiRecord[]>([]);
  const [status, setStatus] = useState("");
  const [userId, setUserId] = useState("");
  const [apiId, setApiId] = useState("");

  async function load() {
    const [apis, users] = await Promise.all([
      security.apiRestrictions().catch(() => null),
      security.userRestrictions().catch(() => null),
    ]);
    setApiRestrictions(unwrapList<ApiRecord>(apis));
    setUserRestrictions(unwrapList<ApiRecord>(users));
  }

  async function addRestriction() {
    setStatus("Aplicando restricao...");
    try {
      await security.addRestriction({ userId, apiId });
      setStatus("Restricao aplicada.");
      await load();
    } catch {
      setStatus("Nao foi possivel aplicar a restricao.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="page grid">
      <div className="grid cols-3">
        <section className="card stat">
          <ShieldCheck size={24} />
          <span className="muted">Restricoes de API</span>
          <strong>{apiRestrictions.length}</strong>
        </section>
        <section className="card stat">
          <ShieldAlert size={24} />
          <span className="muted">Restricoes por usuario</span>
          <strong>{userRestrictions.length}</strong>
        </section>
        <section className="card stat">
          <span className="muted">Status</span>
          <strong>Ativo</strong>
        </section>
      </div>

      <section className="card grid">
        <h3>Nova restricao</h3>
        <div className="grid cols-3">
          <input className="input" placeholder="User ID" value={userId} onChange={(event) => setUserId(event.target.value)} />
          <input className="input" placeholder="API ID" value={apiId} onChange={(event) => setApiId(event.target.value)} />
          <button className="button" onClick={addRestriction}>Aplicar</button>
        </div>
        {status && <p className="muted">{status}</p>}
      </section>

      <section className="card grid">
        <h3>Restricoes encontradas</h3>
        <div className="table-list">
          {[...apiRestrictions, ...userRestrictions].map((item, index) => (
            <div className="table-row" key={String(item.id || index)}>
              <strong>{labelOf(item, "Restricao")}</strong>
              <span className="muted">{String(item.apiId || item.api_id || item.userId || item.user_id || "-")}</span>
            </div>
          ))}
          {!apiRestrictions.length && !userRestrictions.length && <p className="muted">Nenhuma restricao retornada.</p>}
        </div>
      </section>
    </main>
  );
}
