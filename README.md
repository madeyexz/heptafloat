<p align="center">
  <img src="assets/icon-1024.png" width="128" alt="HeptaFloat icon">
</p>

<h1 align="center">HeptaFloat</h1>

<p align="center">
  <b>Today's Heptabase journal, one keystroke away.</b><br>
  A small floating card that sits above your other windows — jot a thought, tick a to-do, and get back to work.
</p>

<p align="center">
  <a href="https://github.com/madeyexz/heptafloat/releases/latest"><b>⬇︎ Download for Mac</b></a>
  &nbsp;·&nbsp; macOS 13 or later &nbsp;·&nbsp; Apple Silicon & Intel &nbsp;·&nbsp; Free & open source
</p>

<p align="center">
  <img src="docs/demo.gif" width="560" alt="Typing a to-do with the / menu, mentioning a card with @, and ticking it off"><br>
  <a href="docs/demo-4x3.mp4"><b>▶ Watch the 1-minute tour of every feature</b></a>
</p>

---

## Why

Opening Heptabase, finding today's journal, and switching back breaks your flow. HeptaFloat keeps today's journal in a little card you can pop up from anywhere — like Raycast Notes, but it **is** your Heptabase journal. Everything you type is saved straight into Heptabase, and anything you add in Heptabase shows up in the card.

## What you get

| | |
|---|---|
| <img src="docs/screenshot-light.png" alt="HeptaFloat in light mode floating over another window"> | <img src="docs/screenshot-dark.png" alt="HeptaFloat in dark mode"> |
| **Floats above everything.** Put it anywhere on screen; it stays on top across desktops and full-screen apps. | **Looks like Heptabase.** Same font (Inter), colors, checkboxes, lists, link previews and highlights — in light and dark. |
| <img src="docs/screenshot-commands.png" alt="The / command menu"> | <img src="docs/screenshot-mention.png" alt="Searching cards with @"> |
| **Type `/` for blocks** — to-dos, headings, bullets, toggles, quotes, dividers, today's date. | **Type `@` to mention a card** from your Heptabase library. Click a mention to open it here or in Heptabase. |

- **One shortcut to show and hide** — <kbd>⌃</kbd> <kbd>⌥</kbd> <kbd>J</kbd> by default; record any shortcut you like in Settings.
- **Jump to any card** — <kbd>⌘</kbd> <kbd>O</kbd> searches your Heptabase cards, <kbd>⌘</kbd> <kbd>P</kbd> shows the cards you've opened in HeptaFloat, <kbd>⌘</kbd> <kbd>[</kbd> / <kbd>⌘</kbd> <kbd>]</kbd> step through them, <kbd>⌘</kbd> <kbd>.</kbd> pins one, <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>D</kbd> goes back to today.
- **New card in a keystroke** — <kbd>⌘</kbd> <kbd>N</kbd> opens a blank card, like Raycast Notes. It's created in Heptabase as soon as you type (and not at all if you don't).
- **A real Mac title bar** — the card's title in the middle and buttons for search (<kbd>⌘</kbd>), recent cards and a new card (<kbd>+</kbd>); the close button hides the card, like <kbd>Esc</kbd>.
- **Or keep it in the notch** — turn on *Show the card in the notch* and the card waits in the MacBook notch; point at it or press the shortcut and it drops down.
- **Images** — pictures from Heptabase show up, and you can paste or drop images into the card.
- **Saves as you type** and stays in sync with Heptabase both ways — including cards you delete there.
- **Always today's page** — at midnight it moves to the new day's journal on its own.
- **Simple settings** — every shortcut, theme, text size, keep on top, launch at login, and a check that Heptabase is connected.
- **Updates itself** — when a new version is out, the card's footer says so; click **Update** in Settings and HeptaFloat downloads it, checks it, and restarts into it.

## Install

1. **Download** `HeptaFloat-x.y.z.zip` from the [latest release](https://github.com/madeyexz/heptafloat/releases/latest) and double-click it to unzip.
2. **Drag `HeptaFloat`** into your **Applications** folder (it needs to live there to update itself).
3. **Open it.** Because HeptaFloat isn't from the App Store, macOS will warn you the first time:
   - Click **Done** (or **Cancel**) on the warning.
   - Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to HeptaFloat.
   - Confirm with **Open**. You only need to do this once.

From 0.9.8 on, HeptaFloat updates itself (see **Settings → Version**). If you have 0.9.7 or older, download the latest release once by hand.

### One-time setup in Heptabase

HeptaFloat talks to Heptabase through Heptabase's built-in **CLI** ([Heptabase's guide](https://support.heptabase.com/en/articles/14715462-heptabase-cli)). You need:

1. The **Heptabase desktop app**, version 1.91 or later, **running**.
2. **Settings → AI Features → CLI** turned on in Heptabase.
3. An **active Heptabase subscription** (Heptabase only lets other apps in for subscribed accounts).

You don't have to remember this: until everything is in place, the card shows a checklist of exactly what's missing, with buttons to download or open Heptabase, and switches to today's journal by itself as soon as it can connect.

<p align="center"><img src="docs/screenshot-setup.png" width="380" alt="Setup checklist: Turn on the Heptabase CLI"></p>

To double-check later, open **Settings** (<kbd>⌘</kbd> <kbd>,</kbd>) — the **Heptabase** section shows a green **Connected** when everything works.

## Jump between cards

| <img src="docs/screenshot-recent.png" alt="⌘P recent cards"> | <img src="docs/screenshot-search.png" alt="⌘O search cards"> |
|---|---|
| **<kbd>⌘</kbd> <kbd>P</kbd> Recent cards** — the cards you've opened in HeptaFloat (its own list, kept on your Mac). Pin favorites to the top; × removes a card from the list (it never deletes anything in Heptabase). | **<kbd>⌘</kbd> <kbd>O</kbd> Search cards** — search everything in Heptabase. <kbd>↵</kbd> opens the card right here, <kbd>⌘</kbd> <kbd>↵</kbd> opens it in Heptabase. |

Notes and journals open in the floating card and are editable just like today's journal; other card types (PDFs, highlights…) open in Heptabase. <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>D</kbd> takes you back to today's journal.

**Links to other cards:** hover or click a card mention to choose **Open here** or **Open in Heptabase**. <kbd>⌘</kbd>-click goes straight to Heptabase.

## How to use it

| Do this | To |
|---|---|
| <kbd>⌃</kbd> <kbd>⌥</kbd> <kbd>J</kbd> | Show or hide the card from any app |
| <kbd>Esc</kbd> | Hide it and go back to what you were doing |
| Drag the top edge | Move it; drag any edge to resize (it remembers) |
| `/` | Insert a block: to-do, heading, list, toggle, quote, code, divider, date |
| `@` or `[[` | Mention a card |
| Select text | Bold, italic, underline, strikethrough, code, link, **highlight & text color** |
| <kbd>⌘</kbd> <kbd>A</kbd> | Select the line you're in, like Heptabase; press again for the whole card |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>H</kbd> | Highlight the selection in yellow (press again to remove) |
| <kbd>Tab</kbd> / <kbd>⇧</kbd> <kbd>Tab</kbd> | Indent / outdent list items — every selected one. On a plain line right below a bullet, <kbd>Tab</kbd> tucks it under that bullet |
| <kbd>⌫</kbd> at the start of a bullet | Turn it into plain text where it is; press again to join it with the line above |
| <kbd>⌘</kbd> <kbd>↩</kbd> | Tick or untick a to-do |
| <kbd>⌘</kbd> <kbd>N</kbd> | New card |
| <kbd>⌘</kbd> <kbd>.</kbd> | Pin / unpin the card to the top of Recent (⌘P) |
| <kbd>⌘</kbd> <kbd>[</kbd> / <kbd>⌘</kbd> <kbd>]</kbd> | Previous / next card in your Recent list (⌘P) |
| <kbd>⌘</kbd> <kbd>O</kbd> / <kbd>⌘</kbd> <kbd>P</kbd> | Search cards / recent cards |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>D</kbd> | Today's journal |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>O</kbd> | Open the current card in Heptabase |
| <kbd>⌘</kbd> <kbd>=</kbd> / <kbd>⌘</kbd> <kbd>-</kbd> | Bigger / smaller text |

You can also type Markdown: `- ` bullets, `1. ` numbers, `[] ` to-dos, `# ` headings, `> ` quotes, `---` dividers.

### Settings

Press <kbd>⌘</kbd> <kbd>,</kbd> while the card is in front.

<p align="center"><img src="docs/screenshot-settings.png" width="420" alt="HeptaFloat Settings → General: shortcut, keep on top, launch at login, add new cards to today's journal, show in Dock, theme, text size, Heptabase connection"></p>

**General**
- **Show / hide shortcut** — click it and press the keys you want. <kbd>Esc</kbd> cancels, **Reset** goes back to <kbd>⌃</kbd> <kbd>⌥</kbd> <kbd>J</kbd>.
- **Keep on top of other windows** — on: the card stays open when you click into another app. Off: it tucks away as soon as you do. Either way it floats above everything, full-screen apps included.
- **Show the card in the notch** — off by default. When on, the card waits in the MacBook notch (on a screen without one, a small pill at the top center). Point at it or press the shortcut and it drops down into the full card. If it opened because you pointed at it, it folds back when you move away. If you clicked into it or opened it with the shortcut, it stays until <kbd>Esc</kbd>, the shortcut or Close (with *Keep on top* off, also until you switch apps).
- **Launch at login** — start HeptaFloat when you log in, so the shortcut always works.
- **Add new cards to today's journal** — off by default. When on, every card you start with <kbd>⌘</kbd> <kbd>N</kbd> is linked at the end of today's journal, so it's easy to find later.
- **Show in Dock and menu bar** — off by default, so HeptaFloat works like Raycast: no Dock icon, and the card pops up on whatever screen you're on without ever switching desktops. Turn it on for a Dock icon and the menus at the top of the screen (File, Format, View, Window, Help).
- **Theme** and **Text size**.
- **Heptabase** — shows whether HeptaFloat can reach your journal, with **Check Again** and **Open Heptabase**.
- **Version** — shows when a newer HeptaFloat is out, with **Update**: it downloads the new version from GitHub, makes sure it's exactly the file GitHub published (SHA-256) and a complete, signed HeptaFloat, swaps it in and restarts. If anything goes wrong, your current version stays as it was. **Check Now** checks right away.
- **Check for updates automatically** — on by default: HeptaFloat asks GitHub for the latest release when it starts and once a day.
- **Quit HeptaFloat** is at the bottom (or press <kbd>⌘</kbd> <kbd>Q</kbd> while the card is in front).

When a new version is out, the card's footer says so — click it to open Settings, then **Update**.

<p align="center"><img src="docs/screenshot-update.png" width="420" alt="The card's footer: 358 characters · HeptaFloat 0.9.9 available"></p>

**Shortcuts** — every keyboard shortcut in one place. Click one and press new keys to change it; HeptaFloat warns you if the keys are already taken. **Reset All Shortcuts** restores the defaults.

<p align="center"><img src="docs/screenshot-shortcuts.png" width="420" alt="Settings → Shortcuts"></p>

> Using Raycast or another launcher? A launcher hotkey that opens HeptaFloat works too — press it again to hide. Just don't give the launcher and HeptaFloat's own shortcut the same keys.

## How it works

```mermaid
flowchart LR
  K["Your shortcut<br/>(⌃⌥J by default)"] --> C["HeptaFloat card<br/>floats over any screen"]
  C <-->|"read · save as you type<br/>check for changes every 3s (while visible)"| CLI["Heptabase CLI"]
  C -->|"⌘N new card · ⌘O search<br/>paste images"| CLI
  CLI <--> H["Heptabase app<br/>(must be running)"]
  H <--> S["Heptabase sync<br/>your other devices"]
  C -.->|"⌘P · ⌘[ ⌘] · ⌘. pin"| R[("Recent cards<br/>kept on your Mac")]
  C -.->|"latest version?<br/>at launch + daily"| G["GitHub releases"]
```

HeptaFloat never stores your notes, and the only thing it fetches from the internet itself is the latest release from GitHub (to offer updates). It reads and saves through the Heptabase app on your Mac (via Heptabase's CLI), and Heptabase syncs as usual. The only things HeptaFloat keeps are the ⌘P list of cards you've opened and a few cached images.

**What happens to what you type**

- **Saved about half a second after you stop typing.** Switching cards never waits: the card you leave keeps saving in the background, and anything you typed goes to the card you typed it in.
- **Heptabase closed or busy?** Your text stays in the card and is saved as soon as Heptabase answers again — the footer says *Not saved* until then.
- **Changed in Heptabase at the same time** (say, on your phone)? Nothing is overwritten: your version is kept as a new card, *“… — HeptaFloat copy”*, and the card shows Heptabase's.
- **Card deleted in Heptabase?** It leaves HeptaFloat's Recent list and closes if it's open; unsaved typing in it becomes a new card.
- **Checks for changes only while the card is on screen**, so it costs nothing in the background.

## Privacy

HeptaFloat runs entirely on your Mac. It reads and saves your journal through the Heptabase app on your computer and never sends your notes anywhere else. No accounts, no analytics. The only internet request HeptaFloat makes itself is asking GitHub for its latest release (at launch and once a day; turn off **Check for updates automatically** to stop it). It keeps a small log on your Mac for troubleshooting (card IDs and error messages, not your text) at `~/Library/Logs/HeptaFloat.log`.

## FAQ

**Does it work with notes other than the journal?** Yes — press <kbd>⌘</kbd> <kbd>O</kbd> to open any note or journal and edit it in the card. Other card types open in Heptabase.

**What if I delete a card in Heptabase?** It disappears from HeptaFloat's Recent list too, and if it's open in the card, it closes. Anything you'd typed into it that wasn't saved yet is kept as a new card.

**What if I edit the same card in Heptabase and HeptaFloat at once?** Nothing is lost — if both change at the same moment, your HeptaFloat version is saved as a separate *“HeptaFloat copy”* card (find it with <kbd>⌘</kbd> <kbd>P</kbd>).

**Something didn't sync. Where do I look?** The footer at the bottom of the card shows errors (hover for the full message), and **Help → Show Log File** (with *Show in Dock and menu bar* on) or `~/Library/Logs/HeptaFloat.log` has the details — include it when [reporting a problem](https://github.com/madeyexz/heptafloat/issues/new).

**Will it mess up my journal?** HeptaFloat keeps everything it doesn't edit exactly as it was (images, embeds, colors, tables…). Each save is checked against the latest version in Heptabase, so it won't overwrite changes you made there.

**How do I update?** From 0.9.8 on, the card's footer tells you when a new version is out; click it, then **Update** in Settings. If Update says it can't replace HeptaFloat, make sure the app is in your Applications folder and you opened it from there — or download the [latest release](https://github.com/madeyexz/heptafloat/releases/latest) and replace the app by hand.

**Is this made by Heptabase?** No — it's an independent, unofficial companion app.

---

## For developers

HeptaFloat is a native Swift shell (non-activating floating `NSPanel`, global hotkey, SwiftUI Settings) around a [ProseMirror](https://prosemirror.net) editor in a `WKWebView`. It reads and writes cards with the Heptabase CLI (`heptabase journal|note read/save`, `note create`, `file import/export`, `card list/properties`), with md5 conflict checks. Saves are a queue of per-card snapshots, so switching cards never waits on a save.

```
Sources/main.swift   app shell: window, hotkey, menus, Settings, CLI bridge, updater
src/schema.js        lossless ProseMirror schema for Heptabase's card format
src/editor.js        editor state, autosave, sync, day rollover
src/commands.js      list editing (indent, split, toggle…)
src/menus.js         "/" menu, @ mentions, selection toolbar, placeholders
src/palette.js       ⌘O search and ⌘P recent-card pickers
src/setup.js         the setup checklist shown until Heptabase is reachable
src/index.html       styles (Heptabase theme tokens, light/dark)
preview/             run the editor in a browser with a demo journal
```

**Build:** `./build.sh` (needs [Bun](https://bun.sh) and Xcode Command Line Tools) — builds a Universal app, installs it to `~/Applications`, and writes `dist/HeptaFloat-<version>.zip`.

**Try the editor without Heptabase:** `./preview/serve.sh`, then open <http://localhost:8765/stage.html>.

**Regenerate screenshots and the demo:** `./preview/capture.sh` and `./preview/record-demo.sh` (need `agent-browser` and `ffmpeg`). `open HeptaFloat.app --args --show-settings` opens Settings directly, for its screenshot; `--update-url <url>` checks another address instead of GitHub's latest release (for testing updates). On Linux, start the browser with `agent-browser --init-script preview/mac-platform.js open about:blank` first so the ⌘ shortcuts work; `FPS=24 ./preview/record-demo.sh` if the recording can't keep up.

**Release:** bump `VERSION` in `build.sh`, run `./build.sh`, then `gh release create vX.Y.Z dist/HeptaFloat-X.Y.Z.zip`. The updater relies on that shape: it reads the *latest* release (not drafts or pre-releases), takes the version from the `vX.Y.Z` tag, downloads the asset named exactly `HeptaFloat-X.Y.Z.zip`, checks it against the SHA-256 GitHub records on upload, and only installs a signed app whose `CFBundleShortVersionString` matches the tag.

**Round-trip test:** `bun test/roundtrip.js <folder of journal JSON>` checks that loading and saving a journal changes nothing.

## License

[MIT](LICENSE) © 2026 Ian Hsiao. Bundles the [Inter](https://rsms.me/inter/) typeface under the [SIL Open Font License](src/fonts/OFL.txt).
Heptabase is a trademark of its owners; this project is not affiliated with Heptabase.
