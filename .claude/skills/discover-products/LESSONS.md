# LESSONS — discover-products

Indexed log of mistakes + fixes. Seeded at design time with the dragons I can already see from the sibling skills and from how product research goes wrong. After each run, append `as-confirmed-by: <search-id>` to any lesson the run validated, and add new ones.

The format mirrors `discover-summer-camps/LESSONS.md`: an `L#`, a topic tag, the trap, and the fix.

---

## Process

### L0 — Don't skip (or guess) Phase 0 requirements `[process]`
**Trap:** Jumping straight to "best dehumidifiers 2026" and ranking the internet's consensus. The internet's best is not *this user's* best. The user wanted a hose-to-floor-drain unit that's quiet for a basement — a generic "our pick" might be a tank-only unit that's great in a bedroom and useless here.
**Fix:** Phase 0 is mandatory and interactive. Surface the decision dimensions + tradeoffs, separate must-haves / dealbreakers / nice-to-haves, pin budget + context, get sign-off. Everything downstream is scored against that spec. A skipped Phase 0 produces a confident, well-formatted, wrong answer.

### L8 — Conviction is a test, not a vibe `[process]`
**Trap:** Stopping when the ranking "looks done." The user explicitly asked to keep going until conviction. "I read a few reviews and #1 seems good" is not conviction.
**Fix:** Run the Step 8 conviction test explicitly — triangulation (≥3 sources on top picks), no unbroken dealbreaker on the leader, the runner-up tradeoff is articulable in one sentence, and a completeness-critic pass. Loop until it passes or honestly declare a toss-up. Don't manufacture confidence.

---

## Data acquisition

### L1 — A spec you can't point at is `unverified` `[data]`
**Trap:** Filling specs from training knowledge ("the Frigidaire 50-pint is 51 dB") and filtering/recommending on them. Model lines change yearly; the number you remember may be last gen's.
**Fix:** Tag every spec `verified` (manufacturer/lab-test source) or `unverified` (retailer bullet/memory). Any filter decision or report claim resting on an `unverified` spec must be confirmed in Pass 2 (Step 7e) or dropped.

### L2 — Prices are live; cached prices lie `[data][operational]`
**Trap:** Citing the price from a roundup article or a Pass-1 scrape. Prices and "in stock" change daily; coupons and list-vs-sale swing $50+.
**Fix:** Pull the price fresh in Step 7a via Playwright, stamp `captured_at`, triangulate one other retailer. Every price in the report carries its capture date.

### L3 — "Has a pump" ≠ "pump in the box" `[data][operational]`
**Trap:** Treating a listed capability as included. Many dehumidifiers list "pump drainage" but the pump is a separate accessory, or it's a specific higher-SKU model. Gravity-hose and built-in-pump are different products at different prices.
**Fix:** Verify drainage modes against the manufacturer page — built-in pump vs gravity hose vs tank-only, and whether the pump SKU is the one being priced.

### L7 — Read RECENT critical reviews, not all-time `[data]`
**Trap:** Reading the all-time review average. A unit can have 4.5★ lifetime but the current production run quietly got worse (cheaper compressor, new factory). The recent 1-stars catch it; the lifetime average buries it.
**Fix:** In Step 7b sort reviews by most-recent + verified-purchase, and read 3-star then 1-star. Quantify the *recent* failure-pattern prevalence separately.

---

## Sources

### L5 — Affiliate listicles are not evidence `[sources]`
**Trap:** Letting "Top 10 Best Dehumidifiers 2026!!!" SEO/affiliate pages drive the candidate set. They rank by commission, not testing; they often haven't touched the product.
**Fix:** Anchor on lab-test sources (RTINGS/Wirecutter/Consumer Reports class — they publish methodology) + Reddit reliability signal. Use listicles only to discover candidate names, never as a quality signal. See SOURCES.md rejection criteria.

### L4 — Measured dB beats spec-sheet dB `[sources]`
**Trap:** Trusting the manufacturer's quoted noise number. Spec-sheet dB is measured in ideal conditions at the quietest setting; owners report the real thing.
**Fix:** Prefer a lab-measured dB (RTINGS-class) and cross-check the "louder than expected" theme in 3-star reviews. If only spec dB exists, label it and lean on review sentiment.

### L10 — Watch for review manipulation `[sources]`
**Trap:** Taking a 4.7★ over 20k reviews at face value. Some listings have review-farm bursts (same-day 5-star clusters), rebranded ASINs inheriting another product's reviews, or "review hijacking."
**Fix:** Eyeball the histogram + review timing. Flag suspicious listings (`fake_flag`), down-weight their stars, and lean harder on expert + Reddit. A flat too-good rating with thin written content is a flag.

---

## Filtering / scoring

### L6 — Reliability is a first-class axis for durable goods `[scoring]`
**Trap:** Scoring only on measured performance + price, treating longevity as a nicety. For appliances with compressors/pumps/motors, "dies in 18 months" is the dominant real-world failure and labs can't measure it (they don't run units for years).
**Fix:** Weight reliability heavily for durable goods; source it from BuyItForLife/Reddit multi-year reports + warranty terms + critical-review death patterns. A lab-favorite with a Reddit reliability cloud should not auto-win.

### L15 — Search wide (50+), shortlist ~10, and keep the funnel auditable `[filtering][process]`
**Trap:** Carrying only 4–6 candidates into scoring. The Pareto curve looks sparse, and real contenders get silently dropped (e.g. skipping Honeywell — CR's top quiet+reliable brand — without ever checking its price, which turned out to be the only reason it failed: $382 > cap). A thin set reads as "didn't look hard."
**Fix:** Pass 1 enumerates **50+** via several retailer sweeps (by-capacity, "quiet", by-brand for every credible brand + the no-name cluster). Shortlist **~10** to plot/drill. Persist the **entire** considered set in `products.json` `considered[]` with `status` + a one-line `reason` per row, and render it on the page's **audit tab** alongside the full source list. The user should be able to see every option and exactly why each non-shortlisted one was ruled out.

### L11 — Don't over-constrain with must-haves `[filtering]`
**Trap:** Promoting preferences to must-haves ("must be white," "must be under 40 lbs") and filtering the field down to nothing or to a worse product.
**Fix:** In Phase 0, be conservative about must-haves — only true gating needs. Push the rest to nice-to-haves (scored). If hard filters reject almost everything, revisit which "musts" are really preferences.

---

## Normalization

### L9 — Collapse SKU variants of the same model `[normalize]`
**Trap:** Color/size/region SKUs of one model appearing as separate candidates, splitting reviews and double-counting. "Frigidaire 50-pint white" and "...with pump" may or may not be the same product — color isn't a different product; pump-vs-no-pump is.
**Fix:** Merge on (brand, model_number) via an explicit `CANONICAL_MERGES` table. Collapse cosmetic variants; keep functionally-different SKUs (pump vs no-pump, 35 vs 50 pint) separate. Never fuzzy-substring-merge.

---

## Composition

### L12 — The recommendation must name the tradeoff `[composition]`
**Trap:** Crowning a winner and listing the rest as an undifferentiated ranking. The user can't act on "these are all good."
**Fix:** State why the runner-up loses to the leader and for whom the runner-up would actually be the better buy. If you can't, you haven't drilled enough (conviction test 3).

### L13 — Critical reviews are content, not garnish `[composition]`
**Trap:** Burying the confirmed failure pattern, or omitting it because it's "negative." The honest caveat is the most valuable part of the write-up.
**Fix:** Put confirmed issues in the write-up plainly, with prevalence ("~1 in 5 one-stars report pump failure ~12mo"). Honesty about flaws is what makes the recommendation trustworthy.

### L14 — Don't fabricate to fill a template `[composition]`
**Trap:** The report template has a "critical-review read" cell and you fill it with a plausible-sounding issue you didn't actually find.
**Fix:** Every claim traces to `<slug>-mentions.json`. If you didn't find a pattern, write "no consistent failure pattern in the critical reviews" — that's a real and valuable finding.
