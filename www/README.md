# lgtmd website

A small static Astro placeholder for the public website. `/` introduces lgtmd;
`/docs/` links to the existing generated guides until the website integrates them.
This does not implement custom pages in the lgtmd SDK or replace its viewer.

## Local development

From the repository root, using Node.js 24:

```sh
npm ci --prefix www --workspaces=false
npm run dev --prefix www
npm run build --prefix www
npm run preview --prefix www
```

`www/` deliberately has its own package manifest and lockfile, outside the SDK's
npm workspaces. Website installation and builds need no Rust, SDK build, browser
capture, credentials, or application services. Build output is `www/dist/`.

## Initial Vercel connection

Connect this repository to a Vercel project once, with **Root Directory `www`**
and production branch **`main`**. Keep this project root stable even if the site
changes frameworks. The initial project connection and domain setup are account
operations, not deployment configuration in `vercel.json`.

The committed `vercel.json` explicitly selects Astro, a locked npm installation,
the build/dev commands, and the output directory. `package.json` selects Node 24.
Do not copy these build settings into dashboard overrides. Automatic Git
deployments are enabled only for `main`; all other branches are disabled in
`vercel.json`. Contributors use GitHub pull requests and the website CI build.
Merging into `main` triggers production deployment through the connected Git
integration. No contributor needs a Vercel CLI, API token or dashboard access
for ordinary website and framework changes.

No Vercel project has been provisioned or deployed by adding this scaffold.
`.vercel/` stores local project linkage and is ignored; do not commit credentials.

## Contributors and deployment permissions

`lgtmd/lgtmd` is a public repository. Vercel documents free collaboration for
public repositories; contributors do not need paid Vercel seats merely to have
merged changes deployed. Fork pull-request previews are different: Vercel can
require an owner or team member to authorize them. This scaffold does not depend
on those previews and keeps fork protection intact.

Require the GitHub **Website build** check before merging, rather than making a
Vercel preview deployment a required PR check. This branch configuration selects
normal deployment triggers; it is not an access-control boundary against PRs
that modify configuration. Review configuration changes along with site code.
The workflow runs on every PR so a required check is never left pending because
of a path filter. GitHub branch protection is configured separately by a
repository administrator.

If the repository becomes private, reassess this setup: Vercel does not support
private organization repositories on Hobby, and Pro checks commit authors for
Vercel team access. A `vercel.json` setting cannot override those membership or
plan requirements. Public repository collaboration also does not waive other
plan limits or permitted-use terms. The production Git flow still needs a real
post-merge deployment check after the initial Vercel connection.

References: [Git deployment permissions](https://vercel.com/docs/git),
[collaboration rules](https://vercel.com/docs/deployments/troubleshoot-project-collaboration),
[branch deployment configuration](https://vercel.com/docs/project-configuration/git-configuration).

## Change the framework through Git

Keep the Vercel project and its `www` root. Change source, dependencies, lockfile,
scripts and `vercel.json` together in a pull request:

- **Static Astro now:** `framework: "astro"`, `outputDirectory: "dist"`.
- **Next.js later:** install Next.js and its dependencies, change the scripts and
  set `framework: "nextjs"`. Set `outputDirectory: null` to use the framework
  default instead of retaining Astro's `dist` override. Review any redirects or
  rewrites against the new router.
- **A future static lgtmd site builder:** use `framework: null` (Other), select its
  build command and static output directory. This is a possible deployment path,
  not a current custom-page feature or implementation plan.
- **A custom server-rendered builder:** use a supported Vercel adapter or the
  Build Output API. Static HTML output alone does not provide server functions.

Vercel's file configuration overrides the corresponding project build settings.
Framework changes and routes can therefore travel with the code. Account-level
settings, project root, Git connection, domains, secrets, billing and access
policies are not all expressible in `vercel.json`. Those remain owner-managed
exceptions to this Git-only contributor workflow. Keep the project root and Git
connection stable; ordinary site changes must not depend on collaborators having
Vercel access. Secrets must stay out of Git.

References: [Vercel file configuration](https://vercel.com/docs/project-configuration/vercel-json),
[project settings](https://vercel.com/docs/project-configuration/project-settings),
[Astro deployment](https://docs.astro.build/en/guides/deploy/vercel/),
[Build Output API](https://vercel.com/docs/build-output-api/v3).

## Scope still open

The full landing page, embedded `/docs` experience, canonical domain and any
future custom-page API remain separate work. Maintain user-guide prose in
`docs/authoring/`; do not create another manually maintained copy here. The
website CI builds this isolated project on Node 24. A local build validates the
static output, not an actual Vercel deployment.
