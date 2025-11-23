import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../src/app';
import { pgClient } from '../src/db';

const headers = {
  'Content-Type': 'application/json',
  'X-User-ID': 'test-user',
};
const otherUserHeaders = {
  'Content-Type': 'application/json',
  'X-User-ID': 'other-user',
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

  it('keeps base names unique per user but allows same names across users', async () => {
    const first = await app.request('/collections', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Shared Name' }),
    });
    const second = await app.request('/collections', {
      method: 'POST',
      headers: otherUserHeaders,
      body: JSON.stringify({ name: 'Shared Name' }),
    });
    const third = await app.request('/collections', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Shared Name' }),
    });

    const firstBody = await first.json();
    const secondBody = await second.json();
    const thirdBody = await third.json();

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(201);
    expect(firstBody.name).toBe('Shared Name');
    expect(secondBody.name).toBe('Shared Name');
    expect(thirdBody.name).toBe('Shared Name (1)');
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

  it('rejects move into full target and leaves source untouched', async () => {
    const source = await app.request('/collections', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Source' }),
    }).then((r) => r.json());
    const target = await app.request('/collections', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Full Target' }),
    }).then((r) => r.json());

    for (let i = 0; i < 5; i += 1) {
      const res = await app.request(`/collections/${target.id}/items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ itemId: `item-${i}` }),
      });
      expect(res.status).toBe(201);
    }

    const addSource = await app.request(`/collections/${source.id}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ itemId: 'move-me' }),
    });
    expect(addSource.status).toBe(201);

    const move = await app.request('/collections/move-item', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        itemId: 'move-me',
        sourceCollectionId: source.id,
        targetCollectionId: target.id,
      }),
    });

    expect(move.status).toBe(400);

    const list = await app.request('/collections', { method: 'GET', headers }).then((r) => r.json());
    const updatedSource = list.find((c: any) => c.id === source.id);
    const updatedTarget = list.find((c: any) => c.id === target.id);

    expect(updatedSource.itemCount).toBe(1);
    expect(updatedTarget.itemCount).toBe(5);
  });

  it('prevents duplicate items on concurrent adds', async () => {
    const collection = await app.request('/collections', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Concurrent' }),
    }).then((r) => r.json());

    const [first, second] = await Promise.all([
      app.request(`/collections/${collection.id}/items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ itemId: 'dupe' }),
      }),
      app.request(`/collections/${collection.id}/items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ itemId: 'dupe' }),
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const list = await app.request('/collections', { method: 'GET', headers }).then((r) => r.json());
    const updated = list.find((c: any) => c.id === collection.id);
    expect(updated.itemCount).toBe(1);
  });

  it('orders collections by relevance then recency', async () => {
    const create = (name: string) =>
      app.request('/collections', { method: 'POST', headers, body: JSON.stringify({ name }) }).then((r) => r.json());

    const first = await create('First');
    await app.request(`/collections/${first.id}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ itemId: 'a', note: 'note' }),
    });

    await new Promise((r) => setTimeout(r, 10));

    const second = await create('Second');
    await app.request(`/collections/${second.id}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ itemId: 'b' }),
    });

    await new Promise((r) => setTimeout(r, 10));

    const third = await create('Third');
    await app.request(`/collections/${third.id}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ itemId: 'c', note: 'note' }),
    });

    const list = await app.request('/collections', { method: 'GET', headers }).then((r) => r.json());
    const namesInOrder = list.map((c: any) => c.name);

    expect(namesInOrder.slice(0, 3)).toEqual(['Third', 'First', 'Second']);
  });

  it('requires user header', async () => {
    const res = await app.request('/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No User' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
