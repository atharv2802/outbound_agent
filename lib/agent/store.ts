/**
 * Sender-profile store: the persisted Mode 1 → Mode 2 contract, keyed by
 * registrable domain and TTL'd like everything else. Module-level so it survives
 * across requests within a single long-lived process (see README caveat).
 */

import { TTLCache } from "@/lib/infra/cache";
import { config } from "@/lib/config";
import type { SenderProfile } from "@/lib/types";

const profileStore = new TTLCache<SenderProfile>(config.store.senderProfileTtlMs);

export function saveSenderProfile(profile: SenderProfile): void {
  profileStore.set(profile.domain, profile);
}

export function getSenderProfile(domain: string): SenderProfile | undefined {
  return profileStore.get(domain);
}

export function hasSenderProfile(domain: string): boolean {
  return profileStore.has(domain);
}
