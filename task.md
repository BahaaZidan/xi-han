# Backend Developer Hiring Task: Smart Collections API

## Context

You are building a high-performance microservice for a content curation platform. Your task is to build the **Collections API**.
The system will be used by "Starter Plan" users who have specific limits on their usage. Your implementation must be robust, performant, and production-ready.

## Tech Stack Requirements

- **Runtime**: [Bun](https://bun.sh/)
- **Framework**: [Hono](https://hono.dev/)
- **Database**: PostgreSQL
- **ORM**: [Drizzle ORM](https://orm.drizzle.team/)
- **Validation**: [Zod](https://zod.dev/)
- **Language**: TypeScript

## Server Configuration

- **Port**: Must run on **port 3000**.
- **Base URL**: `http://localhost:3000`

## Database Schema

Design a schema that supports the following:

1. **User**: Authenticated via header `X-User-ID`.
2. **Collection**: Has a `name` and `description`.
3. **CollectionItem**: Links an external `itemId` (string) to a collection. Can have a `note` (optional text).

## Business Requirements

### 1. Storage Limits

- **Capacity**: To manage costs, the "Starter Plan" limits each collection to a maximum of **5 items**. This limit must be strictly enforced at the database level to prevent over-usage.

### 2. Response Format

- **Success**: HTTP 2xx.
- **Error**: HTTP 4xx/5xx. Body must be `{ "error": "Error message" }`.

## Endpoints Specification

### 1. Create Collection

**`POST /collections`**

- **Header**: `X-User-ID` (string)
- **Body**: `{ "name": string, "description"?: string }`
- **Behavior**:
  - To prevent duplicates without annoying the user, automatically handle name collisions by appending a counter (e.g., "My List" -> "My List (1)").
- **Response**: HTTP 201 (Returns the created object)

### 2. Add Item to Collection

**`POST /collections/:id/items`**

- **Header**: `X-User-ID` (string)
- **Body**: `{ "itemId": string, "note"?: string }`
- **Behavior**:
  - Adds an item to the collection.
  - Validation: Ensure the collection isn't full and the item doesn't already exist in it.
- **Response**: HTTP 201

### 3. Move Item

**`PUT /collections/move-item`**

- **Header**: `X-User-ID` (string)
- **Body**: `{ "itemId": string, "sourceCollectionId": number, "targetCollectionId": number }`
- **Behavior**:
  - Moves an item from one collection to another.
  - This operation must be safe and atomic. If the target is full, the move fails, and the item stays where it was.
- **Response**: HTTP 200 `{ "success": true }`

### 4. List Collections

**`GET /collections`**

- **Header**: `X-User-ID` (string)
- **Behavior**:
  - Returns all collections for the user.
  - **Sorting**: Users want to see their "most valuable" collections first. A collection's value is calculated by summing the value of its items:
    - Items with a meaningful note are worth **2 points**.
    - Items without a note are worth **1 point**.
- **Response**: HTTP 200 (List of collections with their computed `relevanceScore` and `itemCount`)

## Technical Expectations

1. **Reliability**: The system must be robust. Consider what happens if multiple requests hit your API at the exact same time.
2. **Performance**: Sorting should be efficient, avoiding doing heavy lifting in the application layer if possible.
3. **Testing**: Implement automated tests (bonus points for using Hono's native test tools).

## The "Reflection" File

Create a file named `REFLECTION.md`. In this file, purely in your own words (broadly and generally):

- Describe your thought process while building this.
- What was tricky? What was easy?
- How did you handle the constraints?
- Any feedback on the task itself?

## Setup Instructions

- Provide a `README.md` with commands to install, setup DB, run server, and run tests.
