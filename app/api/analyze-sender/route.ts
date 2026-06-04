import { z } from "zod";
import { sseResponse } from "@/lib/sse";
import { hasOpenAIKey } from "@/lib/config";
import { isUrlAllowed } from "@/lib/guardrails/input";
import { runSenderAnalysis } from "@/lib/agent/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  url: z
    .string()
    .min(3)
    .refine((u) => isUrlAllowed(u), {
      message: "URL is invalid, internal, or not allowed.",
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

  return sseResponse((emit) => runSenderAnalysis({ url: parsed.url, emit }));
}
