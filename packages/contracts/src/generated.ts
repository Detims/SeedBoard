/* Generated from contracts/snapshot.schema.json. Run pnpm contracts:generate; do not edit. */

export interface ModernizerAssessmentSnapshot10 {
schemaVersion: "1.0"
id: string
projectId: string
sourceRevision: (string | null)
capturedAt: string
demo: boolean
environments: Environment[]
evidence: Evidence[]
components: Component[]
relationships: Relationship[]
coverage: Coverage[]
suggestions: Suggestion[]
documentation: Documentation[]
}
/**
 * This interface was referenced by `ModernizerAssessmentSnapshot10`'s JSON-Schema
 * via the `definition` "environment".
 */
export interface Environment {
id: string
name: string
}
/**
 * This interface was referenced by `ModernizerAssessmentSnapshot10`'s JSON-Schema
 * via the `definition` "evidence".
 */
export interface Evidence {
id: string
sourceType: ("file" | "declaration" | "scan" | "provider" | "registry")
path: (string | null)
url: (string | null)
line: (number | null)
observedAt: string
description: string
}
/**
 * This interface was referenced by `ModernizerAssessmentSnapshot10`'s JSON-Schema
 * via the `definition` "component".
 */
export interface Component {
id: string
kind: ("frontend" | "backend" | "package" | "runtime" | "test_suite" | "database" | "migration" | "pipeline" | "external_service" | "api_endpoint")
layer: ("frontend" | "backend" | "testing" | "data" | "delivery" | "shared" | "external")
name: string
locator: string
environmentIds: string[]
versions: Version[]
observations: Observation[]
/**
 * @minItems 1
 */
evidenceIds: [string, ...(string)[]]
}
/**
 * This interface was referenced by `ModernizerAssessmentSnapshot10`'s JSON-Schema
 * via the `definition` "version".
 */
export interface Version {
facet: ("declared" | "resolved" | "deployed" | "latest")
value: string
environmentId: (string | null)
observedAt: string
/**
 * @minItems 1
 */
evidenceIds: [string, ...(string)[]]
}
/**
 * This interface was referenced by `ModernizerAssessmentSnapshot10`'s JSON-Schema
 * via the `definition` "observation".
 */
export interface Observation {
dimension: ("configuration" | "health" | "ci" | "migration" | "support")
state: ("unknown" | "configured" | "not_configured" | "healthy" | "degraded" | "unhealthy" | "passed" | "failed" | "pending" | "applied" | "supported" | "unsupported")
environmentId: (string | null)
observedAt: string
confidence: ("high" | "medium" | "low")
/**
 * @minItems 1
 */
evidenceIds: [string, ...(string)[]]
}
/**
 * This interface was referenced by `ModernizerAssessmentSnapshot10`'s JSON-Schema
 * via the `definition` "relationship".
 */
export interface Relationship {
id: string
fromId: string
toId: string
type: ("depends_on" | "calls" | "reads_writes" | "deploys" | "tests" | "migrates")
environmentIds: string[]
confidence: ("high" | "medium" | "low")
/**
 * @minItems 1
 */
evidenceIds: [string, ...(string)[]]
}
/**
 * This interface was referenced by `ModernizerAssessmentSnapshot10`'s JSON-Schema
 * via the `definition` "coverage".
 */
export interface Coverage {
collector: string
status: ("supported" | "unsupported" | "failed" | "not_configured")
scope: string
observedAt: string
reason: string
}
/**
 * This interface was referenced by `ModernizerAssessmentSnapshot10`'s JSON-Schema
 * via the `definition` "suggestion".
 */
export interface Suggestion {
id: string
fingerprint: string
ruleId: string
ruleVersion: number
category: ("feat" | "chore" | "refactor" | "style" | "fix" | "docs")
/**
 * @minItems 1
 */
targetIds: [string, ...(string)[]]
priority: ("P0" | "P1" | "P2" | "P3")
effort: ("small" | "medium" | "large" | "unknown")
confidence: ("high" | "medium" | "low")
/**
 * @minItems 1
 */
evidenceIds: [string, ...(string)[]]
title: string
rationale: string
action: string
/**
 * @minItems 1
 */
verification: [string, ...(string)[]]
}
/**
 * This interface was referenced by `ModernizerAssessmentSnapshot10`'s JSON-Schema
 * via the `definition` "documentation".
 */
export interface Documentation {
componentId: string
status: ("complete" | "partial" | "undocumented")
officialReferences: OfficialReference[]
internalPaths: string[]
reviewedAt: (string | null)
gap: (string | null)
}
/**
 * This interface was referenced by `ModernizerAssessmentSnapshot10`'s JSON-Schema
 * via the `definition` "officialReference".
 */
export interface OfficialReference {
title: string
url: string
verifiedAt: (string | null)
}

export type Snapshot = ModernizerAssessmentSnapshot10;
