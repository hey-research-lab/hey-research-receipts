// Lines 4–188 of HEY production's evidence-id module, unchanged: the family list, the parser and
// the formatter. The rest of that module (ship precision helpers) depends on HEY internals and is
// not part of the public id contract. Parity is recorded in CONTRIBUTING.md.

/**
 * Typed public evidence ids (2026-09-26).
 *
 * The same ship was `2ac87a66-…` on `/api/ships`, `ship:8a5efaab-…` on the
 * timeline and a `project#ship-…` fragment in RSS (audit M1 G10). One id per
 * record now, typed by family, never a bare table key and never a slug: the
 * families are the change ledger's subject ids, so an event's `evidence[].id`
 * resolves here directly.
 *
 * - `ship:<uuid>` — a ship event and every evidence row behind it
 * - `signal:<uuid>` — a signal, its evidence and the ship it announces
 * - `abi:<uuid>` — a change in a contract's published source or interface
 * - `impl:<chainId>:<address>:<block>:<logIndex>` — an implementation change
 *   read from the chain's upgrade log; `impl:<chainId>:<address>:rpc:<uuid>`
 *   — one HEY saw between two reads of the proxy (no block to name)
 * - `lock:<chainId>:<lockId>` — a HoodLock lock
 * - `source:<uuid>` — a project source and how HEY classifies it
 * - `claim:<uuid>` — a verified ownership claim (method and date only)
 * - `state:<projectUuid>:<key>:<transitionId>` — a recorded state transition
 * - `integrity:<tokenUuid>:<key>` — a Market Integrity event (public only while HEY publishes Market Integrity)
 * - `narrative:<projectUuid>:<slug>` — a narrative HEY assigned to a project
 * - `method:<uuid>` — a contract's functions first called, or called again
 *   after thirty or more days without a call, on one UTC day (2026-09-27)
 * - `sourcechange:<uuid>` — a material change to what a project's official
 *   site declares, against HEY's earlier reading (2026-09-27)
 * - `security:<projectUuid>:<audit|bounty|contact>:<16 hex>` — one item of a
 *   project's security context: an audit report or bounty program link (the
 *   hash of its normalised URL) or its published security contact (the hash
 *   of the site's host) (2026-09-28). Evidence, never a verdict.
 * - `v4hook:<chainId>:<address>` — a Uniswap v4 hook contract: the
 *   permissions its address declares, the first pool HEY read it initialise,
 *   and whom HEY attributes it to and why (founder ruling 3, 2026-10-01).
 *   Chain-native and immutable, never a table key; `v4hook`, not `hook`, so it
 *   is never read as a webhook. Public only while a published project holds
 *   it (PROJECT_DEPLOYER or PROJECT_DECLARED).
 */
export const EVIDENCE_FAMILIES = ['ship', 'signal', 'abi', 'impl', 'lock', 'source', 'claim', 'state', 'integrity', 'narrative', 'method', 'sourcechange', 'security', 'v4hook'] as const;
export type EvidenceFamily = (typeof EVIDENCE_FAMILIES)[number];

export type EvidenceId =
  | { family: 'ship' | 'signal' | 'abi' | 'source' | 'claim' | 'method' | 'sourcechange'; uuid: string }
  | { family: 'impl'; chainId: number; address: string; block: number; logIndex: number }
  | { family: 'impl'; chainId: number; address: string; rpcId: string }
  | { family: 'lock'; chainId: number; lockId: number }
  | { family: 'state'; projectId: string; key: string; transitionId: number }
  | { family: 'integrity'; tokenId: string; key: string }
  | { family: 'narrative'; projectId: string; slug: string }
  | { family: 'security'; projectId: string; kind: SecurityEvidenceKind; hash: string }
  | { family: 'v4hook'; chainId: number; address: string };

export const SECURITY_EVIDENCE_KINDS = ['audit', 'bounty', 'contact'] as const;
export type SecurityEvidenceKind = (typeof SECURITY_EVIDENCE_KINDS)[number];
const HASH16 = /^[0-9a-f]{16}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const DIGITS = /^[0-9]{1,18}$/;
/** State keys are the engine's own lower-snake names (`activity_status`, `market_status`, …). */
const STATE_KEY = /^[a-z][a-z0-9_]{0,40}$/;
/**
 * An integrity key is the engine's event key without its rules version: parts joined by colons or
 * dashes. Upper case is part of it (`conflict:READINGS_DISAGREE`, `migration:POOL:0x…`, 2026-09-27):
 * a lower-case-only pattern refused a third of the ledger's own integrity ids.
 */
const INTEGRITY_KEY = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,160}$/;
/** A narrative slug as the narratives table stores it. */
const NARRATIVE_SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

const safeInt = (value: string): number | undefined => {
  if (!DIGITS.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

/**
 * Reads a typed id, case-normalised (uuids and addresses are lower-cased).
 * Undefined for anything that is not exactly one of the families above: an
 * id is parsed, never guessed, and a malformed one is a 400, not a search.
 */
export function parseEvidenceId(raw: string): EvidenceId | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 240) return undefined;
  const value = raw.trim();
  const colon = value.indexOf(':');
  if (colon <= 0) return undefined;
  const family = value.slice(0, colon).toLowerCase();
  const rest = value.slice(colon + 1);
  switch (family) {
    case 'ship':
    case 'signal':
    case 'abi':
    case 'source':
    case 'claim':
    case 'method':
    case 'sourcechange': {
      const uuid = rest.toLowerCase();
      return UUID.test(uuid) ? { family, uuid } : undefined;
    }
    case 'impl': {
      const [chain, address, block, logIndex, ...extra] = rest.split(':');
      if (extra.length > 0 || chain === undefined || address === undefined || block === undefined || logIndex === undefined) return undefined;
      if (block === 'rpc') {
        const rpcChain = safeInt(chain);
        const rpcAddress = address.toLowerCase();
        const rpcId = logIndex.toLowerCase();
        if (rpcChain === undefined || !ADDRESS.test(rpcAddress) || !UUID.test(rpcId)) return undefined;
        return { family: 'impl', chainId: rpcChain, address: rpcAddress, rpcId };
      }
      const chainId = safeInt(chain);
      const blockNumber = safeInt(block);
      const log = safeInt(logIndex);
      const addr = address.toLowerCase();
      if (chainId === undefined || blockNumber === undefined || log === undefined || !ADDRESS.test(addr)) return undefined;
      return { family: 'impl', chainId, address: addr, block: blockNumber, logIndex: log };
    }
    case 'lock': {
      const [chain, lock, ...extra] = rest.split(':');
      if (extra.length > 0 || chain === undefined || lock === undefined) return undefined;
      const chainId = safeInt(chain);
      const lockId = safeInt(lock);
      return chainId === undefined || lockId === undefined ? undefined : { family: 'lock', chainId, lockId };
    }
    case 'state': {
      const [project, key, transition, ...extra] = rest.split(':');
      if (extra.length > 0 || project === undefined || key === undefined || transition === undefined) return undefined;
      const projectId = project.toLowerCase();
      const transitionId = safeInt(transition);
      if (!UUID.test(projectId) || !STATE_KEY.test(key) || transitionId === undefined) return undefined;
      return { family: 'state', projectId, key, transitionId };
    }
    case 'integrity': {
      const token = rest.slice(0, 36).toLowerCase();
      const key = rest.slice(37);
      if (rest.charAt(36) !== ':' || !UUID.test(token) || !INTEGRITY_KEY.test(key)) return undefined;
      return { family: 'integrity', tokenId: token, key };
    }
    case 'narrative': {
      const [project, slug, ...extra] = rest.split(':');
      if (extra.length > 0 || project === undefined || slug === undefined) return undefined;
      const projectId = project.toLowerCase();
      const narrative = slug.toLowerCase();
      return UUID.test(projectId) && NARRATIVE_SLUG.test(narrative) ? { family: 'narrative', projectId, slug: narrative } : undefined;
    }
    case 'security': {
      const [project, kind, hash, ...extra] = rest.split(':');
      if (extra.length > 0 || project === undefined || kind === undefined || hash === undefined) return undefined;
      const projectId = project.toLowerCase();
      const k = kind.toLowerCase();
      const h = hash.toLowerCase();
      const known = SECURITY_EVIDENCE_KINDS.find((value) => value === k);
      return UUID.test(projectId) && known && HASH16.test(h) ? { family: 'security', projectId, kind: known, hash: h } : undefined;
    }
    case 'v4hook': {
      const [chain, address, ...extra] = rest.split(':');
      if (extra.length > 0 || chain === undefined || address === undefined) return undefined;
      const chainId = safeInt(chain);
      const addr = address.toLowerCase();
      return chainId === undefined || !ADDRESS.test(addr) ? undefined : { family: 'v4hook', chainId, address: addr };
    }
    default:
      return undefined;
  }
}

/** The canonical text form: parse then format is the identity on every well-formed id. */
export function formatEvidenceId(id: EvidenceId): string {
  switch (id.family) {
    case 'impl':
      return 'rpcId' in id ? `impl:${id.chainId}:${id.address}:rpc:${id.rpcId}` : `impl:${id.chainId}:${id.address}:${id.block}:${id.logIndex}`;
    case 'lock':
      return `lock:${id.chainId}:${id.lockId}`;
    case 'state':
      return `state:${id.projectId}:${id.key}:${id.transitionId}`;
    case 'integrity':
      return `integrity:${id.tokenId}:${id.key}`;
    case 'narrative':
      return `narrative:${id.projectId}:${id.slug}`;
    case 'security':
      return `security:${id.projectId}:${id.kind}:${id.hash}`;
    case 'v4hook':
      return `v4hook:${id.chainId}:${id.address}`;
    default:
      return `${id.family}:${id.uuid}`;
  }
}

