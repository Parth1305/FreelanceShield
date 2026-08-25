# FreelanceShield contracts

The contracts use native ETH and one non-upgradeable ERC-1167 clone per project. A designated arbiter resolves disputes because a bilateral freelance contract has known parties and potentially private evidence; a token vote would add governance and privacy risks without improving the demo's trust model.

## Commands

```bash
npm run contracts:test
npm run contracts:coverage
npm run contracts:deploy:sepolia
npm run contracts:export-addresses
```

Sepolia deployment requires `SEPOLIA_RPC_URL`, a funded `SEPOLIA_PRIVATE_KEY`, and `ETHERSCAN_API_KEY`. The deployment command uses Hardhat Ignition's verification integration. Run the address exporter after deployment to update `app/lib/contracts.generated.ts` from Ignition's canonical deployment record.
