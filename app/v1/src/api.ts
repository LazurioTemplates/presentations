import { getDeckDetail, getDeckSummaries } from "./decks.ts";

/** The App's one listener (`lazurio.runtime.listeners[0].id`), which
 * `appAccess` and the tools for agents read. */
export const LISTENER = "web";

/** Where a tool call came from (`mcp` or `webmcp`), on the request a tool
 * sends to the API; a request of the page itself has none. */
export const CHANNEL_HEADER = "x-lazurio-channel";

const DECK_DETAIL = /^\/api\/decks\/([^/]+)$/;

/**
 * The library's read-only API: `GET /api/decks` and `GET /api/decks/<slug>`,
 * deck words in `?lang=` where a deck has it. Answers `null` for any other
 * request. The server calls it for the page (after its Host and role checks)
 * and the tools for agents call it in the same process (`agent-tools.ts`), so
 * both read the same answer.
 */
export async function decksApi(req: Request): Promise<Response | null> {
  if (req.method !== "GET") return null;
  const url = new URL(req.url);
  const pathname = url.pathname;
  const language = url.searchParams.get("lang") ?? undefined;
  if (pathname === "/api/decks") {
    return Response.json({
      decks: await getDeckSummaries(language),
      generatedAt: new Date().toISOString(),
    });
  }
  const detailMatch = pathname.match(DECK_DETAIL);
  if (detailMatch) {
    let slug: string;
    try {
      slug = decodeURIComponent(detailMatch[1]);
    } catch {
      return Response.json({ error: "malformed_slug" }, { status: 400 });
    }
    const detail = await getDeckDetail(slug, language);
    if (!detail) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(detail);
  }
  return null;
}
