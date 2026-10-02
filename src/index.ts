// The AgentResearchReceipt v1 contract, extracted from HEY Research Lab's production code.
export {
  AGENT_RESEARCH_RECEIPT_TYPE,
  AGENT_RESEARCH_RECEIPT_VERSION,
  AGENT_RESEARCH_RECEIPT_MAX_BYTES,
  RECEIPT_AGENT_CAPABILITIES,
  RECEIPT_UNKNOWN_CATEGORIES,
  evidenceRefSchema,
  agentResearchReceiptSchema,
  agentResearchReceiptJsonSchema,
  citedEvidence,
  type EvidenceRef,
  type AgentResearchReceipt,
} from './schema';
export { EXAMPLE_RECEIPT_OTHER_PROJECT, EXAMPLE_RECEIPT_HEY } from './examples';
export {
  EVIDENCE_FAMILIES,
  SECURITY_EVIDENCE_KINDS,
  parseEvidenceId,
  formatEvidenceId,
  type EvidenceFamily,
  type EvidenceId,
  type SecurityEvidenceKind,
} from './evidence-ids';

// This package's own additions: Robinhood Chain constants, the offline validator, the optional
// online check and the summary `hey-receipt inspect` prints.
export {
  CHAIN_NAME,
  CHAIN_ID,
  CAIP2,
  EXPLORER_URL,
  UnsupportedChainError,
  assertChainId,
} from './chain';
export {
  VALIDATION_SCHEMA,
  HEY_ORIGIN,
  CHANGE_EVENT_FAMILIES,
  FORBIDDEN_KEYS,
  MAX_DEPTH,
  validateReceipt,
  validateReceiptJson,
  failedValidation,
  findUnsafeStructure,
  isHeyAgentAnswerUrl,
  type ChangeEventFamily,
  type Finding,
  type FindingCode,
  type WarningCode,
  type OfflineRefResult,
  type OfflineValidation,
} from './validate';
export {
  HEY_RECEIPT_VALIDATOR_URL,
  ONLINE_TIMEOUT_MS,
  ONLINE_MAX_RESPONSE_BYTES,
  heyValidatorAnswerSchema,
  checkReceiptOnline,
  type HeyValidatorAnswer,
  type OnlineError,
  type OnlineErrorCode,
  type OnlineOptions,
  type OnlineResult,
} from './online';
export {
  summarizeReceipt,
  type ReceiptSummary,
  type CitedReference,
  type ContentOrigin,
} from './summary';
export { cleanText } from './text';
export { RECEIPT_NOT_PROOF, OFFLINE_NOTE } from './notice';
export { PACKAGE_NAME, PACKAGE_VERSION } from './version';
