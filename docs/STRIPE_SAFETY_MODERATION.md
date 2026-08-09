# Safety & moderation (for Stripe Content Creation Platform)

Copy or adapt the section below into your Stripe onboarding / business profile answers.

---

## Short blurb (paste-ready)

**Pick Your Path Stories (PYPStories)** is a family-friendly platform for interactive adventure comics and branching stories (epic/YA-leaning fantasy tone). We do **not** allow adult, sexual, or pornographic content.

**Programmatic moderation**

- Automated keyword / phrase filtering runs on **story titles, descriptions, page text, and choice labels** (and usernames / comments) using a maintained blocklist of profanity, sexual terms, slurs, and self-harm bait.
- Disallowed text is **rejected on write** (create/update of comics, pages, choices).
- Before a story can enter human review or go live, a **full-story re-scan** runs on **submit** and again on **publish**.
- If the scan fails, the story is **automatically quarantined** (`status = quarantined`): it cannot be submitted or published until the creator removes the flagged language and re-submits successfully.

**Human review**

- After the automated filter passes, creators still must **submit for review**. An editor/admin **claims** the story, then **approves** or **requests changes**.
- Only after **approval** can the creator **publish**. Public browse only shows `status = published`.
- Editors can see auto-quarantined items in the review queue for oversight.

**Policies**

- Public **[Content & Acceptable Use Policy](https://pypstories.com/content-policy.html)** and **[Terms of Service](https://pypstories.com/terms.html)** describe the family-friendly standard and prohibited content.
- Image moderation is not fully automated yet; images are reviewed in the human queue. Text automation is the primary programmatic gate.

**Summary:** automated text filtering + auto-quarantine + mandatory editor review before publish.

---

## Stripe follow-up: Demonetization policy (paste-ready)

**How flagged or rejected content impacts creator monetization and payouts**

Only **published** stories are available for public sale (full-story purchase and credit chapter unlocks). Monetization is gated behind compliance:

1. **Before go-live (primary control)**  
   - Automated text filters reject disallowed language on save.  
   - Submit for review runs a full-story text re-scan; failures set status to **quarantined** — the story cannot be submitted or published until fixed.  
   - Editors/admins must **approve** the story; only then can the creator **publish**.  
   - Rejected or “changes requested” stories remain non-public. **No public listing = no new sales and no new creator earnings** on that work.

2. **After publish (if content later violates policy)**  
   - We may **unpublish**, **quarantine**, **remove** the story, and/or **suspend/terminate** the creator account under our Content Policy and Terms.  
   - Unpublishing removes the work from Browse and sales paths so **new purchases and chapter unlocks stop**.  
   - Serious or repeated violations can result in **suspension of selling privileges** and review of the creator’s ability to request **Stripe Connect payouts**.

3. **Earnings and payout flow**  
   - Creator earnings are recorded only on **completed sales** of eligible (at the time of sale, published/compliant) content.  
   - Earnings enter a short **pending / dispute-style hold**, then become **available** for payout (subject to a minimum balance).  
   - Payouts are sent to the creator’s **Stripe Connect** account only for **available** balances.  
   - Amounts already paid out via completed Connect transfers are handled under Stripe’s normal transfer rules; for **pending or not-yet-paid** earnings on content later removed for policy violations, the platform may **withhold, reverse eligibility for payout, or delay payout** pending review.  
   - Account-level bans can block **new sales** and **new payout requests**.

In short: policy-violating content cannot start or continue earning; only compliant published work monetizes; removal/unpublish stops the sales flow; payouts apply only to properly earned available balances and may be withheld when violations are found.

---

## Stripe follow-up: Image and media moderation (paste-ready)

**Automated detection and moderation for images and other media**

PYPStories is a visual interactive-story platform (panel images, covers, optional choice images). Our approach:

1. **Upload controls (automated, technical)**  
   - Allowed types only: **JPEG, PNG, WebP, GIF**.  
   - Per-file and bulk size limits enforce reasonable media size.  
   - Non-image types are rejected at upload.  
   - Media is stored on our controlled storage path and served only as part of authenticated/creator-owned or published story flows as designed.

2. **Policy (what is not allowed)**  
   - Same family-friendly standard as text: no pornography, erotic/smut art, sexual content, CSAM, gore excess, hate, or illegal material.  
   - Creators must have rights to every image.  
   - Stated in our public Content & Acceptable Use Policy.

3. **Human review of images (primary visual gate)**  
   - Every story must pass **manual editor/admin review** before publish. Reviewers see **covers, page images, and choice images** along with text.  
   - Editors may **approve**, **request changes**, or refuse the story; non-approved content does not go public and does not monetize.  
   - Auto-quarantine and the review queue also surface risk for extra oversight.

4. **What we do not claim today**  
   - We do **not** currently run a separate third-party AI “photo DNA / NSFW classifier” on every upload at write time. Visual judgment for go-live is **human review in the mandatory pre-publish queue**, combined with text automation and upload-type/size filters.  
   - We may add automated image hashing/classifier tools as the platform scales; until then, **no story is public or saleable without human review of its media**.

5. **Enforcement after publish**  
   - User reports and staff checks can lead to unpublish, quarantine, removal, and account action, which stop further monetization as described in the demonetization answer.

**Summary:** technical filters on media type/size + policy ban on prohibited imagery + **mandatory human review of all visual content before publish** + text automation; sales only for published compliant works.

---

## Status flow (reference)

```
draft ──(filter on write)──► draft
  │
  ├── submit (full scan) ──fail──► quarantined ──(edit + re-submit)──► submitted
  │                      └──pass──► submitted ──► in_review ──► approved | changes_requested
  │
  └── publish (must be approved + full scan) ──fail──► quarantined
                                              └──pass──► published
```

## Implementation pointers (engineering)

| Piece | Location |
|--------|----------|
| Blocklist + `validateContentText` / `scanStoryBundle` | `services/moderation.js` |
| Write-time filters, submit/publish gates, quarantine | `server.js` |
| Creator UI (quarantine badge, re-submit) | `public/js/app.js` |
| Public policy | `public/content-policy.html` |
