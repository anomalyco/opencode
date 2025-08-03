// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import Opencode from '@opencode-ai/sdk';

const client = new Opencode({ baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010' });

describe('resource permissions', () => {
  // skipped: tests are disabled for the time being
  test.skip('respond: only required params', async () => {
    const responsePromise = client.session.permissions.respond('permissionID', {
      id: 'id',
      response: 'once',
    });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  // skipped: tests are disabled for the time being
  test.skip('respond: required and optional params', async () => {
    const response = await client.session.permissions.respond('permissionID', { id: 'id', response: 'once' });
  });
});
