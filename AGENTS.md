<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Build

- `scripts/build.mjs` runs two Node processes with stage-aware V8 heap caps: the app stage (client + SSR graphs) is capped at 1100 MB, the Nitro worker rebundle at 1400 MB. The worker stage peaked just above 1100 MB and was OOM-killed during chunk rendering on the production deploy; do not lower either cap without re-measuring peak memory.
- Colocated test files under `src/routes/` must be named with a leading `-` (e.g. `-index-dashboard.test.tsx`) so the route generator excludes them; vitest still picks them up.
