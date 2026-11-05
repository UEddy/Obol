# Obol demo video (Remotion)

Source for the < 90 s hackathon demo. It is not part of the Hermes plugin: Hermes never loads
anything in this folder.

The look is paper, index cards and rubber stamps. Scenes
(78 s total, 1920×1080, 30 fps): intro → surfaces → **three real screen recordings**
(forwarded message + approval, Stripe payment, dashboard PAID) → pipeline → end card. It follows the 90-second demo script in the main README.

## 1. Record the clips (real Stripe test mode)

Put them in `public/clips/` and set the file names in `src/clips.ts`:

| Clip | Length used | What to record |
|---|---|---|
| `chat.mp4` | 20 s | Forward Dana's message (12 hours at $100/hr, billing@acme.test). Hermes proposes $1,200.00; say *"send it"*; approve the prompt; show the payment link |
| `pay.mp4` | 15 s | Open the link, pay with test card `4242 4242 4242 4242`, then ask *"Has Acme paid?"* |
| `dashboard.mp4` | 15 s | Dashboard → **Invoices** → Sync. The Acme row's stamp flips to PAID |

Use `startSeconds` in `src/clips.ts` to trim the start of a clip. Until a clip is set, its
scene shows a labelled placeholder.

## 2. Render

```bash
npm ci
npx remotion studio                                   # preview and scrub
npx remotion render ObolDemo out/obol-demo.mp4        # final 1080p
```

On a machine without a Remotion-managed Chrome, add
`--browser-executable=/path/to/chrome-headless-shell`.

Fonts (Inter Tight, Courier Prime, Caveat) come from `@fontsource` packages, so rendering
needs no network.

Remotion is free for individuals and companies of up to 3 people; see
https://www.remotion.dev/license for larger teams.
