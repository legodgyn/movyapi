import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  addEdge,
  Background,
  Connection,
  Controls,
  Edge,
  Handle,
  MiniMap,
  Node,
  NodeProps,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "react-flow-renderer";
import "react-flow-renderer/dist/style.css";
import {
  ArrowLeft,
  Code2,
  FileText,
  Image,
  Mic2,
  Play,
  Plus,
  Save,
  Send,
  Timer,
  Video,
  X,
  Zap,
} from "lucide-react";
import { savedTemplates } from "../lib/services";
import type { ContactTag, SavedTemplate } from "../lib/types";

type FlowNodeKind = "start" | "text" | "audio" | "video" | "image" | "delay" | "interactive" | "blacklist";

type FlowNodeData = {
  kind: FlowNodeKind;
  title: string;
  subtitle: string;
  deletable?: boolean;
  onDelete?: () => void;
  body?: string;
  footer?: string;
  imageUrl?: string;
  caption?: string;
  delayMs?: string;
  buttons?: string[];
  templateId?: string;
  variables?: string[];
  variableValues?: Record<string, string>;
};

type FlowRun = {
  status: "idle" | "sending" | "paused" | "done";
  tagId: string;
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  waiting: number;
  currentStep: string;
  events: string[];
};

const LOCAL_FLOW_EDITOR_KEY = "scaleapi.flowEditor";
const LOCAL_FLOW_RUN_KEY = "scaleapi.flowRun";

const fallbackTemplates: SavedTemplate[] = [
  {
    id: "tpl-confirmacao",
    name: "confirmacao_numero",
    folder: "Aprovado",
    media_type: "IMAGE",
    body_text:
      "Oi {{1}}!\n\nTemos uma novidade: voce foi selecionado pra receber essa mensagem.\n\nMas antes preciso confirmar se esse numero {{2}} realmente e seu.",
    footer_text: "Digite sair para não receber mais.",
    buttons: [
      { type: "QUICK_REPLY", text: "Sim" },
      { type: "QUICK_REPLY", text: "Não" },
    ],
  },
  {
    id: "tpl-oferta",
    name: "oferta_movy",
    folder: "Aprovado",
    media_type: "IMAGE",
    body_text: "Fala {{1}}! Tudo certo? {{2}}.\n\nPara confirmar, toque em uma opcao abaixo.",
    footer_text: "Movy Api",
    buttons: [
      { type: "QUICK_REPLY", text: "Tenho interesse" },
      { type: "QUICK_REPLY", text: "Agora não" },
      { type: "QUICK_REPLY", text: "Falar com atendente" },
    ],
  },
];

const defaultRun: FlowRun = {
  status: "idle",
  tagId: "",
  total: 0,
  sent: 0,
  delivered: 0,
  failed: 0,
  waiting: 0,
  currentStep: "Aguardando início",
  events: [],
};

const fallbackTags: ContactTag[] = [
  { id: "tag-demo-1000", name: "0106 - teste", contacts_count: 1000 },
  { id: "tag-demo-428", name: "lista tratada - 428", contacts_count: 428 },
];

function templateBody(template: SavedTemplate) {
  return String(template.body_text || template.text || template.message || template.content || "");
}

function templateFooter(template: SavedTemplate) {
  return String(template.footer_text || template.footer || "");
}

function templateButtons(template: SavedTemplate) {
  const buttons = Array.isArray(template.buttons) ? template.buttons : [];
  return buttons
    .map((button, index) => String(button.text || button.type || `Botão ${index + 1}`))
    .filter(Boolean);
}

function templateVariables(template: SavedTemplate) {
  const text = [templateBody(template), templateFooter(template), JSON.stringify(template.buttons || [])].join(" ");
  const matches = text.match(/\{\{\s*[\w.-]+\s*\}\}/g) || [];
  const variables = matches.map((item) => item.replace(/[{}]/g, "").trim()).filter(Boolean);
  const count = Number(template.variable_count || 0);
  for (let index = 1; index <= count; index += 1) variables.push(String(index));
  return Array.from(new Set(variables)).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

function applyTemplateValues(text: string, values: Record<string, string> = {}) {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, variable: string) => values[variable] || `{{${variable}}}`);
}

function templateToStartData(template: SavedTemplate, currentValues: Record<string, string> = {}): FlowNodeData {
  const variables = templateVariables(template);
  const values = variables.reduce<Record<string, string>>((acc, variable) => {
    acc[variable] = currentValues[variable] || (variable === "1" ? "Lorrene" : variable === "2" ? "5527999983857" : "");
    return acc;
  }, {});
  return {
    kind: "start",
    title: "Template",
    subtitle: template.name,
    templateId: template.id,
    imageUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=420&q=80",
    body: applyTemplateValues(templateBody(template), values),
    footer: applyTemplateValues(templateFooter(template), values),
    buttons: templateButtons(template),
    variables,
    variableValues: values,
  };
}

function emptyStartData(): FlowNodeData {
  return {
    kind: "start",
    title: "Template",
    subtitle: "Selecione um template",
    body: "Selecione um template aprovado para iniciar o fluxo.",
    buttons: [],
    variables: [],
    variableValues: {},
  };
}

const nodeInfo: Record<FlowNodeKind, { label: string; icon: typeof Zap; color: string }> = {
  start: { label: "START", icon: Send, color: "green" },
  text: { label: "TEXT", icon: FileText, color: "blue" },
  audio: { label: "AUDIO", icon: Mic2, color: "purple" },
  video: { label: "VIDEO", icon: Video, color: "pink" },
  image: { label: "IMAGE", icon: Image, color: "teal" },
  delay: { label: "DELAY", icon: Timer, color: "amber" },
  interactive: { label: "INTERACTIVE", icon: Zap, color: "blue" },
  blacklist: { label: "ACTION", icon: Zap, color: "red" },
};

const menuItems: Array<{ kind: FlowNodeKind; title: string; label: string }> = [
  { kind: "text", title: "Texto", label: "Mensagem de texto" },
  { kind: "audio", title: "Áudio", label: "Arquivo ou PTT" },
  { kind: "video", title: "Vídeo", label: "Vídeo com legenda" },
  { kind: "image", title: "Imagem", label: "Imagem com legenda" },
  { kind: "delay", title: "Delay", label: "Espera em ms" },
  { kind: "interactive", title: "Texto + Botão", label: "Reply ou CTA" },
  { kind: "blacklist", title: "Blacklist", label: "Bloquear contato" },
];

const initialNodes: Node<FlowNodeData>[] = [
  {
    id: "start",
    type: "flowCard",
    position: { x: 110, y: 145 },
    data: templateToStartData(fallbackTemplates[0]),
  },
  {
    id: "button-0-text",
    type: "flowCard",
    position: { x: 435, y: 120 },
    data: { kind: "text", title: "Resposta Sim", subtitle: "Caminho do botão Sim", body: "Perfeito, vou continuar seu atendimento." },
  },
  {
    id: "button-1-blacklist",
    type: "flowCard",
    position: { x: 435, y: 320 },
    data: { kind: "blacklist", title: "Resposta Não", subtitle: "blacklist" },
  },
  {
    id: "delay-1",
    type: "flowCard",
    position: { x: 720, y: 120 },
    data: { kind: "delay", title: "Delay", subtitle: "1000ms", delayMs: "1000" },
  },
  {
    id: "interactive-1",
    type: "flowCard",
    position: { x: 1010, y: 120 },
    data: {
      kind: "interactive",
      title: "Interativo",
      subtitle: "Texto do corpo...",
      body: "Mensagem principal...",
      buttons: ["CLIQUE AQUI"],
    },
  },
];

const initialEdges: Edge[] = [
  { id: "e-start-sim", source: "start", sourceHandle: "button-0", target: "button-0-text", animated: true, label: "Sim" },
  { id: "e-start-nao", source: "start", sourceHandle: "button-1", target: "button-1-blacklist", animated: true, label: "Não" },
  { id: "e-text-delay", source: "button-0-text", target: "delay-1", animated: true },
  { id: "e-delay-interactive", source: "delay-1", target: "interactive-1", animated: true },
];

function readStoredFlow() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_FLOW_EDITOR_KEY) || "{}");
    if (Array.isArray(stored.nodes) && Array.isArray(stored.edges)) return stored;
  } catch {
    return null;
  }
  return null;
}

function readStoredRun(): FlowRun {
  try {
    return { ...defaultRun, ...JSON.parse(localStorage.getItem(LOCAL_FLOW_RUN_KEY) || "{}") };
  } catch {
    return defaultRun;
  }
}

function readLocalContactTags(): ContactTag[] {
  try {
    const store = JSON.parse(localStorage.getItem("scaleapi.localContacts") || "{}") as Record<string, { tag: ContactTag }>;
    const tags = Object.values(store).map((entry) => entry.tag).filter(Boolean);
    return tags.length ? tags : fallbackTags;
  } catch {
    return fallbackTags;
  }
}

function tagName(tag: ContactTag) {
  return String(tag.name || tag.id || "Etiqueta");
}

function tagCount(tag: ContactTag) {
  const value = Number(tag.contacts_count ?? tag.count ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function FlowCardNode({ data, selected }: NodeProps<FlowNodeData>) {
  const meta = nodeInfo[data.kind];
  const Icon = meta.icon;
  const isStart = data.kind === "start";
  const isMedia = ["audio", "video", "image"].includes(data.kind);

  return (
    <div className={`dc-node dc-node-${meta.color} ${selected ? "selected" : ""} ${isStart ? "dc-start-node" : ""}`}>
      {selected && data.deletable && data.onDelete ? (
        <button className="dc-node-delete" type="button" onClick={data.onDelete} aria-label="Excluir no">
          <X size={18} />
        </button>
      ) : null}
      <Handle type="target" position={Position.Left} />
      <div className="dc-node-grip" />
      <div className="dc-node-head">
        <Icon size={14} />
        <div>
          <strong>{data.title}</strong>
          <span>{data.subtitle}</span>
        </div>
      </div>

      {isStart ? (
        <div className="dc-whatsapp-card">
          {data.imageUrl ? <img alt="" src={data.imageUrl} /> : null}
          <div className="dc-whatsapp-body">
            {(data.body || "").split("\n").filter(Boolean).map((line) => (
              <p key={line}>{line}</p>
            ))}
            {data.footer ? <small>{data.footer}</small> : null}
          </div>
          {(data.buttons || []).map((button, index) => (
            <div className="dc-reply-row" key={`${button}-${index}`}>
              <span>{button}</span>
              <i />
              <Handle
                className="dc-button-handle"
                id={`button-${index}`}
                position={Position.Right}
                type="source"
              />
            </div>
          ))}
          <time>12:00</time>
        </div>
      ) : isMedia ? (
        <div className="dc-media-slot">Adicionar {data.kind === "audio" ? "áudio" : data.kind === "video" ? "vídeo" : "imagem"}</div>
      ) : data.kind === "interactive" ? (
        <div className="dc-interactive-preview">
          <p>{data.body || "Texto do corpo..."}</p>
          <button type="button">{data.buttons?.[0] || "CLIQUE AQUI"}</button>
        </div>
      ) : data.kind === "blacklist" ? (
        <div className="dc-action-preview">blacklist</div>
      ) : null}

      {!isStart && !isMedia && data.kind !== "interactive" && data.kind !== "blacklist" ? (
        <div className="dc-simple-preview">{data.body || data.subtitle}</div>
      ) : null}
      {!isStart ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}

const nodeTypes = { flowCard: FlowCardNode };

export function Flows() {
  const stored = readStoredFlow();
  const [nodes, setNodes, baseOnNodesChange] = useNodesState<FlowNodeData>(stored?.nodes || initialNodes);
  const [edges, setEdges, baseOnEdgesChange] = useEdgesState(stored?.edges || initialEdges);
  const [flowName, setFlowName] = useState(stored?.name || "teste");
  const [selectedNodeId, setSelectedNodeId] = useState(stored?.selectedNodeId || "start");
  const [templates, setTemplates] = useState<SavedTemplate[]>(fallbackTemplates);
  const [nodeMenu, setNodeMenu] = useState<{
    x: number;
    y: number;
    source?: string;
    sourceHandle?: string;
  } | null>(null);
  const [pendingConnection, setPendingConnection] = useState<{ source?: string; sourceHandle?: string } | null>(null);
  const [tags, setTags] = useState<ContactTag[]>(() => readLocalContactTags());
  const [flowRun, setFlowRun] = useState<FlowRun>(() => readStoredRun());
  const [jsonOpen, setJsonOpen] = useState(false);
  const [status, setStatus] = useState("Flow editor pronto.");
  const [flowDirty, setFlowDirty] = useState(false);
  const [savedFlowAt, setSavedFlowAt] = useState(stored?.updatedAt || "");
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);
  const selectedMeta = selectedNode ? nodeInfo[selectedNode.data.kind] : null;
  const renderedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
        data: {
          ...node.data,
          deletable: true,
          onDelete: () => removeNodeById(node.id),
        },
      })),
    [nodes, selectedNodeId],
  );
  const selectedRunTag = useMemo(
    () => tags.find((tag) => tag.id === flowRun.tagId) || tags[0],
    [flowRun.tagId, tags],
  );
  const runPercent = flowRun.total ? Math.min(100, Math.round(((flowRun.delivered + flowRun.failed) / flowRun.total) * 100)) : 0;
  const canOpenBroadcast = Boolean(savedFlowAt) && !flowDirty;

  const markFlowDirty = useCallback(() => {
    setFlowDirty(true);
    setBroadcastOpen(false);
  }, []);

  const onNodesChange = useCallback(
    (changes: Parameters<typeof baseOnNodesChange>[0]) => {
      markFlowDirty();
      baseOnNodesChange(changes);
    },
    [baseOnNodesChange, markFlowDirty],
  );

  const onEdgesChange = useCallback(
    (changes: Parameters<typeof baseOnEdgesChange>[0]) => {
      markFlowDirty();
      baseOnEdgesChange(changes);
    },
    [baseOnEdgesChange, markFlowDirty],
  );

  const onConnect = useCallback(
    (connection: Edge | Connection) => {
      markFlowDirty();
      setEdges((current) => addEdge({ ...connection, animated: true }, current));
    },
    [markFlowDirty, setEdges],
  );

  const onConnectStart = useCallback((_: unknown, params: { nodeId?: string | null; handleId?: string | null }) => {
    setPendingConnection({
      source: params.nodeId || undefined,
      sourceHandle: params.handleId || undefined,
    });
  }, []);

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null;
      const isPane = target?.classList.contains("react-flow__pane");
      if (!isPane || !pendingConnection?.source) {
        setPendingConnection(null);
        return;
      }

      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      const canvas = target?.closest(".dc-canvas-wrap")?.getBoundingClientRect();
      setNodeMenu({
        x: Math.max(18, point.clientX - (canvas?.left || 0)),
        y: Math.max(18, point.clientY - (canvas?.top || 0)),
        source: pendingConnection.source,
        sourceHandle: pendingConnection.sourceHandle,
      });
      setPendingConnection(null);
    },
    [pendingConnection],
  );

  useEffect(() => {
    savedTemplates
      .normalizedList()
      .then((items) => {
        if (items.length) setTemplates(items);
      })
      .catch(() => setTemplates(fallbackTemplates));
  }, []);

  useEffect(() => {
    setTags(readLocalContactTags());
  }, []);

  useEffect(() => {
    if (flowRun.status !== "sending") return;
    const timer = window.setInterval(() => {
      setFlowRun((current) => {
        if (current.status !== "sending" || current.sent >= current.total) return current;
        const buttons = nodes.find((node) => node.id === "start")?.data.buttons || [];
        const chunk = Math.min(current.total - current.sent, Math.max(1, Math.ceil(current.total * 0.07)));
        const failed = Math.floor(chunk * 0.025);
        const delivered = chunk - failed;
        const waiting = Math.max(0, current.waiting + delivered - Math.floor(delivered * 0.42));
        const button = buttons[current.events.length % Math.max(buttons.length, 1)] || "sem botão";
        const next: FlowRun = {
          ...current,
          sent: current.sent + chunk,
          delivered: current.delivered + delivered,
          failed: current.failed + failed,
          waiting,
          currentStep: current.sent + chunk >= current.total ? "Fluxo finalizado" : `Aguardando resposta: ${button}`,
          status: current.sent + chunk >= current.total ? "done" : "sending",
          events: [
            `${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} - ${delivered} entregues, ${failed} falhas, rota ${button}`,
            ...current.events,
          ].slice(0, 7),
        };
        localStorage.setItem(LOCAL_FLOW_RUN_KEY, JSON.stringify(next));
        return next;
      });
    }, 1300);
    return () => window.clearInterval(timer);
  }, [flowRun.status, nodes]);

  function rebuildButtonBranches(buttons: string[]) {
    markFlowDirty();
    const branchNodes: Node<FlowNodeData>[] = buttons.map((button, index) => {
      const isNegative = /nao|não|sair|parar|cancel/i.test(button);
      return {
        id: `button-${index}-${isNegative ? "blacklist" : "text"}`,
        type: "flowCard",
        position: { x: 435, y: 120 + index * 180 },
        data: isNegative
          ? { kind: "blacklist", title: `Resposta ${button}`, subtitle: "blacklist" }
          : {
              kind: "text",
              title: `Resposta ${button}`,
              subtitle: `Caminho do botão ${button}`,
              body: `Contato clicou em ${button}.`,
            },
      };
    });

    setNodes((current) => [
      ...current.filter((node) => node.id === "start" || !node.id.startsWith("button-")),
      ...branchNodes,
    ]);
    setEdges((current) => [
      ...current.filter((edge) => edge.source !== "start" && !edge.target.startsWith("button-")),
      ...branchNodes.map((node, index) => ({
        id: `e-start-button-${index}`,
        source: "start",
        sourceHandle: `button-${index}`,
        target: node.id,
        animated: true,
        label: buttons[index],
      })),
    ]);
  }

  function selectTemplate(templateId: string) {
    if (!templateId) {
      removeNodeById("start");
      return;
    }
    markFlowDirty();
    const template = templates.find((item) => item.id === templateId) || fallbackTemplates[0];
    const currentStart = nodes.find((node) => node.id === "start");
    const nextData = templateToStartData(template, currentStart?.data.variableValues);
    setNodes((current) =>
      current.map((node) =>
        node.id === "start"
          ? {
              ...node,
              data: nextData,
            }
          : node,
      ),
    );
    rebuildButtonBranches(nextData.buttons || []);
    setStatus(`Template "${template.name}" carregado. ${nextData.buttons?.length || 0} saída(s) criada(s).`);
  }

  function updateTemplateVariable(variable: string, value: string) {
    markFlowDirty();
    const startNode = nodes.find((node) => node.id === "start");
    const template = templates.find((item) => item.id === startNode?.data.templateId) || fallbackTemplates[0];
    const nextValues = {
      ...(startNode?.data.variableValues || {}),
      [variable]: value,
    };
    const nextData = templateToStartData(template, nextValues);
    setNodes((current) => current.map((node) => (node.id === "start" ? { ...node, data: nextData } : node)));
  }

  function addNode(kind: FlowNodeKind) {
    markFlowDirty();
    const item = menuItems.find((entry) => entry.kind === kind);
    const x = nodeMenu?.x ? nodeMenu.x + 80 : 675;
    const y = nodeMenu?.y ? nodeMenu.y - 40 : 210 + nodes.length * 24;
    const node: Node<FlowNodeData> = {
      id: `${kind}-${Date.now()}`,
      type: "flowCard",
      position: { x, y },
      data: {
        kind,
        title: item?.title || "Novo bloco",
        subtitle: item?.label || "",
        body: kind === "text" ? "" : undefined,
        delayMs: kind === "delay" ? "1000" : undefined,
        buttons: kind === "interactive" ? ["CLIQUE AQUI"] : undefined,
      },
    };
    setNodes((current) => [...current, node]);
    if (nodeMenu?.source) {
      const source = nodeMenu.source;
      setEdges((current) =>
        addEdge(
          {
            id: `e-${source}-${node.id}`,
            source,
            sourceHandle: nodeMenu.sourceHandle || null,
            target: node.id,
            animated: true,
          },
          current,
        ),
      );
    }
    setSelectedNodeId(node.id);
    setNodeMenu(null);
  }

  function updateSelected(patch: Partial<FlowNodeData>) {
    if (!selectedNode) return;
    markFlowDirty();
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: { ...node.data, ...patch },
            }
          : node,
      ),
    );
  }

  function removeNodeById(nodeId: string) {
    markFlowDirty();
    if (nodeId === "start") {
      setNodes((current) =>
        current.map((node) =>
          node.id === "start"
            ? {
                ...node,
                data: emptyStartData(),
              }
            : node,
        ),
      );
      setEdges((current) => current.filter((edge) => edge.source !== "start"));
      setSelectedNodeId("start");
      setStatus("Template inicial removido. Selecione outro para iniciar o fluxo.");
      return;
    }
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNodeId("start");
  }

  function saveFlow() {
    const updatedAt = new Date().toISOString();
    const payload = { name: flowName, nodes, edges, selectedNodeId, updatedAt };
    localStorage.setItem(LOCAL_FLOW_EDITOR_KEY, JSON.stringify(payload));
    setSavedFlowAt(updatedAt);
    setFlowDirty(false);
    setStatus("Fluxo salvo localmente.");
  }

  function updateRun(nextRun: FlowRun) {
    setFlowRun(nextRun);
    localStorage.setItem(LOCAL_FLOW_RUN_KEY, JSON.stringify(nextRun));
  }

  function startFlowBroadcast() {
    const tag = selectedRunTag || fallbackTags[0];
    const total = Math.max(1, tagCount(tag));
    updateRun({
      status: "sending",
      tagId: tag.id,
      total,
      sent: 0,
      delivered: 0,
      failed: 0,
      waiting: 0,
      currentStep: "Enviando template inicial",
      events: [`${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} - Jornada iniciada para ${tagName(tag)}`],
    });
    saveFlow();
    setStatus("Broadcast do fluxo iniciado em modo local.");
  }

  function pauseFlowBroadcast() {
    if (flowRun.status === "sending") updateRun({ ...flowRun, status: "paused", currentStep: "Pausado" });
    if (flowRun.status === "paused") updateRun({ ...flowRun, status: "sending", currentStep: "Retomando fluxo" });
  }

  function clearFlowBroadcast() {
    updateRun(defaultRun);
    setStatus("Execucao do fluxo limpa.");
  }

  const jsonValue = JSON.stringify({ name: flowName, nodes, edges }, null, 2);

  return (
    <main className="dc-flow-page">
      <header className="dc-flow-top">
        <button className="dc-back-button" type="button">
          <ArrowLeft size={17} />
          Voltar
        </button>
        <div className="dc-flow-title">
          <span />
          <small>FLOW EDITOR</small>
          <input
            value={flowName}
            onChange={(event) => {
              markFlowDirty();
              setFlowName(event.target.value);
            }}
          />
        </div>
        <div className="dc-flow-actions">
          <button className="button secondary" disabled={!canOpenBroadcast} type="button" onClick={() => setBroadcastOpen(true)}>
            <Send size={17} />
            Broadcast
          </button>
          <button className="button" type="button" onClick={saveFlow}>
            <Save size={17} />
            {flowDirty ? "Salvar fluxo" : "Salvo"}
          </button>
          <button className="button secondary" type="button" onClick={() => setJsonOpen((current) => !current)}>
            <Code2 size={17} />
            JSON
          </button>
        </div>
      </header>

      <section className="dc-flow-workspace">
        <div className="dc-canvas-wrap">
          <ReactFlowProvider>
            <ReactFlow
              fitView
              edges={edges}
              nodes={renderedNodes}
              nodeTypes={nodeTypes}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              onConnectStart={onConnectStart}
              onEdgesChange={onEdgesChange}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onNodesChange={onNodesChange}
            >
              <Background color="hsl(218 14% 23%)" gap={17} />
              <Controls />
              <MiniMap nodeBorderRadius={7} nodeColor={(node) => nodeInfo[(node.data as FlowNodeData).kind]?.color === "green" ? "#22c55e" : "#38bdf8"} />
            </ReactFlow>
          </ReactFlowProvider>

          <button
            className="dc-add-floating"
            type="button"
            onClick={() => setNodeMenu((current) => (current ? null : { x: 390, y: 210 }))}
          >
            <Plus size={18} />
          </button>

          {nodeMenu ? (
            <div className="dc-add-menu" style={{ left: nodeMenu.x, top: nodeMenu.y }}>
              <div className="dc-add-menu-head">
                <strong>ADICIONAR NO</strong>
                <button className="dc-add-menu-close" type="button" onClick={() => setNodeMenu(null)} aria-label="Fechar menu">
                  <X size={16} />
                </button>
              </div>
              {menuItems.map((item) => {
                const meta = nodeInfo[item.kind];
                const Icon = meta.icon;
                return (
                  <button className={`dc-add-menu-item dc-add-menu-${meta.color}`} key={item.kind} type="button" onClick={() => addNode(item.kind)}>
                    <Icon size={16} />
                    <span>{item.title}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="dc-flow-status">{status}</div>
        </div>

        <aside className="dc-inspector">
          <button className="dc-inspector-close" type="button">
            <X size={17} />
          </button>
          {selectedNode && selectedMeta ? (
            <>
              <div className={`dc-inspector-head dc-inspector-${selectedMeta.color}`}>
                <selectedMeta.icon size={18} />
                <div>
                  <h2>{selectedNode.data.title}</h2>
                  <span>{selectedMeta.label}</span>
                </div>
              </div>

              <label className="field">
                <span>Nome do bloco</span>
                <input className="input" value={selectedNode.data.title} onChange={(event) => updateSelected({ title: event.target.value })} />
              </label>

              {selectedNode.data.kind === "start" ? (
                <div className="grid">
                  <p className="hint">Selecione o template aprovado. As variáveis e as saídas dos botões são criadas automaticamente.</p>
                  <label className="field">
                    <span>Template aprovado</span>
                    <select className="select" value={selectedNode.data.templateId || ""} onChange={(event) => selectTemplate(event.target.value)}>
                      <option value="">Selecione um template</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(selectedNode.data.variables || []).length ? (
                    <div className="dc-variable-list">
                      {(selectedNode.data.variables || []).map((variable) => (
                        <label className="field" key={variable}>
                          <span>{`Variável {{${variable}}}`}</span>
                          <input
                            className="input"
                            value={selectedNode.data.variableValues?.[variable] || ""}
                            onChange={(event) => updateTemplateVariable(variable, event.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="hint">Esse template não tem variáveis.</p>
                  )}
                  <div className="dc-quick-replies">
                    {(selectedNode.data.buttons || []).map((button, index) => (
                      <span key={button}>
                        {button}
                        <small>{`Saida button-${index}`}</small>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {selectedNode.data.kind === "text" ? (
                <label className="field">
                  <span>Mensagem</span>
                  <textarea className="textarea" placeholder="Digite a mensagem..." value={selectedNode.data.body || ""} onChange={(event) => updateSelected({ body: event.target.value, subtitle: event.target.value || "Mensagem vazia..." })} />
                </label>
              ) : null}

              {selectedNode.data.kind === "audio" ? (
                <div className="grid">
                  <label className="field">
                    <span>Arquivo de áudio</span>
                    <button className="button secondary" type="button">Enviar áudio (máx. 16MB)</button>
                  </label>
                  <label className="dc-toggle-row">
                    <input type="checkbox" />
                    <span>Mensagem de voz (PTT)</span>
                  </label>
                </div>
              ) : null}

              {selectedNode.data.kind === "video" ? (
                <div className="grid">
                  <label className="field">
                    <span>Arquivo de vídeo</span>
                    <button className="button secondary" type="button">Enviar vídeo (.mp4, máx. 16MB)</button>
                  </label>
                  <label className="field">
                    <span>Legenda opcional</span>
                    <textarea className="textarea" placeholder="Legenda do vídeo..." value={selectedNode.data.caption || ""} onChange={(event) => updateSelected({ caption: event.target.value })} />
                  </label>
                </div>
              ) : null}

              {selectedNode.data.kind === "image" ? (
                <div className="grid">
                  <label className="field">
                    <span>Arquivo de imagem</span>
                    <button className="button secondary" type="button">Enviar imagem (máx. 16MB)</button>
                  </label>
                  <div className="dc-recent-media">
                    {[1, 2, 3].map((item) => (
                      <div key={item}>
                        <img alt="" src={`https://picsum.photos/seed/movy-${item}/70/70`} />
                        <span>WhatsApp Image 2026-0...</span>
                      </div>
                    ))}
                  </div>
                  <label className="field">
                    <span>Legenda opcional</span>
                    <textarea className="textarea" placeholder="Legenda da imagem..." value={selectedNode.data.caption || ""} onChange={(event) => updateSelected({ caption: event.target.value })} />
                  </label>
                </div>
              ) : null}

              {selectedNode.data.kind === "delay" ? (
                <label className="field">
                  <span>Delay (milissegundos)</span>
                  <input className="input" value={selectedNode.data.delayMs || "1000"} onChange={(event) => updateSelected({ delayMs: event.target.value, subtitle: `${event.target.value}ms` })} />
                  <p className="hint">1.0s até máx. 120s</p>
                </label>
              ) : null}

              {selectedNode.data.kind === "interactive" ? (
                <div className="grid">
                  <label className="field">
                    <span>Tipo de interativo</span>
                    <select className="select">
                      <option>Botões de resposta (reply)</option>
                      <option>Call to action</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Texto do corpo</span>
                    <textarea className="textarea" placeholder="Mensagem principal..." value={selectedNode.data.body || ""} onChange={(event) => updateSelected({ body: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>Rodapé opcional</span>
                    <input className="input" placeholder="Texto do rodapé..." />
                  </label>
                  <div className="dc-quick-replies">
                    {(selectedNode.data.buttons || ["CLIQUE AQUI"]).map((button) => (
                      <span key={button}>{button}</span>
                    ))}
                  </div>
                </div>
              ) : null}

              {selectedNode.data.kind === "blacklist" ? (
                <div className="dc-info-box">
                  <strong>Registrar na blacklist</strong>
                  <p>Quando o fluxo chegar neste passo, o telefone do contato é enviado à Blacklist. Ele não será aceito novamente ao tratar uma nova lista.</p>
                </div>
              ) : null}

            </>
          ) : null}

          {jsonOpen ? <textarea className="dc-json-box" readOnly value={jsonValue} /> : null}
        </aside>
      </section>

      {broadcastOpen && canOpenBroadcast ? (
        <div className="dc-flow-broadcast-overlay">
          <section className="dc-flow-broadcast dc-flow-broadcast-modal">
            <div className="dc-flow-broadcast-head">
              <div>
                <strong>Broadcast do fluxo</strong>
                <span>{flowRun.status === "idle" ? "Configure a base e acompanhe o disparo do fluxo salvo." : flowRun.currentStep}</span>
              </div>
              <button className="dc-broadcast-close" type="button" onClick={() => setBroadcastOpen(false)} aria-label="Fechar broadcast">
                <X size={18} />
              </button>
            </div>

            <label className="field">
              <span>Base / etiqueta</span>
              <select className="select" value={flowRun.tagId || selectedRunTag?.id || ""} onChange={(event) => updateRun({ ...flowRun, tagId: event.target.value })}>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tagName(tag)} - {tagCount(tag).toLocaleString("pt-BR")} contatos
                  </option>
                ))}
              </select>
            </label>

            <div className="dc-run-progress">
              <div>
                <strong>{runPercent}%</strong>
                <span>{flowRun.status === "idle" ? "aguardando início" : flowRun.status === "done" ? "concluído" : flowRun.status}</span>
              </div>
              <i>
                <b style={{ width: `${runPercent}%` }} />
              </i>
            </div>

            <div className="dc-run-grid">
              <div>
                <span>Enviados</span>
                <strong>{flowRun.sent.toLocaleString("pt-BR")}</strong>
              </div>
              <div>
                <span>Entregues</span>
                <strong>{flowRun.delivered.toLocaleString("pt-BR")}</strong>
              </div>
              <div>
                <span>Aguardando</span>
                <strong>{flowRun.waiting.toLocaleString("pt-BR")}</strong>
              </div>
              <div>
                <span>Falhas</span>
                <strong>{flowRun.failed.toLocaleString("pt-BR")}</strong>
              </div>
            </div>

            <div className="dc-run-actions">
              <button className="button" disabled={flowRun.status === "sending"} type="button" onClick={startFlowBroadcast}>
                <Play size={16} />
                Disparar fluxo
              </button>
              <button className="button secondary" disabled={flowRun.status === "idle" || flowRun.status === "done"} type="button" onClick={pauseFlowBroadcast}>
                {flowRun.status === "paused" ? "Retomar" : "Pausar"}
              </button>
              <button className="button secondary" type="button" onClick={clearFlowBroadcast}>
                Limpar
              </button>
            </div>

            {flowRun.events.length ? (
              <div className="dc-run-events">
                {flowRun.events.map((event) => (
                  <span key={event}>{event}</span>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
