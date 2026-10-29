import { createInterface } from "node:readline";
import { roles, readRole, searchArchive } from "./domain";
// Public fixture adapter. It does not read the browser session or any private account.
export function dispatch(request: any) {
  const { method, params = {} } = request;
  if (method === "initialize")
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "paw-public-fixtures", version: "0.1.0" },
      instructions:
        "Synthetic fixtures only. Read-only; no private accounts or live AI generation.",
    };
  if (method === "ping") return {};
  if (method === "tools/list")
    return {
      tools: [
        ...roles.map(([id, , title]) => ({
          name: `read_${id}`,
          description: `Read ${title} public synthetic fixture; not live browser data.`,
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
        })),
        {
          name: "search_conversations",
          description:
            "Search authored demo messages without rewriting source.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", minLength: 1, maxLength: 512 },
            },
            required: ["query"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
        },
      ],
    };
  if (method === "tools/call") {
    try {
      const args = params.arguments ?? {};
      if (!args || typeof args !== "object" || Array.isArray(args))
        throw Error("Invalid arguments");
      let value;
      if (params.name === "search_conversations") {
        if (
          Object.keys(args).join() !== "query" ||
          typeof args.query !== "string" ||
          !args.query.trim() ||
          args.query.length > 512
        )
          throw Error("query must be 1..512 characters");
        value = searchArchive(args.query);
      } else {
        if (Object.keys(args).length) throw Error("No arguments accepted");
        if (typeof params.name !== "string" || !params.name.startsWith("read_"))
          throw Error("Unknown tool");
        value = readRole(params.name.slice(5));
      }
      return { content: [{ type: "text", text: JSON.stringify(value) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: e.message }] };
    }
  }
  throw Error("Method not found");
}
if (!process.env.PAW_MCP_TEST) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    let request;
    try {
      if (line.length > 65536) throw Error("Request too large");
      request = JSON.parse(line);
      if (request.id === undefined) return;
      const result = dispatch(request);
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n",
      );
    } catch (e) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request?.id ?? null,
          error: { code: request ? -32601 : -32700, message: e.message },
        }) + "\n",
      );
    }
  });
}
