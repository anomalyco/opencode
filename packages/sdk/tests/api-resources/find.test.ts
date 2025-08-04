// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import Opencode from '@opencode-ai/sdk';

const client = new Opencode({ baseURL: process.env['TEST_API_BASE_URL'] ?? 'http://127.0.0.1:4010' });

describe('resource find', () => {
  // skipped: tests are disabled for the time being
  test.skip('files: only required params', async () => {
    const responsePromise = client.find.files({ query: 'query' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  // skipped: tests are disabled for the time being
  test.skip('files: required and optional params', async () => {
    const response = await client.find.files({ query: 'query' });
  });

  // skipped: tests are disabled for the time being
  test.skip('symbols: only required params', async () => {
    const responsePromise = client.find.symbols({ query: 'query' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  // skipped: tests are disabled for the time being
  test.skip('symbols: required and optional params', async () => {
    const response = await client.find.symbols({ query: 'query' });
  });

  // skipped: tests are disabled for the time being
  test.skip('text: only required params', async () => {
    const responsePromise = client.find.text({ pattern: 'pattern' });
    const rawResponse = await responsePromise.asResponse();
    expect(rawResponse).toBeInstanceOf(Response);
    const response = await responsePromise;
    expect(response).not.toBeInstanceOf(Response);
    const dataAndResponse = await responsePromise.withResponse();
    expect(dataAndResponse.data).toBe(response);
    expect(dataAndResponse.response).toBe(rawResponse);
  });

  // skipped: tests are disabled for the time being
  test.skip('text: required and optional params', async () => {
    const response = await client.find.text({ pattern: 'pattern' });
  });
});
