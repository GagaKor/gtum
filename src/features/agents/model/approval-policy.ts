export type ApprovalRisk = 'low' | 'medium' | 'high' | 'blocked'

export type ApprovalDecision = 'auto-run' | 'ask-user' | 'deny'

export interface ApprovalPolicyRequest {
  readonly command: string
  readonly cwd?: string
  readonly risk: ApprovalRisk
}

export interface ApprovalPolicyResult {
  readonly decision: ApprovalDecision
  readonly reason: string
}

const dangerousCommandPattern = /\b(rm\s+-rf|git\s+reset\s+--hard|sudo)\b/u

export function decideApprovalPolicy(
  request: ApprovalPolicyRequest,
): ApprovalPolicyResult {
  if (request.risk === 'blocked' || dangerousCommandPattern.test(request.command)) {
    return {
      decision: 'deny',
      reason: 'Command matches a blocked execution pattern.',
    }
  }

  if (request.risk === 'low') {
    return {
      decision: 'auto-run',
      reason: 'Low-risk command can run without explicit approval.',
    }
  }

  return {
    decision: 'ask-user',
    reason: 'Command requires explicit user approval.',
  }
}
