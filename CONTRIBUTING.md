# Contributing

Thanks for helping improve Sirdab Revenue Engine. Bug reports, fixes,
translations and features are all welcome.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on
  the approach before you spend time on it.
- Security problems: do not open a public issue; see [SECURITY.md](SECURITY.md).

## Development

Setup is in the [README](README.md#local-development). Before opening a pull
request, make sure these pass:

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server run typecheck:test
pnpm run test
```

Conventions worth knowing (more in [CLAUDE.md](CLAUDE.md)):

- **API changes** start in `lib/api-spec/openapi.yaml`; run
  `pnpm --filter @workspace/api-spec run codegen` and never edit `generated/`
  directories by hand.
- **Schema changes** in `lib/db/src/schema` must ship with a generated
  migration (`pnpm --filter @workspace/db run generate`), committed together.
- **Styling** uses [Sirdab One](https://github.com/sirdab/one) components and
  its semantic colour tokens; raw Tailwind palette classes (`slate-500`,
  `teal-600`) do not exist in this project.
- **User-facing text** goes through the i18n catalogs with both English and
  Arabic strings; check layouts in RTL.
- Add or update `*.test.ts` files next to logic you change.

## Pull requests

Keep each pull request to one change, describe what and why, and include
screenshots for UI changes (both English and Arabic if layout is affected).

## License

By contributing, you agree that your contributions are licensed under the
[GNU AGPL v3](LICENSE), the license of this project.
