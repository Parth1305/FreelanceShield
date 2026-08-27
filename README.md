# FreelanceShield

FreelanceShield is a blockchain escrow system for milestone-based freelance work. The contracts, authenticated backend, and client/freelancer web workspace are implemented and tested. The core contracts are deployed on Sepolia; live application transactions require runtime RPC, relayer, JWT, and D1 configuration.

Maintained by [Parth Gohil](https://github.com/Parth1305).

## Current status

- Implemented: ERC-1167 escrow factory, milestone escrow, designated-arbiter disputes, on-chain reputation, Hardhat tests, coverage, Sepolia Ignition module, address exporter.
- Backend: D1/Drizzle users, projects, milestones and mirrored escrow state; email/password JWT auth; role authorization; viem factory deployment, transaction preparation/validation, and DB/on-chain reconciliation.
- Frontend: responsive account access, MetaMask/Sepolia connection, client and freelancer workspaces, project creation, escrow funding, milestone submission/approval/rejection, disputes, reconciled escrow status, and registry-backed reputation.
- Not implemented yet: optional n8n reminder/escalation automation. Arbiter evidence exchange and resolution UI are intentionally outside the current portfolio scope.
- Sepolia: all four contracts are deployed, the factory is authorized in the resolver and reputation registry, and the generated application configuration contains the live addresses. Etherscan source verification remains pending an API key.

## Architecture

```text
Browser / MetaMask
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

## Web workspace

The public entry screen supports account registration and login. Registration associates the connected MetaMask address with the account. JWTs are stored locally for API authentication; wallet keys and signatures remain inside MetaMask.

Clients can create milestone projects, fund deployed escrows, approve or reject submissions, and raise disputes. Freelancers can switch to their assigned-project workspace, submit a deliverable URL whose hash is committed on-chain, and raise disputes. Accounts with the `both` role can switch workspaces without signing in again.

Each write follows the same two-step flow:

1. The API validates the participant and simulates/encodes the contract call with viem.
2. MetaMask signs and broadcasts the prepared Sepolia transaction.
3. The API verifies the mined signer, escrow, function, milestone and deliverable hash, then reconciles D1 from live contract state.

Funding is sent directly from the client wallet to the escrow. Reputation reads use the generated Sepolia registry address when one is available; before deployment the UI accurately reports that the registry is pending.

## Contracts

- `EscrowFactory.sol`: deploys and atomically initializes one non-upgradeable ERC-1167 clone per project, then authorizes it with the resolver and registry.
- `Escrow.sol`: exact-value native ETH funding, milestone submission/rejection/approval, dispute handoff, pull-payment credits, and final reputation reporting.
- `DisputeResolver.sol`: only the project's designated arbiter can resolve an open dispute; awards may be split but must equal the milestone value.
- `ReputationRegistry.sol`: stores completed-contract and dispute outcomes reported only by factory-authorized escrow clones.

Value transfers use pull payments. Approval or resolution updates accounting without calling recipient code; `withdraw()` follows checks-effects-interactions and has a reentrancy lock. The resolver likewise closes a case before calling back into escrow.

## Sepolia addresses

Deployed from this repository on Sepolia (chain ID `11155111`). On-chain bytecode and factory wiring were checked after deployment.

| Contract | Address |
| --- | --- |
| Escrow implementation | [`0xDDb2824E9f968Bb89085c26d71703f22ef7db69C`](https://sepolia.etherscan.io/address/0xDDb2824E9f968Bb89085c26d71703f22ef7db69C) |
| EscrowFactory | [`0xaA3923a7deFaf0D925E22ECC3208d5f3B405A8f0`](https://sepolia.etherscan.io/address/0xaA3923a7deFaf0D925E22ECC3208d5f3B405A8f0) |
| DisputeResolver | [`0x822578A8825f4b78BC2E9AA99F0E3672df17B7dA`](https://sepolia.etherscan.io/address/0x822578A8825f4b78BC2E9AA99F0E3672df17B7dA) |
| ReputationRegistry | [`0xabCd60022f4567520C3145b540999A9601655CfD`](https://sepolia.etherscan.io/address/0xabCd60022f4567520C3145b540999A9601655CfD) |

`npm run contracts:export-addresses` generated `app/lib/contracts.generated.ts` from Hardhat Ignition's canonical deployment record. The backend uses the generated factory address by default while still allowing an `ESCROW_FACTORY_ADDRESS` runtime override.

### Live Sepolia smoke test

After deployment, a complete one-milestone lifecycle was executed against an ERC-1167 clone at [`0x1Cc98DD1e6d95Adf64fc82Fd67aA2AE7658E6612`](https://sepolia.etherscan.io/address/0x1Cc98DD1e6d95Adf64fc82Fd67aA2AE7658E6612): create, fund, submit, approve, withdraw, and reputation reporting. The escrow finished with zero remaining milestones, and both participant addresses recorded one completed contract. This test used one wei of escrow value and Sepolia test ETH for gas.

## Setup

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run db:generate
npm run backend:test
npm run frontend:test
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
npm run typecheck
npm run lint
npm test
npm run build
```

The project uses the vinext/Cloudflare Workers structure. The `DB` D1 binding is configured through the Cloudflare deployment environment. The current automated suite contains 8 backend unit tests, 3 frontend API/wallet helper tests, and 2 production-render/build-manifest smoke tests. Live Sepolia integration remains configuration-dependent until the contracts are deployed and runtime secrets are supplied.
