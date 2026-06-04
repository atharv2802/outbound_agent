"use client";

import { useState } from "react";
import { Button, Input, Label } from "@/components/ui";

export function SenderForm({
  onSubmit,
  running,
  initialUrl = "",
}: {
  onSubmit: (url: string) => void;
  running: boolean;
  initialUrl?: string;
}) {
  const [url, setUrl] = useState(initialUrl);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) onSubmit(url.trim());
      }}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex-1">
        <Label htmlFor="sender-url">Company website</Label>
        <Input
          id="sender-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="artisan.co"
          autoComplete="off"
          spellCheck={false}
          disabled={running}
        />
      </div>
      <Button type="submit" disabled={running || !url.trim()} className="sm:w-44">
        {running ? "Analyzing…" : "Analyze sender"}
      </Button>
    </form>
  );
}
