# Which wAIste frontend

Run `npm install` once, then `npm run dev` from this folder. The Vite development
server connects to the local FastAPI backend through `/api`; see the root README
for backend setup.

## Classroom layout target

Review design changes at **1388 × 768**, at 100% browser zoom. Also check a real
laptop at that display resolution: browser tabs and the address bar leave less
than 768px for the page.

- Keep instructions around 15px; reserve the pixel font for short headings and scores.
- Keep the hidden test score as a wide panel beneath both the round replay and
  graph help cards.
- Check the home/name form, sorting, training before and after a run, the Run A/B
  comparison, all three Test activities, and the optional weights activity.
- Open definitions near each screen edge; they must stay readable and closable.
- Avoid horizontal page scrolling. Allow vertical scrolling for expanded optional
  details rather than shrinking text or clipping content.

`npm test`, `npm run lint`, and `npm run build` check behavior and compilation.
The popup tests include 1388 × 768 positioning with mocked element dimensions;
they do not replace a browser check of the rendered layout.

