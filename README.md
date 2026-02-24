Team Members: Ibraheem Amin (lead) Abu Ahmed, Cole Ramer, Richard Wang, John Wu
# First Time Setup

## Convex Database
```
cd packages/backend
bun install
npx convex login
npx convex dev
```
Create a new cloud deployment following the instructions, then a
.env.local file will generate under `packages/backend`

Copy over the environment variable that ends in `.cloud` to 
a new .env.local variable under apps/web, then set VITE_CONVEX_URL:
```
VITE_CONVEX_URL=https://your-deployment.convex.cloud
```

## Clerk Setup
Join the clerk team (contact the team lead) OR
Create a new Clerk project, from the API, copy over the two
following environment variables from the Clerk dashboard into
apps/web/.env.local 
```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```
Finally, set the CLERK_JWT_ISSUER_DOMAIN variable on the
Convex Dashboard.
```bash
# Either go to convex dashboard manually or run
cd packages/backend
npx convex dashboard
```
Navigate to settings -> environment variables and set
```
CLERK_JWT_ISSUER_DOMAIN=https://your-clerk-depl.clerk.accounts.dev
```


### Utilities

Already set up

- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [Biome](https://biomejs.dev/) for code linting and formatting


## Useful Links

Learn more about the power of Turborepo:

- [Tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks)
- [Caching](https://turborepo.dev/docs/crafting-your-repository/caching)
- [Remote Caching](https://turborepo.dev/docs/core-concepts/remote-caching)
- [Filtering](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters)
- [Configuration Options](https://turborepo.dev/docs/reference/configuration)
- [CLI Usage](https://turborepo.dev/docs/reference/command-line-reference)
