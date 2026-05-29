# Requirements — basement-dehumidifier-2026

**Category:** dehumidifier
**Use case:** Small, mildly-damp basement (≤1,500 sq ft); continuous gravity-hose drain to a floor drain; quiet; optimize value.
**Budget:** Hard cap **$350**; cheaper is better at equal performance.
**Drafted:** 2026-05-28 by Niki

> Phase 0 deliverable. Sign off on this before any gathering. Every must-have is a hard filter; every nice-to-have is a scored bucket.

## Context
- **Environment:** basement, ≤1,500 sq ft, **mildly** damp (musty in summer, no standing-water history).
- **Drainage setup:** there's a **floor drain at or below** where the unit will sit, so a **gravity hose runs downhill** to it — **no pump needed**. (Bonus: skipping the pump removes the most common dehumidifier failure point, which directly helps the reliability goal.)
- **Ambient:** cool basement. Low-temp operation is relevant but **not** a priority.

## Must-haves (hard filters — fail any → rejected)
- [ ] **Continuous gravity-drain hose port** — drains downhill to the floor drain, no pump required.
- [ ] **Price ≤ $350** (live price at time of check).

> No capacity must-have. High-capacity (50-pint) units are **not** penalized for size — if they're loud, thirsty, or pricey, the noise/energy/value buckets handle it. Capacity-fit only penalizes *under*-sizing for the space.

## Dealbreakers (anti-features — if critical reviews confirm a *pattern*, reject)
- [ ] Early death — compressor/unit failure within ~2 years.
- [ ] Louder than its class — whine, rattle, or a recurring "much louder than expected" theme.
- [ ] Drain/hose leaks, or a bucket-full sensor that falsely trips and stops the unit.

## Nice-to-haves (scored, not gated)
- [ ] Auto-restart after power loss.
- [ ] Accurate humidistat / set-and-forget.
- [ ] Caster wheels — easy to reposition.
- [ ] Washable, easy-access filter.

## Priorities (what to optimize — scoring weights)
1. **Quiet** (2.0) — measured dB preferred over spec-sheet claims.
2. **Reliability / longevity** (2.0) — multi-year Reddit/BuyItForLife + warranty + critical-review failure patterns.
3. **Value** (1.5) — cheaper is strictly better at equal performance (hard cap $350).
4. **Energy / running cost** (1.3) — runs near-continuously, so this is real money.
5. Capacity-fit (1.0, penalize only undersizing), drainage-fit (0.5), cold-basement (0.5), smart features (0.2).

## Deliverables
- Ranked report with a clear pick, runner-up, and the tradeoff.
- **Price-vs-performance Pareto curve** — x = live price, y = weighted *non-price* performance score (noise + reliability + energy + capacity + drainage). The non-dominated frontier is highlighted; the pick should sit on or just under it.
- `products.json` ground truth + per-finalist mention files.

## Decisions deferred / open questions
- Exact target humidity setting and whether a small unit will keep up if the basement turns out damper than "mild" — revisit if reviews suggest the small class struggles.
- DOE capacity normalization: compare like-for-like (a "50-pint" new-standard ≈ old "70-pint"); don't compare across rating standards.
