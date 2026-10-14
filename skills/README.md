# lgtmd agent skills

Skills help your coding agent adopt lgtmd and maintain executable documentation
in your project. They contain instructions and examples; install the lgtmd SDK
separately when adding it to your application’s development tooling.

From the project where you want to use them:

```sh
npx skills add lgtmd/lgtmd
```

Choose the `lgtmd` skill and your agent when prompted. To select the skill directly:

```sh
npx skills add lgtmd/lgtmd --skill lgtmd
```

| Skill                   | Use it for                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| [lgtmd](lgtmd/SKILL.md) | Adopt executable guides, integrate project-owned workflows, and build, review, and check their evidence. |

For example, ask your agent: “Add lgtmd documentation for one existing workflow,
reuse our fixtures, and show me the generated guide before accepting a baseline.”

This directory is the user-installable catalog. Repository-maintainer skills
live in `.agents/skills/` and are excluded from normal Skills CLI discovery with
`metadata.internal`. See the [repository map](../REPOSITORY.md) for ownership and
the [Skills CLI documentation](https://github.com/vercel-labs/skills) for installer
options.
