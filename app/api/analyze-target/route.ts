import { z } from "zod";
import { sseResponse } from "@/lib/sse";
import { hasOpenAIKey } from "@/lib/config";
import { isUrlAllowed, sanitizePersonaField } from "@/lib/guardrails/input";
import { runTargetAnalysis } from "@/lib/agent/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  targetUrl: z
    .string()
    .min(3)
    .refine((u) => isUrlAllowed(u), {
      message: "Target URL is invalid, internal, or not allowed.",
    }),
  senderUrl: z
    .string()
    .min(3)
    .refine((u) => isUrlAllowed(u), {
      message: "Sender URL is invalid, internal, or not allowed.",
    })
    .optional(),
  persona: z.object({
    role: z.string().min(1).max(80),
    seniority: z.string().min(1).max(80),
  }),
});

export async function POST(req: Request): Promise<Response> {
  if (!hasOpenAIKey()) {
    return Response.json(
      { error: "OPENAI_API_KEY is not set on the server. Add it to .env.local." },
      { status: 503 },
    );
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    const json = await req.json();
    parsed = bodySchema.parse(json);
  } catch (err) {
    const message =
      err instanceof z.ZodError ? err.issues[0]?.message : "Invalid request body.";
    return Response.json({ error: message }, { status: 400 });
  }

  const persona = {
    role: sanitizePersonaField(parsed.persona.role),
    seniority: sanitizePersonaField(parsed.persona.seniority),
  };

  return sseResponse((emit) =>
    runTargetAnalysis({
      targetUrl: parsed.targetUrl,
      senderUrl: parsed.senderUrl,
      persona,
      emit,
    }),
  );
}
