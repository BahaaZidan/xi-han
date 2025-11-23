import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../src/app';
import { pgClient } from '../src/db';

const headers = {
  'Content-Type': 'application/json',
  'X-User-ID': 'test-user',
};

const resetDb = async () => {
  await pgClient`TRUNCATE TABLE collection_items RESTART IDENTITY CASCADE`;
  await pgClient`TRUNCATE TABLE collections RESTART IDENTITY CASCADE`;
  await pgClient`TRUNCATE TABLE users RESTART IDENTITY CASCADE`;
};

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await pgClient.end();
});

describe('Collections API', () => {
  it('handles duplicate collection names by appending counters', async () => {
    const first = await app.request('/collections', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'My List' }),
    });

    expect(first.status).toBe(201);

    const second = await app.request('/collections', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'My List' }),
    });

    const secondBody = await second.json();
    expect(second.status).toBe(201);
    expect(secondBody.name).toBe('My List (1)');
  });

  it('enforces the 5-item limit per collection', async () => {
    const collection = await app.request('/collections', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Limited' }),
    });

    const collectionBody = await collection.json();

    for (let i = 0; i < 5; i += 1) {
      const res = await app.request(`/collections/${collectionBody.id}/items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ itemId: `item-${i}` }),
      });
      expect(res.status).toBe(201);
    }

    const sixth = await app.request(`/collections/${collectionBody.id}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ itemId: 'item-6' }),
    });

    expect(sixth.status).toBe(400);
    const body = await sixth.json();
    expect(body.error).toBeDefined();
  });

  it('moves items atomically between collections', async () => {
    const sourceRes = await app.request('/collections', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Source' }),
    });
    const targetRes = await app.request('/collections', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Target' }),
    });

    const source = await sourceRes.json();
    const target = await targetRes.json();

    const add = await app.request(`/collections/${source.id}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ itemId: 'item-1', note: 'hello' }),
    });
    expect(add.status).toBe(201);

    const move = await app.request('/collections/move-item', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        itemId: 'item-1',
        sourceCollectionId: source.id,
        targetCollectionId: target.id,
      }),
    });

    expect(move.status).toBe(200);
    const moveBody = await move.json();
    expect(moveBody.success).toBe(true);

    const list = await app.request('/collections', { method: 'GET', headers });
    const collectionsList = await list.json();

    const updatedSource = collectionsList.find((c: any) => c.id === source.id);
    const updatedTarget = collectionsList.find((c: any) => c.id === target.id);

    expect(updatedSource.itemCount).toBe(0);
    expect(updatedTarget.itemCount).toBe(1);
    expect(updatedTarget.relevanceScore).toBe(2);
  });
});
