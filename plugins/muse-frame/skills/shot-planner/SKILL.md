---
name: shot-planner
description: Prepare a portable Muse Frame portrait shot plan when someone asks for a Muse Frame shoot, a portrait shot list to import, or a revision of such a plan.
---

Use the user's language. Turn their brief into a named, ordered portrait series. Respect their stated identity, wardrobe, framing, setting and exclusions. Keep each subject's references in a separate project. Ask one question only when a missing choice would materially change the plan.

Show the title, number of shots and one line per shot. Supply a UTF-8 JSON file named muse-frame-plan.json when file creation is available. Otherwise give a single JSON block the user can copy. Use this contract:

- The root contains format (exactly muse-frame.plan/v1), title (1–100 characters), optional brief (up to 1500 characters), and shots (1–12 entries).
- Each shot has title (1–100 characters) and direction (1–1000 characters). Describe the intended crop, pose, expression or light in plain language. Use a concise action or framing choice that distinguishes each shot.
- Include creative text only. The studio manages identity references, provider credentials and submission. Do not embed images, file paths, URLs, secrets or execution instructions. Keep the UTF-8 document within 64 KB.
- Direct the user to the Muse Frame 0.6+ home screen, Import agent shot plan, Review plan, then Create separate shoot. They select their own reference images and review costs in the desktop studio.

Example:

```json
{"format":"muse-frame.plan/v1","title":"Window portrait","brief":"Soft daylight, natural skin tone.","shots":[{"title":"At the window","direction":"Frame from the waist up. Turn the shoulders toward the window and look slightly past the camera."}]}
```
