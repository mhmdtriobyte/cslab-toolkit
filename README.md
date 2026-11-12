# CS Lab Toolkit

Interactive tools for computer science courses, running entirely in the browser.

**Live:** [ostoolkit.triobyte.tech](https://ostoolkit.triobyte.tech)

## Tools

| Course                  | Tools                                                          |
| ----------------------- | -------------------------------------------------------------- |
| Operating Systems       | Fork visualizer, CPU scheduling, Deadlock, Threads, Memory     |
| Programming (C, Python) | Code runner (real Python and C, step through), Manual          |
| Data Structures         | Sorting & searching, Trees / heaps / hashing, Graph algorithms |
| Databases               | SQL playground (SQLite, with exercises)                        |

## Run locally

Needs Node.js 20+ and pnpm 9.

```bash
pnpm i
```

```bash
pnpm dev
```

Open http://localhost:5173. The Python and C compilers are installed by `pnpm i`.

| Command          | Does                     |
| ---------------- | ------------------------ |
| `pnpm test`      | Tests                    |
| `pnpm lint`      | ESLint                   |
| `pnpm typecheck` | Type check               |
| `pnpm build`     | Build to `apps/web/dist` |

## Docs

- [Architecture](docs/architecture.md)
- [Adding a module](docs/adding-a-module.md)
- [Adding an example](docs/adding-an-example.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE)
