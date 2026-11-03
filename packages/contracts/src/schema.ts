/* Generated from contracts/snapshot.schema.json; do not edit. */
export const snapshotSchema = {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "schemaVersion": {
      "const": "1.0"
    },
    "id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
    },
    "projectId": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
    },
    "sourceRevision": {
      "anyOf": [
        {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        {
          "type": "null"
        }
      ]
    },
    "capturedAt": {
      "type": "string",
      "format": "date-time"
    },
    "demo": {
      "type": "boolean"
    },
    "environments": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/environment"
      }
    },
    "evidence": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/evidence"
      }
    },
    "components": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/component"
      }
    },
    "relationships": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/relationship"
      }
    },
    "coverage": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/coverage"
      }
    },
    "suggestions": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/suggestion"
      }
    },
    "documentation": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/documentation"
      }
    }
  },
  "required": [
    "schemaVersion",
    "id",
    "projectId",
    "sourceRevision",
    "capturedAt",
    "demo",
    "environments",
    "evidence",
    "components",
    "relationships",
    "coverage",
    "suggestions",
    "documentation"
  ],
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:modernizer:snapshot:1.0",
  "title": "Modernizer assessment snapshot 1.0",
  "$comment": "Apply the additional semantic invariants in docs/03-contracts.md. This schema does not authorize filesystem reads or URL fetching.",
  "$defs": {
    "environment": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        }
      },
      "required": [
        "id",
        "name"
      ]
    },
    "evidence": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
        },
        "sourceType": {
          "type": "string",
          "enum": [
            "file",
            "declaration",
            "scan",
            "provider",
            "registry"
          ]
        },
        "path": {
          "anyOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 1000,
              "pattern": "^(?!/)(?!.*\\\\)(?![A-Za-z]:)(?!.*(?:^|/)\\.\\.(?:/|$))[^\\u0000]+$"
            },
            {
              "type": "null"
            }
          ]
        },
        "url": {
          "anyOf": [
            {
              "type": "string",
              "format": "uri",
              "pattern": "^https?://",
              "maxLength": 2000
            },
            {
              "type": "null"
            }
          ]
        },
        "line": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 1
        },
        "observedAt": {
          "type": "string",
          "format": "date-time"
        },
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        }
      },
      "required": [
        "id",
        "sourceType",
        "path",
        "url",
        "line",
        "observedAt",
        "description"
      ]
    },
    "version": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "facet": {
          "type": "string",
          "enum": [
            "declared",
            "resolved",
            "deployed",
            "latest"
          ]
        },
        "value": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "environmentId": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "observedAt": {
          "type": "string",
          "format": "date-time"
        },
        "evidenceIds": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
          },
          "uniqueItems": true,
          "minItems": 1
        }
      },
      "required": [
        "facet",
        "value",
        "environmentId",
        "observedAt",
        "evidenceIds"
      ]
    },
    "observation": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "dimension": {
          "type": "string",
          "enum": [
            "configuration",
            "health",
            "ci",
            "migration",
            "support"
          ]
        },
        "state": {
          "type": "string",
          "enum": [
            "unknown",
            "configured",
            "not_configured",
            "healthy",
            "degraded",
            "unhealthy",
            "passed",
            "failed",
            "pending",
            "applied",
            "supported",
            "unsupported"
          ]
        },
        "environmentId": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "observedAt": {
          "type": "string",
          "format": "date-time"
        },
        "confidence": {
          "type": "string",
          "enum": [
            "high",
            "medium",
            "low"
          ]
        },
        "evidenceIds": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
          },
          "uniqueItems": true,
          "minItems": 1
        }
      },
      "required": [
        "dimension",
        "state",
        "environmentId",
        "observedAt",
        "confidence",
        "evidenceIds"
      ]
    },
    "component": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
        },
        "kind": {
          "type": "string",
          "enum": [
            "frontend",
            "backend",
            "package",
            "runtime",
            "test_suite",
            "database",
            "migration",
            "pipeline",
            "external_service",
            "api_endpoint"
          ]
        },
        "layer": {
          "type": "string",
          "enum": [
            "frontend",
            "backend",
            "testing",
            "data",
            "delivery",
            "shared",
            "external"
          ]
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "locator": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000,
          "pattern": "^(?!/)(?!.*\\\\)(?![A-Za-z]:)(?!.*(?:^|/)\\.\\.(?:/|$))[^\\u0000]+$"
        },
        "environmentIds": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
          },
          "uniqueItems": true
        },
        "versions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/version"
          }
        },
        "observations": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/observation"
          }
        },
        "evidenceIds": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
          },
          "uniqueItems": true,
          "minItems": 1
        }
      },
      "required": [
        "id",
        "kind",
        "layer",
        "name",
        "locator",
        "environmentIds",
        "versions",
        "observations",
        "evidenceIds"
      ]
    },
    "relationship": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
        },
        "fromId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
        },
        "toId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
        },
        "type": {
          "type": "string",
          "enum": [
            "depends_on",
            "calls",
            "reads_writes",
            "deploys",
            "tests",
            "migrates"
          ]
        },
        "environmentIds": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
          },
          "uniqueItems": true
        },
        "confidence": {
          "type": "string",
          "enum": [
            "high",
            "medium",
            "low"
          ]
        },
        "evidenceIds": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
          },
          "uniqueItems": true,
          "minItems": 1
        }
      },
      "required": [
        "id",
        "fromId",
        "toId",
        "type",
        "environmentIds",
        "confidence",
        "evidenceIds"
      ]
    },
    "coverage": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "collector": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
        },
        "status": {
          "type": "string",
          "enum": [
            "supported",
            "unsupported",
            "failed",
            "not_configured"
          ]
        },
        "scope": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "observedAt": {
          "type": "string",
          "format": "date-time"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        }
      },
      "required": [
        "collector",
        "status",
        "scope",
        "observedAt",
        "reason"
      ]
    },
    "suggestion": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
        },
        "fingerprint": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
        },
        "ruleId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
        },
        "ruleVersion": {
          "type": "integer",
          "minimum": 1
        },
        "category": {
          "type": "string",
          "enum": [
            "feat",
            "chore",
            "refactor",
            "style",
            "fix",
            "docs"
          ]
        },
        "targetIds": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
          },
          "uniqueItems": true,
          "minItems": 1
        },
        "priority": {
          "type": "string",
          "enum": [
            "P0",
            "P1",
            "P2",
            "P3"
          ]
        },
        "effort": {
          "type": "string",
          "enum": [
            "small",
            "medium",
            "large",
            "unknown"
          ]
        },
        "confidence": {
          "type": "string",
          "enum": [
            "high",
            "medium",
            "low"
          ]
        },
        "evidenceIds": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
          },
          "uniqueItems": true,
          "minItems": 1
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "rationale": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "action": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "verification": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 4000
          },
          "minItems": 1
        }
      },
      "required": [
        "id",
        "fingerprint",
        "ruleId",
        "ruleVersion",
        "category",
        "targetIds",
        "priority",
        "effort",
        "confidence",
        "evidenceIds",
        "title",
        "rationale",
        "action",
        "verification"
      ]
    },
    "officialReference": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "url": {
          "type": "string",
          "format": "uri",
          "pattern": "^https?://",
          "maxLength": 2000
        },
        "verifiedAt": {
          "anyOf": [
            {
              "type": "string",
              "format": "date-time"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "title",
        "url",
        "verifiedAt"
      ]
    },
    "documentation": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "componentId": {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$"
        },
        "status": {
          "type": "string",
          "enum": [
            "complete",
            "partial",
            "undocumented"
          ]
        },
        "officialReferences": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/officialReference"
          }
        },
        "internalPaths": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1000,
            "pattern": "^(?!/)(?!.*\\\\)(?![A-Za-z]:)(?!.*(?:^|/)\\.\\.(?:/|$))[^\\u0000]+$"
          },
          "uniqueItems": true
        },
        "reviewedAt": {
          "anyOf": [
            {
              "type": "string",
              "format": "date-time"
            },
            {
              "type": "null"
            }
          ]
        },
        "gap": {
          "anyOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 4000
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "componentId",
        "status",
        "officialReferences",
        "internalPaths",
        "reviewedAt",
        "gap"
      ]
    }
  }
} as const;
