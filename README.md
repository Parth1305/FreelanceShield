# FreelanceShield

FreelanceShield is a blockchain escrow system for milestone-based freelance work. The smart-contract layer is implemented and tested. The current web dashboard is an interactive portfolio demo; the authenticated D1 backend and live viem integration are the next phase and are **not** claimed as complete here.

## Current status

- Implemented: ERC-1167 escrow factory, milestone escrow, designated-arbiter disputes, on-chain reputation, Hardhat tests, coverage, Sepolia Ignition module, address exporter.
- Existing demo: responsive client dashboard with contract creation, milestone approval, wallet-state, dispute, activity, and reputation interactions.
- Not implemented yet: D1/Drizzle persistence, JWT accounts, backend viem transaction routes, MetaMask transaction wiring, freelancer dashboard, n8n workflow.
- Sepolia: deployment configuration is ready, but no deployment or Etherscan verification is claimed until funded credentials are provided.

## Architecture

```text
Browser / MetaMask (next phase)
          |
          v
vinext Route Handlers -- JWT -- D1 / Drizzle (next phase)
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

## Web build

```bash
npm run build
```

The project uses the vinext/Cloudflare Workers structure. D1 bindings are configured through the Cloudflare deployment environment; the application schema and API routes will be added in the backend phase.
