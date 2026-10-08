import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, useNodesState, useEdgesState, MarkerType, type Node, type NodeProps, type Connection } from "@xyflow/react";
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, Check, CheckCircle2, ChevronRight, Circle, Clock3, FlaskConical, GitBranch, History, LoaderCircle, Play, Plus, RotateCcw, Save, Settings2, Sparkles, Trash2, Workflow, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { exampleGraph, validateGraph } from "../shared/graph";
import type { Decision, DecisionEdge, ExecutionMode, WorkflowGraph, WorkflowRun } from "../shared/types";

type ViewData = { title: string; prompt: string; demoDecision: Decision; entry?: boolean; phase?: string; decision?: Decision };
type FlowNode = Node<ViewData, "decision">;
const STORAGE_KEY = "branch-studio-workflow-v1";
const initialInput = "Customers cannot complete payments. The checkout returns a 500 error after clicking Pay, and this has affected every order for the last 20 minutes. Steps and error logs are attached.";

function initialGraph(): WorkflowGraph {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) { const result = validateGraph(JSON.parse(stored)); if (result.graph) return result.graph; }
  } catch { /* A damaged local save should not stop the editor opening. */ }
  return structuredClone(exampleGraph);
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "The request failed.");
  return body;
}

function DecisionCard({ data, selected }: NodeProps<FlowNode>) {
  return <div className={`decision-node ${selected ? "is-selected" : ""} ${data.phase || ""}`}>
    <Handle type="target" position={Position.Top} id="input" />
    <div className="node-eyebrow"><span><Sparkles size={12} /> AI DECISION</span>{data.entry && <span className="entry-label">START</span>}</div>
    <h3>{data.title}</h3>
    <p>{data.prompt}</p>
    {data.phase && <div className={`node-result ${data.phase}`}>
      {data.phase === "running" ? <><LoaderCircle size={12} className="spin" /> Evaluating…</> : data.phase === "done" ? <><CheckCircle2 size={12} /> Returned {data.decision}</> : <><Circle size={12} /> Not visited</>}
    </div>}
    <div className="node-ports"><span className="yes-port">YES <ChevronRight size={12} /></span><span className="no-port">NO <ChevronRight size={12} /></span></div>
    <Handle type="source" position={Position.Bottom} id="YES" style={{ left: "26%", background: "#16a46c" }} />
    <Handle type="source" position={Position.Bottom} id="NO" style={{ left: "74%", background: "#d77a3a" }} />
  </div>;
}
const nodeTypes = { decision: DecisionCard };

function Studio() {
  const [initial] = useState(initialGraph);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [name, setName] = useState(initial.name);
  const [entryNodeId, setEntryNodeId] = useState(initial.entryNodeId);
  const [selectedId, setSelectedId] = useState<string | null>(initial.entryNodeId);
  const [input, setInput] = useState(initialInput);
  const [mode, setMode] = useState<ExecutionMode>("demo");
  const [status, setStatus] = useState<{ openaiConfigured: boolean; model: string; inngestReady: boolean } | null>(null);
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [history, setHistory] = useState<WorkflowRun[]>([]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [tab, setTab] = useState<"trace" | "history">("trace");
  const importRef = useRef<HTMLInputElement>(null);
  const busy = pending || Boolean(run && ["queued", "running", "retrying"].includes(run.status));

  const graph: WorkflowGraph = useMemo(() => ({ version: 1, name, entryNodeId, nodes: nodes.map(({ id, position, data }) => ({ id, position, type: "decision", data: { title: data.title, prompt: data.prompt, demoDecision: data.demoDecision } })), edges: edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({ id, source, target, sourceHandle: sourceHandle as Decision, targetHandle })) }), [name, entryNodeId, nodes, edges]);
  const validation = useMemo(() => validateGraph(graph), [graph]);
  const selected = nodes.find((node) => node.id === selectedId);
  const notify = (text: string, error = false) => setNotice({ text, error });

  const refreshStatus = useCallback(async () => {
    try { setStatus(await request("/api/status")); } catch { setStatus(null); }
  }, []);
  const refreshHistory = useCallback(async () => {
    try { setHistory(await request("/api/runs")); } catch { /* The status indicator reports connection problems. */ }
  }, []);
  useEffect(() => { void refreshStatus(); void refreshHistory(); const timer = setInterval(refreshStatus, 8000); return () => clearInterval(timer); }, [refreshStatus, refreshHistory]);
  useEffect(() => {
    if (!run || !["queued", "running", "retrying"].includes(run.status)) return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const updated = await request<WorkflowRun>(`/api/runs/${run.id}`);
        if (alive) { setRun(updated); if (["completed", "failed"].includes(updated.status)) void refreshHistory(); }
      } catch (error) { if (alive) notify((error as Error).message, true); }
    }, 700);
    return () => { alive = false; clearInterval(timer); };
  }, [run?.id, run?.status, refreshHistory]);

  function loadGraph(value: WorkflowGraph) {
    setNodes(value.nodes); setEdges(value.edges); setName(value.name); setEntryNodeId(value.entryNodeId); setSelectedId(value.entryNodeId); setRun(null);
  }
  function updateNode(patch: Partial<ViewData>) { setRun(null); setNodes((items) => items.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, ...patch } } : node)); }
  function addNode() {
    const id = `node-${crypto.randomUUID()}`;
    setRun(null);
    setNodes((items) => [...items, { id, type: "decision", position: { x: 370, y: items.length * 70 + 80 }, data: { title: "New decision", prompt: "Does the input meet this condition?", demoDecision: "YES" } }]);
    setSelectedId(id);
    notify("Node added. Connect a YES or NO handle to its top input.");
  }
  function deleteNode() {
    if (!selectedId) return;
    const remaining = nodes.filter((node) => node.id !== selectedId);
    if (!remaining.length) { notify("Keep at least one decision node.", true); return; }
    setRun(null); setNodes(remaining); setEdges((items) => items.filter((edge) => edge.source !== selectedId && edge.target !== selectedId));
    if (entryNodeId === selectedId) setEntryNodeId(remaining[0].id);
    setSelectedId(null);
  }
  function connect(connection: Connection) {
    if (busy || !connection.source || !connection.target || !["YES", "NO"].includes(connection.sourceHandle || "")) return;
    if (edges.some((edge) => edge.source === connection.source && edge.sourceHandle === connection.sourceHandle)) { notify("That branch already has an edge. Select the edge and press Delete before reconnecting.", true); return; }
    const edge: DecisionEdge = { id: `edge-${crypto.randomUUID()}`, source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle as Decision, targetHandle: connection.targetHandle };
    const test = validateGraph({ ...graph, edges: [...graph.edges, edge] });
    const blocking = test.errors.filter((error) => error.includes("Cycles") || error.includes("itself"));
    if (blocking.length) { notify(blocking.join(" "), true); return; }
    setRun(null); setEdges((items) => [...items, edge]);
  }
  function save() {
    if (validation.errors.length) { notify(validation.errors[0], true); return; }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(graph)); notify("Workflow saved in this browser."); }
    catch { notify("The browser could not save this workflow. Export JSON instead.", true); }
  }
  function exportGraph() {
    if (validation.errors.length) { notify(validation.errors[0], true); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "decision-workflow.json"; link.click(); URL.revokeObjectURL(url);
    notify("Workflow exported as JSON.");
  }
  async function importGraph(file?: File) {
    if (!file) return;
    if (file.size > 256000) { notify("Choose a workflow JSON smaller than 256 KB.", true); return; }
    try {
      const result = validateGraph(JSON.parse(await file.text()));
      if (!result.graph) { notify(result.errors[0], true); return; }
      loadGraph(result.graph); notify("Workflow imported. Save to keep it in this browser.");
    } catch { notify("That file is not valid workflow JSON.", true); }
  }
  async function startRun(retry = false) {
    setPending(true); setNotice(null); setTab("trace");
    try {
      const result = await request<WorkflowRun>(retry && run ? `/api/runs/${run.id}/retry` : "/api/runs", { method: "POST", body: retry ? undefined : JSON.stringify({ graph, input, mode }) });
      setRun(result); void refreshHistory();
    } catch (error) { notify((error as Error).message, true); }
    finally { setPending(false); }
  }
  function inspectRun(item: WorkflowRun) {
    loadGraph(item.graph); setInput(item.input); setMode(item.mode); setRun(item); setTab("trace");
  }

  const decoratedNodes = nodes.map((node) => {
    const completed = run?.steps.find((step) => step.nodeId === node.id);
    return { ...node, data: { ...node.data, entry: node.id === entryNodeId, phase: run ? run.activeNodeId === node.id ? "running" : completed ? "done" : "unvisited" : undefined, decision: completed?.decision } };
  });
  const decoratedEdges = edges.map((edge) => {
    const taken = run?.steps.some((step) => step.nodeId === edge.source && step.decision === edge.sourceHandle && step.nextNodeId === edge.target);
    const color = edge.sourceHandle === "YES" ? "#16a46c" : "#d77a3a";
    return { ...edge, label: edge.sourceHandle, animated: Boolean(taken), style: { stroke: color, strokeWidth: taken ? 3 : 1.7, opacity: run && !taken ? 0.25 : 1 }, labelStyle: { fill: color, fontWeight: 700, fontSize: 10 }, labelBgStyle: { fill: "#f7f8fa" }, labelBgPadding: [5, 3] as [number, number], markerEnd: { type: MarkerType.ArrowClosed, color } };
  });
  const visitedCount = run?.steps.length || 0;

  return <div className="studio">
    <header className="app-header">
      <div className="brand"><div className="brand-icon"><GitBranch size={21} /></div><div><strong>branch<span>studio</span></strong><small>AI DECISION WORKSPACE</small></div></div>
      <div className="header-breadcrumb">Workspace <ChevronRight size={14} /><span>Decision flows</span></div>
      <div className="header-right"><Badge className="assignment-badge">FLYRANK · BE09</Badge><span className="avatar">AR</span></div>
    </header>
    <div className="workflow-toolbar">
      <div className="workflow-name"><Workflow size={19} /><div><input aria-label="Workflow name" value={name} onChange={(event) => { setRun(null); setName(event.target.value); }} disabled={busy} maxLength={120} /><span>{nodes.length} decisions <i>·</i> {edges.length} connections <i>·</i> {validation.errors.length ? "Needs connections" : "Ready to run"}</span></div></div>
      <div className="toolbar-actions">
        <Button variant="ghost" size="sm" onClick={save} disabled={busy}><Save /> Save</Button>
        <Button variant="ghost" size="sm" onClick={exportGraph} disabled={busy}><ArrowDownToLine /> Export</Button>
        <Button variant="ghost" size="sm" onClick={() => importRef.current?.click()} disabled={busy}><ArrowUpFromLine /> Import</Button>
        <div className="toolbar-divider" />
        <Button onClick={() => startRun()} disabled={busy || validation.errors.length > 0 || !input.trim()}>{busy ? <LoaderCircle className="spin" /> : <Play fill="currentColor" />} {busy ? "Running…" : "Run workflow"}</Button>
      </div>
      <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={(event) => { void importGraph(event.target.files?.[0]); event.target.value = ""; }} />
    </div>
    {notice && <div role={notice.error ? "alert" : "status"} className={`notice ${notice.error ? "error" : ""}`}>{notice.error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}<span>{notice.text}</span><button aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={15} /></button></div>}
    <main className="workspace">
      <section className="canvas-column">
        <div className="canvas">
          <div className="canvas-toolbar"><Button variant="outline" onClick={addNode} disabled={busy}><Plus /> Add decision</Button><Button variant="outline" size="icon" title="Load example workflow" aria-label="Load example workflow" disabled={busy} onClick={() => { loadGraph(structuredClone(exampleGraph)); notify("Example workflow loaded."); }}><RotateCcw /></Button></div>
          <div className="canvas-help"><GitBranch size={13} /><span>Drag to arrange. Connect YES / NO to an input.</span></div>
          <ReactFlow nodes={decoratedNodes} edges={decoratedEdges} nodeTypes={nodeTypes} onNodesChange={busy ? undefined : onNodesChange} onEdgesChange={busy ? undefined : onEdgesChange} onConnect={connect} onNodeClick={(_event, node) => setSelectedId(node.id)} onPaneClick={() => setSelectedId(null)} onBeforeDelete={async ({ nodes: deleting }) => { if (deleting.length === nodes.length) { notify("Keep at least one decision node.", true); return false; } return true; }} onNodesDelete={(deleted) => { setRun(null); if (deleted.some((node) => node.id === entryNodeId)) setEntryNodeId(nodes.find((node) => !deleted.some((item) => item.id === node.id))?.id || ""); if (deleted.some((node) => node.id === selectedId)) setSelectedId(null); }} onEdgesDelete={() => setRun(null)} nodesDraggable={!busy} nodesConnectable={!busy} elementsSelectable={!busy} deleteKeyCode={busy ? null : ["Backspace", "Delete"]} minZoom={0.35} maxZoom={1.5} fitView fitViewOptions={{ padding: 0.18 }} defaultEdgeOptions={{ type: "smoothstep" }}>
            <Background color="#d8dbe4" gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap nodeColor="#c4b5fd" maskColor="rgba(247,248,250,0.7)" pannable zoomable />
          </ReactFlow>
          <div className="canvas-legend"><span><i className="dot yes" /> YES path</span><span><i className="dot no" /> NO path</span><span><i className="dot muted" /> No edge = finish</span></div>
        </div>
        <section className="run-panel">
          <div className="run-tabs"><button className={tab === "trace" ? "active" : ""} onClick={() => setTab("trace")}><Workflow size={15} /> Execution trace {run && <Badge>{visitedCount}</Badge>}</button><button className={tab === "history" ? "active" : ""} onClick={() => { setTab("history"); void refreshHistory(); }}><History size={15} /> Run history <Badge>{history.length}</Badge></button><div className="run-summary">{run && <><span className={`status-dot ${run.status}`} />{run.status}<Badge>{run.mode === "demo" ? "DEMO · NO LLM" : "OPENAI"}</Badge>{run.status === "failed" && <Button variant="outline" size="sm" onClick={() => startRun(true)} disabled={busy}><RotateCcw /> Retry</Button>}</>}</div></div>
          {tab === "trace" ? <div className="trace-body">
            {!run ? <div className="empty-state"><div className="empty-icon"><Play size={18} /></div><div><strong>Your next decision starts here.</strong><p>Run the workflow to see the path, results, and timing for every visited node.</p></div></div> : <>
              <div className="trace-path">{run.steps.map((step, index) => <div className="trace-step" key={step.nodeId}><span className="step-number">{index + 1}</span><div><strong>{step.title}</strong><span>{step.durationMs} ms{(run.attempts[step.nodeId] || 1) > 1 ? ` · attempt ${run.attempts[step.nodeId]}` : ""}</span></div><Badge className={step.decision === "YES" ? "yes-badge" : "no-badge"}>{step.decision}</Badge>{step.nextNodeId && <ChevronRight size={14} />}</div>)}{busy && <div className="trace-wait"><LoaderCircle size={17} className="spin" />{run.status === "retrying" ? "Retrying the current decision…" : run.activeNodeId ? "Evaluating the next decision…" : "Waiting for Inngest…"}</div>}{run.status === "completed" && <div className="trace-end"><CheckCircle2 size={17} /><span>Path complete</span></div>}</div>
              {run.error && <div className="trace-error"><AlertCircle size={14} />{run.error}</div>}
              <div className="trace-meta">Run {run.id.slice(0, 8)} <span>·</span> {new Date(run.createdAt).toLocaleString()} <span>·</span> {run.steps.length} / {run.graph.nodes.length} nodes visited {run.retriedFrom && <span>· Retry of {run.retriedFrom.slice(0, 8)}</span>}</div>
            </>}
          </div> : <div className="history-body">{history.length ? history.map((item) => <button className="history-row" key={item.id} onClick={() => inspectRun(item)} disabled={busy}><span className={`status-dot ${item.status}`} /><div><strong>{item.graph.name}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.id.slice(0, 8)}</small></div><Badge>{item.mode}</Badge><span className="history-status">{item.status}</span><ChevronRight size={14} /></button>) : <div className="empty-state"><History size={22} /><p>Completed and failed runs will appear here.</p></div>}</div>}
        </section>
      </section>
      <aside className="inspector">
        <section className="inspector-section"><div className="section-heading"><Settings2 size={15} /><h2>Run configuration</h2></div><label className="field-label" htmlFor="workflow-input">Workflow input</label><textarea id="workflow-input" value={input} onChange={(event) => setInput(event.target.value)} disabled={busy} rows={4} maxLength={12000} placeholder="Describe the scenario your workflow should evaluate…" /><div className="input-hint">Every visited node receives this context.</div>
          <label className="field-label">Execution mode</label><div className="mode-switch"><button className={mode === "demo" ? "selected" : ""} onClick={() => setMode("demo")} disabled={busy}><FlaskConical size={14} />Demo</button><button className={mode === "openai" ? "selected" : ""} onClick={() => setMode("openai")} disabled={busy || !status?.openaiConfigured}><Sparkles size={14} />OpenAI</button></div>
          <div className="mode-explanation">{mode === "demo" ? <>Demo uses the YES / NO answer you choose for each node. <strong>No LLM is called.</strong></> : <>Prompts are evaluated by <strong>{status?.model}</strong> through the server.</>}</div>
          <div className="connection-state"><span className={`status-dot ${status?.inngestReady ? "completed" : "failed"}`} /><span>{status?.inngestReady ? "Inngest connected" : status ? "Start the Inngest Dev Server" : "API connection unavailable"}</span><button onClick={() => void refreshStatus()} title="Refresh connection" aria-label="Refresh connection"><RotateCcw size={12} /></button></div>
          {!status?.openaiConfigured && <p className="key-hint">Add OPENAI_API_KEY to the server’s .env to enable OpenAI.</p>}
        </section>
        <section className="inspector-section node-editor"><div className="section-heading"><Sparkles size={15} /><h2>Decision inspector</h2>{selected && <Badge>{selected.id === entryNodeId ? "ENTRY" : "NODE"}</Badge>}</div>
          {selected ? <><label className="field-label" htmlFor="node-title">Node name</label><input id="node-title" value={selected.data.title} onChange={(event) => updateNode({ title: event.target.value })} disabled={busy} maxLength={120} /><label className="field-label" htmlFor="node-prompt">Decision prompt</label><textarea id="node-prompt" value={selected.data.prompt} onChange={(event) => updateNode({ prompt: event.target.value })} disabled={busy} rows={4} maxLength={4000} /><div className="input-hint">Ask one clear yes-or-no question.</div><label className="field-label">Demo answer</label><div className="answer-switch"><button className={selected.data.demoDecision === "YES" ? "selected yes-answer" : ""} onClick={() => updateNode({ demoDecision: "YES" })} disabled={busy}><Check size={13} />YES</button><button className={selected.data.demoDecision === "NO" ? "selected no-answer" : ""} onClick={() => updateNode({ demoDecision: "NO" })} disabled={busy}><X size={13} />NO</button></div><div className="node-editor-actions"><Button variant="outline" size="sm" disabled={busy || selected.id === entryNodeId} onClick={() => { setRun(null); setEntryNodeId(selected.id); }}>Set as entry</Button><Button variant="destructive" size="sm" disabled={busy || nodes.length === 1} onClick={deleteNode}><Trash2 /> Delete</Button></div><div className="node-id">ID: {selected.id.length > 25 ? `${selected.id.slice(0, 25)}…` : selected.id}</div></> : <div className="select-hint"><Circle size={22} /><p>Select a node on the canvas<br />to edit its question and answer.</p></div>}
        </section>
        <Card className="quick-tip"><div><GitBranch size={14} /><strong>One decision. One direction.</strong></div><p>A YES result follows the green edge. A NO result follows the orange edge. A result without an edge finishes the run.</p>{validation.errors.length > 0 && <div className="graph-warning"><AlertCircle size={13} />{validation.errors[0]}</div>}</Card>
        <div className="inspector-footer"><Clock3 size={12} /> History saved on the server · workflow saved locally</div>
      </aside>
    </main>
  </div>;
}
export default function App() { return <ReactFlowProvider><Studio /></ReactFlowProvider>; }
