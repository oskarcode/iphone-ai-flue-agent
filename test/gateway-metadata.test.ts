import { describe, expect, it } from 'vitest';
import { gatewayCallerFromAccess, gatewayMetadata } from '../src/lib/gateway-metadata.ts';

describe('AI Gateway caller metadata', () => {
  it('uses the verified Access user UUID without logging email', async () => {
    const caller = await gatewayCallerFromAccess({
      getIdentity: async () => ({ user_uuid: 'user-123', email: 'person@example.com' }),
    });

    expect(gatewayMetadata('assistant', caller)).toEqual({
      application: 'iphone-ai-flue-agent',
      component: 'assistant',
      caller_type: 'user',
      access_user_id: 'user-123',
    });
  });

  it('keeps service-token identity separate from human identity', async () => {
    const caller = await gatewayCallerFromAccess({
      getIdentity: async () => ({ service_token_status: true, service_token_id: 'token-456' }),
    });

    expect(caller).toEqual({ caller_type: 'service_token', service_token_id: 'token-456' });
  });

  it('returns no metadata when Access did not authenticate the request', async () => {
    await expect(gatewayCallerFromAccess()).resolves.toBeUndefined();
  });
});
