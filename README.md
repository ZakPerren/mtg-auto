# MTG Auto — offline MTG sealed / prerelease deck builder

Installable web app (PWA). Once it's installed on the phone it runs fully offline: card database (33,880 cards), Comprehensive Rules (25 Sep 2026), the deck optimiser and the rules/interaction explainer all live on the device.

## Folder layout
```
dist/            ← the finished app. Host this folder (HTTPS) and open it on the phone.
src/             ← source (engine/, data/, ui/, main.js, index.html, app.css, sw.js)
build/           ← build-data.mjs (makes the card/rules data), bundle.mjs (builds dist/), icon.mjs
public/data/     ← generated cards.json + rules.json
test/            ← sim.mjs (sealed pool simulator), cmdr.mjs, rules.mjs, ui.cjs (Playwright)
```

## Get it on the Fold 6
A service worker (which is what makes it work offline) only runs on **HTTPS**, so `dist/` has to be hosted once:

- **GitHub Pages / Netlify / Vercel** — upload `dist/`. For a quick manual option, drag the `dist` folder onto https://app.netlify.com/drop.
- Open the URL in Chrome on the phone → ⋮ → **Add to Home screen / Install app**. Open it once while online so everything caches. After that it works in airplane mode.

To try it on the laptop: `npx serve dist` → open http://localhost:3000 (localhost counts as secure, so offline mode works there too).

## Rebuild after code changes (Windows, from C:\Dev\projects\mtg-auto)
```powershell
npm install
npm run build          # writes dist/
```

## Refresh the bundled card data (when a new set is out)
The phone can pull new cards from Scryfall itself (Data tab → "Get new cards…" or "Get a set"). To refresh the bundled data, including Forge's limited pick-order rankings for new sets:
```powershell
git clone --depth 1 --filter=blob:none --sparse https://github.com/Card-Forge/forge.git C:\Dev\tools\forge
cd C:\Dev\tools\forge; git sparse-checkout set forge-gui/res/cardsfolder forge-gui/res/editions forge-gui/res/draft forge-gui/res/formats
cd C:\Dev\projects\mtg-auto
# rules.json: download the latest from https://github.com/natewizz/mtg-rules (see latest.json there)
node build/build-data.mjs C:\Dev\tools\forge\forge-gui\res path\to\rules.json public\data
npm run build
```

## How the deck builder decides
1. **Card value** – in Limited, from the set's pick-order ranking (Forge's community rankings) blended with an oracle-text estimate. Without a ranking, the oracle-text estimate is used: rarity, stats against mana value, keywords, removal, card draw and so on.
2. **Synergy** – each card's text is tagged with themes it *gives* (makes tokens, sacrifices, gains life…) and *wants* (death triggers, life-gain payoffs, spells-matter…), plus creature types. A giver and a wanter in the same deck score points, with diminishing returns.
3. **Composition** – creature count and mana curve for the chosen play style; removal and card advantage get a bonus.
4. **Colours** – every 1–N colour combination is tried, plus splash variants (only one splash pip, and only cards worth splashing). The best ~12 are fully optimised: greedy fill, then swap search.
5. **Mana base** – lands from the pool that fit the colours, then basics split by coloured-pip demand, with a minimum per colour; source counts are checked against your heaviest costs.
6. **Combos** – a built-in list, your own combos (Data tab) and Commander Spellbook (online, cached).

Constraints: deck size, land count, max colours, must/never-include cards, must/excluded colours, splash on/off and max splash cards, play style, synergy weight, format legality, singleton/commander.

## Credits
Card data and rankings: Forge (GPL-3.0). Online data: Scryfall. Combos: Commander Spellbook. Rules JSON: natewizz/mtg-rules (free, non-commercial use only). Mana symbols: Mana font (MIT).
Unofficial Fan Content, not approved or endorsed by Wizards of the Coast.
