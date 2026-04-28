import { promises as fs } from "node:fs";
import path from "node:path";

interface SeedHospital {
  name: string;
  address: string;
  lat: number;
  lng: number;
  capabilities: string[];
  phone?: string;
}

interface RawSeedRow {
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  location?: { lat: number; lng: number };
  capabilities?: string[];
  phone?: string;
  emergency_contact?: string;
  whatsapp_number?: string;
}

let cache: SeedHospital[] | null = null;

/** Load /data/hospitals/bangalore.json from the repo root. Cached after first read. */
export async function loadSeedHospitals(): Promise<SeedHospital[]> {
  if (cache) return cache;

  const candidates = [
    path.join(process.cwd(), "..", "data", "hospitals", "bangalore.json"),
    path.join(process.cwd(), "data", "hospitals", "bangalore.json"),
  ];

  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, "utf-8");
      const parsed = JSON.parse(raw) as RawSeedRow[] | { hospitals: RawSeedRow[] };
      const list: RawSeedRow[] = Array.isArray(parsed) ? parsed : parsed.hospitals ?? [];

      cache = list.map((h) => ({
        name: h.name,
        address: h.address ?? "",
        lat: h.location?.lat ?? h.lat ?? h.latitude ?? 0,
        lng: h.location?.lng ?? h.lng ?? h.longitude ?? 0,
        capabilities: h.capabilities ?? [],
        phone: h.phone ?? h.emergency_contact ?? h.whatsapp_number,
      }));
      return cache;
    } catch {
      // try next path
    }
  }

  console.warn("[hospitals-seed] data/hospitals/bangalore.json not found — empty seed");
  cache = [];
  return cache;
}
