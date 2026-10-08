import { z } from "zod";
import type { WorkflowGraph } from "./types";

const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const graphSchema = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(120),
  entryNodeId: id,
  nodes: z.array(z.object({
    id,
    type: z.literal("decision"),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }),
    data: z.object({
      title: z.string().trim().min(1).max(120),
      prompt: z.string().trim().min(1).max(4000),
      demoDecision: z.enum(["YES", "NO"]),
    }),
  })).min(1).max(50),
  edges: z.array(z.object({ id, source: id, target: id, sourceHandle: z.enum(["YES", "NO"]), targetHandle: z.string().nullable().optional() })).max(100),
});

export function validateGraph(value: unknown): { graph?: WorkflowGraph; errors: string[] } {
  const parsed = graphSchema.safeParse(value);
  if (!parsed.success) return { errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "graph"}: ${issue.message}`) };
  const graph = parsed.data;
  const errors: string[] = [];
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (ids.size !== graph.nodes.length) errors.push("Each node must have a unique ID.");
  if (!ids.has(graph.entryNodeId)) errors.push("Choose an existing node as the entry point.");
  if (new Set(graph.edges.map((edge) => edge.id)).size !== graph.edges.length) errors.push("Each edge must have a unique ID.");
  const outgoing = new Set<string>();
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) errors.push(`Edge ${edge.id} points to a missing node.`);
    if (edge.source === edge.target) errors.push("A node cannot connect to itself.");
    const key = `${edge.source}:${edge.sourceHandle}`;
    if (outgoing.has(key)) errors.push(`Node ${edge.source} has more than one ${edge.sourceHandle} edge.`);
    outgoing.add(key);
  }
  // Every path must terminate. Detect cycles even in disconnected components.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let cycle = false;
  function visit(nodeId: string) {
    if (visiting.has(nodeId)) { cycle = true; return; }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const edge of graph.edges.filter((item) => item.source === nodeId)) visit(edge.target);
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  for (const node of graph.nodes) visit(node.id);
  if (cycle) errors.push("Cycles are not supported. Every branch must eventually end.");
  const reachable = new Set<string>();
  function reach(nodeId: string) {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);
    for (const edge of graph.edges.filter((item) => item.source === nodeId)) reach(edge.target);
  }
  if (ids.has(graph.entryNodeId)) reach(graph.entryNodeId);
  const disconnected = graph.nodes.filter((node) => !reachable.has(node.id));
  if (disconnected.length) errors.push(`Connect every node to the entry point. Unreachable: ${disconnected.map((node) => node.data.title).join(", ")}.`);
  return errors.length ? { errors } : { graph, errors: [] };
}

export function parseGraph(value: unknown): WorkflowGraph {
  const result = validateGraph(value);
  if (!result.graph) throw new Error(result.errors.join(" "));
  return result.graph;
}

export const exampleGraph: WorkflowGraph = {
  version: 1,
  name: "Support request triage",
  entryNodeId: "urgency",
  nodes: [
    { id: "urgency", type: "decision", position: { x: 360, y: 40 }, data: { title: "Is this urgent?", prompt: "Does the support request describe a service outage, payment failure, or a serious blocker?", demoDecision: "YES" } },
    { id: "specialist", type: "decision", position: { x: 140, y: 300 }, data: { title: "Needs a specialist?", prompt: "Does the request require engineering expertise, rather than a standard support response?", demoDecision: "YES" } },
    { id: "self-service", type: "decision", position: { x: 600, y: 300 }, data: { title: "Can docs help?", prompt: "Can the request be resolved with a documentation link or standard how-to instructions?", demoDecision: "YES" } },
    { id: "escalate", type: "decision", position: { x: 40, y: 570 }, data: { title: "Escalation ready?", prompt: "Does the request contain enough context to escalate to the engineering team?", demoDecision: "YES" } },
    { id: "support", type: "decision", position: { x: 420, y: 570 }, data: { title: "Support can resolve?", prompt: "Can a support agent resolve this request without engineering involvement?", demoDecision: "YES" } },
  ],
  edges: [
    { id: "urgency-yes", source: "urgency", target: "specialist", sourceHandle: "YES" },
    { id: "urgency-no", source: "urgency", target: "self-service", sourceHandle: "NO" },
    { id: "specialist-yes", source: "specialist", target: "escalate", sourceHandle: "YES" },
    { id: "specialist-no", source: "specialist", target: "support", sourceHandle: "NO" },
    { id: "self-service-no", source: "self-service", target: "support", sourceHandle: "NO" },
  ],
};
