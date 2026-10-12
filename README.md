# URL Shortener API

A REST API built with Express, TypeScript, Prisma, PostgreSQL, and Redis. It generates short URLs, redirects users to their original destinations, caches URL mappings, tracks click counts, applies rate limiting, and protects link-management endpoints using API-key authentication and ownership checks.

## Features

- Create shortened URLs using `POST /links`.
- Redirect short codes to their original URLs.
- Store links and click counts in PostgreSQL using Prisma.
- Cache URL mappings in Redis with a 1-hour TTL.
- Use cache-aside to reduce repeated database lookups.
- Increment click counts when shortened URLs are visited.
- Invalidate cached mappings when a URL is updated.
- Apply Redis-backed rate limiting.
- Authenticate link-management requests using API keys.
- Store API-key hashes rather than raw API keys.
- Restrict link updates to the API key that owns the link.
- Track API-key usage and support key revocation.
- Fall back to PostgreSQL when Redis is unavailable during redirects.

## Tech Stack

- Node.js
- TypeScript
- Express
- PostgreSQL
- Prisma ORM
- Redis
- ioredis
- nanoid
- Zod
- express-rate-limit
- rate-limit-redis

## Architecture

### Creating a Short URL

1. The client sends a `POST /links` request with a valid API key and a long URL.
2. The API validates the request body.
3. The API generates a unique short code.
4. Prisma stores the long URL, short code, and owning API key ID in PostgreSQL.
5. The API returns the created link.

### Redirecting a Short URL

The API uses the cache-aside pattern:

1. The client requests a short code.
2. The API checks Redis for the corresponding URL.
3. If the URL is cached, the API uses the cached value.
4. If the cache misses, the API queries PostgreSQL.
5. If the link exists, the API attempts to cache the URL in Redis for 3,600 seconds.
6. The API increments the click counter and responds with an HTTP 302 redirect.
7. If Redis is unavailable, the API can fall back to PostgreSQL for the redirect.

### Updating a Short URL

1. The client sends a `PATCH /links/:shortCode` request with an API key.
2. The API authenticates the key and validates the request.
3. The API checks whether the authenticated key owns the requested link.
4. If the link belongs to another key, the API returns `403 Forbidden`.
5. If the link does not exist, the API returns `404 Not Found`.
6. If authorized, the API updates the URL in PostgreSQL.
7. The API attempts to invalidate the corresponding Redis cache entry.

### API-Key Authentication

- API keys are generated using cryptographically secure random bytes.
- Only the SHA-256 hash of each key is stored in PostgreSQL.
- Clients provide the original key using the `X-API-Key` header.
- Missing, invalid, and revoked keys are rejected with `401 Unauthorized`.
- Each link records the API key that created it.
- Valid API keys can update only their own links.
- API keys can be revoked without deleting their database records.

## API Endpoints

| Method | Endpoint            | Purpose                      | Authentication               |
| ------ | ------------------- | ---------------------------- | ---------------------------- |
| POST   | `/links`            | Create a short URL           | Required                     |
| GET    | `/:shortCode`       | Redirect to the original URL | Public                       |
| PATCH  | `/links/:shortCode` | Update a short URL           | Required; ownership enforced |

### Create a Short URL

**Request**

`POST /links`

Header:

`X-API-Key: <your-api-key>`

JSON body:

```json
{
  "longUrl": "https://example.com"
}
```

The API generates a short code and associates the link with the authenticated API key.

### Redirect to the Original URL

**Request**

`GET /:shortCode`

The API responds with an HTTP 302 redirect when the link exists.

### Update a Short URL

**Request**

`PATCH /links/:shortCode`

Header:

`X-API-Key: <your-api-key>`

JSON body:

```json
{
  "longUrl": "https://example.org"
}
```

Only the API key that owns the link can update it.

### Common HTTP Status Codes

| Status | Meaning                                         |
| ------ | ----------------------------------------------- |
| 200    | Request succeeded                               |
| 302    | Redirect to the original URL                    |
| 400    | Invalid request data                            |
| 401    | Missing, invalid, or revoked API key            |
| 403    | The authenticated API key does not own the link |
| 404    | Short code does not exist                       |
| 429    | Rate limit exceeded                             |
| 500    | Unexpected server-side failure                  |

## Rate Limiting

The API uses `express-rate-limit` with Redis as its rate-limit store.

The configured limit is 20 requests per 10-minute window per client IP, subject to the installed library's configuration and IP identification behavior.

Requests exceeding the configured limit receive `429 Too Many Requests`.

The Redis store's behavior during an outage must be configured and documented explicitly. A fail-closed policy prioritizes abuse protection but can reject requests when Redis is unavailable; a fail-open policy preserves availability but temporarily removes that rate-limit protection.

## Local Setup

### Prerequisites

- Node.js and npm
- PostgreSQL
- Docker
- A Redis instance

### 1. Install Dependencies

Clone the repository, navigate to the project directory, and run:

```bash
npm install
```

### 2. Configure PostgreSQL

Create a PostgreSQL database named `url_shortener`.

Configure the `DATABASE_URL` environment variable in `.env` to point to that database.

Example format:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/url_shortener?schema=public"
```

Replace `USER` and `PASSWORD` with your local PostgreSQL credentials.

### 3. Apply Database Migrations

Run:

```bash
npx prisma migrate dev
npx prisma generate
```

These commands apply the existing migrations and generate the Prisma Client.

### 4. Start Redis

If Redis is not already running in Docker, start a container:

```bash
docker run --name redis -p 6379:6379 -d redis
```

If the container already exists but is stopped, start it with:

```bash
docker start redis
```

The application must be configured to connect to the correct Redis host and port.

### 5. Generate an API Key

Run the API-key generation script:

```bash
npx tsx scripts/create-api-key.ts
```

Save the raw API key securely when it is printed. The database stores only its SHA-256 hash, so the original key cannot be retrieved from the hash.

Do not commit API keys, passwords, or other secrets to version control.

### 6. Start the Application

Use the development or start script configured in `package.json`. For example, if your project defines a `dev` script:

```bash
npm run dev
```

The API examples in this README assume the server listens on port `3000`.

## Design Trade-offs

### Cache-Aside

Redis is checked before PostgreSQL to reduce repeated database reads. A cache miss requires a database lookup, followed by an attempt to populate Redis.

The 1-hour TTL limits how long a cached entry remains without being refreshed or invalidated.

### Click Counting

Click counts are stored as a denormalized counter on each link. The current implementation uses awaited database updates instead of a separate click-event log.

This is straightforward to implement, but it adds a database write to redirect requests and can become a bottleneck at higher traffic volumes.

Concurrent counter updates and deleted records also require careful handling.

### HTTP 302 Redirects

The API uses temporary redirects rather than permanent `301` redirects. A `302` is appropriate while destinations may change and helps avoid clients permanently caching an old redirect.

### Cache Invalidation

After updating a link, the API attempts to delete its cached mapping. If invalidation fails, the old mapping may remain in Redis until it expires or is replaced.

### API-Key Hashing

Random API keys have high entropy, so SHA-256 provides a practical way to store and compare their hashes without retaining the original secret. This is not a password-storage strategy; human passwords require a password-hashing algorithm such as Argon2id or bcrypt.

### Rate-Limiter Failure Policy

The Redis-backed limiter needs an explicit failure policy. Fail-closed behavior protects against abuse when Redis is down but may affect API availability. Fail-open behavior preserves availability but permits requests without reliable rate limiting during the outage.

Verify the configured `passOnStoreError` behavior before deployment.

## Known Limitations and Deferred Work

- Automated Jest or Vitest tests have not been added; core behavior has been verified manually.
- Existing links without an `apiKeyId` cannot pass the ownership check for PATCH requests.
- Failed `lastUsedAt` updates should be treated as best-effort so analytics failures do not reject otherwise valid authenticated requests.
- Redis cache invalidation failures may leave stale mappings until the cache expires.
- Concurrent click-counter updates and stale-cache/database races require further consideration.
- The rate limiter's Redis-outage behavior must be explicitly configured and verified.
- The installed `express-rate-limit` version and its supported option names should be checked.
- Express `trust proxy` settings must be reviewed before deployment behind a reverse proxy.
- HTTP caching features such as `Cache-Control` and `ETag` have not been implemented.
- PostgreSQL read replicas have not been configured.
- Click tracking uses a counter rather than a separate click-event log table.
- Production deployment, monitoring, and additional security hardening are outside the current implementation scope.

## Future Improvements

- Add automated unit and integration tests.
- Make rate-limiter outage behavior explicit.
- Add structured logging and monitoring.
- Review cache invalidation and concurrent-update behavior.
- Consider asynchronous click-event processing for higher traffic.
- Evaluate HTTP caching headers and read replicas when appropriate.
- Add deployment configuration and production security hardening.

## Development Status

The core URL-shortening workflow, Redis cache-aside behavior, redirects, click counting, rate limiting, API-key authentication, ownership checks, and Redis-outage fallback have been implemented and manually tested.
