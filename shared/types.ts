export type Decision = "YES" | "NO";
export type ExecutionMode = "demo" | "openai";
export type ProviderKind = "local-openai-compatible" | "openai" | "openai-compatible";
export interface ProviderResponse {
  kind: ProviderKind;
  model: string;
  responseId: string;
  outputIds: string[];
  rawOutput: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}
export interface EvaluatedDecision {
  decision: Decision;
  provider: ProviderResponse;
}

export interface DecisionNode {
  id: string;
  type: "decision";
  position: { x: number; y: number };
  data: { title: string; prompt: string; demoDecision: Decision };
}
export interface DecisionEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: Decision;
  targetHandle?: string | null;
}
export interface WorkflowGraph {
  version: 1;
  name: string;
  entryNodeId: string;
  nodes: DecisionNode[];
  edges: DecisionEdge[];
}
export interface ExecutionStep {
  nodeId: string;
  title: string;
  decision: Decision;
  nextNodeId: string | null;
  durationMs: number;
  completedAt: string;
  provider?: ProviderResponse;
}
export type RunStatus = "queued" | "running" | "retrying" | "completed" | "failed";
export interface WorkflowRun {
  id: string;
  graph: WorkflowGraph;
  input: string;
  mode: ExecutionMode;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  eventId?: string;
  steps: ExecutionStep[];
  activeNodeId: string | null;
  attempts: Record<string, number>;
  error: string | null;
  retriedFrom?: string;
}
