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
