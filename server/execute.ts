import { parseGraph } from "../shared/graph";
import type { Decision, DecisionNode, EvaluatedDecision, ExecutionStep, WorkflowGraph } from "../shared/types";

export function parseDecision(raw: string): Decision {
  const value = raw.trim();
  if (value !== "YES" && value !== "NO") throw new Error("The model must return exactly YES or NO. No branch was taken.");
  return value;
}

type StepRunner = <T>(id: string, work: () => Promise<T>) => Promise<T>;
export async function executeGraph(
  graphValue: WorkflowGraph,
  input: string,
  decide: (node: DecisionNode, input: string, previous: ExecutionStep[]) => Promise<Decision | EvaluatedDecision>,
  runStep: StepRunner,
  onStart: (node: DecisionNode) => Promise<void> = async () => {},
  onComplete: (step: ExecutionStep) => Promise<void> = async () => {},
): Promise<ExecutionStep[]> {
  const graph = parseGraph(graphValue);
  const steps: ExecutionStep[] = [];
  let current: string | null = graph.entryNodeId;
  while (current) {
    const node = graph.nodes.find((item) => item.id === current)!;
    const result: ExecutionStep = await runStep(`decision-${node.id}`, async () => {
      await onStart(node);
      const start = Date.now();
      const evaluated = await decide(node, input, steps);
      const decision = parseDecision(typeof evaluated === "string" ? evaluated : evaluated.decision);
      const edge = graph.edges.find((item) => item.source === node.id && item.sourceHandle === decision);
      const result: ExecutionStep = { nodeId: node.id, title: node.data.title, decision, nextNodeId: edge?.target ?? null, durationMs: Date.now() - start, completedAt: new Date().toISOString(), ...(typeof evaluated === "string" ? {} : { provider: evaluated.provider }) };
      await onComplete(result);
      return result;
    });
    steps.push(result);
    current = result.nextNodeId;
  }
  return steps;
}
