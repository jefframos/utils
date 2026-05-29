# Apps Folder

Each utility app should live in its own folder inside `apps/`.

## Required

- `apps/<your-app>/index.html`

## Optional

- `apps/<your-app>/app.json`

Example `app.json`:

```json
{
  "name": "JSON Formatter",
  "description": "Format and validate JSON quickly"
}
```

After adding a new app, run:

```bash
npm run build
```

That regenerates the root `index.html` menu.