// PROTOTYPE (throwaway): spike for "Does Knock hold up against Cadence?".
// Not production. Lives on branch prototype/knock-spike, never merged.
import { useState } from "react";
import { useFetcher } from "react-router";
import { Knock, signUserToken } from "@knocklabs/node";
import type { Route } from "./+types/prototype.knock";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { users } from "~/db/schema";

const API = "https://api.knock.app/v1";

function env() {
  const e = process.env;
  return {
    pk: e.KNOCK_PUBLIC_API_KEY!,
    sk: e.KNOCK_SECRET_API_KEY!,
    channel: e.KNOCK_FEED_CHANNEL_ID!,
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  if (!userId) throw new Response("Select a user from the DevUI panel", { status: 401 });
  const { pk, channel, sk } = env();
  // 1. server signs an RS256 user token for whichever user the DevUI selected
  const token = await signUserToken(String(userId), { expiresInSeconds: 3600 });
  return {
    userId,
    token,
    pk,
    channel,
    configured: !!(pk && sk && channel),
    allUsers: db.select({ id: users.id, name: users.name, role: users.role }).from(users).all(),
  };
}

// Server side: identify users and trigger workflows with the Node SDK + secret key.
export async function action({ request }: Route.ActionArgs) {
  const actorId = await getCurrentUserId(request);
  const form = await request.formData();
  const knock = new Knock({ apiKey: env().sk });
  const intent = String(form.get("intent"));
  try {
    if (intent === "identify") {
      const all = db.select().from(users).all();
      for (const u of all) {
        await knock.users.update(String(u.id), { name: u.name, email: u.email });
      }
      return { ok: true, msg: `identified ${all.length} users` };
    }
    if (intent === "trigger") {
      const workflow = String(form.get("workflow"));
      const recipient = String(form.get("recipient"));
      const res = await knock.workflows.trigger(workflow, {
        recipients: [recipient],
        actor: actorId ? String(actorId) : undefined,
        data: { message: String(form.get("message") ?? "hello from Cadence") },
      });
      return { ok: true, msg: `triggered ${workflow} -> ${recipient}: ${JSON.stringify(res)}` };
    }
  } catch (e: any) {
    return { ok: false, msg: `${e?.status ?? ""} ${e?.message ?? e}` };
  }
  return { ok: false, msg: "unknown intent" };
}

export default function KnockProto({ loaderData }: Route.ComponentProps) {
  const { userId, token, pk, channel, allUsers, configured } = loaderData;
  const fetcher = useFetcher<typeof action>();
  const [log, setLog] = useState<string[]>([]);
  const [recipient, setRecipient] = useState(String(allUsers[0]?.id ?? ""));
  const [workflow, setWorkflow] = useState("discussion-reply");
  const [prefCategory, setPrefCategory] = useState("new-enrollment");
  const [feed, setFeed] = useState<any>(null);
  const add = (s: string) => setLog((l) => [...l, s]);

  const headers = {
    Authorization: `Bearer ${pk}`,
    "X-Knock-User-Token": token,
    "Content-Type": "application/json",
  };

  async function call(label: string, path: string, init?: RequestInit) {
    const r = await fetch(`${API}${path}`, { ...init, headers });
    const body = await r.json().catch(() => null);
    add(`${label}: ${r.status} ${JSON.stringify(body).slice(0, 600)}`);
    return body;
  }

  const loadFeed = async () => {
    const b = await call(`[3] list feed as user ${userId}`, `/users/${userId}/feeds/${channel}?page_size=20`);
    setFeed(b);
  };
  const markRead = async () => {
    const ids = (feed?.entries ?? []).map((e: any) => e.id);
    await call("[3] mark read", "/messages/batch/read", { method: "POST", body: JSON.stringify({ message_ids: ids }) });
    await loadFeed();
  };
  const markSeen = async () => {
    const ids = (feed?.entries ?? []).map((e: any) => e.id);
    await call("[3] mark seen", "/messages/batch/seen", { method: "POST", body: JSON.stringify({ message_ids: ids }) });
    await loadFeed();
  };
  const getPrefs = () => call("[4] get preferences", `/users/${userId}/preferences`);
  const setOptIn = (on: boolean) =>
    call(`[4] set ${prefCategory}.in_app_feed=${on}`, `/users/${userId}/preferences/default`, {
      method: "PUT",
      body: JSON.stringify({ categories: { [prefCategory]: { channel_types: { in_app_feed: on } } } }),
    });

  return (
    <div className="space-y-4 p-6 font-mono text-sm">
      <h1 className="text-lg font-bold">PROTOTYPE: Knock spike (throwaway)</h1>
      {!configured && <p className="text-red-600">Knock env vars missing in process.env</p>}
      <p>
        Current DevUI user: <b>{userId}</b>. Token (first 30 chars): {token.slice(0, 30)}…
      </p>

      <section className="space-y-2 rounded border p-3">
        <h2 className="font-bold">Server (Node SDK)</h2>
        <fetcher.Form method="post" className="flex flex-wrap items-center gap-2">
          <button name="intent" value="identify" className="rounded border px-2 py-1">Identify all users in Knock</button>
          <input name="workflow" value={workflow} onChange={(e) => setWorkflow(e.target.value)} className="border px-1" />
          <select name="recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="border px-1">
            {allUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.id} {u.name} ({u.role})</option>
            ))}
          </select>
          <button name="intent" value="trigger" className="rounded border px-2 py-1">[2] Trigger workflow</button>
        </fetcher.Form>
        {fetcher.data && <pre className="whitespace-pre-wrap">{JSON.stringify(fetcher.data)}</pre>}
      </section>

      <section className="space-y-2 rounded border p-3">
        <h2 className="font-bold">Client (headless REST + user token)</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={loadFeed} className="rounded border px-2 py-1">[1][3] Load feed</button>
          <button onClick={markSeen} className="rounded border px-2 py-1">Mark all seen</button>
          <button onClick={markRead} className="rounded border px-2 py-1">Mark all read</button>
        </div>
        {feed && (
          <div>
            <p>unread_count={feed.meta?.unread_count} unseen_count={feed.meta?.unseen_count} total={feed.meta?.total_count}</p>
            <ul className="list-disc pl-5">
              {(feed.entries ?? []).map((e: any) => (
                <li key={e.id}>
                  {e.id} read={String(!!e.read_at)} seen={String(!!e.seen_at)} {e.blocks?.map((b: any) => b.rendered ?? b.content).join(" | ")}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input value={prefCategory} onChange={(e) => setPrefCategory(e.target.value)} className="border px-1" />
          <button onClick={getPrefs} className="rounded border px-2 py-1">[4] Get preferences</button>
          <button onClick={() => setOptIn(true)} className="rounded border px-2 py-1">Opt in (feed on)</button>
          <button onClick={() => setOptIn(false)} className="rounded border px-2 py-1">Opt out (feed off)</button>
        </div>
      </section>

      <section>
        <h2 className="font-bold">Log</h2>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">{log.join("\n")}</pre>
      </section>
    </div>
  );
}
