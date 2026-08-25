# FreelanceShield

FreelanceShield is a blockchain escrow system for milestone-based freelance work. The smart-contract layer and authenticated backend are implemented and tested. The current web dashboard is still an interactive portfolio demo; MetaMask transaction wiring and the freelancer-facing UI remain the next phase.

## Current status

- Implemented: ERC-1167 escrow factory, milestone escrow, designated-arbiter disputes, on-chain reputation, Hardhat tests, coverage, Sepolia Ignition module, address exporter.
- Backend: D1/Drizzle users, projects, milestones and mirrored escrow state; email/password JWT auth; role authorization; viem factory deployment, transaction preparation/validation, and DB/on-chain reconciliation.
- Existing demo: responsive client dashboard with contract creation, milestone approval, wallet-state, dispute, activity, and reputation interactions.
- Not implemented yet: MetaMask transaction wiring in the UI, freelancer dashboard, n8n workflow.
- Sepolia: deployment configuration is ready, but no deployment or Etherscan verification is claimed until funded credentials are provided.

## Architecture

```text
Browser / MetaMask (UI wiring next phase)
          |
          v
vinext Route Handlers -- JWT -- D1 / Drizzle
          |
        viem
          |
          v
 EscrowFactory ---- creates ----> ERC-1167 Escrow clone / project
     |                                  |       |        |
     | authorizes                      fund   release  withdraw
     v                                  |       |        |
DisputeResolver <---- disputed milestone+       |        |
     | designated arbiter resolution            |        |
     +------------------------------------------>+        |

ReputationRegistry <------ one final result per Escrow clone
```

The dispute model uses one designated arbiter chosen for the project. That is intentionally simpler than token voting: freelance evidence may be private, and an unrelated voter set introduces governance capture and participation problems without improving this demo's trust assumptions.

## Backend API

Accounts use email/password authentication with bcrypt password hashing and seven-day HS256 JWT access tokens. Wallet addresses are associated with accounts at registration. The API never stores party private keys: client and freelancer contract actions are simulated and encoded with viem, returned for wallet signature, then accepted a second time with the mined transaction hash. The confirmation step validates signer, target contract, function, milestone and deliverable hash before updating D1.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create an account and issue a JWT |
| `POST` | `/api/auth/login` | Verify credentials and issue a JWT |
| `GET` | `/api/auth/me` | Return the current account |
| `GET`, `POST` | `/api/projects` | List participant projects or create a project and escrow |
| `GET` | `/api/projects/:projectId` | Reconcile and return DB plus live escrow state |
| `POST` | `/api/projects/:projectId/milestones/:milestoneId/submit` | Prepare/confirm freelancer submission |
| `POST` | `/api/projects/:projectId/milestones/:milestoneId/approve` | Prepare/confirm client approval |
| `POST` | `/api/projects/:projectId/milestones/:milestoneId/reject` | Prepare/confirm client rejection |
| `POST` | `/api/projects/:projectId/milestones/:milestoneId/dispute` | Prepare/confirm participant dispute |

Escrow creation is the only relayed write and requires `CHAIN_RELAYER_PRIVATE_KEY`. That key cannot submit, approve, reject, dispute, fund, or withdraw for project participants because the contracts authorize their own wallet addresses.

## Contracts

- `EscrowFactory.sol`: deploys and atomically initializes one non-upgradeable ERC-1167 clone per project, then authorizes it with the resolver and registry.
- `Escrow.sol`: exact-value native ETH funding, milestone submission/rejection/approval, dispute handoff, pull-payment credits, and final reputation reporting.
- `DisputeResolver.sol`: only the project's designated arbiter can resolve an open dispute; awards may be split but must equal the milestone value.
- `ReputationRegistry.sol`: stores completed-contract and dispute outcomes reported only by factory-authorized escrow clones.

Value transfers use pull payments. Approval or resolution updates accounting without calling recipient code; `withdraw()` follows checks-effects-interactions and has a reentrancy lock. The resolver likewise closes a case before calling back into escrow.

## Sepolia addresses

No Sepolia deployment has been made from this repository yet.

| Contract | Address |
| --- | --- |
| Escrow implementation | Pending deployment |
| EscrowFactory | Pending deployment |
| DisputeResolver | Pending deployment |
| ReputationRegistry | Pending deployment |

After deployment, `npm run contracts:export-addresses` generates `app/lib/contracts.generated.ts` from Hardhat Ignition's canonical deployment record.

## Setup

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run db:generate
npm run backend:test
npm run contracts:compile
npm run contracts:test
npm run contracts:coverage
npm run dev
```

## Contract tests and coverage

The suite covers normal milestone release, rejection and resubmission, client- and freelancer-raised disputes, split/client/freelancer outcomes, double-release prevention, unauthorized callers, exact funding, invalid resolver callbacks, recursive withdrawal, and a recipient that rejects ETH.

Latest local result:

```text
13 passing
Escrow.sol: 100% statements, 94.34% branches, 100% functions, 100% lines
```

Coverage output is generated locally and intentionally ignored by Git.

## Sepolia deployment and verification

Set secrets locally; never commit them:

```bash
export SEPOLIA_RPC_URL="https://..."
export SEPOLIA_PRIVATE_KEY="0x..."
export ETHERSCAN_API_KEY="..."
npm run contracts:deploy:sepolia
npm run contracts:export-addresses
```

The deployment command runs the Ignition module against Sepolia with verification enabled. The module deploys the implementation, resolver, registry, and factory, then authorizes the factory in both registries.

For the backend, copy `.env.example` and set `JWT_SECRET`, `SEPOLIA_RPC_URL`, `CHAIN_RELAYER_PRIVATE_KEY`, and the verified `ESCROW_FACTORY_ADDRESS`. The generated migration in `drizzle/` creates the D1 schema. Sites applies checked-in migrations to the configured `DB` binding during deployment.

## Web build

```bash
npm run build
```

The project uses the vinext/Cloudflare Workers structure. The `DB` D1 binding is configured through the Cloudflare deployment environment. Backend unit tests use an in-memory repository and mocked chain boundary; live Sepolia integration remains configuration-dependent until the contracts are deployed.
