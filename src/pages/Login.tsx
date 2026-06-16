import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../lib/api";
import { saveToken } from "../lib/auth";
import { authenticateLocalUser, firstAllowedPath } from "../lib/localUsers";

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedPassword = password.trim();
      const localUser = authenticateLocalUser(normalizedEmail, normalizedPassword);

      if (localUser) {
        saveToken({
          access_token: `local-user-${localUser.id}`,
          token_type: "local",
          user: localUser,
        });
        navigate(firstAllowedPath(localUser));
        return;
      }

      await login(email, password);
      navigate("/");
    } catch {
      setError("Nao foi possivel entrar com esses dados.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <form className="card login-card" onSubmit={handleSubmit}>
        <h1 style={{ margin: 0, fontSize: 28 }}>Movy Api</h1>
        <p className="muted">Entre no seu workspace de automacao para WhatsApp</p>
        <p className="muted" style={{ fontSize: 13 }}>
          Teste local: admin@admin.com / admin
        </p>

        <div className="grid" style={{ marginTop: 22 }}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              className="input"
              id="email"
              placeholder="seu@email.com"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Senha</label>
            <input
              className="input"
              id="password"
              placeholder="••••••••"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error && <p style={{ color: "hsl(var(--danger))" }}>{error}</p>}
          <button className="button" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
          <button className="button secondary" type="button">
            Esqueci minha senha
          </button>
        </div>
      </form>
    </main>
  );
}
