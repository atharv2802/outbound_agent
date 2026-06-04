"use client";

import { useState } from "react";
import { Button, Input, Label } from "@/components/ui";

export interface TargetSubmit {
  senderUrl: string;
  targetUrl: string;
  role: string;
  seniority: string;
}

export function TargetForm({
  onSubmit,
  running,
  initial,
}: {
  onSubmit: (data: TargetSubmit) => void;
  running: boolean;
  initial?: Partial<TargetSubmit>;
}) {
  const [senderUrl, setSenderUrl] = useState(initial?.senderUrl ?? "");
  const [targetUrl, setTargetUrl] = useState(initial?.targetUrl ?? "");
  const [role, setRole] = useState(initial?.role ?? "VP of Sales");
  const [seniority, setSeniority] = useState(initial?.seniority ?? "Executive");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (senderUrl.trim() && targetUrl.trim()) {
          onSubmit({
            senderUrl: senderUrl.trim(),
            targetUrl: targetUrl.trim(),
            role: role.trim() || "Decision Maker",
            seniority: seniority.trim() || "Director",
          });
        }
      }}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <div>
        <Label htmlFor="t-sender">Your company (sender)</Label>
        <Input
          id="t-sender"
          value={senderUrl}
          onChange={(e) => setSenderUrl(e.target.value)}
          placeholder="artisan.co"
          autoComplete="off"
          spellCheck={false}
          disabled={running}
        />
      </div>
      <div>
        <Label htmlFor="t-target">Target company</Label>
        <Input
          id="t-target"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="ramp.com"
          autoComplete="off"
          spellCheck={false}
          disabled={running}
        />
      </div>
      <div>
        <Label htmlFor="t-role">Recipient role</Label>
        <Input
          id="t-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="VP of Sales"
          disabled={running}
        />
      </div>
      <div>
        <Label htmlFor="t-seniority">Recipient seniority</Label>
        <Input
          id="t-seniority"
          value={seniority}
          onChange={(e) => setSeniority(e.target.value)}
          placeholder="Executive"
          disabled={running}
        />
      </div>
      <div className="sm:col-span-2">
        <Button
          type="submit"
          disabled={running || !senderUrl.trim() || !targetUrl.trim()}
          className="w-full sm:w-auto"
        >
          {running ? "Working…" : "Generate outbound"}
        </Button>
      </div>
    </form>
  );
}
