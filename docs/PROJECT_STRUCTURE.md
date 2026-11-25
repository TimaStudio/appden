# Project Structure Guide

## Core app code

- `src/app`: router, providers, global stores.
- `src/components`: reusable UI and feature components.
- `src/pages`: route-level pages.
- `src/services`: data access and business logic.
- `src/lib`: constants, validators, utils, Firebase client and Firestore helpers, R2 client.
- `src/types`: shared TypeScript interfaces.

## Data and backend resources

- `firestore.rules`, `firestore.indexes.json`: database security rules and indexes.
- `r2-worker/`: Cloudflare Worker that serves files from R2.

## Team/process files

- `.github/`: PR template, issue templates, CODEOWNERS, workflows.
- `docs/`: collaboration and onboarding docs.
- `CONTRIBUTING.md`: contribution rules and review flow.
