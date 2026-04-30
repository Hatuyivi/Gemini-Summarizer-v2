# AI Hub Manager v3

## Overview

Multi-AI chat manager (Expo mobile app) that lets the user drive ChatGPT,
Claude, Gemini, and Perplexity through their existing browser logins via a
hidden authenticated WebView. Conversation history is preserved across
account switches by compressing previous turns into a context seed using a
small Express API server (`/api/summarize`) backed by Gemini.

User-supplied Gemini API keys are stored locally (SecureStore on native,
AsyncStorage on web). The currently-selected key is sent on the
`x-user-gemini-key` header to `/api/summarize`; if no key is set the server
falls back to Replit's built-in Gemini integration. Only free-tier Gemini
models are used (default: `gemini-2.5-flash`). Every successful compression
is recorded as a viewable `SummaryBlock` so the user can browse the
historical memory blocks via Settings → "View summary blocks".

## Stack

- **Monorepo**: pnpm workspaces (Node 24, TS 5.9)
- **Mobile**: Expo SDK 54 (expo-router, react-native-webview, AsyncStorage,
  expo-secure-store, react-native-keyboard-controller)
- **Backend**: Express 5, served by `@workspace/api-server`
- **AI**: Gemini via Replit Gemini AI integration
  (`@workspace/integrations-gemini-ai` → `@google/genai`)
- **Build**: esbuild for the API server, Metro for the mobile bundle

## Artifacts

- `artifacts/api-server` (`/api`) — Express server with `/api/healthz` and
  `/api/summarize`. The summarize route accepts a list of user/assistant
  messages plus an optional `previousSummary` and returns a compact JSON
  context block.
- `artifacts/mobile` (`/`) — Expo app. Hidden `react-native-webview`
  per-account drives the provider's web UI; messages are extracted and
  rendered in a native chat UI. AsyncStorage persists accounts, messages,
  summary, custom selectors and per-account chat URLs.
- `artifacts/mockup-sandbox` (`/__mockup`) — design preview server
  (scaffold).

## Account-switching context handoff

When the active account changes (manual switch in `setActiveAccount` or
auto-rotation in `rotateToNextAvailable` after a daily limit), the app:

1. **Synchronously** stores a raw-transcript handoff seed
   (`pendingContextSeed`) built from the last ~12 user/assistant turns and
   prefixed with the previous compressed summary if one exists. This is
   what prevents the previously-known bug where the new account lost
   context whenever the user sent a message before the async summary
   resolved.
2. Kicks off `summarizeMessages` in the background. When it resolves, the
   summary is added to the chat history as a `summary` message and, if
   the seed has not yet been consumed, the seed is upgraded to the
   compact summary.
3. The new account's stored chat URL is cleared so its WebView lands on
   a fresh chat. On the next user send, `consumePendingContextSeed`
   prepends the seed text to the outgoing message.

## Environment

- `AI_INTEGRATIONS_GEMINI_BASE_URL`, `AI_INTEGRATIONS_GEMINI_API_KEY` —
  provisioned via the Replit Gemini AI integration.
- `EXPO_PUBLIC_DOMAIN` — injected by the mobile workflow; the Expo app
  uses it to call `https://${domain}/api/summarize` through the shared
  proxy.

## Key commands

- `pnpm install` — install all workspace deps
- `pnpm --filter @workspace/api-server run dev` — local API run
  (workflow handles this in the IDE)
- `restart_workflow artifacts/api-server: API Server` — rebuild + restart
  the API after backend changes
- Mobile uses Expo HMR — only restart on dependency changes

## Notes

- API server externalizes `@google/*` in its esbuild config, so
  `@google/genai` must be a direct dependency of `@workspace/api-server`
  (not just transitively through the lib) so pnpm symlinks it into the
  artifact's `node_modules`.
- See the `pnpm-workspace` skill for workspace structure details.

## Account rotation & limit timer

- **Soft (proactive) rotation**: `sendPrompt` in `app/index.tsx` checks
  `messagesUsedToday >= estimatedDailyLimit` (or an unexpired `"limit"`
  status) BEFORE injecting into the WebView. If exhausted, it marks the
  account `"limit"` and calls `rotateToNextAvailable()` so the prompt
  goes straight to the next account via the existing `pendingSend`
  handoff path.
- **Reset-time parsing**: `parseLimitResetMs()` in
  `lib/webview-scripts.ts` extracts a unix-ms timestamp out of the
  on-page limit message ("try again in 2 hours", "available at 3:45 PM",
  etc.) and ships it on the `automation:limit` event as `resetAtMs`.
- **Per-account timer**: `AIAccount.limitResetAt?: number` is set when
  the limit fires; it falls back to `Date.now() + 4h` when the page
  text can't be parsed. `AccountCard` shows a live `Resets in Xh Ym`
  countdown driven by a 1-second `setInterval`.
- **Auto-recovery**: a 30-second tick in `AppProvider` clears any
  account whose `limitResetAt` has passed, restoring `status = "active"`
  and zeroing `messagesUsedToday` so it re-enters the rotation pool.

## UI

- Monochrome black/white palette (`constants/colors.ts`) inspired by
  the Claude mobile app. Status indicators are dot+text rather than
  coloured pills; only `destructive` keeps a hue (muted red) for true
  error states.
- Chat composer uses a single `KeyboardAvoidingView` from
  `react-native-keyboard-controller` (`behavior="padding"`,
  `keyboardVerticalOffset={0}`). The previous nested
  `KeyboardStickyView` caused the input to fly to the top of the screen
  when the keyboard opened — never re-introduce that nesting.
- `app/settings.tsx` exposes a "Gemini API keys" section to add, list
  (masked), select-as-active and delete user keys. The active key is
  surfaced at the top of that section. A "View summary blocks" row jumps
  to `app/summaries.tsx` which renders every stored `SummaryBlock` with
  its source badge ("via your Gemini key" / "via built-in Gemini"), the
  compacted/kept counts, the summary text and important-data bullets.

## CI / Android APK

- `.github/workflows/android-build.yml` runs on every push and from the
  Actions tab. It checks out the repo, installs pnpm + Node 24 + Java 17,
  runs the workspace `pnpm install`, executes `expo prebuild --platform
  android --no-install --clean`, then `./gradlew assembleRelease` inside
  `artifacts/mobile/android` and uploads the produced APK as a workflow
  artifact named `ai-hub-manager-android-<sha>`. No EAS account is
  required.
