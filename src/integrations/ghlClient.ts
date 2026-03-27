const GHL_API_BASE = "https://services.leadconnectorhq.com";

export type GhlUpdateContactResult =
  | { ok: true; status: number }
  | { ok: false; status: number; body: string };

export async function ghlUpdateContact(
  accessToken: string,
  contactId: string,
  body: Record<string, unknown>,
): Promise<GhlUpdateContactResult> {
  const res = await fetch(`${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, body: text };
  }
  return { ok: true, status: res.status };
}
