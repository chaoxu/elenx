import { appendFileSync } from "node:fs";

globalThis.fetch = (async (input, init) => {
  const url = new URL(
    input instanceof Request ? input.url : input instanceof URL ? input : input,
  );
  const method = input instanceof Request ? input.method : init?.method;
  if (
    url.origin !== "https://e2e.invalid" ||
    url.pathname !== "/v1/responses" ||
    method !== "POST"
  ) {
    throw new Error(`unexpected E2E fetch: ${method ?? "GET"} ${url.href}`);
  }
  if (init === undefined) {
    throw new Error("unexpected E2E fetch without request options");
  }
  const body = JSON.parse(requestBody(init.body)) as Record<string, unknown>;
  const log = process.env["ELENX_E2E_REQUEST_LOG"];
  if (log === undefined) throw new Error("ELENX_E2E_REQUEST_LOG is required");
  appendFileSync(log, `${JSON.stringify(body)}\n`);

  const serialized = JSON.stringify(body);
  if (serialized.includes("TRIGGER_PROVIDER_ERROR")) {
    return Response.json(
      {
        error: {
          code: "synthetic_error",
          message: "synthetic provider failure",
          type: "server_error",
        },
      },
      { status: 503 },
    );
  }
  const tool = requestedTool(body);
  return responsesStream(tool, submissionFor(tool, serialized));
}) as typeof fetch;

function requestBody(body: unknown): string {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(body));
  }
  throw new Error(`unsupported E2E request body: ${typeof body}`);
}

function requestedTool(body: Record<string, unknown>): string {
  const tools = body["tools"];
  if (!Array.isArray(tools)) throw new Error("request omitted tools");
  const tool = tools[0];
  if (tool === null || typeof tool !== "object" || !("name" in tool)) {
    throw new Error("request omitted tool name");
  }
  return String(tool.name);
}

function submissionFor(tool: string, request: string): unknown {
  const refutation = request.includes(falseTournamentClaim);
  if (tool === "submit_findings") {
    return {
      findings: [
        {
          text: refutation
            ? tournamentCounterexample
            : request.includes("Previous verifier response")
              ? completeProof
              : incompleteProof,
        },
      ],
    };
  }
  if (tool === "submit_coordination") {
    return {
      filings: [
        {
          finding: 1,
          summary: refutation
            ? "transitive tournament counterexample"
            : "Euclid proof candidate",
        },
      ],
      action: {
        kind: "verify",
        candidateKind: refutation ? "refutation" : "solution",
        answer: { kind: "finding", finding: 1 },
        support: [],
      },
    };
  }
  if (tool === "submit_audit") {
    const pass =
      request.includes("2 is prime") ||
      (refutation && request.includes("transitive tournament"));
    const audit = request.includes("Audit:\\nrequirements")
      ? "requirements"
      : request.includes("Audit:\\ncorrectness")
        ? "correctness"
        : request.includes("Audit:\\nrefutation")
          ? "refutation"
          : undefined;
    if (audit === undefined)
      throw new Error("request omitted auditor identity");
    return {
      verdict: pass ? "PASS" : "FAIL",
      report: pass
        ? `${audit} passed.`
        : `${audit} found the missing nonempty-list case.`,
    };
  }
  throw new Error(`unexpected tool: ${tool}`);
}

function responsesStream(tool: string, input: unknown): Response {
  const responseId = `resp_${crypto.randomUUID().replaceAll("-", "")}`;
  const item = {
    id: `fc_${crypto.randomUUID().replaceAll("-", "")}`,
    call_id: `call_${crypto.randomUUID().replaceAll("-", "")}`,
    type: "function_call",
    name: tool,
    arguments: JSON.stringify(input),
    status: "completed",
  };
  const usage = {
    input_tokens: 10,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 5,
    output_tokens_details: { reasoning_tokens: 1 },
    total_tokens: 15,
  };
  const events = [
    {
      type: "response.created",
      sequence_number: 0,
      response: { id: responseId, status: "in_progress", output: [] },
    },
    {
      type: "response.output_item.added",
      sequence_number: 1,
      output_index: 0,
      item,
    },
    {
      type: "response.function_call_arguments.done",
      sequence_number: 2,
      output_index: 0,
      item_id: item.id,
      name: tool,
      arguments: item.arguments,
    },
    {
      type: "response.output_item.done",
      sequence_number: 3,
      output_index: 0,
      item,
    },
    {
      type: "response.completed",
      sequence_number: 4,
      response: { id: responseId, status: "completed", output: [item], usage },
    },
  ];
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}

const incompleteProof =
  "Assume all primes are p_1,...,p_n. Their product plus one has a prime divisor outside the list.";
const completeProof =
  "Since 2 is prime, the finite list is nonempty. Assume all primes are p_1,...,p_n. Their product plus one has a prime divisor outside the list, a contradiction.";
const falseTournamentClaim =
  "every tournament on three vertices has a directed cycle";
const tournamentCounterexample =
  "The claim is false. In the transitive tournament on vertices a,b,c, orient a to b, a to c, and b to c. Every edge increases the order a<b<c, so there is no directed cycle.";
