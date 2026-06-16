import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, PanelLeft, Sun, Zap } from "lucide-react";
import { clearToken, getCurrentUser } from "../lib/auth";
import { hasPermission } from "../lib/localUsers";
import { menuSections } from "../lib/menu";
import { readPersistentValue } from "../lib/persistentStorage";

const PERSISTENT_KEYS = [
  "scaleapi.bmAccounts",
  "scaleapi.bmSettings",
  "scaleapi.bmPhoneNumbers",
  "movy.connectedSenders",
  "movy.mediaLibrary",
];

function readLocalJson(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

const titles: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Criar Templates",
    description: "Gere templates em massa para WhatsApp",
  },
  "/meta-templates": {
    title: "Meta Templates",
    description: "API Direta Facebook/WhatsApp",
  },
  "/list-cleaner": {
    title: "Tratar Lista",
    description: "Processe e organize seus contatos",
  },  "/retries": {
    title: "Retentativas",
    description: "Reprocesse contatos com falha",
  },
  "/broadcast": {
    title: "Transmissões Cloud",
    description: "Envie mensagens em massa via Cloud API",
  },
  "/contatos": {
    title: "Contatos",
    description: "Gerencie seus contatos e tags",
  },
  "/flows": {
    title: "Fluxos",
    description: "Automacoes de mensagens",
  },
  "/media": {
    title: "Gerenciador de Mídias",
    description: "Upload e compressão de vídeos, imagens e áudios",
  },
  "/transmission-analytics": {
    title: "Analytics de Transmissoes",
    description: "Metricas de envio via Cloud API",
  },
  "/admin/users": {
    title: "Gerenciar Usuários",
    description: "Administração do sistema",
  },
  "/admin/bm-settings": {
    title: "Configurações BM",
    description: "Conecte Business Manager, WABA e Cloud API",
  },
  "/campaigns": {
    title: "Campanhas",
    description: "Gestao de campanhas V1",
  },
};

export function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = getCurrentUser();
  const current = titles[pathname] ?? {
    title: "Movy Api",
    description: "Automacao inteligente para WhatsApp",
  };
  const visibleSections = user
    ? menuSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => hasPermission(user, item.path)),
        }))
        .filter((section) => section.items.length)
    : menuSections;
  const initials = user?.name
    ?.split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "MV";

  useEffect(() => {
    PERSISTENT_KEYS.forEach((key) => {
      const fallback = readLocalJson(key);
      void readPersistentValue(key, fallback).then((value) => {
        if (value !== null && value !== undefined) {
          localStorage.setItem(key, JSON.stringify(value));
        }
      });
    });
  }, []);

  function handleLogout() {
    clearToken();
    navigate("/auth", { replace: true });
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Zap size={19} />
          </div>
          <div>
            <h1>Movy Api</h1>
            <p>Cloud Console</p>
          </div>
        </div>

        {visibleSections.map((section) => (
          <nav className="menu-section" key={section.title}>
            <div className="menu-title">{section.title}</div>
            {section.items.map((item) => (
              <NavLink
                className="menu-link"
                end={item.path === "/"}
                key={item.path}
                to={item.path}
              >
                <item.icon size={17} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        ))}

        <div className="sidebar-footer">
          <button className="sidebar-logout" type="button" onClick={handleLogout}>
            <LogOut size={16} />
            <span>Sair</span>
          </button>
          <div className="sidebar-status">
            <span />
            <strong>Sistema ativo</strong>
            <a href="/termos">Termos</a>
          </div>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <div className="topbar-title">
            <button className="topbar-icon" aria-label="Toggle Sidebar">
              <PanelLeft size={16} />
            </button>
            <div>
              <h2>{current.title}</h2>
              <p>{current.description}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="topbar-icon" aria-label="Ativar modo claro">
              <Sun size={16} />
            </button>
            <span className="avatar">{initials}</span>
          </div>
        </header>

        <Outlet />
      </div>
    </div>
  );
}
