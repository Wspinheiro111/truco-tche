export async function legacyTrpcMutation(path: string, input?: unknown): Promise<unknown> {
  const response = await fetch(`/api/trpc/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ json: input ?? {} }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "tRPC error");
  return data.result?.data?.json ?? data.result?.data;
}

export async function legacyTrpcQuery(path: string, input?: unknown): Promise<unknown> {
  const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const response = await fetch(`/api/trpc/${path}${query}`, { credentials: "include" });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "tRPC error");
  return data.result?.data?.json ?? data.result?.data;
}
