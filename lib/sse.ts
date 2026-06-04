/**
 * Server-Sent Events helper. Wraps an async runner that pushes StreamEvents into
 * a ReadableStream formatted as `data: {json}\n\n`.
 */

import type { StreamEvent } from "@/lib/types";

export function sseResponse(
  run: (emit: (event: StreamEvent) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        await run(emit);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error.";
        emit({ type: "error", message, recoverable: false });
        emit({ type: "done" });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
