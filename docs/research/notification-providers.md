# Hosted in-app notification inbox providers

Answers issue #3 (child of map #2). Comparison only; no recommendation. Sources were fetched 2026-11-13 from each vendor's own docs and pricing pages. Pricing changes often; re-check before deciding.

Context: Cadence is a React Router v7 app with its own session auth (see `GLOSSARY.md`, `app/`). Every provider needs a server-side step that proves the current user's identity to the provider, so a React Router loader or resource route would be the natural place for it.

## Summary table

| | Knock | Novu | Courier | MagicBell |
|---|---|---|---|---|
| Prebuilt React inbox | `@knocklabs/react` (`KnockProvider`, `KnockFeedProvider`, `NotificationIconButton`, `NotificationFeedPopover`) | `@novu/react` `<Inbox />` (React 18/19) | `@trycourier/courier-react` `<CourierInbox />`, `CourierInboxPopupMenu` | Embed code from dashboard (React package docs not verified, see Gaps) |
| Headless / custom UI | Client JS SDK (`@knocklabs/client`) plus component overrides | `useNotifications`, `useCounts`, `useNovu` hooks | Custom UI on the same feed (docs claim) | Not verified |
| Free tier | $0: 10,000 messages/mo, 500 guide recipients | $0: 10,000 workflow runs/mo, 5 workflows, 3 team members | $0: 10,000 sends/mo | $0: 1,000 deliveries/mo, 1 project |
| First paid tier | Starter $250/mo (50k messages, then $0.005 each) | Pro from $30/mo (30k runs, $1.20 per extra 1k) | Business $0.005 per send, no minimum | Startup $249/mo (50k deliveries, $0.0025 each extra) |
| User auth | Public key plus RS256 signed user JWT ("enhanced security mode"), off by default | `subscriberHash` = HMAC-SHA256(secret, subscriberId), opt-in per environment | JWT passed to `courier.shared.signIn({ userId, jwt })` | HS256 user JWT (`user_external_id` and/or `user_email`, `api_key`) |
| Unread count / mark read | Badge `unread` type; message status API (read/seen/archived, batch) | `useCounts({ filters: [{ read: false }] })`, `novu.notifications.read/archive` | Built-in unread count in header and per tab; read/archive state | Not verified in primary docs |
| Inbox retention | Feed items available indefinitely; other logs 30 days (90 Enterprise) | Activity feed 24h Free / 7d Pro / 90d Team / custom Enterprise (inbox-feed row not captured) | "Messages stay until the user reads or archives them"; no explicit TTL found | Not found |
| Email/push later | Add channel steps to the same workflow; unlimited channels on all plans | All channels on Free; same workflow | One send can hit inbox, email, push; multi-channel send = 1 send | Delivery Planner config plus channel providers |
| Dev / test | Environments (opt-in), CLI, E2E testing noted on pricing | Free: 2 environments (Dev + Prod); keyless demo mode, data expires 24h | Test environment key works with no provider connected | Separate projects for staging/prod |

## Knock

- **SDK/components**: `npm install @knocklabs/react`, wrap in `KnockProvider` (apiKey, user, optional `userToken`) and `KnockFeedProvider` (feedId), render `NotificationIconButton` + `NotificationFeedPopover`. Customisable via `renderItem`, CSS variables (`--rnf-*`), `colorMode`. Source: https://docs.knock.app/in-app-ui/react/feed
- **Unread**: `NotificationIconButton` badge defaults to "seen"; `badgeCountType="unread"` switches to read-based. Source: same page.
- **Mark as read API**: public-key endpoints allow `PUT /v1/messages/:id/:status` (read/seen/archived), `DELETE` to unmark, and batch/bulk endpoints. Source: https://docs.knock.app/in-app-ui/security-and-authentication
- **Auth**: by default a public key can act as any user. "Enhanced security mode" requires a signed JWT (RS256, `sub` claim, recommended `iat`/`exp`, default expiry 3600s) signed with a private signing key, via `signUserToken` in `@knocklabs/node`. Grants (`user/feed_read`, `user/feed_write`, ...) can scope a token; `explicit_grants` restricts everything else. Source: security page above.
- **Pricing**: Free 10,000 messages/mo, unlimited stored profiles, workflows, channels, team members; Starter $250/mo with 50,000 messages then $0.005 each; Enterprise custom. Removing Knock branding is a Starter feature. Source: https://knock.app/pricing
- **Retention**: message logs and related logs 30 days (90 on Enterprise), but "in-app feed notifications are available indefinitely" and status updates still work. Source: https://docs.knock.app/manage-your-account/data-retention.md
- **Dev**: `@knocklabs/cli` pulls/pushes workflows and promotes across environments; environments are opt-in. Source: https://docs.knock.app/developer-tools/knock-cli.md

## Novu

- **SDK/components**: `@novu/react` (React 18+/19) `<Inbox />` with `applicationIdentifier` + `subscriberId`, `routerPush` prop for client-side routing (example uses `react-router-dom`'s `useNavigate`), `appearance` prop for theming. A keyless mode renders a demo inbox with temporary (24h) data. Sources: https://docs.novu.co/platform/inbox/setup-inbox.md, https://docs.novu.co/platform/quickstart/react.md
- **Headless**: `NovuProvider`, `useNotifications` (pagination, realtime), `useCounts`, `useNovu` for `read`/`archive`. Source: https://docs.novu.co/platform/inbox/headless-mode.md
- **Auth**: without HMAC, anyone who guesses a `subscriberId` can read that user's notifications. Enable "Security HMAC encryption" on the Novu In-App integration and pass `subscriberHash = HMAC-SHA256(secretKey, subscriberId)` (hex), computed server-side. Source: https://docs.novu.co/platform/inbox/prepare-for-production.md
- **Pricing**: Free $0 (10k workflow runs, all channels incl. in-app, 5 workflows, 2 environments, 3 members, 24h activity-feed retention); Pro from $30/mo (30k runs, 7-day retention, remove branding); Team from $250/mo (250k runs, 90 days, RBAC); Enterprise custom incl. self-hosting. Source: https://novu.co/pricing
- **Open source / self-host**: Novu describes itself as open-source notification infrastructure; self-hosting is listed as an Enterprise hosting option on the pricing page. Licence terms not checked. Sources: https://docs.novu.co/llms.txt, pricing page.
- **Retention caveat**: the pricing page has both "Activity feed retention" and "Inbox feed retention" rows; the inbox values were not captured (page truncated). Treat inbox retention on Free as unverified.

## Courier

- **SDK/components**: `@trycourier/courier-react` v9 (React 18+), also Web Components, Vue, Angular, iOS, Android, Flutter, React Native. Three steps: server mints a token, client calls `courier.shared.signIn({ userId, jwt })`, render `<CourierInbox />`. Also `CourierInboxPopupMenu`, `CourierToast`, preference center. Older `@trycourier/react-inbox` is deprecated. Sources: https://www.courier.com/docs/in-app/overview.md, https://www.courier.com/docs/guides/add-an-inbox-to-react.md
- **Unread / read state**: header unread count, per-tab counts, Unread and Archived views, read/archive state synced across devices. Source: https://www.courier.com/docs/in-app/inbox.md
- **Auth**: a server route mints a JWT because the API key must not reach the browser (quickstart guide). JWT claim/signing specifics not captured here.
- **Pricing**: Developer free with 10,000 sends/mo; Business $0.005 per send (including the first 10k once a card is on file); Enterprise custom. One send = one template to one recipient, regardless of channels, so adding email/push does not raise the count. Test/custom environment sends count too. Inbox has no separate fee. Sources: https://www.courier.com/pricing, https://www.courier.com/docs/workspaces/billing.md
- **Retention**: docs state messages stay until read or archived; no numeric retention found.
- **Dev**: a Test environment key works with no provider connected. Source: https://www.courier.com/docs/llms.txt

## MagicBell

- **Pricing**: Builder $0 (1,000 deliveries/mo, 1 project, unlimited users and team members); Startup $249/mo (50k deliveries, $0.0025 each extra, 5 projects, $99 per extra project); Enterprise custom. A delivery is counted per channel per user (100 users in-app + 50 email = 150). Source: https://www.magicbell.com/pricing
- **Auth**: user JWT signed HS256 with the project secret; payload `user_external_id` and/or `user_email` plus `api_key`; doc example uses `expiresIn: '1y'`. Users are created on the fly on first Inbox init. Sources: https://www.magicbell.com/docs/api/authentication/user, https://www.magicbell.com/docs/quick-start
- **Inbox**: embed code from the dashboard, themeable via CSS. Broadcasts are created via `POST /broadcasts` with a project JWT. Email/other channels are enabled through the "Delivery Planner" plus channel providers. Source: quick-start page.
- **Dev**: separate projects for staging/production; the docs link a playground at playground.magicbell.com.
- Smallest free tier here (1,000 deliveries/mo, and in-app deliveries count).

## Other providers worth a look (not researched)

SuprSend, OneSignal (in-app), Stream Activity Feeds. Named only as candidates; not evaluated against primary sources in this pass.

## Gaps and caveats

- Courier JWT claims and Inbox retention TTL were not verified.
- MagicBell: no primary-source page found for React package usage, unread-count API, or data retention (several docs URLs returned 404).
- Novu: inbox-feed retention per plan and the licence of the self-hosted edition were not captured.
- No provider page found targets React Router v7 specifically; all React SDKs are router-agnostic and run client-side. SSR concerns (token minted in a loader, hydration) were not tested.
- No source describes an offline/emulated local mode. Knock, Novu and Courier offer separate dev/test environments instead; only Novu offers self-hosting (Enterprise).
- Prices are USD as shown on vendor pages at fetch time.
