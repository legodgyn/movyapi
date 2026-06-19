import {
  BarChart3,
  Building2,
  FileText,
  Image,
  LayoutTemplate,
  Megaphone,
  MessageCircle,
  MessageSquareText,
  RefreshCcw,
  Smartphone,
  UserCog,
  Users,
  Workflow,
} from "lucide-react";

export const menuSections = [
  {
    title: "Principal",
    items: [
      { label: "Templates INFOBIP", path: "/", icon: LayoutTemplate },
      { label: "Templates META", path: "/meta-templates", icon: MessageSquareText },
      { label: "Midias", path: "/media", icon: Image },
    ],
  },
  {
    title: "Operacoes",
    items: [
      { label: "Tratar Lista", path: "/list-cleaner", icon: FileText },
      { label: "Retentativas", path: "/retries", icon: RefreshCcw },
      { label: "Broadcast Simples", path: "/broadcast", icon: Megaphone },
      { label: "Broadcast Randomico", path: "/broadcast-random", icon: Megaphone },
      { label: "Conversas", path: "/conversations", icon: MessageCircle },
      { label: "Flows", path: "/flows", icon: Workflow },
    ],
  },
  {
    title: "Administracao",
    items: [
      { label: "Usuarios", path: "/admin/users", icon: Users },
      { label: "Configuracoes BM", path: "/admin/bm-settings", icon: Building2 },
      { label: "Registrar Remetente", path: "/admin/sender-registration", icon: Smartphone },
      { label: "Numeros SMS24h", path: "/admin/virtual-numbers", icon: Smartphone },
      { label: "Numeros SisBratel", path: "/admin/sisbratel-numbers", icon: Smartphone },
      { label: "Remetentes", path: "/admin/registered-senders", icon: Users },
      { label: "Gerenciar APIs", path: "/admin/handle-manager", icon: UserCog },
      { label: "Analytics", path: "/transmission-analytics", icon: BarChart3 },
    ],
  },
];
