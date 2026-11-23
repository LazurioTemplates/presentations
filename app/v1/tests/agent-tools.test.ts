import { describe, expect, test } from "bun:test";
import type { ToolAuditEvent } from "@lazurio/module-kit/tools";
import {
  gatewayRequest,
  hostedEnvironment,
  mcpCall,
  mcpTool,
  mcpToolNames,
  pageTool,
  TEST_ORIGIN,
} from "@lazurio/module-kit/tools/testing";
import { createAgentTools, TOOL_MESSAGES } from "../src/agent-tools.ts";
import { CHANNEL_HEADER, decksApi, LISTENER } from "../src/api.ts";
import { listDeckSlugs } from "../src/decks.ts";

// The tools for agents over the library's own API, as the Application host
// runs them: the gateway states who came. Generation v1 changes nothing, so
// a copy that may write offers the same reading tools as one that may not.
const TOOLS = ["get_app_context", "get_deck", "list_decks"];
// The sample deck of the template (`sample-deck.test.ts`); an Organization
// that starts empty deletes it, and the tests that need it skip.
const SAMPLE = "2026-11-02-example-office-coffee";
const hasSample = (await listDeckSlugs()).includes(SAMPLE);

function setup(writer: boolean, language: "cs" | "en" = "en") {
  const audits: ToolAuditEvent[] = [];
  const channels: (string | null)[] = [];
  const env = hostedEnvironment({ writer, listener: LISTENER });
  const tools = createAgentTools({
    api: (request) => {
      channels.push(request.headers.get(CHANNEL_HEADER));
      return decksApi(request);
    },
    language,
    env,
    audit: (event) => audits.push(event),
  });
  return { tools, audits, channels };
}

const user = { role: "user" } as const;
const admin = { role: "admin" } as const;

describe("tools for agents", () => {
  for (const writer of [false, true]) {
    test(`an application user and admin see the reading tools (writer ${writer})`, async () => {
      const { tools } = setup(writer);
      expect(await mcpToolNames(tools, user)).toEqual(TOOLS);
      expect(await mcpToolNames(tools, admin)).toEqual(TOOLS);
      const manifest = await tools.handlePage(gatewayRequest("/api/agent-tools", { caller: user }));
      const listed = (await manifest?.json()) as { tools: { name: string; effect: string }[] };
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(TOOLS);
      expect(listed.tools.every((tool) => tool.effect === "read")).toBe(true);
    });
  }

  test("without a role /mcp and the page refuse with identity_unavailable", async () => {
    const { tools } = setup(true);
    const mcp = await mcpCall(tools, "tools/list", {}, { caller: { role: "none" } });
    expect(mcp.status).toBe(403);
    expect(mcp.body.error).toBe("identity_unavailable");
    const page = await pageTool(tools, "list_decks", {}, { role: "none" });
    expect(page.status).toBe(403);
    expect(page.body.reason).toBe("identity_unavailable");
  });

  test("list_decks returns what GET /api/decks returns", async () => {
    const { tools, audits, channels } = setup(false);
    const { isError, structured } = await mcpTool(tools, "list_decks", {}, user);
    expect(isError).toBe(false);
    const api = (await (
      await decksApi(new Request(`${TEST_ORIGIN}/api/decks?lang=en`))
    )?.json()) as { decks: unknown[] };
    expect((structured as { decks: unknown[] }).decks).toEqual(api.decks);
    expect(channels.at(-1)).toBe("mcp");
    expect(audits.at(-1)).toMatchObject({ tool: "list_decks", channel: "mcp", outcome: "ok" });
  });

  test.if(hasSample)("get_deck returns the sample deck with its slides", async () => {
    const { tools } = setup(false);
    const { isError, structured } = await mcpTool(tools, "get_deck", { id: SAMPLE }, user);
    expect(isError).toBe(false);
    const deck = structured as {
      slug: string;
      title: string;
      slideCount: number;
      meta: { slides: { type: string; title: string }[] };
    };
    expect(deck.slug).toBe(SAMPLE);
    expect(deck.title).toBe("Example · Coffee for your office");
    expect(deck.slideCount).toBe(11);
    expect(deck.meta.slides).toHaveLength(11);
    const czech = await mcpTool(tools, "get_deck", { id: SAMPLE, language: "cs" }, admin);
    expect((czech.structured as { title: string }).title).toBe("Example · Káva pro vaši kancelář");
  });

  test.if(hasSample)("the page calls the same tool with its own session", async () => {
    const { tools, channels } = setup(true);
    const { status, body } = await pageTool(tools, "get_deck", { id: SAMPLE }, user);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect((body.data as { slug: string }).slug).toBe(SAMPLE);
    expect(channels.at(-1)).toBe("webmcp");
  });

  test("a deck the library does not have is refused with not_found", async () => {
    const { tools, audits } = setup(false);
    const { isError, structured } = await mcpTool(
      tools,
      "get_deck",
      { id: "2099-01-01-no-such-deck" },
      user,
    );
    expect(isError).toBe(true);
    expect(structured).toMatchObject({ ok: false, reason: "not_found" });
    expect(audits.at(-1)).toMatchObject({ tool: "get_deck", outcome: "not_found" });
    const traversal = await mcpTool(tools, "get_deck", { id: "../../package.json" }, user);
    expect(traversal.structured).toMatchObject({ ok: false, reason: "not_found" });
    const page = await pageTool(tools, "get_deck", { id: "2099-01-01-no-such-deck" }, user);
    expect(page.status).toBe(404);
    expect(page.body.reason).toBe("not_found");
  });

  test("an input outside the schema is refused with invalid_input", async () => {
    const { tools } = setup(false);
    for (const input of [{}, { id: "" }, { id: 7 }, { id: SAMPLE, extra: true }]) {
      const { structured } = await mcpTool(tools, "get_deck", input, user);
      expect(structured, JSON.stringify(input)).toMatchObject({ reason: "invalid_input" });
    }
    const { structured } = await mcpTool(tools, "list_decks", { language: "english" }, user);
    expect(structured).toMatchObject({ reason: "invalid_input" });
  });

  test("names are snake_case and every input schema is a closed object", async () => {
    const { tools } = setup(false);
    const { body } = await mcpCall(tools, "tools/list", {}, { caller: user });
    const listed = (
      body.result as {
        tools: {
          name: string;
          description: string;
          inputSchema: Record<string, unknown>;
          annotations: { readOnlyHint: boolean; destructiveHint: boolean };
        }[];
      }
    ).tools;
    for (const tool of listed) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
      expect(tool.description.trim()).not.toBe("");
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
    const deck = listed.find((tool) => tool.name === "get_deck");
    expect(deck?.inputSchema.required).toEqual(["id"]);
    expect(Object.keys(deck?.inputSchema.properties ?? {}).sort()).toEqual(["id", "language"]);
    const list = listed.find((tool) => tool.name === "list_decks");
    expect(list?.inputSchema.required).toEqual([]);
  });

  test("the descriptions speak the App's language, both languages complete", async () => {
    const [cs, en] = [TOOL_MESSAGES.cs, TOOL_MESSAGES.en];
    expect(Object.keys(en).sort()).toEqual(Object.keys(cs).sort());
    for (const value of [...Object.values(cs), ...Object.values(en)])
      if (typeof value === "string") expect(value.trim()).not.toBe("");
    for (const language of ["cs", "en"] as const) {
      const { tools } = setup(false, language);
      const { body } = await mcpCall(tools, "tools/list", {}, { caller: user });
      const listed = (body.result as { tools: { name: string; description: string }[] }).tools;
      expect(listed.find((tool) => tool.name === "list_decks")?.description).toBe(
        TOOL_MESSAGES[language].list_decks,
      );
    }
  });
});
