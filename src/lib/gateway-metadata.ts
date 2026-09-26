export type GatewayCallerMetadata =
  | { caller_type: 'user'; access_user_id: string }
  | { caller_type: 'service_token'; service_token_id: string }
  | { caller_type: 'access' };

type AccessIdentityReader = {
  getIdentity(): Promise<CloudflareAccessIdentity | undefined>;
};

/**
 * Returns only verified, pseudonymous Access identity fields suitable for AI Gateway logs.
 * Service tokens identify a client, not a human user, so they are kept in a separate field.
 */
export async function gatewayCallerFromAccess(access?: AccessIdentityReader): Promise<GatewayCallerMetadata | undefined> {
  if (!access) return undefined;
  const identity = await access.getIdentity();
  if (!identity) return { caller_type: 'access' };

  if (identity.service_token_status === true && typeof identity.service_token_id === 'string' && identity.service_token_id) {
    return { caller_type: 'service_token', service_token_id: identity.service_token_id };
  }
  if (typeof identity.user_uuid === 'string' && identity.user_uuid) {
    return { caller_type: 'user', access_user_id: identity.user_uuid };
  }
  return { caller_type: 'access' };
}

export function isGatewayCallerMetadata(value: unknown): value is GatewayCallerMetadata {
  if (!value || typeof value !== 'object' || !('caller_type' in value)) return false;
  if (value.caller_type === 'access') return true;
  if (value.caller_type === 'user') {
    return 'access_user_id' in value && typeof value.access_user_id === 'string' && Boolean(value.access_user_id);
  }
  return value.caller_type === 'service_token'
    && 'service_token_id' in value
    && typeof value.service_token_id === 'string'
    && Boolean(value.service_token_id);
}

export function gatewayMetadata(component: string, caller?: GatewayCallerMetadata) {
  return {
    application: 'iphone-ai-flue-agent',
    component,
    ...(caller || {}),
  };
}
