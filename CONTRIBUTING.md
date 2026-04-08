# Contributing to CMCG

Thanks for your interest in contributing to CMCG! This guide will help you get started.

## Development Setup

```bash
git clone https://github.com/dr4g0nbyt3/cmcg.git
cd cmcg
npm install
npm run dev
```

## Project Structure

- `src/types/` — TypeScript interfaces for the .cmcg manifest schema
- `src/player/` — Core player and source resolution logic
- `sample/` — Sample template and assets served during development
- `docs/` — Product design documentation

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Ensure `npx tsc --noEmit` passes with no errors
4. Submit a pull request

## Pull Request Guidelines

- Keep PRs focused on a single change
- Include a clear description of what and why
- Reference any related issues

## Reporting Bugs

Use the [bug report template](https://github.com/dr4g0nbyt3/cmcg/issues/new?template=bug_report.md) to file issues. Include steps to reproduce, expected behavior, and what actually happened.

## Feature Requests

Use the [feature request template](https://github.com/dr4g0nbyt3/cmcg/issues/new?template=feature_request.md). Describe the use case and why it matters.

## Code Style

- TypeScript with strict mode
- No runtime dependencies in the core player
- Prefer explicit types over inference for public APIs
