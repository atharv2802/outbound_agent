/**
 * Shared run state and tool-context types for the agent runtime.
 */

import type { Gateway } from "@/lib/gateway";
import type { RetrievalIndex } from "@/lib/retrieval";
import type {
  Angle,
  BuyerSignals,
  CompanySignals,
  Email,
  FitEvaluation,
  Persona,
  SenderProfile,
  StreamEvent,
} from "@/lib/types";

export type AgentMode = "sender" | "target";

export interface Observation {
  turn: number;
  thought: string;
  action: string;
  summary: string;
  isError?: boolean;
}

export interface RunState {
  mode: AgentMode;
  rootUrl: string;
  scopeDomain: string;
  gateway: Gateway;
  index: RetrievalIndex;
  emit: (event: StreamEvent) => void;

  turn: number;
  startedAt: number;
  observations: Observation[];
  homepageHeadings: string[];

  // Mode 1 collected state
  companySignals?: CompanySignals;
  senderProfile?: SenderProfile; // output (mode 1) / input (mode 2)

  // Mode 2 collected state
  persona?: Persona;
  buyerSignals?: BuyerSignals;
  fitEvaluation?: FitEvaluation;
  angles?: [Angle, Angle];
  emails: Email[];

  /** When true, only `finish` is offered to the model (graceful close). */
  forceFinish: boolean;
}

export type ToolHandler<Args> = (
  state: RunState,
  args: Args,
) => Promise<import("@/lib/types").ToolResult>;
