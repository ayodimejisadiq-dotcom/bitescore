# Premium UX backlog — OTA-only

Everything below ships through `eas update` on the **existing** binary. Nothing
here needs an App Store or Play submission.

## What "OTA" allows

`app.json` sets `runtimeVersion.policy: "appVersion"` (currently `1.0.2`). An
update is matched to a binary by that runtime version, so an OTA payload may
contain **only JavaScript and assets**. In practice:

| Allowed over the air | Needs a new build |
| --- | --- |
| Any JS/TS change, any screen, any style | Adding a native module (`expo-haptics`, `expo-blur`, `expo-image`, …) |
| New fonts, images, Lottie JSON, sounds | Any `app.json` native key: permissions, icon, splash image, bundle id |
| Deeper use of already-installed native modules | New config plugin |
| New JS-only npm packages | Anything that bumps `version` (that changes runtimeVersion) |

The font swap in this branch is the shape of an OTA change: a JS-only package
plus four `.ttf` assets, verified present in `expo export`.

**The most valuable thing already installed and completely unused is
`react-native-reanimated` 4.3.1 + `react-native-worklets`.** It is a native
module that is already in the binary; today not a single file imports it.
Every motion item below is free because of that.

---

## Tier 0 — defects found while doing the font work

These are small and they cost real polish. Worth doing before any new feature.

### 1. The status bar is unreadable in dark mode

`app/_layout.tsx:129` renders `<StatusBar style="auto" />`, and `app.json` sets
`userInterfaceStyle: "automatic"`. `style="auto"` picks its colour from the
**device** colour scheme, so on a phone in dark mode it draws the clock and
battery in **white** — on top of the app's cream `#F7F2E7` canvas, which never
changes (`theme/useTheme.ts` deliberately returns one light palette).

Roughly half of users run dark mode, and they currently see an invisible status
bar on every screen.

Fix is one word: `<StatusBar style="dark" />`.

### 2. ~~The "SAVED" chip is dead code~~ — done

`RestaurantRow` accepted `saved?: boolean` and rendered a green SAVED pill for
it, but neither call site passed it, so search and map results never showed
which places were already on a list.

Fixed by `hooks/useSavedIds.ts` — a focus-refetched `Set` of saved restaurant
ids backed by `fetchSavedRestaurantIds()`, now passed by both the map and
search result lists.

### 3. Mixed apostrophes in visible copy

Most strings use the typographic `’` ("Couldn’t load this place"), but five
user-facing ones use a straight `'`:

- `app/restaurant/[id].tsx:408` — "Nobody's reviewed this yet"
- `app/(tabs)/lists.tsx:201` — "Couldn't load your lists"
- `app/(tabs)/lists.tsx:211` — "we'll tell you if a score changes"
- `app/(tabs)/search.tsx:138` — "Couldn't load results"
- `app/(tabs)/account.tsx:423` — "We'll ping you if a saved place is re-inspected"

Nobody consciously notices this. Everybody unconsciously notices this.

---

## Tier 1 — biggest premium-feel return for the effort

### 4. Cut the forced 2-second splash

`app/_layout.tsx:31` holds the logo for a hard `MIN_SPLASH_MS = 2000` even when
everything is ready in 300ms. Premium apps feel *instant*; a deliberate two
second wait on every single launch is the single largest perceived-performance
cost in the app, paid on every cold start forever.

The comment argues it "registers as branding". Two seconds is roughly double
what that needs. Drop to **800–1000ms**, and consider handing over as soon as
the app is ready above ~600ms rather than always waiting out the floor. This is
one constant — the cheapest win in this document.

### 5. Skeletons instead of spinners

There are **30 `ActivityIndicator` sites** across nine files. A centred spinner
on a blank screen is the visual signature of an unfinished app: it says "we are
waiting" instead of "your content is arriving".

Replace the ones that occupy a whole screen or list with skeleton placeholders
in the shape of the content that's coming — a grey score tile, two grey text
bars — using the card and radius tokens already in `theme/colors.ts` and a slow
Reanimated opacity loop. Highest value at:

- `app/restaurant/[id].tsx` — full-screen spinner before the hero; the layout is
  completely predictable, so a skeleton hero + stat row is easy
- `app/(tabs)/lists.tsx`, `app/(tabs)/search.tsx` — list skeleton rows
- `app/(tabs)/index.tsx` — the search-results dropdown

Keep the small inline spinners (save buttons, the search field) — those are
correct as they are.

### 6. Motion on the things that already move

Nothing in the app is animated. With Reanimated already in the binary:

- **Map preview card** (`app/(tabs)/index.tsx`) currently pops in and out
  instantly when a pin is selected. Slide + fade it from the bottom edge; this
  is the single most-seen interaction in the app.
- **List expand/collapse** (`app/(tabs)/lists.tsx`) — `toggleExpanded` swaps the
  children with no transition. `Layout` / `FadeIn` transitions on the item rows.
- **Screen content fade-in** once data lands, so results don't snap in.
- **Filter chips** — a small scale on selection.
- **Score hero** on the detail screen — the `ScaleStrip` bar could grow to its
  value on mount. It's the moment the app exists for; it deserves one beat.

`EdgeButton` already does a press translate, and it's the best-feeling thing in
the app. Extend that instinct: `RestaurantRow` only dims to `opacity: 0.7`
(`components/RestaurantRow.tsx:31`) — a slight scale-down reads far better.

### 7. Pull-to-refresh

No `RefreshControl` anywhere. Lists and Search both refetch only on focus, so
there is no way to say "check again" after a network blip other than switching
tabs. Core React Native, a few lines each, and its absence is conspicuous —
every list in every polished app has it.

### 8. Respect Dynamic Type, or opt out honestly

No `maxFontSizeMultiplier` anywhere, and React Native scales text with the OS
font-size setting by default. Several controls have hard heights that will clip
their labels at large accessibility sizes: the search field (`height: 50`),
filter chips (`height: 38`), detail footer buttons (`height: 56`), modal buttons
(`height: 50`), tab bar (`height: 88`).

Set `maxFontSizeMultiplier` (≈1.4 on body, ≈1.2 on fixed-height controls) and
let the genuinely flexible text scale freely. Cheap, and it's the difference
between "handles accessibility" and "breaks".

---

## Tier 2 — depth

### 9. Work on the Underground

A UK restaurant app is used underground, in basements, and on bad pub Wi-Fi.
Today every screen goes blank-or-error with no connection: `lib/data.ts` has no
cache, and `AsyncStorage` — already installed — is used only for filters, the
game layer, and the auth session.

Cache the cheap, high-value things and render them stale-while-revalidating:
saved lists (you know exactly which places matter to the user), the last
viewed restaurant detail, the last map viewport's pins. Serve from cache
instantly, refresh behind it. Instant-feeling data is most of what "premium"
means, and it also removes several failure states entirely.

### 10. Show value before the paywall

`PaywallGate` is the very first thing a new user sees — the app opens straight
onto "Unlock Bitescore" with four text features and a price. That is a hard ask
from a standing start, and it's a conversion problem as much as a UX one.

An OTA-only interactive teaser costs nothing to ship: let a first-run user see
one real map screen with live pins, or search one place and see one real score
hero, then gate. The FSA data is the product — showing five seconds of it sells
better than a bulleted list of what it would look like.

Failing that, the existing paywall would gain a lot from the feature list being
illustrated with real score tiles (`BadgeFan` is already imported) rather than
being four uppercase headings and four sentences.

### 11. Saved state on the detail screen

The Save button (`app/restaurant/[id].tsx` footer) looks identical whether or
not the place is already in a list, and always opens the modal. Load the
membership and show a filled bookmark + "Saved" so the button reports state
instead of just offering an action.

### 12. Empty and error states, evened out

The empty states are genuinely good — `BadgeFan` plus a real sentence. The error
states are not: several are bare text with no way forward, e.g. Lists
(`app/(tabs)/lists.tsx:201`) and Search (`app/(tabs)/search.tsx:138`) show a
title and a raw error message with no retry, while the restaurant detail screen
does have a Retry button. Give every error the same treatment as the good ones:
illustration, plain-English sentence, and a button.

### 13. Search recents

The search field starts blank every time, on both the map and search screens.
Store the last ~8 queries and tapped places in `AsyncStorage` and show them
under an empty field. Small, and it makes repeat use feel like the app knows
you.

### 14. Tab bar sizing

`app/(tabs)/_layout.tsx:18` hardcodes `height: 88` with `paddingTop: 8` and no
bottom padding. Worth checking on an Android device with 3-button navigation and
on an iPhone SE — a fixed 88 is tuned for one device class and will look wrong
on others. `useSafeAreaInsets()` is already a dependency.

### 15. Accessibility labels

`ScoreBadge` and the map locate button have proper `accessibilityLabel`s;
almost nothing else does. Most `Pressable`s have no `accessibilityRole`, so
VoiceOver reads them as plain text. A pass over the interactive elements is
cheap and is table stakes for a paid app.

---

## Explicitly NOT available over the air

Don't spend time designing around these until the next build:

- **Haptics.** `expo-haptics` is not installed, and React Native's core
  `Vibration` API cannot do iOS selection/impact feedback — it only buzzes.
  This is the one classic "premium feel" item that is genuinely blocked. Add
  `expo-haptics` to the next binary; it is the first thing to reach for once a
  build goes out (score reveal, save confirmation, filter selection).
- **Blur / glass surfaces** — `expo-blur` is not installed.
- **`expo-image`** (better caching, transitions) is not installed;
  currently moot, as the app ships no photography.
- **Splash screen artwork and the app icon** — `app.json` native config.
- **App Clips, widgets, Live Activities, share extensions.**
