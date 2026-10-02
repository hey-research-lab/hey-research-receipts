import type { AgentResearchReceipt } from './schema';

/**
 * Two example receipts (2026-09-28): one for a project that is not HEY, one
 * for HEY itself, written the same way with the same neutrality. The ids are
 * illustrative (a real receipt cites ids it read from `/api/evidence` and
 * `/api/changes`), and the outcomes are the example agent's own, under its own
 * stated mandate — not HEY's view of either project. docs/AGENT_RESEARCH_RECEIPTS.md
 * prints these, and the schema tests validate them.
 */
export const EXAMPLE_RECEIPT_OTHER_PROJECT: AgentResearchReceipt = {
  type: 'AgentResearchReceipt',
  version: '1.0',
  agentId: 'https://agent.example.org/research-bot',
  operator: 'Example Research Collective',
  mandate: 'Monitor Robinhood Chain infrastructure projects for continued development; no allocation authority.',
  subjectType: 'project',
  subject: { chainId: 4663, projectSlug: 'hoodlock' },
  createdAt: '2026-09-28T12:00:00Z',
  evidenceCutoff: '2026-09-28T11:45:00Z',
  thesisSummary: 'The project shipped twice in the last 30 days and its lock contract is verified; its token market reading is older than HEY\'s freshness limit, so market context is set aside.',
  claims: [
    { statement: 'A release was published on 2026-09-21.', kind: 'FACT', evidence: [{ kind: 'hey_evidence', id: 'ship:3f1c2b1e-4d5a-4c6b-8e7f-9a0b1c2d3e4f' }] },
    { statement: 'HEY lists the activity status as SHIPPING under its published rule.', kind: 'DERIVED', evidence: [{ kind: 'hey_snapshot', project: 'hoodlock', asOf: '2026-09-28T11:40:00Z', scoringVersion: 'hbm-v16' }] },
    { statement: 'Development cadence looks steady to this agent.', kind: 'JUDGEMENT', evidence: [] },
  ],
  risks: [{ statement: 'The market reading is stale; liquidity today is not known from this evidence.', evidence: [{ kind: 'market_observation', source: 'geckoterminal', observedAt: '2026-09-26T08:00:00Z', field: 'liquidity' }] }],
  unknowns: [{ statement: 'HEY holds no package registry source for this project.', coverageDimension: 'package' }],
  researchState: { value: 'MONITOR', definition: 'Evidence of continued development; revisit on the next release or a coverage change.', vocabulary: 'https://agent.example.org/vocabulary/v1' },
  outcome: { value: 'MONITOR', decidedBy: 'agent', definition: 'Keep watching; no action under this mandate.' },
  confidence: 0.6,
  reviewConditions: [{ condition: 'A new release or a status change for the project.', watch: 'GET /api/changes?project=hoodlock&after=<cursor>' }],
  sourceSystems: [{ name: 'HEY Research Lab', url: 'https://heyresearch.xyz', apiVersion: '1' }],
};

export const EXAMPLE_RECEIPT_HEY: AgentResearchReceipt = {
  type: 'AgentResearchReceipt',
  version: '1.0',
  agentId: 'did:web:agent.example.org',
  mandate: 'Assess research-infrastructure tokens on Robinhood Chain; may propose, never execute, an allocation.',
  subjectType: 'token',
  subject: { chainId: 4663, projectSlug: 'hey-research-lab', tokenContract: '0x0000000000000000000000000000000000000001' },
  createdAt: '2026-09-28T12:30:00Z',
  evidenceCutoff: '2026-09-28T12:25:00Z',
  thesisSummary: 'HEY\'s own project shows recent ships and a hosted MCP in use; of its documented token utilities some are LIVE and others PLANNED per /api/hey/profile, and the valuation reading is an FDV, not a market cap.',
  claims: [
    { statement: 'The profile lists Request Research as LIVE on this deployment.', kind: 'FACT', evidence: [{ kind: 'external', url: 'https://heyresearch.xyz/api/hey/profile', retrievedAt: '2026-09-28T12:25:00Z' }] },
    { statement: 'HEY recorded a release for its own project this week.', kind: 'FACT', evidence: [{ kind: 'hey_change_event', id: 'ship:0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e', revision: 1 }] },
    { statement: 'Planned utilities are not counted as value by this agent.', kind: 'JUDGEMENT', evidence: [] },
  ],
  risks: [
    { statement: 'The valuation HEY holds is FDV; circulating supply differs.', evidence: [{ kind: 'market_observation', source: 'dexscreener', observedAt: '2026-09-28T12:00:00Z', field: 'fdv' }] },
    { statement: 'Liquidity depth is modest relative to this agent\'s minimum.' },
  ],
  unknowns: [{ statement: 'Whether the monthly treasury ledger has been published is not checked by the profile.' }],
  researchState: { value: 'RESEARCH_MORE', definition: 'Evidence is mixed or incomplete for this agent\'s mandate.' },
  outcome: { value: 'RESEARCH_MORE', decidedBy: 'agent', definition: 'Collect another month of evidence before any proposal.' },
  confidence: null,
  reviewConditions: [{ condition: 'The first monthly treasury ledger entry, or a utility moving from PLANNED to LIVE.', watch: 'GET /api/hey/profile' }],
  sourceSystems: [{ name: 'HEY Research Lab', url: 'https://heyresearch.xyz', apiVersion: '1' }],
};
