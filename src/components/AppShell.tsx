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
    title: "Templates INFOBIP",
    description: "Crie modelos pelo canal Infobip",
  },
  "/meta-templates": {
    title: "Templates META",
    description: "API direta Facebook/WhatsApp",
  },
  "/list-cleaner": {
    title: "Tratar Lista",
    description: "Processe e organize seus contatos",
  },  "/retries": {
    title: "Retentativas",
    description: "Reprocesse contatos com falha",
  },
  "/broadcast": {
    title: "Broadcast Simples",
    description: "Um remetente, templates e etiquetas vinculados em ordem",
  },
  "/broadcast-random": {
    title: "Broadcast Randomico",
    description: "Alterne remetentes e templates automaticamente contato a contato",
  },
  "/infobip-transmissions": {
    title: "Transmissoes Infobip",
    description: "Crie lotes pelo canal Infobip usando etiquetas tratadas",
  },
  "/conversations": {
    title: "Conversas",
    description: "Inbox por remetente com respostas e status do webhook",
  },
  "/infobip-conversations": {
    title: "Conversas Infobip",
    description: "Inbox por remetente com respostas e status do webhook Infobip",
  },
  "/contatos": {
    title: "Contatos",
    description: "Gerencie seus contatos e tags",
  },
  "/flows": {
    title: "Flow META",
    description: "Automacoes pela Cloud API",
  },
  "/flows-infobip": {
    title: "Flow Infobip",
    description: "Automacoes pelo canal Infobip",
  },
  "/media": {
    title: "Gerenciador de Midias",
    description: "Upload e organizacao de videos, imagens e audios",
  },
  "/transmission-analytics": {
    title: "Analytics de Transmissoes",
    description: "Metricas de envio via Cloud API",
  },
  "/admin/users": {
    title: "Gerenciar Usuarios",
    description: "Administracao do sistema",
  },
  "/admin/bm-settings": {
    title: "Configuracoes BM",
    description: "Conecte Business Manager, WABA e Cloud API",
  },
  "/admin/virtual-numbers": {
    title: "Numeros SMS24h",
    description: "Compre numeros WhatsApp Brasil e acompanhe codigos",
  },
  "/admin/sisbratel-numbers": {
    title: "Numeros SisBratel",
    description: "Compre numeros WhatsApp Brasil e acompanhe codigos",
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
