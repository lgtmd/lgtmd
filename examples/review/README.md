# Review a real text and screenshot change

This small React/Vite app demonstrates lgtmd's docs-site review workflow. Version
A shows a saved project **In progress**; version B shows it **Ready for review**.
The same ordinary Playwright scenario checks the status, clicks Save, captures
the rendered card, and authors its explanation through the public SDK.

From a prepared repository checkout:

```sh
npm run build
just docs-demo
```

Open the printed URL and enable **View diff**. Switch **Previous / Current** to
read the guide, then choose **Before / After** or **Regions** for the image.
The Contributor session includes intentionally public sample notes. Ctrl-C stops
the owned server and removes the disposable history.

The launcher builds recorded Reader and Contributor versions in a temporary Git
repository, with fixed commit metadata and a `before` revision. It starts the
actual installed `lgtmd dev` command, which runs the version-B flow freshly.
The source repository's branches, index, and history are untouched. The launcher
ignores inherited Git redirection/configuration and needs Git on PATH.

`run.mjs` is an ordinary CLI flow: it starts the built app on a free loopback
port, waits for guarded Playwright completion, closes the app server, and calls
`completeRun`. lgtmd has no knowledge of this application's React state. The
existing [fullstack example](../lgtmd-web/README.md) separately shows an HTTP API
and project-owned database-like fixture lifecycle.

lgtmd's [own review guide](../../docs/guide/review-changes.md) drives this real
comparison and captures its image modes. The final guide is never an input to
this example, so there is no recursive screenshot baseline.

Screenshots are retained as lossless WebP. The local `capture.mjs` helper converts
Playwright's PNG buffer with the pinned development encoder before registering
it with `mediaType: "image/webp"`. The profile records encoder versions; tests
check decoded pixel preservation. This is an example policy, not an SDK format
requirement.
