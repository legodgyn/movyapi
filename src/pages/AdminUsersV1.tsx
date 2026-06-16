import { useEffect, useState } from "react";
import { labelOf } from "../lib/format";
import { adminUsers } from "../lib/services";
import type { User } from "../lib/types";

export function AdminUsersV1() {
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  async function load() {
    const primary = await adminUsers.normalizedListV1().catch(() => []);
    setUsers(primary.length ? primary : await adminUsers.normalizedList().catch(() => []));
  }

  async function toggleBeta(user: User) {
    setStatus("Atualizando beta...");
    try {
      await adminUsers.updateBetaAccess(user.id, !Boolean(user.beta_access));
      setStatus("Acesso beta atualizado.");
      await load();
    } catch {
      setStatus("Falha ao atualizar beta.");
    }
  }

  async function toggleSenderAccess(user: User) {
    setStatus("Atualizando acesso de remetentes...");
    try {
      await adminUsers.updateSenderAccess(user.id, !Boolean(user.senders_access));
      setStatus("Acesso de remetentes atualizado.");
      await load();
    } catch {
      setStatus("Falha ao atualizar acesso de remetentes.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = users.filter((user) =>
    `${user.name || ""} ${user.email || ""} ${user.role || ""}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <main className="page grid">
      <section className="card grid">
        <h3>Usuarios V1</h3>
        <input className="input" placeholder="Buscar usuario..." value={query} onChange={(event) => setQuery(event.target.value)} />
        {status && <p className="muted">{status}</p>}
        <div className="table-list">
          {filtered.map((user) => (
            <div className="table-row" key={user.id}>
              <div>
                <strong>{labelOf(user, "Usuario")}</strong>
                <div className="muted">{user.email} · {user.role || "sem role"}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="button secondary" onClick={() => toggleBeta(user)}>
                  Beta {user.beta_access ? "on" : "off"}
                </button>
                <button className="button secondary" onClick={() => toggleSenderAccess(user)}>
                  Remetentes
                </button>
              </div>
            </div>
          ))}
          {!filtered.length && <p className="muted">Nenhum usuario retornado.</p>}
        </div>
      </section>
    </main>
  );
}
