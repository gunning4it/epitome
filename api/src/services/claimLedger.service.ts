import { withUserSchema } from '@/db/client';

export type ClaimStatus = 'proposed' | 'active' | 'superseded' | 'rejected' | 'review';
export type ClaimMethod = 'deterministic' | 'llm_inferred' | 'heuristic' | 'unknown';

export interface ClaimEvidenceInput {
  evidenceType: 'table_row' | 'vector' | 'profile_version' | 'extraction' | 'artifact' | 'memory_meta' | 'manual';
  sourceRef?: string;
  tableName?: string;
  recordId?: number;
  vectorId?: number;
  profileVersion?: number;
  confidence?: number;
  extractionArtifact?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface CreateKnowledgeClaimInput {
  claimType: string;
  subject: Record<string, unknown>;
  predicate: string;
  object: Record<string, unknown>;
  confidence?: number;
  status?: ClaimStatus;
  method?: ClaimMethod;
  origin?: 'user_stated' | 'user_typed' | 'ai_stated' | 'ai_inferred' | 'ai_pattern' | 'imported' | 'system';
  sourceRef?: string;
  writeId?: string;
  agentId?: string;
  model?: string;
  memoryMetaId?: number;
  validFrom?: Date;
  validTo?: Date;
  metadata?: Record<string, unknown>;
  reason?: string;
  evidence?: ClaimEvidenceInput[];
}

export interface KnowledgeClaim {
  id: number;
  claimType: string;
  subject: Record<string, unknown>;
  predicate: string;
  object: Record<string, unknown>;
  confidence: number;
  status: ClaimStatus;
  method: string;
  origin: string | null;
  sourceRef: string | null;
  writeId: string | null;
  agentId: string | null;
  model: string | null;
  memoryMetaId: number | null;
  validFrom: Date;
  validTo: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface KnowledgeClaimRow {
  id: number;
  claimType: string;
  subject: Record<string, unknown>;
  predicate: string;
  object: Record<string, unknown>;
  confidence: number;
  status: ClaimStatus;
  method: string;
  origin: string | null;
  sourceRef: string | null;
  writeId: string | null;
  agentId: string | null;
  model: string | null;
  memoryMetaId: number | null;
  validFrom: string | Date;
  validTo: string | Date | null;
  metadata: Record<string, unknown>;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export async function createKnowledgeClaim(
  userId: string,
  input: CreateKnowledgeClaimInput
): Promise<KnowledgeClaim> {
  return withUserSchema(userId, async (tx) => {
    const validFrom = (input.validFrom ?? new Date()).toISOString();
    const validTo = input.validTo ? input.validTo.toISOString() : null;

    const [claim] = await tx<KnowledgeClaimRow[]>`
      INSERT INTO knowledge_claims (
        claim_type,
        subject,
        predicate,
        object,
        confidence,
        status,
        method,
        origin,
        source_ref,
        write_id,
        agent_id,
        model,
        memory_meta_id,
        valid_from,
        valid_to,
        metadata
      ) VALUES (
        ${input.claimType},
        ${JSON.stringify(input.subject ?? {})},
        ${input.predicate},
        ${JSON.stringify(input.object ?? {})},
        ${input.confidence ?? 0.85},
        ${input.status ?? 'active'},
        ${input.method ?? 'deterministic'},
        ${input.origin ?? null},
        ${input.sourceRef ?? null},
        ${input.writeId ?? null},
        ${input.agentId ?? null},
        ${input.model ?? null},
        ${input.memoryMetaId ?? null},
        ${validFrom},
        ${validTo},
        ${JSON.stringify(input.metadata ?? {})}
      )
      RETURNING
        id,
        claim_type AS "claimType",
        subject,
        predicate,
        object,
        confidence,
        status,
        method,
        origin,
        source_ref AS "sourceRef",
        write_id AS "writeId",
        agent_id AS "agentId",
        model,
        memory_meta_id AS "memoryMetaId",
        valid_from AS "validFrom",
        valid_to AS "validTo",
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `.execute();

    await tx`
      INSERT INTO knowledge_claim_events (
        claim_id,
        event_type,
        to_status,
        actor_type,
        actor_id,
        reason,
        new_confidence,
        payload
      ) VALUES (
        ${claim.id},
        ${'created'},
        ${claim.status},
        ${'system'},
        ${input.agentId ?? null},
        ${input.reason ?? null},
        ${claim.confidence},
        ${JSON.stringify({ sourceRef: input.sourceRef ?? null, writeId: input.writeId ?? null })}
      )
    `.execute();

    if (input.evidence && input.evidence.length > 0) {
      for (const item of input.evidence) {
        await tx`
          INSERT INTO knowledge_claim_evidence (
            claim_id,
            evidence_type,
            source_ref,
            table_name,
            record_id,
            vector_id,
            profile_version,
            confidence,
            extraction_artifact,
            metadata
          ) VALUES (
            ${claim.id},
            ${item.evidenceType},
            ${item.sourceRef ?? null},
            ${item.tableName ?? null},
            ${item.recordId ?? null},
            ${item.vectorId ?? null},
            ${item.profileVersion ?? null},
            ${item.confidence ?? null},
            ${JSON.stringify(item.extractionArtifact ?? {})},
            ${JSON.stringify(item.metadata ?? {})}
          )
        `.execute();
      }
    }

    if (input.memoryMetaId) {
      await tx`
        UPDATE memory_meta
        SET claim_id = ${claim.id}
        WHERE id = ${input.memoryMetaId}
      `.execute();
    }

    return {
      ...claim,
      validFrom: new Date(claim.validFrom),
      validTo: claim.validTo ? new Date(claim.validTo) : null,
      createdAt: new Date(claim.createdAt),
      updatedAt: new Date(claim.updatedAt),
    };
  });
}
