import { tool } from "ai";
import { z } from "zod";

interface SerperResult {
  title: string;
  snippet: string;
  link: string;
}

interface SerperPlace {
  title?: string;
  name?: string;
  address?: string;
  rating?: number;
  phone?: string;
  website?: string;
  link?: string;
}

export const searchWeb = tool({
  description:
    "Search the web (via SerperDev / Google). Useful for things you don't otherwise know: 'is X hospital open right now', news on a current incident, info on a specific medication, supplementary lookups. Not the first move — use triagePatient and findHospitals for the primary flow.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("Search query (3–6 keywords, include location if relevant)"),
  }),
  execute: async ({ query }) => {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      return {
        results: [],
        query,
        error: "Search unavailable — SERPER_API_KEY not configured",
      };
    }

    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: 10 }),
      });

      if (!res.ok) {
        return {
          results: [],
          query,
          error: `Serper HTTP ${res.status}`,
        };
      }

      const data = (await res.json()) as {
        organic?: SerperResult[];
        places?: SerperPlace[];
        knowledgeGraph?: { title: string; description?: string; website?: string };
      };

      const organic = (data.organic ?? []).slice(0, 8).map((r) => ({
        title: r.title,
        snippet: r.snippet,
        link: r.link,
      }));

      const places = (data.places ?? []).slice(0, 5).map((p) => ({
        title: p.title || p.name || "Place",
        snippet: [p.address, p.rating ? `${p.rating}★` : "", p.phone]
          .filter(Boolean)
          .join(" · "),
        link:
          p.website ||
          p.link ||
          `https://www.google.com/maps/search/${encodeURIComponent(p.title || p.name || "")}`,
      }));

      const kg = data.knowledgeGraph
        ? [
            {
              title: data.knowledgeGraph.title,
              snippet: data.knowledgeGraph.description ?? "",
              link: data.knowledgeGraph.website ?? "",
            },
          ]
        : [];

      const merged = [...places, ...organic, ...kg]
        .filter((r) => r.title && r.link)
        .slice(0, 10);

      return {
        results: merged,
        query,
        count: merged.length,
      };
    } catch (err) {
      return {
        results: [],
        query,
        error: (err as Error).message,
      };
    }
  },
});
